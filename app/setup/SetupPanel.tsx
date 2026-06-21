"use client";

import { FormEvent, useState } from "react";
import styles from "../admin/admin.module.css";

export default function SetupPanel() {
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("Frege Local");
  const [orgSlug, setOrgSlug] = useState("frege-local");
  const [status, setStatus] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFieldErrors({});
    setStatus("bootstrapping");

    const response = await fetch("/api/v1/auth/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        email,
        name,
        password,
        org_name: orgName,
        org_slug: orgSlug,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "bootstrap_failed" }));
      setFieldErrors(error.fieldErrors ?? {});
      setStatus(error.error ?? "bootstrap_failed");
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
          <h1 className={styles.title}>setup</h1>
          <p className={styles.meta}>bootstrap first admin and org</p>
        </div>
        <a className="lnk" href="/login">login</a>
      </div>

      <form className={styles.form} onSubmit={submit}>
        <label className={`${styles.field} ${styles.fieldWide}`}>
          <span className={styles.label}>bootstrap token</span>
          <input className={styles.input} required value={token} onChange={(event) => setToken(event.target.value)} />
          {fieldErrors.token && <span className={styles.status}>{fieldErrors.token.join(", ")}</span>}
        </label>
        <label className={styles.field}>
          <span className={styles.label}>email</span>
          <input className={styles.input} required type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          {fieldErrors.email && <span className={styles.status}>{fieldErrors.email.join(", ")}</span>}
        </label>
        <label className={styles.field}>
          <span className={styles.label}>name</span>
          <input className={styles.input} required value={name} onChange={(event) => setName(event.target.value)} />
          {fieldErrors.name && <span className={styles.status}>{fieldErrors.name.join(", ")}</span>}
        </label>
        <label className={styles.field}>
          <span className={styles.label}>password</span>
          <input
            className={styles.input}
            type="password"
            required
            minLength={12}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {fieldErrors.password && <span className={styles.status}>{fieldErrors.password.join(", ")}</span>}
        </label>
        <label className={styles.field}>
          <span className={styles.label}>org name</span>
          <input className={styles.input} required value={orgName} onChange={(event) => setOrgName(event.target.value)} />
          {fieldErrors.org_name && <span className={styles.status}>{fieldErrors.org_name.join(", ")}</span>}
        </label>
        <label className={styles.field}>
          <span className={styles.label}>org slug</span>
          <input className={styles.input} value={orgSlug} onChange={(event) => setOrgSlug(event.target.value)} />
          {fieldErrors.org_slug && <span className={styles.status}>{fieldErrors.org_slug.join(", ")}</span>}
        </label>
        <div className={styles.buttonRow}>
          <button className={styles.button} type="submit" disabled={pending}>
            bootstrap
          </button>
          <span className={styles.status}>{status}</span>
        </div>
      </form>
    </main>
  );
}
