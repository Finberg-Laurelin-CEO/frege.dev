"use client";

import { FormEvent, Fragment, useEffect, useMemo, useState } from "react";
import styles from "./admin.module.css";

type Tab = "setup" | "overview" | "keys" | "context" | "brain" | "telemetry" | "audit";

const adminTabs: { id: Tab; label: string }[] = [
  { id: "setup", label: "setup docs" },
  { id: "overview", label: "orgs & roles" },
  { id: "keys", label: "api keys" },
  { id: "brain", label: "brain" },
  { id: "context", label: "context" },
  { id: "telemetry", label: "telemetry" },
  { id: "audit", label: "audit" },
];

type Membership = {
  org_id: string;
  org_slug: string;
  org_name: string;
  org_status: string;
  role: string;
  status: string;
};

type Session = {
  user: {
    email: string;
    name: string;
    email_verified_at: string | null;
  };
  memberships: Membership[];
};

type Role = {
  id: string;
  slug: string;
  name: string;
  can_read_labels: string[];
  can_read_sessions?: boolean;
  can_write_sessions?: boolean;
  can_propose_memory?: boolean;
  can_review_memory_proposals?: boolean;
  can_manage_sources?: boolean;
};

type ApiKeyRow = {
  id: string;
  name: string;
  key_prefix: string;
  status: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  role_slug: string;
  owner_user_id: string | null;
  owner_user_email: string | null;
};

type MemberRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
};

type InviteRow = {
  id: string;
  email: string;
  role: string;
  status: string;
  expires_at: string;
};

type TelemetrySummary = {
  total_events?: number;
  denied_events?: number;
  context_builds?: number;
  input_tokens?: number;
  output_tokens?: number;
  estimated_cost_usd?: number;
  avg_latency_ms?: number;
};

type BrainSourceRow = {
  id: string;
  slug: string;
  name: string;
  kind: string;
  status: string;
  trust_zone: string;
  updated_at: string;
};

type BrainPageRow = {
  id: string;
  slug: string;
  title: string;
  artifact_type?: string;
  source_slug: string | null;
  status: string;
  trust_zone: string;
  revision_number: number;
  summary: string;
  updated_at: string;
};

type BrainSessionRow = {
  id: string;
  external_id: string | null;
  client: string;
  title: string;
  status: string;
  trust_zone: string;
  owner_user_email: string | null;
  actor_key_prefix: string | null;
  event_count: number;
  started_at: string;
  last_event_at: string | null;
};

type MemoryProposalRow = {
  id: string;
  proposal_type: string;
  slug: string | null;
  title: string;
  summary: string;
  trust_zone: string;
  status: string;
  session_id: string | null;
  created_at: string;
  body_md?: string;
  citations?: unknown[];
  confidence?: string | number | null;
  metadata?: Record<string, unknown>;
};

type ApprovedSkillRow = {
  slug: string;
  title: string;
  valid_from: string | null;
  stale: boolean;
  stale_reason?: string | null;
};

type UploadedMaterialRow = {
  id: string;
  source_type: "markdown_upload";
  created_at: string;
  source_description: string;
  author: string;
  date: string;
};

type CompileSummary =
  | { result: "compiling" }
  | { result: "proposal_filed"; proposal_id: string }
  | { result: "nothing_found" | "failed"; reason: string };

const apiKeyExpirationChoices = [
  { value: "30d", label: "30 days", description: "short trial or contractor access" },
  { value: "90d", label: "90 days", description: "default rotation window" },
  { value: "180d", label: "180 days", description: "long-running local agent" },
  { value: "1y", label: "1 year", description: "annual service rotation" },
  { value: "none", label: "no expiration", description: "requires manual revocation" },
  { value: "custom", label: "custom", description: "choose an exact date and time" },
];

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function addDays(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function apiKeyStatus(key: ApiKeyRow): "active" | "revoked" | "expired" | "other" {
  if (key.status === "revoked") return "revoked";
  if (key.expires_at && new Date(key.expires_at).getTime() <= Date.now()) return "expired";
  if (key.status === "active") return "active";
  return "other";
}

function statusBadgeClass(status: ReturnType<typeof apiKeyStatus>): string {
  if (status === "active") return styles.badgeOk;
  if (status === "expired") return styles.badgeWarn;
  if (status === "revoked") return styles.badgeDanger;
  return styles.badgeMuted;
}

async function readJson(response: Response) {
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error ?? `http_${response.status}`);
  return json;
}

export default function AdminConsole({ embedded = false }: { embedded?: boolean } = {}) {
  const [session, setSession] = useState<Session | null>(null);
  const [selectedOrgSlug, setSelectedOrgSlug] = useState("");
  const [tab, setTab] = useState<Tab>("setup");
  const [status, setStatus] = useState("loading");
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [lastInviteLink, setLastInviteLink] = useState("");
  const [roles, setRoles] = useState<Role[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyRow[]>([]);
  const [rawKey, setRawKey] = useState("");
  const [apiKeyRoleSlug, setApiKeyRoleSlug] = useState("");
  const [apiKeyOwnerId, setApiKeyOwnerId] = useState("");
  const [apiKeyExpiration, setApiKeyExpiration] = useState("90d");
  const [browserOrigin, setBrowserOrigin] = useState("");
  const [telemetrySummary, setTelemetrySummary] = useState<TelemetrySummary>({});
  const [telemetryEvents, setTelemetryEvents] = useState<Record<string, unknown>[]>([]);
  const [auditEvents, setAuditEvents] = useState<Record<string, unknown>[]>([]);
  const [brainSources, setBrainSources] = useState<BrainSourceRow[]>([]);
  const [brainPages, setBrainPages] = useState<BrainPageRow[]>([]);
  const [brainSessions, setBrainSessions] = useState<BrainSessionRow[]>([]);
  const [memoryProposals, setMemoryProposals] = useState<MemoryProposalRow[]>([]);
  const [skillsEnabled, setSkillsEnabled] = useState<boolean | null>(null);
  const [approvedSkills, setApprovedSkills] = useState<ApprovedSkillRow[]>([]);
  const [uploadedMaterials, setUploadedMaterials] = useState<UploadedMaterialRow[]>([]);
  const [compileResults, setCompileResults] = useState<Record<string, CompileSummary>>({});
  const [proposalEdits, setProposalEdits] = useState<Record<string, string>>({});
  const [contextOutput, setContextOutput] = useState("");

  const selectedOrg = useMemo(
    () => session?.memberships.find((membership) => membership.org_slug === selectedOrgSlug) ?? null,
    [selectedOrgSlug, session],
  );
  const emailVerified = Boolean(session?.user.email_verified_at);
  const orgActive = selectedOrg?.org_status === "active";
  const orgWriteLocked = Boolean(selectedOrg && !orgActive);
  const apiKeyLocked = orgWriteLocked || !emailVerified;
  const selectedApiKeyRole = useMemo(
    () => roles.find((role) => role.slug === apiKeyRoleSlug) ?? roles[0] ?? null,
    [apiKeyRoleSlug, roles],
  );
  const selectedApiKeyOwner = useMemo(
    () => members.find((member) => member.id === apiKeyOwnerId) ?? members[0] ?? null,
    [apiKeyOwnerId, members],
  );
  const apiBaseUrl = browserOrigin || "https://frege.dev";
  const rawBearerHeader = rawKey ? `Authorization: Bearer ${rawKey}` : "";
  const statusCurl = rawKey
    ? `curl -s ${apiBaseUrl}/api/v1/brain/status \\\n  -H "Authorization: Bearer ${rawKey}"`
    : "";
  const contextCurl = rawKey
    ? `curl -s ${apiBaseUrl}/api/v1/context/build \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${rawKey}" \\\n  -d '{"query":"refund policy","limit":3}'`
    : "";

  async function refreshAdminData(orgSlug = selectedOrgSlug) {
    if (!orgSlug) return;
    setStatus("refreshing");
    try {
      const query = `org_slug=${encodeURIComponent(orgSlug)}`;
      const [memberJson, roleJson, keyJson, telemetryJson, auditJson, brainJson, skillsResponse] =
        await Promise.all([
        fetch(`/api/v1/admin/members?${query}`).then(readJson),
        fetch(`/api/v1/admin/roles?${query}`).then(readJson),
        fetch(`/api/v1/admin/api-keys?${query}`).then(readJson),
        fetch(`/api/v1/admin/telemetry?${query}`).then(readJson),
        fetch(`/api/v1/admin/audit-events?${query}`).then(readJson),
        fetch(`/api/v1/admin/brain?${query}`).then(readJson),
        fetch(`/api/v1/skills?${query}`),
      ]);

      setMembers(memberJson.members ?? []);
      setInvites(memberJson.invites ?? []);
      setRoles(roleJson.roles ?? []);
      setApiKeys(keyJson.api_keys ?? []);
      setTelemetrySummary(telemetryJson.summary ?? {});
      setTelemetryEvents(telemetryJson.events ?? []);
      setAuditEvents(auditJson.events ?? []);
      setBrainSources(brainJson.sources ?? []);
      setBrainPages(brainJson.pages ?? []);
      setBrainSessions(brainJson.sessions ?? []);
      setMemoryProposals(brainJson.proposals ?? []);
      if (skillsResponse.status === 404) {
        setSkillsEnabled(false);
        setApprovedSkills([]);
      } else {
        const skillsJson = await readJson(skillsResponse);
        setSkillsEnabled(true);
        setApprovedSkills(skillsJson.skills ?? []);
      }
      setStatus("ready");
    } catch (error) {
      setStatus((error as Error).message);
    }
  }

  useEffect(() => {
    setBrowserOrigin(window.location.origin);
    fetch("/api/v1/auth/me")
      .then(async (response) => {
        if (response.status === 401) {
          setStatus("not_authenticated");
          return null;
        }
        return readJson(response);
      })
      .then((json) => {
        if (!json) return;
        setSession(json);
        const firstOrg = json.memberships?.find((membership: Membership) => membership.status === "active");
        if (firstOrg) setSelectedOrgSlug(firstOrg.org_slug);
      })
      .catch((error) => setStatus((error as Error).message));
  }, []);

  useEffect(() => {
    if (selectedOrgSlug) {
      setSkillsEnabled(null);
      setUploadedMaterials([]);
      setCompileResults({});
      setProposalEdits({});
      void refreshAdminData(selectedOrgSlug);
    }
  }, [selectedOrgSlug]);

  useEffect(() => {
    if (roles.length > 0 && !roles.some((role) => role.slug === apiKeyRoleSlug)) {
      setApiKeyRoleSlug(roles[0].slug);
    }
  }, [apiKeyRoleSlug, roles]);

  useEffect(() => {
    if (members.length > 0 && !members.some((member) => member.id === apiKeyOwnerId)) {
      setApiKeyOwnerId(members[0].id);
    }
  }, [apiKeyOwnerId, members]);

  async function createOrg(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setStatus("creating org");
    try {
      await fetch("/api/v1/admin/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          slug: form.get("slug"),
        }),
      }).then(readJson);
      window.location.reload();
    } catch (error) {
      setStatus((error as Error).message);
    }
  }

  async function inviteMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setStatus("inviting");
    try {
      const json = await fetch("/api/v1/admin/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          org_slug: selectedOrgSlug,
          email: form.get("email"),
          role: form.get("role"),
        }),
      }).then(readJson);
      // Use the server-built link (customer site), never window.location (admin host).
      const inviteLink = json.invite_link as string;
      setLastInviteLink(inviteLink);
      setContextOutput(
        json.email_sent
          ? `Invite emailed to ${json.invite?.email ?? "member"}.\ninvite_link:\n${inviteLink}`
          : `Email not sent (provider not configured). Share manually:\ninvite_link:\n${inviteLink}`,
      );
      await refreshAdminData();
    } catch (error) {
      setStatus((error as Error).message);
    }
  }

  async function upsertRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setStatus("saving role");
    try {
      await fetch("/api/v1/admin/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          org_slug: selectedOrgSlug,
          slug: form.get("slug"),
          name: form.get("name"),
          can_read_labels: form.getAll("can_read_labels"),
          can_create_docs: form.get("can_create_docs") === "on",
          can_update_docs: form.get("can_update_docs") === "on",
          can_read_audit: form.get("can_read_audit") === "on",
          can_read_sessions: form.get("can_read_sessions") === "on",
          can_write_sessions: form.get("can_write_sessions") === "on",
          can_propose_memory: form.get("can_propose_memory") === "on",
          can_review_memory_proposals: form.get("can_review_memory_proposals") === "on",
          can_manage_sources: form.get("can_manage_sources") === "on",
        }),
      }).then(readJson);
      await refreshAdminData();
    } catch (error) {
      setStatus((error as Error).message);
    }
  }

  async function createApiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(event.currentTarget);
    const expirationMode = String(form.get("expiration") ?? "90d");
    const customExpiresAtValue = String(form.get("custom_expires_at") ?? "").trim();
    const expiresAt =
      expirationMode === "none"
        ? null
        : expirationMode === "custom"
          ? customExpiresAtValue
            ? new Date(customExpiresAtValue)
            : null
          : expirationMode === "30d"
            ? addDays(30)
            : expirationMode === "180d"
              ? addDays(180)
              : expirationMode === "1y"
                ? addDays(365)
                : addDays(90);
    if (expirationMode === "custom" && !customExpiresAtValue) {
      setStatus("custom expiration required");
      return;
    }
    if (expiresAt && !Number.isFinite(expiresAt.getTime())) {
      setStatus("invalid expiration");
      return;
    }

    setStatus("creating key");
    try {
      const json = await fetch("/api/v1/admin/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          org_slug: selectedOrgSlug,
          name: form.get("name"),
          role_slug: apiKeyRoleSlug || form.get("role_slug"),
          owner_user_id: apiKeyOwnerId || form.get("owner_user_id") || undefined,
          expires_at: expiresAt ? expiresAt.toISOString() : undefined,
        }),
      }).then(readJson);
      const nextRawKey = json.raw_key ?? "";
      setRawKey(nextRawKey);
      setTab("keys");
      formElement.reset();
      setApiKeyExpiration("90d");
      await refreshAdminData();
    } catch (error) {
      setStatus((error as Error).message);
    }
  }

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setStatus(`${label} copied`);
    } catch {
      setStatus(`could not copy ${label}`);
    }
  }

  async function revokeApiKey(id: string) {
    setStatus("revoking key");
    try {
      await fetch(`/api/v1/admin/api-keys/${id}?org_slug=${encodeURIComponent(selectedOrgSlug)}`, {
        method: "PATCH",
      }).then(readJson);
      await refreshAdminData();
    } catch (error) {
      setStatus((error as Error).message);
    }
  }

  async function uploadMaterial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const provenance = {
      source_description: String(form.get("source_description") ?? ""),
      author: String(form.get("author") ?? ""),
      date: String(form.get("date") ?? ""),
    };
    setStatus("uploading material");
    try {
      const json = await fetch(`/api/v1/materials?org_slug=${encodeURIComponent(selectedOrgSlug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_type: "markdown_upload",
          content_md: form.get("content_md"),
          provenance,
        }),
      }).then(readJson);
      setUploadedMaterials((materials) => [
        { ...json.material, ...provenance },
        ...materials.filter((material) => material.id !== json.material.id),
      ]);
      formElement.reset();
      setStatus("material uploaded");
    } catch (error) {
      setStatus((error as Error).message);
    }
  }

  async function compileSource(key: string, body: { material_id: string } | { session_id: string }) {
    setCompileResults((results) => ({ ...results, [key]: { result: "compiling" } }));
    setStatus("compiling");
    try {
      const json = (await fetch(`/api/v1/skills/compile?org_slug=${encodeURIComponent(selectedOrgSlug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(readJson)) as CompileSummary;
      setCompileResults((results) => ({ ...results, [key]: json }));
      if (json.result === "proposal_filed") await refreshAdminData();
      setStatus(json.result);
    } catch (error) {
      const failed: CompileSummary = { result: "failed", reason: (error as Error).message };
      setCompileResults((results) => ({ ...results, [key]: failed }));
      setStatus("failed");
    }
  }

  async function exportSkill(slug: string) {
    setStatus(`exporting ${slug}`);
    try {
      const response = await fetch(
        `/api/v1/skills/${encodeURIComponent(slug)}?format=skillmd&org_slug=${encodeURIComponent(selectedOrgSlug)}`,
      );
      if (!response.ok) {
        const json = await response.json().catch(() => ({}));
        throw new Error(json.error ?? `http_${response.status}`);
      }
      const url = URL.createObjectURL(new Blob([await response.text()], { type: "text/markdown" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${slug}.md`;
      link.click();
      URL.revokeObjectURL(url);
      setStatus(`${slug} exported`);
    } catch (error) {
      setStatus((error as Error).message);
    }
  }

  function renderCompileResult(key: string) {
    const summary = compileResults[key];
    if (!summary) return null;
    if (summary.result === "proposal_filed") {
      return (
        <span className={styles.compileResult} aria-live="polite">
          <code>proposal_filed</code>
          <a className="lnk" href={`#proposal-${summary.proposal_id}`}>{summary.proposal_id}</a>
        </span>
      );
    }
    return (
      <span className={styles.compileResult} aria-live="polite">
        <code>{summary.result}</code>
        {summary.result !== "compiling" && <span>{summary.reason}</span>}
      </span>
    );
  }

  async function resolveMemoryProposal(id: string, action: "accept" | "reject", bodyMd?: string) {
    const reason = action === "reject" ? window.prompt("Why is this skill proposal being rejected?")?.trim() : undefined;
    if (action === "reject" && !reason) {
      setStatus("rejection reason required");
      return;
    }
    setStatus(`${action}ing proposal`);
    try {
      await fetch(`/api/v1/admin/brain/proposals/${id}?org_slug=${encodeURIComponent(selectedOrgSlug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, body_md: bodyMd, reason }),
      }).then(readJson);
      setProposalEdits((edits) => {
        const next = { ...edits };
        delete next[id];
        return next;
      });
      await refreshAdminData();
    } catch (error) {
      setStatus((error as Error).message);
    }
  }

  async function proposeSkillRollback(page: BrainPageRow) {
    const revision = Number(window.prompt(`Rollback ${page.slug} from revision ${page.revision_number} to which earlier revision?`, String(Math.max(1, page.revision_number - 1))));
    if (!Number.isInteger(revision) || revision < 1 || revision >= page.revision_number) {
      setStatus("choose an earlier revision number");
      return;
    }
    setStatus("filing rollback proposal");
    try {
      await fetch(`/api/v1/skills/${encodeURIComponent(page.slug)}/rollback?org_slug=${encodeURIComponent(selectedOrgSlug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision_number: revision }),
      }).then(readJson);
      await refreshAdminData();
      setStatus("rollback proposal filed — review and accept it below");
    } catch (error) {
      setStatus((error as Error).message);
    }
  }

  async function buildContext(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setStatus("building context");
    try {
      const json = await fetch("/api/v1/context/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          org_slug: selectedOrgSlug,
          query: form.get("query"),
          slug: form.get("slug") || undefined,
          limit: Number(form.get("limit") ?? 8),
        }),
      }).then(readJson);
      setContextOutput(JSON.stringify(json.context, null, 2));
      await refreshAdminData();
    } catch (error) {
      setStatus((error as Error).message);
    }
  }

  async function logout() {
    await fetch("/api/v1/auth/logout", { method: "POST" }).catch(() => null);
    window.location.href = "/login";
  }

  if (status === "not_authenticated") {
    const ShellTag = embedded ? "section" : "main";
    return (
      <ShellTag id={embedded ? undefined : "main"} className={`${styles.shell} ${embedded ? styles.embeddedShell : ""}`}>
        {!embedded && (
          <div className={styles.header}>
            <div>
              <h1 className={styles.title}>Frege control plane</h1>
              <p className={styles.meta}>not authenticated</p>
            </div>
            <a className="lnk" href="/login?next=/console?view=agents">login</a>
          </div>
        )}
      </ShellTag>
    );
  }

  const ShellTag = embedded ? "section" : "main";

  return (
    <ShellTag id={embedded ? undefined : "main"} className={`${styles.shell} ${embedded ? styles.embeddedShell : ""}`}>
      {!embedded && (
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Frege control plane</h1>
            <p className={styles.meta}>
              {session ? `${session.user.email} / ${selectedOrg?.org_name ?? "no org"}` : "loading"}
            </p>
          </div>
          <div className={styles.headerActions}>
            <a className={`${styles.button} ${styles.buttonSecondary}`} href="/docs">docs</a>
            <a className={`${styles.button} ${styles.buttonSecondary}`} href="/console">console</a>
            <button className={`${styles.button} ${styles.buttonSecondary}`} type="button" onClick={logout}>
              logout
            </button>
          </div>
        </div>
      )}

      <div className={styles.grid}>
        <aside className={styles.nav}>
          <label className={styles.field}>
            <span className={styles.label}>org</span>
            <select
              className={styles.select}
              value={selectedOrgSlug}
              onChange={(event) => setSelectedOrgSlug(event.target.value)}
            >
              {session?.memberships.map((membership) => (
                <option key={membership.org_id} value={membership.org_slug}>
                  {membership.org_slug}
                </option>
              ))}
            </select>
          </label>
          {adminTabs.map((item) => (
            <button
              key={item.id}
              className={`${styles.tab} ${tab === item.id ? styles.tabActive : ""}`}
              type="button"
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
          <span className={styles.status}>{status}</span>
        </aside>

        <section className={styles.panel}>
          {(orgWriteLocked || !emailVerified) && (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <span className={styles.kicker}>Limited account</span>
                  <h2 className={styles.sectionTitle}>Actions are locked</h2>
                  <p className={styles.sectionLead}>
                    {!emailVerified
                      ? "Verify your email before creating API keys or starting billing."
                      : "Billing must activate this organization before keys, invites, roles, and memory writes are available."}
                  </p>
                </div>
                <span className={`${styles.badge} ${styles.badgeWarn}`}>
                  {!emailVerified ? "email pending" : selectedOrg?.org_status ?? "inactive"}
                </span>
              </div>
            </div>
          )}

          {tab === "setup" && (
            <>
              <div className={`${styles.section} ${styles.setupHero}`}>
                <div>
                  <span className={styles.kicker}>Setup</span>
                  <h2 className={styles.heroTitle}>Connect this org to agent memory.</h2>
                  <p className={styles.sectionLead}>
                    Create the org shape, issue a scoped API key, then let the agent install Frege MCP from npm.
                    Agents pull governed context and write reviewable memory proposals; they do not get direct database access.
                  </p>
                </div>
                <div className={styles.inlineActions}>
                  <button className={styles.button} type="button" onClick={() => setTab("overview")}>manage org</button>
                  <button className={styles.button} type="button" onClick={() => setTab("keys")}>create api key</button>
                  <a className={`${styles.button} ${styles.buttonSecondary}`} href="/docs">open docs</a>
                </div>
              </div>

              <div className={styles.setupGrid}>
                <section className={styles.setupPanel}>
                  <span className={styles.kicker}>1. Org</span>
                  <h3>Set up members and roles</h3>
                  <p>
                    Create or choose an org, invite users, then define what each agent role can read and write.
                    Role permissions drive trust-zone access, session visibility, proposals, and source management.
                  </p>
                  <button className={`${styles.button} ${styles.buttonSecondary}`} type="button" onClick={() => setTab("overview")}>
                    orgs and roles
                  </button>
                </section>

                <section className={styles.setupPanel}>
                  <span className={styles.kicker}>2. Keys</span>
                  <h3>Generate per-user API keys</h3>
                  <p>
                    Keys belong to this org and a human owner. Frege derives org, user, role, and telemetry identity
                    from a valid key, so agents never provide trusted identity in requests.
                  </p>
                  <button className={`${styles.button} ${styles.buttonSecondary}`} type="button" onClick={() => setTab("keys")}>
                    api keys
                  </button>
                </section>

                <section className={styles.setupPanel}>
                  <span className={styles.kicker}>3. MCP</span>
                  <h3>Install on the agent machine</h3>
                  <p>
                    The user or agent installs the CLI with npm, connects the key once, then registers
                    `frege mcp serve` with Claude, Codex, Hermes, or another MCP-aware client.
                  </p>
                  <a className={`${styles.button} ${styles.buttonSecondary}`} href="/docs#agent-install">
                    agent install prompt
                  </a>
                </section>
              </div>

              <div className={styles.section}>
                <h2 className={styles.sectionTitle}>agent install commands</h2>
                <pre className={styles.codeBlock}>{`npm install -g @frege-dev/cli

# zsh PATH fallback if frege is not found:
echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

frege connect https://frege.dev --token <valid-frg-live-key>
frege doctor

frege docs sync frege.docs.yml --dry-run
frege docs sync frege.docs.yml

claude mcp add frege -- frege mcp serve
codex mcp add frege -- frege mcp serve`}</pre>
                <p className={styles.meta}>
                  Use a valid, unrevoked API key from an active org in the keys tab. Browser app traffic
                  may use brain.frege.dev, but MCP should use the canonical API base https://frege.dev
                  unless support gives a different API base. If `frege connect` or `frege doctor` fails,
                  MCP setup is not complete.
                </p>
              </div>

              <div className={styles.section}>
                <h2 className={styles.sectionTitle}>agent operating instructions</h2>
                <pre className={styles.codeBlock}>{`Use Frege MCP tools for organization memory.
Start a Frege session for substantial workflows.
Build context before answering from Frege knowledge.
If Frege reports denied context, do not guess what was denied.
Submit memory proposals instead of rewriting canonical knowledge directly.
Keep model credentials, tools, and execution in the user's agent client.`}</pre>
              </div>

              <div className={styles.section}>
                <h2 className={styles.sectionTitle}>documentation database</h2>
                <p className={styles.sectionLead}>
                  The public docs page explains setup, org management, MCP installation, and the agent contract.
                  The brain tab shows hosted sources, pages, sessions, and memory proposals for this org.
                </p>
                <div className={styles.inlineActions}>
                  <a className={styles.button} href="/docs">read docs</a>
                  <button className={`${styles.button} ${styles.buttonSecondary}`} type="button" onClick={() => setTab("brain")}>
                    review brain
                  </button>
                </div>
              </div>
            </>
          )}

          {tab === "overview" && (
            <>
              <div className={styles.section}>
                <h2 className={styles.sectionTitle}>orgs</h2>
                <form className={styles.form} onSubmit={createOrg}>
                  <label className={styles.field}>
                    <span className={styles.label}>name</span>
                    <input className={styles.input} name="name" />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.label}>slug</span>
                    <input className={styles.input} name="slug" />
                  </label>
                  <div className={styles.buttonRow}>
                    <button className={styles.button} type="submit" disabled={!emailVerified || orgWriteLocked}>create org</button>
                  </div>
                </form>
              </div>

              <div className={styles.section}>
                <h2 className={styles.sectionTitle}>members</h2>
                <form className={styles.form} onSubmit={inviteMember}>
                  <label className={styles.field}>
                    <span className={styles.label}>email</span>
                    <input className={styles.input} name="email" type="email" />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.label}>role</span>
                    <select className={styles.select} name="role" defaultValue="member">
                      <option value="owner">owner</option>
                      <option value="admin">admin</option>
                      <option value="member">member</option>
                      <option value="viewer">viewer</option>
                    </select>
                  </label>
                  <div className={styles.buttonRow}>
                    <button className={styles.button} type="submit" disabled={orgWriteLocked}>invite</button>
                  </div>
                </form>
                {lastInviteLink && (
                  <div className={styles.codeBlock}>
                    <b>invite link</b>{"\n"}{lastInviteLink}
                  </div>
                )}
                <table className={styles.table}>
                  <thead>
                    <tr><th>email</th><th>name</th><th>role</th><th>status</th></tr>
                  </thead>
                  <tbody>
                    {members.map((member) => (
                      <tr key={member.id}><td>{member.email}</td><td>{member.name}</td><td>{member.role}</td><td>{member.status}</td></tr>
                    ))}
                  </tbody>
                </table>
                {invites.length > 0 && (
                  <table className={styles.table}>
                    <thead>
                      <tr><th>pending invite</th><th>role</th><th>status</th><th>expires</th></tr>
                    </thead>
                    <tbody>
                      {invites.map((invite) => (
                        <tr key={invite.id}><td>{invite.email}</td><td>{invite.role}</td><td>{invite.status}</td><td>{formatDate(invite.expires_at)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className={styles.section}>
                <h2 className={styles.sectionTitle}>roles</h2>
                <form className={styles.form} onSubmit={upsertRole}>
                  <label className={styles.field}>
                    <span className={styles.label}>slug</span>
                    <input className={styles.input} name="slug" defaultValue="agent-local" />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.label}>name</span>
                    <input className={styles.input} name="name" defaultValue="Local Agent" />
                  </label>
                  <label className={styles.checkbox}><input type="checkbox" name="can_read_labels" value="public" defaultChecked /> public</label>
                  <label className={styles.checkbox}><input type="checkbox" name="can_read_labels" value="internal" defaultChecked /> internal</label>
                  <label className={styles.checkbox}><input type="checkbox" name="can_read_labels" value="restricted" /> restricted</label>
                  <label className={styles.checkbox}><input type="checkbox" name="can_create_docs" /> create docs</label>
                  <label className={styles.checkbox}><input type="checkbox" name="can_update_docs" /> update docs</label>
                  <label className={styles.checkbox}><input type="checkbox" name="can_read_audit" /> read audit</label>
                  <label className={styles.checkbox}><input type="checkbox" name="can_write_sessions" defaultChecked /> write sessions</label>
                  <label className={styles.checkbox}><input type="checkbox" name="can_read_sessions" /> read sessions</label>
                  <label className={styles.checkbox}><input type="checkbox" name="can_propose_memory" /> propose memory</label>
                  <label className={styles.checkbox}><input type="checkbox" name="can_review_memory_proposals" /> review memory</label>
                  <label className={styles.checkbox}><input type="checkbox" name="can_manage_sources" /> manage sources</label>
                  <div className={styles.buttonRow}>
                    <button className={styles.button} type="submit" disabled={orgWriteLocked}>save role</button>
                  </div>
                </form>
                <table className={styles.table}>
                  <thead>
                    <tr><th>slug</th><th>name</th><th>labels</th><th>brain</th></tr>
                  </thead>
                  <tbody>
                    {roles.map((role) => (
                      <tr key={role.id}>
                        <td>{role.slug}</td>
                        <td>{role.name}</td>
                        <td>{role.can_read_labels.join(", ")}</td>
                        <td>
                          {[
                            role.can_write_sessions ? "write sessions" : "",
                            role.can_read_sessions ? "read sessions" : "",
                            role.can_propose_memory ? "propose" : "",
                            role.can_review_memory_proposals ? "review" : "",
                            role.can_manage_sources ? "sources" : "",
                          ].filter(Boolean).join(", ") || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className={styles.section}>
                <h2 className={styles.sectionTitle}>docs</h2>
                <p className={styles.meta}>
                  <a className="lnk" href="/docs">setup docs</a>
                  {", "}
                  <a className="lnk" href="/console">knowledge console</a>
                  {", and MCP tools are the supported path for agent-side access."}
                </p>
              </div>
            </>
          )}

          {tab === "keys" && (
            <>
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div>
                    <span className={styles.kicker}>Org-scoped access</span>
                    <h2 className={styles.sectionTitle}>api keys</h2>
                    <p className={styles.sectionLead}>
                      Issue keys for agents and service clients. Each key is bound to this org, a human owner,
                      and a role; the raw secret is only shown immediately after creation.
                    </p>
                  </div>
                  <div className={styles.keyStats}>
                    <span><b>{apiKeys.filter((key) => apiKeyStatus(key) === "active").length}</b> active</span>
                    <span><b>{apiKeys.filter((key) => apiKeyStatus(key) === "expired").length}</b> expired</span>
                    <span><b>{apiKeys.filter((key) => apiKeyStatus(key) === "revoked").length}</b> revoked</span>
                  </div>
                </div>

                <div className={styles.keyWorkflow}>
                  <form className={styles.keyForm} onSubmit={createApiKey}>
                    <div className={styles.formStep}>
                      <span className={styles.stepNumber}>1</span>
                      <div>
                        <h3>Label the client</h3>
                        <p>Use a name that explains where this secret will live.</p>
                      </div>
                    </div>
                    <label className={styles.field}>
                      <span className={styles.label}>key name</span>
                      <input className={styles.input} name="name" defaultValue="local agent" required />
                    </label>

                    <div className={styles.formStep}>
                      <span className={styles.stepNumber}>2</span>
                      <div>
                        <h3>Choose owner and role</h3>
                        <p>Telemetry and audit records use this owner and permission set.</p>
                      </div>
                    </div>
                    <div className={styles.formSplit}>
                      <label className={styles.field}>
                        <span className={styles.label}>owner</span>
                        <select
                          className={styles.select}
                          name="owner_user_id"
                          value={apiKeyOwnerId}
                          onChange={(event) => setApiKeyOwnerId(event.target.value)}
                          required
                        >
                          {members.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.email}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className={styles.field}>
                        <span className={styles.label}>role</span>
                        <select
                          className={styles.select}
                          name="role_slug"
                          value={apiKeyRoleSlug}
                          onChange={(event) => setApiKeyRoleSlug(event.target.value)}
                          required
                        >
                          {roles.map((role) => (
                            <option key={role.id} value={role.slug}>
                              {role.slug}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {selectedApiKeyRole && (
                      <div className={styles.rolePreview}>
                        <span className={styles.label}>{selectedApiKeyRole.name}</span>
                        <span>
                          reads {selectedApiKeyRole.can_read_labels.join(", ") || "no labels"}
                          {selectedApiKeyRole.can_write_sessions ? " / writes sessions" : ""}
                          {selectedApiKeyRole.can_propose_memory ? " / proposes memory" : ""}
                        </span>
                      </div>
                    )}

                    <div className={styles.formStep}>
                      <span className={styles.stepNumber}>3</span>
                      <div>
                        <h3>Set rotation window</h3>
                        <p>Short expirations reduce the blast radius of copied secrets.</p>
                      </div>
                    </div>
                    <div className={styles.expirationGrid}>
                      {apiKeyExpirationChoices.map((choice) => (
                        <label
                          key={choice.value}
                          className={`${styles.choice} ${apiKeyExpiration === choice.value ? styles.choiceActive : ""}`}
                        >
                          <input
                            type="radio"
                            name="expiration"
                            value={choice.value}
                            checked={apiKeyExpiration === choice.value}
                            onChange={(event) => setApiKeyExpiration(event.target.value)}
                          />
                          <span>{choice.label}</span>
                          <small>{choice.description}</small>
                        </label>
                      ))}
                    </div>
                    {apiKeyExpiration === "custom" && (
                      <label className={styles.field}>
                        <span className={styles.label}>custom expiration</span>
                        <input className={styles.input} name="custom_expires_at" type="datetime-local" required />
                      </label>
                    )}

                    <div className={styles.buttonRow}>
                      <button className={styles.button} type="submit" disabled={apiKeyLocked || !roles.length || !members.length}>
                        create key
                      </button>
                      <span className={styles.status}>
                        {selectedApiKeyOwner ? `owner: ${selectedApiKeyOwner.email}` : "load an active org member first"}
                      </span>
                    </div>
                  </form>

                  <aside className={styles.keyGuidance}>
                    <h3>Creation checklist</h3>
                    <p>Keys authenticate as the selected role immediately after creation.</p>
                    <ul>
                      <li>Copy the raw key before leaving this screen.</li>
                      <li>Store it in the client secret manager or local Frege config.</li>
                      <li>Revoke keys that move owners or leave a machine.</li>
                    </ul>
                    <div className={styles.warningBox}>
                      Frege stores only a hash. The raw key cannot be recovered or shown again.
                    </div>
                  </aside>
                </div>
              </div>

              {rawKey && (
                <div className={`${styles.section} ${styles.keySuccess}`}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <span className={styles.kicker}>Created</span>
                      <h2 className={styles.sectionTitle}>raw key shown once</h2>
                      <p className={styles.sectionLead}>
                        Copy this value now. After refresh or navigation, only the prefix and metadata remain visible.
                      </p>
                    </div>
                    <span className={`${styles.badge} ${styles.badgeWarn}`}>cannot be shown again</span>
                  </div>
                  <code className={styles.secretCode}>{rawKey}</code>
                  <div className={styles.buttonRow}>
                    <button className={styles.button} type="button" onClick={() => copyText(rawKey, "raw key")}>
                      copy raw key
                    </button>
                    <button
                      className={`${styles.button} ${styles.buttonSecondary}`}
                      type="button"
                      onClick={() => copyText(rawBearerHeader, "Bearer header")}
                    >
                      copy Bearer header
                    </button>
                    <button
                      className={`${styles.button} ${styles.buttonSecondary}`}
                      type="button"
                      onClick={() => copyText(statusCurl, "status curl")}
                    >
                      copy status curl
                    </button>
                    <button
                      className={`${styles.button} ${styles.buttonSecondary}`}
                      type="button"
                      onClick={() => copyText(contextCurl, "context curl")}
                    >
                      copy context curl
                    </button>
                  </div>
                  <div className={styles.exampleGrid}>
                    <div>
                      <span className={styles.label}>Bearer header</span>
                      <pre className={styles.codeBlock}>{rawBearerHeader}</pre>
                    </div>
                    <div>
                      <span className={styles.label}>/api/v1/brain/status</span>
                      <pre className={styles.codeBlock}>{statusCurl}</pre>
                    </div>
                    <div className={styles.exampleWide}>
                      <span className={styles.label}>/api/v1/context/build</span>
                      <pre className={styles.codeBlock}>{contextCurl}</pre>
                    </div>
                  </div>
                </div>
              )}

              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div>
                    <h2 className={styles.sectionTitle}>issued keys</h2>
                    <p className={styles.meta}>Only prefixes are stored here. Revoke compromised or unused keys.</p>
                  </div>
                </div>
                {apiKeys.length === 0 ? (
                  <div className={styles.empty}>
                    <strong>No API keys yet</strong>
                    <span>Create the first key to connect an agent or service client to this org.</span>
                  </div>
                ) : (
                  <div className={styles.tableScroll}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>prefix</th>
                          <th>name</th>
                          <th>owner</th>
                          <th>role</th>
                          <th>status</th>
                          <th>expires</th>
                          <th>last used</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {apiKeys.map((key) => {
                          const keyState = apiKeyStatus(key);
                          return (
                            <tr key={key.id}>
                              <td><code className={styles.inlineCode}>{key.key_prefix}</code></td>
                              <td>{key.name}</td>
                              <td>{key.owner_user_email ?? "-"}</td>
                              <td>{key.role_slug}</td>
                              <td>
                                <span className={`${styles.badge} ${statusBadgeClass(keyState)}`}>
                                  {keyState}
                                </span>
                              </td>
                              <td>{formatDate(key.expires_at)}</td>
                              <td>{formatDate(key.last_used_at)}</td>
                              <td>
                                <div className={styles.rowActions}>
                                  <button
                                    className={`${styles.button} ${styles.buttonDanger}`}
                                    type="button"
                                    disabled={keyState !== "active"}
                                    onClick={() => revokeApiKey(key.id)}
                                  >
                                    revoke
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}

          {tab === "context" && (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>build governed context</h2>
              <p className={styles.sectionLead}>
                Preview the same scoped, cited context packet that customer-run agents receive through MCP.
              </p>
              <form className={styles.form} onSubmit={buildContext}>
                <label className={styles.field}><span className={styles.label}>query</span><input className={styles.input} name="query" defaultValue="refund" /></label>
                <label className={styles.field}><span className={styles.label}>slug</span><input className={styles.input} name="slug" /></label>
                <label className={styles.field}><span className={styles.label}>limit</span><input className={styles.input} name="limit" type="number" defaultValue="8" /></label>
                <div className={styles.buttonRow}><button className={styles.button} type="submit" disabled={orgWriteLocked}>build</button></div>
              </form>
              {contextOutput && <pre className={styles.output}>{contextOutput}</pre>}
            </div>
          )}

          {tab === "brain" && (
            <>
              {skillsEnabled && (
                <div className={styles.section}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <span className={styles.kicker}>Skills compiler</span>
                      <h2 className={styles.sectionTitle}>compile markdown material</h2>
                      <p className={styles.sectionLead}>
                        Upload cited operational material, then compile it into the governed proposal queue.
                      </p>
                    </div>
                  </div>
                  <form className={styles.form} onSubmit={uploadMaterial}>
                    <label className={`${styles.field} ${styles.fieldWide}`}>
                      <span className={styles.label}>markdown content</span>
                      <textarea className={styles.textarea} name="content_md" required />
                    </label>
                    <label className={`${styles.field} ${styles.fieldWide}`}>
                      <span className={styles.label}>source description</span>
                      <input className={styles.input} name="source_description" required />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>author</span>
                      <input className={styles.input} name="author" required />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>source date</span>
                      <input className={styles.input} name="date" type="date" required />
                    </label>
                    <div className={styles.buttonRow}>
                      <button className={styles.button} type="submit" disabled={orgWriteLocked}>upload material</button>
                    </div>
                  </form>

                  {uploadedMaterials.length > 0 && (
                    <div className={styles.tableScroll}>
                      <table className={styles.table}>
                        <thead>
                          <tr><th>source</th><th>author</th><th>date</th><th>uploaded</th><th>compile</th></tr>
                        </thead>
                        <tbody>
                          {uploadedMaterials.map((material) => {
                            const resultKey = `material:${material.id}`;
                            return (
                              <tr key={material.id}>
                                <td>{material.source_description}</td>
                                <td>{material.author}</td>
                                <td>{material.date}</td>
                                <td>{formatDate(material.created_at)}</td>
                                <td>
                                  <div className={styles.rowActions}>
                                    <button
                                      className={styles.button}
                                      type="button"
                                      disabled={orgWriteLocked || compileResults[resultKey]?.result === "compiling"}
                                      onClick={() => compileSource(resultKey, { material_id: material.id })}
                                    >
                                      compile
                                    </button>
                                    {renderCompileResult(resultKey)}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {skillsEnabled && (
                <div className={styles.section}>
                  <h2 className={styles.sectionTitle}>approved skills</h2>
                  {approvedSkills.length === 0 ? (
                    <div className={styles.empty}>
                      <strong>No approved skills yet</strong>
                      <span>Accept a compiled proposal to make its SKILL.md exportable.</span>
                    </div>
                  ) : (
                    <div className={styles.tableScroll}>
                      <table className={styles.table}>
                        <thead>
                          <tr><th>slug</th><th>title</th><th>valid from</th><th>status</th><th></th></tr>
                        </thead>
                        <tbody>
                          {approvedSkills.map((skill) => (
                            <tr key={skill.slug}>
                              <td><code className={styles.inlineCode}>{skill.slug}</code></td>
                              <td>{skill.title}</td>
                              <td>{formatDate(skill.valid_from)}</td>
                              <td>
                                {skill.stale ? (
                                  <span className={styles.staleStatus}>
                                    <span className={`${styles.badge} ${styles.badgeWarn}`} title={skill.stale_reason ?? undefined}>
                                      stale — review suggested
                                    </span>
                                    {skill.stale_reason && <span className={styles.meta}>{skill.stale_reason}</span>}
                                  </span>
                                ) : (
                                  <span className={`${styles.badge} ${styles.badgeOk}`}>current</span>
                                )}
                              </td>
                              <td>
                                <button className={`${styles.button} ${styles.buttonSecondary}`} type="button" onClick={() => exportSkill(skill.slug)}>
                                  export SKILL.md
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              <div className={styles.section}>
                <h2 className={styles.sectionTitle}>brain sources</h2>
                <table className={styles.table}>
                  <thead>
                    <tr><th>slug</th><th>name</th><th>kind</th><th>trust</th><th>status</th><th>updated</th></tr>
                  </thead>
                  <tbody>
                    {brainSources.map((source) => (
                      <tr key={source.id}><td>{source.slug}</td><td>{source.name}</td><td>{source.kind}</td><td>{source.trust_zone}</td><td>{source.status}</td><td>{formatDate(source.updated_at)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className={styles.section}>
                <h2 className={styles.sectionTitle}>brain pages</h2>
                <table className={styles.table}>
                  <thead>
                    <tr><th>slug</th><th>title</th><th>source</th><th>trust</th><th>rev</th><th>summary</th>{skillsEnabled && <th></th>}</tr>
                  </thead>
                  <tbody>
                    {brainPages.map((page) => (
                      <tr key={page.id}>
                        <td>{page.slug}</td><td>{page.title}</td><td>{page.source_slug ?? "-"}</td><td>{page.trust_zone}</td><td>{page.revision_number}</td><td>{page.summary}</td>
                        {skillsEnabled && <td>{page.artifact_type === "skill" && <button className={`${styles.button} ${styles.buttonSecondary}`} type="button" disabled={orgWriteLocked || page.revision_number <= 1} onClick={() => proposeSkillRollback(page)}>rollback</button>}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className={styles.section}>
                <h2 className={styles.sectionTitle}>agent sessions</h2>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>title</th><th>client</th><th>owner</th><th>trust</th><th>events</th><th>last event</th>
                      {skillsEnabled && <th>compile</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {brainSessions.map((session) => {
                      const resultKey = `session:${session.id}`;
                      return (
                        <tr key={session.id}>
                          <td>{session.title}</td><td>{session.client}</td><td>{session.owner_user_email ?? session.actor_key_prefix ?? "-"}</td><td>{session.trust_zone}</td><td>{session.event_count}</td><td>{formatDate(session.last_event_at ?? session.started_at)}</td>
                          {skillsEnabled && (
                            <td>
                              <div className={styles.rowActions}>
                                <button
                                  className={styles.button}
                                  type="button"
                                  disabled={orgWriteLocked || compileResults[resultKey]?.result === "compiling"}
                                  onClick={() => compileSource(resultKey, { session_id: session.id })}
                                >
                                  compile
                                </button>
                                {renderCompileResult(resultKey)}
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className={styles.section}>
                <h2 className={styles.sectionTitle}>memory proposals</h2>
                <table className={styles.table}>
                  <thead>
                    <tr><th>time</th><th>type</th><th>slug</th><th>trust</th><th>status</th><th>summary</th><th></th></tr>
                  </thead>
                  <tbody>
                    {memoryProposals.map((proposal) => {
                      const isSkillProposal = proposal.proposal_type === "skill_create" || proposal.proposal_type === "skill_update";
                      const citations = proposal.citations ?? (Array.isArray(proposal.metadata?.citations) ? proposal.metadata.citations : []);
                      const confidence = proposal.confidence ?? proposal.metadata?.confidence;
                      const bodyMd = proposal.body_md ?? (typeof proposal.metadata?.body_md === "string" ? proposal.metadata.body_md : "");
                      return (
                        <Fragment key={proposal.id}>
                          <tr id={`proposal-${proposal.id}`}>
                            <td>{formatDate(proposal.created_at)}</td><td>{proposal.proposal_type}</td><td>{proposal.slug ?? "-"}</td><td>{proposal.trust_zone}</td><td>{proposal.status}</td><td>{proposal.summary}</td>
                            <td>
                              {proposal.status === "pending" && (
                                <span className={styles.rowActions}>
                                  <button className={styles.button} type="button" disabled={orgWriteLocked} onClick={() => resolveMemoryProposal(proposal.id, "accept", isSkillProposal ? proposalEdits[proposal.id] ?? bodyMd : undefined)}>accept</button>
                                  <button className={`${styles.button} ${styles.buttonSecondary}`} type="button" disabled={orgWriteLocked} onClick={() => resolveMemoryProposal(proposal.id, "reject")}>reject</button>
                                </span>
                              )}
                            </td>
                          </tr>
                          {skillsEnabled && isSkillProposal && (
                            <tr className={styles.proposalDetailRow}>
                              <td colSpan={7}>
                                <div className={styles.skillProposal}>
                                  <div className={styles.skillProposalHeader}>
                                    <strong>SKILL.md</strong>
                                    <span className={styles.meta}>confidence: {confidence == null ? "not provided" : String(confidence)}</span>
                                  </div>
                                  {proposal.status === "pending" ? (
                                    <textarea
                                      aria-label={`Edit ${proposal.title} SKILL.md`}
                                      className={`${styles.textarea} ${styles.skillBody}`}
                                      value={proposalEdits[proposal.id] ?? bodyMd}
                                      onChange={(event) => setProposalEdits((edits) => ({ ...edits, [proposal.id]: event.target.value }))}
                                    />
                                  ) : (
                                    <pre className={styles.skillBody}>{bodyMd || "SKILL.md body unavailable in proposal payload."}</pre>
                                  )}
                                  <div>
                                    <span className={styles.label}>citations</span>
                                    {citations.length > 0 ? (
                                      <ol className={styles.citationList}>
                                        {citations.map((citation, index) => (
                                          <li key={index}>{typeof citation === "string" ? citation : JSON.stringify(citation)}</li>
                                        ))}
                                      </ol>
                                    ) : (
                                      <p className={styles.meta}>none provided</p>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {tab === "telemetry" && (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>telemetry</h2>
              <div className={styles.summary}>
                <div className={styles.metric}><span className={styles.metricValue}>{telemetrySummary.total_events ?? 0}</span><span className={styles.metricLabel}>events</span></div>
                <div className={styles.metric}><span className={styles.metricValue}>{telemetrySummary.denied_events ?? 0}</span><span className={styles.metricLabel}>denies</span></div>
                <div className={styles.metric}><span className={styles.metricValue}>{telemetrySummary.context_builds ?? 0}</span><span className={styles.metricLabel}>contexts</span></div>
                <div className={styles.metric}><span className={styles.metricValue}>{Math.round(telemetrySummary.avg_latency_ms ?? 0)} ms</span><span className={styles.metricLabel}>avg latency</span></div>
              </div>
              <table className={styles.table}>
                <thead>
                  <tr><th>time</th><th>actor</th><th>action</th><th>outcome</th><th>latency</th></tr>
                </thead>
                <tbody>
                  {telemetryEvents.map((event) => (
                    <tr key={String(event.id)}>
                      <td>{formatDate(String(event.created_at))}</td><td>{String(event.actor_type ?? "")}</td><td>{String(event.action ?? "")}</td><td>{String(event.outcome ?? "")}</td><td>{String(event.latency_ms ?? "-")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "audit" && (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>audit</h2>
              <table className={styles.table}>
                <thead>
                  <tr><th>time</th><th>key</th><th>action</th><th>resource</th><th>metadata</th></tr>
                </thead>
                <tbody>
                  {auditEvents.map((event) => (
                    <tr key={String(event.id)}>
                      <td>{formatDate(String(event.created_at))}</td><td>{String(event.actor_key_prefix ?? "-")}</td><td>{String(event.action ?? "")}</td><td>{String(event.resource_type ?? "-")}</td><td>{JSON.stringify(event.metadata ?? {})}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </ShellTag>
  );
}
