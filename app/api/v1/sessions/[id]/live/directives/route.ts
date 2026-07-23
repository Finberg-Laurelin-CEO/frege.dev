import { authenticateFregeActor } from "@/lib/core/actor-auth";
import { routeError } from "@/lib/core/request-guards";
import {
  LIVE_RUN_ROOMS_ENABLED,
  getLiveSessionRow,
  liveRunRoomsNotFound,
  markBridgeSeen,
  takeUndeliveredDirectives,
} from "@/lib/core/run-rooms";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

// Bridge directive inbox (short-poll ~1.5s). Returning a directive marks it
// delivered; the poll itself refreshes bridge_last_seen_at, which is the
// liveness signal watchers rely on.
export async function GET(req: Request, context: RouteContext) {
  if (!LIVE_RUN_ROOMS_ENABLED()) return liveRunRoomsNotFound();

  const actorResult = await authenticateFregeActor(req);
  if (!actorResult.ok) return actorResult.response;
  if (actorResult.actor.actorType !== "api_key") return liveRunRoomsNotFound();

  try {
    const { id } = await context.params;
    const sql = getSql();
    const session = await getLiveSessionRow(sql, id);
    if (!session || session.org_id !== actorResult.actor.organization.id) return liveRunRoomsNotFound();

    const directives = await takeUndeliveredDirectives(sql, id, session.org_id);
    await markBridgeSeen(sql, id, session.org_id);

    return Response.json({ directives }, { status: 200 });
  } catch (err) {
    return routeError("live directives poll failed", err);
  }
}
