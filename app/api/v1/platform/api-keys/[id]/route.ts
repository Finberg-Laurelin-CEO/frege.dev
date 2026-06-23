import { getSql } from "@/lib/db";
import { authenticatePlatformStaff } from "@/lib/prototype/platform-auth";
import { assertSafeBrowserMutation, routeError } from "@/lib/prototype/request-guards";
import { logTelemetryEvent } from "@/lib/prototype/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

async function revoke(req: Request, context: RouteContext) {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  const startedAt = Date.now();
  try {
    const staff = await authenticatePlatformStaff(req);
    if (!staff.ok) return staff.response;

    const { id } = await context.params;
    const sql = getSql();
    const [apiKey] = await sql`
      update api_keys
      set status = 'revoked'
      where id = ${id}
      returning id, org_id, name, key_prefix, status
    `;
    if (!apiKey) return Response.json({ error: "not_found" }, { status: 404 });

    await logTelemetryEvent({
      actor: { type: "system", orgId: apiKey.org_id },
      req,
      action: "platform.api_keys.revoke",
      resourceType: "api_key",
      resourceId: apiKey.id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { key_prefix: apiKey.key_prefix, by_user: staff.auth.user.email },
    });

    return Response.json({ api_key: apiKey }, { status: 200 });
  } catch (err) {
    return routeError("platform api key revoke failed", err);
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  return revoke(req, context);
}

export async function DELETE(req: Request, context: RouteContext) {
  return revoke(req, context);
}
