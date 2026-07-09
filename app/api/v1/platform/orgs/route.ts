import { getSql } from "@/lib/db";
import { authenticatePlatformStaff } from "@/lib/core/platform-auth";
import { routeError } from "@/lib/core/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const staff = await authenticatePlatformStaff(req);
    if (!staff.ok) return staff.response;

    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
    const statusFilter = url.searchParams.get("status")?.trim() ?? "";

    const sql = getSql();
    const orgs = await sql`
      select
        o.id,
        o.slug,
        o.name,
        o.status,
        o.created_at,
        o.activated_at,
        o.suspended_at,
        b.plan,
        b.billing_interval,
        b.seats,
        b.subscription_status,
        b.current_period_end,
        (select count(*)::int from organization_memberships m where m.org_id = o.id) as member_count,
        (select count(*)::int from api_keys k where k.org_id = o.id and k.status = 'active') as active_keys
      from organizations o
      left join org_billing b on b.org_id = o.id
      where (${q} = '' or lower(o.slug) like ${"%" + q + "%"} or lower(o.name) like ${"%" + q + "%"})
        and (${statusFilter} = '' or o.status = ${statusFilter})
      order by o.created_at desc
      limit 200
    `;

    return Response.json({ organizations: orgs }, { status: 200 });
  } catch (err) {
    return routeError("platform orgs list failed", err);
  }
}
