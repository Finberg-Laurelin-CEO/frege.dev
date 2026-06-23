"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../admin/admin.module.css";

type Tab = "queue" | "orgs" | "users" | "signups" | "usage" | "payments" | "audit";

const tabs: { id: Tab; label: string }[] = [
  { id: "queue", label: "action queue" },
  { id: "orgs", label: "orgs" },
  { id: "users", label: "users" },
  { id: "signups", label: "approvals" },
  { id: "usage", label: "usage" },
  { id: "payments", label: "payments" },
  { id: "audit", label: "audit" },
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
    customer_email: string | null;
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

type AuditEvent = {
  id: string;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
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

function shortDay(value: string): string {
  return String(value).slice(0, 10);
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
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [inviteLinks, setInviteLinks] = useState<Record<string, string>>({});
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

  const loadPayments = useCallback(async () => {
    try {
      const r = await fetch(`/api/v1/platform/payments/overview`);
      const json = await r.json();
      if (!r.ok) {
        setError(
          json.error === "insufficient_stripe_permission"
            ? "Stripe key lacks permission to read payments."
            : json.error === "billing_unavailable"
              ? "Stripe is not configured."
              : `Failed to load payments (${r.status}).`,
        );
        setPayments(null);
        return;
      }
      setPayments(json as PaymentsOverview);
    } catch {
      setError("Failed to load payments.");
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

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (tab === "queue") void loadQueue();
    else if (tab === "payments") void loadPayments();
    else if (tab === "audit") void loadAudit();
  }, [tab, loadQueue, loadPayments, loadAudit]);

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

      <div className={styles.grid}>
        <nav className={styles.nav} aria-label="Platform sections">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={styles.tab}
              aria-current={tab === t.id}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
          <div style={{ marginTop: 12 }}>
            <input
              className={styles.field}
              placeholder="search orgs/users"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </nav>

        <section className={styles.panel}>
          {error ? <p className={styles.notice}>{error}</p> : null}
          {busy ? <p className={styles.status}>Loading…</p> : null}

          {tab === "orgs" ? (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Organizations ({orgs.length})</h2>
              <table className={styles.table}>
                <thead>
                  <tr><th>slug</th><th>status</th><th>plan</th><th>members</th><th>keys</th><th>actions</th></tr>
                </thead>
                <tbody>
                  {orgs.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <button type="button" className={styles.linkButton} onClick={() => openDetail(o.id)}>{o.slug}</button>
                      </td>
                      <td>{o.status}</td>
                      <td>{o.plan ? `${o.plan}/${o.billing_interval}` : "—"}</td>
                      <td>{o.member_count}</td>
                      <td>{o.active_keys}</td>
                      <td>
                        {o.status !== "active" ? (
                          <button type="button" className={styles.button} disabled={busy} onClick={() => setOrgStatus(o.id, "active")}>activate</button>
                        ) : null}
                        {o.status !== "suspended" ? (
                          <button type="button" className={styles.buttonSecondary} disabled={busy} onClick={() => setOrgStatus(o.id, "suspended")}>suspend</button>
                        ) : null}
                        {o.subscription_status ? (
                          <button type="button" className={styles.buttonSecondary} disabled={busy} onClick={() => openOrgPortal(o.id)}>billing</button>
                        ) : null}
                        {o.subscription_status && o.subscription_status !== "canceled" ? (
                          <button
                            type="button"
                            className={styles.buttonSecondary}
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {detailBusy && !detail ? <p className={styles.status}>Loading org…</p> : null}

              {detail ? (
                <div className={styles.detail}>
                  <div className={styles.detailHeader}>
                    <h3 className={styles.sectionTitle}>
                      {detail.organization.name} ({detail.organization.slug}) — {detail.organization.status}
                    </h3>
                    <button type="button" className={styles.buttonSecondary} onClick={() => setDetail(null)}>close</button>
                  </div>

                  <div>
                    <h4 className={styles.label}>Billing</h4>
                    <p className={styles.sectionLead}>
                      {detail.organization.plan
                        ? `${detail.organization.plan} · ${detail.organization.billing_interval} · ${detail.organization.seats ?? 1} seat(s) · ${detail.organization.subscription_status ?? "no subscription"}`
                        : "No billing record yet."}
                    </p>
                  </div>

                  <div>
                    <h4 className={styles.label}>Members ({detail.members.length})</h4>
                    <table className={styles.table}>
                      <thead>
                        <tr><th>email</th><th>role</th><th>membership</th><th>user</th><th>actions</th></tr>
                      </thead>
                      <tbody>
                        {detail.members.map((m) => (
                          <tr key={m.user_id}>
                            <td>{m.email}</td>
                            <td>{m.role}</td>
                            <td>{m.membership_status}</td>
                            <td>{m.user_status}</td>
                            <td>
                              {m.membership_status === "active" ? (
                                <button type="button" className={styles.buttonSecondary} disabled={detailBusy} onClick={() => setMembershipStatus(detail.organization.id, m.user_id, "disabled")}>revoke access</button>
                              ) : (
                                <button type="button" className={styles.button} disabled={detailBusy} onClick={() => setMembershipStatus(detail.organization.id, m.user_id, "active")}>restore</button>
                              )}
                              {m.user_status === "active" ? (
                                <button type="button" className={styles.buttonSecondary} disabled={detailBusy} onClick={() => setUserStatus(detail.organization.id, m.user_id, "disabled")}>disable user</button>
                              ) : (
                                <button type="button" className={styles.button} disabled={detailBusy} onClick={() => setUserStatus(detail.organization.id, m.user_id, "active")}>enable user</button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div>
                    <h4 className={styles.label}>API keys ({detail.api_keys.length})</h4>
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
                            <td>{k.status}</td>
                            <td>
                              {k.status === "active" ? (
                                <button type="button" className={styles.buttonSecondary} disabled={detailBusy} onClick={() => revokeKey(detail.organization.id, k.id)}>revoke</button>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div>
                    <h4 className={styles.label}>Usage by user (30 days)</h4>
                    <table className={styles.table}>
                      <thead>
                        <tr><th>user</th><th>model calls</th><th>context builds</th><th>denied</th><th>in tok</th><th>out tok</th><th>est. cost</th></tr>
                      </thead>
                      <tbody>
                        {detail.usage.by_user.map((u) => (
                          <tr key={u.user_id}>
                            <td>{u.email}</td>
                            <td>{u.model_calls}</td>
                            <td>{u.context_builds}</td>
                            <td>{u.denied_events}</td>
                            <td>{u.input_tokens}</td>
                            <td>{u.output_tokens}</td>
                            <td>{money(u.estimated_cost_usd)}</td>
                          </tr>
                        ))}
                        <tr>
                          <td><strong>total</strong></td>
                          <td><strong>{detail.usage.totals.model_calls}</strong></td>
                          <td><strong>{detail.usage.totals.context_builds}</strong></td>
                          <td><strong>{detail.usage.totals.denied_events}</strong></td>
                          <td><strong>{detail.usage.totals.input_tokens}</strong></td>
                          <td><strong>{detail.usage.totals.output_tokens}</strong></td>
                          <td><strong>{money(detail.usage.totals.estimated_cost_usd)}</strong></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === "users" ? (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Users ({users.length})</h2>
              <table className={styles.table}>
                <thead>
                  <tr><th>email</th><th>name</th><th>status</th><th>staff</th><th>orgs</th></tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.email}</td>
                      <td>{u.name ?? "—"}</td>
                      <td>{u.status}</td>
                      <td>{u.is_platform_staff ? "yes" : ""}</td>
                      <td>{u.memberships.map((m) => `${m.org_slug}:${m.role}`).join(", ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {tab === "signups" ? (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Pilot applications ({signups.length})</h2>
              <table className={styles.table}>
                <thead>
                  <tr><th>email</th><th>company</th><th>status</th><th>willing to pay</th><th>action</th></tr>
                </thead>
                <tbody>
                  {signups.map((s) => (
                    <tr key={s.id}>
                      <td>{s.work_email}</td>
                      <td>{s.company ?? "—"}</td>
                      <td>{s.status}</td>
                      <td>{s.willing_to_pay ?? "—"}</td>
                      <td>
                        {s.invite_id ? (
                          inviteLinks[s.id] ? (
                            <code className={styles.code}>{inviteLinks[s.id]}</code>
                          ) : (
                            <span className={styles.status}>invited</span>
                          )
                        ) : (
                          <button type="button" className={styles.button} disabled={busy} onClick={() => approveSignup(s.id)}>approve + invite</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className={styles.sectionLead}>Approving creates an inactive org + owner invite. The org activates after payment.</p>
            </div>
          ) : null}

          {tab === "usage" ? (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Daily trend (30 days)</h2>
              {usageSeries.length === 0 ? (
                <p className={styles.sectionLead}>No usage recorded in the window yet.</p>
              ) : (
                <table className={styles.table}>
                  <thead>
                    <tr><th>day</th><th>model calls</th><th>context builds</th><th>denied</th><th>in tok</th><th>out tok</th><th>est. cost</th></tr>
                  </thead>
                  <tbody>
                    {usageSeries.map((d) => (
                      <tr key={d.day}>
                        <td>{shortDay(d.day)}</td>
                        <td>{d.model_calls}</td>
                        <td>{d.context_builds}</td>
                        <td>{d.denied_events}</td>
                        <td>{d.input_tokens}</td>
                        <td>{d.output_tokens}</td>
                        <td>{money(d.estimated_cost_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <h2 className={styles.sectionTitle} style={{ marginTop: 18 }}>Usage by org (30 days)</h2>
              <table className={styles.table}>
                <thead>
                  <tr><th>org</th><th>status</th><th>model calls</th><th>context builds</th><th>denied</th><th>in tok</th><th>out tok</th><th>est. cost</th></tr>
                </thead>
                <tbody>
                  {usage.map((u) => (
                    <tr key={u.org_id}>
                      <td>{u.slug}</td>
                      <td>{u.status}</td>
                      <td>{u.model_calls}</td>
                      <td>{u.context_builds}</td>
                      <td>{u.denied_events}</td>
                      <td>{u.input_tokens}</td>
                      <td>{u.output_tokens}</td>
                      <td>{money(u.estimated_cost_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {tab === "queue" ? (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Action queue ({queue.length})</h2>
              {queue.length === 0 ? (
                <p className={styles.sectionLead}>Nothing needs attention right now.</p>
              ) : (
                <table className={styles.table}>
                  <thead>
                    <tr><th>priority</th><th>item</th><th>detail</th></tr>
                  </thead>
                  <tbody>
                    {queue.map((item, i) => (
                      <tr key={`${item.kind}-${item.target_id ?? i}`}>
                        <td>{item.severity}</td>
                        <td>{item.title}</td>
                        <td>{item.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : null}

          {tab === "payments" ? (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Payments</h2>
              {payments === null ? (
                <p className={styles.sectionLead}>No payments data loaded.</p>
              ) : (
                <>
                  <table className={styles.table}>
                    <thead>
                      <tr><th>MRR</th><th>active subs</th><th>past due</th><th>payouts</th></tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>{money(payments.mrr_cents / 100)}</td>
                        <td>{payments.active_subscriptions}</td>
                        <td>{payments.past_due_subscriptions}</td>
                        <td>
                          {payments.payout
                            ? payments.payout.enabled
                              ? "enabled"
                              : `disabled${payments.payout.disabled_reason ? ` (${payments.payout.disabled_reason})` : ""}`
                            : "unknown"}
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <h2 className={styles.sectionTitle} style={{ marginTop: 18 }}>Open invoices ({payments.open_invoices.length})</h2>
                  {payments.open_invoices.length === 0 ? (
                    <p className={styles.sectionLead}>No unpaid invoices.</p>
                  ) : (
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
                  )}

                  <h2 className={styles.sectionTitle} style={{ marginTop: 18 }}>Recent charges</h2>
                  <table className={styles.table}>
                    <thead>
                      <tr><th>date</th><th>customer</th><th>amount</th><th>status</th><th>action</th></tr>
                    </thead>
                    <tbody>
                      {payments.recent_charges.map((c) => (
                        <tr key={c.id}>
                          <td>{shortDay(c.created)}</td>
                          <td>{c.customer_email ?? "—"}</td>
                          <td>{money(c.amount / 100)} {c.currency.toUpperCase()}</td>
                          <td>{c.refunded ? "refunded" : c.status}</td>
                          <td>
                            {c.status === "succeeded" && !c.refunded ? (
                              <button type="button" className={styles.button} disabled={busy} onClick={() => refundCharge(c.id)}>refund</button>
                            ) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          ) : null}

          {tab === "audit" ? (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Admin audit log ({audit.length})</h2>
              {audit.length === 0 ? (
                <p className={styles.sectionLead}>No admin actions recorded yet.</p>
              ) : (
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
              )}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
