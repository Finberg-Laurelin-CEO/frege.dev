import type { Metadata } from "next";
import SiteFooter from "../components/SiteFooter";

const githubUrl = "https://github.com/Finberg-Laurelin-CEO/frege.dev";

const toc: [string, string, string][] = [
  ["01", "overview", "Overview"],
  ["02", "product-shape", "Product shape"],
  ["03", "request-flow", "Request flow"],
  ["04", "identity", "Identity & control plane"],
  ["05", "brain", "Hosted brain"],
  ["06", "sessions", "Session ledger"],
  ["07", "proposals", "Memory proposals"],
  ["08", "context", "Context gateway"],
  ["09", "model-gateway", "Model gateway"],
  ["10", "telemetry", "Telemetry & audit"],
  ["11", "trust", "Trust & tenancy"],
  ["12", "mcp", "MCP surface"],
];

const REQUEST_FLOW_ART = `  Human admin                         Agent
     │                                  │
     │  /setup · /login · /admin        │  frege mcp serve
     │  session cookie                  │  bearer API key
     ▼                                  ▼
  ┌──────────────────┐            ┌──────────────────┐
  │  /api/v1/admin/* │            │   /api/v1/*      │
  └────────┬─────────┘            └────────┬─────────┘
           │                               │
           ▼                               ▼
  org · users · roles            brain · context gateway
  keys · models · proposals      model gateway · telemetry
`;

const RUNTIME_ART = `  Frege app (hosted control plane)
    -> creates run / session / context packet
    -> queues Frege Agent Runtime

  Frege Agent Runtime (GPU / large-RAM server)
    -> runs the agent loop
    -> calls Frege REST / MCP for governed memory
    -> calls a model router over an OpenAI-compatible API
    -> writes session events, telemetry, proposals

  Model router (same runtime network)
    -> vLLM, LiteLLM, managed GPU endpoint, or compatible bridge
    -> serves models behind /v1/chat/completions
`;

const subsystems: [string, string, string][] = [
  ["identity", "Identity & control plane", "Users, sessions, memberships, invites, roles, and per-user API keys. Org scope is always derived from the session or key, never from client input."],
  ["brain", "Hosted brain", "Institutional knowledge stored as versioned pages with sources, revisions, trust zones, tags, and extracted links. The database is canonical; markdown is the human and agent representation."],
  ["sessions", "Session ledger", "Durable per-task context: user and assistant messages, tool calls, tool results, context builds, model invocations, memory signals, and notes. Secrets are redacted before any write."],
  ["proposals", "Memory proposals", "Agents do not silently rewrite canonical knowledge. Durable updates land as reviewable proposals; an accepted page proposal creates a new brain revision and refreshes links."],
  ["context", "Context gateway", "Every answer starts from a governed context packet that resolves org, role, sensitivity labels, and trust zones, then returns only allowed chunks with citations and denied counts."],
  ["model-gateway", "Model gateway", "Pluggable, model-agnostic routing. Frege assembles context, enforces gates, routes to a configured provider, and records model telemetry. It does not require a model to live inside the app."],
  ["telemetry", "Telemetry & audit", "The observability spine: actor, route action, outcome, latency, provider, token counts, estimated cost, and trust zone, with a separate compliance audit trail."],
  ["trust", "Trust & tenancy", "Green and red trust zones gate context before any packet reaches an agent or model. Denied counts can be reported, but denied titles and bodies never leak."],
];

export const metadata: Metadata = {
  title: "Architecture — Frege",
  description:
    "How Frege works: a hosted SaaS control plane and brain database with a thin MCP/CLI client. Governed context, role-scoped access, reviewable memory, and full observability.",
  alternates: { canonical: "https://frege.dev/architecture" },
  openGraph: {
    title: "Architecture — Frege",
    description:
      "How Frege works: a hosted control plane and brain database with a thin MCP/CLI client, governed context, reviewable memory, and full observability.",
    url: "https://frege.dev/architecture",
  },
};

export default function ArchitecturePage() {
  return (
    <main id="main" className="docs docs--withSidebar">
      <header className="docs__head">
        <p className="eyebrow">Architecture</p>
        <h1>How Frege works.</h1>
        <p>
          Frege is a hosted SaaS control plane and brain database with a thin MCP/CLI
          client. Humans manage organizations, roles, keys, and review queues. Agents
          connect over MCP and only ever receive context allowed by their org, role, and
          trust zone. The database is canonical, and every read and write is governed.
        </p>
        <div className="hero__actions">
          <a className="button button--primary" href="/docs">Read the docs</a>
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
          links, and trust zones. Agents never read raw files or the database directly.
          Instead they request scoped context, and Frege resolves org, role, and source
          permissions before returning anything. The backend supports login and
          bootstrap, org management, per-user API keys, hosted brain pages, agent
          sessions, memory proposals, context builds, model routing, telemetry, and MCP
          access.
        </p>
        <p className="docs__note">
          Customers do not run the Frege database themselves. They connect agents to the
          hosted Frege API through the Frege CLI and MCP client.
        </p>
      </section>

      <section id="product-shape">
        <h2>Product shape</h2>
        <p>
          Frege is a hosted company brain for AI agents. The primary integration surface
          is MCP. REST APIs remain the internal implementation boundary used by MCP, the
          admin UI, and tests. Two kinds of caller reach the platform: human admins, who
          authenticate with a session cookie, and agents, which authenticate with a bearer
          API key.
        </p>
        <ul>
          <li><b>Control plane</b>: the hosted app, admin UI, REST APIs, and model-gateway orchestration.</li>
          <li><b>Brain database</b>: the canonical store of governed pages, sources, sessions, and proposals.</li>
          <li><b>Thin client</b>: the local <code>frege</code> CLI and MCP server, which only ever call REST APIs.</li>
        </ul>
      </section>

      <section id="request-flow">
        <h2>Request flow</h2>
        <p>
          Admins drive the control plane through the protected admin surface; agents reach
          governed memory through versioned APIs. Both paths resolve identity and org scope
          on the server before any data is returned.
        </p>
        <pre
          className="diagram"
          role="img"
          aria-label="Human admins reach /api/v1/admin/* with a session cookie to manage org, users, roles, keys, models, and proposals. Agents reach /api/v1/* with a bearer API key to reach the brain, context gateway, model gateway, and telemetry."
        >{REQUEST_FLOW_ART}</pre>
      </section>

      <section id="subsystems">
        <h2>Backend subsystems</h2>
        <p>
          Frege is composed of focused subsystems. Each one is org-scoped and governed by
          the same identity and trust rules.
        </p>
        <dl className="caps">
          {subsystems.map(([id, title, copy]) => (
            <div key={id} className="caps__row" id={id}>
              <dt>{title}</dt>
              <dd>{copy}</dd>
            </div>
          ))}
        </dl>
      </section>

      <hr className="rule" aria-hidden="true" />

      <section id="identity-detail">
        <h2>Identity &amp; control plane</h2>
        <p>
          Human users authenticate with password login and hashed sessions. Agents
          authenticate with bearer API keys only, and each key is owned by a human user.
          All org scoping comes from the user session or API key; a client-provided org is
          never trusted. Roles control document access, session access, memory proposals,
          source management, and audit access.
        </p>
      </section>

      <section id="brain-detail">
        <h2>Hosted brain</h2>
        <p>
          Brain pages are markdown-like records stored in Postgres. They include slugs,
          titles, trust zones, tags, frontmatter-style metadata, revision history, and
          extracted page links. The database is canonical. Markdown is the human and agent
          representation and the future export format, not the customer-facing storage
          system.
        </p>
      </section>

      <section id="sessions-detail">
        <h2>Session ledger</h2>
        <p>
          The session ledger stores durable task context for agents: user messages,
          assistant messages, tool calls, tool results, context builds, model invocations,
          memory signals, and notes. This is where task context belongs, kept separate from
          telemetry metadata. Hard secret protection runs before every ledger write,
          redacting obvious API keys, passwords, authorization headers, cookies, and
          provider tokens.
        </p>
      </section>

      <section id="proposals-detail">
        <h2>Memory proposals</h2>
        <p>
          Agents do not directly rewrite the canonical brain. They create proposals for
          page creation, page updates, and source creation. Admins review proposals in the
          console. Accepting a page proposal creates or updates a brain page, writes a new
          revision, and refreshes extracted links, so agent observations stay auditable
          before they become trusted org memory.
        </p>
      </section>

      <section id="context-detail">
        <h2>Context gateway</h2>
        <p>
          The context build endpoint returns a governed packet that combines documents,
          chunks, and hosted brain pages. Frege resolves the API key into organization,
          human key owner, role, allowed labels, trust zones, and capabilities, then filters
          by org, role permissions, sensitivity labels, and trust zone. It returns only
          allowed pages, documents, chunks, links, citations, token estimates, and denied
          counts. When a session is provided, the context build is linked into the session
          ledger.
        </p>
      </section>

      <section id="model-gateway-detail">
        <h2>Model gateway</h2>
        <p>
          Frege keeps model invocation pluggable. Its backend responsibility is to assemble
          governed context, enforce org and trust-zone gates, route to configured providers,
          record model telemetry, and optionally append model events to the session ledger.
          The default product assumption is model-agnostic orchestration: user agents and
          user-selected providers supply most of the reasoning power, while Frege supplies
          governed memory, prompt and context assembly, and observability.
        </p>
        <p>
          The hosted app is a control plane, not an inference host. When Frege needs to
          execute agents itself, a separate Frege Agent Runtime runs the agent loop and
          calls a model router over an OpenAI-compatible API. Red-zone context cannot route
          to providers that are not configured for red-zone work.
        </p>
        <pre
          className="diagram"
          role="img"
          aria-label="The hosted Frege app creates a run, session, and context packet, then queues a Frege Agent Runtime worker on a GPU or large-RAM server. The worker runs the agent loop, calls Frege for governed memory, calls a model router over an OpenAI-compatible API, and writes session events, telemetry, and proposals."
        >{RUNTIME_ART}</pre>
        <p className="docs__note">
          Supported providers include OpenAI-compatible hosted routing, Vercel AI Gateway,
          a self-hosted or user-hosted OpenAI-compatible router, and an optional Ollama
          development endpoint.
        </p>
      </section>

      <section id="telemetry-detail">
        <h2>Telemetry &amp; audit</h2>
        <p>
          Telemetry is the metrics and observability spine. It records actor, user or key,
          request, route action, outcome, latency, provider and model, token counts,
          estimated cost, trust zone, and redacted metadata, and links to sessions, session
          events, context builds, and proposals. Compliance history lives in a separate
          audit trail, while raw task memory stays in the brain and session ledger.
        </p>
      </section>

      <section id="trust-detail">
        <h2>Trust &amp; tenancy</h2>
        <p>
          Frege uses two trust zones. Green covers normal public and internal context; red
          covers restricted context. Public and internal sensitivities map to green;
          restricted maps to red.
        </p>
        <ul>
          <li>Every protected query filters by organization.</li>
          <li>Agents inherit org, owner user, role, labels, and capabilities from their API key.</li>
          <li>Humans inherit org access from their session membership.</li>
          <li>Agents without red-zone permission cannot receive red-zone pages, documents, session events, or context chunks.</li>
          <li>Denied counts can be reported, but denied titles and bodies do not leak.</li>
        </ul>
      </section>

      <section id="mcp">
        <h2>MCP surface</h2>
        <p>
          The Frege CLI and MCP server call REST APIs only; they never read the database
          directly. Agents use MCP tools to check status, search and read brain pages and
          documents, build governed context, manage sessions, propose memory, and run hosted
          agents. The recommended workflow is to start or attach to a session, append
          important events, search the brain, build governed context before answering, cite
          slugs and source IDs, and create proposals for durable updates.
        </p>
        <div className="hero__actions">
          <a className="button button--primary" href="/docs">Set up the CLI</a>
          <a className="button" href="/pricing">See pricing</a>
          <a className="button" href="/signup">Create account</a>
        </div>
      </section>
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}
