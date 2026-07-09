import { authenticateFregeActor, telemetryActorForFregeActor } from "@/lib/core/actor-auth";
import { findConnections, readerForActor } from "@/lib/core/brain-graph";
import { routeError } from "@/lib/core/request-guards";
import { logTelemetryEvent } from "@/lib/core/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const startedAt = Date.now();
  const actorResult = await authenticateFregeActor(req, { allowInactiveUser: true });
  if (!actorResult.ok) return actorResult.response;

  try {
    const url = new URL(req.url);
    const from = url.searchParams.get("from")?.trim() ?? "";
    const to = url.searchParams.get("to")?.trim() ?? "";
    if (!from || !to) return Response.json({ error: "missing_slugs" }, { status: 400 });

    const maxHopsParam = url.searchParams.get("max_hops");
    const maxHopsRaw = Number(maxHopsParam);
    const maxHops =
      maxHopsParam !== null && maxHopsParam.trim() !== "" && Number.isFinite(maxHopsRaw)
        ? Math.min(Math.max(Math.trunc(maxHopsRaw), 1), 6)
        : 4;

    const path = await findConnections(readerForActor(actorResult.actor), from, to, maxHops);
    if (!path) return Response.json({ connected: false }, { status: 200 });

    await logTelemetryEvent({
      actor: telemetryActorForFregeActor(actorResult.actor),
      req,
      action: "brain.connections",
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { from, to, hops: path.hops },
    });

    return Response.json({ connected: true, ...path }, { status: 200 });
  } catch (err) {
    return routeError("brain connections failed", err);
  }
}
