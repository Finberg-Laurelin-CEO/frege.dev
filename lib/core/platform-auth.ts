import { getSql } from "@/lib/db";
import { resolveAdminSsoStaff } from "@/lib/core/admin-sso";
import { resolveAuth0Staff } from "@/lib/core/auth0-staff";
import { recordPlatformAudit } from "@/lib/core/platform-audit";
import { authenticatePlatformStaffKey } from "@/lib/core/platform-staff-keys";
import { authenticateUserRequest, type UserSessionContext } from "@/lib/core/session";

export type PlatformStaffContext = {
  user: UserSessionContext["user"];
  session: UserSessionContext["session"];
};

export type PlatformAuthResult =
  | { ok: true; auth: PlatformStaffContext }
  | { ok: false; response: Response };

// Cross-org operator access. Requires a valid user session AND users.is_platform_staff = true.
// Credentialed paths (staff API key, Auth0 session, app session) are checked first;
// the env-configured admin-SSO identity adoption is a last-resort fallback because it
// authorizes without any request credential (the Vercel SSO gate sits in front of the
// deploy, not in the request), and every use of it is written to platform_audit_events.
export async function authenticatePlatformStaff(req: Request): Promise<PlatformAuthResult> {
  // Agentic admin access: a platform-staff API key bearer token authorizes its
  // owner directly, without a browser session.
  const keyStaff = await authenticatePlatformStaffKey(req);
  if (keyStaff) {
    return { ok: true, auth: { user: keyStaff.user, session: keyStaff.session } };
  }

  // Admin deploy: Auth0 is the human sign-in. An authenticated Auth0 user is
  // adopted as staff only if their verified email maps to an is_platform_staff
  // user (Option A).
  const auth0Staff = await resolveAuth0Staff();
  if (auth0Staff) {
    return { ok: true, auth: { user: auth0Staff.user, session: auth0Staff.session } };
  }

  const session = await authenticateUserRequest(req);
  if (session) {
    const sql = getSql();
    const [row] = await sql`
      select is_platform_staff
      from users
      where id = ${session.user.id}
      limit 1
    `;
    if (row && (row as { is_platform_staff: boolean }).is_platform_staff === true) {
      return {
        ok: true,
        auth: { user: session.user, session: session.session },
      };
    }
  }

  // Last resort, admin-only deploy: Vercel SSO is the single gate, so adopt the
  // designated platform-staff identity without a second app session. This is an
  // env-config identity adoption with no request credential — audit every use.
  const ssoStaff = await resolveAdminSsoStaff();
  if (ssoStaff) {
    const auth: PlatformStaffContext = { user: ssoStaff.user, session: ssoStaff.session };
    await recordPlatformAudit(auth, {
      action: "platform.auth.admin_sso_adopted",
      targetType: "user",
      targetId: ssoStaff.user.id,
      metadata: {
        adopted_email: ssoStaff.user.email,
        method: req.method,
        path: (() => {
          try {
            return new URL(req.url).pathname;
          } catch {
            return null;
          }
        })(),
      },
    });
    return { ok: true, auth };
  }

  if (!session) {
    return { ok: false, response: Response.json({ error: "unauthorized" }, { status: 401 }) };
  }
  return { ok: false, response: Response.json({ error: "forbidden" }, { status: 403 }) };
}
