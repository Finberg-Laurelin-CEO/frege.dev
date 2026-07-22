import { z } from "zod";
import { authenticateFregeActor } from "@/lib/core/actor-auth";
import { createMemoryProposal } from "@/lib/core/brain";
import { assertSafeBrowserMutation, readJson, routeError } from "@/lib/core/request-guards";
import { SKILLS_COMPILER_ENABLED } from "@/lib/core/skills";
import type { TrustZone } from "@/lib/core/types";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ slug: string }> };

const rollbackSchema = z.object({ revision_number: z.number().int().positive() }).strict();

export async function POST(req: Request, context: RouteContext) {
  if (!SKILLS_COMPILER_ENABLED()) return Response.json({ error: "not_found" }, { status: 404 });
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  try {
    const actorResult = await authenticateFregeActor(req, {
      orgSlug: new URL(req.url).searchParams.get("org_slug") ?? undefined,
    });
    if (!actorResult.ok) return actorResult.response;
    if (actorResult.actor.actorType !== "user" || !actorResult.actor.capabilities.canReviewMemoryProposals) {
      return Response.json({ error: "memory_review_forbidden" }, { status: 403 });
    }

    const json = await readJson(req);
    if (!json.ok) return json.response;
    const input = rollbackSchema.safeParse(json.value);
    if (!input.success) {
      return Response.json({ error: "validation", fieldErrors: input.error.flatten().fieldErrors }, { status: 400 });
    }

    const { slug } = await context.params;
    const sql = getSql();
    const rows = await sql`
      select
        brain_pages.id,
        brain_pages.slug,
        brain_pages.title,
        brain_pages.source_id,
        brain_pages.trust_zone,
        brain_pages.frontmatter,
        current_revision.revision_number as from_revision,
        target_revision.revision_number as to_revision,
        target_revision.body_md,
        target_revision.summary
      from brain_pages
      join lateral (
        select revision_number
        from brain_page_revisions
        where page_id = brain_pages.id
        order by revision_number desc
        limit 1
      ) current_revision on true
      join brain_page_revisions target_revision
        on target_revision.page_id = brain_pages.id
       and target_revision.revision_number = ${input.data.revision_number}
      where brain_pages.org_id = ${actorResult.actor.organization.id}
        and brain_pages.slug = ${slug}
        and brain_pages.artifact_type = 'skill'
        and brain_pages.status = 'published'
        and brain_pages.invalidated_at is null
      limit 1
    `;
    const skill = rows[0] as {
      id: string;
      slug: string;
      title: string;
      source_id: string | null;
      trust_zone: TrustZone;
      frontmatter: Record<string, unknown>;
      from_revision: number;
      to_revision: number;
      body_md: string;
      summary: string;
    } | undefined;
    if (!skill) return Response.json({ error: "not_found" }, { status: 404 });
    if (skill.to_revision >= skill.from_revision) {
      return Response.json({ error: "rollback_revision_must_be_older" }, { status: 400 });
    }

    const proposal = await createMemoryProposal(actorResult.actor, {
      proposal_type: "skill_update",
      slug: skill.slug,
      title: skill.title,
      body_md: skill.body_md,
      summary: skill.summary,
      trust_zone: skill.trust_zone,
      source_ids: skill.source_id ? [skill.source_id] : [],
      metadata: {
        ...skill.frontmatter,
        correction_action: "rollback",
        from_revision: skill.from_revision,
        to_revision: skill.to_revision,
      },
    });

    return Response.json({
      result: "proposal_filed",
      proposal_id: proposal.id,
      from_revision: skill.from_revision,
      to_revision: skill.to_revision,
    }, { status: 201 });
  } catch (err) {
    return routeError("skill rollback proposal failed", err);
  }
}
