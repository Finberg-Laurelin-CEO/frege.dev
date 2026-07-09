import { createHash, randomBytes } from "node:crypto";
import { oauthCallbackBaseUrl } from "@/lib/core/public-url";
import { cookieDomainForHost } from "@/lib/core/session-cookie";

// Hand-rolled customer OAuth (Google + GitHub). Explicit founder decision:
// Auth0 stays staff-only; customer sign-in uses the provider endpoints
// directly over fetch — no new dependencies.
//
// The callback flow is written against injected deps (token exchange, user
// store, session mint, telemetry) so scripts/prototype/test-oauth.mjs can
// exercise every branch hermetically, mirroring auth-flow-core.ts.

export const OAUTH_PROVIDERS = ["google", "github"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export const OAUTH_STATE_COOKIE = "frege_oauth_state";
const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;

export function parseOAuthProvider(value: string | null | undefined): OAuthProvider | null {
  return value === "google" || value === "github" ? value : null;
}

// ── Provider configuration (env) ────────────────────────────────────────────

export type OAuthProviderConfig = {
  clientId: string;
  clientSecret: string;
};

export function oauthProviderConfig(provider: OAuthProvider): OAuthProviderConfig | null {
  const prefix = provider === "google" ? "FREGE_OAUTH_GOOGLE" : "FREGE_OAUTH_GITHUB";
  const clientId = process.env[`${prefix}_CLIENT_ID`]?.trim();
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`]?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

// Config presence only — safe to pass from a server component into client UI.
export function oauthProvidersConfigured(): { google: boolean; github: boolean } {
  return {
    google: oauthProviderConfig("google") !== null,
    github: oauthProviderConfig("github") !== null,
  };
}

// ── next-path validation ────────────────────────────────────────────────────

// Only same-origin paths survive; anything absolute, protocol-relative, or
// pointing back at /login falls back to the console.
export function safeNextPath(value: string | null | undefined): string {
  const fallback = "/console";
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;

  try {
    const base = "https://frege.dev";
    const nextUrl = new URL(value, base);
    if (nextUrl.origin !== base || nextUrl.pathname === "/login") return fallback;
    return `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
  } catch {
    return fallback;
  }
}

// ── State + PKCE helpers ────────────────────────────────────────────────────

export function generateOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

export function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export type OAuthStatePayload = {
  provider: OAuthProvider;
  state: string;
  verifier?: string;
  next?: string;
};

// One short-lived httpOnly cookie carries state (+ PKCE verifier + next). It is
// shared across frege.dev/brain.frege.dev exactly like the session cookie so a
// start on the marketing host survives the callback on the app host.
export function oauthStateCookie(payload: OAuthStatePayload, host?: string | null): string {
  const domain = cookieDomainForHost(host ?? null);
  const value = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return [
    `${OAUTH_STATE_COOKIE}=${value}`,
    "Path=/",
    domain ? `Domain=${domain}` : "",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${OAUTH_STATE_MAX_AGE_SECONDS}`,
    process.env.NODE_ENV === "production" ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearOAuthStateCookie(host?: string | null): string {
  const domain = cookieDomainForHost(host ?? null);
  return [
    `${OAUTH_STATE_COOKIE}=`,
    "Path=/",
    domain ? `Domain=${domain}` : "",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    process.env.NODE_ENV === "production" ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function readOAuthStateCookie(req: Request): OAuthStatePayload | null {
  const header = req.headers.get("cookie");
  if (!header) return null;

  for (const part of header.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName !== OAUTH_STATE_COOKIE) continue;
    try {
      const decoded = Buffer.from(decodeURIComponent(rest.join("=")), "base64url").toString("utf8");
      const parsed = JSON.parse(decoded) as Partial<OAuthStatePayload>;
      const provider = parseOAuthProvider(parsed.provider);
      if (!provider || typeof parsed.state !== "string" || parsed.state.length === 0) return null;
      return {
        provider,
        state: parsed.state,
        verifier: typeof parsed.verifier === "string" ? parsed.verifier : undefined,
        next: typeof parsed.next === "string" ? parsed.next : undefined,
      };
    } catch {
      return null;
    }
  }
  return null;
}

// ── Start (authorize redirect) ──────────────────────────────────────────────

export function oauthRedirectUri(provider: OAuthProvider, host?: string | null): string {
  return `${oauthCallbackBaseUrl(host)}/api/v1/auth/oauth/${provider}/callback`;
}

function buildAuthorizeUrl(
  provider: OAuthProvider,
  input: { clientId: string; redirectUri: string; state: string; codeChallenge?: string },
): string {
  if (provider === "google") {
    const params = new URLSearchParams({
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state: input.state,
      code_challenge: input.codeChallenge ?? "",
      code_challenge_method: "S256",
      prompt: "select_account",
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: "read:user user:email",
    state: input.state,
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export function buildOAuthStartResponse(req: Request, provider: OAuthProvider): Response {
  const config = oauthProviderConfig(provider);
  if (!config) return Response.json({ error: "oauth_not_configured" }, { status: 404 });

  const host = req.headers.get("host");
  const url = new URL(req.url);
  const requestedNext = url.searchParams.get("next");
  const next = safeNextPath(requestedNext);

  const state = generateOAuthState();
  const pkce = provider === "google" ? generatePkcePair() : null;

  const payload: OAuthStatePayload = {
    provider,
    state,
    ...(pkce ? { verifier: pkce.verifier } : {}),
    ...(next !== "/console" ? { next } : {}),
  };

  const authorizeUrl = buildAuthorizeUrl(provider, {
    clientId: config.clientId,
    redirectUri: oauthRedirectUri(provider, host),
    state,
    codeChallenge: pkce?.challenge,
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizeUrl,
      "Set-Cookie": oauthStateCookie(payload, host),
      "Cache-Control": "no-store",
    },
  });
}

// ── Provider identity exchange (real implementations, fetch only) ──────────

export type OAuthIdentity = {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
};

export type OAuthExchangeInput = {
  provider: OAuthProvider;
  code: string;
  redirectUri: string;
  codeVerifier?: string;
};

function decodeJwtClaims(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("id_token missing payload");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}

async function exchangeGoogleCode(
  input: OAuthExchangeInput,
  config: OAuthProviderConfig,
): Promise<OAuthIdentity> {
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
      code_verifier: input.codeVerifier ?? "",
    }),
  });
  if (!tokenResponse.ok) throw new Error(`google token exchange failed: ${tokenResponse.status}`);
  const tokens = (await tokenResponse.json()) as { access_token?: string; id_token?: string };

  // The id_token arrives over TLS directly from Google's token endpoint, so its
  // claims are trusted without local signature verification. Fall back to the
  // userinfo endpoint when it is absent.
  let claims: Record<string, unknown> | null = null;
  if (tokens.id_token) {
    claims = decodeJwtClaims(tokens.id_token);
  } else if (tokens.access_token) {
    const userinfoResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!userinfoResponse.ok) throw new Error(`google userinfo failed: ${userinfoResponse.status}`);
    claims = (await userinfoResponse.json()) as Record<string, unknown>;
  }
  if (!claims || typeof claims.sub !== "string") throw new Error("google identity missing subject");

  return {
    subject: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
    name: typeof claims.name === "string" ? claims.name : null,
  };
}

async function exchangeGitHubCode(
  input: OAuthExchangeInput,
  config: OAuthProviderConfig,
): Promise<OAuthIdentity> {
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      code: input.code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: input.redirectUri,
    }),
  });
  if (!tokenResponse.ok) throw new Error(`github token exchange failed: ${tokenResponse.status}`);
  const tokens = (await tokenResponse.json()) as { access_token?: string };
  if (!tokens.access_token) throw new Error("github token exchange returned no access_token");

  const apiHeaders = {
    Authorization: `Bearer ${tokens.access_token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "frege-oauth",
  };

  const userResponse = await fetch("https://api.github.com/user", { headers: apiHeaders });
  if (!userResponse.ok) throw new Error(`github user lookup failed: ${userResponse.status}`);
  const user = (await userResponse.json()) as { id?: number; name?: string | null; login?: string };
  if (typeof user.id !== "number") throw new Error("github identity missing id");

  // The primary email must itself be verified; we never fall back to secondary
  // addresses to avoid signing users in with an unowned mailbox.
  const emailsResponse = await fetch("https://api.github.com/user/emails", { headers: apiHeaders });
  if (!emailsResponse.ok) throw new Error(`github email lookup failed: ${emailsResponse.status}`);
  const emails = (await emailsResponse.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
  const primary = Array.isArray(emails) ? emails.find((entry) => entry.primary) : undefined;

  return {
    subject: String(user.id),
    email: primary?.email ?? null,
    emailVerified: primary?.verified === true,
    name: user.name ?? user.login ?? null,
  };
}

export async function exchangeOAuthCode(input: OAuthExchangeInput): Promise<OAuthIdentity> {
  const config = oauthProviderConfig(input.provider);
  if (!config) throw new Error("oauth provider not configured");
  return input.provider === "google"
    ? exchangeGoogleCode(input, config)
    : exchangeGitHubCode(input, config);
}

// ── Callback flow (DI, testable) ────────────────────────────────────────────

type OAuthSql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>;

type RateLimitResult = {
  allowed: boolean;
  attempts: number;
  limit: number;
  retryAfterSeconds: number;
};

type OAuthTelemetryInput = {
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

export type OAuthUserRow = {
  id: string;
  email: string;
  name: string;
  status: string;
  email_verified_at: Date | string | null;
};

export type OAuthUserStore = {
  findIdentityUser(provider: OAuthProvider, subject: string): Promise<OAuthUserRow | null>;
  findUserByEmail(email: string): Promise<OAuthUserRow | null>;
  linkIdentity(input: { userId: string; provider: OAuthProvider; subject: string; email: string }): Promise<void>;
  markEmailVerified(userId: string): Promise<void>;
  createUser(input: { email: string; name: string }): Promise<OAuthUserRow>;
  touchLastLogin(userId: string): Promise<void>;
  /** Whether the user already belongs to an org — the Clerk bridge reports it
   *  as hasOrg so the client can route org-less users to /setup-workspace. */
  hasActiveMembership(userId: string): Promise<boolean>;
};

export type OAuthCallbackDeps = {
  userStore: OAuthUserStore;
  exchangeCode: (input: OAuthExchangeInput) => Promise<OAuthIdentity>;
  createUserSession: (userId: string, host?: string | null) => Promise<SessionResult>;
  logTelemetryEvent: (event: OAuthTelemetryInput) => Promise<void>;
  checkRateLimit: (
    req: Request,
    input: { action: string; limit: number; windowSeconds: number; keyParts: string[] },
  ) => Promise<RateLimitResult>;
};

// Default store used by the callback route; sql is injected so this module
// never imports the DB driver (keeps tests hermetic).
export function defaultOAuthUserStore(sql: OAuthSql): OAuthUserStore {
  return {
    async findIdentityUser(provider, subject) {
      const rows = await sql`
        select users.id, users.email, users.name, users.status, users.email_verified_at
        from user_identities
        join users on users.id = user_identities.user_id
        where user_identities.provider = ${provider}
          and user_identities.provider_subject = ${subject}
        limit 1
      `;
      return (rows[0] as OAuthUserRow | undefined) ?? null;
    },
    async findUserByEmail(email) {
      const rows = await sql`
        select id, email, name, status, email_verified_at
        from users
        where email = ${email}
        limit 1
      `;
      return (rows[0] as OAuthUserRow | undefined) ?? null;
    },
    async linkIdentity({ userId, provider, subject, email }) {
      await sql`
        insert into user_identities (user_id, provider, provider_subject, email)
        values (${userId}, ${provider}, ${subject}, ${email})
        on conflict (provider, provider_subject) do nothing
      `;
    },
    async markEmailVerified(userId) {
      await sql`
        update users
        set email_verified_at = coalesce(email_verified_at, now())
        where id = ${userId}
      `;
    },
    async createUser({ email, name }) {
      const rows = await sql`
        insert into users (email, name, status, email_verified_at, last_login_at)
        values (${email}, ${name}, 'active', now(), now())
        returning id, email, name, status, email_verified_at
      `;
      const row = rows[0] as OAuthUserRow | undefined;
      if (!row) throw new Error("oauth user create failed");
      return row;
    },
    async touchLastLogin(userId) {
      await sql`update users set last_login_at = now() where id = ${userId}`;
    },
    async hasActiveMembership(userId) {
      const rows = await sql`
        select 1
        from organization_memberships
        where user_id = ${userId}
          and status = 'active'
        limit 1
      `;
      return rows.length > 0;
    },
  };
}

function loginRedirect(errorCode: string, host: string | null): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: `/login?error=${encodeURIComponent(errorCode)}`,
      "Set-Cookie": clearOAuthStateCookie(host),
      "Cache-Control": "no-store",
    },
  });
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function handleOAuthCallbackRequest(
  req: Request,
  provider: OAuthProvider,
  deps: OAuthCallbackDeps,
): Promise<Response> {
  const startedAt = Date.now();
  const host = req.headers.get("host");
  const method = `oauth_${provider}`;

  const denied = (reason: string, metadata: Record<string, unknown> = {}) =>
    deps.logTelemetryEvent({
      actor: { type: "system" },
      req,
      action: "auth.login",
      outcome: "denied",
      latencyMs: Date.now() - startedAt,
      metadata: { method, reason, ...metadata },
    });

  try {
    const url = new URL(req.url);
    const providerError = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookie = readOAuthStateCookie(req);

    if (providerError) return loginRedirect("oauth_denied", host);
    if (!code || !state) return loginRedirect("oauth_invalid_response", host);

    if (!cookie || cookie.provider !== provider || cookie.state !== state) {
      await denied("state_mismatch");
      return loginRedirect("oauth_state_mismatch", host);
    }

    const limit = await deps.checkRateLimit(req, {
      action: "auth.oauth.callback",
      limit: 20,
      windowSeconds: 10 * 60,
      keyParts: [provider],
    });
    if (!limit.allowed) return loginRedirect("oauth_rate_limited", host);

    let identity: OAuthIdentity;
    try {
      identity = await deps.exchangeCode({
        provider,
        code,
        redirectUri: oauthRedirectUri(provider, host),
        codeVerifier: cookie.verifier,
      });
    } catch (err) {
      console.error("oauth code exchange failed", {
        provider,
        message: (err as Error)?.message,
      });
      await denied("exchange_failed");
      return loginRedirect("oauth_exchange_failed", host);
    }

    if (!identity.email) {
      await denied("email_missing");
      return loginRedirect("oauth_email_missing", host);
    }
    if (!identity.emailVerified) {
      await denied("email_unverified", { email: normalizeEmail(identity.email) });
      return loginRedirect("oauth_email_unverified", host);
    }

    const email = normalizeEmail(identity.email);
    let user = await deps.userStore.findIdentityUser(provider, identity.subject);
    let flow: "identity" | "linked" | "created" = "identity";

    if (!user) {
      const existing = await deps.userStore.findUserByEmail(email);
      if (existing) {
        if (existing.status !== "active") {
          await denied("account_disabled", { email });
          return loginRedirect("oauth_account_disabled", host);
        }
        // Link by email: the provider vouched for this address, which counts
        // as email verification for accounts still pending it.
        await deps.userStore.linkIdentity({ userId: existing.id, provider, subject: identity.subject, email });
        if (!existing.email_verified_at) await deps.userStore.markEmailVerified(existing.id);
        user = existing;
        flow = "linked";
      } else {
        // Minimal user: no password credential, no org. The console renders
        // its existing no-org state until the user is invited or activates.
        const name = identity.name?.trim() || email.split("@")[0] || email;
        user = await deps.userStore.createUser({ email, name });
        await deps.userStore.linkIdentity({ userId: user.id, provider, subject: identity.subject, email });
        flow = "created";
      }
    } else if (user.status !== "active") {
      await denied("account_disabled", { email });
      return loginRedirect("oauth_account_disabled", host);
    }

    if (flow !== "created") await deps.userStore.touchLastLogin(user.id);
    const session = await deps.createUserSession(user.id, host);

    await deps.logTelemetryEvent({
      actor: { type: "system" },
      req,
      action: "auth.login",
      resourceType: "user",
      resourceId: user.id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { email, method, flow },
    });

    const headers = new Headers({
      Location: safeNextPath(cookie.next),
      "Cache-Control": "no-store",
    });
    headers.append("Set-Cookie", session.cookie);
    headers.append("Set-Cookie", clearOAuthStateCookie(host));
    return new Response(null, { status: 302, headers });
  } catch (err) {
    console.error("oauth callback failed", {
      provider,
      message: (err as Error)?.message,
    });
    return loginRedirect("oauth_failed", host);
  }
}
