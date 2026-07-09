import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { getSql as getDefaultSql } from "@/lib/db";
import { assertSafeOrigin, readJson } from "@/lib/core/request-guards";

export type AuthFlowSql = ReturnType<typeof getDefaultSql>;

type RateLimitResult = {
  allowed: boolean;
  attempts: number;
  limit: number;
  retryAfterSeconds: number;
};

type AuthFlowTelemetryInput = {
  actor: { type: "system"; orgId?: string };
  req?: Request;
  action: string;
  resourceType?: string;
  resourceId?: string;
  outcome: "success" | "failure" | "denied";
  latencyMs?: number;
  metadata?: Record<string, unknown>;
};

type SessionResult = {
  rawToken: string;
  cookie: string;
  expiresAt: Date;
};

type AuthFlowCommonDeps = {
  getSql: () => AuthFlowSql;
  checkRateLimit: (
    req: Request,
    input: {
      action: string;
      limit: number;
      windowSeconds: number;
      keyParts: string[];
    },
  ) => Promise<RateLimitResult>;
  rateLimitedResponse: (limit: RateLimitResult) => Response;
  createUserSession: (userId: string, host?: string | null) => Promise<SessionResult>;
  logTelemetryEvent: (event: AuthFlowTelemetryInput) => Promise<void>;
  routeError: (label: string, err: unknown) => Response;
};

export type LoginFlowDeps = AuthFlowCommonDeps & {
  verifyPassword: (password: string, salt: string, storedHash: string) => Promise<boolean>;
};

export type InviteAcceptFlowDeps = AuthFlowCommonDeps & {
  hashPassword: (password: string) => Promise<{
    passwordHash: string;
    passwordSalt: string;
    passwordParams: Record<string, unknown>;
  }>;
};

const loginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(256),
});

const acceptInviteSchema = z.object({
  token: z.string().min(16).max(256),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(12).max(256),
});

type LoginRow = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  password_salt: string;
};

type InviteRow = {
  id: string;
  org_id: string;
  org_slug: string;
  org_name: string;
  org_status: "inactive" | "active" | "suspended";
  email: string;
  role: "owner" | "admin" | "member" | "viewer";
};

type UserRow = {
  id: string;
  email: string;
  name: string;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export async function handleLoginRequest(req: Request, deps: LoginFlowDeps): Promise<Response> {
  const originError = assertSafeOrigin(req);
  if (originError) return originError;

  const startedAt = Date.now();
  try {
    const json = await readJson(req);
    if (!json.ok) return json.response;

    const parsed = loginSchema.safeParse(json.value);
    if (!parsed.success) return Response.json({ error: "validation" }, { status: 400 });

    const email = normalizeEmail(parsed.data.email);
    const limit = await deps.checkRateLimit(req, {
      action: "auth.login",
      limit: 10,
      windowSeconds: 10 * 60,
      keyParts: [email],
    });
    if (!limit.allowed) return deps.rateLimitedResponse(limit);

    const sql = deps.getSql();
    const rows = await sql`
      select users.id, users.email, users.name, creds.password_hash, creds.password_salt
      from users
      join user_password_credentials creds on creds.user_id = users.id
      where users.email = ${email}
        and users.status = 'active'
      limit 1
    `;

    const row = rows[0] as LoginRow | undefined;
    if (!row || !(await deps.verifyPassword(parsed.data.password, row.password_salt, row.password_hash))) {
      await deps.logTelemetryEvent({
        actor: { type: "system" },
        req,
        action: "auth.login",
        outcome: "denied",
        latencyMs: Date.now() - startedAt,
        metadata: { email },
      });
      return Response.json({ error: "invalid_credentials" }, { status: 401 });
    }

    await sql`update users set last_login_at = now() where id = ${row.id}`;
    const session = await deps.createUserSession(row.id, req.headers.get("host"));

    await deps.logTelemetryEvent({
      actor: { type: "system" },
      req,
      action: "auth.login",
      resourceType: "user",
      resourceId: row.id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { email },
    });

    return Response.json(
      { user: { id: row.id, email: row.email, name: row.name } },
      { status: 200, headers: { "Set-Cookie": session.cookie } },
    );
  } catch (err) {
    return deps.routeError("login failed", err);
  }
}

export async function handleInviteAcceptRequest(req: Request, deps: InviteAcceptFlowDeps): Promise<Response> {
  const originError = assertSafeOrigin(req);
  if (originError) return originError;

  const startedAt = Date.now();
  try {
    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = acceptInviteSchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const tokenHash = hashInviteToken(parsed.data.token);
    const limit = await deps.checkRateLimit(req, {
      action: "auth.invite.accept",
      limit: 10,
      windowSeconds: 10 * 60,
      keyParts: [tokenHash],
    });
    if (!limit.allowed) return deps.rateLimitedResponse(limit);

    const sql = deps.getSql();
    const rows = await sql`
      select
        organization_invites.id,
        organization_invites.org_id,
        organizations.slug as org_slug,
        organizations.name as org_name,
        organizations.status as org_status,
        organization_invites.email,
        organization_invites.role
      from organization_invites
      join organizations on organizations.id = organization_invites.org_id
      where invite_token_hash = ${tokenHash}
        and organization_invites.status = 'pending'
        and organization_invites.expires_at > now()
      limit 1
    `;
    const invite = rows[0] as InviteRow | undefined;
    if (!invite) return Response.json({ error: "invalid_invite" }, { status: 404 });

    const existingUser = (await sql`
      select id, email, name
      from users
      where email = ${invite.email}
      limit 1
    `)[0] as UserRow | undefined;

    let needsCredentials = true;
    if (existingUser) {
      const credentialRows = await sql`
        select user_id
        from user_password_credentials
        where user_id = ${existingUser.id}
        limit 1
      `;
      needsCredentials = credentialRows.length === 0;
    }

    // ── Atomic acceptance batch ──────────────────────────────────────────
    // The neon HTTP driver runs sql.transaction([...]) as a non-interactive
    // batch (later statements cannot read earlier results — see
    // lib/core/billing-webhook-core.ts), so a new user's id is pre-generated
    // client-side with crypto.randomUUID() and every statement references it
    // directly. A mid-batch failure rolls the whole acceptance back.
    const userId = existingUser?.id ?? randomUUID();
    const statements = [];
    statements.push(
      existingUser
        ? sql`
            update users
            set name = case when trim(name) = '' then ${parsed.data.name.trim()} else name end,
                status = 'active',
                email_verified_at = coalesce(email_verified_at, now())
            where id = ${existingUser.id}
            returning id, email, name
          `
        : sql`
            insert into users (id, email, name, status, email_verified_at)
            values (${userId}, ${invite.email}, ${parsed.data.name.trim()}, 'active', now())
            returning id, email, name
          `,
    );

    if (needsCredentials) {
      const password = await deps.hashPassword(parsed.data.password);
      statements.push(sql`
        insert into user_password_credentials (user_id, password_hash, password_salt, password_params)
        values (${userId}, ${password.passwordHash}, ${password.passwordSalt}, ${JSON.stringify(password.passwordParams)}::jsonb)
      `);
    }

    statements.push(sql`
      insert into organization_memberships (org_id, user_id, role, status)
      values (${invite.org_id}, ${userId}, ${invite.role}, 'active')
      on conflict (org_id, user_id) do update
        set role = excluded.role,
            status = 'active'
    `);
    statements.push(sql`
      update organization_invites
      set status = 'accepted', accepted_at = now()
      where id = ${invite.id}
    `);

    const results = await sql.transaction(statements);
    const user = (results[0] as UserRow[] | undefined)?.[0];
    if (!user) throw new Error("invite_accept_user_write_failed");

    const session = await deps.createUserSession(user.id, req.headers.get("host"));
    const canManageBilling = invite.role === "owner" || invite.role === "admin";
    const nextPath = invite.org_status === "active" || !canManageBilling ? "/admin" : "/console?view=account";
    await deps.logTelemetryEvent({
      actor: { type: "system", orgId: invite.org_id },
      req,
      action: "auth.invite.accept",
      resourceType: "organization_invite",
      resourceId: invite.id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { email: invite.email, role: invite.role },
    });

    return Response.json(
      {
        user: { id: user.id, email: user.email, name: user.name },
        organization: {
          id: invite.org_id,
          slug: invite.org_slug,
          name: invite.org_name,
          status: invite.org_status,
        },
        next_path: nextPath,
      },
      { status: 200, headers: { "Set-Cookie": session.cookie } },
    );
  } catch (err) {
    return deps.routeError("invite accept failed", err);
  }
}
