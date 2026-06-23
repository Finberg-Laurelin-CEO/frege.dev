import { getSql } from "@/lib/db";
import { authenticatePlatformStaff } from "@/lib/prototype/platform-auth";
import { routeError } from "@/lib/prototype/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const staff = await authenticatePlatformStaff(req);
    if (!staff.ok) return staff.response;

    const sql = getSql();
    const events = await sql`
      select id, actor_email, action, target_type, target_id, metadata, created_at
      from platform_audit_events
      order by created_at desc
      limit 100
    `;

    return Response.json({ events }, { status: 200 });
  } catch (err) {
    return routeError("platform audit list failed", err);
  }
}
