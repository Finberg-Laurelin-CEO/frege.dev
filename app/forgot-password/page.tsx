"use client";

import { FormEvent, useState } from "react";
import styles from "../admin/admin.module.css";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setStatus("");

    const response = await fetch("/api/v1/auth/password/reset/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "request_failed" }));
      const code = typeof error.error === "string" ? error.error : "request_failed";
      setStatus(code === "rate_limited" ? "Too many reset attempts. Try again later." : "Could not request a reset link.");
      setPending(false);
      return;
    }

    setSent(true);
    setStatus("If that email has a Frege account, a reset link is on its way.");
    setPending(false);
  }

  return (
    <main id="main" className={styles.shell}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>reset password</h1>
          <p className={styles.meta}>Frege customer workspace</p>
        </div>
        <a className="lnk" href="/login">login</a>
      </div>

      <form className={styles.form} onSubmit={submit}>
        <label className={`${styles.field} ${styles.fieldWide}`}>
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
        <div className={`${styles.buttonRow} ${styles.fieldWide}`}>
          <button className={styles.button} type="submit" disabled={pending || sent}>
            {pending ? "sending..." : sent ? "sent" : "send reset link"}
          </button>
          <span className={styles.status}>{status}</span>
        </div>
      </form>
    </main>
  );
}
