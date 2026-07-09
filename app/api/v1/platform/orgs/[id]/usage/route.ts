import { authenticatePlatformStaff } from "@/lib/core/platform-auth";
import { routeError } from "@/lib/core/request-guards";
import { orgUsageByUser, orgUsageTotals } from "@/lib/core/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const staff = await authenticatePlatformStaff(req);
    if (!staff.ok) return staff.response;

    const { id } = await params;
    const url = new URL(req.url);
    const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? 30), 1), 365);

    const [totals, byUser] = await Promise.all([
      orgUsageTotals(id, days),
      orgUsageByUser(id, days),
    ]);

    return Response.json({ days, totals, users: byUser }, { status: 200 });
  } catch (err) {
    return routeError("platform org usage failed", err);
  }
}
