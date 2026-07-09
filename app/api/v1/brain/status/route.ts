import { authenticateFregeActor, telemetryActorForFregeActor } from "@/lib/core/actor-auth";
import { brainStatus } from "@/lib/core/brain";
import { routeError } from "@/lib/core/request-guards";
import { logTelemetryEvent } from "@/lib/core/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const startedAt = Date.now();
  const actorResult = await authenticateFregeActor(req);
  if (!actorResult.ok) return actorResult.response;

  try {
    const status = await brainStatus(actorResult.actor);
    await logTelemetryEvent({
      actor: telemetryActorForFregeActor(actorResult.actor),
      req,
      action: "brain.status",
      resourceType: "brain",
      outcome: "success",
      latencyMs: Date.now() - startedAt,
    });
    return Response.json({ status }, { status: 200 });
  } catch (err) {
    await logTelemetryEvent({
      actor: telemetryActorForFregeActor(actorResult.actor),
      req,
      action: "brain.status",
      resourceType: "brain",
      outcome: "failure",
      latencyMs: Date.now() - startedAt,
      metadata: { error: (err as Error)?.message },
    });
    return routeError("brain status failed", err);
  }
}
