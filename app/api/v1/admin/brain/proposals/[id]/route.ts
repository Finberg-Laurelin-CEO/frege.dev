import { z } from "zod";
import { authenticateAdminRequest } from "@/lib/prototype/admin-auth";
import { resolveMemoryProposal } from "@/lib/prototype/brain";
import { assertSafeOrigin, readJson, routeError } from "@/lib/prototype/request-guards";
import { logTelemetryEvent } from "@/lib/prototype/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const resolveSchema = z.object({
  action: z.enum(["accept", "reject"]),
});

export async function PATCH(req: Request, context: RouteContext) {
  const originError = assertSafeOrigin(req);
  if (originError) return originError;

  const startedAt = Date.now();
  try {
    const authResult = await authenticateAdminRequest(req);
    if (!authResult.ok) return authResult.response;
    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = resolveSchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const { id } = await context.params;
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
