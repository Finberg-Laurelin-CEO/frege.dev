import { getSql } from "@/lib/db";
import { authenticateFregeActor } from "@/lib/core/actor-auth";
import { routeError } from "@/lib/core/request-guards";
import { SKILLS_COMPILER_ENABLED } from "@/lib/core/skills";
import { trustZonesForActor } from "@/lib/core/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SkillListRow = {
  slug: string;
  title: string;
  valid_from: Date | string | null;
  stale: boolean;
  stale_reason: string | null;
};

export async function GET(req: Request) {
  if (!SKILLS_COMPILER_ENABLED()) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const actorResult = await authenticateFregeActor(req, {
    orgSlug: new URL(req.url).searchParams.get("org_slug") ?? undefined,
    allowInactiveUser: true,
  });
  if (!actorResult.ok) return actorResult.response;

  try {
    const sql = getSql();
    const skills = (await sql`
      select
        slug,
        title,
        valid_from,
        stale_flagged_at is not null as stale,
        stale_reason
      from brain_pages
      where org_id = ${actorResult.actor.organization.id}
        and artifact_type = 'skill'
        and status = 'published'
        and invalidated_at is null
        and trust_zone = any(${trustZonesForActor(actorResult.actor)}::text[])
      order by updated_at desc, slug asc
    `) as SkillListRow[];

    return Response.json({ skills }, { status: 200 });
  } catch (err) {
    return routeError("skills list failed", err);
  }
}
