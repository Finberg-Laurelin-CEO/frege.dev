import { z } from "zod";
import { authenticateFregeActor, telemetryActorForFregeActor } from "@/lib/prototype/actor-auth";
import { appendSessionEvent } from "@/lib/prototype/brain";
import { buildContextPacket } from "@/lib/prototype/context-gateway";
import { assertSafeOrigin, readJson, routeError } from "@/lib/prototype/request-guards";
import { logTelemetryEvent } from "@/lib/prototype/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const contextBuildSchema = z.object({
  org_slug: z.string().min(1).optional(),
  query: z.string().trim().max(1000).default(""),
  slug: z.string().trim().min(1).max(160).optional(),
  limit: z.number().int().min(1).max(25).default(8),
  session_id: z.string().uuid().optional(),
});

export async function POST(req: Request) {
  const originError = assertSafeOrigin(req);
  if (originError) return originError;

  const startedAt = Date.now();
  let actorResult: Awaited<ReturnType<typeof authenticateFregeActor>> | null = null;
  try {
    const json = await readJson(req);
    if (!json.ok) return json.response;

    const parsed = contextBuildSchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }
    if (!parsed.data.query && !parsed.data.slug) {
      return Response.json({ error: "missing_query_or_slug" }, { status: 400 });
    }

    actorResult = await authenticateFregeActor(req, parsed.data.org_slug);
    if (!actorResult.ok) return actorResult.response;

    const packet = await buildContextPacket(actorResult.actor, parsed.data);
    await logTelemetryEvent({
      actor: telemetryActorForFregeActor(actorResult.actor),
      req,
      action: "context.build",
      resourceType: "context_build",
      resourceId: packet.id,
      contextBuildId: packet.id,
      sessionId: parsed.data.session_id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      inputTokens: packet.token_estimate,
      trustZone: packet.trust_zone,
      metadata: {
        query_chars: packet.query.length,
        source_slug: packet.source_slug,
        document_count: packet.documents.length,
        brain_page_count: packet.brain_pages.length,
        link_count: packet.links.length,
        concept_count: packet.concepts.length,
        denied_count: packet.denied_count,
      },
    });

    if (parsed.data.session_id) {
      const event = await appendSessionEvent(actorResult.actor, {
        session_id: parsed.data.session_id,
        event_type: "context_build",
        body_md: `Context build ${packet.id}: ${packet.query || packet.source_slug || "no query"}`,
        payload: {
          context_build_id: packet.id,
          query_chars: packet.query.length,
          source_slug: packet.source_slug,
          document_count: packet.documents.length,
          brain_page_count: packet.brain_pages.length,
          denied_count: packet.denied_count,
          token_estimate: packet.token_estimate,
        },
        trust_zone: packet.trust_zone,
      });
      await logTelemetryEvent({
        actor: telemetryActorForFregeActor(actorResult.actor),
        req,
        action: "sessions.events.append",
        resourceType: "brain_session_event",
        resourceId: event.id,
        sessionId: parsed.data.session_id,
        sessionEventId: event.id,
        contextBuildId: packet.id,
        outcome: "success",
        latencyMs: Date.now() - startedAt,
        trustZone: packet.trust_zone,
        metadata: { event_type: "context_build" },
      });
    }

    if (packet.denied_count > 0) {
      await logTelemetryEvent({
        actor: telemetryActorForFregeActor(actorResult.actor),
        req,
        action: "context.denied",
        resourceType: "context_build",
        resourceId: packet.id,
        contextBuildId: packet.id,
        sessionId: parsed.data.session_id,
        outcome: "denied",
        latencyMs: Date.now() - startedAt,
        trustZone: packet.trust_zone,
        metadata: { denied_count: packet.denied_count },
      });
    }

    return Response.json({ context: packet }, { status: 200 });
  } catch (err) {
    if (actorResult?.ok) {
      await logTelemetryEvent({
        actor: telemetryActorForFregeActor(actorResult.actor),
        req,
        action: "context.build",
        resourceType: "context_build",
        outcome: "failure",
        latencyMs: Date.now() - startedAt,
        metadata: { error: (err as Error)?.message },
      });
    }
    return routeError("context build failed", err);
  }
}
