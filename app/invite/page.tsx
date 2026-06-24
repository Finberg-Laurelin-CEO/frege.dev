"use client";

import { FormEvent, useEffect, useState } from "react";
import styles from "../admin/admin.module.css";

const inviteStatusText: Record<string, string> = {
  invalid_invite: "This invite is invalid, expired, or already used.",
  validation: "Enter your invite token, name, and a password of at least 12 characters.",
  rate_limited: "Too many invite attempts. Try again shortly.",
  invite_failed: "Could not accept invite. Try again.",
};

export default function InvitePage() {
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token") ?? "");
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setStatus("accepting invite");

    const response = await fetch("/api/v1/auth/invites/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, name, password }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "invite_failed" }));
      const code = typeof error.error === "string" ? error.error : "invite_failed";
      setStatus(inviteStatusText[code] ?? inviteStatusText.invite_failed);
      setPending(false);
      return;
    }

    const json = await response.json().catch(() => ({ next_path: "/admin" }));
    setStatus("Invite accepted. Redirecting...");
    window.location.href = typeof json.next_path === "string" ? json.next_path : "/admin";
  }

  return (
    <main id="main" className={styles.shell}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>accept invite</h1>
          <p className={styles.meta}>create your Frege login and join the org</p>
        </div>
        <a className="lnk" href="/login">login</a>
      </div>

      <form className={styles.form} onSubmit={submit}>
        <label className={`${styles.field} ${styles.fieldWide}`}>
          <span className={styles.label}>invite token</span>
          <input className={styles.input} required value={token} onChange={(event) => setToken(event.target.value)} />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>name</span>
          <input
            className={styles.input}
            required
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>password</span>
          <input
            className={styles.input}
            type="password"
            required
            autoComplete="new-password"
            minLength={12}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <div className={styles.buttonRow}>
          <button className={styles.button} type="submit" disabled={pending || !token}>
            accept invite
          </button>
          <span className={styles.status}>{status}</span>
        </div>
      </form>
    </main>
  );
}
