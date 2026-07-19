import { z } from "zod";
import { authenticateAdminRequest } from "@/lib/core/admin-auth";
import { routeError } from "@/lib/core/request-guards";
import { IDENTIFIER_PATTERN } from "@/lib/v2/contracts";
import { listUnifiedProvenanceEvents } from "@/lib/v2/control-plane";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  source: z.enum(["v2", "v1_telemetry", "v1_audit"]).optional(),
  action: z.string().max(128).regex(IDENTIFIER_PATTERN).optional(),
  outcome: z.enum(["success", "failure", "allow", "deny"]).optional(),
  correlation_id: z.string().max(200).optional(),
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function GET(req: Request) {
  try {
    const authResult = await authenticateAdminRequest(req);
    if (!authResult.ok) return authResult.response;

    const url = new URL(req.url);
    const parsed = querySchema.safeParse({
      source: url.searchParams.get("source") || undefined,
      action: url.searchParams.get("action") || undefined,
      outcome: url.searchParams.get("outcome") || undefined,
      correlation_id: url.searchParams.get("correlation_id") || undefined,
      before: url.searchParams.get("before") || undefined,
      limit: url.searchParams.get("limit") || undefined,
    });
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const events = await listUnifiedProvenanceEvents(authResult.auth.organization.id, {
      source: parsed.data.source,
      action: parsed.data.action,
      outcome: parsed.data.outcome,
      correlationId: parsed.data.correlation_id,
      before: parsed.data.before,
      limit: parsed.data.limit,
    });
    return Response.json({ provenance_events: events }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return routeError("v2 provenance event list failed", err);
  }
}
