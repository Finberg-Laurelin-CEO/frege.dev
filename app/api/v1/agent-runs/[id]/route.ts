import { authenticateFregeActor, telemetryActorForFregeActor } from "@/lib/prototype/actor-auth";
import { getAgentRunForActor } from "@/lib/prototype/agent-runtime";
import { routeError } from "@/lib/prototype/request-guards";
import { logTelemetryEvent } from "@/lib/prototype/telemetry";

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
    const result = await getAgentRunForActor(actorResult.actor, id);
    if (!result) return Response.json({ error: "not_found" }, { status: 404 });
    await logTelemetryEvent({
      actor: telemetryActorForFregeActor(actorResult.actor),
      req,
      action: "agents.run.read",
      resourceType: "agent_run",
      resourceId: result.run.id,
      sessionId: result.run.session_id ?? undefined,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      trustZone: result.run.trust_zone,
      metadata: { status: result.run.status, step_count: result.steps.length },
    });
    return Response.json(result, { status: 200 });
  } catch (err) {
    return routeError("agent run read failed", err);
  }
}
