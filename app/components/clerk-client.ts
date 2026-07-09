"use client";

// ── Clerk (CDN-loaded clerk-js) — shared browser flow ────────────────────────
//
// Clerk brokers the Google/GitHub handshake in the browser; the bridge endpoint
// (/api/v1/auth/clerk/bridge) then swaps the Clerk session JWT for our own
// frege_session cookie and we sign out of Clerk again — Frege's session stays
// the single source of truth. clerk-js is loaded lazily from the CDN (only when
// a button is clicked or a callback is pending) so page bundles stay lean and
// no package is added.
//
// Extracted from app/login/LoginPanel.tsx so the login page, the signup page,
// and the console account section share one loader and one callback flow.

export type ClerkProvider = "google" | "github";

// Status text for the oauth_* error vocabulary shared by every Clerk surface.
// LoginPanel spreads this into its own loginStatusText map.
export const clerkOAuthStatusText: Record<string, string> = {
  oauth_denied: "Single sign-on was cancelled.",
  oauth_state_mismatch: "That sign-in attempt expired. Try again.",
  oauth_email_missing: "Your provider account has no email address we can use.",
  oauth_email_unverified: "Verify your email with the provider first, then try again.",
  oauth_account_disabled: "This account is disabled.",
  oauth_rate_limited: "Too many sign-in attempts. Try again shortly.",
  oauth_failed: "Single sign-on failed. Try again or use your password.",
  oauth_not_configured: "Single sign-on is not available right now. Use your password.",
};

type ClerkSession = { getToken: () => Promise<string | null> };
type ClerkTransferResult = { status?: string | null; createdSessionId?: string | null };
type ClerkInstance = {
  loaded?: boolean;
  session?: ClerkSession | null;
  client?: {
    signIn: {
      authenticateWithRedirect: (params: {
        strategy: "oauth_google" | "oauth_github";
        redirectUrl: string;
        redirectUrlComplete: string;
      }) => Promise<void>;
      create: (params: { transfer: true }) => Promise<ClerkTransferResult>;
    };
    signUp: {
      create: (params: { transfer: true }) => Promise<ClerkTransferResult>;
    };
  };
  load: (options?: Record<string, unknown>) => Promise<void>;
  handleRedirectCallback: (options?: Record<string, unknown>) => Promise<unknown>;
  setActive: (params: { session: string }) => Promise<void>;
  signOut: () => Promise<void>;
};

declare global {
  interface Window {
    Clerk?: (new (publishableKey: string) => ClerkInstance) | ClerkInstance;
  }
}

// clerk-js must load from the instance's own frontend-API domain (the jsdelivr
// mirror is only a webpack chunk registrar and never attaches window.Clerk).
// The publishable key encodes that domain: pk_test_<base64("host$")>.
function clerkScriptSrc(publishableKey: string): string {
  const host = atob(publishableKey.replace(/^pk_(test|live)_/, "")).replace(/\$$/, "");
  return `https://${host}/npm/@clerk/clerk-js@5/dist/clerk.browser.js`;
}

let clerkLoadPromise: Promise<ClerkInstance> | null = null;

// Idempotent: one script tag, one Clerk instance, shared across clicks and the
// callback effect. On failure the promise is reset so a retry re-attempts.
export function loadClerk(publishableKey: string): Promise<ClerkInstance> {
  if (clerkLoadPromise) return clerkLoadPromise;

  clerkLoadPromise = new Promise<ClerkInstance>((resolve, reject) => {
    const fail = (message: string) => {
      clerkLoadPromise = null;
      reject(new Error(message));
    };

    const initialize = async () => {
      try {
        const globalClerk = window.Clerk;
        if (!globalClerk) return fail("Clerk script loaded without a global");
        // The CDN bundle exposes the Clerk class; hotloaded variants may have
        // already constructed an instance. Handle both.
        const clerk =
          typeof globalClerk === "function" ? new globalClerk(publishableKey) : globalClerk;
        if (!clerk.loaded) await clerk.load({ standardBrowser: true });
        resolve(clerk);
      } catch (err) {
        clerkLoadPromise = null;
        reject(err instanceof Error ? err : new Error("Clerk failed to initialize"));
      }
    };

    if (window.Clerk) {
      void initialize();
      return;
    }

    const script = document.createElement("script");
    script.src = clerkScriptSrc(publishableKey);
    script.async = true;
    script.crossOrigin = "anonymous";
    // With this attribute the frontend-API bundle self-initializes window.Clerk
    // as a ready instance; initialize() handles both instance and class shapes.
    script.setAttribute("data-clerk-publishable-key", publishableKey);
    script.onload = () => void initialize();
    script.onerror = () => fail("Clerk script failed to load");
    document.head.appendChild(script);
  });

  return clerkLoadPromise;
}

// Kick off the provider redirect through clerk-js. Clerk returns the browser
// to callbackUrl (same path, ?clerk=cb marker) where finishClerkBridgeCallback
// completes the exchange. Throws on load/redirect failure so callers can map
// it to their oauth_failed status.
export async function startClerkOAuth(
  publishableKey: string,
  provider: ClerkProvider,
  callbackUrl: string,
): Promise<void> {
  const clerk = await loadClerk(publishableKey);
  if (!clerk.client) throw new Error("Clerk client unavailable");
  await clerk.client.signIn.authenticateWithRedirect({
    strategy: `oauth_${provider}`,
    redirectUrl: callbackUrl,
    redirectUrlComplete: callbackUrl,
  });
}

// Transferable flows: the OAuth handshake succeeded but ended on the "wrong"
// Clerk object — a sign-in for an external account with no Clerk user yet
// (new users) or a sign-up for one that already exists. Clerk's documented fix
// is to re-create the flow on the other object with { transfer: true } and
// activate the created session.
async function completeClerkTransfer(clerk: ClerkInstance): Promise<void> {
  if (!clerk.client) return;

  // signIn ended transferable → finish as a sign-up (creates the Clerk user).
  try {
    const signUp = await clerk.client.signUp.create({ transfer: true });
    if (signUp.status === "complete" && signUp.createdSessionId) {
      await clerk.setActive({ session: signUp.createdSessionId });
      return;
    }
  } catch {
    // Fall through to the reverse direction.
  }
  if (clerk.session) return;

  // signUp ended transferable → finish as a sign-in (Clerk user exists).
  try {
    const signIn = await clerk.client.signIn.create({ transfer: true });
    if (signIn.status === "complete" && signIn.createdSessionId) {
      await clerk.setActive({ session: signIn.createdSessionId });
    }
  } catch {
    // The caller's session check reports the failure as oauth_failed.
  }
}

export type ClerkBridgeResult =
  | {
      ok: true;
      next: string | null;
      flow: string | null;
      hasOrg: boolean | null;
      providers: string[];
      alreadyLinked: boolean;
    }
  | { ok: false; code: string };

// Finish a pending Clerk callback: complete the handshake (including the
// transferable sign-in/sign-up repair), swap the Clerk token for our own
// frege_session via the bridge, and sign out of Clerk (identity verification
// only — one source of truth). Never throws; failures come back as codes that
// map onto clerkOAuthStatusText.
export async function finishClerkBridgeCallback(
  publishableKey: string,
  options: { next?: string | null; mode?: "login" | "link" } = {},
): Promise<ClerkBridgeResult> {
  try {
    const clerk = await loadClerk(publishableKey);
    if (!clerk.session) {
      // Completes the sign-in Clerk started before redirecting here. It may
      // trigger a navigation back to this same URL; the session check below
      // covers both the settled and the reloaded pass.
      await clerk.handleRedirectCallback({}).catch(() => {});
    }
    if (!clerk.session) await completeClerkTransfer(clerk);
    if (!clerk.session) throw new Error("no Clerk session after callback");

    const token = await clerk.session.getToken();
    if (!token) throw new Error("Clerk session returned no token");

    const response = await fetch("/api/v1/auth/clerk/bridge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        ...(options.next ? { next: options.next } : {}),
        ...(options.mode ? { mode: options.mode } : {}),
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "oauth_failed" }));
      const code = typeof error.error === "string" ? error.error : "oauth_failed";
      await clerk.signOut().catch(() => {});
      return { ok: false, code };
    }

    const payload = (await response.json().catch(() => ({}))) as {
      next?: unknown;
      flow?: unknown;
      hasOrg?: unknown;
      providers?: unknown;
      already_linked?: unknown;
    };
    await clerk.signOut().catch(() => {});
    return {
      ok: true,
      next: typeof payload.next === "string" ? payload.next : null,
      flow: typeof payload.flow === "string" ? payload.flow : null,
      hasOrg: typeof payload.hasOrg === "boolean" ? payload.hasOrg : null,
      providers: Array.isArray(payload.providers)
        ? payload.providers.filter((entry): entry is string => typeof entry === "string")
        : [],
      alreadyLinked: payload.already_linked === true,
    };
  } catch {
    return { ok: false, code: "oauth_failed" };
  }
}

// The app lives on brain.frege.dev; the marketing site (frege.dev) only hosts
// the public forms. On preview/localhost (no brain subdomain) stay on the
// current origin.
export function appOrigin(): string {
  const { hostname, origin } = window.location;
  if (hostname === "frege.dev") return "https://brain.frege.dev";
  return origin;
}
