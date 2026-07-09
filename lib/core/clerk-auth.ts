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

export type ClerkBridgeDeps = {
  userStore: OAuthUserStore;
  verifyClerkToken: (token: string) => Promise<{ userId: string }>;
  getClerkUser: (userId: string) => Promise<ClerkUserProfile>;
  createUserSession: (userId: string, host?: string | null) => Promise<SessionResult>;
  logTelemetryEvent: (event: ClerkTelemetryInput) => Promise<void>;
  checkRateLimit: (
    req: Request,
    input: { action: string; limit: number; windowSeconds: number; keyParts: string[] },
  ) => Promise<RateLimitResult>;
  rateLimitedResponse: (limit: RateLimitResult) => Response;
};

const bridgeSchema = z.object({
  token: z.string().min(1).max(8192),
  next: z.string().max(2048).optional(),
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

  const denied = (method: string, reason: string, metadata: Record<string, unknown> = {}) =>
    deps.logTelemetryEvent({
      actor: { type: "system" },
      req,
      action: "auth.login",
      outcome: "denied",
      latencyMs: Date.now() - startedAt,
      metadata: { method, reason, ...metadata },
    });

  try {
    const json = await readJson(req);
    if (!json.ok) return json.response;

    const parsed = bridgeSchema.safeParse(json.value);
    if (!parsed.success) return bridgeError("validation", 400);

    const limit = await deps.checkRateLimit(req, {
      action: "auth.clerk.bridge",
      limit: 20,
      windowSeconds: 10 * 60,
      keyParts: [],
    });
    if (!limit.allowed) return deps.rateLimitedResponse(limit);

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
    const external = clerkUser.externalAccounts
      .map((account) => ({
        provider: clerkExternalProvider(account.provider),
        subject: account.providerUserId,
      }))
      .find((account): account is { provider: OAuthProvider; subject: string } =>
        account.provider !== null && account.subject.length > 0,
      ) ?? null;
    const method = external ? `clerk_${external.provider}` : "clerk_email";

    const primaryEmail = clerkUser.primaryEmailAddressId
      ? clerkUser.emailAddresses.find((entry) => entry.id === clerkUser.primaryEmailAddressId)
      : undefined;
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
    // the validated destination and sets the session cookie.
    return Response.json(
      { ok: true, next: safeNextPath(parsed.data.next) },
      { status: 200, headers: { "Set-Cookie": session.cookie } },
    );
  } catch (err) {
    console.error("clerk bridge failed", { message: (err as Error)?.message });
    return bridgeError("oauth_failed", 500);
  }
}
