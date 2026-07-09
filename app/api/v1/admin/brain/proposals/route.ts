import { authenticateAdminRequest } from "@/lib/core/admin-auth";
import { listMemoryProposalsForAdmin } from "@/lib/core/brain";
import { routeError } from "@/lib/core/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const authResult = await authenticateAdminRequest(req);
    if (!authResult.ok) return authResult.response;
    const url = new URL(req.url);
    const status = url.searchParams.get("status") as "pending" | "accepted" | "rejected" | null;
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50), 1), 100);
    const proposals = await listMemoryProposalsForAdmin(authResult.auth, { status: status ?? undefined, limit });
    return Response.json({ proposals }, { status: 200 });
  } catch (err) {
    return routeError("admin memory proposals list failed", err);
  }
}
