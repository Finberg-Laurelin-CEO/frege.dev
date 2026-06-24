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
    const signups = await sql`
      select
        s.id, s.created_at, s.name, s.work_email, s.company, s.role,
        s.company_size, s.expected_users, s.current_agent_tools, s.monthly_ai_spend,
        s.willing_to_pay, s.decision_timeline, s.main_pain_point, s.other_comments,
        s.status, s.contacted_at, s.qualified_at, s.notes, s.disqualified_reason,
        s.invited_at, s.invite_id, s.paid_at,
        owner.email as owner_user_email
      from signups s
      left join users owner on owner.id = s.owner_user_id
      order by s.created_at desc
      limit 200
    `;

    return Response.json({ signups }, { status: 200 });
  } catch (err) {
    return routeError("platform signups list failed", err);
  }
}
