const githubUrl = "https://github.com/Finberg-Laurelin-CEO/frege.dev";

const FREGE_ART = `
███████╗ ██████╗  ███████╗  ██████╗  ███████╗
██╔════╝ ██╔══██╗ ██╔════╝ ██╔════╝  ██╔════╝
█████╗   ██████╔╝ █████╗   ██║  ███╗  █████╗
██╔══╝   ██╔══██╗ ██╔══╝   ██║   ██║  ██╔══╝
██║      ██║  ██║ ███████╗ ╚██████╔╝  ███████╗
╚═╝      ╚═╝  ╚═╝ ╚══════╝  ╚═════╝   ╚══════╝
`;

const GOVERNANCE_ART = `   agent
     │
     │  asks for refund context
     ▼
  ┌─────────────────────────────┐
  │  f r e g e                  │
  │                             │
  │  check  org · role · zone   │
  │  resolve source permissions │
  └──────────────┬──────────────┘
       ┌─────────┴─────────┐
       ▼                   ▼
  «ALLOWED»            «DENIED»
  scoped chunks        restricted
  + citations          sources stay
  + trust metadata     hidden
`;

const PILOT_ART = `
  ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐
  │ │ │ │ │ │ │ │ │ │ │ │   founding pilot
  └─┘ └─┘ └─┘ └─┘ └─┘ └─┘
`;

const workflow: [string, string][] = [
  ["Connect", "Issue a per-user API key and connect Claude, Codex, Hermes, or an internal agent through MCP."],
  ["Build context", "Frege resolves org, role, trust zone, and source permissions before returning any context."],
  ["Do work", "The agent uses its own model or a configured runtime while Frege records the task ledger."],
  ["Improve memory", "Useful discoveries become reviewable proposals before they update the canonical brain."],
];

const capabilities: [string, string][] = [
  ["Governed memory", "Institutional knowledge stored as versioned pages, revisions, links, and sources."],
  ["MCP-native access", "Agents connect through Frege tools instead of reaching into folders or databases."],
  ["Context packets", "Every answer starts from scoped context with citations, denied counts, and trust-zone metadata."],
  ["Reviewable writes", "Agent memory updates land as proposals first, then accepted revisions after review."],
  ["Runtime routing", "Frege can queue hosted agent runs while execution happens through configured model endpoints."],
  ["Observability", "Track reads, denials, sessions, API keys, model usage, latency, and cost by org."],
];

const security: [string, string][] = [
  ["Tenancy", "Org is derived from the session or API key, never trusted client input."],
  ["Trust zones", "Green and red context are gated before any packet reaches an agent or model."],
  ["Secrets", "Session and proposal writes redact raw keys, passwords, cookies, and provider tokens."],
  ["Audit", "Reads, denials, context builds, model calls, and operator actions are all recorded."],
];

export default function Home() {
  return (
    <main id="main" className="site">
      <section className="hero" aria-labelledby="hero-title">
        <pre className="hero__art" aria-hidden="true">{FREGE_ART}</pre>
        <h1 id="hero-title">
          The company brain <span className="dim">for AI agents.</span>
        </h1>
        <p className="hero__copy">
          Frege gives every agent the institutional knowledge it needs without giving it
          access to everything. Runbooks, docs, tickets, and tribal knowledge become
          governed context that agents can safely use.
        </p>
        <div className="hero__actions" aria-label="Primary actions">
          <a className="button button--primary" href="/login?next=/admin">Sign in to Frege</a>
          <a className="button" href="/docs">Read the docs</a>
          <a className="button" href={githubUrl}>GitHub</a>
        </div>
        <div className="hero__actions hero__actions--secondary" aria-label="Pilot actions">
          <a className="button" href="/signup">Request pilot access</a>
          <a className="button" href="mailto:hello@frege.dev">Talk to us</a>
        </div>
        <p className="hero__meta" aria-label="Product shape">
          <span><b>interface</b> mcp</span>
          <span><b>storage</b> hosted brain</span>
          <span><b>control</b> org &amp; role gates</span>
        </p>
      </section>

      <hr className="rule" aria-hidden="true" />

      <section className="block" id="how" aria-labelledby="how-title">
        <div className="sectionHead">
          <p className="eyebrow">How it works</p>
          <h2 id="how-title">One controlled path from company knowledge to agent action.</h2>
        </div>
        <div className="workflow">
          {workflow.map(([title, copy]) => (
            <article key={title} className="step">
              <h3 className="step__id">{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <hr className="rule" aria-hidden="true" />

      <section className="block split" id="memory" aria-labelledby="memory-title">
        <div className="split__copy">
          <p className="eyebrow">Memory model</p>
          <h2 id="memory-title">Workflow context is not the same as canonical knowledge.</h2>
          <p>
            Frege keeps task activity in a session ledger, but agents do not silently
            rewrite the company brain. Durable updates are submitted as memory proposals
            and become canonical only after review.
          </p>
        </div>
        <pre className="diagram" role="img" aria-label="An agent requests refund context; Frege checks org, role, and trust zone, then returns allowed chunks with citations while restricted sources stay hidden.">{GOVERNANCE_ART}</pre>
      </section>

      <hr className="rule" aria-hidden="true" />

      <section className="block" aria-labelledby="capabilities-title">
        <div className="sectionHead">
          <p className="eyebrow">Control plane</p>
          <h2 id="capabilities-title">Built for teams that need agents to work safely.</h2>
        </div>
        <dl className="caps">
          {capabilities.map(([title, copy]) => (
            <div key={title} className="caps__row">
              <dt>{title}</dt>
              <dd>{copy}</dd>
            </div>
          ))}
        </dl>
      </section>

      <hr className="rule" aria-hidden="true" />

      <section className="block" id="security" aria-labelledby="security-title">
        <div className="sectionHead">
          <p className="eyebrow">Security</p>
          <h2 id="security-title">Agents get the right context, not the whole company.</h2>
        </div>
        <dl className="security">
          {security.map(([title, copy]) => (
            <div key={title} className="security__row">
              <dt>{title}</dt>
              <dd>{copy}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="cta" id="pilot" aria-labelledby="pilot-title">
        <pre className="cta__art" aria-hidden="true">{PILOT_ART}</pre>
        <p className="eyebrow">Founding pilot</p>
        <h2 id="pilot-title">Bring your agents. Frege brings the governed memory layer.</h2>
        <p>
          Frege is ready for hands-on pilot teams. The remaining work is onboarding each
          org: connecting sources, defining trust zones, and issuing first MCP keys.
        </p>
        <div className="hero__actions">
          <a className="button button--primary" href="/signup">Request pilot access</a>
          <a className="button" href="/login?next=/admin">Sign in</a>
          <a className="button" href={githubUrl}>GitHub</a>
        </div>
      </section>

      <footer className="foot">
        <div className="foot__top" aria-hidden="true" />
        <div className="foot__row">
          <span>Frege — agent memory, governed.</span>
          <span className="foot__links">
            <a href="/docs">docs</a>
            <a href="/signup">request access</a>
            <a href="/login?next=/admin">sign in</a>
            <a href={githubUrl}>github</a>
            <a href="mailto:hello@frege.dev">hello@frege.dev</a>
            <a href="/privacy">privacy</a>
            <a href="/terms">terms</a>
          </span>
        </div>
      </footer>
    </main>
  );
}
