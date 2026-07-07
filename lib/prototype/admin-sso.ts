import { getSql } from "@/lib/db";
import type { UserSessionContext } from "@/lib/prototype/session";

// On the admin-only deployment, Vercel Deployment Protection (SSO) is the single
// sign-in: any request that reaches the app is already an authenticated Vercel
// team member. In that mode we don't want a second app-level password page, so
// we adopt a designated platform-staff identity instead of redirecting to
// /login.
//
// The identity is config-driven (FREGE_ADMIN_SSO_STAFF_EMAIL) and must resolve
// to an existing is_platform_staff=true user. If the flag is off, the email is
// unset, or no matching staff user exists, this returns null and callers fall
// back to the normal session/login flow — so there is no silent privilege grant
// and no lockout.
export function isAdminSsoMode(): boolean {
  return (
    process.env.FREGE_ADMIN_ONLY === "true" &&
    Boolean(process.env.FREGE_ADMIN_SSO_STAFF_EMAIL)
  );
}

export async function resolveAdminSsoStaff(): Promise<UserSessionContext | null> {
  if (!isAdminSsoMode()) return null;

  const email = process.env.FREGE_ADMIN_SSO_STAFF_EMAIL!.trim().toLowerCase();
  const sql = getSql();
  const [row] = await sql`
    select id, email, name, status
    from users
    where lower(email) = ${email}
      and is_platform_staff = true
      and status = 'active'
    limit 1
  `;
  if (!row) return null;

  const user = row as { id: string; email: string; name: string; status: string };
  return {
    user: { id: user.id, email: user.email, name: user.name, status: user.status, email_verified_at: null },
    session: { id: "sso", expires_at: new Date(Date.now() + 60 * 60 * 1000) },
    memberships: [],
  };
}
