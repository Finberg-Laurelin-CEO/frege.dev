"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  clientSchema,
  signupFields,
  COMPANY_SIZES,
  AGENT_TOOLS,
  MONTHLY_AI_SPEND,
  WILLING_TO_PAY,
  DECISION_TIMELINES,
} from "@/lib/signup-schema";
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

const EMPTY: Values = {
  name: "",
  work_email: "",
  company: "",
  role: "",
  company_size: "",
  expected_users: "",
  current_agent_tools: [],
  other_tool: "",
  monthly_ai_spend: "",
  willing_to_pay: "",
  decision_timeline: "",
  main_pain_point: "",
  other_comments: "",
  permission_to_contact: false,
};

const LABELS: Record<keyof Values, string> = {
  name: "Full name",
  work_email: "Work email",
  company: "Company",
  role: "Role",
  company_size: "Company size",
  expected_users: "Expected number of users",
  current_agent_tools: "Current agent tools",
  other_tool: "Other tool",
  monthly_ai_spend: "Monthly AI / tool spend",
  willing_to_pay: "What you'd expect to pay",
  decision_timeline: "Decision timeline",
  main_pain_point: "Main pain point",
  other_comments: "Anything else",
  permission_to_contact: "Permission to contact",
};

/** Validate a single field against its slice of the schema. Returns an error
 *  message or null. */
function fieldError(key: keyof Values, values: Values): string | null {
  const result = signupFields[key].safeParse(values[key]);
  return result.success ? null : result.error.issues[0]?.message ?? "Invalid.";
}

export default function Signup() {
  const router = useRouter();
  const [values, setValues] = useState<Values>(EMPTY);
  const [touched, setTouched] = useState<Partial<Record<keyof Values, boolean>>>(
    {},
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const startedAt = useRef<number>(0);
  const honeypot = useRef<HTMLInputElement>(null);

  useEffect(() => {
    startedAt.current = Date.now();
  }, []);

  // Live validity of every field, recomputed on each change.
  const errors = useMemo(() => {
    const e: Partial<Record<keyof Values, string>> = {};
    (Object.keys(signupFields) as (keyof Values)[]).forEach((k) => {
      const msg = fieldError(k, values);
      if (msg) e[k] = msg;
    });
    // Cross-field: "Other" tool selected → other_tool is required.
    if (
      values.current_agent_tools.includes("Other") &&
      values.other_tool.trim().length === 0
    ) {
      e.other_tool = "Tell us which other tool.";
    }
    return e;
  }, [values]);

  const isValid = Object.keys(errors).length === 0;

  function set<K extends keyof Values>(key: K, val: Values[K]) {
    setValues((v) => ({ ...v, [key]: val }));
  }

  function markTouched(key: keyof Values) {
    setTouched((t) => ({ ...t, [key]: true }));
  }

  function toggleTool(tool: string) {
    setValues((v) => {
      const has = v.current_agent_tools.includes(tool);
      return {
        ...v,
        current_agent_tools: has
          ? v.current_agent_tools.filter((t) => t !== tool)
          : [...v.current_agent_tools, tool],
      };
    });
    markTouched("current_agent_tools");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    // Re-validate the whole form; surface the summary if anything's wrong.
    const parsed = clientSchema.safeParse({
      ...values,
      expected_users: values.expected_users,
    });
    if (!parsed.success) {
      setShowSummary(true);
      setTouched(
        Object.fromEntries(
          (Object.keys(signupFields) as (keyof Values)[]).map((k) => [k, true]),
        ),
      );
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
        setSubmitError("That email has already been submitted today.");
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

  const visibleErrors = (Object.keys(errors) as (keyof Values)[]).filter(
    (k) => touched[k] || showSummary,
  );

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

  return (
    <>
      <header className="bar" role="banner">
        <span className="bar__dots" aria-hidden="true">● ● ●</span>
        <span className="bar__title">frege — ssh agent@frege.dev</span>
        <a className="lnk" href="/">home →</a>
      </header>

      <main id="main" className="screen">
        <section aria-label="Claim a founding pilot seat">
          <p className="line"><span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <span className="cmd">frege pilot --join</span></p>
          <h1 className="hero-tag" style={{ marginTop: "8px" }}>claim your founding pilot seat</h1>
          <p className="out wrap">Tell us how your team handles agent-readable knowledge today. We use this to prioritize design partners — not to spam you. Required fields are marked <span className="path">*</span>. No credit card, ~2 minutes.</p>

          {showSummary && visibleErrors.length > 0 && (
            <div className="summary" role="alert" aria-live="assertive">
              <p>Please fix the following before submitting:</p>
              <ul>
                {visibleErrors.map((k) => (
                  <li key={k}>
                    <a href={`#field-${k}`}>{LABELS[k]}</a>: {errors[k]}
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

          <form className="form" onSubmit={onSubmit} noValidate>
            {/* Honeypot — must stay empty. */}
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

            {/* ── Section 1: About you ── */}
            <fieldset>
              <legend># about you</legend>

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
                <label htmlFor="role">{LABELS.role} <span className="req">*</span></label>
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
                  {COMPANY_SIZES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                {errFor("company_size")}
              </div>
            </fieldset>

            {/* ── Section 2: Your AI setup ── */}
            <fieldset>
              <legend># your AI setup</legend>

              <div className={fieldClass("expected_users")} id="field-expected_users">
                <label htmlFor="expected_users">{LABELS.expected_users} <span className="req">*</span></label>
                <input
                  id="expected_users"
                  type="number"
                  min={1}
                  max={100000}
                  step={1}
                  inputMode="numeric"
                  value={values.expected_users}
                  onChange={(e) => set("expected_users", e.target.value)}
                  onBlur={() => markTouched("expected_users")}
                  aria-invalid={!!(errors.expected_users && (touched.expected_users || showSummary))}
                  aria-describedby={errors.expected_users ? "err-expected_users" : undefined}
                />
                <span className="hintline">How many people would use Frege at your org.</span>
                {errFor("expected_users")}
              </div>

              <div className={fieldClass("current_agent_tools")} id="field-current_agent_tools">
                <label>{LABELS.current_agent_tools} <span className="req">*</span></label>
                <div className="checks">
                  {AGENT_TOOLS.map((tool) => (
                    <label key={tool}>
                      <input
                        type="checkbox"
                        checked={values.current_agent_tools.includes(tool)}
                        onChange={() => toggleTool(tool)}
                      />
                      {tool}
                    </label>
                  ))}
                </div>
                <span className="hintline">Pick all that apply. Choose “Other” to name a model/tool not listed.</span>
                {errFor("current_agent_tools")}
              </div>

              {values.current_agent_tools.includes("Other") && (
                <div className={fieldClass("other_tool")} id="field-other_tool">
                  <label htmlFor="other_tool">{LABELS.other_tool} <span className="req">*</span></label>
                  <input
                    id="other_tool"
                    type="text"
                    placeholder="e.g. a model or agent not in the list"
                    value={values.other_tool}
                    onChange={(e) => set("other_tool", e.target.value)}
                    onBlur={() => markTouched("other_tool")}
                    aria-invalid={!!(errors.other_tool && (touched.other_tool || showSummary))}
                    aria-describedby={errors.other_tool ? "err-other_tool" : undefined}
                  />
                  {errFor("other_tool")}
                </div>
              )}

              <div className={fieldClass("monthly_ai_spend")} id="field-monthly_ai_spend">
                <label htmlFor="monthly_ai_spend">{LABELS.monthly_ai_spend} <span className="req">*</span></label>
                <select
                  id="monthly_ai_spend"
                  value={values.monthly_ai_spend}
                  onChange={(e) => set("monthly_ai_spend", e.target.value)}
                  onBlur={() => markTouched("monthly_ai_spend")}
                  aria-invalid={!!(errors.monthly_ai_spend && (touched.monthly_ai_spend || showSummary))}
                  aria-describedby={errors.monthly_ai_spend ? "err-monthly_ai_spend" : undefined}
                >
                  <option value="">— select —</option>
                  {MONTHLY_AI_SPEND.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                {errFor("monthly_ai_spend")}
              </div>

              <div className={fieldClass("willing_to_pay")} id="field-willing_to_pay">
                <label htmlFor="willing_to_pay">{LABELS.willing_to_pay} <span className="req">*</span></label>
                <select
                  id="willing_to_pay"
                  value={values.willing_to_pay}
                  onChange={(e) => set("willing_to_pay", e.target.value)}
                  onBlur={() => markTouched("willing_to_pay")}
                  aria-invalid={!!(errors.willing_to_pay && (touched.willing_to_pay || showSummary))}
                  aria-describedby={errors.willing_to_pay ? "err-willing_to_pay" : undefined}
                >
                  <option value="">— select —</option>
                  {WILLING_TO_PAY.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <span className="hintline">Roughly what would Frege be worth to your org per month?</span>
                {errFor("willing_to_pay")}
              </div>

              <div className={fieldClass("decision_timeline")} id="field-decision_timeline">
                <label htmlFor="decision_timeline">{LABELS.decision_timeline} <span className="req">*</span></label>
                <select
                  id="decision_timeline"
                  value={values.decision_timeline}
                  onChange={(e) => set("decision_timeline", e.target.value)}
                  onBlur={() => markTouched("decision_timeline")}
                  aria-invalid={!!(errors.decision_timeline && (touched.decision_timeline || showSummary))}
                  aria-describedby={errors.decision_timeline ? "err-decision_timeline" : undefined}
                >
                  <option value="">— select —</option>
                  {DECISION_TIMELINES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                {errFor("decision_timeline")}
              </div>
            </fieldset>

            {/* ── Section 3: Why now ── */}
            <fieldset>
              <legend># why now</legend>

              <div className={fieldClass("main_pain_point")} id="field-main_pain_point">
                <label htmlFor="main_pain_point">{LABELS.main_pain_point} <span className="req">*</span></label>
                <textarea
                  id="main_pain_point"
                  value={values.main_pain_point}
                  onChange={(e) => set("main_pain_point", e.target.value)}
                  onBlur={() => markTouched("main_pain_point")}
                  maxLength={1000}
                  aria-invalid={!!(errors.main_pain_point && (touched.main_pain_point || showSummary))}
                  aria-describedby={errors.main_pain_point ? "err-main_pain_point" : undefined}
                />
                <span className="hintline">What hurts most about agent-readable knowledge today? (10–1000 chars)</span>
                {errFor("main_pain_point")}
              </div>

              <div className={fieldClass("other_comments")} id="field-other_comments">
                <label htmlFor="other_comments">{LABELS.other_comments} <span className="path">(optional)</span></label>
                <textarea
                  id="other_comments"
                  value={values.other_comments}
                  onChange={(e) => set("other_comments", e.target.value)}
                  onBlur={() => markTouched("other_comments")}
                  maxLength={2000}
                  aria-invalid={!!(errors.other_comments && (touched.other_comments || showSummary))}
                  aria-describedby={errors.other_comments ? "err-other_comments" : undefined}
                />
                <span className="hintline">Anything else we should know — integrations you need, constraints, questions. (optional)</span>
                {errFor("other_comments")}
              </div>

              <div className={fieldClass("permission_to_contact") + " consent"} id="field-permission_to_contact">
                <label>
                  <input
                    type="checkbox"
                    checked={values.permission_to_contact}
                    onChange={(e) => {
                      set("permission_to_contact", e.target.checked);
                      markTouched("permission_to_contact");
                    }}
                    aria-invalid={!!(errors.permission_to_contact && (touched.permission_to_contact || showSummary))}
                  />
                  {LABELS.permission_to_contact}: you may email me about the Frege pilot. <span className="req">*</span>
                </label>
                {errFor("permission_to_contact")}
              </div>
            </fieldset>

            <p className="line cta-big" style={{ marginBottom: "6px" }}>
              <button className="submit" type="submit" disabled={!isValid || submitting}>
                {submitting ? "submitting…" : "claim my seat →"}
              </button>
            </p>
            <p className="out muted">
              By submitting you agree to our <a className="lnk" href="/privacy">privacy policy</a> and <a className="lnk" href="/terms">terms</a>.
            </p>
          </form>
        </section>
      </main>
    </>
  );
}
