"use client";

import { useEffect, useState } from "react";
import AdminConsole from "@/app/admin/AdminConsole";
import BillingPanel from "@/app/billing/BillingPanel";
import { DEMO_DOCUMENTS, DEMO_ROLES, type DemoRole } from "@/lib/prototype/demo-data";
import OverviewSection from "./sections/OverviewSection";
import ActivitySection from "./sections/ActivitySection";
import KnowledgeSection from "./sections/KnowledgeSection";
import AccessSection from "./sections/AccessSection";
import type { ConsoleSection } from "./sections/ui";
import styles from "./page.module.css";

type Membership = {
  org_id: string;
  org_slug: string;
  org_name: string;
  org_status: string;
  role: string;
  status: string;
};

const NAV: { id: ConsoleSection; label: string }[] = [
  { id: "overview", label: "overview" },
  { id: "activity", label: "activity" },
  { id: "knowledge", label: "knowledge" },
  { id: "access", label: "access" },
  { id: "connect", label: "connect" },
  { id: "billing", label: "billing" },
];

const SECTION_META: Record<ConsoleSection, { eyebrow: string; title: string; subtitle: string }> = {
  overview: { eyebrow: "overview", title: "What’s going on", subtitle: "Live health and activity across your company brain" },
  activity: { eyebrow: "activity", title: "Activity", subtitle: "Every query → context → answer, with what was denied" },
  knowledge: { eyebrow: "knowledge", title: "Knowledge", subtitle: "Documents, semantic map, and reviewable proposals" },
  access: { eyebrow: "access", title: "Access & trust zones", subtitle: "Who can read what — before anything is denied" },
  connect: { eyebrow: "connect", title: "Connect", subtitle: "API keys, hosted agents, models, and MCP setup" },
  billing: { eyebrow: "billing", title: "Billing & support", subtitle: "Plan, usage, invoices, account, and help" },
};

// Map the legacy ?view= values (and any inbound links from AdminConsole /
// BillingPanel) onto the new six-section IA so old deep links keep working.
function sectionFromView(view: string | null | undefined): ConsoleSection | null {
  if (!view) return null;
  const map: Record<string, ConsoleSection> = {
    documents: "knowledge",
    map: "knowledge",
    write: "knowledge",
    vault: "knowledge",
    audit: "activity",
    agents: "connect",
    overview: "overview",
    activity: "activity",
    knowledge: "knowledge",
    access: "access",
    connect: "connect",
    billing: "billing",
  };
  return map[view] ?? null;
}

export default function PrototypeConsole({
  userEmail,
  memberships,
  initialView,
}: {
  userEmail?: string;
  memberships: Membership[];
  initialView?: string;
}) {
  const [section, setSection] = useState<ConsoleSection>(sectionFromView(initialView) ?? "overview");
  const [actingAs, setActingAs] = useState<DemoRole["slug"]>("reader");
  const [query, setQuery] = useState("");
  const [selectedEventId, setSelectedEventId] = useState("e1");
  const [activityFilter, setActivityFilter] = useState("all");
  const [selectedDocSlug, setSelectedDocSlug] = useState("customer-refunds");

  const role = DEMO_ROLES.find((r) => r.slug === actingAs) ?? DEMO_ROLES[0]!;

  useEffect(() => {
    const view = new URL(window.location.href).searchParams.get("view");
    const mapped = sectionFromView(view);
    if (mapped) setSection(mapped);
  }, []);

  const visibleDocCount = DEMO_DOCUMENTS.filter((d) => role.allowedLabels.includes(d.sensitivity)).length;

  const counts: Record<ConsoleSection, string> = {
    overview: "live",
    activity: "live",
    knowledge: `${visibleDocCount} docs`,
    access: `${DEMO_ROLES.length} roles`,
    connect: "keys",
    billing: "status",
  };

  const meta = SECTION_META[section];
  const activeOrg = memberships.find((m) => m.status === "active") ?? memberships[0];
  const orgName = activeOrg?.org_name ?? "your org";
  const orgSlug = activeOrg?.org_slug ?? "";

  const showRole = section === "knowledge" || section === "access";
  const showSearch = section === "knowledge";
  const showControls = showRole || showSearch;

  async function logout() {
    await fetch("/api/v1/auth/logout", { method: "POST" }).catch(() => null);
    window.location.href = "/login";
  }

  function goEvent(id: string) {
    setSelectedEventId(id);
    setActivityFilter("all");
    setSection("activity");
  }
  function inspectDenied() {
    setActivityFilter("denied");
    setSection("activity");
  }

  return (
    <main id="main" className={styles.console}>
      <aside className={styles.sidebar} aria-label="Console navigation">
        <div className={styles.brand}>
          <div className={styles.brandRow}>
            <span className={styles.brandMark}>◆ Frege</span>
            <span className={styles.cursor} aria-hidden="true">_</span>
          </div>
          <div className={styles.brandEyebrow}>// control plane</div>
        </div>

        <nav className={styles.nav} aria-label="Console sections">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`${styles.navBtn} ${section === item.id ? styles.navActive : ""}`}
              onClick={() => setSection(item.id)}
            >
              <span>{item.label}</span>
              <small>{counts[item.id]}</small>
            </button>
          ))}
        </nav>

        <div className={styles.sidebarFoot}>
          <span className={styles.footOrg}>{orgName}</span>
          {userEmail ? <span className={styles.footEmail}>{userEmail}</span> : null}
          <span className={styles.footRole}>{role.name.toLowerCase()} · viewing</span>
          <button type="button" className={styles.logout} onClick={logout}>
            logout →
          </button>
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.pageTitle}>
            <div className={styles.eyebrow}>
              <span className={styles.eyebrowSlash}>// </span>
              {meta.eyebrow}
            </div>
            <h1>{meta.title}</h1>
            <p>{meta.subtitle}</p>
          </div>
          <div className={styles.headerControls}>
            <span className={styles.opStatus}>
              <span className={styles.opDot} aria-hidden="true">●</span>operational
            </span>
            {showControls ? (
              <div className={styles.controls}>
                {showRole ? (
                  <label className={styles.field}>
                    <span>viewing as</span>
                    <select value={actingAs} onChange={(e) => setActingAs(e.target.value as DemoRole["slug"])}>
                      {DEMO_ROLES.map((r) => (
                        <option key={r.slug} value={r.slug}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {showSearch ? (
                  <label className={styles.field}>
                    <span>search</span>
                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="refund, incident, sales…" />
                  </label>
                ) : null}
              </div>
            ) : null}
          </div>
        </header>

        <div className={`${styles.scroll} frgscroll`}>
          {section === "overview" ? (
            <OverviewSection orgSlug={orgSlug} onNavigate={setSection} onOpenEvent={goEvent} onInspectDenied={inspectDenied} />
          ) : null}
          {section === "activity" ? (
            <ActivitySection
              orgSlug={orgSlug}
              selectedId={selectedEventId}
              onSelect={setSelectedEventId}
              filter={activityFilter}
              onFilter={setActivityFilter}
            />
          ) : null}
          {section === "knowledge" ? (
            <KnowledgeSection roleSlug={actingAs} query={query} selectedSlug={selectedDocSlug} onSelectSlug={setSelectedDocSlug} />
          ) : null}
          {section === "access" ? <AccessSection roleSlug={actingAs} actingAsName={role.name} /> : null}
          {section === "connect" ? (
            <div className={styles.embed}>
              <AdminConsole embedded />
            </div>
          ) : null}
          {section === "billing" ? (
            <div className={styles.embed}>
              <BillingPanel memberships={memberships} embedded />
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
