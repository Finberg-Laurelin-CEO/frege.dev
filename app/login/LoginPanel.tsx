"use client";

import { FormEvent, useState } from "react";
import styles from "../admin/admin.module.css";

export default function LoginPanel() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);

  function safeNextPath(value: string | null): string {
    if (!value || !value.startsWith("/") || value.startsWith("//") || value === "/login") return "/admin";
    return value;
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
      setStatus(error.error ?? "login_failed");
      setPending(false);
      return;
    }

    setStatus("ok");
    window.location.href = safeNextPath(new URLSearchParams(window.location.search).get("next"));
  }

  return (
    <main id="main" className={styles.shell}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>login</h1>
          <p className={styles.meta}>frege internal control plane</p>
        </div>
        <a className="lnk" href="/">home</a>
      </div>

      <form className={styles.form} onSubmit={submit}>
        <label className={styles.field}>
          <span className={styles.label}>email</span>
          <input className={styles.input} type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>password</span>
          <input
            className={styles.input}
            type="password"
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
      </form>
    </main>
  );
}
