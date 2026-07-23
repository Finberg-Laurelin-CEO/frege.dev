import { z } from "zod";
import { authenticateFregeActor } from "@/lib/core/actor-auth";
import { assertSafeOrigin, readJson, routeError } from "@/lib/core/request-guards";
import {
  LIVE_RUN_ROOMS_ENABLED,
  ackDirective,
  getLiveSessionRow,
  liveRunRoomsNotFound,
  markBridgeSeen,
} from "@/lib/core/run-rooms";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; directiveId: string }>;
};

const ackSchema = z.object({
  result: z.record(z.unknown()).default({}),
});

// Bridge acknowledges a delivered directive with its outcome. Acking is
// once-only: a second ack of the same directive is a 409, an unknown one 404.
export async function POST(req: Request, context: RouteContext) {
  if (!LIVE_RUN_ROOMS_ENABLED()) return liveRunRoomsNotFound();

  const originError = assertSafeOrigin(req);
  if (originError) return originError;

  const actorResult = await authenticateFregeActor(req);
  if (!actorResult.ok) return actorResult.response;
  if (actorResult.actor.actorType !== "api_key") return liveRunRoomsNotFound();

  try {
    const { id, directiveId } = await context.params;
    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = ackSchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const sql = getSql();
    const session = await getLiveSessionRow(sql, id);
    if (!session || session.org_id !== actorResult.actor.organization.id) return liveRunRoomsNotFound();

    const directive = await ackDirective(sql, directiveId, id, session.org_id, parsed.data.result);
    if (!directive) {
      const existing = (await sql`
        select id
        from brain_session_directives
        where id = ${directiveId}
          and session_id = ${id}
          and org_id = ${session.org_id}
        limit 1
      `) as Array<{ id: string }>;
      if (existing.length > 0) return Response.json({ error: "already_acked" }, { status: 409 });
      return liveRunRoomsNotFound();
    }

    await markBridgeSeen(sql, id, session.org_id);
    return Response.json({ directive }, { status: 200 });
  } catch (err) {
    return routeError("live directive ack failed", err);
  }
}
