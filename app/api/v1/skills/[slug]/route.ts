import { getSql } from "@/lib/db";
import { authenticateAdminRequest } from "@/lib/core/admin-auth";
import { authenticateFregeActor, telemetryActorForFregeActor } from "@/lib/core/actor-auth";
import { routeError } from "@/lib/core/request-guards";
import {
  ADMIN_SKILLS_EXPORT,
  SKILLS_COMPILER_ENABLED,
  SKILL_RETRIEVED,
} from "@/lib/core/skills";
import { logTelemetryEvent } from "@/lib/core/telemetry";
import { trustZonesForActor, type TrustZone } from "@/lib/core/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ slug: string }>;
};

type SkillRow = {
  id: string;
  slug: string;
  title: string;
  body_md: string;
  citations: unknown[];
  frontmatter: Record<string, unknown>;
  valid_from: Date | string | null;
  stale: boolean;
  stale_reason: string | null;
  trust_zone: TrustZone;
};

function citationText(citation: unknown): string | null {
  if (typeof citation === "string") return citation;
  if (!citation || typeof citation !== "object") return null;
  const value = citation as Record<string, unknown>;
  const ref = typeof value.ref === "string" ? value.ref : null;
  if (!ref) return null;
  return typeof value.label === "string" && value.label !== ref ? `${value.label} — ${ref}` : ref;
}

// WT-A owns the final shared renderer. Keep this local until the integration merge.
function renderSkillMdForServing(row: SkillRow): string {
  const description =
    typeof row.frontmatter?.description === "string" ? row.frontmatter.description : row.title;
  const citations = (Array.isArray(row.citations) ? row.citations : [])
    .map(citationText)
    .filter((citation): citation is string => Boolean(citation))
    .map((citation, index) => `[^${index + 1}]: ${citation}`);

  return [
    "---",
    `name: ${JSON.stringify(row.slug)}`,
    `description: ${JSON.stringify(description)}`,
    "---",
    "",
    row.body_md.trim(),
    ...(citations.length ? ["", ...citations] : []),
    "",
  ].join("\n");
}

function publicSkill(row: SkillRow) {
  return {
    slug: row.slug,
    title: row.title,
    body_md: row.body_md,
    citations: row.citations,
    valid_from: row.valid_from,
    stale: row.stale,
    stale_reason: row.stale_reason,
  };
}

export async function GET(req: Request, context: RouteContext) {
  if (!SKILLS_COMPILER_ENABLED()) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const startedAt = Date.now();
  const { slug } = await context.params;
  const url = new URL(req.url);

  try {
    if (url.searchParams.get("format") === "skillmd") {
      const adminResult = await authenticateAdminRequest(req);
      if (!adminResult.ok) return adminResult.response;
      const sql = getSql();
      const rows = (await sql`
        select
          brain_pages.id,
          brain_pages.slug,
          brain_pages.title,
          brain_pages.frontmatter,
          brain_pages.valid_from,
          brain_pages.stale_flagged_at is not null as stale,
          brain_pages.stale_reason,
          brain_pages.trust_zone,
          latest.body_md,
          coalesce(brain_pages.frontmatter -> 'citations', '[]'::jsonb) as citations
        from brain_pages
        join lateral (
          select body_md
          from brain_page_revisions
          where page_id = brain_pages.id
          order by revision_number desc
          limit 1
        ) latest on true
        where brain_pages.org_id = ${adminResult.auth.organization.id}
          and brain_pages.slug = ${slug}
          and brain_pages.artifact_type = 'skill'
          and brain_pages.status = 'published'
          and brain_pages.invalidated_at is null
        limit 1
      `) as SkillRow[];
      const skill = rows[0];
      if (!skill) return Response.json({ error: "not_found" }, { status: 404 });

      await logTelemetryEvent({
        actor: { type: "user", auth: adminResult.auth },
        req,
        action: ADMIN_SKILLS_EXPORT,
        resourceType: "skill",
        resourceId: skill.id,
        outcome: "success",
        latencyMs: Date.now() - startedAt,
        trustZone: skill.trust_zone,
        metadata: { slug: skill.slug },
      });
      return new Response(renderSkillMdForServing(skill), {
        status: 200,
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
      });
    }

    const actorResult = await authenticateFregeActor(req, { allowInactiveUser: true });
    if (!actorResult.ok) return actorResult.response;
    const sql = getSql();
    const rows = (await sql`
      select
        brain_pages.id,
        brain_pages.slug,
        brain_pages.title,
        brain_pages.frontmatter,
        brain_pages.valid_from,
        brain_pages.stale_flagged_at is not null as stale,
        brain_pages.stale_reason,
        brain_pages.trust_zone,
        latest.body_md,
        coalesce(brain_pages.frontmatter -> 'citations', '[]'::jsonb) as citations
      from brain_pages
      join lateral (
        select body_md
        from brain_page_revisions
        where page_id = brain_pages.id
        order by revision_number desc
        limit 1
      ) latest on true
      where brain_pages.org_id = ${actorResult.actor.organization.id}
        and brain_pages.slug = ${slug}
        and brain_pages.artifact_type = 'skill'
        and brain_pages.status = 'published'
        and brain_pages.invalidated_at is null
        and brain_pages.trust_zone = any(${trustZonesForActor(actorResult.actor)}::text[])
      limit 1
    `) as SkillRow[];
    const skill = rows[0];
    if (!skill) return Response.json({ error: "not_found" }, { status: 404 });

    await logTelemetryEvent({
      actor: telemetryActorForFregeActor(actorResult.actor),
      req,
      action: SKILL_RETRIEVED,
      resourceType: "skill",
      resourceId: skill.id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      trustZone: skill.trust_zone,
      metadata: { slug: skill.slug },
    });
    return Response.json({ skill: publicSkill(skill) }, { status: 200 });
  } catch (err) {
    return routeError("skill read failed", err);
  }
}
