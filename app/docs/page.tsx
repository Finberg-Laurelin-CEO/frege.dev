import type { Metadata } from "next";

const githubUrl = "https://github.com/Finberg-Laurelin-CEO/frege.dev";

const setupSteps = [
  ["1", "Sign in", "Open the protected Frege control plane and choose or create your organization."],
  ["2", "Create roles", "Define what an agent can read, whether it can write sessions, and whether it can propose memory."],
  ["3", "Generate a key", "Create a per-user API key for the agent. Frege shows the raw key once."],
  ["4", "Connect MCP", "Install the Frege CLI on the agent machine, connect the key, and register the MCP command."],
  ["5", "Review memory", "Agent discoveries become proposals. Admins accept or reject them before they become canonical brain pages."],
];

const mcpTools = [
  "frege_brain_status",
  "frege_search_pages",
  "frege_get_page",
  "frege_start_session",
  "frege_append_session_event",
  "frege_build_context",
  "frege_write_page_proposal",
  "frege_propose_memory_from_session",
  "frege_list_agents",
  "frege_run_agent",
  "frege_get_agent_run",
];

export const metadata: Metadata = {
  title: "Frege Docs",
  description: "Setup documentation for Frege orgs, API keys, MCP clients, and governed agent memory.",
  alternates: {
    canonical: "https://frege.dev/docs",
  },
  openGraph: {
    title: "Frege Docs",
    description: "Setup documentation for Frege orgs, API keys, MCP clients, and governed agent memory.",
    url: "https://frege.dev/docs",
  },
};

export default function DocsPage() {
  return (
    <main id="main" className="site docsPage">
      <section className="docsHero" aria-labelledby="docs-title">
        <p className="eyebrow">Docs</p>
        <h1 id="docs-title">Set up Frege for your agents.</h1>
        <p>
          Frege is a hosted brain and control plane. Humans manage organizations, roles, keys, and review queues.
          Agents connect through MCP and only receive context allowed by their org, role, and trust zone.
        </p>
        <div className="hero__actions">
          <a className="button button--primary" href="/login?next=/admin">Open control plane</a>
          <a className="button" href={githubUrl}>View GitHub</a>
        </div>
      </section>

      <section className="band" aria-labelledby="setup-title">
        <div className="sectionHead">
          <p className="eyebrow">Setup</p>
          <h2 id="setup-title">The shortest path from new org to working MCP agent.</h2>
        </div>
        <div className="workflow docsWorkflow">
          {setupSteps.map(([number, title, copy]) => (
            <article key={number} className="step">
              <span>{number}</span>
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="split" aria-labelledby="org-title">
        <div>
          <p className="eyebrow">Org Admin</p>
          <h2 id="org-title">What a user does in the web app.</h2>
          <p>
            Use the protected control plane to create an org, invite members, define agent roles, generate API keys,
            configure model providers, inspect sessions, and review memory proposals.
          </p>
        </div>
        <dl className="securityList">
          <div><dt>Orgs</dt><dd>Create and switch organizations from the admin overview.</dd></div>
          <div><dt>Roles</dt><dd>Choose readable labels, session permissions, memory proposal rights, and agent execution rights.</dd></div>
          <div><dt>API keys</dt><dd>Assign keys to a human owner and role. Store the raw key immediately; it is shown once.</dd></div>
          <div><dt>Telemetry</dt><dd>Review reads, denied context, model calls, key activity, latency, and cost signals.</dd></div>
        </dl>
      </section>

      <section className="band" aria-labelledby="mcp-title">
        <div className="sectionHead">
          <p className="eyebrow">MCP</p>
          <h2 id="mcp-title">Agent-side installation is command based.</h2>
        </div>
        <div className="docsCodeGrid">
          <div>
            <h3>Install from GitHub</h3>
            <pre className="terminalPanel docsCode">{`npm install -g github:Finberg-Laurelin-CEO/frege.dev
frege connect https://frege.dev --token frg_live_...
frege doctor`}</pre>
          </div>
          <div>
            <h3>Register with an agent</h3>
            <pre className="terminalPanel docsCode">{`claude mcp add frege -- frege mcp serve
codex mcp add frege -- frege mcp serve`}</pre>
          </div>
        </div>
        <p className="docsNote">
          `frege connect` writes local machine config to `~/.frege/mcp/config.json`.
          Environment variables `FREGE_BASE_URL` and `FREGE_API_KEY` can override that config for automation.
        </p>
      </section>

      <section className="split" aria-labelledby="tools-title">
        <div>
          <p className="eyebrow">Agent Contract</p>
          <h2 id="tools-title">Agents should use Frege tools, not the database.</h2>
          <p>
            The MCP server calls Frege-hosted APIs with the scoped API key. It never reads Postgres directly and it
            should not read private source vaults unless a human explicitly asks for that separate workflow.
          </p>
        </div>
        <div className="toolList" aria-label="Frege MCP tools">
          {mcpTools.map((tool) => (
            <code key={tool}>{tool}</code>
          ))}
        </div>
      </section>

      <section className="cta" aria-labelledby="agent-title">
        <p className="eyebrow">Agent Instructions</p>
        <h2 id="agent-title">Give this to an agent that is installing Frege.</h2>
        <pre className="terminalPanel docsCode">{`Install the Frege CLI from GitHub.
Run frege connect with the Frege base URL and API key I provide.
Run frege doctor and show me the org, role, and key prefix.
Register frege mcp serve with this agent client.
Use Frege MCP tools for organization memory.
Start a Frege session for substantial workflows.
Build context before answering from Frege knowledge.
Submit memory proposals instead of rewriting canonical knowledge directly.`}</pre>
      </section>
    </main>
  );
}
