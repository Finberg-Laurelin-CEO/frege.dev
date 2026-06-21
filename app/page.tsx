const capabilities = [
  ["Governed memory", "Store institutional knowledge as versioned pages, revisions, links, and sources."],
  ["MCP-native access", "Agents connect through Frege tools instead of reaching into folders or databases."],
  ["Context packets", "Every answer starts from scoped context with citations, denied counts, and trust-zone metadata."],
  ["Reviewable writes", "Agent memory updates become proposals first, then accepted revisions after review."],
  ["Runtime routing", "Frege can queue hosted agent runs while execution happens through configured model endpoints."],
  ["Observability", "Track reads, denials, sessions, API keys, model usage, latency, and cost by org."],
];

const workflow = [
  ["1", "Connect", "Issue a per-user API key and connect Claude, Codex, Hermes, or an internal agent through MCP."],
  ["2", "Build context", "Frege resolves org, role, trust zone, and source permissions before returning context."],
  ["3", "Do work", "The agent uses its own model or a configured runtime while Frege records the task ledger."],
  ["4", "Improve memory", "Useful discoveries become reviewable proposals before they update the canonical brain."],
];

const githubUrl = "https://github.com/Finberg-Laurelin-CEO/frege.dev";

export default function Home() {
  return (
    <main id="main" className="site">
      <section className="hero" aria-labelledby="hero-title">
        <p className="eyebrow">Frege</p>
        <h1 id="hero-title">The company brain for AI agents.</h1>
        <p className="hero__copy">
          Frege gives every agent the institutional knowledge it needs without giving it access to everything.
          It turns runbooks, docs, tickets, and tribal knowledge into governed context that agents can safely use.
        </p>
        <div className="hero__actions" aria-label="Primary actions">
          <a className="button button--primary" href="/login?next=/admin">Sign in to Frege</a>
          <a className="button" href="/docs">Read the docs</a>
          <a className="button" href={githubUrl} target="_blank" rel="noreferrer">GitHub</a>
        </div>
        <div className="hero__actions hero__actions--secondary" aria-label="Pilot actions">
          <a className="button" href="/signup">Claim a pilot seat</a>
          <a className="button" href="mailto:hello@frege.dev">Talk to us</a>
        </div>
        <dl className="hero__metrics" aria-label="Product shape">
          <div><dt>Interface</dt><dd>MCP</dd></div>
          <div><dt>Storage</dt><dd>Hosted brain</dd></div>
          <div><dt>Control</dt><dd>Org and role gates</dd></div>
        </dl>
      </section>

      <section className="band" id="how" aria-labelledby="how-title">
        <div className="sectionHead">
          <p className="eyebrow">How It Works</p>
          <h2 id="how-title">One controlled path from company knowledge to agent action.</h2>
        </div>
        <div className="workflow">
          {workflow.map(([number, title, copy]) => (
            <article key={number} className="step">
              <span>{number}</span>
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="split" id="memory" aria-labelledby="memory-title">
        <div>
          <p className="eyebrow">Memory Model</p>
          <h2 id="memory-title">Workflow context is not the same as canonical knowledge.</h2>
          <p>
            Frege keeps task activity in a session ledger, but agents do not silently rewrite the company brain.
            Durable updates are submitted as memory proposals and become canonical only after review.
          </p>
        </div>
        <div className="terminalPanel" aria-label="Context example">
          <p><span>agent</span> asks for refund context</p>
          <p><span>frege</span> checks org, role, trust zone</p>
          <p><span>frege</span> returns allowed chunks + citations</p>
          <p><span>denied</span> restricted sources stay hidden</p>
        </div>
      </section>

      <section className="band" aria-labelledby="capabilities-title">
        <div className="sectionHead">
          <p className="eyebrow">Control Plane</p>
          <h2 id="capabilities-title">Built for teams that need agents to work safely.</h2>
        </div>
        <div className="featureGrid">
          {capabilities.map(([title, copy]) => (
            <article key={title} className="feature">
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="split" id="security" aria-labelledby="security-title">
        <div>
          <p className="eyebrow">Security</p>
          <h2 id="security-title">Agents get the right context, not the whole company.</h2>
        </div>
        <dl className="securityList">
          <div><dt>Tenancy</dt><dd>Org is derived from the session or API key, not trusted client input.</dd></div>
          <div><dt>Trust zones</dt><dd>Green and red context are gated before any packet reaches an agent or model.</dd></div>
          <div><dt>Secrets</dt><dd>Session and proposal writes redact raw keys, passwords, cookies, and provider tokens.</dd></div>
          <div><dt>Audit</dt><dd>Reads, denials, context builds, model calls, and operator actions are recorded.</dd></div>
        </dl>
      </section>

      <section className="cta" id="pilot" aria-labelledby="pilot-title">
        <p className="eyebrow">Founding Pilot</p>
        <h2 id="pilot-title">Bring your agents. Frege brings the governed memory layer.</h2>
        <p>
          We are working with teams that already use agents and need a safer way to share institutional context.
        </p>
        <div className="hero__actions">
          <a className="button button--primary" href="/signup">Claim your pilot seat</a>
          <a className="button" href="/login?next=/admin">Sign in</a>
          <a className="button" href={githubUrl} target="_blank" rel="noreferrer">GitHub</a>
        </div>
      </section>
    </main>
  );
}
