"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import styles from "./admin.module.css";

type Tab = "setup" | "overview" | "keys" | "models" | "context" | "brain" | "agents" | "telemetry" | "audit";

const GITHUB_URL = "https://github.com/Finberg-Laurelin-CEO/frege.dev";

const adminTabs: { id: Tab; label: string }[] = [
  { id: "setup", label: "setup docs" },
  { id: "overview", label: "orgs & roles" },
  { id: "keys", label: "api keys" },
  { id: "brain", label: "brain" },
  { id: "agents", label: "agents" },
  { id: "models", label: "models" },
  { id: "context", label: "context" },
  { id: "telemetry", label: "telemetry" },
  { id: "audit", label: "audit" },
];

type Membership = {
  org_id: string;
  org_slug: string;
  org_name: string;
  role: string;
  status: string;
};

type Session = {
  user: {
    email: string;
    name: string;
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
  can_execute_agents?: boolean;
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

type ModelConfig = {
  id: string;
  slug: string;
  name: string;
  provider: string;
  base_url: string | null;
  model_name: string;
  allowed_trust_zones: string[];
  has_api_key: boolean;
  status: string;
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
  model_calls?: number;
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
};

type AgentDefinitionRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: string;
  trust_zone: string;
  model_config_slug?: string;
  model_provider?: string;
  model_name?: string;
  default_context_query: string;
  max_steps: number;
  updated_at: string;
};

type AgentRunRow = {
  id: string;
  agent_slug?: string;
  agent_name?: string;
  model_config_slug?: string;
  session_id: string | null;
  status: string;
  input_md: string;
  result_md: string;
  error: string | null;
  trust_zone: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

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
  const [modelConfigs, setModelConfigs] = useState<ModelConfig[]>([]);
  const [telemetrySummary, setTelemetrySummary] = useState<TelemetrySummary>({});
  const [telemetryEvents, setTelemetryEvents] = useState<Record<string, unknown>[]>([]);
  const [auditEvents, setAuditEvents] = useState<Record<string, unknown>[]>([]);
  const [brainSources, setBrainSources] = useState<BrainSourceRow[]>([]);
  const [brainPages, setBrainPages] = useState<BrainPageRow[]>([]);
  const [brainSessions, setBrainSessions] = useState<BrainSessionRow[]>([]);
  const [memoryProposals, setMemoryProposals] = useState<MemoryProposalRow[]>([]);
  const [agentDefinitions, setAgentDefinitions] = useState<AgentDefinitionRow[]>([]);
  const [agentRuns, setAgentRuns] = useState<AgentRunRow[]>([]);
  const [contextOutput, setContextOutput] = useState("");
  const [lastContextBuildId, setLastContextBuildId] = useState("");
  const [modelOutput, setModelOutput] = useState("");

  const selectedOrg = useMemo(
    () => session?.memberships.find((membership) => membership.org_slug === selectedOrgSlug) ?? null,
    [selectedOrgSlug, session],
  );
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
      const [memberJson, roleJson, keyJson, modelJson, telemetryJson, auditJson, brainJson, agentJson, runJson] =
        await Promise.all([
        fetch(`/api/v1/admin/members?${query}`).then(readJson),
        fetch(`/api/v1/admin/roles?${query}`).then(readJson),
        fetch(`/api/v1/admin/api-keys?${query}`).then(readJson),
        fetch(`/api/v1/admin/model-configs?${query}`).then(readJson),
        fetch(`/api/v1/admin/telemetry?${query}`).then(readJson),
        fetch(`/api/v1/admin/audit-events?${query}`).then(readJson),
        fetch(`/api/v1/admin/brain?${query}`).then(readJson),
        fetch(`/api/v1/admin/agents?${query}`).then(readJson),
        fetch(`/api/v1/admin/agent-runs?${query}`).then(readJson),
      ]);

      setMembers(memberJson.members ?? []);
      setInvites(memberJson.invites ?? []);
      setRoles(roleJson.roles ?? []);
      setApiKeys(keyJson.api_keys ?? []);
      setModelConfigs(modelJson.model_configs ?? []);
      setTelemetrySummary(telemetryJson.summary ?? {});
      setTelemetryEvents(telemetryJson.events ?? []);
      setAuditEvents(auditJson.events ?? []);
      setBrainSources(brainJson.sources ?? []);
      setBrainPages(brainJson.pages ?? []);
      setBrainSessions(brainJson.sessions ?? []);
      setMemoryProposals(brainJson.proposals ?? []);
      setAgentDefinitions(agentJson.agents ?? []);
      setAgentRuns(runJson.runs ?? []);
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
    if (selectedOrgSlug) void refreshAdminData(selectedOrgSlug);
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
          can_execute_agents: form.get("can_execute_agents") === "on",
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

  async function resolveMemoryProposal(id: string, action: "accept" | "reject") {
    setStatus(`${action}ing proposal`);
    try {
      await fetch(`/api/v1/admin/brain/proposals/${id}?org_slug=${encodeURIComponent(selectedOrgSlug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      }).then(readJson);
      await refreshAdminData();
    } catch (error) {
      setStatus((error as Error).message);
    }
  }

  async function upsertModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setStatus("saving model");
    try {
      await fetch("/api/v1/admin/model-configs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          org_slug: selectedOrgSlug,
          slug: form.get("slug"),
          name: form.get("name"),
          provider: form.get("provider"),
          base_url: form.get("base_url") || undefined,
          model_name: form.get("model_name"),
          api_key: form.get("api_key") || undefined,
          allowed_trust_zones: form.get("allow_red") === "on" ? ["green", "red"] : ["green"],
          status: form.get("status"),
        }),
      }).then(readJson);
      await refreshAdminData();
    } catch (error) {
      setStatus((error as Error).message);
    }
  }

  async function upsertAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setStatus("saving agent");
    try {
      await fetch("/api/v1/admin/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          org_slug: selectedOrgSlug,
          slug: form.get("slug"),
          name: form.get("name"),
          description: form.get("description") || "",
          instructions_md: form.get("instructions_md"),
          model_config_slug: form.get("model_config_slug"),
          trust_zone: form.get("trust_zone"),
          default_context_query: form.get("default_context_query") || "",
          max_steps: Number(form.get("max_steps") ?? 1),
          status: form.get("status"),
        }),
      }).then(readJson);
      setTab("agents");
      await refreshAdminData();
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
      setLastContextBuildId(json.context?.id ?? "");
      setContextOutput(JSON.stringify(json.context, null, 2));
      await refreshAdminData();
    } catch (error) {
      setStatus((error as Error).message);
    }
  }

  async function invokeModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setStatus("invoking model");
    try {
      const json = await fetch("/api/v1/model/invoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          org_slug: selectedOrgSlug,
          model_config_slug: form.get("model_config_slug"),
          context_build_id: form.get("context_build_id") || undefined,
          prompt: form.get("prompt"),
          max_tokens: Number(form.get("max_tokens") ?? 800),
        }),
      }).then(readJson);
      setModelOutput(json.result?.content ?? JSON.stringify(json, null, 2));
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
          {tab === "setup" && (
            <>
              <div className={`${styles.section} ${styles.setupHero}`}>
                <div>
                  <span className={styles.kicker}>Setup</span>
                  <h2 className={styles.heroTitle}>Connect this org to agent memory.</h2>
                  <p className={styles.sectionLead}>
                    Create the org shape, issue a scoped API key, then let the agent install Frege MCP from GitHub.
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
                    Role permissions drive trust-zone access, session visibility, proposals, and hosted agent execution.
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
                    from the key, so agents never provide trusted identity in requests.
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
                  <a className={`${styles.button} ${styles.buttonSecondary}`} href={GITHUB_URL}>
                    GitHub repo
                  </a>
                </section>
              </div>

              <div className={styles.section}>
                <h2 className={styles.sectionTitle}>agent install commands</h2>
                <pre className={styles.codeBlock}>{`npm install -g @frege-dev/cli

# zsh PATH fallback if frege is not found:
echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

frege connect https://frege.dev --token frg_live_...
frege doctor

frege docs sync frege.docs.yml --dry-run
frege docs sync frege.docs.yml

claude mcp add frege -- frege mcp serve
codex mcp add frege -- frege mcp serve`}</pre>
                <p className={styles.meta}>
                  Use the API key created in the keys tab. `frege connect` stores local config at
                  {" "}~/.frege/mcp/config.json and avoids putting secrets in browser instructions.
                </p>
              </div>

              <div className={styles.section}>
                <h2 className={styles.sectionTitle}>agent operating instructions</h2>
                <pre className={styles.codeBlock}>{`Use Frege MCP tools for organization memory.
Start a Frege session for substantial workflows.
Build context before answering from Frege knowledge.
If Frege reports denied context, do not guess what was denied.
Submit memory proposals instead of rewriting canonical knowledge directly.
Use frege_run_agent only when the user asks Frege's hosted runtime to execute work.`}</pre>
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
                    <button className={styles.button} type="submit">create org</button>
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
                    <button className={styles.button} type="submit">invite</button>
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
                  <label className={styles.checkbox}><input type="checkbox" name="can_execute_agents" /> execute agents</label>
                  <div className={styles.buttonRow}>
                    <button className={styles.button} type="submit">save role</button>
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
                            role.can_execute_agents ? "agents" : "",
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
                          {selectedApiKeyRole.can_execute_agents ? " / runs agents" : ""}
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
                      <button className={styles.button} type="submit" disabled={!roles.length || !members.length}>
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

          {tab === "models" && (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>model configs</h2>
              <form className={styles.form} onSubmit={upsertModel}>
                <label className={styles.field}><span className={styles.label}>slug</span><input className={styles.input} name="slug" defaultValue="vercel-gateway" /></label>
                <label className={styles.field}><span className={styles.label}>name</span><input className={styles.input} name="name" defaultValue="Vercel AI Gateway" /></label>
                <label className={styles.field}>
                  <span className={styles.label}>provider</span>
                  <select className={styles.select} name="provider" defaultValue="vercel-ai-gateway">
                    <option value="vercel-ai-gateway">vercel ai gateway</option>
                    <option value="openai-compatible">openai compatible router</option>
                    <option value="ollama">ollama</option>
                    <option value="openrouter">openrouter</option>
                  </select>
                </label>
                <label className={styles.field}><span className={styles.label}>base url</span><input className={styles.input} name="base_url" placeholder="https://runtime.example.com/v1" /></label>
                <label className={styles.field}><span className={styles.label}>model</span><input className={styles.input} name="model_name" defaultValue="openai/gpt-5.4" /></label>
                <label className={styles.field}><span className={styles.label}>api key</span><input className={styles.input} name="api_key" type="password" /></label>
                <label className={styles.checkbox}><input type="checkbox" name="allow_red" /> allow red</label>
                <label className={styles.field}>
                  <span className={styles.label}>status</span>
                  <select className={styles.select} name="status" defaultValue="active">
                    <option value="active">active</option>
                    <option value="disabled">disabled</option>
                  </select>
                </label>
                <div className={styles.buttonRow}>
                  <button className={styles.button} type="submit">save model</button>
                </div>
              </form>
              <table className={styles.table}>
                <thead>
                  <tr><th>slug</th><th>provider</th><th>model</th><th>trust</th><th>secret</th><th>status</th></tr>
                </thead>
                <tbody>
                  {modelConfigs.map((config) => (
                    <tr key={config.id}>
                      <td>{config.slug}</td><td>{config.provider}</td><td>{config.model_name}</td><td>{config.allowed_trust_zones.join(", ")}</td><td>{config.has_api_key ? "yes" : "no"}</td><td>{config.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "context" && (
            <>
              <div className={styles.section}>
                <h2 className={styles.sectionTitle}>build context</h2>
                <form className={styles.form} onSubmit={buildContext}>
                  <label className={styles.field}><span className={styles.label}>query</span><input className={styles.input} name="query" defaultValue="refund" /></label>
                  <label className={styles.field}><span className={styles.label}>slug</span><input className={styles.input} name="slug" /></label>
                  <label className={styles.field}><span className={styles.label}>limit</span><input className={styles.input} name="limit" type="number" defaultValue="8" /></label>
                  <div className={styles.buttonRow}><button className={styles.button} type="submit">build</button></div>
                </form>
                {contextOutput && <pre className={styles.output}>{contextOutput}</pre>}
              </div>

              <div className={styles.section}>
                <h2 className={styles.sectionTitle}>invoke model</h2>
                <form className={styles.form} onSubmit={invokeModel}>
                  <label className={styles.field}>
                    <span className={styles.label}>model config</span>
                    <select className={styles.select} name="model_config_slug">
                      {modelConfigs.map((config) => (
                        <option key={config.id} value={config.slug}>{config.slug}</option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.field}><span className={styles.label}>context build id</span><input className={styles.input} name="context_build_id" value={lastContextBuildId} onChange={(event) => setLastContextBuildId(event.target.value)} /></label>
                  <label className={styles.field}><span className={styles.label}>max tokens</span><input className={styles.input} name="max_tokens" type="number" defaultValue="800" /></label>
                  <label className={`${styles.field} ${styles.fieldWide}`}><span className={styles.label}>prompt</span><textarea className={styles.textarea} name="prompt" defaultValue="Summarize the relevant policy and cite source slugs." /></label>
                  <div className={styles.buttonRow}><button className={styles.button} type="submit">invoke</button></div>
                </form>
                {modelOutput && <pre className={styles.output}>{modelOutput}</pre>}
              </div>
            </>
          )}

          {tab === "brain" && (
            <>
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
                    <tr><th>slug</th><th>title</th><th>source</th><th>trust</th><th>rev</th><th>summary</th></tr>
                  </thead>
                  <tbody>
                    {brainPages.map((page) => (
                      <tr key={page.id}><td>{page.slug}</td><td>{page.title}</td><td>{page.source_slug ?? "-"}</td><td>{page.trust_zone}</td><td>{page.revision_number}</td><td>{page.summary}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className={styles.section}>
                <h2 className={styles.sectionTitle}>agent sessions</h2>
                <table className={styles.table}>
                  <thead>
                    <tr><th>title</th><th>client</th><th>owner</th><th>trust</th><th>events</th><th>last event</th></tr>
                  </thead>
                  <tbody>
                    {brainSessions.map((session) => (
                      <tr key={session.id}>
                        <td>{session.title}</td><td>{session.client}</td><td>{session.owner_user_email ?? session.actor_key_prefix ?? "-"}</td><td>{session.trust_zone}</td><td>{session.event_count}</td><td>{formatDate(session.last_event_at ?? session.started_at)}</td>
                      </tr>
                    ))}
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
                    {memoryProposals.map((proposal) => (
                      <tr key={proposal.id}>
                        <td>{formatDate(proposal.created_at)}</td><td>{proposal.proposal_type}</td><td>{proposal.slug ?? "-"}</td><td>{proposal.trust_zone}</td><td>{proposal.status}</td><td>{proposal.summary}</td>
                        <td>
                          {proposal.status === "pending" && (
                            <span className={styles.buttonRow}>
                              <button className={styles.button} type="button" onClick={() => resolveMemoryProposal(proposal.id, "accept")}>accept</button>
                              <button className={`${styles.button} ${styles.buttonSecondary}`} type="button" onClick={() => resolveMemoryProposal(proposal.id, "reject")}>reject</button>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {tab === "agents" && (
            <>
              <div className={styles.section}>
                <h2 className={styles.sectionTitle}>agent definitions</h2>
                <form className={styles.form} onSubmit={upsertAgent}>
                  <label className={styles.field}><span className={styles.label}>slug</span><input className={styles.input} name="slug" defaultValue="context-summarizer" /></label>
                  <label className={styles.field}><span className={styles.label}>name</span><input className={styles.input} name="name" defaultValue="Context Summarizer" /></label>
                  <label className={styles.field}>
                    <span className={styles.label}>model config</span>
                    <select className={styles.select} name="model_config_slug">
                      {modelConfigs.map((config) => (
                        <option key={config.id} value={config.slug}>{config.slug}</option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span className={styles.label}>trust</span>
                    <select className={styles.select} name="trust_zone" defaultValue="green">
                      <option value="green">green</option>
                      <option value="red">red</option>
                    </select>
                  </label>
                  <label className={styles.field}><span className={styles.label}>context query</span><input className={styles.input} name="default_context_query" defaultValue="company policy" /></label>
                  <label className={styles.field}><span className={styles.label}>max steps</span><input className={styles.input} name="max_steps" type="number" defaultValue="1" /></label>
                  <label className={styles.field}>
                    <span className={styles.label}>status</span>
                    <select className={styles.select} name="status" defaultValue="active">
                      <option value="active">active</option>
                      <option value="disabled">disabled</option>
                    </select>
                  </label>
                  <label className={styles.field}><span className={styles.label}>description</span><input className={styles.input} name="description" defaultValue="Summarizes governed Frege context for a task." /></label>
                  <label className={`${styles.field} ${styles.fieldWide}`}>
                    <span className={styles.label}>instructions</span>
                    <textarea className={styles.textarea} name="instructions_md" defaultValue="Summarize the task using only Frege-provided context. Cite source slugs. If context was denied, mention that without guessing denied sources." />
                  </label>
                  <div className={styles.buttonRow}><button className={styles.button} type="submit">save agent</button></div>
                </form>
                <table className={styles.table}>
                  <thead>
                    <tr><th>slug</th><th>name</th><th>model</th><th>trust</th><th>status</th><th>updated</th></tr>
                  </thead>
                  <tbody>
                    {agentDefinitions.map((agent) => (
                      <tr key={agent.id}>
                        <td>{agent.slug}</td><td>{agent.name}</td><td>{agent.model_config_slug ?? agent.model_name ?? "-"}</td><td>{agent.trust_zone}</td><td>{agent.status}</td><td>{formatDate(agent.updated_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className={styles.section}>
                <h2 className={styles.sectionTitle}>agent runs</h2>
                <table className={styles.table}>
                  <thead>
                    <tr><th>time</th><th>agent</th><th>model</th><th>status</th><th>trust</th><th>input</th><th>result</th></tr>
                  </thead>
                  <tbody>
                    {agentRuns.map((run) => (
                      <tr key={run.id}>
                        <td>{formatDate(run.created_at)}</td>
                        <td>{run.agent_slug ?? run.agent_name ?? "-"}</td>
                        <td>{run.model_config_slug ?? "-"}</td>
                        <td>{run.status}</td>
                        <td>{run.trust_zone}</td>
                        <td>{run.input_md.slice(0, 120)}</td>
                        <td>{run.error ?? run.result_md.slice(0, 160)}</td>
                      </tr>
                    ))}
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
                <div className={styles.metric}><span className={styles.metricValue}>{telemetrySummary.model_calls ?? 0}</span><span className={styles.metricLabel}>model calls</span></div>
              </div>
              <table className={styles.table}>
                <thead>
                  <tr><th>time</th><th>actor</th><th>action</th><th>outcome</th><th>provider</th><th>latency</th></tr>
                </thead>
                <tbody>
                  {telemetryEvents.map((event) => (
                    <tr key={String(event.id)}>
                      <td>{formatDate(String(event.created_at))}</td><td>{String(event.actor_type ?? "")}</td><td>{String(event.action ?? "")}</td><td>{String(event.outcome ?? "")}</td><td>{String(event.provider ?? "-")}</td><td>{String(event.latency_ms ?? "-")}</td>
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
