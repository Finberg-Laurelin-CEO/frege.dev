"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { COMPANY_SIZES, clientFields, clientSchema } from "@/lib/signup-schema";
import "./signup.css";

type PlanKey = "solo" | "team-monthly" | "team-annual";

type Values = {
  name: string;
  work_email: string;
  password: string;
  confirm_password: string;
  plan: PlanKey;
  seats: string;
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
  password: "",
  confirm_password: "",
  plan: "solo",
  seats: "1",
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
  password: "Password",
  confirm_password: "Confirm password",
  plan: "Plan",
  seats: "Seats",
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
  "password",
  "confirm_password",
  "plan",
  "seats",
  "company",
  "role",
  "company_size",
  "main_pain_point",
];

const PLAN_OPTIONS: Array<{
  key: PlanKey;
  name: string;
  price: string;
  detail: string;
}> = [
  {
    key: "solo",
    name: "Solo",
    price: "$20 / month",
    detail: "One user, hosted brain, MCP access, governed memory.",
  },
  {
    key: "team-monthly",
    name: "Team monthly",
    price: "$20 / user / month",
    detail: "Shared org brain with roles, audit, and monthly billing.",
  },
  {
    key: "team-annual",
    name: "Team annual",
    price: "$15 / user / month",
    detail: "Team plan billed yearly at $180 per user.",
  },
];

function isPlanKey(value: string | null): value is PlanKey {
  return PLAN_OPTIONS.some((option) => option.key === value);
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

function appOrigin(): string {
  const { hostname, origin } = window.location;
  if (hostname === "frege.dev") return "https://brain.frege.dev";
  return origin;
}

function safeNextPath(value: unknown): string {
  const fallback = "/console?view=account";
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return fallback;

  try {
    const nextUrl = new URL(value, window.location.origin);
    if (nextUrl.origin !== window.location.origin) return fallback;
    return `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
  } catch {
    return fallback;
  }
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
    const plan = new URLSearchParams(window.location.search).get("plan");
    if (isPlanKey(plan)) {
      setValues((v) => ({
        ...v,
        plan,
        seats: plan === "solo" ? "1" : v.seats === "1" ? "2" : v.seats,
      }));
    }
  }, []);

  const errors = useMemo(() => {
    const parsed = clientSchema.safeParse(values);
    if (parsed.success) return {};

    const e: Partial<Record<keyof Values, string>> = {};
    const fieldErrors = parsed.error.flatten().fieldErrors;
    (Object.keys(clientFields) as (keyof Values)[]).forEach((k) => {
      const msg = fieldErrors[k]?.[0];
      if (msg) e[k] = msg;
    });
    return e;
  }, [values]);

  const isValid = Object.keys(errors).length === 0;
  const visibleErrors = VISIBLE_FIELDS.filter((key) => errors[key] && (touched[key] || showSummary));

  function set<K extends keyof Values>(key: K, val: Values[K]) {
    setValues((v) => ({ ...v, [key]: val }));
  }

  function setPlan(plan: PlanKey) {
    setValues((v) => ({
      ...v,
      plan,
      seats: plan === "solo" ? "1" : v.seats === "1" ? "2" : v.seats,
    }));
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
        const payload = await res.json().catch(() => null) as { next_path?: unknown } | null;
        const nextPath = safeNextPath(payload?.next_path);
        if (nextPath.startsWith("/console")) {
          window.location.href = `${appOrigin()}${nextPath}`;
        } else {
          router.push(nextPath);
        }
        return;
      }
      if (res.status === 409) {
        const payload = await res.json().catch(() => null) as {
          error?: unknown;
          recovery?: { action?: unknown; requested_at?: string | null };
        } | null;
        const action = payload?.recovery?.action;
        setRecovery({
          action: payload?.error === "account_exists" ? "sign_in" : isRecoveryAction(action) ? action : "already_requested",
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
  const selectedPlan = PLAN_OPTIONS.find((option) => option.key === values.plan) ?? PLAN_OPTIONS[0];

  return (
    <main id="main" className="screen">
      <section aria-label="Create a Frege account">
        <p className="line"><span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <span className="cmd">frege signup --start</span></p>
        <h1 className="hero-tag" style={{ marginTop: "8px" }}>create your Frege account</h1>
        <p className="out wrap">
          Create an org, choose a plan, verify your email, and open your account page. Stripe starts later from billing when you are ready.
        </p>

        <div className="pilot-get" aria-label="What you get">
          <p className="pilot-get__head"># what happens next</p>
          <ul className="pilot-get__list">
            <li>Your org is created immediately</li>
            <li>Your setup email includes a verification link</li>
            <li>Your account page opens after signup</li>
            <li>You can tour overview, knowledge, access, and connect before payment</li>
            <li>Stripe billing activates the org after email verification</li>
            <li>API keys and write actions unlock after activation</li>
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
                <p>This email already has a Frege account. Sign in to continue.</p>
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
                <p>We already have this email on file. Sign in if you have an account, or contact us if you need help.</p>
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
            <legend># account</legend>

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

              <div className={fieldClass("password")} id="field-password">
                <label htmlFor="password">{LABELS.password} <span className="req">*</span></label>
                <input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  value={values.password}
                  onChange={(e) => set("password", e.target.value)}
                  onBlur={() => markTouched("password")}
                  aria-invalid={!!(errors.password && (touched.password || showSummary))}
                  aria-describedby={errors.password ? "err-password" : undefined}
                />
                {errFor("password")}
              </div>

              <div className={fieldClass("confirm_password")} id="field-confirm_password">
                <label htmlFor="confirm_password">{LABELS.confirm_password} <span className="req">*</span></label>
                <input
                  id="confirm_password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  value={values.confirm_password}
                  onChange={(e) => set("confirm_password", e.target.value)}
                  onBlur={() => markTouched("confirm_password")}
                  aria-invalid={!!(errors.confirm_password && (touched.confirm_password || showSummary))}
                  aria-describedby={errors.confirm_password ? "err-confirm_password" : undefined}
                />
                {errFor("confirm_password")}
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

          <fieldset>
            <legend># plan</legend>
            <div className={fieldClass("plan")} id="field-plan">
              <div className="plan-grid" role="radiogroup" aria-label="Billing plan">
                {PLAN_OPTIONS.map((option) => (
                  <label
                    key={option.key}
                    className={`plan-option${values.plan === option.key ? " plan-option--selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name="plan"
                      value={option.key}
                      checked={values.plan === option.key}
                      onChange={() => {
                        setPlan(option.key);
                        markTouched("plan");
                      }}
                    />
                    <span className="plan-option__top">
                      <span className="plan-option__name">{option.name}</span>
                      <span className="plan-option__price">{option.price}</span>
                    </span>
                    <span className="plan-option__detail">{option.detail}</span>
                  </label>
                ))}
              </div>
              {errFor("plan")}
            </div>

            {values.plan !== "solo" && (
              <div className={fieldClass("seats")} id="field-seats">
                <label htmlFor="seats">{LABELS.seats} <span className="req">*</span></label>
                <input
                  id="seats"
                  type="number"
                  min={1}
                  max={500}
                  inputMode="numeric"
                  value={values.seats}
                  onChange={(e) => set("seats", e.target.value)}
                  onBlur={() => markTouched("seats")}
                  aria-invalid={!!(errors.seats && (touched.seats || showSummary))}
                  aria-describedby={errors.seats ? "err-seats" : undefined}
                />
                {errFor("seats")}
              </div>
            )}
            <p className="out muted checkout-note">
              Selected: {selectedPlan.name} ({selectedPlan.price}). You can change plan or start Stripe billing from the account console.
            </p>
          </fieldset>

          <p className="line cta-big" style={{ marginBottom: "6px" }}>
            <button className="submit" type="submit" disabled={!isValid || submitting}>
              {submitting ? "creating account..." : "create account and open account ->"}
            </button>
          </p>
          <p className="out muted">
            By signing up, you agree to the <a className="lnk" href="/privacy">privacy policy</a> and <a className="lnk" href="/terms">terms</a>.
          </p>
        </form>
      </section>
    </main>
  );
}
