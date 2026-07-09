import { authenticateAdminRequest } from "@/lib/core/admin-auth";
import { listAgentRunsForAdmin } from "@/lib/core/agent-runtime";
import { routeError } from "@/lib/core/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const authResult = await authenticateAdminRequest(req);
    if (!authResult.ok) return authResult.response;
    const limit = Math.min(Math.max(Number(new URL(req.url).searchParams.get("limit") ?? 50), 1), 100);
    const runs = await listAgentRunsForAdmin(authResult.auth, limit);
    return Response.json({ runs }, { status: 200 });
  } catch (err) {
    return routeError("admin agent runs list failed", err);
  }
}
