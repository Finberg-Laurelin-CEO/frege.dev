import { authenticateFregeActor, telemetryActorForFregeActor } from "@/lib/prototype/actor-auth";
import { listVault, readerForActor } from "@/lib/prototype/brain-graph";
import { routeError } from "@/lib/prototype/request-guards";
import { logTelemetryEvent } from "@/lib/prototype/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const startedAt = Date.now();
  const actorResult = await authenticateFregeActor(req, { allowInactiveUser: true });
  if (!actorResult.ok) return actorResult.response;

  try {
    const url = new URL(req.url);
    const limitParam = url.searchParams.get("limit");
    const limitRaw = Number(limitParam);
    const limit =
      limitParam !== null && limitParam.trim() !== "" && Number.isFinite(limitRaw)
        ? Math.min(Math.max(Math.trunc(limitRaw), 1), 500)
        : 200;

    const entries = await listVault(readerForActor(actorResult.actor), limit);

    await logTelemetryEvent({
      actor: telemetryActorForFregeActor(actorResult.actor),
      req,
      action: "brain.vault.list",
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { count: entries.length },
    });

    return Response.json({ entries }, { status: 200 });
  } catch (err) {
    return routeError("brain vault list failed", err);
  }
}
