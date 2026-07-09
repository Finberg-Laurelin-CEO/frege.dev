import { authenticateFregeActor, telemetryActorForFregeActor } from "@/lib/core/actor-auth";
import { getBrainSession } from "@/lib/core/brain";
import { routeError } from "@/lib/core/request-guards";
import { logTelemetryEvent } from "@/lib/core/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(req: Request, context: RouteContext) {
  const startedAt = Date.now();
  const actorResult = await authenticateFregeActor(req);
  if (!actorResult.ok) return actorResult.response;

  try {
    const { id } = await context.params;
    const result = await getBrainSession(actorResult.actor, id);
    if (!result) return Response.json({ error: "not_found" }, { status: 404 });
    await logTelemetryEvent({
      actor: telemetryActorForFregeActor(actorResult.actor),
      req,
      action: "sessions.read",
      resourceType: "brain_session",
      resourceId: result.session.id,
      sessionId: result.session.id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      trustZone: result.session.trust_zone,
      metadata: { event_count: result.events.length, denied_count: result.denied_count },
    });
    return Response.json(result, { status: 200 });
  } catch (err) {
    const message = (err as Error)?.message;
    if (message === "session_read_forbidden") return Response.json({ error: message }, { status: 403 });
    return routeError("session read failed", err);
  }
}
