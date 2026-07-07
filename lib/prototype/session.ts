import { createHash, randomBytes } from "node:crypto";
import { getSql } from "@/lib/db";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  clearSessionCookie,
  sessionCookie,
} from "@/lib/prototype/session-cookie";

export { SESSION_COOKIE, clearSessionCookie, sessionCookie };

export type UserSessionMembership = {
  org_id: string;
  org_slug: string;
  org_name: string;
  org_status: "inactive" | "active" | "suspended";
  role: "owner" | "admin" | "member" | "viewer";
  status: "active" | "disabled";
};

export type UserSessionContext = {
  user: {
    id: string;
    email: string;
    name: string;
    status: string;
    email_verified_at: Date | string | null;
  };
  session: {
    id: string;
    expires_at: Date | string;
  };
  memberships: UserSessionMembership[];
};

type SessionRow = {
  session_id: string;
  expires_at: Date | string;
  user_id: string;
  email: string;
  name: string;
  status: string;
  email_verified_at: Date | string | null;
};

type MembershipRow = UserSessionMembership;

function hashSessionToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

function parseCookies(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;

  for (const part of header.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (!rawName) continue;
    cookies.set(rawName, decodeURIComponent(rest.join("=")));
  }

  return cookies;
}

export function readSessionToken(req: Request): string | null {
  return parseCookies(req.headers.get("cookie")).get(SESSION_COOKIE) ?? null;
}

export async function createUserSession(
  userId: string,
  host?: string | null,
): Promise<{ rawToken: string; cookie: string; expiresAt: Date }> {
  const sql = getSql();
  const rawToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);

  await sql`
    insert into user_sessions (user_id, session_hash, expires_at)
    values (${userId}, ${hashSessionToken(rawToken)}, ${expiresAt.toISOString()})
  `;

  return {
    rawToken,
    cookie: sessionCookie(rawToken, host),
    expiresAt,
  };
}

export async function revokeCurrentSession(req: Request): Promise<void> {
  const rawToken = readSessionToken(req);
  if (!rawToken) return;

  const sql = getSql();
  await sql`
    update user_sessions
    set status = 'revoked', revoked_at = now()
    where session_hash = ${hashSessionToken(rawToken)}
  `;
}

export async function revokeOtherUserSessions(userId: string, keepSessionId: string): Promise<void> {
  const sql = getSql();
  await sql`
    update user_sessions
    set status = 'revoked', revoked_at = now()
    where user_id = ${userId}
      and id <> ${keepSessionId}
      and status = 'active'
  `;
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  const sql = getSql();
  await sql`
    update user_sessions
    set status = 'revoked', revoked_at = now()
    where user_id = ${userId}
      and status = 'active'
  `;
}

export async function authenticateSessionToken(rawToken: string | null): Promise<UserSessionContext | null> {
  if (!rawToken) return null;

  const sql = getSql();
  const rows = await sql`
    select
      user_sessions.id as session_id,
      user_sessions.expires_at,
      users.id as user_id,
      users.email,
      users.name,
      users.status,
      users.email_verified_at
    from user_sessions
    join users on users.id = user_sessions.user_id
    where user_sessions.session_hash = ${hashSessionToken(rawToken)}
      and user_sessions.status = 'active'
      and user_sessions.expires_at > now()
      and users.status = 'active'
    limit 1
  `;

  const row = rows[0] as SessionRow | undefined;
  if (!row) return null;

  await sql`
    update user_sessions
    set last_seen_at = now()
    where id = ${row.session_id}
  `;

  const memberships = await sql`
    select
      organizations.id as org_id,
      organizations.slug as org_slug,
      organizations.name as org_name,
      organizations.status as org_status,
      organization_memberships.role,
      organization_memberships.status
    from organization_memberships
    join organizations on organizations.id = organization_memberships.org_id
    where organization_memberships.user_id = ${row.user_id}
    order by organizations.name asc
  `;

  return {
    user: {
      id: row.user_id,
      email: row.email,
      name: row.name,
      status: row.status,
      email_verified_at: row.email_verified_at,
    },
    session: {
      id: row.session_id,
      expires_at: row.expires_at,
    },
    memberships: memberships as MembershipRow[],
  };
}

export async function authenticateUserRequest(req: Request): Promise<UserSessionContext | null> {
  return authenticateSessionToken(readSessionToken(req));
}

export function userUnauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}
