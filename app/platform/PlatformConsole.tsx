"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../admin/admin.module.css";

type Tab = "orgs" | "users" | "signups" | "usage";

const tabs: { id: Tab; label: string }[] = [
  { id: "orgs", label: "orgs" },
  { id: "users", label: "users" },
  { id: "signups", label: "approvals" },
  { id: "usage", label: "usage" },
];

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

function money(n: number): string {
  return `$${(n ?? 0).toFixed(2)}`;
}

export default function PlatformConsole({ staffEmail }: { staffEmail: string }) {
  const [tab, setTab] = useState<Tab>("orgs");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [signups, setSignups] = useState<SignupRow[]>([]);
  const [usage, setUsage] = useState<UsageOrgRow[]>([]);
  const [inviteLinks, setInviteLinks] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");

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
    } catch {
      setError("Failed to load platform data.");
    } finally {
      setBusy(false);
    }
  }, [search]);

  useEffect(() => {
    void load();
  }, [load]);

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
                      <td>{o.slug}</td>
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
              <h2 className={styles.sectionTitle}>Usage by org (30 days)</h2>
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
        </section>
      </div>
    </main>
  );
}
