"use client";

import { useState, type FormEvent } from "react";
import { BUG_REPORT_EMAIL, bugReportSchema } from "@/lib/bug-report";
import styles from "./report-a-bug.module.css";

const fallbackHref = `mailto:${BUG_REPORT_EMAIL}?subject=Frege%20bug%20report`;

export default function BugReportForm() {
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [submitError, setSubmitError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  function errorFor(field: string) {
    const message = errors[field]?.[0];
    return message ? <span className={styles.fieldError} id={`${field}-error`}>{message}</span> : null;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(false);

    const parsed = bugReportSchema.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!parsed.success) {
      setErrors(parsed.error.flatten().fieldErrors as Record<string, string[]>);
      return;
    }

    setErrors({});
    setSubmitting(true);
    try {
      const response = await fetch("/api/bug-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!response.ok) {
        setSubmitError(true);
        return;
      }
      setSubmitted(true);
    } catch {
      setSubmitError(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className={styles.status} role="status" aria-live="polite">
        <h2>Report sent.</h2>
        <p>Thanks. The Frege team has received your bug report.</p>
        <p>If you need to add context, email <a href={fallbackHref}>{BUG_REPORT_EMAIL}</a>.</p>
      </div>
    );
  }

  return (
    <>
      <p className={styles.warning}>
        <strong>Do not submit secrets or sensitive personal data.</strong> Redact API keys,
        credentials, customer content, and private identifiers before sending.
        Reports go to {BUG_REPORT_EMAIL} through AgentMail, the email provider for
        agents.frege.dev. Only the fields below are sent.
      </p>

      {submitError ? (
        <p className={styles.status} role="alert">
          The form could not send your report. Try again, or email{" "}
          <a href={fallbackHref}>{BUG_REPORT_EMAIL}</a>.
        </p>
      ) : null}

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <div className={styles.honeypot} aria-hidden="true">
          <label htmlFor="_gotcha">Leave this field empty</label>
          <input id="_gotcha" name="_gotcha" type="text" tabIndex={-1} autoComplete="off" />
        </div>

        <div className={styles.field}>
          <label htmlFor="summary">Summary <span aria-hidden="true">*</span></label>
          <input
            id="summary"
            name="summary"
            type="text"
            required
            minLength={5}
            maxLength={160}
            aria-invalid={Boolean(errors.summary)}
            aria-describedby={errors.summary ? "summary-error" : undefined}
          />
          {errorFor("summary")}
        </div>

        <div className={styles.field}>
          <label htmlFor="details">Details <span aria-hidden="true">*</span></label>
          <textarea
            id="details"
            name="details"
            required
            minLength={10}
            maxLength={5_000}
            rows={6}
            aria-invalid={Boolean(errors.details)}
            aria-describedby={errors.details ? "details-error" : undefined}
          />
          {errorFor("details")}
        </div>

        <div className={styles.field}>
          <label htmlFor="reproduction_steps">Reproduction steps <span aria-hidden="true">*</span></label>
          <textarea
            id="reproduction_steps"
            name="reproduction_steps"
            required
            minLength={5}
            maxLength={5_000}
            rows={6}
            placeholder={"1. Open…\n2. Select…\n3. Observe…"}
            aria-invalid={Boolean(errors.reproduction_steps)}
            aria-describedby={errors.reproduction_steps ? "reproduction_steps-error" : undefined}
          />
          {errorFor("reproduction_steps")}
        </div>

        <div className={styles.twoColumn}>
          <div className={styles.field}>
            <label htmlFor="expected_behavior">Expected behavior <span aria-hidden="true">*</span></label>
            <textarea
              id="expected_behavior"
              name="expected_behavior"
              required
              minLength={5}
              maxLength={3_000}
              rows={4}
              aria-invalid={Boolean(errors.expected_behavior)}
              aria-describedby={errors.expected_behavior ? "expected_behavior-error" : undefined}
            />
            {errorFor("expected_behavior")}
          </div>

          <div className={styles.field}>
            <label htmlFor="actual_behavior">Actual behavior <span aria-hidden="true">*</span></label>
            <textarea
              id="actual_behavior"
              name="actual_behavior"
              required
              minLength={5}
              maxLength={3_000}
              rows={4}
              aria-invalid={Boolean(errors.actual_behavior)}
              aria-describedby={errors.actual_behavior ? "actual_behavior-error" : undefined}
            />
            {errorFor("actual_behavior")}
          </div>
        </div>

        <div className={styles.twoColumn}>
          <div className={styles.field}>
            <label htmlFor="contact_email">Contact email <span className={styles.optional}>(optional)</span></label>
            <input
              id="contact_email"
              name="contact_email"
              type="email"
              maxLength={254}
              autoComplete="email"
              aria-invalid={Boolean(errors.contact_email)}
              aria-describedby={errors.contact_email ? "contact_email-error" : undefined}
            />
            {errorFor("contact_email")}
          </div>

          <div className={styles.field}>
            <label htmlFor="page_url">Page URL <span className={styles.optional}>(optional)</span></label>
            <input
              id="page_url"
              name="page_url"
              type="url"
              maxLength={2_048}
              placeholder="https://frege.dev/…"
              aria-invalid={Boolean(errors.page_url)}
              aria-describedby={errors.page_url ? "page_url-error" : undefined}
            />
            {errorFor("page_url")}
          </div>
        </div>

        <div className={styles.actions}>
          <button type="submit" disabled={submitting}>
            {submitting ? "Sending…" : "Send bug report"}
          </button>
          <span>or <a href={fallbackHref}>email {BUG_REPORT_EMAIL}</a></span>
        </div>
      </form>
    </>
  );
}
