import { z } from "zod";
import { getSql } from "@/lib/db";
import { authenticateAdminRequest } from "@/lib/core/admin-auth";
import { resolveMemoryProposal } from "@/lib/core/brain";
import { assertActiveHumanOrg } from "@/lib/core/org-guard";
import { assertSafeBrowserMutation, readJson, routeError } from "@/lib/core/request-guards";
import { logTelemetryEvent } from "@/lib/core/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const resolveSchema = z.object({
  action: z.enum(["accept", "reject"]),
  body_md: z.string().trim().min(1).max(100_000).optional(),
  reason: z.string().trim().min(1).max(2_000).optional(),
});

export async function PATCH(req: Request, context: RouteContext) {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  const startedAt = Date.now();
  try {
    const authResult = await authenticateAdminRequest(req);
    if (!authResult.ok) return authResult.response;
    const inactive = assertActiveHumanOrg(authResult.auth);
    if (inactive) return inactive;
    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = resolveSchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const { id } = await context.params;
    if (parsed.data.body_md !== undefined || parsed.data.reason !== undefined) {
      if (!authResult.auth.capabilities.canReviewMemoryProposals) {
        return Response.json({ error: "memory_review_forbidden" }, { status: 403 });
      }
      const sql = getSql();
      const [updated] = await sql`
        update memory_proposals
        set
          body_md = coalesce(${parsed.data.body_md ?? null}, body_md),
          metadata = case
            when ${parsed.data.reason ?? null}::text is null then metadata
            else jsonb_set(metadata, '{review_reason}', to_jsonb(${parsed.data.reason ?? null}::text), true)
          end
        where id = ${id}
          and org_id = ${authResult.auth.organization.id}
          and status = 'pending'
          and proposal_type in ('skill_create', 'skill_update')
        returning id
      `;
      if (!updated) return Response.json({ error: "memory_proposal_not_found" }, { status: 404 });
    }
    const result = await resolveMemoryProposal(authResult.auth, { proposalId: id, action: parsed.data.action });
    await logTelemetryEvent({
      actor: { type: "user", auth: authResult.auth },
      req,
      action: `admin.memory_proposals.${parsed.data.action}`,
      resourceType: "memory_proposal",
      resourceId: result.proposal.id,
      proposalId: result.proposal.id,
      sessionId: result.proposal.session_id ?? undefined,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      trustZone: result.proposal.trust_zone,
      metadata: { proposal_type: result.proposal.proposal_type, slug: result.proposal.slug },
    });
    return Response.json(result, { status: 200 });
  } catch (err) {
    const message = (err as Error)?.message;
    if (
      message === "memory_review_forbidden" ||
      message === "memory_proposal_not_found" ||
      message === "memory_proposal_resolved"
    ) {
      return Response.json({ error: message }, { status: message === "memory_review_forbidden" ? 403 : 404 });
    }
    return routeError("memory proposal resolve failed", err);
  }
}
