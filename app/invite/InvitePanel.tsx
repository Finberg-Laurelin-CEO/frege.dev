"use client";

import { FormEvent, useEffect, useState } from "react";
import "../auth.css";

const inviteStatusText: Record<string, string> = {
  invalid_invite: "This invite is invalid, expired, or already used.",
  validation: "Enter your invite token, name, and a password of at least 12 characters.",
  rate_limited: "Too many invite attempts. Try again shortly.",
  invite_failed: "Could not accept invite. Try again.",
};

export default function InvitePanel() {
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
    <main id="main" className="auth">
      <section className="auth__card" aria-label="Accept a Frege invite">
        <p className="line">
          <span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <span className="cmd">frege invite --accept</span>
        </p>
        <h1 className="auth__title">accept invite</h1>
        <p className="auth__meta">Create your Frege login and join the org.</p>

        <form className="auth__form" onSubmit={submit}>
          <label className="auth__field">
            <span className="auth__label">invite token</span>
            <input
              className="auth__input"
              required
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </label>
          <label className="auth__field">
            <span className="auth__label">name</span>
            <input
              className="auth__input"
              required
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="auth__field">
            <span className="auth__label">password</span>
            <input
              className="auth__input"
              type="password"
              required
              autoComplete="new-password"
              minLength={12}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <div className="auth__row">
            <button className="button button--primary" type="submit" disabled={pending || !token}>
              accept invite
            </button>
            <span className="auth__status" role="status">{status}</span>
          </div>
        </form>

        <p className="auth__links">
          <a className="lnk" href="/login">Already have an account? Sign in</a>
        </p>
      </section>
    </main>
  );
}
