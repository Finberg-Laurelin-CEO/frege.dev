"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { COMPANY_SIZES, clientSchema, signupFields } from "@/lib/signup-schema";
import "./signup.css";

type Values = {
  name: string;
  work_email: string;
  company: string;
  role: string;
  company_size: string;
  expected_users: string;
  current_agent_tools: string[];
  other_tool: string;
  monthly_ai_spend: string;
  willing_to_pay: string;
  decision_timeline: string;
  main_pain_point: string;
  other_comments: string;
  permission_to_contact: boolean;
};

type RecoveryAction = "sign_in" | "resend_invite_available" | "already_requested";

type RecoveryState = {
  action: RecoveryAction;
  requested_at: string | null;
  email: string;
  resendStatus: "idle" | "sending" | "sent" | "rate_limited" | "error";
};

const NOT_PROVIDED = "Not provided";

const EMPTY: Values = {
  name: "",
  work_email: "",
  company: "",
  role: "",
  company_size: "",
  expected_users: "0",
  current_agent_tools: [],
  other_tool: "",
  monthly_ai_spend: NOT_PROVIDED,
  willing_to_pay: NOT_PROVIDED,
  decision_timeline: NOT_PROVIDED,
  main_pain_point: "",
  other_comments: "",
  permission_to_contact: true,
};

const LABELS: Record<keyof Values, string> = {
  name: "Full name",
  work_email: "Work email",
  company: "Company",
  role: "Role / title",
  company_size: "Org size",
  expected_users: "Expected number of users",
  current_agent_tools: "Current agent tools",
  other_tool: "Other tool",
  monthly_ai_spend: "Monthly AI / tool spend",
  willing_to_pay: "What you'd expect to pay",
  decision_timeline: "Decision timeline",
  main_pain_point: "Other info",
  other_comments: "Anything else",
  permission_to_contact: "Permission to contact",
};

const VISIBLE_FIELDS: (keyof Values)[] = [
  "name",
  "work_email",
  "company",
  "role",
  "company_size",
  "main_pain_point",
];

function fieldError(key: keyof Values, values: Values): string | null {
  const result = signupFields[key].safeParse(values[key]);
  return result.success ? null : result.error.issues[0]?.message ?? "Invalid.";
}

function formatRequestDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function isRecoveryAction(value: unknown): value is RecoveryAction {
  return value === "sign_in" || value === "resend_invite_available" || value === "already_requested";
}

export default function Signup() {
  const router = useRouter();
  const [values, setValues] = useState<Values>(EMPTY);
  const [touched, setTouched] = useState<Partial<Record<keyof Values, boolean>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<RecoveryState | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const startedAt = useRef<number>(0);
  const honeypot = useRef<HTMLInputElement>(null);

  useEffect(() => {
    startedAt.current = Date.now();
  }, []);

  const errors = useMemo(() => {
    const e: Partial<Record<keyof Values, string>> = {};
    (Object.keys(signupFields) as (keyof Values)[]).forEach((k) => {
      const msg = fieldError(k, values);
      if (msg) e[k] = msg;
    });
    return e;
  }, [values]);

  const isValid = Object.keys(errors).length === 0;
  const visibleErrors = VISIBLE_FIELDS.filter((key) => errors[key] && (touched[key] || showSummary));

  function set<K extends keyof Values>(key: K, val: Values[K]) {
    setValues((v) => ({ ...v, [key]: val }));
  }

  function markTouched(key: keyof Values) {
    setTouched((t) => ({ ...t, [key]: true }));
  }

  function fieldClass(key: keyof Values) {
    return "field" + (errors[key] && (touched[key] || showSummary) ? " invalid" : "");
  }

  function errFor(key: keyof Values) {
    if (!errors[key] || !(touched[key] || showSummary)) return null;
    return (
      <span className="err" id={`err-${key}`}>
        {errors[key]}
      </span>
    );
  }

  async function onResendSetupEmail() {
    if (!recovery || recovery.action !== "resend_invite_available") return;

    setRecovery((state) => state ? { ...state, resendStatus: "sending" } : state);
    try {
      const res = await fetch("/api/signup/recovery/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: recovery.email }),
      });

      if (res.ok) {
        setRecovery((state) => state ? { ...state, resendStatus: "sent" } : state);
      } else if (res.status === 429) {
        setRecovery((state) => state ? { ...state, resendStatus: "rate_limited" } : state);
      } else {
        setRecovery((state) => state ? { ...state, resendStatus: "error" } : state);
      }
    } catch {
      setRecovery((state) => state ? { ...state, resendStatus: "error" } : state);
    }
  }

  async function onSubmit(e: { preventDefault: () => void }) {
    e.preventDefault();
    setSubmitError(null);
    setRecovery(null);

    const parsed = clientSchema.safeParse(values);
    if (!parsed.success) {
      setShowSummary(true);
      setTouched(Object.fromEntries(VISIBLE_FIELDS.map((k) => [k, true])));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...parsed.data,
          company_url: honeypot.current?.value ?? "",
          started_at: startedAt.current,
        }),
      });

      if (res.ok) {
        router.push("/thanks");
        return;
      }
      if (res.status === 409) {
        const payload = await res.json().catch(() => null) as {
          recovery?: { action?: unknown; requested_at?: string | null };
        } | null;
        const action = payload?.recovery?.action;
        setRecovery({
          action: isRecoveryAction(action) ? action : "already_requested",
          requested_at: payload?.recovery?.requested_at ?? null,
          email: parsed.data.work_email,
          resendStatus: "idle",
        });
      } else if (res.status === 400) {
        setSubmitError("Some fields need fixing. Please review and try again.");
        setShowSummary(true);
      } else {
        setSubmitError("Something went wrong submitting the form. Please try again.");
      }
    } catch {
      setSubmitError("Network error — please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const requestDate = formatRequestDate(recovery?.requested_at ?? null);

  return (
    <main id="main" className="screen">
      <section aria-label="Request pilot access">
        <p className="line"><span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <span className="cmd">frege pilot --request</span></p>
        <h1 className="hero-tag" style={{ marginTop: "8px" }}>request pilot access</h1>
        <p className="out wrap">
          Short form. We use this to confirm fit and provision a pilot org.
        </p>

        <div className="pilot-get" aria-label="What you get in the pilot">
          <p className="pilot-get__head"># what you get in the pilot</p>
          <ul className="pilot-get__list">
            <li>A hosted brain provisioned for your org</li>
            <li>Your first per-user MCP keys</li>
            <li>Trust-zone setup, done with you</li>
            <li>Hands-on onboarding to connect your first sources</li>
            <li>A reply within two business days</li>
          </ul>
        </div>

        {showSummary && visibleErrors.length > 0 && (
          <div className="summary" role="alert" aria-live="assertive">
            <p>Please fix the following before submitting:</p>
            <ul>
              {visibleErrors.map((key) => (
                <li key={key}>
                  <a href={`#field-${key}`}>{LABELS[key]}</a>: {errors[key]}
                </li>
              ))}
            </ul>
          </div>
        )}

        {submitError && (
          <div className="summary" role="alert" aria-live="assertive">
            <p>{submitError}</p>
          </div>
        )}

        {recovery && (
          <div className="summary" role="alert" aria-live="assertive">
            {recovery.action === "sign_in" && (
              <>
                <p>This email already has an account. Sign in to continue.</p>
                {requestDate && <p className="summary-meta">Original request: {requestDate}.</p>}
                <p className="summary-actions"><a className="lnk" href="/login">Sign in</a></p>
              </>
            )}
            {recovery.action === "resend_invite_available" && (
              <>
                <p>We found your approved request. Resend the setup email to continue.</p>
                {requestDate && <p className="summary-meta">Original request: {requestDate}.</p>}
                <p className="summary-actions">
                  <button
                    className="summary-button"
                    type="button"
                    onClick={onResendSetupEmail}
                    disabled={recovery.resendStatus === "sending" || recovery.resendStatus === "sent"}
                  >
                    {recovery.resendStatus === "sending" ? "Resending..." : "Resend setup email"}
                  </button>
                </p>
                {recovery.resendStatus === "sent" && (
                  <p className="summary-meta">If the setup email is still pending, we sent a fresh copy.</p>
                )}
                {recovery.resendStatus === "rate_limited" && (
                  <p className="summary-meta">Too many resend attempts. Try again later.</p>
                )}
                {recovery.resendStatus === "error" && (
                  <p className="summary-meta">We could not resend that email. Please try again.</p>
                )}
              </>
            )}
            {recovery.action === "already_requested" && (
              <>
                <p>We already have a request for this email. We'll follow up after review.</p>
                {requestDate && <p className="summary-meta">Original request: {requestDate}.</p>}
              </>
            )}
          </div>
        )}

        <form className="form form--compact" onSubmit={onSubmit} noValidate>
          <div className="hp" aria-hidden="true">
            <label htmlFor="company_url">Company URL</label>
            <input
              ref={honeypot}
              id="company_url"
              name="company_url"
              type="text"
              tabIndex={-1}
              autoComplete="off"
            />
          </div>

          <fieldset>
            <legend># pilot request</legend>

            <div className="compact-grid">
              <div className={fieldClass("name")} id="field-name">
                <label htmlFor="name">{LABELS.name} <span className="req">*</span></label>
                <input
                  id="name"
                  type="text"
                  autoComplete="name"
                  value={values.name}
                  onChange={(e) => set("name", e.target.value)}
                  onBlur={() => markTouched("name")}
                  aria-invalid={!!(errors.name && (touched.name || showSummary))}
                  aria-describedby={errors.name ? "err-name" : undefined}
                />
                {errFor("name")}
              </div>

              <div className={fieldClass("work_email")} id="field-work_email">
                <label htmlFor="work_email">{LABELS.work_email} <span className="req">*</span></label>
                <input
                  id="work_email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  value={values.work_email}
                  onChange={(e) => set("work_email", e.target.value)}
                  onBlur={() => markTouched("work_email")}
                  aria-invalid={!!(errors.work_email && (touched.work_email || showSummary))}
                  aria-describedby={errors.work_email ? "err-work_email" : undefined}
                />
                {errFor("work_email")}
              </div>

              <div className={fieldClass("company")} id="field-company">
                <label htmlFor="company">{LABELS.company} <span className="req">*</span></label>
                <input
                  id="company"
                  type="text"
                  autoComplete="organization"
                  value={values.company}
                  onChange={(e) => set("company", e.target.value)}
                  onBlur={() => markTouched("company")}
                  aria-invalid={!!(errors.company && (touched.company || showSummary))}
                  aria-describedby={errors.company ? "err-company" : undefined}
                />
                {errFor("company")}
              </div>

              <div className={fieldClass("role")} id="field-role">
                <label htmlFor="role">{LABELS.role} <span className="path">(optional)</span></label>
                <input
                  id="role"
                  type="text"
                  autoComplete="organization-title"
                  value={values.role}
                  onChange={(e) => set("role", e.target.value)}
                  onBlur={() => markTouched("role")}
                  aria-invalid={!!(errors.role && (touched.role || showSummary))}
                  aria-describedby={errors.role ? "err-role" : undefined}
                />
                {errFor("role")}
              </div>
            </div>

            <div className={fieldClass("company_size")} id="field-company_size">
              <label htmlFor="company_size">{LABELS.company_size} <span className="req">*</span></label>
              <select
                id="company_size"
                value={values.company_size}
                onChange={(e) => set("company_size", e.target.value)}
                onBlur={() => markTouched("company_size")}
                aria-invalid={!!(errors.company_size && (touched.company_size || showSummary))}
                aria-describedby={errors.company_size ? "err-company_size" : undefined}
              >
                <option value="">— select —</option>
                {COMPANY_SIZES.map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
              {errFor("company_size")}
            </div>

            <div className={fieldClass("main_pain_point")} id="field-main_pain_point">
              <label htmlFor="main_pain_point">{LABELS.main_pain_point} <span className="path">(optional)</span></label>
              <textarea
                id="main_pain_point"
                value={values.main_pain_point}
                onChange={(e) => set("main_pain_point", e.target.value)}
                onBlur={() => markTouched("main_pain_point")}
                maxLength={1000}
                placeholder="Agent stack, source count, or what you want Frege to connect first."
                aria-invalid={!!(errors.main_pain_point && (touched.main_pain_point || showSummary))}
                aria-describedby={errors.main_pain_point ? "err-main_pain_point" : undefined}
              />
              {errFor("main_pain_point")}
            </div>
          </fieldset>

          <p className="line cta-big" style={{ marginBottom: "6px" }}>
            <button className="submit" type="submit" disabled={!isValid || submitting}>
              {submitting ? "submitting…" : "request access →"}
            </button>
          </p>
          <p className="out muted">
            By submitting, you agree that we may email you about Frege pilot access. See our <a className="lnk" href="/privacy">privacy policy</a> and <a className="lnk" href="/terms">terms</a>.
          </p>
        </form>
      </section>
    </main>
  );
}
