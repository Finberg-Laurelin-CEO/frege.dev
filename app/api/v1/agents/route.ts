import { z } from "zod";
import { authenticateFregeActor, telemetryActorForFregeActor } from "@/lib/core/actor-auth";
import { enqueueAgentRun, listActiveAgentDefinitions } from "@/lib/core/agent-runtime";
import { assertSafeOrigin, readJson, routeError } from "@/lib/core/request-guards";
import { logTelemetryEvent } from "@/lib/core/telemetry";
import { hostedExecutionDisabledResponse, hostedExecutionEnabled } from "@/lib/core/hosted-execution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const runSchema = z.object({
  agent_slug: z.string().min(1),
  input_md: z.string().trim().min(1).max(100000),
  context_query: z.string().max(1000).optional(),
  session_id: z.string().uuid().optional(),
  trust_zone: z.enum(["green", "red"]).optional(),
  max_steps: z.number().int().min(1).max(10).optional(),
  metadata: z.record(z.unknown()).default({}),
});

export async function GET(req: Request) {
  const startedAt = Date.now();
  const actorResult = await authenticateFregeActor(req);
  if (!actorResult.ok) return actorResult.response;

  try {
    const agents = await listActiveAgentDefinitions(actorResult.actor);
    await logTelemetryEvent({
      actor: telemetryActorForFregeActor(actorResult.actor),
      req,
      action: "agents.list",
      resourceType: "agent_definition",
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { result_count: agents.length },
    });
    return Response.json({ agents }, { status: 200 });
  } catch (err) {
    return routeError("agents list failed", err);
  }
}

export async function POST(req: Request) {
  const originError = assertSafeOrigin(req);
  if (originError) return originError;
  if (!hostedExecutionEnabled()) return hostedExecutionDisabledResponse();

  const startedAt = Date.now();
  const actorResult = await authenticateFregeActor(req);
  if (!actorResult.ok) return actorResult.response;

  try {
    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = runSchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const run = await enqueueAgentRun(actorResult.actor, parsed.data);
    await logTelemetryEvent({
      actor: telemetryActorForFregeActor(actorResult.actor),
      req,
      action: "agents.run.enqueue",
      resourceType: "agent_run",
      resourceId: run.id,
      sessionId: run.session_id ?? undefined,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      trustZone: run.trust_zone,
      metadata: { agent_slug: parsed.data.agent_slug, input_chars: parsed.data.input_md.length },
    });
    return Response.json({ run }, { status: 202 });
  } catch (err) {
    const message = (err as Error)?.message;
    const denied = message === "agent_execute_forbidden" || message === "trust_zone_forbidden";
    if (denied) {
      await logTelemetryEvent({
        actor: telemetryActorForFregeActor(actorResult.actor),
        req,
        action: "agents.run.enqueue",
        resourceType: "agent_run",
        outcome: "denied",
        latencyMs: Date.now() - startedAt,
        metadata: { error: message },
      });
      return Response.json({ error: message }, { status: 403 });
    }
    if (message === "agent_not_found") return Response.json({ error: message }, { status: 404 });
    return routeError("agent run enqueue failed", err);
  }
}
