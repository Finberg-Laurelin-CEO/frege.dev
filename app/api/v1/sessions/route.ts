import { z } from "zod";
import { authenticateFregeActor, telemetryActorForFregeActor } from "@/lib/core/actor-auth";
import { searchBrainSessions, startBrainSession } from "@/lib/core/brain";
import { assertSafeOrigin, readJson, routeError } from "@/lib/core/request-guards";
import { logTelemetryEvent } from "@/lib/core/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const startSessionSchema = z.object({
  external_id: z.string().trim().max(240).optional(),
  client: z.string().trim().max(120).default("unknown"),
  title: z.string().trim().max(240).optional(),
  goal: z.string().max(4000).optional(),
  trust_zone: z.enum(["green", "red"]).default("green"),
  metadata: z.record(z.unknown()).default({}),
});

export async function GET(req: Request) {
  const startedAt = Date.now();
  const actorResult = await authenticateFregeActor(req);
  if (!actorResult.ok) return actorResult.response;

  try {
    const url = new URL(req.url);
    const query = url.searchParams.get("q") ?? url.searchParams.get("query") ?? "";
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 20), 1), 50);
    const sessions = await searchBrainSessions(actorResult.actor, { query, limit });
    await logTelemetryEvent({
      actor: telemetryActorForFregeActor(actorResult.actor),
      req,
      action: "sessions.search",
      resourceType: "brain_session",
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { query_chars: query.length, result_count: sessions.length },
    });
    return Response.json({ sessions }, { status: 200 });
  } catch (err) {
    const message = (err as Error)?.message;
    if (message === "session_read_forbidden") return Response.json({ error: message }, { status: 403 });
    return routeError("session search failed", err);
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
    const parsed = startSessionSchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const session = await startBrainSession(actorResult.actor, parsed.data);
    await logTelemetryEvent({
      actor: telemetryActorForFregeActor(actorResult.actor),
      req,
      action: "sessions.start",
      resourceType: "brain_session",
      resourceId: session.id,
      sessionId: session.id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      trustZone: session.trust_zone,
      metadata: { client: session.client, external_id: session.external_id },
    });
    return Response.json({ session }, { status: 201 });
  } catch (err) {
    const message = (err as Error)?.message;
    const denied = message === "session_write_forbidden" || message === "trust_zone_forbidden";
    await logTelemetryEvent({
      actor: telemetryActorForFregeActor(actorResult.actor),
      req,
      action: "sessions.start",
      resourceType: "brain_session",
      outcome: denied ? "denied" : "failure",
      latencyMs: Date.now() - startedAt,
      metadata: { error: message },
    });
    if (denied) return Response.json({ error: message }, { status: 403 });
    return routeError("session start failed", err);
  }
}
