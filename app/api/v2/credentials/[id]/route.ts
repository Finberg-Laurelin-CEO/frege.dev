import { z } from "zod";
import { authenticateAdminRequest } from "@/lib/core/admin-auth";
import { assertSafeBrowserMutation, routeError } from "@/lib/core/request-guards";
import { v2PreviewDisabledResponse, v2PreviewEnabled } from "@/lib/core/v2-preview";
import {
  appendProvenanceEvent,
  ensureHumanPrincipal,
  revokeDelegatedCredential,
} from "@/lib/v2/control-plane";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

async function revoke(req: Request, context: RouteContext) {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  try {
    const authResult = await authenticateAdminRequest(req);
    if (!authResult.ok) return authResult.response;
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) {
      return Response.json({ error: "invalid_credential_id" }, { status: 400 });
    }

    const credential = await revokeDelegatedCredential(authResult.auth.organization.id, id);
    if (!credential) return Response.json({ error: "not_found" }, { status: 404 });
    const actor = await ensureHumanPrincipal(authResult.auth);
    await appendProvenanceEvent({
      orgId: authResult.auth.organization.id,
      principalId: actor.id,
      eventType: "credential.revoked",
      action: "credential.revoke",
      resource: { type: "delegated_credential", id: credential.id },
      outcome: "success",
      payload: { target_principal_id: credential.principal_id, key_prefix: credential.key_prefix },
    });
    return Response.json({ credential }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return routeError("v2 credential revoke failed", err);
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  if (!v2PreviewEnabled()) return v2PreviewDisabledResponse();

  return revoke(req, context);
}

export async function DELETE(req: Request, context: RouteContext) {
  if (!v2PreviewEnabled()) return v2PreviewDisabledResponse();

  return revoke(req, context);
}
