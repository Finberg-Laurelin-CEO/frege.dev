import { getSql } from "@/lib/db";
import { authenticatePlatformStaff } from "@/lib/prototype/platform-auth";
import { routeError } from "@/lib/prototype/request-guards";
import { orgUsageTotals, orgUsageByUser } from "@/lib/prototype/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const staff = await authenticatePlatformStaff(req);
    if (!staff.ok) return staff.response;

    const { id } = await params;
    const sql = getSql();

    const [org] = await sql`
      select
        o.id, o.slug, o.name, o.status, o.created_at, o.activated_at, o.suspended_at,
        b.plan, b.billing_interval, b.seats, b.stripe_customer_id, b.stripe_subscription_id,
        b.subscription_status, b.current_period_end
      from organizations o
      left join org_billing b on b.org_id = o.id
      where o.id = ${id}
      limit 1
    `;
    if (!org) return Response.json({ error: "not_found" }, { status: 404 });

    const members = await sql`
      select
        u.id as user_id, u.email, u.name, u.status as user_status, u.is_platform_staff,
        m.role, m.status as membership_status, m.created_at
      from organization_memberships m
      join users u on u.id = m.user_id
      where m.org_id = ${id}
      order by m.role asc, u.email asc
    `;

    const totals = await orgUsageTotals(id, 30);
    const byUser = await orgUsageByUser(id, 30);

    return Response.json({ organization: org, members, usage: { totals, by_user: byUser } }, { status: 200 });
  } catch (err) {
    return routeError("platform org detail failed", err);
  }
}
