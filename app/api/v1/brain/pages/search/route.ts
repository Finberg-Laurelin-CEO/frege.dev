import { authenticateFregeActor, telemetryActorForFregeActor } from "@/lib/prototype/actor-auth";
import { searchBrainPages } from "@/lib/prototype/brain";
import { routeError } from "@/lib/prototype/request-guards";
import { logTelemetryEvent } from "@/lib/prototype/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const startedAt = Date.now();
  const actorResult = await authenticateFregeActor(req);
  if (!actorResult.ok) return actorResult.response;

  try {
    const url = new URL(req.url);
    const query = url.searchParams.get("q") ?? url.searchParams.get("query") ?? "";
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 10), 1), 50);
    const pages = await searchBrainPages(actorResult.actor, { query, limit });
    await logTelemetryEvent({
      actor: telemetryActorForFregeActor(actorResult.actor),
      req,
      action: "brain.pages.search",
      resourceType: "brain_page",
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { query_chars: query.length, result_count: pages.length },
    });
    return Response.json({ pages }, { status: 200 });
  } catch (err) {
    return routeError("brain pages search failed", err);
  }
}
