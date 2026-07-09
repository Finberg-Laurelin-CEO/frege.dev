"use client";

import { FormEvent, useState } from "react";
import { PLAN_OPTIONS, type PlanKey } from "@/app/components/plan-options";
import "../signup/signup.css";

// Freemail domains make silly workspace names ("Gmail"); fall back to the
// mailbox name for those.
const FREEMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
]);

// Prefill the workspace name from the email domain: "ada@acme-ai.dev" → "Acme Ai".
function workspaceNameFromEmail(email: string): string {
  const [local = "", domain = ""] = email.toLowerCase().split("@");
  const source = !domain || FREEMAIL_DOMAINS.has(domain) ? local : domain.split(".")[0] ?? "";
  const words = source
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return words.join(" ");
}

const statusText: Record<string, string> = {
  validation: "Enter a workspace name.",
  rate_limited: "Too many attempts. Try again shortly.",
  workspace_failed: "Could not create the workspace. Try again.",
};

export default function SetupWorkspacePanel({ userEmail }: { userEmail: string }) {
  const [orgName, setOrgName] = useState(() => workspaceNameFromEmail(userEmail));
  const [plan, setPlan] = useState<PlanKey>("solo");
  const [seats, setSeats] = useState("2");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);

  const selectedPlan = PLAN_OPTIONS.find((option) => option.key === plan) ?? PLAN_OPTIONS[0];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!orgName.trim()) {
      setStatus(statusText.validation);
      return;
    }

    setPending(true);
    setStatus("creating workspace...");

    try {
      const response = await fetch("/api/v1/auth/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          org_name: orgName.trim(),
          plan,
          seats: plan === "solo" ? 1 : Math.max(1, Number(seats) || 1),
        }),
      });

      if (response.status === 409) {
        // Already has a workspace (e.g. finished setup in another tab).
        setStatus("You already have a workspace. Opening the console...");
        window.location.href = "/console?view=account";
        return;
      }
      if (response.status === 401) {
        window.location.href = "/login?next=%2Fsetup-workspace";
        return;
      }
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "workspace_failed" }));
        const code = typeof error.error === "string" ? error.error : "workspace_failed";
        setStatus(statusText[code] ?? statusText.workspace_failed);
        setPending(false);
        return;
      }

      const payload = (await response.json().catch(() => ({}))) as { next?: unknown };
      setStatus("Workspace created. Opening your account...");
      const next = typeof payload.next === "string" && payload.next.startsWith("/") && !payload.next.startsWith("//")
        ? payload.next
        : "/console?view=account";
      window.location.href = next;
    } catch {
      setStatus(statusText.workspace_failed);
      setPending(false);
    }
  }

  return (
    <main id="main" className="screen">
      <section aria-label="Set up your Frege workspace">
        <p className="line">
          <span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <span className="cmd">frege workspace --create</span>
        </p>
        <h1 className="hero-tag" style={{ marginTop: "8px" }}>set up your workspace</h1>
        <p className="out wrap">
          You are signed in as {userEmail}. Name your workspace and choose a plan — billing starts
          later from the console when you are ready.
        </p>

        <form className="form form--compact" onSubmit={submit} noValidate>
          <fieldset>
            <legend># workspace</legend>
            <div className="field" id="field-org_name">
              <label htmlFor="org_name">Workspace name <span className="req">*</span></label>
              <input
                id="org_name"
                type="text"
                autoComplete="organization"
                required
                maxLength={200}
                value={orgName}
                onChange={(event) => setOrgName(event.target.value)}
              />
            </div>
          </fieldset>

          <fieldset>
            <legend># plan</legend>
            <div className="field" id="field-plan">
              <div className="plan-grid" role="radiogroup" aria-label="Billing plan">
                {PLAN_OPTIONS.map((option) => (
                  <label
                    key={option.key}
                    className={`plan-option${plan === option.key ? " plan-option--selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name="plan"
                      value={option.key}
                      checked={plan === option.key}
                      onChange={() => setPlan(option.key)}
                    />
                    <span className="plan-option__top">
                      <span className="plan-option__name">{option.name}</span>
                      <span className="plan-option__price">{option.price}</span>
                    </span>
                    <span className="plan-option__detail">{option.detail}</span>
                  </label>
                ))}
              </div>
            </div>

            {plan !== "solo" && (
              <div className="field" id="field-seats">
                <label htmlFor="seats">Seats <span className="req">*</span></label>
                <input
                  id="seats"
                  type="number"
                  min={1}
                  max={500}
                  inputMode="numeric"
                  value={seats}
                  onChange={(event) => setSeats(event.target.value)}
                />
              </div>
            )}
            <p className="out muted checkout-note">
              Selected: {selectedPlan.name} ({selectedPlan.price}). You can change plan or start Stripe billing from the account console.
            </p>
          </fieldset>

          <p className="line cta-big" style={{ marginBottom: "6px" }}>
            <button className="submit" type="submit" disabled={pending || !orgName.trim()}>
              {pending ? "creating workspace..." : "create workspace and open account ->"}
            </button>
          </p>
          <p className="out" role="status" aria-live="polite">{status}</p>
          <p className="out muted">
            By continuing, you agree to the <a className="lnk" href="/privacy">privacy policy</a> and <a className="lnk" href="/terms">terms</a>.
          </p>
        </form>
      </section>
    </main>
  );
}
