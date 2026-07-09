import type { Metadata } from "next";
import SiteFooter from "../components/SiteFooter";

const githubUrl = "https://github.com/Finberg-Laurelin-CEO/frege.dev";

const toc: [string, string, string][] = [
  ["01", "overview", "Fast path"],
  ["02", "org-setup", "Who does what"],
  ["03", "api-keys", "API keys"],
  ["04", "agent-install", "Agent install"],
  ["05", "cli-install", "CLI install"],
  ["06", "zsh-path", "Path fixes"],
  ["07", "mcp-register", "Register MCP"],
  ["08", "docs-push", "Push documents"],
  ["09", "agent-instructions", "Agent rules"],
  ["10", "tools", "MCP tools"],
  ["11", "troubleshooting", "Troubleshooting"],
  ["12", "security", "Security"],
];

const quickFacts: [string, string, string][] = [
  ["Human app", "https://brain.frege.dev", "Where users sign in, manage orgs, billing, roles, API keys, and memory review."],
  ["API base", "https://frege.dev", "What the CLI and MCP server call for /api/v1 routes unless Frege support gives another base."],
  ["CLI package", "@frege-dev/cli", "Public npm package that installs the frege and frege-mcp commands."],
  ["MCP command", "frege mcp serve", "Local stdio server used by Codex, Claude Code, and other MCP clients."],
];

const fastPath: [string, string, string][] = [
  ["1", "Create the account", "The user signs up, activates billing through Stripe, then opens the Frege control plane."],
  ["2", "Create an API key", "An admin creates a scoped key for an active org and a specific role. The raw key is shown once."],
  ["3", "Hand setup to an agent", "Give the agent the prompt below plus the key through a private channel. The agent installs the CLI and verifies the key."],
  ["4", "Use Frege from MCP", "The MCP client calls frege_status first, then searches, reads, builds context, and pushes approved docs."],
];

const responsibilityRows: [string, string, string][] = [
  ["User/admin", "Create account, choose plan, create roles, generate keys, review memory proposals.", "Browser app"],
  ["Local agent", "Install @frege-dev/cli, run frege connect, register frege mcp serve, push approved markdown.", "Terminal"],
  ["Frege", "Validate the key, enforce org and role scope, audit reads and writes, reject inactive orgs.", "Hosted API"],
];

const mcpTools: [string, string][] = [
  ["frege_status", "Confirm org, role, key prefix, and connectivity."],
  ["frege_brain_status", "Inspect hosted brain status, indexed pages, and source counts."],
  ["frege_search_pages", "Search brain pages the caller is allowed to see."],
  ["frege_get_page", "Read a specific page and its revisions."],
  ["frege_build_context", "Assemble scoped, cited context for a task before answering."],
  ["frege_create_document", "Create a document from user-approved markdown."],
  ["frege_read_document", "Read a visible document by slug."],
  ["frege_search_documents", "Search visible documents by text, title, path, or tag."],
  ["frege_write_page_proposal", "Submit a reviewable update instead of editing canonical knowledge."],
  ["frege_start_session", "Open a session ledger for a substantial workflow."],
  ["frege_append_session_event", "Record task activity onto the active session."],
  ["frege_list_agents", "List Frege-hosted agents available to this org and role."],
  ["frege_run_agent", "Queue hosted agent work when the key has execution permission."],
  ["frege_get_agent_run", "Read status and output for a hosted agent run."],
];

const agentInstallPrompt = `Install Frege MCP for this machine.

Inputs:
- API base: https://frege.dev
- I will provide FREGE_API_KEY separately. It starts with frg_live_.

Important:
- The browser app may open on https://brain.frege.dev. That is fine.
- MCP uses the API base above for /api/v1 calls.
- You may install the CLI without a key.
- Do not treat MCP as ready until frege connect and frege doctor both succeed.
- Do not print the full key or put it in MCP JSON, docs, screenshots, shell startup files, or chat summaries.

Steps:
1. Confirm Node.js 20+ and npm are available.
2. Run: npm install -g @frege-dev/cli
3. Verify: command -v frege && frege help
4. If npm reports EEXIST or frege is not found, use https://frege.dev/docs troubleshooting.
5. Connect with the key I provide:
   frege connect https://frege.dev --token "$FREGE_API_KEY"
6. Run: frege doctor
7. Show me only org, orgStatus, role, and key prefix.
8. If connect or doctor fails, stop and ask for a valid key from an active org.
9. Register MCP:
   frege agent install codex
   frege agent install claude
   If neither is available, configure command "frege" with args ["mcp", "serve"].
10. From the MCP client, call frege_status and confirm it matches frege doctor.`;

export const metadata: Metadata = {
  title: "Docs — Frege",
  description:
    "Setup documentation for Frege orgs, API keys, MCP clients, CLI installation, and governed agent memory.",
  alternates: { canonical: "https://frege.dev/docs" },
  openGraph: {
    title: "Docs — Frege",
    description:
      "Setup documentation for Frege orgs, API keys, MCP clients, CLI installation, and governed agent memory.",
    url: "https://frege.dev/docs",
  },
};

export default function DocsPage() {
  return (
    <main id="main" className="docs docs--withSidebar docs--install">
      <header className="docs__head docs__head--install">
        <div>
          <p className="eyebrow">Documentation</p>
          <h1>Set up Frege for agents.</h1>
          <p className="docs__lead">
            Frege is hosted. Users manage the browser app; agents install a small local CLI.
            The only MCP server customers run is <code>frege mcp serve</code>, and it only
            calls Frege APIs with a verified key.
          </p>
          <div className="hero__actions">
            <a className="button button--primary" href="/signup">Start now</a>
            <a className="button" href="/login?next=/console">Open control plane</a>
            <a className="button" href="/architecture">Architecture</a>
            <a className="button" href={githubUrl}>GitHub</a>
          </div>
        </div>

        <dl className="docs__facts" aria-label="Frege install facts">
          {quickFacts.map(([label, value, copy]) => (
            <div key={label} className="docs__fact">
              <dt>{label}</dt>
              <dd>
                <code>{value}</code>
                <span>{copy}</span>
              </dd>
            </div>
          ))}
        </dl>
      </header>

      <div className="docs__layout">
        <nav className="docs__sidebar" aria-label="Contents">
          {toc.map(([n, id, label]) => (
            <a key={id} href={`#${id}`} data-n={n}>{label}</a>
          ))}
        </nav>

        <div className="docs__main">
          <section id="overview" className="docs__sectionTop">
            <h2>Fast path</h2>
            <p>
              The simplest successful setup is: create an account, create a valid API key,
              give the agent the install prompt, then verify MCP with <code>frege_status</code>.
              No one should hand-edit secrets into MCP JSON.
            </p>

            <div className="docs__path" aria-label="Frege install path">
              {fastPath.map(([n, title, copy]) => (
                <article key={title} className="docs__pathItem">
                  <span>{n}</span>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </article>
              ))}
            </div>

            <p className="docs__note">
              The CLI can install without an API key, but Frege is not connected until
              <code> frege connect</code> verifies a valid key from an active org.
            </p>
          </section>

          <section id="org-setup">
            <h2>Who does what</h2>
            <p>
              Installation is clearer when the browser work and terminal work are kept
              separate. The user owns billing, org setup, and keys. The agent owns local CLI
              setup after the user provides a key.
            </p>
            <div className="docs__matrix">
              {responsibilityRows.map(([role, work, surface]) => (
                <div key={role} className="docs__matrixRow">
                  <strong>{role}</strong>
                  <span>{work}</span>
                  <code>{surface}</code>
                </div>
              ))}
            </div>
            <p>
              Admins use the protected <a className="lnk" href="/login?next=/console">control plane</a>{" "}
              to create organizations, invite members, define roles, generate API keys,
              inspect sessions, and review memory proposals.
            </p>
          </section>

          <section id="api-keys">
            <h2>API keys</h2>
            <p>
              Every agent connects with a per-identity API key issued from the control plane.
              Keys inherit the role of the user they belong to, so an agent sees exactly what
              that role is allowed to see.
            </p>
            <ol className="docs__checklist">
              <li>Open <a className="lnk" href="/login?next=/console">the control plane</a>.</li>
              <li>Choose the organization.</li>
              <li>Create or select an agent role.</li>
              <li>Create an API key for that role and owner.</li>
              <li>Copy the raw <code>frg_live_...</code> key immediately. It is shown once.</li>
            </ol>
            <p className="docs__note">
              The org must be active, the key must be unrevoked, and <code>frege connect</code>
              must verify it before MCP tools can read or write Frege context.
            </p>
          </section>

          <section id="agent-install">
            <h2>Install with an agent</h2>
            <p>
              This is the recommended customer workflow. Paste the prompt into Codex, Claude
              Code, or another local coding agent. Provide the API key separately and tell the
              agent not to echo it.
            </p>
            <div className="docs__codeShell">
              <div className="docs__codeHead">
                <span>copy into agent</span>
                <code>Frege MCP install prompt</code>
              </div>
              <pre><code>{agentInstallPrompt}</code></pre>
            </div>
            <p className="docs__note">
              Browser traffic may land on <code>brain.frege.dev</code>. MCP does not depend on
              that subdomain. It uses <code>https://frege.dev</code> for <code>/api/v1</code> calls
              unless Frege support gives a customer-specific API base.
            </p>
          </section>

          <section id="cli-install">
            <h2>Install the CLI</h2>
            <p>
              If you are doing the setup yourself instead of through an agent, install the
              public npm package and verify the command is on your path.
            </p>
            <div className="docs__twoCol">
              <div className="docs__panel">
                <h3>Install</h3>
                <pre><code>{`npm install -g @frege-dev/cli
command -v frege
frege help`}</code></pre>
              </div>
              <div className="docs__panel">
                <h3>Connect</h3>
                <pre><code>{`frege connect https://frege.dev --token <valid-frg-live-key>
frege doctor`}</code></pre>
              </div>
            </div>
            <p>
              <code>frege connect</code> verifies the key, saves local config at
              <code> ~/.frege/mcp/config.json</code>, prints org status, and tries to register
              MCP clients it can detect.
            </p>
          </section>

          <section id="zsh-path">
            <h2>Path fixes</h2>
            <p>
              If zsh says <code>frege: command not found</code>, add npm&apos;s global bin
              directory to your shell path.
            </p>
            <pre><code>{`npm config get prefix

echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
hash -r

command -v frege
frege help`}</code></pre>
            <p>
              GUI-launched MCP clients may still miss your shell path. In that case, use the
              full path from <code>command -v frege</code> as the MCP command.
            </p>
          </section>

          <section id="mcp-register">
            <h2>Register MCP</h2>
            <p>
              Usually <code>frege connect</code> handles this for you. If a client was not
              detected, register it explicitly after <code>frege doctor</code> succeeds.
            </p>
            <div className="docs__twoCol">
              <div className="docs__panel">
                <h3>Preferred</h3>
                <pre><code>{`frege agent install codex
frege agent install claude`}</code></pre>
              </div>
              <div className="docs__panel">
                <h3>Generic MCP JSON</h3>
                <pre><code>{`{
  "mcpServers": {
    "frege": {
      "command": "frege",
      "args": ["mcp", "serve"]
    }
  }
}`}</code></pre>
              </div>
            </div>
            <p className="docs__note">
              The API key belongs in <code>~/.frege/mcp/config.json</code>, not MCP client JSON.
              If <code>frege_status</code> does not match <code>frege doctor</code>, the setup is
              not complete.
            </p>
          </section>

          <section id="docs-push">
            <h2>Push markdown documents</h2>
            <p>
              Agents should load user-approved markdown through the CLI. The terminal shows
              exactly what was pushed, and Frege records the write through the same org, role,
              and audit controls as MCP.
            </p>
            <div className="docs__codeShell">
              <div className="docs__codeHead">
                <span>demo workflow</span>
                <code>push docs into Frege</code>
              </div>
              <pre><code>{`# One file
frege docs push docs/INVESTOR_DEMO_WORKFLOW.md \\
  --sensitivity internal \\
  --tag frege-demo \\
  --tag operations

# Preview a directory before writing
frege docs push docs \\
  --include "**/*.md" \\
  --exclude "**/HANDOFF.md" \\
  --sensitivity internal \\
  --dry-run

# Repeatable manifest sync
frege docs sync frege.docs.yml --dry-run
frege docs sync frege.docs.yml
frege docs list
frege context "how does Frege signup work?"`}</code></pre>
            </div>
            <p className="docs__note">
              Markdown wikilinks such as <code>[[hosted brain architecture]]</code> are
              preserved. For canonical graph-connected brain pages, ask the agent to submit a
              reviewable wikilinked page proposal with <code>frege_write_page_proposal</code>.
            </p>
          </section>

          <section id="agent-instructions">
            <h2>Agent rules</h2>
            <p>
              Give these rules to an agent after Frege is connected. They keep day-to-day task
              activity in sessions while durable knowledge changes go through review.
            </p>
            <ul className="docs__rules">
              <li>Before answering from company memory, call <code>frege_build_context</code>.</li>
              <li>Search with <code>frege_search_pages</code> and read specifics with <code>frege_get_page</code>.</li>
              <li>Cite document or page slugs when using Frege context.</li>
              <li>Start a session for substantial work and append important events.</li>
              <li>Preserve wikilinks like <code>[[self-serve signup]]</code> in approved markdown.</li>
              <li>Submit durable changes with <code>frege_write_page_proposal</code>; do not silently rewrite canonical memory.</li>
              <li>If Frege reports denied context, do not guess around it.</li>
            </ul>
          </section>

          <section id="tools">
            <h2>MCP tools</h2>
            <p>
              The MCP server calls Frege-hosted APIs with the scoped API key. It never reads
              the database directly.
            </p>
            <div className="docs__toolGrid">
              {mcpTools.map(([name, desc]) => (
                <div key={name} className="docs__tool">
                  <code>{name}</code>
                  <span>{desc}</span>
                </div>
              ))}
            </div>
          </section>

          <section id="troubleshooting">
            <h2>Troubleshooting</h2>
            <div className="docs__twoCol">
              <div className="docs__panel">
                <h3><code>EEXIST</code> during npm install</h3>
                <pre><code>{`npm uninstall -g @frege/cli @frege-dev/cli
rm -f ~/.local/bin/frege ~/.local/bin/frege-mcp
npm install -g @frege-dev/cli`}</code></pre>
              </div>
              <div className="docs__panel">
                <h3>Invalid key</h3>
                <pre><code>{`frege connect https://frege.dev --token <valid-frg-live-key>
frege doctor`}</code></pre>
              </div>
            </div>
            <p>
              If <code>frege doctor</code> fails, the key may be invalid, revoked, expired, or
              attached to an inactive org. Create a new key in the control plane with the
              correct role, then reconnect. If Node is too old, install Node.js 20 or newer.
            </p>
          </section>

          <section id="security">
            <h2>Security</h2>
            <ul className="docs__rules">
              <li><code>~/.frege/mcp/config.json</code> is local secret state. Do not commit it.</li>
              <li>Prefer <code>frege connect</code> over storing <code>FREGE_API_KEY</code> in MCP JSON.</li>
              <li>Rotate the API key in Frege admin if it appears in logs, shell history, screenshots, chat, or committed files.</li>
              <li>Admins can revoke keys from the control plane at any time.</li>
              <li>Use npm now. Homebrew can come later when release tarballs, checksums, and a tap are stable.</li>
            </ul>
          </section>
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}
