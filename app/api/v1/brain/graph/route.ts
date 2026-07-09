import { authenticateFregeActor, telemetryActorForFregeActor } from "@/lib/core/actor-auth";
import { getNeighbors, getVaultGraph, readerForActor } from "@/lib/core/brain-graph";
import { routeError } from "@/lib/core/request-guards";
import { logTelemetryEvent } from "@/lib/core/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null || value.trim() === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

export async function GET(req: Request) {
  const startedAt = Date.now();
  const actorResult = await authenticateFregeActor(req, { allowInactiveUser: true });
  if (!actorResult.ok) return actorResult.response;

  try {
    const reader = readerForActor(actorResult.actor);
    const url = new URL(req.url);
    const root = url.searchParams.get("slug")?.trim() || null;

    // With a slug => local graph (neighbors); without => global vault graph.
    const graph = root
      ? await getNeighbors(
          reader,
          root,
          clampInt(url.searchParams.get("depth"), 1, 1, 3),
          clampInt(url.searchParams.get("limit"), 50, 1, 200),
        )
      : await getVaultGraph(reader, clampInt(url.searchParams.get("limit"), 500, 1, 1000));

    if (!graph) return Response.json({ error: "not_found" }, { status: 404 });

    await logTelemetryEvent({
      actor: telemetryActorForFregeActor(actorResult.actor),
      req,
      action: "brain.graph",
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { root, nodes: graph.nodes.length, edges: graph.edges.length },
    });

    return Response.json(graph, { status: 200 });
  } catch (err) {
    return routeError("brain graph failed", err);
  }
}
