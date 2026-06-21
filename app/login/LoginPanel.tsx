"use client";

import { FormEvent, useState } from "react";
import styles from "../admin/admin.module.css";

export default function LoginPanel() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);

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
    window.location.href = "/admin";
  }

  return (
    <main id="main" className={styles.shell}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>login</h1>
          <p className={styles.meta}>frege admin control plane</p>
        </div>
        <a className="lnk" href="/setup">setup</a>
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
