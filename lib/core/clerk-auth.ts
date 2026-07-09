import { createClerkClient, verifyToken } from "@clerk/backend";
import { z } from "zod";
import {
  type OAuthProvider,
  type OAuthUserStore,
  safeNextPath,
} from "@/lib/core/oauth-core";
import { assertSafeOrigin, readJson } from "@/lib/core/request-guards";

// Clerk-brokered customer sign-in. Founder decision: Clerk is the OAuth broker
// (it runs the Google/GitHub handshake in the browser), but Frege keeps its own
// session model — this bridge verifies the Clerk session JWT server-side, then
// links-or-creates the user through the SAME store as the hand-rolled flow
// (lib/core/oauth-core.ts) and mints the same frege_session cookie. Password
// login is untouched; the hand-rolled OAuth routes stay as a dormant fallback.
//
// Identity rows are written as (provider: 'google'|'github', provider_subject:
// <providerUserId>) — byte-identical to what the hand-rolled callback would
// insert, so db/025_user_identities.sql needs no migration and the two flows
// can coexist on the same table.

// ── Config gate ─────────────────────────────────────────────────────────────

// Both keys must be present: the secret key verifies tokens server-side and the
// publishable key is what the login page uses to boot clerk-js in the browser.
export function clerkConfigured(): boolean {
  return Boolean(
    process.env.CLERK_SECRET_KEY?.trim() &&
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim(),
  );
}

// ── Normalized Clerk user shape ─────────────────────────────────────────────

// The default getClerkUser dep maps @clerk/backend's User class onto this plain
// shape so the core (and its tests) never depend on SDK class internals.
export type ClerkUserProfile = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  primaryEmailAddressId: string | null;
  emailAddresses: Array<{
    id: string;
    emailAddress: string;
    verificationStatus: string | null;
  }>;
  externalAccounts: Array<{
    provider: string;
    providerUserId: string;
  }>;
};

// Clerk reports providers as "oauth_google" / "oauth_github" in most payloads
// (bare "google" appears in some SDK surfaces); accept both, reject the rest so
// the value always satisfies the user_identities provider check constraint.
export function clerkExternalProvider(value: string | null | undefined): OAuthProvider | null {
  if (!value) return null;
  const normalized = value.startsWith("oauth_") ? value.slice("oauth_".length) : value;
  return normalized === "google" || normalized === "github" ? normalized : null;
}

// ── Default deps (real Clerk calls; routes wire these, tests inject fakes) ──

export async function verifyClerkSessionToken(token: string): Promise<{ userId: string }> {
  const payload = await verifyToken(token, {
    secretKey: process.env.CLERK_SECRET_KEY ?? "",
  });
  const userId = typeof payload.sub === "string" ? payload.sub : "";
  if (!userId) throw new Error("clerk token missing subject");
  return { userId };
}

export async function fetchClerkUser(userId: string): Promise<ClerkUserProfile> {
  const client = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY ?? "" });
  const user = await client.users.getUser(userId);
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    primaryEmailAddressId: user.primaryEmailAddressId,
    emailAddresses: (user.emailAddresses ?? []).map((entry) => ({
      id: entry.id,
      emailAddress: entry.emailAddress,
      verificationStatus: entry.verification?.status ?? null,
    })),
    externalAccounts: (user.externalAccounts ?? []).map((account) => ({
      provider: account.provider,
      providerUserId: account.providerUserId,
    })),
  };
}

// ── Bridge flow (DI, testable) ──────────────────────────────────────────────

type RateLimitResult = {
  allowed: boolean;
  attempts: number;
  limit: number;
  retryAfterSeconds: number;
};

type ClerkTelemetryInput = {
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

// Link mode resolves the caller's frege_session with the same helper the
// /api/v1/auth/me route uses (authenticateUserRequest); only the fields the
// bridge needs are typed here.
type BridgeSessionContext = {
  user: { id: string; email: string };
};

export type ClerkBridgeDeps = {
  userStore: OAuthUserStore;
  verifyClerkToken: (token: string) => Promise<{ userId: string }>;
  getClerkUser: (userId: string) => Promise<ClerkUserProfile>;
  createUserSession: (userId: string, host?: string | null) => Promise<SessionResult>;
  authenticateUserRequest: (req: Request) => Promise<BridgeSessionContext | null>;
  logTelemetryEvent: (event: ClerkTelemetryInput) => Promise<void>;
  checkRateLimit: (
    req: Request,
    input: { action: string; limit: number; windowSeconds: number; keyParts: string[] },
  ) => Promise<RateLimitResult>;
  rateLimitedResponse: (limit: RateLimitResult) => Response;
};

// mode defaults to "login" so the deployed login page (which sends no mode)
// keeps working unchanged. "link" binds the Clerk-verified external account to
// the CURRENT frege_session user instead of signing anyone in.
const bridgeSchema = z.object({
  token: z.string().min(1).max(8192),
  next: z.string().max(2048).optional(),
  mode: z.enum(["login", "link"]).default("login"),
});

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function bridgeError(code: string, status: number): Response {
  return Response.json({ error: code }, { status });
}

export async function handleClerkBridgeRequest(
  req: Request,
  deps: ClerkBridgeDeps,
): Promise<Response> {
  // Same posture as the hand-rolled start route: the endpoint does not exist
  // until both Clerk keys are provisioned.
  if (!clerkConfigured()) return bridgeError("oauth_not_configured", 404);

  const originError = assertSafeOrigin(req);
  if (originError) return originError;

  const startedAt = Date.now();
  const host = req.headers.get("host");

  const deniedEvent = (action: string, method: string, reason: string, metadata: Record<string, unknown> = {}) =>
    deps.logTelemetryEvent({
      actor: { type: "system" },
      req,
      action,
      outcome: "denied",
      latencyMs: Date.now() - startedAt,
      metadata: { method, reason, ...metadata },
    });
  const denied = (method: string, reason: string, metadata: Record<string, unknown> = {}) =>
    deniedEvent("auth.login", method, reason, metadata);

  try {
    const json = await readJson(req);
    if (!json.ok) return json.response;

    const parsed = bridgeSchema.safeParse(json.value);
    if (!parsed.success) return bridgeError("validation", 400);
    const mode = parsed.data.mode;

    const limit = await deps.checkRateLimit(req, {
      action: "auth.clerk.bridge",
      limit: 20,
      windowSeconds: 10 * 60,
      keyParts: [],
    });
    if (!limit.allowed) return deps.rateLimitedResponse(limit);

    // Link mode is only meaningful for an already signed-in Frege user; reject
    // before spending a Clerk verification on an anonymous caller.
    let linkSession: BridgeSessionContext | null = null;
    if (mode === "link") {
      linkSession = await deps.authenticateUserRequest(req);
      if (!linkSession) {
        await deniedEvent("auth.identity_link", "clerk", "no_session");
        return bridgeError("unauthorized", 401);
      }
    }

    let userId: string;
    try {
      ({ userId } = await deps.verifyClerkToken(parsed.data.token));
    } catch (err) {
      console.error("clerk token verification failed", { message: (err as Error)?.message });
      await denied("clerk", "token_invalid");
      return bridgeError("oauth_failed", 401);
    }

    let clerkUser: ClerkUserProfile;
    try {
      clerkUser = await deps.getClerkUser(userId);
    } catch (err) {
      console.error("clerk user lookup failed", { message: (err as Error)?.message });
      await denied("clerk", "user_lookup_failed");
      return bridgeError("oauth_failed", 401);
    }

    // Identity mapping: prefer the Google/GitHub external account so identity
    // rows stay interchangeable with the hand-rolled flow. Clerk sign-ins with
    // no such account (e.g. email-code sign-up) fall back to email linking.
    const externalAccounts = clerkUser.externalAccounts
      .map((account) => ({
        provider: clerkExternalProvider(account.provider),
        subject: account.providerUserId,
      }))
      .filter((account): account is { provider: OAuthProvider; subject: string } =>
        account.provider !== null && account.subject.length > 0,
      );
    const external = externalAccounts[0] ?? null;
    const method = external ? `clerk_${external.provider}` : "clerk_email";

    const primaryEmail = clerkUser.primaryEmailAddressId
      ? clerkUser.emailAddresses.find((entry) => entry.id === clerkUser.primaryEmailAddressId)
      : undefined;

    // ── Link mode: bind the Clerk-verified external account(s) to the current
    // frege_session user. Never switches sessions, never links by email, never
    // creates users — the email checks below are login-mode concerns (link
    // decisions are made purely on provider subjects; the identity row's email
    // column is informational).
    if (mode === "link" && linkSession) {
      if (externalAccounts.length === 0) {
        await deniedEvent("auth.identity_link", method, "no_external_account");
        return bridgeError("oauth_failed", 400);
      }

      const sessionUserId = linkSession.user.id;
      const identityEmail = primaryEmail?.emailAddress
        ? normalizeEmail(primaryEmail.emailAddress)
        : normalizeEmail(linkSession.user.email);

      // Conflict check across every account first so a bind is all-or-nothing:
      // an identity already belonging to ANOTHER user rejects the whole call.
      const owners = await Promise.all(
        externalAccounts.map((account) =>
          deps.userStore.findIdentityUser(account.provider, account.subject),
        ),
      );
      if (owners.some((owner) => owner !== null && owner.id !== sessionUserId)) {
        await deniedEvent("auth.identity_link", method, "identity_in_use");
        return bridgeError("identity_in_use", 409);
      }

      // Idempotent: accounts already bound to this user are skipped.
      const toBind = externalAccounts.filter((_, index) => owners[index] === null);
      for (const account of toBind) {
        await deps.userStore.linkIdentity({
          userId: sessionUserId,
          provider: account.provider,
          subject: account.subject,
          email: identityEmail,
        });
      }

      const providers = externalAccounts.map((account) => account.provider);
      await deps.logTelemetryEvent({
        actor: { type: "system" },
        req,
        action: "auth.identity_link",
        resourceType: "user",
        resourceId: sessionUserId,
        outcome: "success",
        latencyMs: Date.now() - startedAt,
        metadata: { providers, already_linked: toBind.length === 0 },
      });

      // No Set-Cookie: the caller's existing frege_session stays untouched.
      return Response.json(
        {
          ok: true,
          providers,
          already_linked: toBind.length === 0,
          next: `/console?view=account&linked=${providers[0]}`,
        },
        { status: 200 },
      );
    }

    if (!primaryEmail?.emailAddress) {
      await denied(method, "email_missing");
      return bridgeError("oauth_email_missing", 403);
    }
    if (primaryEmail.verificationStatus !== "verified") {
      await denied(method, "email_unverified", { email: normalizeEmail(primaryEmail.emailAddress) });
      return bridgeError("oauth_email_unverified", 403);
    }

    const email = normalizeEmail(primaryEmail.emailAddress);

    // Link-or-create exactly mirrors handleOAuthCallbackRequest in oauth-core:
    // identity hit → sign in; email hit → link (+ mark verified); miss → create
    // a minimal active user (verified email, no password credential, no org).
    let user = external
      ? await deps.userStore.findIdentityUser(external.provider, external.subject)
      : null;
    let flow: "identity" | "linked" | "created" = "identity";

    if (!user) {
      const existing = await deps.userStore.findUserByEmail(email);
      if (existing) {
        if (existing.status !== "active") {
          await denied(method, "account_disabled", { email });
          return bridgeError("oauth_account_disabled", 403);
        }
        // Clerk vouched for this address (verified primary email), which counts
        // as email verification for accounts still pending it. Only provider
        // sign-ins get an identity row — clerk_email has no google/github
        // subject to store.
        if (external) {
          await deps.userStore.linkIdentity({
            userId: existing.id,
            provider: external.provider,
            subject: external.subject,
            email,
          });
        }
        if (!existing.email_verified_at) await deps.userStore.markEmailVerified(existing.id);
        user = existing;
        flow = "linked";
      } else {
        const name =
          [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ").trim() ||
          email.split("@")[0] ||
          email;
        user = await deps.userStore.createUser({ email, name });
        if (external) {
          await deps.userStore.linkIdentity({
            userId: user.id,
            provider: external.provider,
            subject: external.subject,
            email,
          });
        }
        flow = "created";
      }
    } else if (user.status !== "active") {
      await denied(method, "account_disabled", { email });
      return bridgeError("oauth_account_disabled", 403);
    }

    if (flow !== "created") await deps.userStore.touchLastLogin(user.id);
    // Brand-new users cannot have a membership yet; skip the lookup for them.
    const hasOrg = flow === "created" ? false : await deps.userStore.hasActiveMembership(user.id);
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

    // The client (login page) performs the redirect — the bridge only reports
    // the validated destination and sets the session cookie. flow/hasOrg let
    // the client send org-less users to /setup-workspace; older clients that
    // only read `next` keep working.
    return Response.json(
      { ok: true, next: safeNextPath(parsed.data.next), flow, hasOrg },
      { status: 200, headers: { "Set-Cookie": session.cookie } },
    );
  } catch (err) {
    console.error("clerk bridge failed", { message: (err as Error)?.message });
    return bridgeError("oauth_failed", 500);
  }
}
