import { z } from "zod";
import { authenticateFregeActor, telemetryActorForFregeActor } from "@/lib/core/actor-auth";
import { appendSessionEvent } from "@/lib/core/brain";
import { assertSafeOrigin, readJson, routeError } from "@/lib/core/request-guards";
import { logTelemetryEvent } from "@/lib/core/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const eventSchema = z.object({
  event_type: z.enum([
    "user_message",
    "assistant_message",
    "tool_call",
    "tool_result",
    "context_build",
    "model_invoke",
    "memory_signal",
    "note",
  ]),
  body_md: z.string().max(100000).default(""),
  payload: z.record(z.unknown()).default({}),
  trust_zone: z.enum(["green", "red"]).default("green"),
  source_ids: z.array(z.string().uuid()).default([]),
  request_id: z.string().max(160).optional(),
});

export async function POST(req: Request, context: RouteContext) {
  const originError = assertSafeOrigin(req);
  if (originError) return originError;

  const startedAt = Date.now();
  const actorResult = await authenticateFregeActor(req);
  if (!actorResult.ok) return actorResult.response;

  try {
    const { id } = await context.params;
    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = eventSchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const event = await appendSessionEvent(actorResult.actor, {
      ...parsed.data,
      session_id: id,
    });
    await logTelemetryEvent({
      actor: telemetryActorForFregeActor(actorResult.actor),
      req,
      action: "sessions.events.append",
      resourceType: "brain_session_event",
      resourceId: event.id,
      sessionId: id,
      sessionEventId: event.id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      trustZone: event.trust_zone,
      metadata: { event_type: event.event_type, body_chars: parsed.data.body_md.length },
    });
    return Response.json({ event }, { status: 201 });
  } catch (err) {
    const message = (err as Error)?.message;
    const denied = message === "session_write_forbidden" || message === "trust_zone_forbidden";
    await logTelemetryEvent({
      actor: telemetryActorForFregeActor(actorResult.actor),
      req,
      action: "sessions.events.append",
      resourceType: "brain_session_event",
      outcome: denied ? "denied" : "failure",
      latencyMs: Date.now() - startedAt,
      metadata: { error: message },
    });
    if (denied) return Response.json({ error: message }, { status: 403 });
    if (message === "session_not_found") return Response.json({ error: message }, { status: 404 });
    return routeError("session event append failed", err);
  }
}
