"use client";

import { useEffect, useState } from "react";
import styles from "../admin/admin.module.css";

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
  membership: { role: string; status: string; can_manage_billing: boolean };
  user: { email: string; email_verified_at: string | null };
  billing: {
    plan: string | null;
    billing_interval: string | null;
    seats: number | null;
    subscription_status: string | null;
    current_period_end: string | null;
    updated_at: string | null;
  } | null;
};

type PaymentsData = {
  subscription: {
    status: string;
    cancel_at_period_end: boolean;
    current_period_end: string | null;
    interval: string | null;
    amount_cents: number | null;
    quantity: number;
    currency: string;
  } | null;
  card: { brand: string; last4: string; exp_month: number; exp_year: number } | null;
  invoices: {
    id: string;
    number: string | null;
    amount: number;
    currency: string;
    status: string | null;
    hosted_invoice_url: string | null;
    invoice_pdf: string | null;
    created: string;
  }[];
};

const plans: { key: string; label: string; price: string; detail: string; perSeat: boolean }[] = [
  { key: "solo", label: "Solo", price: "$20/mo", detail: "Single user workspace", perSeat: false },
  { key: "team-monthly", label: "Team monthly", price: "$20/user/mo", detail: "Monthly seats for a team", perSeat: true },
  { key: "team-annual", label: "Team annual", price: "$15/user/mo", detail: "Billed annually", perSeat: true },
];

function billingLabel(value: string | null | undefined): string {
  return value ? value.replace(/_/g, " ") : "-";
}

function planKeyFromBilling(plan: string | null | undefined, interval: string | null | undefined): string {
  if (plan === "team" && interval === "annual") return "team-annual";
  if (plan === "team") return "team-monthly";
  return "solo";
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

function formatMoney(cents: number | null | undefined, currency = "usd"): string {
  if (cents == null) return "-";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: (currency || "usd").toUpperCase() }).format(cents / 100);
}

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

function cycleLengthDays(interval: string | null | undefined): number {
  if (interval === "year") return 365;
  if (interval === "week") return 7;
  return 30;
}

function statusBadgeClass(status: string | null | undefined): string {
  if (status === "active" || status === "paid") return styles.badgeOk;
  if (status === "inactive" || status === "incomplete" || status === "past_due" || status === "trialing" || status === "open") return styles.badgeWarn;
  if (status === "suspended" || status === "unpaid" || status === "revoked" || status === "uncollectible" || status === "void") return styles.badgeDanger;
  return styles.badgeMuted;
}

function accountBillingStatus(input: {
  emailVerified: boolean;
  orgStatus: string | null | undefined;
  subscriptionStatus: string | null | undefined;
  hasSubscription: boolean;
}): { label: string; detail: string } {
  if (!input.emailVerified) {
    return {
      label: "email pending",
      detail: "Verify your email before starting Stripe billing.",
    };
  }
  if (input.subscriptionStatus === "canceled" || input.subscriptionStatus === "unpaid") {
    return {
      label: "canceled",
      detail: "Billing is no longer active. Manage the subscription in Stripe or start a new checkout.",
    };
  }
  if (input.orgStatus === "active") {
    return {
      label: "active",
      detail: "Billing has activated this organization.",
    };
  }
  if (input.hasSubscription || input.subscriptionStatus) {
    return {
      label: "payment pending",
      detail: "Stripe has a subscription record, but the organization is not active yet.",
    };
  }
  return {
    label: "ready for billing",
    detail: "Choose a plan and start secure checkout with Stripe.",
  };
}

export default function BillingPanel({ memberships, embedded = false }: { memberships: Membership[]; embedded?: boolean }) {
  const activeOrgs = memberships.filter((m) => m.status === "active");
  const [orgSlug, setOrgSlug] = useState(activeOrgs[0]?.org_slug ?? "");
  const [plan, setPlan] = useState("solo");
  const [seats, setSeats] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [billingSummary, setBillingSummary] = useState<BillingSummary | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [payments, setPayments] = useState<PaymentsData | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status");
    const requestedOrg = params.get("org");
    if (status === "success") setNotice("Payment received. Your organization is being activated.");
    if (status === "cancelled") setNotice("Checkout cancelled. You can try again any time.");
    if (requestedOrg && activeOrgs.some((org) => org.org_slug === requestedOrg)) {
      setOrgSlug(requestedOrg);
    }
  }, []);

  useEffect(() => {
    async function loadBillingSummary() {
      if (!orgSlug) {
        setBillingSummary(null);
        return;
      }
      setBillingLoading(true);
      try {
        const res = await fetch(`/api/v1/billing/summary?org_slug=${encodeURIComponent(orgSlug)}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setBillingSummary(null);
          setError(
            json.error === "billing_storage_not_configured"
              ? "Billing storage is not configured yet. You can still contact us to complete payment."
              : `Could not load billing summary (${json.error ?? res.status}).`,
          );
          return;
        }
        setBillingSummary(json as BillingSummary);
      } catch {
        setBillingSummary(null);
        setError("Could not load billing summary.");
      } finally {
        setBillingLoading(false);
      }
    }
    void loadBillingSummary();
  }, [orgSlug]);

  // Invoices + live subscription + card. The endpoint is owner/admin-gated and
  // returns empty for non-managers, so we silently ignore failures here.
  useEffect(() => {
    async function loadPayments() {
      setPayments(null);
      if (!orgSlug) return;
      try {
        const res = await fetch(`/api/v1/billing/payments?org_slug=${encodeURIComponent(orgSlug)}`);
        if (!res.ok) return;
        const json = (await res.json().catch(() => null)) as PaymentsData | null;
        if (json) setPayments(json);
      } catch {
        /* non-fatal: dashboard falls back to summary-only */
      }
    }
    void loadPayments();
  }, [orgSlug]);

  const billing = billingSummary?.billing ?? null;

  useEffect(() => {
    if (!billing) return;
    setPlan(planKeyFromBilling(billing.plan, billing.billing_interval));
    if (billing.seats) setSeats(billing.seats);
  }, [billing?.plan, billing?.billing_interval, billing?.seats]);

  const perSeat = plans.find((p) => p.key === plan)?.perSeat ?? false;
  const selectedPlan = plans.find((p) => p.key === plan) ?? plans[0];
  const selectedOrg = activeOrgs.find((m) => m.org_slug === orgSlug);
  const selectedOrgStatus = billingSummary?.organization.status ?? selectedOrg?.org_status;
  const canManage = Boolean(
    billingSummary?.membership.can_manage_billing ?? (selectedOrg?.role === "owner" || selectedOrg?.role === "admin"),
  );
  const sub = payments?.subscription ?? null;
  const hasSubscription = Boolean(sub ?? billing?.subscription_status);
  const emailVerified = Boolean(billingSummary?.user.email_verified_at);
  const billingStatus = accountBillingStatus({
    emailVerified,
    orgStatus: selectedOrgStatus,
    subscriptionStatus: sub?.status ?? billing?.subscription_status,
    hasSubscription,
  });

  const renewIso = sub?.current_period_end ?? billing?.current_period_end ?? null;
  const daysLeft = daysUntil(renewIso);
  const cycleDays = cycleLengthDays(sub?.interval ?? billing?.billing_interval);
  const cyclePct = daysLeft != null ? Math.max(4, Math.min(100, Math.round(((cycleDays - daysLeft) / cycleDays) * 100))) : 0;
  const nextChargeCents = sub?.amount_cents != null ? sub.amount_cents * (sub.quantity || 1) : null;
  const paidToDate = (payments?.invoices ?? [])
    .filter((iv) => iv.status === "paid")
    .reduce((sum, iv) => sum + (iv.amount || 0), 0);

  async function startCheckout() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/v1/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_slug: orgSlug, plan, seats: perSeat ? seats : 1 }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(
          json.error === "billing_unavailable" || json.error === "price_not_configured"
            ? "Billing is not configured yet. Please contact us to complete payment."
            : json.error === "billing_storage_not_configured"
              ? "Billing storage is not configured yet. Please contact us to complete payment."
              : json.error === "email_unverified"
                ? "Verify your email before starting Stripe billing."
              : `Could not start checkout (${json.error ?? res.status}).`,
        );
        return;
      }
      if (json.checkout_url) window.location.href = json.checkout_url;
    } catch {
      setError("Could not start checkout.");
    } finally {
      setBusy(false);
    }
  }

  async function openPortal() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/v1/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_slug: orgSlug }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(
          json.error === "no_subscription"
            ? "This organization has no active subscription to manage yet."
            : `Could not open billing portal (${json.error ?? res.status}).`,
        );
        return;
      }
      if (json.portal_url) window.location.href = json.portal_url;
    } catch {
      setError("Could not open billing portal.");
    } finally {
      setBusy(false);
    }
  }

  const ShellTag = embedded ? "section" : "main";

  const orgPicker =
    activeOrgs.length > 1 ? (
      <label className={styles.field} style={{ maxWidth: 320 }}>
        <span className={styles.label}>Organization</span>
        <select className={styles.select} value={orgSlug} onChange={(e) => setOrgSlug(e.target.value)}>
          {activeOrgs.map((m) => (
            <option key={m.org_id} value={m.org_slug}>
              {m.org_name} ({m.org_slug})
            </option>
          ))}
        </select>
      </label>
    ) : null;

  return (
    <ShellTag id={embedded ? undefined : "main"} className={`${styles.shell} ${embedded ? styles.embeddedShell : ""}`}>
      {!embedded && (
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>Billing</h1>
            <p className={styles.meta}>Plan, invoices, and billing cycle for your organization.</p>
          </div>
          <div className={styles.headerActions}>
            <a className={styles.buttonSecondary} href="/console?view=connect">agent control</a>
          </div>
        </header>
      )}

      <section className={styles.panel}>
        {notice ? <p className={styles.status}>{notice}</p> : null}
        {error ? <p className={styles.notice}>{error}</p> : null}

        {activeOrgs.length === 0 ? (
          <p className={styles.sectionLead}>You do not have an active organization membership yet.</p>
        ) : billingLoading && !billingSummary ? (
          <p className={styles.status}>Loading billing…</p>
        ) : !canManage ? (
          // Read-only: members who cannot manage billing.
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <span className={styles.kicker}>// plan</span>
                <h2 className={styles.sectionTitle}>{billingLabel(billing?.plan) || "No plan"}</h2>
              </div>
              <span className={`${styles.badge} ${statusBadgeClass(billing?.subscription_status ?? selectedOrgStatus)}`}>
                {billingLabel(billing?.subscription_status ?? selectedOrgStatus)}
              </span>
            </div>
            {orgPicker}
            <p className={styles.sectionLead}>
              You can view this organization&apos;s plan. Ask an owner or admin to change plans, view invoices, or manage payment.
            </p>
          </div>
        ) : hasSubscription ? (
          // ── Active subscription: full billing dashboard ──
          <>
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <span className={styles.kicker}>// current plan</span>
                  <h2 className={styles.sectionTitle}>
                    {billingLabel(billing?.plan)} {billing?.billing_interval ? `· ${billingLabel(billing.billing_interval)}` : ""}
                  </h2>
                </div>
                <span className={`${styles.badge} ${statusBadgeClass(sub?.status ?? billing?.subscription_status)}`}>
                  {billingLabel(sub?.status ?? billing?.subscription_status)}
                </span>
              </div>
              {orgPicker}

              <div className={styles.summaryBar}>
                <div className={styles.summaryCard}>
                  <span className={styles.summaryLabel}>Next charge</span>
                  <span className={styles.summaryValue}>{nextChargeCents != null ? formatMoney(nextChargeCents, sub?.currency) : "-"}</span>
                  <span className={styles.summaryHint}>{sub?.interval ? `per ${sub.interval}` : billingLabel(billing?.billing_interval)}</span>
                </div>
                <div className={styles.summaryCard}>
                  <span className={styles.summaryLabel}>Renews</span>
                  <span className={styles.summaryValue} style={{ fontSize: 18 }}>{formatDate(renewIso)}</span>
                  <span className={styles.summaryHint}>{daysLeft != null ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left in cycle` : "no renewal date"}</span>
                </div>
                <div className={styles.summaryCard}>
                  <span className={styles.summaryLabel}>Seats</span>
                  <span className={styles.summaryValue}>{(sub?.quantity ?? billing?.seats) ?? "-"}</span>
                  <span className={styles.summaryHint}>{sub?.cancel_at_period_end ? "cancels at period end" : "active seats"}</span>
                </div>
                <div className={styles.summaryCard}>
                  <span className={styles.summaryLabel}>Paid to date</span>
                  <span className={styles.summaryValue}>{payments ? formatMoney(paidToDate, sub?.currency) : "-"}</span>
                  <span className={styles.summaryHint}>{payments ? `${payments.invoices.filter((iv) => iv.status === "paid").length} invoices` : "from Stripe"}</span>
                </div>
              </div>

              {renewIso ? (
                <div style={{ marginTop: 4 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--fg-2)", marginBottom: 5 }}>
                    <span>billing cycle</span>
                    <span>{daysLeft} of {cycleDays} days remaining</span>
                  </div>
                  <div style={{ height: 7, background: "var(--paper-deep)", border: "1px solid var(--line)", borderRadius: 4 }}>
                    <div style={{ height: "100%", width: `${cyclePct}%`, background: "var(--green)" }} />
                  </div>
                </div>
              ) : null}

              {sub?.cancel_at_period_end ? (
                <p className={styles.sectionLead} style={{ color: "#8a4242" }}>
                  This subscription is set to cancel on {formatDate(renewIso)}. Access remains active until the period ends.
                </p>
              ) : null}

              <div className={styles.buttonRow} style={{ marginTop: 14 }}>
                <button type="button" className={styles.button} disabled={busy} onClick={openPortal}>
                  Manage or cancel in Stripe →
                </button>
                <button type="button" className={styles.buttonSecondary} disabled={busy} onClick={openPortal}>
                  Change plan or seats
                </button>
              </div>
              <p className={styles.meta} style={{ marginTop: 10 }}>
                Plan changes, card updates, and cancellation run through the Stripe-hosted customer portal. Cancelling stops billing at the end of the current cycle.
              </p>
            </div>

            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <h2 className={styles.sectionTitle}>Payment method</h2>
                </div>
              </div>
              {payments?.card ? (
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 15, color: "var(--ink)", textTransform: "capitalize" }}>
                    {payments.card.brand} •••• {payments.card.last4}
                  </span>
                  <span className={styles.summaryHint}>
                    expires {String(payments.card.exp_month).padStart(2, "0")}/{String(payments.card.exp_year).slice(-2)} · managed by Stripe
                  </span>
                </div>
              ) : (
                <p className={styles.meta}>No card on file is visible here. Update it in the Stripe portal.</p>
              )}
            </div>

            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <h2 className={styles.sectionTitle}>Invoices</h2>
                  <p className={styles.meta}>Receipts and payment history, synced from Stripe.</p>
                </div>
              </div>
              {payments && payments.invoices.length > 0 ? (
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>date</th>
                        <th>invoice</th>
                        <th>amount</th>
                        <th>status</th>
                        <th>receipt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.invoices.map((iv) => (
                        <tr key={iv.id}>
                          <td>{formatDate(iv.created)}</td>
                          <td>{iv.number ?? iv.id.slice(0, 14)}</td>
                          <td>{formatMoney(iv.amount, iv.currency)}</td>
                          <td>
                            <span className={`${styles.badge} ${statusBadgeClass(iv.status)}`}>{billingLabel(iv.status)}</span>
                          </td>
                          <td>
                            {iv.hosted_invoice_url || iv.invoice_pdf ? (
                              <a className={styles.linkButton} href={(iv.hosted_invoice_url ?? iv.invoice_pdf) as string} target="_blank" rel="noreferrer">
                                view →
                              </a>
                            ) : (
                              "-"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className={styles.empty}>
                  <strong>No invoices yet</strong>
                  <span>Invoices appear here after your first Stripe charge.</span>
                </div>
              )}
            </div>
          </>
        ) : (
          // ── No subscription yet: account billing status ──
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <span className={styles.kicker}>// billing status</span>
                <h2 className={styles.sectionTitle}>{billingStatus.label}</h2>
                <p className={styles.sectionLead}>{billingStatus.detail}</p>
              </div>
              <span className={`${styles.badge} ${statusBadgeClass(billingStatus.label === "ready for billing" ? "trialing" : selectedOrgStatus)}`}>
                {billingStatus.label}
              </span>
            </div>
            {orgPicker}

            <div className={styles.summaryBar}>
              <div className={styles.summaryCard}>
                <span className={styles.summaryLabel}>Current status</span>
                <span className={styles.summaryValue} style={{ fontSize: 18 }}>{billingStatus.label}</span>
                <span className={styles.summaryHint}>{billingLabel(selectedOrgStatus)}</span>
              </div>
              <div className={styles.summaryCard}>
                <span className={styles.summaryLabel}>Selected plan</span>
                <span className={styles.summaryValue} style={{ fontSize: 18 }}>{selectedPlan.label}</span>
                <span className={styles.summaryHint}>{selectedPlan.price}</span>
              </div>
              <div className={styles.summaryCard}>
                <span className={styles.summaryLabel}>Seats</span>
                <span className={styles.summaryValue}>{perSeat ? seats : 1}</span>
                <span className={styles.summaryHint}>{perSeat ? "team seats" : "solo workspace"}</span>
              </div>
            </div>

            <div className={styles.billingPlanGrid} role="radiogroup" aria-label="Billing plan" style={{ marginTop: 12 }}>
              {plans.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={`${styles.billingPlanOption} ${plan === p.key ? styles.billingPlanSelected : ""}`}
                  aria-pressed={plan === p.key}
                  onClick={() => setPlan(p.key)}
                >
                  <span className={styles.billingPlanName}>{p.label}</span>
                  <span className={styles.billingPlanPrice}>{p.price}</span>
                  <span className={styles.summaryHint}>{p.detail}</span>
                </button>
              ))}
            </div>

            {perSeat ? (
              <label className={styles.field} style={{ marginTop: 12, maxWidth: 200 }}>
                <span className={styles.label}>Seats</span>
                <input
                  className={styles.input}
                  type="number"
                  min={1}
                  max={500}
                  value={seats}
                  onChange={(e) => setSeats(Math.max(1, Number(e.target.value) || 1))}
                />
              </label>
            ) : null}

            <div className={styles.buttonRow} style={{ marginTop: 16 }}>
              <button type="button" className={styles.button} disabled={busy || !orgSlug || !emailVerified} onClick={startCheckout}>
                {busy ? "Starting..." : "Start billing with Stripe"}
              </button>
            </div>
            <p className={styles.meta} style={{ marginTop: 10 }}>
              Secure checkout is hosted by Stripe. Have a 1-month or 1-year Frege code? Enter it in the promotion-code field at checkout.
              {!emailVerified ? " Verify your email first; the account page can resend the link." : ""}
              Need enterprise terms? <a className={styles.linkButton} href="/contact">Contact us</a>.
            </p>
          </div>
        )}
      </section>
    </ShellTag>
  );
}
