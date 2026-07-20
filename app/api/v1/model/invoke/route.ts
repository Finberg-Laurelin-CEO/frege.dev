import { z } from "zod";
import { authenticateFregeActor, telemetryActorForFregeActor, type FregeActorContext } from "@/lib/core/actor-auth";
import { appendSessionEvent } from "@/lib/core/brain";
import { buildContextPacket, getContextPacketById, type ContextPacket } from "@/lib/core/context-gateway";
import { invokeModel } from "@/lib/core/model-gateway";
import { assertSafeOrigin, readJson, routeError } from "@/lib/core/request-guards";
import { logTelemetryEvent } from "@/lib/core/telemetry";
import { hostedExecutionDisabledResponse, hostedExecutionEnabled } from "@/lib/core/hosted-execution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const modelInvokeSchema = z.object({
  org_slug: z.string().min(1).optional(),
  model_config_slug: z.string().min(1),
  prompt: z.string().trim().min(1).max(20000),
  context_build_id: z.string().uuid().optional(),
  session_id: z.string().uuid().optional(),
  query: z.string().trim().max(1000).optional(),
  slug: z.string().trim().min(1).max(160).optional(),
  limit: z.number().int().min(1).max(25).default(8),
  max_tokens: z.number().int().min(1).max(4096).default(800),
});

function modelErrorStatus(error: Error): number {
  if (error.message === "model_config_not_found") return 404;
  if (error.message === "model_trust_zone_forbidden") return 403;
  if (error.message === "model_api_key_missing") return 400;
  if (error.message === "model_base_url_missing") return 400;
  if (error.message.startsWith("model_provider_error_")) return 502;
  return 500;
}

async function contextForInvoke(
  actor: FregeActorContext,
  input: z.infer<typeof modelInvokeSchema>,
): Promise<ContextPacket | null> {
  if (input.context_build_id) {
    return getContextPacketById(actor, input.context_build_id);
  }
  if (input.query || input.slug) {
    return buildContextPacket(actor, {
      query: input.query ?? "",
      slug: input.slug,
      limit: input.limit,
      session_id: input.session_id,
    });
  }
  return null;
}

export async function POST(req: Request) {
  const originError = assertSafeOrigin(req);
  if (originError) return originError;
  if (!hostedExecutionEnabled()) return hostedExecutionDisabledResponse();

  const startedAt = Date.now();
  let actorResult: Awaited<ReturnType<typeof authenticateFregeActor>> | null = null;
  let contextPacket: ContextPacket | null = null;
  try {
    const json = await readJson(req);
    if (!json.ok) return json.response;

    const parsed = modelInvokeSchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    actorResult = await authenticateFregeActor(req, parsed.data.org_slug);
    if (!actorResult.ok) return actorResult.response;

    contextPacket = await contextForInvoke(actorResult.actor, parsed.data);
    if (parsed.data.context_build_id && !contextPacket) {
      return Response.json({ error: "context_build_not_found" }, { status: 404 });
    }
    if (!parsed.data.context_build_id && contextPacket) {
      await logTelemetryEvent({
        actor: telemetryActorForFregeActor(actorResult.actor),
        req,
        action: "context.build",
        resourceType: "context_build",
        resourceId: contextPacket.id,
        contextBuildId: contextPacket.id,
        sessionId: parsed.data.session_id,
        outcome: "success",
        latencyMs: Date.now() - startedAt,
        inputTokens: contextPacket.token_estimate,
        trustZone: contextPacket.trust_zone,
        metadata: {
          invoked_inline: true,
          query_chars: contextPacket.query.length,
          source_slug: contextPacket.source_slug,
          document_count: contextPacket.documents.length,
          brain_page_count: contextPacket.brain_pages.length,
          denied_count: contextPacket.denied_count,
        },
      });
      if (contextPacket.denied_count > 0) {
        await logTelemetryEvent({
          actor: telemetryActorForFregeActor(actorResult.actor),
          req,
          action: "context.denied",
          resourceType: "context_build",
          resourceId: contextPacket.id,
          contextBuildId: contextPacket.id,
          sessionId: parsed.data.session_id,
          outcome: "denied",
          latencyMs: Date.now() - startedAt,
          trustZone: contextPacket.trust_zone,
          metadata: { invoked_inline: true, denied_count: contextPacket.denied_count },
        });
      }
    }

    const result = await invokeModel({
      orgId: actorResult.actor.organization.id,
      modelConfigSlug: parsed.data.model_config_slug,
      prompt: parsed.data.prompt,
      contextPacket: contextPacket ?? undefined,
      contextBuildId: contextPacket?.id ?? parsed.data.context_build_id,
      maxTokens: parsed.data.max_tokens,
    });

    await logTelemetryEvent({
      actor: telemetryActorForFregeActor(actorResult.actor),
      req,
      action: "model.invoke",
      resourceType: "model_config",
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      provider: result.provider,
      model: result.model,
      inputTokens: result.input_tokens,
      outputTokens: result.output_tokens,
      estimatedCostUsd: result.estimated_cost_usd ?? undefined,
      trustZone: result.trust_zone,
      sessionId: parsed.data.session_id,
      contextBuildId: contextPacket?.id ?? parsed.data.context_build_id,
      metadata: {
        model_config_slug: parsed.data.model_config_slug,
        context_build_id: contextPacket?.id ?? null,
        prompt_chars: parsed.data.prompt.length,
      },
    });

    if (parsed.data.session_id) {
      const event = await appendSessionEvent(actorResult.actor, {
        session_id: parsed.data.session_id,
        event_type: "model_invoke",
        body_md: `Model invoke ${parsed.data.model_config_slug}: ${result.content.slice(0, 2000)}`,
        payload: {
          model_config_slug: parsed.data.model_config_slug,
          provider: result.provider,
          model: result.model,
          context_build_id: contextPacket?.id ?? parsed.data.context_build_id ?? null,
          input_tokens: result.input_tokens,
          output_tokens: result.output_tokens,
          estimated_cost_usd: result.estimated_cost_usd,
        },
        trust_zone: result.trust_zone,
      });
      await logTelemetryEvent({
        actor: telemetryActorForFregeActor(actorResult.actor),
        req,
        action: "sessions.events.append",
        resourceType: "brain_session_event",
        resourceId: event.id,
        sessionId: parsed.data.session_id,
        sessionEventId: event.id,
        contextBuildId: contextPacket?.id ?? parsed.data.context_build_id,
        outcome: "success",
        latencyMs: Date.now() - startedAt,
        trustZone: result.trust_zone,
        metadata: { event_type: "model_invoke" },
      });
    }

    return Response.json(
      {
        result,
        context: contextPacket
          ? {
              id: contextPacket.id,
              trust_zone: contextPacket.trust_zone,
              token_estimate: contextPacket.token_estimate,
              denied_count: contextPacket.denied_count,
              document_count: contextPacket.documents.length,
              brain_page_count: contextPacket.brain_pages.length,
            }
          : null,
      },
      { status: 200 },
    );
  } catch (err) {
    const error = err as Error;
    if (actorResult?.ok) {
      await logTelemetryEvent({
        actor: telemetryActorForFregeActor(actorResult.actor),
        req,
        action: "model.invoke",
        resourceType: "model_config",
        outcome: error.message === "model_trust_zone_forbidden" ? "denied" : "failure",
        latencyMs: Date.now() - startedAt,
        trustZone: contextPacket?.trust_zone,
        metadata: { error: error.message },
      });
    }

    const status = modelErrorStatus(error);
    if (status !== 500) return Response.json({ error: error.message }, { status });
    return routeError("model invoke failed", err);
  }
}
