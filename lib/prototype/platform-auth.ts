import { getSql } from "@/lib/db";
import { resolveAdminSsoStaff } from "@/lib/prototype/admin-sso";
import { authenticatePlatformStaffKey } from "@/lib/prototype/platform-staff-keys";
import { authenticateUserRequest, type UserSessionContext } from "@/lib/prototype/session";

export type PlatformStaffContext = {
  user: UserSessionContext["user"];
  session: UserSessionContext["session"];
};

export type PlatformAuthResult =
  | { ok: true; auth: PlatformStaffContext }
  | { ok: false; response: Response };

// Cross-org operator access. Requires a valid user session AND users.is_platform_staff = true.
// On the admin-only deploy, Vercel SSO is the single gate: adopt the designated
// platform-staff identity without requiring a second app session.
export async function authenticatePlatformStaff(req: Request): Promise<PlatformAuthResult> {
  const ssoStaff = await resolveAdminSsoStaff();
  if (ssoStaff) {
    return { ok: true, auth: { user: ssoStaff.user, session: ssoStaff.session } };
  }

  // Agentic admin access: a platform-staff API key bearer token authorizes its
  // owner directly, without a browser session.
  const keyStaff = await authenticatePlatformStaffKey(req);
  if (keyStaff) {
    return { ok: true, auth: { user: keyStaff.user, session: keyStaff.session } };
  }

  const session = await authenticateUserRequest(req);
  if (!session) {
    return { ok: false, response: Response.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const sql = getSql();
  const [row] = await sql`
    select is_platform_staff
    from users
    where id = ${session.user.id}
    limit 1
  `;

  if (!row || (row as { is_platform_staff: boolean }).is_platform_staff !== true) {
    return { ok: false, response: Response.json({ error: "forbidden" }, { status: 403 }) };
  }

  return {
    ok: true,
    auth: { user: session.user, session: session.session },
  };
}
