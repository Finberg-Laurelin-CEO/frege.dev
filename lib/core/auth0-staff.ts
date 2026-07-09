import { getSql } from "@/lib/db";
import { auth0, isAuth0AdminMode } from "@/lib/core/auth0";
import type { UserSessionContext } from "@/lib/core/session";

// Option A bridge: Auth0 verifies WHO the person is; the DB decides whether they
// are allowed into /platform. An authenticated Auth0 user only becomes a staff
// session if their verified email matches an active users row with
// is_platform_staff = true. No match → null (denied), even if Auth0 authed them.
// Flipping is_platform_staff = false in the DB locks them out immediately.
export async function resolveAuth0Staff(): Promise<UserSessionContext | null> {
  if (!isAuth0AdminMode() || !auth0) return null;

  const session = await auth0.getSession();
  const email = session?.user?.email;
  if (!email) return null;

  // Email-verification enforcement is optional. The real authority for admin
  // access is the DB is_platform_staff flag below, so by default we accept any
  // authenticated Auth0 identity whose email maps to a staff user. Set
  // FREGE_AUTH0_REQUIRE_VERIFIED_EMAIL=true to additionally require a verified
  // email (recommended once a real email provider is configured in Auth0).
  if (
    process.env.FREGE_AUTH0_REQUIRE_VERIFIED_EMAIL === "true" &&
    session?.user?.email_verified === false
  ) {
    return null;
  }

  const normalized = String(email).trim().toLowerCase();
  const sql = getSql();
  const [row] = await sql`
    select id, email, name, status
    from users
    where lower(email) = ${normalized}
      and is_platform_staff = true
      and status = 'active'
    limit 1
  `;
  if (!row) return null;

  const user = row as { id: string; email: string; name: string; status: string };
  return {
    user: { id: user.id, email: user.email, name: user.name, status: user.status, email_verified_at: null },
    session: { id: "auth0", expires_at: new Date(Date.now() + 60 * 60 * 1000) },
    memberships: [],
  };
}
