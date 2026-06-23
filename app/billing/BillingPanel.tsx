"use client";

import { useEffect, useState } from "react";
import styles from "../admin/admin.module.css";

type Membership = {
  org_id: string;
  org_slug: string;
  org_name: string;
  role: string;
  status: string;
};

const plans: { key: string; label: string; price: string; perSeat: boolean }[] = [
  { key: "solo", label: "Solo — $20/mo", price: "$20 / month", perSeat: false },
  { key: "team-monthly", label: "Team — $20/user/mo", price: "$20 / user / month", perSeat: true },
  { key: "team-annual", label: "Team annual — $15/user/mo", price: "$15 / user / month, billed annually", perSeat: true },
];

export default function BillingPanel({ memberships }: { memberships: Membership[] }) {
  const ownerOrgs = memberships.filter((m) => m.role === "owner" || m.role === "admin");
  const [orgSlug, setOrgSlug] = useState(ownerOrgs[0]?.org_slug ?? "");
  const [plan, setPlan] = useState("solo");
  const [seats, setSeats] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status");
    if (status === "success") setNotice("Payment received. Your organization is being activated.");
    if (status === "cancelled") setNotice("Checkout cancelled. You can try again any time.");
  }, []);

  const perSeat = plans.find((p) => p.key === plan)?.perSeat ?? false;

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

  return (
    <main id="main" className={styles.shell}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Billing</h1>
          <p className={styles.meta}>Activate your organization by choosing a plan.</p>
        </div>
        <div className={styles.headerActions}>
          <a className={styles.buttonSecondary} href="/admin">admin</a>
        </div>
      </header>

      <section className={styles.panel}>
        {notice ? <p className={styles.status}>{notice}</p> : null}
        {error ? <p className={styles.notice}>{error}</p> : null}

        {ownerOrgs.length === 0 ? (
          <p className={styles.sectionLead}>You must be an org owner or admin to manage billing.</p>
        ) : (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Choose a plan</h2>

            <label className={styles.label}>Organization</label>
            <select className={styles.field} value={orgSlug} onChange={(e) => setOrgSlug(e.target.value)}>
              {ownerOrgs.map((m) => (
                <option key={m.org_id} value={m.org_slug}>{m.org_name} ({m.org_slug})</option>
              ))}
            </select>

            <label className={styles.label}>Plan</label>
            <select className={styles.field} value={plan} onChange={(e) => setPlan(e.target.value)}>
              {plans.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>

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

            <div className={styles.buttonRow}>
              <button type="button" className={styles.button} disabled={busy || !orgSlug} onClick={startCheckout}>
                {busy ? "Starting…" : "Continue to payment"}
              </button>
            </div>
            <p className={styles.sectionLead}>
              Agents stay blocked until payment completes. Need enterprise terms?{" "}
              <a className={styles.code} href="/contact">Contact us</a>.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
