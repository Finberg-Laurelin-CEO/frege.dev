import { getSql } from "@/lib/db";
import { authenticateAdminRequest } from "@/lib/core/admin-auth";
import { parseLimit } from "@/lib/core/documents";
import { routeError } from "@/lib/core/request-guards";
import { logTelemetryEvent } from "@/lib/core/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function stringParam(searchParams: URLSearchParams, name: string): string | undefined {
  const value = searchParams.get(name)?.trim();
  return value || undefined;
}

export async function GET(req: Request) {
  const startedAt = Date.now();
  try {
    const authResult = await authenticateAdminRequest(req);
    if (!authResult.ok) return authResult.response;
    const auth = authResult.auth;

    const url = new URL(req.url);
    const action = stringParam(url.searchParams, "action");
    const resourceType = stringParam(url.searchParams, "resource_type");
    const before = stringParam(url.searchParams, "before");
    if (before && Number.isNaN(Date.parse(before))) {
      return Response.json({ error: "invalid_before" }, { status: 400 });
    }

    const limit = parseLimit(url.searchParams, 50, 200);
    const sql = getSql();
    const events = await sql`
      select
        audit_events.id,
        audit_events.action,
        audit_events.resource_type,
        audit_events.resource_id,
        audit_events.ip_hash,
        audit_events.user_agent,
        audit_events.metadata,
        audit_events.created_at,
        api_keys.id as actor_key_id,
        api_keys.name as actor_key_name,
        api_keys.key_prefix as actor_key_prefix
      from audit_events
      left join api_keys on api_keys.id = audit_events.actor_key_id
      where audit_events.org_id = ${auth.organization.id}
        and (${action ?? null}::text is null or audit_events.action = ${action ?? null})
        and (${resourceType ?? null}::text is null or audit_events.resource_type = ${resourceType ?? null})
        and (${before ?? null}::timestamptz is null or audit_events.created_at < ${before ?? null}::timestamptz)
      order by audit_events.created_at desc
      limit ${limit}
    `;

    await logTelemetryEvent({
      actor: { type: "user", auth },
      req,
      action: "admin.audit_events.list",
      resourceType: "audit_event",
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: {
        action_filter: action ?? null,
        resource_type_filter: resourceType ?? null,
        result_count: events.length,
      },
    });

    return Response.json({ events }, { status: 200 });
  } catch (err) {
    return routeError("admin audit-events list failed", err);
  }
}
