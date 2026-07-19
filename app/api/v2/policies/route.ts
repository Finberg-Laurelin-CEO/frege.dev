import { authenticateAdminRequest } from "@/lib/core/admin-auth";
import { assertActiveHumanOrg, assertVerifiedHumanUser } from "@/lib/core/org-guard";
import { assertSafeBrowserMutation, readJson, routeError } from "@/lib/core/request-guards";
import { createPolicyVersionSchema } from "@/lib/v2/contracts";
import {
  appendProvenanceEvent,
  createPolicyVersion,
  listPolicyVersions,
  V2ControlPlaneError,
} from "@/lib/v2/control-plane";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const authResult = await authenticateAdminRequest(req);
    if (!authResult.ok) return authResult.response;
    const policies = await listPolicyVersions(authResult.auth.organization.id);
    return Response.json({ policies }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return routeError("v2 policy list failed", err);
  }
}

export async function POST(req: Request) {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  try {
    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = createPolicyVersionSchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const authResult = await authenticateAdminRequest(req, parsed.data.org_slug);
    if (!authResult.ok) return authResult.response;
    const unverified = assertVerifiedHumanUser(authResult.auth);
    if (unverified) return unverified;
    const inactive = assertActiveHumanOrg(authResult.auth);
    if (inactive) return inactive;

    const policy = await createPolicyVersion(authResult.auth, parsed.data);
    await appendProvenanceEvent({
      orgId: authResult.auth.organization.id,
      principalId: policy.created_by_principal_id,
      eventType: "policy.published",
      action: "policy.publish",
      resource: { type: "policy_version", id: policy.id },
      outcome: "success",
      payload: {
        policy_slug: policy.slug,
        policy_version: policy.version,
        rules_digest: policy.rules_digest,
        rule_count: policy.rules.length,
      },
    });
    return Response.json({ policy }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof V2ControlPlaneError && err.code === "principal_not_found") {
      return Response.json({ error: err.code }, { status: 404 });
    }
    if (err instanceof V2ControlPlaneError && err.code === "policy_version_conflict") {
      return Response.json({ error: err.code }, { status: 409 });
    }
    if ((err as { code?: string })?.code === "23505") {
      return Response.json({ error: "policy_version_conflict" }, { status: 409 });
    }
    return routeError("v2 policy create failed", err);
  }
}
