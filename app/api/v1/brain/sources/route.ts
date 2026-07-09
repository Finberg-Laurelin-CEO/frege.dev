import { z } from "zod";
import { authenticateFregeActor, telemetryActorForFregeActor } from "@/lib/core/actor-auth";
import { createMemoryProposal, listBrainSources } from "@/lib/core/brain";
import { assertSafeOrigin, readJson, routeError } from "@/lib/core/request-guards";
import { logTelemetryEvent } from "@/lib/core/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sourceProposalSchema = z.object({
  slug: z.string().trim().min(1).max(160),
  name: z.string().trim().min(1).max(180),
  trust_zone: z.enum(["green", "red"]).default("green"),
  metadata: z.record(z.unknown()).default({}),
  session_id: z.string().uuid().optional(),
});

export async function GET(req: Request) {
  const startedAt = Date.now();
  const actorResult = await authenticateFregeActor(req);
  if (!actorResult.ok) return actorResult.response;

  try {
    const limit = Math.min(Math.max(Number(new URL(req.url).searchParams.get("limit") ?? 50), 1), 100);
    const sources = await listBrainSources(actorResult.actor, limit);
    await logTelemetryEvent({
      actor: telemetryActorForFregeActor(actorResult.actor),
      req,
      action: "brain.sources.list",
      resourceType: "brain_source",
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { result_count: sources.length },
    });
    return Response.json({ sources }, { status: 200 });
  } catch (err) {
    return routeError("brain sources list failed", err);
  }
}

export async function POST(req: Request) {
  const originError = assertSafeOrigin(req);
  if (originError) return originError;

  const startedAt = Date.now();
  const actorResult = await authenticateFregeActor(req);
  if (!actorResult.ok) return actorResult.response;

  try {
    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = sourceProposalSchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const proposal = await createMemoryProposal(actorResult.actor, {
      proposal_type: "source_create",
      slug: parsed.data.slug,
      title: parsed.data.name,
      summary: `Create source ${parsed.data.slug}`,
      trust_zone: parsed.data.trust_zone,
      session_id: parsed.data.session_id,
      metadata: parsed.data.metadata,
    });
    await logTelemetryEvent({
      actor: telemetryActorForFregeActor(actorResult.actor),
      req,
      action: "brain.sources.propose",
      resourceType: "memory_proposal",
      resourceId: proposal.id,
      proposalId: proposal.id,
      sessionId: proposal.session_id ?? undefined,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      trustZone: proposal.trust_zone,
      metadata: { proposal_type: proposal.proposal_type, slug: proposal.slug },
    });
    return Response.json({ proposal }, { status: 201 });
  } catch (err) {
    const message = (err as Error)?.message;
    const denied = message === "memory_proposal_forbidden" || message === "trust_zone_forbidden";
    await logTelemetryEvent({
      actor: telemetryActorForFregeActor(actorResult.actor),
      req,
      action: "brain.sources.propose",
      resourceType: "memory_proposal",
      outcome: denied ? "denied" : "failure",
      latencyMs: Date.now() - startedAt,
      metadata: { error: message },
    });
    if (denied) return Response.json({ error: message }, { status: 403 });
    return routeError("brain source proposal failed", err);
  }
}
