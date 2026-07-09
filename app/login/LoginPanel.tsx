"use client";

import { FormEvent, useEffect, useState } from "react";
import "../auth.css";

const loginStatusText: Record<string, string> = {
  invalid_credentials: "Email or password is incorrect.",
  unauthorized: "Your session could not be created.",
  rate_limited: "Too many login attempts. Try again shortly.",
  validation: "Enter a valid email and password.",
  login_failed: "Could not sign in. Try again.",
  oauth_denied: "Single sign-on was cancelled.",
  oauth_state_mismatch: "That sign-in attempt expired. Try again.",
  oauth_email_missing: "Your provider account has no email address we can use.",
  oauth_email_unverified: "Verify your email with the provider first, then try again.",
  oauth_account_disabled: "This account is disabled.",
  oauth_rate_limited: "Too many sign-in attempts. Try again shortly.",
  oauth_failed: "Single sign-on failed. Try again or use your password.",
  oauth_not_configured: "Single sign-on is not available right now. Use your password.",
};

type OAuthProviders = { google: boolean; github: boolean };

// ── Clerk (CDN-loaded clerk-js) ──────────────────────────────────────────────
//
// Clerk brokers the Google/GitHub handshake in the browser; the bridge endpoint
// then swaps the Clerk session JWT for our own frege_session cookie and we sign
// out of Clerk again — Frege's session stays the single source of truth.
// clerk-js is loaded lazily from the CDN (only when a button is clicked or a
// callback is pending) so the login bundle stays lean and no package is added.

type ClerkSession = { getToken: () => Promise<string | null> };
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
    };
  };
  load: (options?: Record<string, unknown>) => Promise<void>;
  handleRedirectCallback: (options?: Record<string, unknown>) => Promise<unknown>;
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
function loadClerk(publishableKey: string): Promise<ClerkInstance> {
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

export default function LoginPanel({
  oauthProviders = { google: false, github: false },
  clerkPublishableKey = null,
}: {
  oauthProviders?: OAuthProviders;
  clerkPublishableKey?: string | null;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);

  // Surface OAuth callback failures (redirected here as /login?error=oauth_...).
  useEffect(() => {
    const error = new URLSearchParams(window.location.search).get("error");
    if (error) setStatus(loginStatusText[error] ?? loginStatusText.login_failed);
  }, []);

  // The app lives on brain.frege.dev; the marketing site (frege.dev) only hosts
  // the login form. After a successful login we send the user into the app on
  // the brain.* host. On preview/localhost (no brain subdomain) we stay on the
  // current origin.
  function appOrigin(): string {
    const { hostname, origin } = window.location;
    if (hostname === "frege.dev") return "https://brain.frege.dev";
    return origin;
  }

  function safeNextPath(value: string | null): string {
    const fallback = "/console";
    if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;

    try {
      const nextUrl = new URL(value, window.location.origin);
      if (nextUrl.origin !== window.location.origin || nextUrl.pathname === "/login") return fallback;
      return `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
    } catch {
      return fallback;
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setStatus("logging in");

    const response = await fetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "login_failed" }));
      const code = typeof error.error === "string" ? error.error : "login_failed";
      setStatus(loginStatusText[code] ?? loginStatusText.login_failed);
      setPending(false);
      return;
    }

    setStatus("Signed in. Redirecting...");
    window.location.href = `${appOrigin()}${safeNextPath(new URLSearchParams(window.location.search).get("next"))}`;
  }

  // Clerk mode: kick off the provider redirect through clerk-js. Clerk returns
  // the browser to /login?clerk=cb where the effect below finishes the bridge.
  async function startClerkOAuth(provider: "google" | "github") {
    if (!clerkPublishableKey) return;
    setPending(true);
    setStatus(`redirecting to ${provider}...`);

    try {
      const clerk = await loadClerk(clerkPublishableKey);
      if (!clerk.client) throw new Error("Clerk client unavailable");
      const requestedNext = new URLSearchParams(window.location.search).get("next");
      const next = requestedNext ? safeNextPath(requestedNext) : null;
      const callbackUrl = `/login?clerk=cb${next ? `&next=${encodeURIComponent(next)}` : ""}`;
      await clerk.client.signIn.authenticateWithRedirect({
        strategy: `oauth_${provider}`,
        redirectUrl: callbackUrl,
        redirectUrlComplete: callbackUrl,
      });
    } catch {
      setStatus(loginStatusText.oauth_failed);
      setPending(false);
    }
  }

  // Clerk callback: finish the handshake, swap the Clerk token for our own
  // frege_session via the bridge, sign out of Clerk (identity verification
  // only — one source of truth), then enter the app.
  useEffect(() => {
    if (!clerkPublishableKey) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("clerk") !== "cb") return;

    let cancelled = false;

    (async () => {
      setPending(true);
      setStatus("finishing sign-in...");

      try {
        const clerk = await loadClerk(clerkPublishableKey);
        if (!clerk.session) {
          // Completes the sign-in Clerk started before redirecting here. It may
          // trigger a navigation back to this same URL; the session check below
          // covers both the settled and the reloaded pass.
          await clerk.handleRedirectCallback({}).catch(() => {});
        }
        if (!clerk.session) throw new Error("no Clerk session after callback");

        const token = await clerk.session.getToken();
        if (!token) throw new Error("Clerk session returned no token");

        const next = safeNextPath(params.get("next"));
        const response = await fetch("/api/v1/auth/clerk/bridge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, next }),
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: "oauth_failed" }));
          const code = typeof error.error === "string" ? error.error : "oauth_failed";
          await clerk.signOut().catch(() => {});
          if (cancelled) return;
          setStatus(loginStatusText[code] ?? loginStatusText.oauth_failed);
          setPending(false);
          return;
        }

        const payload = (await response.json().catch(() => ({}))) as { next?: unknown };
        await clerk.signOut().catch(() => {});
        if (cancelled) return;
        setStatus("Signed in. Redirecting...");
        const destination = safeNextPath(typeof payload.next === "string" ? payload.next : next);
        window.location.href = `${appOrigin()}${destination}`;
      } catch {
        if (cancelled) return;
        setStatus(loginStatusText.oauth_failed);
        setPending(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clerkPublishableKey]);

  // OAuth start lives on the API host; carry the validated next path through.
  function startOAuth(provider: "google" | "github") {
    const next = new URLSearchParams(window.location.search).get("next");
    const query = next ? `?next=${encodeURIComponent(safeNextPath(next))}` : "";
    window.location.href = `/api/v1/auth/oauth/${provider}/start${query}`;
  }

  return (
    <main id="main" className="auth">
      <section className="auth__card" aria-label="Sign in to Frege">
        <p className="line">
          <span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <span className="cmd">frege login</span>
        </p>
        <h1 className="auth__title">login</h1>
        <p className="auth__meta">Frege customer workspace</p>

        <form className="auth__form" onSubmit={submit}>
          <label className="auth__field">
            <span className="auth__label">email</span>
            <input
              className="auth__input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="auth__field">
            <span className="auth__label">password</span>
            <input
              className="auth__input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <div className="auth__row">
            <button className="button button--primary" type="submit" disabled={pending}>
              login
            </button>
            <span className="auth__status" role="status">{status}</span>
          </div>
        </form>

        {/* Customer OAuth — self-contained block. Clerk mode (publishable key
            present) wins over the hand-rolled providers, which stay as the
            dormant fallback. */}
        {clerkPublishableKey ? (
          <div className="auth__form" aria-label="Single sign-on">
            <p className="auth__meta">or continue with</p>
            <div className="auth__row">
              <button className="button" type="button" disabled={pending} onClick={() => startClerkOAuth("google")}>
                Continue with Google
              </button>
              <button className="button" type="button" disabled={pending} onClick={() => startClerkOAuth("github")}>
                Continue with GitHub
              </button>
            </div>
          </div>
        ) : (oauthProviders.google || oauthProviders.github) ? (
          <div className="auth__form" aria-label="Single sign-on">
            <p className="auth__meta">or continue with</p>
            <div className="auth__row">
              {oauthProviders.google ? (
                <button className="button" type="button" disabled={pending} onClick={() => startOAuth("google")}>
                  Continue with Google
                </button>
              ) : null}
              {oauthProviders.github ? (
                <button className="button" type="button" disabled={pending} onClick={() => startOAuth("github")}>
                  Continue with GitHub
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        <p className="auth__links">
          <a className="lnk" href="/forgot-password">Forgot your password?</a>
          <a className="lnk" href="/signup">Create an account</a>
          <a className="lnk" href="/">Home</a>
        </p>
      </section>
    </main>
  );
}
