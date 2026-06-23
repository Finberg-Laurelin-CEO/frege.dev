import { getSql } from "@/lib/db";
import { authenticatePlatformStaff } from "@/lib/prototype/platform-auth";
import { routeError } from "@/lib/prototype/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const staff = await authenticatePlatformStaff(req);
    if (!staff.ok) return staff.response;

    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";

    const sql = getSql();
    const users = await sql`
      select
        u.id, u.email, u.name, u.status, u.is_platform_staff, u.created_at, u.last_login_at,
        coalesce(
          json_agg(
            json_build_object('org_slug', o.slug, 'role', m.role, 'membership_status', m.status)
            order by o.slug
          ) filter (where o.id is not null),
          '[]'
        ) as memberships
      from users u
      left join organization_memberships m on m.user_id = u.id
      left join organizations o on o.id = m.org_id
      where (${q} = '' or lower(u.email) like ${"%" + q + "%"} or lower(coalesce(u.name, '')) like ${"%" + q + "%"})
      group by u.id
      order by u.created_at desc
      limit 200
    `;

    return Response.json({ users }, { status: 200 });
  } catch (err) {
    return routeError("platform users list failed", err);
  }
}
