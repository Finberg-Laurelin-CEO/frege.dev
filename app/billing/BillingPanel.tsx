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
  organization: {
    id: string;
    slug: string;
    name: string;
    status: string;
  };
  membership: {
    role: string;
    status: string;
    can_manage_billing: boolean;
  };
  billing: {
    plan: string | null;
    billing_interval: string | null;
    seats: number | null;
    subscription_status: string | null;
    current_period_end: string | null;
    updated_at: string | null;
  } | null;
};

const plans: { key: string; label: string; price: string; detail: string; perSeat: boolean }[] = [
  { key: "solo", label: "Solo", price: "$20/mo", detail: "Single user workspace", perSeat: false },
  { key: "team-monthly", label: "Team monthly", price: "$20/user/mo", detail: "Monthly seats for a team", perSeat: true },
  { key: "team-annual", label: "Team annual", price: "$15/user/mo", detail: "Billed annually", perSeat: true },
];

function billingLabel(value: string | null | undefined): string {
  return value ? value.replace(/_/g, " ") : "-";
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(value));
}

function statusBadgeClass(status: string | null | undefined): string {
  if (status === "active" || status === "paid") return styles.badgeOk;
  if (status === "inactive" || status === "incomplete" || status === "past_due" || status === "trialing") return styles.badgeWarn;
  if (status === "suspended" || status === "unpaid" || status === "revoked") return styles.badgeDanger;
  return styles.badgeMuted;
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

  const perSeat = plans.find((p) => p.key === plan)?.perSeat ?? false;
  const selectedPlan = plans.find((p) => p.key === plan) ?? plans[0];
  const selectedOrg = activeOrgs.find((m) => m.org_slug === orgSlug);
  const selectedOrgStatus = billingSummary?.organization.status ?? selectedOrg?.org_status;
  const canManageSelectedOrg = Boolean(
    billingSummary?.membership.can_manage_billing ?? (selectedOrg?.role === "owner" || selectedOrg?.role === "admin"),
  );
  const selectedOrgActive = selectedOrgStatus === "active";
  const hasSubscription = Boolean(billingSummary?.billing?.subscription_status);
  const billing = billingSummary?.billing ?? null;

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
            : `Could not start checkout (${json.error ?? res.status}).`,
        );
        return;
      }
      if (json.checkout_url) {
        window.location.href = json.checkout_url;
      }
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
      if (json.portal_url) {
        window.location.href = json.portal_url;
      }
    } catch {
      setError("Could not open billing portal.");
    } finally {
      setBusy(false);
    }
  }

  const ShellTag = embedded ? "section" : "main";

  return (
    <ShellTag id={embedded ? undefined : "main"} className={`${styles.shell} ${embedded ? styles.embeddedShell : ""}`}>
      {!embedded && (
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>Billing</h1>
            <p className={styles.meta}>Activate your organization by choosing a plan.</p>
          </div>
          <div className={styles.headerActions}>
            <a className={styles.buttonSecondary} href="/console?view=agents">agent control</a>
          </div>
        </header>
      )}

      <section className={styles.panel}>
        {notice ? <p className={styles.status}>{notice}</p> : null}
        {error ? <p className={styles.notice}>{error}</p> : null}

        {activeOrgs.length === 0 ? (
          <p className={styles.sectionLead}>You do not have an active organization membership yet.</p>
        ) : (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Billing status</h2>

            <label className={styles.label}>Organization</label>
            <select className={styles.field} value={orgSlug} onChange={(e) => setOrgSlug(e.target.value)}>
              {activeOrgs.map((m) => (
                <option key={m.org_id} value={m.org_slug}>{m.org_name} ({m.org_slug})</option>
              ))}
            </select>

            {billingLoading ? (
              <p className={styles.status}>Loading billing status...</p>
            ) : (
              <div className={styles.summaryBar}>
                <div className={styles.summaryCard}>
                  <span className={styles.summaryLabel}>Org status</span>
                  <span className={`${styles.badge} ${statusBadgeClass(selectedOrgStatus)}`}>
                    {billingLabel(selectedOrgStatus)}
                  </span>
                </div>
                <div className={styles.summaryCard}>
                  <span className={styles.summaryLabel}>Plan</span>
                  <span className={styles.summaryValue}>{billingLabel(billing?.plan)}</span>
                  <span className={styles.summaryHint}>{billingLabel(billing?.billing_interval)}</span>
                </div>
                <div className={styles.summaryCard}>
                  <span className={styles.summaryLabel}>Seats</span>
                  <span className={styles.summaryValue}>{billing?.seats ?? "-"}</span>
                </div>
                <div className={styles.summaryCard}>
                  <span className={styles.summaryLabel}>Subscription</span>
                  <span className={`${styles.badge} ${statusBadgeClass(billing?.subscription_status)}`}>
                    {billingLabel(billing?.subscription_status)}
                  </span>
                  <span className={styles.summaryHint}>
                    {billing?.current_period_end ? `renews ${formatDate(billing.current_period_end)}` : "no renewal date"}
                  </span>
                </div>
              </div>
            )}

            {!canManageSelectedOrg ? (
              <p className={styles.sectionLead}>
                Your role can view billing status. Ask an org owner or admin to change plans or manage seats.
              </p>
            ) : (
              <div className={styles.detailSection}>
                <h2 className={styles.sectionTitle}>Choose a plan</h2>

                <div className={styles.billingPlanGrid} role="radiogroup" aria-label="Billing plan">
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
                  <>
                    <label className={styles.label}>Seats</label>
                    <input
                      className={styles.field}
                      type="number"
                      min={1}
                      max={500}
                      value={seats}
                      onChange={(e) => setSeats(Math.max(1, Number(e.target.value) || 1))}
                    />
                  </>
                ) : null}

                <div className={styles.billingCheckoutBox}>
                  <div>
                    <span className={styles.summaryLabel}>Stripe Checkout</span>
                    <p className={styles.sectionLead} style={{ marginTop: 4 }}>
                      Continue to Stripe for {selectedPlan.label.toLowerCase()}
                      {perSeat ? ` with ${seats} seat${seats === 1 ? "" : "s"}` : ""}. If you have a 1 month or 1 year Frege code,
                      enter it in Stripe&apos;s promotion code field before completing checkout.
                    </p>
                  </div>
                </div>

                <div className={styles.buttonRow}>
                  <button type="button" className={styles.button} disabled={busy || !orgSlug} onClick={startCheckout}>
                    {busy ? "Starting..." : "Continue to Stripe Checkout"}
                  </button>
                  {hasSubscription ? (
                    <button type="button" className={styles.buttonSecondary} disabled={busy || !orgSlug} onClick={openPortal}>
                      Manage billing & seats
                    </button>
                  ) : null}
                </div>
                {selectedOrgActive ? (
                  <p className={styles.status}>This organization is active.</p>
                ) : null}
              </div>
            )}
            <p className={styles.sectionLead}>
              Agents stay blocked until payment completes. If you have a Stripe promotion code, enter it during Checkout. Need enterprise terms?{" "}
              <a className={styles.code} href="/contact">Contact us</a>.
            </p>
          </div>
        )}
      </section>
    </ShellTag>
  );
}
