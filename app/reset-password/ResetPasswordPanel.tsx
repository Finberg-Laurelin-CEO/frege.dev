"use client";

import { FormEvent, useState } from "react";
import styles from "../admin/admin.module.css";

const resetStatusText: Record<string, string> = {
  invalid_or_expired_token: "That reset link is invalid or expired. Request a fresh one.",
  rate_limited: "Too many reset attempts. Try again shortly.",
  validation: "Check the password fields and try again.",
  reset_failed: "Could not reset your password. Try again.",
};

function appOrigin(): string {
  const { hostname, origin } = window.location;
  if (hostname === "frege.dev") return "https://brain.frege.dev";
  return origin;
}

export default function ResetPasswordPanel({ initialToken }: { initialToken: string }) {
  const [token] = useState(initialToken);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setStatus("resetting password");

    const response = await fetch("/api/v1/auth/password/reset/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password, confirm_password: confirmPassword }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "reset_failed" }));
      const code = typeof error.error === "string" ? error.error : "reset_failed";
      setStatus(resetStatusText[code] ?? resetStatusText.reset_failed);
      setPending(false);
      return;
    }

    const payload = await response.json().catch(() => ({ next_path: "/console" }));
    const nextPath = typeof payload.next_path === "string" && payload.next_path.startsWith("/") ? payload.next_path : "/console";
    setStatus("Password reset. Redirecting...");
    window.location.href = `${appOrigin()}${nextPath}`;
  }

  return (
    <main id="main" className={styles.shell}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>set new password</h1>
          <p className={styles.meta}>Frege customer workspace</p>
        </div>
        <a className="lnk" href="/login">login</a>
      </div>

      {!token ? (
        <section className={styles.section}>
          <p className={styles.meta}>This reset link is missing a token.</p>
          <p className={styles.meta}>
            <a className="lnk" href="/forgot-password">Request a fresh reset link</a>.
          </p>
        </section>
      ) : (
        <form className={styles.form} onSubmit={submit}>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span className={styles.label}>new password</span>
            <input
              className={styles.input}
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span className={styles.label}>confirm password</span>
            <input
              className={styles.input}
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </label>
          <div className={`${styles.buttonRow} ${styles.fieldWide}`}>
            <button className={styles.button} type="submit" disabled={pending}>
              {pending ? "resetting..." : "reset password"}
            </button>
            <span className={styles.status}>{status}</span>
          </div>
        </form>
      )}
    </main>
  );
}
