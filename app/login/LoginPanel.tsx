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
};

type OAuthProviders = { google: boolean; github: boolean };

export default function LoginPanel({
  oauthProviders = { google: false, github: false },
}: {
  oauthProviders?: OAuthProviders;
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

        {/* Customer OAuth — self-contained block, rendered only when configured. */}
        {(oauthProviders.google || oauthProviders.github) ? (
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
