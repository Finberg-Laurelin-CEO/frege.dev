import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSql } from "@/lib/db";
import { resolveAdminSsoStaff } from "@/lib/prototype/admin-sso";
import { isAuth0AdminMode } from "@/lib/prototype/auth0";
import { resolveAuth0Staff } from "@/lib/prototype/auth0-staff";
import { authenticateSessionToken, SESSION_COOKIE, type UserSessionContext } from "@/lib/prototype/session";

function loginUrl(nextPath: string): string {
  return `/login?next=${encodeURIComponent(nextPath)}`;
}

export async function requireUserPageSession(nextPath: string): Promise<UserSessionContext> {
  const cookieStore = await cookies();
  const session = await authenticateSessionToken(cookieStore.get(SESSION_COOKIE)?.value ?? null);

  if (!session) redirect(loginUrl(nextPath));

  return session;
}

export async function requirePlatformStaffPage(nextPath: string): Promise<UserSessionContext> {
  // Admin-only deploy: Vercel SSO already gated this request. Skip the second
  // app-level login and adopt the designated platform-staff identity.
  const ssoStaff = await resolveAdminSsoStaff();
  if (ssoStaff) return ssoStaff;

  // Admin deploy with Auth0: Auth0 is the human sign-in. If authenticated and
  // mapped to a staff user, adopt that identity; otherwise send to Auth0 login.
  if (isAuth0AdminMode()) {
    const auth0Staff = await resolveAuth0Staff();
    if (auth0Staff) return auth0Staff;
    redirect(`/auth/login?returnTo=${encodeURIComponent(nextPath)}`);
  }

  const session = await requireUserPageSession(nextPath);

  const sql = getSql();
  const [row] = await sql`select is_platform_staff from users where id = ${session.user.id} limit 1`;
  if (!row || (row as { is_platform_staff: boolean }).is_platform_staff !== true) {
    redirect("/admin");
  }

  return session;
}
