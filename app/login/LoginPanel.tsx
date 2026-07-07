"use client";

import { FormEvent, useState } from "react";
import styles from "../admin/admin.module.css";

const loginStatusText: Record<string, string> = {
  invalid_credentials: "Email or password is incorrect.",
  unauthorized: "Your session could not be created.",
  rate_limited: "Too many login attempts. Try again shortly.",
  validation: "Enter a valid email and password.",
  login_failed: "Could not sign in. Try again.",
};

export default function LoginPanel() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);

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
    </main>
  );
}
