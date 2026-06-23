import { authenticatePlatformStaff } from "@/lib/prototype/platform-auth";
import { routeError } from "@/lib/prototype/request-guards";
import { platformUsageByOrg, platformUsageDailySeries } from "@/lib/prototype/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const staff = await authenticatePlatformStaff(req);
    if (!staff.ok) return staff.response;

    const url = new URL(req.url);
    const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? 30), 1), 365);

    const [orgs, series] = await Promise.all([
      platformUsageByOrg(days),
      platformUsageDailySeries(days),
    ]);
    return Response.json({ days, organizations: orgs, series }, { status: 200 });
  } catch (err) {
    return routeError("platform usage failed", err);
  }
}
