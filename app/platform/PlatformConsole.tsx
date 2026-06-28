"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../admin/admin.module.css";

type Tab = "queue" | "orgs" | "users" | "signups" | "free-codes" | "usage" | "payments" | "audit";

const tabs: { id: Tab; label: string }[] = [
  { id: "queue", label: "Queue" },
  { id: "orgs", label: "Organizations" },
  { id: "users", label: "Users" },
  { id: "signups", label: "Approvals" },
  { id: "free-codes", label: "Free codes" },
  { id: "usage", label: "Usage" },
  { id: "payments", label: "Payments" },
  { id: "audit", label: "Audit" },
];

type ActionItem = {
  kind: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  target_type: string | null;
  target_id: string | null;
};

type PaymentsOverview = {
  mrr_cents: number;
  arr_cents: number;
  active_subscriptions: number;
  past_due_subscriptions: number;
  recent_charges: {
    id: string;
    amount: number;
    currency: string;
    status: string;
    refunded: boolean;
    description: string | null;
    created: string;
    customer_id: string | null;
    customer_email: string | null;
    org_id: string | null;
    org_slug: string | null;
    org_name: string | null;
  }[];
  open_invoices: {
    id: string;
    amount_due: number;
    currency: string;
    status: string;
    attempt_count: number | null;
    customer_email: string | null;
    hosted_invoice_url: string | null;
    created: string;
  }[];
  payout: { enabled: boolean; disabled_reason: string | null } | null;
};

type RevenueTotals = {
  total_charged_cents: number;
  total_refunded_cents: number;
  net_revenue_cents: number;
  charge_count: number;
};

type RevenueSummary = RevenueTotals & {
  mrr_cents: number;
  arr_cents: number;
  active_subscriptions: number;
  unmapped: RevenueTotals;
  organizations: {
    org_id: string;
    org_slug: string;
    org_name: string;
    org_status: string;
    plan: string | null;
    billing_interval: string | null;
    seats: number | null;
    subscription_status: string | null;
    stripe_customer_id: string | null;
    total_charged_cents: number;
    total_refunded_cents: number;
    net_revenue_cents: number;
    charge_count: number;
  }[];
};

type AuditEvent = {
  id: string;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

type FreeCodeRow = {
  id: string;
  label: string | null;
  status: string;
  plan: string;
  billing_interval: string;
  seats: number;
  metadata: Record<string, unknown>;
  created_by_email: string | null;
  created_at: string;
  revoked_by_email: string | null;
  revoked_at: string | null;
  redeemed_by_email: string | null;
  redeemed_at: string | null;
  redeemed_org_id: string | null;
  redeemed_org_slug: string | null;
  redeemed_org_name: string | null;
};

type OrgRow = {
  id: string;
  slug: string;
  name: string;
  status: string;
  plan: string | null;
  billing_interval: string | null;
  seats: number | null;
  subscription_status: string | null;
  member_count: number;
  active_keys: number;
};

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  status: string;
  is_platform_staff: boolean;
  last_login_at: string | null;
  memberships: { org_slug: string; role: string; membership_status: string }[];
};

type SignupRow = {
  id: string;
  name: string;
  work_email: string;
  company: string | null;
  status: string;
  willing_to_pay: string | null;
  expected_users: number | null;
  invited_at: string | null;
  invite_id: string | null;
  paid_at: string | null;
};

type UsageOrgRow = {
  org_id: string;
  slug: string;
  name: string;
  status: string;
  model_calls: number;
  context_builds: number;
  denied_events: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
};

type OrgDetail = {
  organization: {
    id: string;
    slug: string;
    name: string;
    status: string;
    plan: string | null;
    billing_interval: string | null;
    seats: number | null;
    subscription_status: string | null;
    current_period_end: string | null;
  };
  members: {
    user_id: string;
    email: string;
    name: string | null;
    user_status: string;
    role: string;
    membership_status: string;
  }[];
  api_keys: {
    id: string;
    name: string;
    key_prefix: string;
    status: string;
    role_slug: string | null;
    owner_email: string | null;
    last_used_at: string | null;
  }[];
  usage: {
    totals: {
      model_calls: number;
      context_builds: number;
      denied_events: number;
      input_tokens: number;
      output_tokens: number;
      estimated_cost_usd: number;
    };
    by_user: {
      user_id: string;
      email: string;
      name: string | null;
      model_calls: number;
      context_builds: number;
      denied_events: number;
      input_tokens: number;
      output_tokens: number;
      estimated_cost_usd: number;
    }[];
  };
};

type UsageDayRow = {
  day: string;
  model_calls: number;
  context_builds: number;
  denied_events: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
};

function money(n: number): string {
  return `$${(n ?? 0).toFixed(2)}`;
}

function num(n: number): string {
  return (n ?? 0).toLocaleString("en-US");
}

function shortDay(value: string): string {
  return String(value).slice(0, 10);
}

function planLabel(plan: string | null, interval: string | null): string {
  return plan ? `${plan}/${interval ?? "—"}` : "—";
}

function chargeCustomerLabel(charge: PaymentsOverview["recent_charges"][number]): string {
  if (charge.org_slug) return `${charge.org_name ?? charge.org_slug} (${charge.org_slug})`;
  return charge.customer_email ?? charge.customer_id ?? "—";
}

type BadgeTone = "ok" | "warn" | "danger" | "muted" | "neutral";

// Map a backend status string to a visual tone. Centralised so org status,
// subscription status, membership, key, charge and invoice states stay
// consistent across every table.
function statusTone(status: string | null | undefined): BadgeTone {
  const s = (status ?? "").toLowerCase();
  if (!s) return "muted";
  if (["active", "succeeded", "paid", "enabled", "trialing", "live"].includes(s)) return "ok";
  if (["past_due", "unpaid", "incomplete", "pending", "open", "incomplete_expired"].includes(s)) return "warn";
  if (["suspended", "canceled", "cancelled", "refunded", "disabled", "failed", "revoked", "inactive"].includes(s))
    return "danger";
  return "neutral";
}

const badgeClassByTone: Record<BadgeTone, string> = {
  ok: styles.badgeOk,
  warn: styles.badgeWarn,
  danger: styles.badgeDanger,
  muted: styles.badgeMuted,
  neutral: "",
};

function Badge({ status, tone, label }: { status?: string | null; tone?: BadgeTone; label?: string }) {
  const resolvedTone = tone ?? statusTone(status);
  const text = label ?? (status && status.length ? status : "—");
  return <span className={`${styles.badge} ${badgeClassByTone[resolvedTone]}`}>{text}</span>;
}

const severityTone: Record<string, BadgeTone> = {
  high: "danger",
  medium: "warn",
  low: "neutral",
};

function platformErrorMessage(json: unknown, status: number, action: string): string {
  const payload = json && typeof json === "object" ? (json as { error?: unknown; message?: unknown }) : {};
  const error = typeof payload.error === "string" ? payload.error : "";
  const message = typeof payload.message === "string" ? payload.message : "";

  if (error === "free_codes_not_configured") {
    return message || "Free activation code storage is not configured for this deployment. Apply db/015_free_activation_codes.sql.";
  }

  if (message) return `${action} failed: ${message}`;
  return `${action} failed (${error || status}).`;
}

export default function PlatformConsole({ staffEmail }: { staffEmail: string }) {
  const [tab, setTab] = useState<Tab>("orgs");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [signups, setSignups] = useState<SignupRow[]>([]);
  const [usage, setUsage] = useState<UsageOrgRow[]>([]);
  const [usageSeries, setUsageSeries] = useState<UsageDayRow[]>([]);
  const [queue, setQueue] = useState<ActionItem[]>([]);
  const [payments, setPayments] = useState<PaymentsOverview | null>(null);
  const [revenue, setRevenue] = useState<RevenueSummary | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [freeCodes, setFreeCodes] = useState<FreeCodeRow[]>([]);
  const [newFreeCodeLabel, setNewFreeCodeLabel] = useState("");
  const [newFreeCodePlan, setNewFreeCodePlan] = useState<"solo" | "team">("team");
  const [newFreeCodeSeats, setNewFreeCodeSeats] = useState(1);
  const [createdRawCode, setCreatedRawCode] = useState("");
  const [inviteLinks, setInviteLinks] = useState<Record<string, string>>({});
  const [inviteEmailSent, setInviteEmailSent] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const [o, u, s, g] = await Promise.all([
        fetch(`/api/v1/platform/orgs${search ? `?q=${encodeURIComponent(search)}` : ""}`).then((r) => r.json()),
        fetch(`/api/v1/platform/users${search ? `?q=${encodeURIComponent(search)}` : ""}`).then((r) => r.json()),
        fetch(`/api/v1/platform/signups`).then((r) => r.json()),
        fetch(`/api/v1/platform/usage?days=30`).then((r) => r.json()),
      ]);
      setOrgs(o.organizations ?? []);
      setUsers(u.users ?? []);
      setSignups(s.signups ?? []);
      setUsage(g.organizations ?? []);
      setUsageSeries(g.series ?? []);
    } catch {
      setError("Failed to load platform data.");
    } finally {
      setBusy(false);
    }
  }, [search]);

  const loadQueue = useCallback(async () => {
    try {
      const r = await fetch(`/api/v1/platform/action-queue`).then((x) => x.json());
      setQueue(r.items ?? []);
    } catch {
      setError("Failed to load action queue.");
    }
  }, []);

  const loadPayments = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setError("");
    try {
      const [overviewRes, revenueRes] = await Promise.all([
        fetch(`/api/v1/platform/payments/overview?limit=25`),
        fetch(`/api/v1/platform/revenue/summary`),
      ]);
      const json = await overviewRes.json();
      if (!overviewRes.ok) {
        // When loading silently for the summary header, don't surface Stripe
        // configuration errors as a top-level notice — the Payments tab will.
        if (!opts?.silent) {
          setError(
            json.error === "insufficient_stripe_permission"
              ? "Stripe key lacks permission to read payments."
              : json.error === "billing_unavailable"
                ? "Stripe is not configured."
                : `Failed to load payments (${overviewRes.status}).`,
          );
        }
        setPayments(null);
        setRevenue(null);
        return;
      }
      setPayments(json as PaymentsOverview);

      const revenueJson = await revenueRes.json();
      if (!revenueRes.ok) {
        setRevenue(null);
        if (!opts?.silent) {
          setError(
            revenueJson.error === "insufficient_stripe_permission"
              ? "Stripe key lacks permission to read revenue."
              : revenueJson.error === "billing_unavailable"
                ? "Stripe is not configured."
                : `Failed to load revenue (${revenueRes.status}).`,
          );
        }
        return;
      }
      setRevenue(revenueJson as RevenueSummary);
    } catch {
      if (!opts?.silent) setError("Failed to load payments.");
      setPayments(null);
      setRevenue(null);
    }
  }, []);

  const loadAudit = useCallback(async () => {
    try {
      const r = await fetch(`/api/v1/platform/audit`).then((x) => x.json());
      setAudit(r.events ?? []);
    } catch {
      setError("Failed to load audit log.");
    }
  }, []);

  const loadFreeCodes = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/platform/free-codes`, { credentials: "same-origin" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFreeCodes([]);
        setError(platformErrorMessage(json, res.status, "Load free codes"));
        return;
      }

      const rows = (json as { free_codes?: FreeCodeRow[] }).free_codes;
      setFreeCodes(Array.isArray(rows) ? rows : []);
    } catch {
      setError("Failed to load free codes.");
      setFreeCodes([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Load queue + payments once on mount so the operator summary header and tab
  // counts are populated even before those tabs are opened. Runs silently so a
  // missing Stripe key doesn't show an error before the operator asks for it.
  useEffect(() => {
    void loadQueue();
    void loadPayments({ silent: true });
  }, [loadQueue, loadPayments]);

  useEffect(() => {
    if (tab === "queue") void loadQueue();
    else if (tab === "payments") void loadPayments();
    else if (tab === "free-codes") void loadFreeCodes();
    else if (tab === "audit") void loadAudit();
  }, [tab, loadQueue, loadPayments, loadFreeCodes, loadAudit]);

  async function cancelSubscription(orgId: string, immediate: boolean) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/platform/orgs/${orgId}/subscription/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ immediate }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(`Cancel failed: ${json.error ?? res.status}`);
      else await loadPayments();
    } finally {
      setBusy(false);
    }
  }

  async function refundCharge(chargeId: string) {
    if (!window.confirm(`Refund charge ${chargeId} in full? This moves real money.`)) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/platform/charges/${chargeId}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(`Refund failed: ${json.error ?? res.status}`);
      else await loadPayments();
    } finally {
      setBusy(false);
    }
  }

  async function setOrgStatus(id: string, status: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/platform/orgs/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        setError(`Status change failed (${res.status}).`);
      } else {
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function createFreeCode() {
    setBusy(true);
    setError("");
    setCreatedRawCode("");
    const seats = Math.min(500, Math.max(1, Number(newFreeCodeSeats) || 1));
    setNewFreeCodeSeats(seats);
    try {
      const res = await fetch(`/api/v1/platform/free-codes`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: newFreeCodeLabel.trim() || undefined,
          plan: newFreeCodePlan,
          billing_interval: "permanent",
          seats,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(platformErrorMessage(json, res.status, "Create free code"));
        return;
      }
      const rawCode = (json as { raw_code?: string }).raw_code;
      setCreatedRawCode(rawCode ?? "");
      setNewFreeCodeLabel("");
      await loadFreeCodes();
    } finally {
      setBusy(false);
    }
  }

  async function revokeFreeCode(id: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/platform/free-codes/${id}/revoke`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(platformErrorMessage(json, res.status, "Revoke free code"));
      else await loadFreeCodes();
    } finally {
      setBusy(false);
    }
  }

  async function copyCreatedFreeCode() {
    if (!createdRawCode) return;
    try {
      await navigator.clipboard.writeText(createdRawCode);
    } catch {
      setError("Could not copy the new free code.");
    }
  }

  async function openOrgPortal(id: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/platform/orgs/${id}/billing-portal`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setError(
          json.error === "no_subscription"
            ? "This org has no Stripe customer yet."
            : `Could not open billing portal (${json.error ?? res.status}).`,
        );
      } else if (json.portal_url) {
        window.open(json.portal_url, "_blank", "noopener");
      }
    } catch {
      setError("Could not open billing portal.");
    } finally {
      setBusy(false);
    }
  }

  async function approveSignup(id: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/platform/signups/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(`Approve failed: ${json.error ?? res.status}`);
      } else {
        setInviteLinks((prev) => ({ ...prev, [id]: json.invite_link }));
        setInviteEmailSent((prev) => ({ ...prev, [id]: Boolean(json.email_sent) }));
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  const openDetail = useCallback(async (orgId: string) => {
    setDetailBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/platform/orgs/${orgId}`);
      const json = await res.json();
      if (!res.ok) {
        setError(`Failed to load org detail (${res.status}).`);
        return;
      }
      setDetail(json as OrgDetail);
    } catch {
      setError("Failed to load org detail.");
    } finally {
      setDetailBusy(false);
    }
  }, []);

  async function refreshDetail(orgId: string) {
    await openDetail(orgId);
    await load();
  }

  async function revokeKey(orgId: string, keyId: string) {
    setDetailBusy(true);
    try {
      const res = await fetch(`/api/v1/platform/api-keys/${keyId}`, { method: "PATCH" });
      if (!res.ok) setError(`Revoke key failed (${res.status}).`);
      else await refreshDetail(orgId);
    } finally {
      setDetailBusy(false);
    }
  }

  async function setMembershipStatus(orgId: string, userId: string, status: "active" | "disabled") {
    setDetailBusy(true);
    try {
      const res = await fetch(`/api/v1/platform/orgs/${orgId}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, membership_status: status }),
      });
      if (!res.ok) setError(`Membership update failed (${res.status}).`);
      else await refreshDetail(orgId);
    } finally {
      setDetailBusy(false);
    }
  }

  async function setUserStatus(orgId: string, userId: string, status: "active" | "disabled") {
    setDetailBusy(true);
    try {
      const res = await fetch(`/api/v1/platform/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error === "cannot_disable_self" ? "You can't disable your own account." : `User update failed (${res.status}).`);
      } else {
        await refreshDetail(orgId);
      }
    } finally {
      setDetailBusy(false);
    }
  }

  // --- Derived summary / count values (from already-loaded data) ---
  const pendingApprovals = signups.filter((s) => !s.invite_id).length;
  const activeFreeCodes = freeCodes.filter((c) => c.status === "active").length;
  const activeOrgs = orgs.filter((o) => o.status === "active").length;
  const highQueue = queue.filter((q) => q.severity === "high").length;
  const paymentIssues = payments
    ? payments.past_due_subscriptions + payments.open_invoices.length
    : 0;

  // Counts shown on tab labels. null = don't render a count chip.
  const tabCounts: Record<Tab, number | null> = {
    queue: queue.length,
    orgs: orgs.length,
    users: users.length,
    signups: pendingApprovals,
    "free-codes": activeFreeCodes,
    usage: null,
    payments: payments ? payments.past_due_subscriptions : null,
    audit: null,
  };
  const tabCountAlert: Partial<Record<Tab, boolean>> = {
    queue: highQueue > 0,
    signups: pendingApprovals > 0,
    payments: !!payments && payments.past_due_subscriptions > 0,
  };

  const summaryCards: { key: string; label: string; value: string; hint?: string; alert?: boolean }[] = [
    {
      key: "queue",
      label: "Action queue",
      value: num(queue.length),
      hint: highQueue > 0 ? `${highQueue} high priority` : "all clear",
      alert: highQueue > 0,
    },
    {
      key: "approvals",
      label: "Pending approvals",
      value: num(pendingApprovals),
      hint: pendingApprovals > 0 ? "awaiting invite" : "none waiting",
      alert: pendingApprovals > 0,
    },
    {
      key: "orgs",
      label: "Active orgs",
      value: num(activeOrgs),
      hint: `${num(orgs.length)} total`,
    },
    {
      key: "payments",
      label: "Payment issues",
      value: payments ? num(paymentIssues) : "—",
      hint: payments
        ? `${num(payments.past_due_subscriptions)} past due · ${num(payments.open_invoices.length)} open inv.`
        : "stripe not loaded",
      alert: paymentIssues > 0,
    },
    {
      key: "mrr",
      label: "MRR",
      value: payments ? money(payments.mrr_cents / 100) : "—",
      hint: payments ? `${num(payments.active_subscriptions)} active subs` : "stripe not loaded",
    },
  ];

  return (
    <main id="main" className={styles.shell}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Frege Platform</h1>
          <p className={styles.meta}>Staff: {staffEmail} · cross-org operations</p>
        </div>
        <div className={styles.headerActions}>
          <a className={styles.buttonSecondary} href="/admin">org admin</a>
        </div>
      </header>

      <div className={styles.summaryBar}>
        {summaryCards.map((c) => (
          <div key={c.key} className={`${styles.summaryCard} ${c.alert ? styles.summaryAlert : ""}`}>
            <span className={styles.summaryValue}>{c.value}</span>
            <span className={styles.summaryLabel}>{c.label}</span>
            {c.hint ? <span className={styles.summaryHint}>{c.hint}</span> : null}
          </div>
        ))}
      </div>

      <div className={styles.grid}>
        <nav className={styles.nav} aria-label="Platform sections">
          {tabs.map((t) => {
            const count = tabCounts[t.id];
            return (
              <button
                key={t.id}
                type="button"
                className={styles.tab}
                aria-current={tab === t.id}
                onClick={() => setTab(t.id)}
              >
                <span>{t.label}</span>
                {count !== null ? (
                  <span className={`${styles.tabCount} ${tabCountAlert[t.id] ? styles.tabCountAlert : ""}`}>
                    {num(count)}
                  </span>
                ) : null}
              </button>
            );
          })}
          <div style={{ marginTop: 12 }}>
            <input
              className={styles.input}
              placeholder="Search orgs / users"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search organizations and users"
            />
          </div>
        </nav>

        <section className={styles.panel}>
          {error ? <p className={styles.notice}>{error}</p> : null}
          {busy ? <p className={styles.status}>Loading…</p> : null}

          {tab === "orgs" ? (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Organizations ({orgs.length})</h2>
              {orgs.length === 0 ? (
                <div className={styles.empty}>
                  <strong>No organizations{search ? " match your search" : ""}.</strong>
                  <span>{search ? "Try a different query." : "Orgs appear here once an approved pilot is created."}</span>
                </div>
              ) : (
              <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr><th>org</th><th>status</th><th>plan</th><th>subscription</th><th>members</th><th>keys</th><th>actions</th></tr>
                </thead>
                <tbody>
                  {orgs.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <button type="button" className={styles.linkButton} onClick={() => openDetail(o.id)}>{o.slug}</button>
                      </td>
                      <td><Badge status={o.status} /></td>
                      <td>{o.plan ? `${o.plan} / ${o.billing_interval}` : "—"}</td>
                      <td>{o.subscription_status ? <Badge status={o.subscription_status} /> : <span className={styles.status}>—</span>}</td>
                      <td>{o.member_count}</td>
                      <td>{o.active_keys}</td>
                      <td>
                        <div className={styles.rowActions}>
                          {o.status !== "active" ? (
                            <button type="button" className={styles.button} disabled={busy} onClick={() => setOrgStatus(o.id, "active")}>activate</button>
                          ) : null}
                          {o.status !== "suspended" ? (
                            <button
                              type="button"
                              className={styles.buttonSecondary}
                              disabled={busy}
                              onClick={() => {
                                if (window.confirm(`Suspend ${o.slug}? Members lose access until reactivated.`)) {
                                  void setOrgStatus(o.id, "suspended");
                                }
                              }}
                            >
                              suspend
                            </button>
                          ) : null}
                          {o.subscription_status ? (
                            <button type="button" className={styles.buttonSecondary} disabled={busy} onClick={() => openOrgPortal(o.id)}>billing</button>
                          ) : null}
                          {o.subscription_status && o.subscription_status !== "canceled" ? (
                            <button
                              type="button"
                              className={styles.buttonDanger}
                              disabled={busy}
                              onClick={() => {
                                if (window.confirm(`Cancel ${o.slug}'s subscription at period end?`)) {
                                  void cancelSubscription(o.id, false);
                                }
                              }}
                            >
                              cancel sub
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              )}

              {detailBusy && !detail ? <p className={styles.status}>Loading org…</p> : null}

              {detail ? (
                <div className={styles.detail}>
                  <div className={styles.detailHeader}>
                    <h3 className={styles.sectionTitle} style={{ margin: 0 }}>
                      {detail.organization.name}{" "}
                      <span className={styles.summaryHint}>({detail.organization.slug})</span>{" "}
                      <Badge status={detail.organization.status} />
                    </h3>
                    <button type="button" className={styles.buttonSecondary} onClick={() => setDetail(null)} aria-label="Close org detail">close</button>
                  </div>

                  {detailBusy ? <p className={styles.status}>Refreshing…</p> : null}

                  <div className={styles.detailSection}>
                    <h4 className={styles.label}>Billing</h4>
                    {detail.organization.plan ? (
                      <p className={styles.sectionLead} style={{ marginTop: 0, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                        <span>{detail.organization.plan} · {detail.organization.billing_interval} · {detail.organization.seats ?? 1} seat(s)</span>
                        <Badge status={detail.organization.subscription_status ?? "no subscription"} />
                        {detail.organization.current_period_end ? (
                          <span className={styles.summaryHint}>renews {shortDay(detail.organization.current_period_end)}</span>
                        ) : null}
                      </p>
                    ) : (
                      <p className={styles.sectionLead} style={{ marginTop: 0 }}>No billing record yet.</p>
                    )}
                  </div>

                  <div className={styles.detailSection}>
                    <h4 className={styles.label}>Members ({detail.members.length})</h4>
                    <div className={styles.tableScroll}>
                    <table className={styles.table}>
                      <thead>
                        <tr><th>email</th><th>role</th><th>membership</th><th>user</th><th>actions</th></tr>
                      </thead>
                      <tbody>
                        {detail.members.map((m) => (
                          <tr key={m.user_id}>
                            <td>{m.email}</td>
                            <td>{m.role}</td>
                            <td><Badge status={m.membership_status} /></td>
                            <td><Badge status={m.user_status} /></td>
                            <td>
                              <div className={styles.rowActions}>
                                {m.membership_status === "active" ? (
                                  <button type="button" className={styles.buttonDanger} disabled={detailBusy} onClick={() => { if (window.confirm(`Revoke ${m.email}'s access to ${detail.organization.slug}?`)) void setMembershipStatus(detail.organization.id, m.user_id, "disabled"); }}>revoke access</button>
                                ) : (
                                  <button type="button" className={styles.button} disabled={detailBusy} onClick={() => setMembershipStatus(detail.organization.id, m.user_id, "active")}>restore</button>
                                )}
                                {m.user_status === "active" ? (
                                  <button type="button" className={styles.buttonDanger} disabled={detailBusy} onClick={() => { if (window.confirm(`Disable the user account for ${m.email}? This affects every org they belong to.`)) void setUserStatus(detail.organization.id, m.user_id, "disabled"); }}>disable user</button>
                                ) : (
                                  <button type="button" className={styles.button} disabled={detailBusy} onClick={() => setUserStatus(detail.organization.id, m.user_id, "active")}>enable user</button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  </div>

                  <div className={styles.detailSection}>
                    <h4 className={styles.label}>API keys ({detail.api_keys.length})</h4>
                    {detail.api_keys.length === 0 ? (
                      <div className={styles.empty}><strong>No API keys.</strong><span>This org hasn&apos;t created any keys yet.</span></div>
                    ) : (
                    <div className={styles.tableScroll}>
                    <table className={styles.table}>
                      <thead>
                        <tr><th>name</th><th>prefix</th><th>role</th><th>owner</th><th>status</th><th>actions</th></tr>
                      </thead>
                      <tbody>
                        {detail.api_keys.map((k) => (
                          <tr key={k.id}>
                            <td>{k.name}</td>
                            <td><code className={styles.code}>{k.key_prefix}</code></td>
                            <td>{k.role_slug ?? "—"}</td>
                            <td>{k.owner_email ?? "—"}</td>
                            <td><Badge status={k.status} /></td>
                            <td>
                              {k.status === "active" ? (
                                <button type="button" className={styles.buttonDanger} disabled={detailBusy} onClick={() => { if (window.confirm(`Revoke API key "${k.name}" (${k.key_prefix})? Requests using it will start failing immediately.`)) void revokeKey(detail.organization.id, k.id); }}>revoke</button>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                    )}
                  </div>

                  <div className={styles.detailSection}>
                    <h4 className={styles.label}>Usage by user (30 days)</h4>
                    {detail.usage.by_user.length === 0 ? (
                      <div className={styles.empty}><strong>No usage in the last 30 days.</strong></div>
                    ) : (
                    <div className={styles.tableScroll}>
                    <table className={styles.table}>
                      <thead>
                        <tr><th>user</th><th>model calls</th><th>context builds</th><th>denied</th><th>in tok</th><th>out tok</th><th>est. cost</th></tr>
                      </thead>
                      <tbody>
                        {detail.usage.by_user.map((u) => (
                          <tr key={u.user_id}>
                            <td>{u.email}</td>
                            <td>{num(u.model_calls)}</td>
                            <td>{num(u.context_builds)}</td>
                            <td>{num(u.denied_events)}</td>
                            <td>{num(u.input_tokens)}</td>
                            <td>{num(u.output_tokens)}</td>
                            <td>{money(u.estimated_cost_usd)}</td>
                          </tr>
                        ))}
                        <tr>
                          <td><strong>total</strong></td>
                          <td><strong>{num(detail.usage.totals.model_calls)}</strong></td>
                          <td><strong>{num(detail.usage.totals.context_builds)}</strong></td>
                          <td><strong>{num(detail.usage.totals.denied_events)}</strong></td>
                          <td><strong>{num(detail.usage.totals.input_tokens)}</strong></td>
                          <td><strong>{num(detail.usage.totals.output_tokens)}</strong></td>
                          <td><strong>{money(detail.usage.totals.estimated_cost_usd)}</strong></td>
                        </tr>
                      </tbody>
                    </table>
                    </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === "users" ? (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Users ({users.length})</h2>
              {users.length === 0 ? (
                <div className={styles.empty}>
                  <strong>No users{search ? " match your search" : ""}.</strong>
                  <span>{search ? "Try a different query." : "Users appear here after they accept an invite."}</span>
                </div>
              ) : (
              <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr><th>email</th><th>name</th><th>status</th><th>staff</th><th>orgs</th></tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.email}</td>
                      <td>{u.name ?? "—"}</td>
                      <td><Badge status={u.status} /></td>
                      <td>{u.is_platform_staff ? <Badge tone="ok" label="staff" /> : <span className={styles.status}>—</span>}</td>
                      <td>{u.memberships.map((m) => `${m.org_slug}:${m.role}`).join(", ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              )}
            </div>
          ) : null}

          {tab === "signups" ? (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Pilot applications ({signups.length})</h2>
              {signups.length === 0 ? (
                <div className={styles.empty}>
                  <strong>No pilot applications yet.</strong>
                  <span>New applications from the signup form land here for review.</span>
                </div>
              ) : (
              <>
              <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr><th>email</th><th>company</th><th>status</th><th>willing to pay</th><th>paid</th><th>action</th></tr>
                </thead>
                <tbody>
                  {signups.map((s) => (
                    <tr key={s.id}>
                      <td>{s.work_email}</td>
                      <td>{s.company ?? "—"}</td>
                      <td><Badge status={s.status} /></td>
                      <td>{s.willing_to_pay ?? "—"}</td>
                      <td>{s.paid_at ? shortDay(s.paid_at) : "—"}</td>
                      <td>
                        {s.invite_id ? (
                          inviteLinks[s.id] ? (
                            <>
                              <Badge
                                tone={inviteEmailSent[s.id] ? "ok" : "warn"}
                                label={inviteEmailSent[s.id] ? "email sent" : "email not sent — share link"}
                              />
                              <code className={styles.code}>{inviteLinks[s.id]}</code>
                            </>
                          ) : (
                            <Badge tone="ok" label="invited" />
                          )
                        ) : (
                          <button type="button" className={styles.button} disabled={busy} onClick={() => approveSignup(s.id)}>approve + invite</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              <p className={styles.sectionLead}>Approving creates an inactive org + owner invite. The org activates after payment.</p>
              </>
              )}
            </div>
          ) : null}

          {tab === "free-codes" ? (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Free activation codes ({freeCodes.length})</h2>

              <div className={styles.detailSection}>
                <h3 className={styles.sectionTitle}>Create free code</h3>
                {createdRawCode ? (
                  <div className={styles.notice}>
                    <strong>New free code created</strong>
                    <span>Copy it now. Frege stores only the hash and cannot show this raw code again.</span>
                    <code className={styles.code}>{createdRawCode}</code>
                    <div className={styles.buttonRow}>
                      <button type="button" className={`${styles.button} ${styles.buttonSecondary}`} onClick={copyCreatedFreeCode}>
                        copy code
                      </button>
                    </div>
                  </div>
                ) : null}
                <label className={styles.label}>Label</label>
                <input
                  className={styles.input}
                  value={newFreeCodeLabel}
                  onChange={(e) => setNewFreeCodeLabel(e.target.value)}
                  placeholder="Demo org, partner, Joe/team"
                />
                <label className={styles.label}>Plan</label>
                <select className={styles.field} value={newFreeCodePlan} onChange={(e) => setNewFreeCodePlan(e.target.value as "solo" | "team")}>
                  <option value="team">team</option>
                  <option value="solo">solo</option>
                </select>
                <label className={styles.label}>Seats</label>
                <input
                  className={styles.field}
                  type="number"
                  min={1}
                  max={500}
                  value={newFreeCodeSeats}
                  onChange={(e) => setNewFreeCodeSeats(Math.min(500, Math.max(1, Number(e.target.value) || 1)))}
                />
                <div className={styles.buttonRow}>
                  <button type="button" className={styles.button} disabled={busy} onClick={createFreeCode}>create code</button>
                </div>
              </div>

              {freeCodes.length === 0 ? (
                <div className={styles.empty}><strong>No free codes yet.</strong></div>
              ) : (
                <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr><th>label</th><th>status</th><th>entitlement</th><th>created</th><th>redeemed</th><th>action</th></tr>
                  </thead>
                  <tbody>
                    {freeCodes.map((code) => (
                      <tr key={code.id}>
                        <td>{code.label ?? "—"}</td>
                        <td><Badge status={code.status} /></td>
                        <td>{code.plan}/{code.billing_interval} · {code.seats} seat(s)</td>
                        <td>{shortDay(code.created_at)} · {code.created_by_email ?? "—"}</td>
                        <td>
                          {code.redeemed_at ? (
                            <>
                              {shortDay(code.redeemed_at)} · {code.redeemed_by_email ?? "—"}
                              <br />
                              <span className={styles.summaryHint}>{code.redeemed_org_slug ?? code.redeemed_org_id ?? "—"}</span>
                            </>
                          ) : code.revoked_at ? (
                            <span className={styles.summaryHint}>revoked {shortDay(code.revoked_at)} · {code.revoked_by_email ?? "—"}</span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          {code.status === "active" ? (
                            <button
                              type="button"
                              className={styles.buttonDanger}
                              disabled={busy}
                              onClick={() => {
                                if (window.confirm(`Revoke unused free code${code.label ? ` "${code.label}"` : ""}?`)) {
                                  void revokeFreeCode(code.id);
                                }
                              }}
                            >
                              revoke
                            </button>
                          ) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </div>
          ) : null}

          {tab === "usage" ? (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Daily trend (30 days)</h2>
              {usageSeries.length === 0 ? (
                <div className={styles.empty}><strong>No usage recorded in the window yet.</strong></div>
              ) : (
                <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr><th>day</th><th>model calls</th><th>context builds</th><th>denied</th><th>in tok</th><th>out tok</th><th>est. cost</th></tr>
                  </thead>
                  <tbody>
                    {usageSeries.map((d) => (
                      <tr key={d.day}>
                        <td>{shortDay(d.day)}</td>
                        <td>{num(d.model_calls)}</td>
                        <td>{num(d.context_builds)}</td>
                        <td>{num(d.denied_events)}</td>
                        <td>{num(d.input_tokens)}</td>
                        <td>{num(d.output_tokens)}</td>
                        <td>{money(d.estimated_cost_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}

              <h2 className={styles.sectionTitle} style={{ marginTop: 18 }}>Usage by org (30 days)</h2>
              {usage.length === 0 ? (
                <div className={styles.empty}><strong>No per-org usage yet.</strong></div>
              ) : (
              <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr><th>org</th><th>status</th><th>model calls</th><th>context builds</th><th>denied</th><th>in tok</th><th>out tok</th><th>est. cost</th></tr>
                </thead>
                <tbody>
                  {usage.map((u) => (
                    <tr key={u.org_id}>
                      <td>{u.slug}</td>
                      <td><Badge status={u.status} /></td>
                      <td>{num(u.model_calls)}</td>
                      <td>{num(u.context_builds)}</td>
                      <td>{num(u.denied_events)}</td>
                      <td>{num(u.input_tokens)}</td>
                      <td>{num(u.output_tokens)}</td>
                      <td>{money(u.estimated_cost_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              )}
            </div>
          ) : null}

          {tab === "queue" ? (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Action queue ({queue.length})</h2>
              {queue.length === 0 ? (
                <div className={styles.empty}>
                  <strong>Nothing needs attention right now.</strong>
                  <span>Past-due subscriptions, pending approvals, and other operator tasks show up here.</span>
                </div>
              ) : (
                <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr><th>priority</th><th>item</th><th>detail</th></tr>
                  </thead>
                  <tbody>
                    {queue.map((item, i) => (
                      <tr key={`${item.kind}-${item.target_id ?? i}`}>
                        <td><Badge tone={severityTone[item.severity] ?? "neutral"} label={item.severity} /></td>
                        <td>{item.title}</td>
                        <td>{item.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </div>
          ) : null}

          {tab === "payments" ? (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Payments</h2>
              {payments === null ? (
                <div className={styles.empty}>
                  <strong>No payments data loaded.</strong>
                  <span>Stripe may not be configured, or the key lacks read permission.</span>
                </div>
              ) : (
                <>
                  <div className={styles.summary}>
                    <div className={styles.metric}>
                      <span className={styles.metricValue}>{money(payments.mrr_cents / 100)}</span>
                      <span className={styles.metricLabel}>MRR</span>
                    </div>
                    <div className={styles.metric}>
                      <span className={styles.metricValue}>{money(payments.arr_cents / 100)}</span>
                      <span className={styles.metricLabel}>ARR</span>
                    </div>
                    <div className={styles.metric}>
                      <span className={styles.metricValue}>{num(payments.active_subscriptions)}</span>
                      <span className={styles.metricLabel}>Active subscriptions</span>
                    </div>
                    <div className={styles.metric}>
                      <span className={styles.metricValue}>{num(payments.past_due_subscriptions)}</span>
                      <span className={styles.metricLabel}>Past due</span>
                    </div>
                    <div className={styles.metric}>
                      <span className={styles.metricValue} style={{ fontSize: 15 }}>
                        {payments.payout ? (
                          <Badge
                            tone={payments.payout.enabled ? "ok" : "danger"}
                            label={payments.payout.enabled ? "enabled" : "disabled"}
                          />
                        ) : (
                          <Badge tone="muted" label="unknown" />
                        )}
                      </span>
                      <span className={styles.metricLabel}>
                        Payouts
                        {payments.payout && !payments.payout.enabled && payments.payout.disabled_reason
                          ? ` · ${payments.payout.disabled_reason}`
                          : ""}
                      </span>
                    </div>
                  </div>

                  {revenue ? (
                    <>
                      <h2 className={styles.sectionTitle} style={{ marginTop: 18 }}>Revenue summary</h2>
                      <div className={styles.tableScroll}>
                      <table className={styles.table}>
                        <thead>
                          <tr><th>gross</th><th>refunds</th><th>net</th><th>charges</th><th>unmapped net</th></tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td>{money(revenue.total_charged_cents / 100)}</td>
                            <td>{money(revenue.total_refunded_cents / 100)}</td>
                            <td>{money(revenue.net_revenue_cents / 100)}</td>
                            <td>{num(revenue.charge_count)}</td>
                            <td>{money(revenue.unmapped.net_revenue_cents / 100)}</td>
                          </tr>
                        </tbody>
                      </table>
                      </div>

                      <h2 className={styles.sectionTitle} style={{ marginTop: 18 }}>Revenue by org</h2>
                      <div className={styles.tableScroll}>
                      <table className={styles.table}>
                        <thead>
                          <tr><th>org</th><th>status</th><th>plan</th><th>seats</th><th>subscription</th><th>gross</th><th>refunds</th><th>net</th><th>charges</th></tr>
                        </thead>
                        <tbody>
                          {revenue.organizations.map((org) => (
                            <tr key={org.org_id}>
                              <td>{org.org_name} ({org.org_slug})</td>
                              <td><Badge status={org.org_status} /></td>
                              <td>{planLabel(org.plan, org.billing_interval)}</td>
                              <td>{org.seats ?? "—"}</td>
                              <td>{org.subscription_status ? <Badge status={org.subscription_status} /> : <span className={styles.status}>—</span>}</td>
                              <td>{money(org.total_charged_cents / 100)}</td>
                              <td>{money(org.total_refunded_cents / 100)}</td>
                              <td>{money(org.net_revenue_cents / 100)}</td>
                              <td>{num(org.charge_count)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
                    </>
                  ) : null}

                  <h2 className={styles.sectionTitle} style={{ marginTop: 18 }}>Open invoices ({payments.open_invoices.length})</h2>
                  {payments.open_invoices.length === 0 ? (
                    <div className={styles.empty}><strong>No unpaid invoices.</strong></div>
                  ) : (
                    <div className={styles.tableScroll}>
                    <table className={styles.table}>
                      <thead>
                        <tr><th>customer</th><th>amount</th><th>attempts</th><th>link</th></tr>
                      </thead>
                      <tbody>
                        {payments.open_invoices.map((inv) => (
                          <tr key={inv.id}>
                            <td>{inv.customer_email ?? "—"}</td>
                            <td>{money(inv.amount_due / 100)} {inv.currency.toUpperCase()}</td>
                            <td>{inv.attempt_count ?? 0}</td>
                            <td>
                              {inv.hosted_invoice_url ? (
                                <a className={styles.link} href={inv.hosted_invoice_url} target="_blank" rel="noopener noreferrer">view</a>
                              ) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  )}

                  <h2 className={styles.sectionTitle} style={{ marginTop: 18 }}>Recent charges</h2>
                  {payments.recent_charges.length === 0 ? (
                    <div className={styles.empty}><strong>No recent charges.</strong></div>
                  ) : (
                  <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr><th>date</th><th>customer</th><th>amount</th><th>status</th><th>action</th></tr>
                    </thead>
                    <tbody>
                      {payments.recent_charges.map((c) => (
                        <tr key={c.id}>
                          <td>{shortDay(c.created)}</td>
                          <td>{chargeCustomerLabel(c)}</td>
                          <td>{money(c.amount / 100)} {c.currency.toUpperCase()}</td>
                          <td>{c.refunded ? <Badge tone="danger" label="refunded" /> : <Badge status={c.status} />}</td>
                          <td>
                            {c.status === "succeeded" && !c.refunded ? (
                              <button type="button" className={styles.buttonDanger} disabled={busy} onClick={() => refundCharge(c.id)}>refund</button>
                            ) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                  )}
                </>
              )}
            </div>
          ) : null}

          {tab === "audit" ? (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Admin audit log ({audit.length})</h2>
              {audit.length === 0 ? (
                <div className={styles.empty}><strong>No admin actions recorded yet.</strong></div>
              ) : (
                <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr><th>when</th><th>actor</th><th>action</th><th>target</th></tr>
                  </thead>
                  <tbody>
                    {audit.map((e) => (
                      <tr key={e.id}>
                        <td>{shortDay(e.created_at)}</td>
                        <td>{e.actor_email ?? "—"}</td>
                        <td>{e.action}</td>
                        <td>{e.target_type ? `${e.target_type}:${e.target_id ?? ""}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
