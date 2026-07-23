import { authenticateFregeActor } from "@/lib/core/actor-auth";
import { appendSessionEvent } from "@/lib/core/brain";
import { getSql } from "@/lib/db";
import { assertSafeOrigin, readJson, routeError } from "@/lib/core/request-guards";
import {
  LIVE_RUN_ROOMS_ENABLED,
  LiveEventBatchSchema,
  liveRunRoomsNotFound,
  markBridgeSeen,
} from "@/lib/core/run-rooms";
import type { BrainSessionEventType } from "@/lib/core/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

// Bridge ingest: Codex events, already mapped to the stable run.live.* kinds,
// land in the governed session ledger. Agent-key auth only; the actor's org
// must own the session (appendSessionEvent enforces that scoping).
export async function POST(req: Request, context: RouteContext) {
  if (!LIVE_RUN_ROOMS_ENABLED()) return liveRunRoomsNotFound();

  const originError = assertSafeOrigin(req);
  if (originError) return originError;

  const actorResult = await authenticateFregeActor(req);
  if (!actorResult.ok) return actorResult.response;
  if (actorResult.actor.actorType !== "api_key") return liveRunRoomsNotFound();

  try {
    const { id } = await context.params;
    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = LiveEventBatchSchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    for (const item of parsed.data) {
      await appendSessionEvent(actorResult.actor, {
        session_id: id,
        event_type: item.kind as BrainSessionEventType,
        body_md: typeof item.payload.text === "string" ? item.payload.text : "",
        payload: { ...item.payload, occurred_at: item.occurred_at },
      });
    }

    const ended = parsed.data.some((item) => item.kind === "run.live.ended");
    await markBridgeSeen(getSql(), id, actorResult.actor.organization.id, ended ? "ended" : "live");

    return Response.json({ appended: parsed.data.length }, { status: 202 });
  } catch (err) {
    const message = (err as Error)?.message;
    if (message === "session_not_found") return liveRunRoomsNotFound();
    if (message === "session_write_forbidden" || message === "trust_zone_forbidden") {
      return Response.json({ error: message }, { status: 403 });
    }
    return routeError("live events append failed", err);
  }
}
