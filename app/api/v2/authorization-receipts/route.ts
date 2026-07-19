import { z } from "zod";
import { authenticateAdminRequest } from "@/lib/core/admin-auth";
import { routeError } from "@/lib/core/request-guards";
import { listAuthorizationReceipts } from "@/lib/v2/control-plane";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  decision: z.enum(["allow", "deny"]).optional(),
  principal_id: z.string().uuid().optional(),
  correlation_id: z.string().uuid().optional(),
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function GET(req: Request) {
  try {
    const authResult = await authenticateAdminRequest(req);
    if (!authResult.ok) return authResult.response;

    const url = new URL(req.url);
    const parsed = querySchema.safeParse({
      decision: url.searchParams.get("decision") || undefined,
      principal_id: url.searchParams.get("principal_id") || undefined,
      correlation_id: url.searchParams.get("correlation_id") || undefined,
      before: url.searchParams.get("before") || undefined,
      limit: url.searchParams.get("limit") || undefined,
    });
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const receipts = await listAuthorizationReceipts(authResult.auth.organization.id, {
      decision: parsed.data.decision,
      principalId: parsed.data.principal_id,
      correlationId: parsed.data.correlation_id,
      before: parsed.data.before,
      limit: parsed.data.limit,
    });
    return Response.json({ authorization_receipts: receipts }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return routeError("v2 authorization receipt list failed", err);
  }
}
