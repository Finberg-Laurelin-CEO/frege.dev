import type { Metadata } from "next";

const githubUrl = "https://github.com/Finberg-Laurelin-CEO/frege.dev";

const toc: [string, string, string][] = [
  ["01", "overview", "Overview"],
  ["02", "org-setup", "Organization setup"],
  ["03", "api-keys", "API keys"],
  ["04", "mcp-install", "Connect over MCP"],
  ["05", "agent-instructions", "Agent instructions"],
  ["06", "tools", "Available tools"],
];

const setupSteps: [string, string][] = [
  ["Sign in", "Open the protected Frege control plane and choose or create your organization."],
  ["Create roles", "Define what an agent can read, whether it can write sessions, and whether it can propose memory."],
  ["Generate a key", "Create a per-user API key for the agent. Frege shows the raw key once."],
  ["Connect MCP", "Install the Frege CLI on the agent machine, connect the key, and register the MCP command."],
  ["Review memory", "Agent discoveries become proposals. Admins accept or reject them before they become canonical pages."],
];

const mcpTools: [string, string][] = [
  ["frege_brain_status", "Confirm org, role, key prefix, and connectivity."],
  ["frege_build_context", "Assemble scoped, cited context for a task before answering."],
  ["frege_search_pages", "Search brain pages the caller is allowed to see."],
  ["frege_get_page", "Read a specific page and its revisions."],
  ["frege_write_page_proposal", "Submit a reviewable update instead of editing canonical knowledge."],
  ["frege_start_session", "Open a session ledger for a substantial workflow."],
  ["frege_append_session_event", "Record task activity onto the active session."],
];

export const metadata: Metadata = {
  title: "Frege Docs",
  description:
    "Setup documentation for Frege orgs, API keys, MCP clients, and governed agent memory.",
  alternates: { canonical: "https://frege.dev/docs" },
  openGraph: {
    title: "Frege Docs",
    description:
      "Setup documentation for Frege orgs, API keys, MCP clients, and governed agent memory.",
    url: "https://frege.dev/docs",
  },
};

export default function DocsPage() {
  return (
    <main id="main" className="docs">
      <header className="docs__head">
        <p className="eyebrow">Documentation</p>
        <h1>Set up Frege for your agents.</h1>
        <p>
          Frege is a hosted brain and control plane. Humans manage organizations, roles,
          keys, and review queues. Agents connect over MCP and only receive context allowed
          by their org, role, and trust zone.
        </p>
        <div className="hero__actions">
          <a className="button button--primary" href="/login?next=/admin">Open control plane</a>
          <a className="button" href={githubUrl}>View GitHub</a>
        </div>
        <nav className="docs__toc" aria-label="Contents">
          {toc.map(([n, id, label]) => (
            <a key={id} href={`#${id}`} data-n={n}>{label}</a>
          ))}
        </nav>
      </header>

      <section id="overview">
        <h2>Overview</h2>
        <p>
          A Frege brain stores institutional knowledge as versioned pages with sources,
          links, and trust zones. Agents never read raw files. Instead they request scoped
          context, and Frege resolves org, role, and source permissions before returning
          anything. The shortest path from a new org to a working MCP agent:
        </p>
        <ol>
          {setupSteps.map(([title, copy]) => (
            <li key={title}><b>{title}</b> — {copy}</li>
          ))}
        </ol>
      </section>

      <section id="org-setup">
        <h2>Organization setup</h2>
        <p>
          Admins manage the org from the protected control plane (sign in at{" "}
          <a className="lnk" href="/login?next=/admin">/login</a>). New organizations are
          provisioned for pilot teams — <a className="lnk" href="/signup">request access</a>{" "}
          to get one. From the web app you create an org, invite members, define agent roles,
          generate API keys, configure model providers, inspect sessions, and review memory
          proposals.
        </p>
        <h3>What an org holds</h3>
        <ul>
          <li><b>Orgs</b> — create and switch organizations from the admin overview.</li>
          <li><b>Roles</b> — readable labels, session permissions, memory-proposal rights, and agent execution rights.</li>
          <li><b>API keys</b> — assigned to a human owner and role. Store the raw key immediately; it is shown once.</li>
          <li><b>Telemetry</b> — reads, denied context, model calls, key activity, latency, and cost signals.</li>
        </ul>
        <p className="docs__note">
          Org is always derived from the session or API key — never from client input — so an
          agent can only ever see its own organization&apos;s knowledge.
        </p>
      </section>

      <section id="api-keys">
        <h2>API keys</h2>
        <p>
          Every agent connects with a per-identity API key issued from the control plane.
          Keys inherit the role of the user they belong to, so an agent sees exactly what
          that person is allowed to see. Assign the key to a human owner and a role, then
          copy the raw key once — Frege shows it a single time.
        </p>
        <p className="docs__note">
          Keys are secrets. Session and proposal writes redact raw keys, passwords, and
          provider tokens, but treat the key itself like any production credential.
        </p>
      </section>

      <section id="mcp-install">
        <h2>Connect over MCP</h2>
        <p>
          Agent-side installation is command based. Install the Frege CLI from GitHub,
          connect it with your base URL and API key, then register the MCP command with any
          MCP-capable agent.
        </p>

        <h3>Install and connect</h3>
        <pre><code>{`npm install -g github:Finberg-Laurelin-CEO/frege.dev
frege connect https://frege.dev --token frg_live_...
frege doctor`}</code></pre>

        <h3>Register with an agent</h3>
        <pre><code>{`claude mcp add frege -- frege mcp serve
codex mcp add frege -- frege mcp serve`}</code></pre>
        <p>
          Once connected, run <code>frege_brain_status</code> to confirm the agent resolves to
          the right organization, role, and key prefix.
        </p>
        <p className="docs__note">
          <code>frege connect</code> writes local machine config to{" "}
          <code>~/.frege/mcp/config.json</code>. The environment variables{" "}
          <code>FREGE_BASE_URL</code> and <code>FREGE_API_KEY</code> override that config for
          automation.
        </p>
      </section>

      <section id="agent-instructions">
        <h2>Agent instructions</h2>
        <p>
          Give this to an agent that is installing Frege. It keeps day-to-day task activity in
          the session ledger while durable changes flow through review:
        </p>
        <pre><code>{`# Using the Frege company brain

- Install the Frege CLI from GitHub and run frege connect with the
  base URL and API key I provide. Run frege doctor and show me the
  org, role, and key prefix.
- Register frege mcp serve with this agent client.
- Before answering from memory, call frege_build_context so you
  start from scoped, cited company knowledge.
- Search with frege_search_pages; read specifics with
  frege_get_page. Cite the pages you used.
- Treat denied or hidden sources as out of scope. Do not guess
  around them.
- Start a session with frege_start_session for substantial work
  and record activity with frege_append_session_event.
- When you learn something durable and correct, do NOT edit pages
  directly. Submit it with frege_write_page_proposal so a human
  can review before it becomes canonical.`}</code></pre>
      </section>

      <section id="tools">
        <h2>Available tools</h2>
        <p>
          The MCP server calls Frege-hosted APIs with the scoped API key. It never reads the
          database directly. The tools you will use most:
        </p>
        <ul>
          {mcpTools.map(([name, desc]) => (
            <li key={name}><code>{name}</code> — {desc}</li>
          ))}
        </ul>
        <p className="docs__note">
          Every tool enforces the caller&apos;s permissions server-side. There is no path for an
          agent to reach knowledge outside its role and organization.
        </p>
      </section>
    </main>
  );
}
