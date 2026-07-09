import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { getSql as getDefaultSql } from "@/lib/db";
import { safeNextPath } from "@/lib/core/oauth-core";
import { customerAppBaseUrl } from "@/lib/core/public-url";
import { assertSafeBrowserMutation, readJson } from "@/lib/core/request-guards";

// Frege-native email sign-in link (magic link) — no Clerk, no new dependency.
// Mirrors the password-reset token flow (db/021 + the reset routes): a
// single-use sha256-hashed token with a short expiry, requested without user
// enumeration and confirmed via a GET link that mints the normal frege_session.
// Written against injected deps so scripts/prototype/test-login-link.mjs can
// exercise every branch hermetically, mirroring auth-flow-core.ts.

export const LOGIN_LINK_EXPIRES_SECONDS = 15 * 60;

type Sql = ReturnType<typeof getDefaultSql>;

type RateLimitResult = {
  allowed: boolean;
  attempts: number;
  limit: number;
  retryAfterSeconds: number;
};

type LoginLinkTelemetryInput = {
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

export type LoginLinkDeps = {
  getSql: () => Sql;
  checkRateLimit: (
    req: Request,
    input: {
      action: string;
      limit: number;
      windowSeconds: number;
      keyParts?: string[];
    },
  ) => Promise<RateLimitResult>;
  rateLimitedResponse: (limit: RateLimitResult) => Response;
  createUserSession: (userId: string, host?: string | null) => Promise<SessionResult>;
  logTelemetryEvent: (event: LoginLinkTelemetryInput) => Promise<void>;
  sendLoginLinkEmail: (input: { to: string; name: string; loginUrl: string }) => Promise<{ sent: boolean }>;
  routeError: (label: string, err: unknown) => Response;
};

// ── Token helpers (same shape as lib/core/password-reset.ts) ────────────────

export function generateLoginLinkToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashLoginLinkToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function loginLinkExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + LOGIN_LINK_EXPIRES_SECONDS * 1000);
}

export function loginLinkUrl(rawToken: string, next?: string | null): string {
  const url = new URL("/api/v1/auth/login-link/confirm", customerAppBaseUrl());
  url.searchParams.set("token", rawToken);
  const validatedNext = next ? safeNextPath(next) : null;
  if (validatedNext && validatedNext !== "/console") url.searchParams.set("next", validatedNext);
  return url.toString();
}

// ── Request (POST {email}) ──────────────────────────────────────────────────

const requestLoginLinkSchema = z.object({
  email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
  next: z.string().max(2048).optional(),
});

type UserRow = {
  id: string;
  email: string;
  name: string;
};

const GENERIC_SUCCESS = { ok: true };

export async function handleLoginLinkRequest(req: Request, deps: LoginLinkDeps): Promise<Response> {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  const startedAt = Date.now();
  try {
    const json = await readJson(req);
    if (!json.ok) return json.response;

    const parsed = requestLoginLinkSchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    // Same limits as the password-reset request route: 5/email/hour + 20/ip/hour.
    const email = parsed.data.email;
    const emailLimit = await deps.checkRateLimit(req, {
      action: "auth.login_link.request.email",
      limit: 5,
      windowSeconds: 60 * 60,
      keyParts: [email],
    });
    if (!emailLimit.allowed) return deps.rateLimitedResponse(emailLimit);

    const ipLimit = await deps.checkRateLimit(req, {
      action: "auth.login_link.request.ip",
      limit: 20,
      windowSeconds: 60 * 60,
    });
    if (!ipLimit.allowed) return deps.rateLimitedResponse(ipLimit);

    const sql = deps.getSql();
    const [user] = (await sql`
      select id, email, name
      from users
      where email = ${email}
        and status = 'active'
      limit 1
    `) as UserRow[];

    // Enumeration-safe: unknown or disabled accounts get the same 200.
    if (!user) return Response.json(GENERIC_SUCCESS, { status: 200 });

    const rawToken = generateLoginLinkToken();
    await sql`
      insert into login_link_tokens (user_id, token_hash, expires_at)
      values (${user.id}, ${hashLoginLinkToken(rawToken)}, ${loginLinkExpiresAt().toISOString()})
    `;

    const emailResult = await deps.sendLoginLinkEmail({
      to: user.email,
      name: user.name,
      loginUrl: loginLinkUrl(rawToken, parsed.data.next),
    });

    await deps.logTelemetryEvent({
      actor: { type: "system" },
      req,
      action: "auth.login_link.request",
      resourceType: "user",
      resourceId: user.id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { email_sent: emailResult.sent },
    });

    return Response.json(GENERIC_SUCCESS, { status: 200 });
  } catch (err) {
    return deps.routeError("login link request failed", err);
  }
}

// ── Confirm (GET ?token=) ───────────────────────────────────────────────────

function loginRedirect(errorCode: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: `/login?error=${encodeURIComponent(errorCode)}`,
      "Cache-Control": "no-store",
    },
  });
}

type LoginLinkTokenRow = {
  id: string;
  user_id: string;
  email: string;
};

// Reached by users clicking a link in an email: any unexpected failure must
// land them back on /login with an error state, never on a raw 500 page.
export async function handleLoginLinkConfirm(req: Request, deps: LoginLinkDeps): Promise<Response> {
  const startedAt = Date.now();
  const host = req.headers.get("host");

  try {
    const url = new URL(req.url);
    const rawToken = url.searchParams.get("token") ?? "";
    if (!rawToken) return loginRedirect("login_link_invalid");

    // Token comparison happens on the sha256 hash via the unique index lookup,
    // exactly like the password-reset confirm route — no raw tokens stored.
    const tokenHash = hashLoginLinkToken(rawToken);
    const limit = await deps.checkRateLimit(req, {
      action: "auth.login_link.confirm",
      limit: 10,
      windowSeconds: 10 * 60,
      keyParts: [tokenHash],
    });
    if (!limit.allowed) return loginRedirect("rate_limited");

    const sql = deps.getSql();
    const [token] = (await sql`
      select
        login_link_tokens.id,
        login_link_tokens.user_id,
        users.email
      from login_link_tokens
      join users on users.id = login_link_tokens.user_id
      where login_link_tokens.token_hash = ${tokenHash}
        and login_link_tokens.used_at is null
        and login_link_tokens.expires_at > now()
        and users.status = 'active'
      limit 1
    `) as LoginLinkTokenRow[];

    if (!token) {
      await deps.logTelemetryEvent({
        actor: { type: "system" },
        req,
        action: "auth.login",
        outcome: "denied",
        latencyMs: Date.now() - startedAt,
        metadata: { method: "login_link", reason: "token_invalid" },
      });
      return loginRedirect("login_link_invalid");
    }

    // Single-use: the guarded update loses the race to a concurrent confirm.
    const [used] = await sql`
      update login_link_tokens
      set used_at = now()
      where id = ${token.id}
        and used_at is null
        and expires_at > now()
      returning id
    `;
    if (!used) return loginRedirect("login_link_invalid");

    await sql`update users set last_login_at = now() where id = ${token.user_id}`;
    const session = await deps.createUserSession(token.user_id, host);

    await deps.logTelemetryEvent({
      actor: { type: "system" },
      req,
      action: "auth.login",
      resourceType: "user",
      resourceId: token.user_id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { email: token.email, method: "login_link" },
    });

    return new Response(null, {
      status: 302,
      headers: {
        Location: safeNextPath(url.searchParams.get("next")),
        "Set-Cookie": session.cookie,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("login link confirm failed", { message: (err as Error)?.message });
    return loginRedirect("login_link_invalid");
  }
}
