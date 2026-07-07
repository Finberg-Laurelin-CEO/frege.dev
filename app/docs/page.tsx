import type { Metadata } from "next";

const githubUrl = "https://github.com/Finberg-Laurelin-CEO/frege.dev";

const toc: [string, string, string][] = [
  ["01", "overview", "Overview"],
  ["02", "org-setup", "Organization setup"],
  ["03", "api-keys", "API keys"],
  ["04", "cli-install", "Install the CLI"],
  ["05", "zsh-path", "zsh terminal setup"],
  ["06", "mcp-register", "Register MCP"],
  ["07", "docs-push", "Push documents"],
  ["08", "agent-instructions", "Agent instructions"],
  ["09", "tools", "Available tools"],
  ["10", "troubleshooting", "Troubleshooting"],
  ["11", "security", "Security"],
];

const setupSteps: [string, string][] = [
  ["Sign in", "Open the protected Frege control plane and choose or create your organization."],
  ["Create roles", "Define what an agent can read, whether it can write sessions, and whether it can propose memory."],
  ["Generate a key", "Create a per-user API key for the agent. Frege shows the raw key once."],
  ["Install CLI", "Install the Frege CLI with npm, make sure zsh can find it, and connect the key."],
  ["Register MCP", "Point Claude Code, Codex, or another MCP client at frege mcp serve."],
  ["Push docs", "Have the agent push approved markdown with frege docs push or frege docs sync."],
  ["Review memory", "Agent discoveries become proposals. Admins accept or reject them before they become canonical pages."],
];

const mcpTools: [string, string][] = [
  ["frege_status", "Confirm org, role, key prefix, and connectivity."],
  ["frege_brain_status", "Inspect hosted brain status, indexed pages, and source counts."],
  ["frege_list_sources", "List source collections the connected key can see."],
  ["frege_search_pages", "Search brain pages the caller is allowed to see."],
  ["frege_get_page", "Read a specific page and its revisions."],
  ["frege_build_context", "Assemble scoped, cited context for a task before answering."],
  ["frege_start_session", "Open a session ledger for a substantial workflow."],
  ["frege_append_session_event", "Record task activity onto the active session."],
  ["frege_get_session", "Read an existing session and its redacted events."],
  ["frege_search_sessions", "Find past sessions by title, client, or goal."],
  ["frege_create_document", "Create a document from user-approved markdown."],
  ["frege_read_document", "Read a visible document by slug."],
  ["frege_search_documents", "Search visible documents by text, title, path, or tag."],
  ["frege_write_page_proposal", "Submit a reviewable update instead of editing canonical knowledge."],
  ["frege_add_source_proposal", "Propose a new source for human review."],
  ["frege_list_agents", "List Frege-hosted agents available to this org and role."],
  ["frege_run_agent", "Queue hosted agent work when the key has execution permission."],
  ["frege_get_agent_run", "Read status and output for a hosted agent run."],
];

export const metadata: Metadata = {
  title: "Frege Docs",
  description:
    "Setup documentation for Frege orgs, API keys, MCP clients, zsh terminal setup, and governed agent memory.",
  alternates: { canonical: "https://frege.dev/docs" },
  openGraph: {
    title: "Frege Docs",
    description:
      "Setup documentation for Frege orgs, API keys, MCP clients, zsh terminal setup, and governed agent memory.",
    url: "https://frege.dev/docs",
  },
};

export default function DocsPage() {
  return (
    <main id="main" className="docs docs--withSidebar">
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
          <a className="button" href="/architecture">Architecture</a>
          <a className="button" href="/pricing">Pricing</a>
          <a className="button" href={githubUrl}>View GitHub</a>
        </div>
      </header>

      <div className="docs__layout">
        <nav className="docs__sidebar" aria-label="Contents">
          {toc.map(([n, id, label]) => (
            <a key={id} href={`#${id}`} data-n={n}>{label}</a>
          ))}
        </nav>

        <div className="docs__main">
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
            <li key={title}><b>{title}</b>: {copy}</li>
          ))}
        </ol>
      </section>

      <section id="org-setup">
        <h2>Organization setup</h2>
        <p>
          Admins manage the org from the protected control plane (sign in at{" "}
          <a className="lnk" href="/login?next=/admin">/login</a>). New organizations are
          provisioned for customers. <a className="lnk" href="/signup">Create an account</a>{" "}
          to get one. From the web app you create an org, invite members, define agent roles,
          generate API keys, configure model providers, inspect sessions, and review memory
          proposals.
        </p>
        <h3>What an org holds</h3>
        <ul>
          <li><b>Orgs</b>: create and switch organizations from the admin overview.</li>
          <li><b>Roles</b>: readable labels, session permissions, memory-proposal rights, and agent execution rights.</li>
          <li><b>API keys</b>: assigned to a human owner and role. Store the raw key immediately because it is shown once.</li>
          <li><b>Telemetry</b>: reads, denied context, model calls, key activity, latency, and cost signals.</li>
        </ul>
        <p className="docs__note">
          Org is always derived from the session or API key, never from client input, so an
          agent can only ever see its own organization&apos;s knowledge.
        </p>
      </section>

      <section id="api-keys">
        <h2>API keys</h2>
        <p>
          Every agent connects with a per-identity API key issued from the control plane.
          Keys inherit the role of the user they belong to, so an agent sees exactly what
          that person is allowed to see. Assign the key to a human owner and a role, then
          copy the raw key once.
        </p>
        <ol>
          <li>Open <a className="lnk" href="/login?next=/admin">the control plane</a>.</li>
          <li>Choose the org.</li>
          <li>Create or select an agent role.</li>
          <li>Create an API key for that role and owner.</li>
          <li>Copy the raw <code>frg_live_...</code> key immediately.</li>
        </ol>
        <p className="docs__note">
          Keys are secrets. Session and proposal writes redact raw keys, passwords, and
          provider tokens, but treat the key itself like any production credential.
        </p>
      </section>

      <section id="cli-install">
        <h2>Install the CLI</h2>
        <p>
          The CLI is a Node.js executable (Node 20+). Install it globally with npm, then verify
          the <code>frege</code> command is on your path.
        </p>
        <pre><code>{`# Install
npm install -g @frege-dev/cli

# Verify
frege --help`}</code></pre>
        <p className="docs__note">
          Frege MCP stays local: <code>frege mcp serve</code> runs on the agent machine and calls
          Frege-hosted APIs with the locally stored API key.
        </p>
      </section>

      <section id="zsh-path">
        <h2>Make <code>frege</code> available in zsh</h2>
        <p>
          If zsh says <code>frege: command not found</code>, add npm&apos;s global bin directory to
          your shell path.
        </p>
        <pre><code>{`npm config get prefix

echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
hash -r

command -v frege
frege --help`}</code></pre>
        <p className="docs__note">
          Some npm versions support <code>npm bin -g</code>. If yours does, it should point at
          the same bin directory that zsh needs in <code>PATH</code>.
        </p>
      </section>

      <section id="mcp-register">
        <h2>Connect and register MCP</h2>
        <p>
          One command does everything. <code>frege connect</code> saves your key, verifies it
          against Frege, and automatically registers <code>frege mcp serve</code> with any MCP
          client it finds (Claude Code, Codex). After it prints your org and role, you are ready
          to use Frege from that agent.
        </p>
        <pre><code>{`frege connect https://frege.dev --token frg_live_...`}</code></pre>
        <p>Expected output:</p>
        <pre><code>{`Frege config saved to ~/.frege/mcp/config.json
Connected: org acme, role reader, key abc123

Registering Frege with Claude Code... done
Registering Frege with Codex... done

You're set. Restart your MCP client if it was already running.`}</code></pre>
        <p>
          That is the whole setup. Restart your agent client if it was already running, and the
          Frege tools are available.
        </p>
        <h3>If a client is not detected</h3>
        <p>
          Install the client CLI, then register it explicitly. This is the same command
          <code> frege connect</code> runs for you:
        </p>
        <pre><code>{`frege agent install claude
frege agent install codex`}</code></pre>
        <h3>Manual / generic MCP JSON</h3>
        <p>
          Use <code>--no-register</code> to skip auto-registration, or configure a client by hand:
        </p>
        <pre><code>{`{
  "mcpServers": {
    "frege": {
      "command": "frege",
      "args": ["mcp", "serve"]
    }
  }
}`}</code></pre>
        <p className="docs__note">
          The API key lives only in <code>~/.frege/mcp/config.json</code>, so MCP client JSON never
          needs to contain it. <code>FREGE_BASE_URL</code> and <code>FREGE_API_KEY</code> override
          local config for automation.
        </p>
      </section>

      <section id="docs-push">
        <h2>Push markdown documents</h2>
        <p>
          Agents should load user-approved markdown through the CLI. The terminal shows exactly
          what was pushed, and Frege records the write through the same org, role, and audit
          controls as MCP.
        </p>
        <h3>One file</h3>
        <pre><code>{`frege docs push docs/INVESTOR_DEMO_WORKFLOW.md \\
  --sensitivity internal \\
  --tag frege-demo \\
  --tag operations`}</code></pre>
        <h3>Directory preview</h3>
        <pre><code>{`frege docs push docs \\
  --include "**/*.md" \\
  --exclude "**/HANDOFF.md" \\
  --sensitivity internal \\
  --dry-run`}</code></pre>
        <h3>Manifest sync</h3>
        <pre><code>{`frege docs sync frege.docs.yml --dry-run
frege docs sync frege.docs.yml
frege docs list
frege docs read hosted-brain-architecture
frege context "how does Frege signup work?"`}</code></pre>
        <p className="docs__note">
          Markdown wikilinks such as <code>[[hosted brain architecture]]</code> are preserved in
          pushed documents. For canonical graph-connected brain pages, ask the agent to submit a
          reviewable wikilinked page proposal with <code>frege_write_page_proposal</code>.
        </p>
      </section>

      <section id="agent-instructions">
        <h2>Agent instructions</h2>
        <p>
          Give this to an agent that is installing Frege. It keeps day-to-day task activity in
          the session ledger while durable changes flow through review:
        </p>
        <pre><code>{`# Using the Frege company brain

- Confirm Node.js 20+ is installed.
- Install the Frege CLI:
  npm install -g @frege-dev/cli
- Make sure the shell can call frege directly: command -v frege.
- Run frege connect with the base URL and API key I provide.
  It verifies the key and auto-registers this client; show me the
  org, role, and key prefix it prints.
- To load approved markdown, run frege docs push for one file or
  frege docs sync frege.docs.yml for a manifest. Dry-run first if
  pushing a directory.
- Preserve wikilinks like [[hosted brain architecture]] in markdown.
- Before answering from memory, call frege_build_context so you
  start from scoped, cited company knowledge.
- Search with frege_search_pages; read specifics with
  frege_get_page. Cite the pages you used.
- Treat denied or hidden sources as out of scope. Do not guess
  around them.
- Start a session with frege_start_session for substantial work
  and record activity with frege_append_session_event.
- When you learn something durable and correct, do not edit pages
  directly. Submit it with frege_write_page_proposal so a human
  can review before it becomes canonical. Use wikilinks in durable
  page proposals when pages should be graph-connected.`}</code></pre>
      </section>

      <section id="tools">
        <h2>Available tools</h2>
        <p>
          The MCP server calls Frege-hosted APIs with the scoped API key. It never reads the
          database directly. Common tools:
        </p>
        <ul>
          {mcpTools.map(([name, desc]) => (
            <li key={name}><code>{name}</code>: {desc}</li>
          ))}
        </ul>
        <p className="docs__note">
          Every tool enforces the caller&apos;s permissions server-side. There is no path for an
          agent to reach knowledge outside its role and organization.
        </p>
      </section>

      <section id="troubleshooting">
        <h2>Troubleshooting</h2>
        <h3><code>frege: command not found</code></h3>
        <pre><code>{`npm install -g @frege-dev/cli

echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
command -v frege`}</code></pre>
        <h3>Node version error</h3>
        <pre><code>{`node --version`}</code></pre>
        <p>Install Node.js 20 or newer, then reinstall the CLI.</p>
        <h3><code>frege doctor</code> says the API key is missing or invalid</h3>
        <pre><code>{`frege connect https://frege.dev --token frg_live_...
frege doctor`}</code></pre>
        <p>
          If the org or role is wrong, create a new key in the control plane with the correct
          role, then reconnect.
        </p>
        <h3>The MCP client cannot find <code>frege</code></h3>
        <p>
          GUI-launched clients may not inherit your zsh path. Use the full path from{" "}
          <code>command -v frege</code> in that client&apos;s MCP config, or launch the client from a
          terminal after sourcing <code>~/.zshrc</code>.
        </p>
      </section>

      <section id="security">
        <h2>Security and install channels</h2>
        <ul>
          <li><code>~/.frege/mcp/config.json</code> is local secret state. Do not commit it.</li>
          <li>Rotate the API key in Frege admin if it appears in logs, chat, screenshots, or shell history.</li>
          <li>Prefer <code>frege connect</code> over embedding <code>FREGE_API_KEY</code> in MCP JSON.</li>
          <li>Admins can revoke keys from the control plane at any time.</li>
        </ul>
        <h3>npm now, Homebrew later</h3>
        <p>
          Frege supports npm first because the CLI is Node-based and exposes
          <code> frege</code> and <code>frege-mcp</code> binaries. Homebrew is a good later macOS
          convenience once releases, checksums, and a tap are stable.
        </p>
        <pre><code>{`npm install -g @frege-dev/cli
npm update -g @frege-dev/cli

# Planned: Homebrew tap
brew tap frege-dev/tap
brew install frege`}</code></pre>
      </section>
        </div>
      </div>
    </main>
  );
}
