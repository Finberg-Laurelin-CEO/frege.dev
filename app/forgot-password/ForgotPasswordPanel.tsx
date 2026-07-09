"use client";

import { FormEvent, useState } from "react";
import "../auth.css";

export default function ForgotPasswordPanel() {
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
    <main id="main" className="auth">
      <section className="auth__card" aria-label="Request a password reset">
        <p className="line">
          <span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <span className="cmd">frege password --reset</span>
        </p>
        <h1 className="auth__title">reset password</h1>
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
          <div className="auth__row">
            <button className="button button--primary" type="submit" disabled={pending || sent}>
              {pending ? "sending..." : sent ? "sent" : "send reset link"}
            </button>
            <span className="auth__status" role="status">{status}</span>
          </div>
        </form>

        <p className="auth__links">
          <a className="lnk" href="/login">Back to login</a>
          <a className="lnk" href="/signup">Create an account</a>
        </p>
      </section>
    </main>
  );
}
