"use client";

import { useEffect, useState } from "react";
import {
  clerkOAuthStatusText,
  finishClerkBridgeCallback,
  startClerkOAuth,
} from "@/app/components/clerk-client";
import type { ActivationMilestone, ActivationView } from "@/lib/core/activation-view";
import type { ConsoleSection } from "./ui";

type Membership = {
  org_id: string;
  org_slug: string;
  org_name: string;
  org_status: string;
  role: string;
  status: string;
};

type BillingSummary = {
  organization: { id: string; slug: string; name: string; status: string };
  user: { email: string; email_verified_at: string | null };
  billing: {
    plan: string | null;
    billing_interval: string | null;
    seats: number | null;
    subscription_status: string | null;
  } | null;
};

type ActivationSummary = {
  activation: ActivationView;
};

function statusText(verified: string | undefined): string | null {
  if (!verified) return null;
  if (verified === "1") return "Email verified. Billing and activation are the next step.";
  if (verified === "expired") return "That verification link expired. Send a fresh link below.";
  if (verified === "used") return "That verification link was already used. If this account is still pending, send a fresh link.";
  if (verified === "invalid") return "That verification link is invalid. Send a fresh link below.";
  if (verified === "error") return "Something went wrong verifying your email. Try the link again or send a fresh one below.";
  return null;
}

const IDENTITY_PROVIDERS = [
  { id: "google", label: "Google" },
  { id: "github", label: "GitHub" },
] as const;

type IdentityProviderId = (typeof IDENTITY_PROVIDERS)[number]["id"];

function providerLabel(id: string): string {
  return IDENTITY_PROVIDERS.find((provider) => provider.id === id)?.label ?? id;
}

function linkStatusText(code: string): string {
  if (code === "identity_in_use") return "That account is already connected to a different Frege user.";
  if (code === "unauthorized") return "Your session expired. Sign in again, then retry the connection.";
  return clerkOAuthStatusText[code] ?? "Could not connect that account. Try again.";
}

function planLabel(plan: string | null | undefined, interval: string | null | undefined): string {
  if (plan === "team" && interval === "annual") return "Team annual";
  if (plan === "team") return "Team monthly";
  if (plan === "solo") return "Solo";
  return "Not selected";
}

function formatMilestoneTime(milestone: ActivationMilestone): string {
  if (!milestone.completed_at) return "Not observed yet";
  const completed = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(milestone.completed_at));
  const elapsed = milestone.minutes_from_account;
  if (elapsed === null) return `Observed ${completed}`;
  return `Observed ${completed} · +${elapsed} min`;
}

function CheckItem({ milestone }: { milestone: ActivationMilestone }) {
  return (
    <li style={{ display: "grid", gridTemplateColumns: "24px minmax(0, 1fr)", gap: 10, alignItems: "start", padding: "12px 0", borderTop: "1px solid var(--line)" }}>
      <span style={{ color: milestone.completed ? "var(--green)" : "var(--faint)", fontSize: 15 }}>{milestone.completed ? "✓" : "○"}</span>
      <span>
        <span style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
          <strong style={{ display: "block", color: "var(--ink)", fontSize: 13, fontWeight: 400 }}>{milestone.title}</strong>
          {milestone.within_first_15_minutes ? (
            <small style={{ color: "var(--green-dark)", whiteSpace: "nowrap" }}>within 15 min</small>
          ) : null}
        </span>
        <span style={{ display: "block", color: "var(--muted)", fontSize: 12, lineHeight: 1.5, marginTop: 2 }}>{milestone.detail}</span>
        <span style={{ display: "block", color: milestone.completed ? "var(--green-dark)" : "var(--faint)", fontSize: 11, lineHeight: 1.4, marginTop: 4 }}>
          {formatMilestoneTime(milestone)}
        </span>
      </span>
    </li>
  );
}

export default function AccountSection({
  userEmail,
  emailVerifiedAt,
  memberships,
  verificationStatus,
  onNavigate,
}: {
  userEmail?: string;
  emailVerifiedAt: string | null;
  memberships: Membership[];
  verificationStatus?: string;
  onNavigate: (section: ConsoleSection) => void;
}) {
  const activeOrg = memberships.find((m) => m.status === "active") ?? memberships[0] ?? null;
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [activation, setActivation] = useState<ActivationView | null>(null);
  const [activationLoading, setActivationLoading] = useState(true);
  const [resendStatus, setResendStatus] = useState<"idle" | "sending" | "sent" | "not_configured" | "verified" | "rate_limited" | "error">("idle");
  const [linkedProviders, setLinkedProviders] = useState<string[]>([]);
  const [linkStatus, setLinkStatus] = useState("");
  const [linkPending, setLinkPending] = useState(false);

  // NEXT_PUBLIC_ env vars are inlined into the client bundle at build time —
  // the publishable key is public by design (it boots clerk-js in the browser).
  const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? null;

  useEffect(() => {
    let live = true;
    fetch("/api/v1/auth/identities")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        const providers = (json as { providers?: unknown } | null)?.providers;
        if (live && Array.isArray(providers)) {
          setLinkedProviders(providers.filter((entry): entry is string => typeof entry === "string"));
        }
      })
      .catch(() => null);
    return () => {
      live = false;
    };
  }, []);

  // Finish a pending "Connect Google/GitHub" Clerk callback: the same shared
  // browser flow as login, but the bridge runs in link mode and binds the
  // provider identity to THIS session user (no session switch). The URL is
  // rewritten to ?linked=<provider> so a reload doesn't replay the callback.
  useEffect(() => {
    if (!clerkPublishableKey) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("clerk") !== "cb") return;
    const provider = params.get("link") ?? "";

    let cancelled = false;

    (async () => {
      setLinkPending(true);
      setLinkStatus(`connecting ${providerLabel(provider)}...`);

      const result = await finishClerkBridgeCallback(clerkPublishableKey, { mode: "link" });
      if (cancelled) return;

      if (!result.ok) {
        window.history.replaceState(null, "", "/console?view=account");
        setLinkStatus(linkStatusText(result.code));
        setLinkPending(false);
        return;
      }

      const linked = result.providers[0] ?? provider;
      window.history.replaceState(null, "", `/console?view=account&linked=${encodeURIComponent(linked)}`);
      setLinkedProviders((current) => Array.from(new Set([...current, ...result.providers])));
      setLinkStatus(
        result.alreadyLinked
          ? `${providerLabel(linked)} was already connected.`
          : `${providerLabel(linked)} connected.`,
      );
      setLinkPending(false);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clerkPublishableKey]);

  // Landing back with ?linked=<provider> (e.g. after a full redirect) shows a
  // confirmation without replaying anything.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("clerk") === "cb") return;
    const linked = params.get("linked");
    if (linked) setLinkStatus(`${providerLabel(linked)} connected.`);
  }, []);

  async function connectProvider(provider: IdentityProviderId) {
    if (!clerkPublishableKey) return;
    setLinkPending(true);
    setLinkStatus(`redirecting to ${providerLabel(provider)}...`);
    try {
      await startClerkOAuth(
        clerkPublishableKey,
        provider,
        `/console?view=account&clerk=cb&link=${provider}`,
      );
    } catch {
      setLinkStatus(linkStatusText("oauth_failed"));
      setLinkPending(false);
    }
  }

  useEffect(() => {
    let live = true;
    if (!activeOrg?.org_slug) {
      setActivationLoading(false);
      return;
    }
    fetch(`/api/v1/billing/summary?org_slug=${encodeURIComponent(activeOrg.org_slug)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (live) setBilling(json as BillingSummary | null);
      })
      .catch(() => null);
    fetch(`/api/v1/auth/activation?org_slug=${encodeURIComponent(activeOrg.org_slug)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!live) return;
        setActivation((json as ActivationSummary | null)?.activation ?? null);
        setActivationLoading(false);
      })
      .catch(() => {
        if (live) setActivationLoading(false);
      });
    return () => {
      live = false;
    };
  }, [activeOrg?.org_slug]);

  const verifiedAt = billing?.user.email_verified_at ?? emailVerifiedAt;
  const emailVerified = Boolean(verifiedAt);
  const orgActive = activeOrg?.org_status === "active";
  const plan = billing?.billing ?? null;
  const selectedPlan = planLabel(plan?.plan, plan?.billing_interval);
  const seats = plan?.seats ?? (plan?.plan === "team" ? 2 : 1);
  const subscriptionStatus = plan?.subscription_status ?? null;
  const verifyNotice = statusText(verificationStatus);
  const canStartBilling = emailVerified && !orgActive;
  const nextMilestone = activation?.milestones.find((milestone) => !milestone.completed) ?? null;
  const activationPercent = activation
    ? Math.round((activation.complete_count / activation.total_count) * 100)
    : 0;

  const nextButtonLabel: Partial<Record<ActivationMilestone["id"], string>> = {
    api_key_issued: "Open connect",
    client_call_observed: "Open connection guide",
    source_imported: "Open knowledge",
    cited_context_built: "Open overview",
    proposal_approved: "Review proposals",
  };

  async function resendVerification() {
    setResendStatus("sending");
    try {
      const res = await fetch("/api/v1/auth/email/verification/resend", { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { email_sent?: boolean; verified?: boolean; error?: string };
      if (res.status === 429) {
        setResendStatus("rate_limited");
      } else if (!res.ok) {
        setResendStatus("error");
      } else if (json.verified) {
        setResendStatus("verified");
      } else if (json.email_sent) {
        setResendStatus("sent");
      } else {
        setResendStatus("not_configured");
      }
    } catch {
      setResendStatus("error");
    }
  }

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", display: "grid", gap: 20 }}>
      {verifyNotice ? (
        <section style={{ border: "1px solid var(--internal-bd)", background: "var(--internal-bg)", padding: "13px 16px", color: "var(--ink)" }}>
          {verifyNotice}
        </section>
      ) : null}

      <section style={{ border: "1px solid var(--line-strong)", background: "var(--surface)", padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--green)" }}>account</div>
            <h2 style={{ margin: "5px 0 0", fontSize: 20, fontWeight: 400, color: "var(--ink)" }}>
              {activeOrg?.org_name ?? "Your Frege account"}
            </h2>
            <p style={{ margin: "5px 0 0", color: "var(--muted)", fontSize: 12.5 }}>
              {userEmail ?? "Signed in"} · {activeOrg?.role ?? "member"}
            </p>
          </div>
          <span style={{ border: "1px solid var(--line-strong)", color: orgActive ? "var(--green-dark)" : "var(--muted)", background: orgActive ? "var(--green-tint)" : "var(--surface-mute)", padding: "4px 10px", fontSize: 12 }}>
            {orgActive ? "active" : "limited tour"}
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
          <div style={{ border: "1px solid var(--line)", background: "var(--surface-mute)", padding: 13 }}>
            <span style={{ display: "block", color: "var(--faint)", fontSize: 11 }}>Email</span>
            <strong style={{ display: "block", color: emailVerified ? "var(--green-dark)" : "#8a6d1f", marginTop: 4, fontWeight: 400 }}>
              {emailVerified ? "verified" : "pending"}
            </strong>
          </div>
          <div style={{ border: "1px solid var(--line)", background: "var(--surface-mute)", padding: 13 }}>
            <span style={{ display: "block", color: "var(--faint)", fontSize: 11 }}>Plan</span>
            <strong style={{ display: "block", color: "var(--ink)", marginTop: 4, fontWeight: 400 }}>
              {selectedPlan} · {seats} seat{seats === 1 ? "" : "s"}
            </strong>
          </div>
          <div style={{ border: "1px solid var(--line)", background: "var(--surface-mute)", padding: 13 }}>
            <span style={{ display: "block", color: "var(--faint)", fontSize: 11 }}>Billing</span>
            <strong style={{ display: "block", color: orgActive ? "var(--green-dark)" : "var(--muted)", marginTop: 4, fontWeight: 400 }}>
              {orgActive ? "active" : subscriptionStatus ?? (emailVerified ? "ready" : "email pending")}
            </strong>
          </div>
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.15fr) minmax(300px, 0.85fr)", gap: 18, alignItems: "start" }}>
        <section style={{ border: "1px solid var(--line-strong)", background: "var(--surface)", padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", marginBottom: 8 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--green)" }}>first 15 minutes</div>
            {activation ? (
              <span style={{ color: "var(--muted)", fontSize: 11 }}>{activation.complete_count}/{activation.total_count} observed</span>
            ) : null}
          </div>
          {activation ? (
            <>
              <p style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.5, margin: "0 0 10px" }}>
                {activation.state === "complete"
                  ? "Activation path complete. Every step below comes from server-side product evidence."
                  : activation.window.open
                    ? `${Math.ceil(activation.window.remaining_minutes ?? 0)} min remain in the first-run window. Progress is recorded automatically.`
                    : "The 15-minute target has passed, but progress persists. Continue from the next observed step."}
              </p>
              <div
                role="progressbar"
                aria-label="Activation progress"
                aria-valuemin={0}
                aria-valuemax={activation.total_count}
                aria-valuenow={activation.complete_count}
                style={{ height: 3, background: "var(--line)", overflow: "hidden", marginBottom: 8 }}
              >
                <span style={{ display: "block", width: `${activationPercent}%`, height: "100%", background: "var(--green)", transition: "width 240ms ease" }} />
              </div>
              <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {activation.milestones.map((milestone) => <CheckItem key={milestone.id} milestone={milestone} />)}
              </ol>
            </>
          ) : (
            <p style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.5, margin: 0 }}>
              {activationLoading ? "Loading activation evidence…" : "Activation evidence is temporarily unavailable. Account gates remain enforced server-side."}
            </p>
          )}
        </section>

        <section style={{ border: "1px solid var(--line-strong)", background: "var(--surface)", padding: 20 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--green)", marginBottom: 8 }}>next action</div>
          {!emailVerified ? (
            <>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 400, color: "var(--ink)" }}>Verify your email</h2>
              <p style={{ margin: "8px 0 14px", color: "var(--muted)", fontSize: 12.5, lineHeight: 1.55 }}>
                The signup email may be skipped if this deployment is missing email provider configuration. Resend will report that state here.
              </p>
              <button type="button" onClick={resendVerification} disabled={resendStatus === "sending"} style={{ minHeight: 36, padding: "0 13px", border: "1px solid var(--green-dark)", background: "var(--green-dark)", color: "#fff", font: "inherit" }}>
                {resendStatus === "sending" ? "Sending..." : "Resend verification email"}
              </button>
              {resendStatus !== "idle" ? (
                <p style={{ margin: "10px 0 0", color: resendStatus === "sent" ? "var(--green-dark)" : "var(--muted)", fontSize: 12 }}>
                  {resendStatus === "sent"
                    ? "Verification email sent."
                    : resendStatus === "not_configured"
                      ? "No email was sent from this deployment. Contact support or configure the email provider."
                      : resendStatus === "verified"
                        ? "This email is already verified."
                        : resendStatus === "rate_limited"
                          ? "Too many resend attempts. Try again later."
                          : resendStatus === "sending"
                            ? "Sending..."
                            : "Could not send a verification email."}
                </p>
              ) : null}
            </>
          ) : canStartBilling ? (
            <>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 400, color: "var(--ink)" }}>Start billing</h2>
              <p style={{ margin: "8px 0 14px", color: "var(--muted)", fontSize: 12.5, lineHeight: 1.55 }}>
                Stripe checkout activates the org through the billing webhook. Until then, write actions and API keys stay locked.
              </p>
              <button type="button" onClick={() => onNavigate("billing")} style={{ minHeight: 36, padding: "0 13px", border: "1px solid var(--green-dark)", background: "var(--green-dark)", color: "#fff", font: "inherit" }}>
                Start billing with Stripe
              </button>
            </>
          ) : activationLoading ? (
            <>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 400, color: "var(--ink)" }}>Reading activation evidence</h2>
              <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 12.5, lineHeight: 1.55 }}>
                Checking keys, product events, imported knowledge, context builds, and approvals.
              </p>
            </>
          ) : !activation ? (
            <>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 400, color: "var(--ink)" }}>Continue in connect</h2>
              <p style={{ margin: "8px 0 14px", color: "var(--muted)", fontSize: 12.5, lineHeight: 1.55 }}>
                Activation evidence is temporarily unavailable. Your account remains active and all server-side gates still apply.
              </p>
              <button type="button" onClick={() => onNavigate("connect")} style={{ minHeight: 36, padding: "0 13px", border: "1px solid var(--green-dark)", background: "var(--green-dark)", color: "#fff", font: "inherit" }}>
                Open connect
              </button>
            </>
          ) : nextMilestone ? (
            <>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 400, color: "var(--ink)" }}>{nextMilestone.title}</h2>
              <p style={{ margin: "8px 0 14px", color: "var(--muted)", fontSize: 12.5, lineHeight: 1.55 }}>
                {nextMilestone.detail}
              </p>
              <button type="button" onClick={() => onNavigate(nextMilestone.section as ConsoleSection)} style={{ minHeight: 36, padding: "0 13px", border: "1px solid var(--green-dark)", background: "var(--green-dark)", color: "#fff", font: "inherit" }}>
                {nextButtonLabel[nextMilestone.id] ?? "Continue setup"}
              </button>
            </>
          ) : (
            <>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 400, color: "var(--ink)" }}>Activation path complete</h2>
              <p style={{ margin: "8px 0 14px", color: "var(--muted)", fontSize: 12.5, lineHeight: 1.55 }}>
                Frege has observed the full account-to-approved-memory loop for this workspace.
              </p>
              <button type="button" onClick={() => onNavigate("overview")} style={{ minHeight: 36, padding: "0 13px", border: "1px solid var(--green-dark)", background: "var(--green-dark)", color: "#fff", font: "inherit" }}>
                Open overview
              </button>
            </>
          )}
        </section>
      </div>

      <section style={{ border: "1px solid var(--line-strong)", background: "var(--surface)", padding: 20 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--green)", marginBottom: 8 }}>connected sign-ins</div>
        <p style={{ margin: "0 0 14px", color: "var(--muted)", fontSize: 12.5, lineHeight: 1.55 }}>
          Sign in to this account with Google or GitHub in addition to your password.
        </p>
        <div style={{ display: "grid", gap: 10 }}>
          {IDENTITY_PROVIDERS.map((provider) => {
            const connected = linkedProviders.includes(provider.id);
            return (
              <div
                key={provider.id}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, border: "1px solid var(--line)", background: "var(--surface-mute)", padding: "10px 13px" }}
              >
                <span style={{ color: "var(--ink)", fontSize: 13 }}>
                  {provider.label}
                  <span style={{ display: "block", color: connected ? "var(--green-dark)" : "var(--faint)", fontSize: 11, marginTop: 2 }}>
                    {connected ? "connected" : "not connected"}
                  </span>
                </span>
                {clerkPublishableKey && !connected ? (
                  <button
                    type="button"
                    onClick={() => connectProvider(provider.id)}
                    disabled={linkPending}
                    style={{ minHeight: 34, padding: "0 12px", border: "1px solid var(--line-strong)", background: "var(--surface)", color: "var(--ink)", font: "inherit", cursor: linkPending ? "default" : "pointer" }}
                  >
                    Connect {provider.label}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
        {linkStatus ? (
          <p role="status" aria-live="polite" style={{ margin: "10px 0 0", color: "var(--muted)", fontSize: 12 }}>
            {linkStatus}
          </p>
        ) : null}
      </section>

      <section style={{ border: "1px solid var(--line-strong)", background: "var(--surface)", padding: 20 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--green)", marginBottom: 12 }}>tour</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[
            ["overview", "Overview"],
            ["knowledge", "Knowledge"],
            ["access", "Access"],
            ["connect", "Connect"],
            ["billing", "Billing"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => onNavigate(id as ConsoleSection)}
              style={{ minHeight: 34, padding: "0 12px", border: "1px solid var(--line-strong)", background: "var(--surface-mute)", color: "var(--ink)", font: "inherit" }}
            >
              {label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
