import { z } from "zod";
import { authenticateFregeActor, telemetryActorForFregeActor } from "@/lib/prototype/actor-auth";
import { createMemoryProposal } from "@/lib/prototype/brain";
import { assertSafeOrigin, readJson, routeError } from "@/lib/prototype/request-guards";
import { logTelemetryEvent } from "@/lib/prototype/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const proposalSchema = z.object({
  proposal_type: z.enum(["page_create", "page_update", "source_create", "link_update"]).default("page_create"),
  slug: z.string().trim().min(1).max(160).optional(),
  title: z.string().trim().max(180).optional(),
  body_md: z.string().max(100000).optional(),
  summary: z.string().max(2000).optional(),
  trust_zone: z.enum(["green", "red"]).default("green"),
  source_ids: z.array(z.string().uuid()).default([]),
  session_id: z.string().uuid().optional(),
  evidence_event_ids: z.array(z.string().uuid()).default([]),
  metadata: z.record(z.unknown()).default({}),
});

export async function POST(req: Request) {
  const originError = assertSafeOrigin(req);
  if (originError) return originError;

  const startedAt = Date.now();
  const actorResult = await authenticateFregeActor(req);
  if (!actorResult.ok) return actorResult.response;

  try {
    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = proposalSchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const proposal = await createMemoryProposal(actorResult.actor, parsed.data);
    await logTelemetryEvent({
      actor: telemetryActorForFregeActor(actorResult.actor),
      req,
      action: "brain.memory.propose",
      resourceType: "memory_proposal",
      resourceId: proposal.id,
      proposalId: proposal.id,
      sessionId: proposal.session_id ?? undefined,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      trustZone: proposal.trust_zone,
      metadata: {
        proposal_type: proposal.proposal_type,
        slug: proposal.slug,
        body_chars: parsed.data.body_md?.length ?? 0,
      },
    });
    return Response.json({ proposal }, { status: 201 });
  } catch (err) {
    const message = (err as Error)?.message;
    const denied = message === "memory_proposal_forbidden" || message === "trust_zone_forbidden";
    await logTelemetryEvent({
      actor: telemetryActorForFregeActor(actorResult.actor),
      req,
      action: "brain.memory.propose",
      resourceType: "memory_proposal",
      outcome: denied ? "denied" : "failure",
      latencyMs: Date.now() - startedAt,
      metadata: { error: message },
    });
    if (denied) return Response.json({ error: message }, { status: 403 });
    if (message === "brain_page_not_found") return Response.json({ error: message }, { status: 404 });
    return routeError("memory proposal failed", err);
  }
}
