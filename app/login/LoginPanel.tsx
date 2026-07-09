"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  appOrigin,
  clerkOAuthStatusText,
  finishClerkBridgeCallback,
  startClerkOAuth,
} from "@/app/components/clerk-client";
import "../auth.css";

const loginStatusText: Record<string, string> = {
  invalid_credentials: "Email or password is incorrect.",
  unauthorized: "Your session could not be created.",
  rate_limited: "Too many login attempts. Try again shortly.",
  validation: "Enter a valid email and password.",
  login_failed: "Could not sign in. Try again.",
  login_link_invalid: "That sign-in link is invalid or expired. Request a fresh one below.",
  ...clerkOAuthStatusText,
};

type OAuthProviders = { google: boolean; github: boolean };

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
  const [linkSent, setLinkSent] = useState(false);

  // Surface OAuth callback failures (redirected here as /login?error=oauth_...).
  useEffect(() => {
    const error = new URLSearchParams(window.location.search).get("error");
    if (error) setStatus(loginStatusText[error] ?? loginStatusText.login_failed);
  }, []);

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

  // Frege-native email sign-in link (no Clerk): reuses the email field above.
  // The request endpoint is enumeration-safe, so success copy is generic.
  async function requestLoginLink() {
    if (!email.trim()) {
      setStatus("Enter your email above first.");
      return;
    }
    setPending(true);
    setStatus("sending sign-in link...");

    try {
      const requestedNext = new URLSearchParams(window.location.search).get("next");
      const response = await fetch("/api/v1/auth/login-link/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          ...(requestedNext ? { next: safeNextPath(requestedNext) } : {}),
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "login_failed" }));
        const code = typeof error.error === "string" ? error.error : "login_failed";
        setStatus(
          code === "validation"
            ? "Enter a valid email above first."
            : loginStatusText[code] ?? loginStatusText.login_failed,
        );
        setPending(false);
        return;
      }

      setLinkSent(true);
      setStatus("link sent — check your email");
    } catch {
      setStatus(loginStatusText.login_failed);
    }
    setPending(false);
  }

  // Clerk mode: kick off the provider redirect through clerk-js. Clerk returns
  // the browser to /login?clerk=cb where the effect below finishes the bridge.
  async function startClerkLogin(provider: "google" | "github") {
    if (!clerkPublishableKey) return;
    setPending(true);
    setStatus(`redirecting to ${provider}...`);

    try {
      const requestedNext = new URLSearchParams(window.location.search).get("next");
      const next = requestedNext ? safeNextPath(requestedNext) : null;
      const callbackUrl = `/login?clerk=cb${next ? `&next=${encodeURIComponent(next)}` : ""}`;
      await startClerkOAuth(clerkPublishableKey, provider, callbackUrl);
    } catch {
      setStatus(loginStatusText.oauth_failed);
      setPending(false);
    }
  }

  // Clerk callback: finish the handshake (including the transferable
  // sign-in/sign-up repair for first-time users), swap the Clerk token for our
  // own frege_session via the bridge, then enter the app. Brand-new users and
  // users without an org land on /setup-workspace to create one.
  useEffect(() => {
    if (!clerkPublishableKey) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("clerk") !== "cb") return;

    let cancelled = false;

    (async () => {
      setPending(true);
      setStatus("finishing sign-in...");

      const next = safeNextPath(params.get("next"));
      const result = await finishClerkBridgeCallback(clerkPublishableKey, { next });
      if (cancelled) return;

      if (!result.ok) {
        setStatus(loginStatusText[result.code] ?? loginStatusText.oauth_failed);
        setPending(false);
        return;
      }

      setStatus("Signed in. Redirecting...");
      const destination =
        result.flow === "created" || result.hasOrg === false
          ? "/setup-workspace"
          : safeNextPath(result.next ?? next);
      window.location.href = `${appOrigin()}${destination}`;
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

        <p className="auth__note">
          No password handy?{" "}
          <button
            className="lnk auth__linkbtn"
            type="button"
            disabled={pending || linkSent}
            onClick={requestLoginLink}
          >
            {linkSent ? "link sent — check your email" : "email me a sign-in link"}
          </button>
        </p>

        {/* Customer OAuth — self-contained block. Clerk mode (publishable key
            present) wins over the hand-rolled providers, which stay as the
            dormant fallback. */}
        {clerkPublishableKey ? (
          <div className="auth__form" aria-label="Single sign-on">
            <p className="auth__meta">or continue with</p>
            <div className="auth__row">
              <button className="button" type="button" disabled={pending} onClick={() => startClerkLogin("google")}>
                Continue with Google
              </button>
              <button className="button" type="button" disabled={pending} onClick={() => startClerkLogin("github")}>
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
