import { z } from "zod";
import { authenticateAdminRequest } from "@/lib/core/admin-auth";
import { assertActiveHumanOrg, assertVerifiedHumanUser } from "@/lib/core/org-guard";
import { assertSafeBrowserMutation, readJson, routeError } from "@/lib/core/request-guards";
import { createCredentialSchema } from "@/lib/v2/contracts";
import {
  appendProvenanceEvent,
  createDelegatedCredential,
  listDelegatedCredentials,
  V2ControlPlaneError,
} from "@/lib/v2/control-plane";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const authResult = await authenticateAdminRequest(req);
    if (!authResult.ok) return authResult.response;
    const principalValue = new URL(req.url).searchParams.get("principal_id")?.trim() || undefined;
    const principalId = z.string().uuid().optional().safeParse(principalValue);
    if (!principalId.success) return Response.json({ error: "invalid_principal_id" }, { status: 400 });

    const credentials = await listDelegatedCredentials(authResult.auth.organization.id, principalId.data);
    return Response.json({ credentials }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return routeError("v2 credential list failed", err);
  }
}

export async function POST(req: Request) {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  try {
    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = createCredentialSchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const authResult = await authenticateAdminRequest(req, parsed.data.org_slug);
    if (!authResult.ok) return authResult.response;
    const unverified = assertVerifiedHumanUser(authResult.auth);
    if (unverified) return unverified;
    const inactive = assertActiveHumanOrg(authResult.auth);
    if (inactive) return inactive;

    const result = await createDelegatedCredential(authResult.auth, parsed.data);
    await appendProvenanceEvent({
      orgId: authResult.auth.organization.id,
      principalId: result.credential.delegated_by_principal_id,
      eventType: "credential.created",
      action: "credential.delegate",
      resource: { type: "delegated_credential", id: result.credential.id },
      outcome: "success",
      payload: {
        target_principal_id: result.credential.principal_id,
        key_prefix: result.credential.key_prefix,
        scopes: result.credential.scopes,
        policy_version_id: result.credential.policy_version_id,
      },
    });
    return Response.json(
      {
        credential: result.credential,
        // One-time disclosure. Only the salted hash is persisted.
        raw_credential: result.rawCredential,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof V2ControlPlaneError) {
      if (["principal_not_found", "policy_not_found"].includes(err.code)) {
        return Response.json({ error: err.code }, { status: 404 });
      }
      if (err.code === "principal_inactive") {
        return Response.json({ error: err.code }, { status: 409 });
      }
    }
    if ((err as { code?: string })?.code === "23505") {
      return Response.json({ error: "credential_conflict" }, { status: 409 });
    }
    return routeError("v2 credential create failed", err);
  }
}
