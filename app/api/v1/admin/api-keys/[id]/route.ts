import { getSql } from "@/lib/db";
import { authenticateAdminRequest } from "@/lib/core/admin-auth";
import { assertSafeBrowserMutation, routeError } from "@/lib/core/request-guards";
import { logTelemetryEvent } from "@/lib/core/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

async function revokeApiKey(req: Request, context: RouteContext) {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  const startedAt = Date.now();
  try {
    const authResult = await authenticateAdminRequest(req);
    if (!authResult.ok) return authResult.response;
    const auth = authResult.auth;
    const { id } = await context.params;

    const sql = getSql();
    const [apiKey] = await sql`
      update api_keys
      set status = 'revoked'
      where id = ${id}
        and org_id = ${auth.organization.id}
      returning id, name, key_prefix, status
    `;
    if (!apiKey) return Response.json({ error: "not_found" }, { status: 404 });

    await logTelemetryEvent({
      actor: { type: "user", auth },
      req,
      action: "admin.api_keys.revoke",
      resourceType: "api_key",
      resourceId: apiKey.id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { key_prefix: apiKey.key_prefix, name: apiKey.name },
    });

    return Response.json({ api_key: apiKey }, { status: 200 });
  } catch (err) {
    return routeError("admin api key revoke failed", err);
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  return revokeApiKey(req, context);
}

export async function DELETE(req: Request, context: RouteContext) {
  return revokeApiKey(req, context);
}
