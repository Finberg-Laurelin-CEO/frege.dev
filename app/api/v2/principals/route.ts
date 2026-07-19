import { authenticateAdminRequest } from "@/lib/core/admin-auth";
import { assertActiveHumanOrg, assertVerifiedHumanUser } from "@/lib/core/org-guard";
import { assertSafeBrowserMutation, readJson, routeError } from "@/lib/core/request-guards";
import { createPrincipalSchema } from "@/lib/v2/contracts";
import {
  appendProvenanceEvent,
  createPrincipal,
  listPrincipals,
  V2ControlPlaneError,
} from "@/lib/v2/control-plane";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const authResult = await authenticateAdminRequest(req);
    if (!authResult.ok) return authResult.response;
    const principals = await listPrincipals(authResult.auth.organization.id);
    return Response.json({ principals }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return routeError("v2 principals list failed", err);
  }
}

export async function POST(req: Request) {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  try {
    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = createPrincipalSchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const authResult = await authenticateAdminRequest(req, parsed.data.org_slug);
    if (!authResult.ok) return authResult.response;
    const unverified = assertVerifiedHumanUser(authResult.auth);
    if (unverified) return unverified;
    const inactive = assertActiveHumanOrg(authResult.auth);
    if (inactive) return inactive;

    const principal = await createPrincipal(authResult.auth, parsed.data);
    await appendProvenanceEvent({
      orgId: authResult.auth.organization.id,
      principalId: principal.created_by_principal_id,
      eventType: "principal.created",
      action: "principal.create",
      resource: { type: "principal", id: principal.id },
      outcome: "success",
      payload: { principal_id: principal.id, principal_type: principal.principal_type, principal_slug: principal.slug },
    });
    return Response.json({ principal }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof V2ControlPlaneError && err.code === "subject_not_found") {
      return Response.json({ error: err.code }, { status: 404 });
    }
    if ((err as { code?: string })?.code === "23505") {
      return Response.json({ error: "principal_conflict" }, { status: 409 });
    }
    return routeError("v2 principal create failed", err);
  }
}
