"use client";

import { FormEvent, useEffect, useState } from "react";
import styles from "../admin/admin.module.css";

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
    <main id="main" className={styles.shell}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>login</h1>
          <p className={styles.meta}>Frege customer workspace</p>
        </div>
        <a className="lnk" href="/">home</a>
      </div>

      <form className={styles.form} onSubmit={submit}>
        <label className={styles.field}>
          <span className={styles.label}>email</span>
          <input
            className={styles.input}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>password</span>
          <input
            className={styles.input}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <div className={styles.buttonRow}>
          <button className={styles.button} type="submit" disabled={pending}>
            login
          </button>
          <span className={styles.status}>{status}</span>
        </div>
        <p className={`${styles.meta} ${styles.fieldWide}`}>
          <a className="lnk" href="/forgot-password">Forgot your password?</a>
        </p>
      </form>

      {/* Customer OAuth — self-contained block, rendered only when configured. */}
      {(oauthProviders.google || oauthProviders.github) ? (
        <div className={styles.form} aria-label="Single sign-on">
          <p className={styles.meta}>or continue with</p>
          <div className={styles.buttonRow}>
            {oauthProviders.google ? (
              <button className={styles.button} type="button" disabled={pending} onClick={() => startOAuth("google")}>
                Continue with Google
              </button>
            ) : null}
            {oauthProviders.github ? (
              <button className={styles.button} type="button" disabled={pending} onClick={() => startOAuth("github")}>
                Continue with GitHub
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}
