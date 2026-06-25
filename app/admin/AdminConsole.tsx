"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import styles from "./admin.module.css";

type Tab = "setup" | "overview" | "signups" | "keys" | "models" | "context" | "brain" | "agents" | "telemetry" | "audit";

const GITHUB_URL = "https://github.com/Finberg-Laurelin-CEO/frege.dev";

const adminTabs: { id: Tab; label: string }[] = [
  { id: "setup", label: "setup docs" },
  { id: "overview", label: "orgs & roles" },
  { id: "signups", label: "signups" },
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

type SignupRow = {
  id: string;
  created_at: string;
  name: string;
  work_email: string;
  company: string;
  role: string;
  company_size: string;
  expected_users: number;
  main_pain_point: string;
  other_comments: string;
  status: "new" | "contacted" | "qualified" | "disqualified";
  contacted_at: string | null;
  qualified_at: string | null;
  notes: string;
  disqualified_reason: string;
  owner_user_email: string | null;
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

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

async function readJson(response: Response) {
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error ?? `http_${response.status}`);
  return json;
}

export default function AdminConsole() {
  const [session, setSession] = useState<Session | null>(null);
  const [selectedOrgSlug, setSelectedOrgSlug] = useState("");
  const [tab, setTab] = useState<Tab>("setup");
  const [status, setStatus] = useState("loading");
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [signups, setSignups] = useState<SignupRow[]>([]);
  const [lastInviteLink, setLastInviteLink] = useState("");
  const [roles, setRoles] = useState<Role[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyRow[]>([]);
  const [rawKey, setRawKey] = useState("");
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

  async function refreshAdminData(orgSlug = selectedOrgSlug) {
    if (!orgSlug) return;
    setStatus("refreshing");
    try {
      const query = `org_slug=${encodeURIComponent(orgSlug)}`;
      const [memberJson, signupJson, roleJson, keyJson, modelJson, telemetryJson, auditJson, brainJson, agentJson, runJson] =
        await Promise.all([
        fetch(`/api/v1/admin/members?${query}`).then(readJson),
        fetch(`/api/v1/admin/signups?${query}`).then(readJson),
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
      setSignups(signupJson.signups ?? []);
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

  async function updateSignupStatus(id: string, status: SignupRow["status"]) {
    setStatus(`marking signup ${status}`);
    try {
      await fetch("/api/v1/admin/signups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      }).then(readJson);
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
    const form = new FormData(event.currentTarget);
    const expiresAtValue = String(form.get("expires_at") ?? "").trim();
    const expiresAt = expiresAtValue ? new Date(expiresAtValue) : null;
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
          role_slug: form.get("role_slug"),
          owner_user_id: form.get("owner_user_id") || undefined,
          expires_at: expiresAt ? expiresAt.toISOString() : undefined,
        }),
      }).then(readJson);
      const nextRawKey = json.raw_key ?? "";
      setRawKey(nextRawKey);
      setTab("keys");
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
    return (
      <main id="main" className={styles.shell}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Frege control plane</h1>
            <p className={styles.meta}>not authenticated</p>
          </div>
          <a className="lnk" href="/login?next=/admin">login</a>
        </div>
      </main>
    );
  }

  return (
    <main id="main" className={styles.shell}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Frege control plane</h1>
          <p className={styles.meta}>
            {session ? `${session.user.email} / ${selectedOrg?.org_name ?? "no org"}` : "loading"}
          </p>
        </div>
        <div className={styles.headerActions}>
          <a className={`${styles.button} ${styles.buttonSecondary}`} href="/docs">docs</a>
          <a className={`${styles.button} ${styles.buttonSecondary}`} href="/console">knowledge console</a>
          <button className={`${styles.button} ${styles.buttonSecondary}`} type="button" onClick={logout}>
            logout
          </button>
        </div>
      </div>

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
                <pre className={styles.codeBlock}>{`npm install -g @frege/cli
# Until @frege/cli is public:
npm install -g github:Finberg-Laurelin-CEO/frege.dev

# zsh PATH fallback if frege is not found:
echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

frege connect https://frege.dev --token frg_live_...
frege doctor

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

          {tab === "signups" && (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>pilot signups</h2>
              <p className={styles.sectionLead}>Latest pilot requests from the public signup form.</p>
              <table className={styles.table}>
                <thead>
                  <tr><th>time</th><th>status</th><th>person</th><th>company</th><th>org size</th><th>role</th><th>info</th><th>owner</th><th>actions</th></tr>
                </thead>
                <tbody>
                  {signups.map((signup) => (
                    <tr key={signup.id}>
                      <td>{formatDate(signup.created_at)}</td>
                      <td>{signup.status}</td>
                      <td>{signup.name}<br /><span className={styles.meta}>{signup.work_email}</span></td>
                      <td>{signup.company}</td>
                      <td>{signup.company_size}</td>
                      <td>{signup.role || "-"}</td>
                      <td>{signup.main_pain_point || signup.other_comments || "-"}</td>
                      <td>{signup.owner_user_email ?? "-"}</td>
                      <td>
                        <span className={styles.buttonRow}>
                          <button className={styles.button} type="button" onClick={() => updateSignupStatus(signup.id, "contacted")}>contacted</button>
                          <button className={styles.button} type="button" onClick={() => updateSignupStatus(signup.id, "qualified")}>qualified</button>
                          <button className={`${styles.button} ${styles.buttonSecondary}`} type="button" onClick={() => updateSignupStatus(signup.id, "disqualified")}>disqualify</button>
                        </span>
                      </td>
                    </tr>
                  ))}
                  {signups.length === 0 && (
                    <tr><td colSpan={9}>No pilot signups yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {tab === "keys" && (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>api keys</h2>
              <form className={styles.form} onSubmit={createApiKey}>
                <label className={styles.field}>
                  <span className={styles.label}>name</span>
                  <input className={styles.input} name="name" defaultValue="local agent" />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>role</span>
                  <select className={styles.select} name="role_slug">
                    {roles.map((role) => (
                      <option key={role.id} value={role.slug}>{role.slug}</option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>owner user</span>
                  <select className={styles.select} name="owner_user_id" defaultValue={members[0]?.id ?? ""}>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>{member.email}</option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>expires</span>
                  <input className={styles.input} name="expires_at" type="datetime-local" />
                </label>
                <div className={styles.buttonRow}>
                  <button className={styles.button} type="submit">create key</button>
                </div>
              </form>
              {rawKey && (
                <div className={styles.notice}>
                  <span className={styles.label}>raw key shown once</span>
                  <code className={styles.code}>{rawKey}</code>
                  <span className={styles.status}>
                    Store this now. Frege stores only the key hash, so this value cannot be shown again.
                  </span>
                  <div className={styles.buttonRow}>
                    <button className={styles.button} type="button" onClick={() => copyText(rawKey, "raw key")}>
                      copy key
                    </button>
                    <button
                      className={`${styles.button} ${styles.buttonSecondary}`}
                      type="button"
                      onClick={() => copyText(`Authorization: Bearer ${rawKey}`, "Bearer header")}
                    >
                      copy Bearer header
                    </button>
                  </div>
                  <pre className={styles.codeBlock}>{`Authorization: Bearer ${rawKey}

curl -s ${browserOrigin || "https://frege.dev"}/api/v1/brain/status \\
  -H "Authorization: Bearer ${rawKey}"

curl -s ${browserOrigin || "https://frege.dev"}/api/v1/context/build \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${rawKey}" \\
  -d '{"query":"refund policy","limit":3}'`}</pre>
                </div>
              )}
              <table className={styles.table}>
                <thead>
                  <tr><th>prefix</th><th>name</th><th>owner</th><th>role</th><th>status</th><th>expires</th><th>last used</th><th></th></tr>
                </thead>
                <tbody>
                  {apiKeys.map((key) => (
                    <tr key={key.id}>
                      <td>{key.key_prefix}</td><td>{key.name}</td><td>{key.owner_user_email ?? "-"}</td><td>{key.role_slug}</td><td>{key.status}</td><td>{formatDate(key.expires_at)}</td><td>{formatDate(key.last_used_at)}</td>
                      <td>
                        <button
                          className={`${styles.button} ${styles.buttonSecondary}`}
                          type="button"
                          disabled={key.status !== "active"}
                          onClick={() => revokeApiKey(key.id)}
                        >
                          revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
    </main>
  );
}
