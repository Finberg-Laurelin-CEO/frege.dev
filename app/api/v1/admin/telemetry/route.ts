import { authenticateAdminRequest } from "@/lib/core/admin-auth";
import { parseLimit } from "@/lib/core/documents";
import { routeError } from "@/lib/core/request-guards";
import { listTelemetryEvents, logTelemetryEvent, telemetrySummary } from "@/lib/core/telemetry";

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
    const before = stringParam(url.searchParams, "before");
    if (before && Number.isNaN(Date.parse(before))) {
      return Response.json({ error: "invalid_before" }, { status: 400 });
    }

    const limit = parseLimit(url.searchParams, 50, 200);
    const [summary, events] = await Promise.all([
      telemetrySummary(auth),
      listTelemetryEvents(auth, {
        action: stringParam(url.searchParams, "action"),
        outcome: stringParam(url.searchParams, "outcome"),
        actorType: stringParam(url.searchParams, "actor_type"),
        provider: stringParam(url.searchParams, "provider"),
        before,
        limit,
      }),
    ]);

    await logTelemetryEvent({
      actor: { type: "user", auth },
      req,
      action: "admin.telemetry.list",
      resourceType: "telemetry_event",
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { result_count: events.length },
    });

    return Response.json({ summary, events }, { status: 200 });
  } catch (err) {
    return routeError("admin telemetry list failed", err);
  }
}
