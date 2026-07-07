const githubUrl = "https://github.com/Finberg-Laurelin-CEO/frege.dev";

const FREGE_ART = `
███████╗ ██████╗  ███████╗  ██████╗  ███████╗
██╔════╝ ██╔══██╗ ██╔════╝ ██╔════╝  ██╔════╝
█████╗   ██████╔╝ █████╗   ██║  ███╗  █████╗
██╔══╝   ██╔══██╗ ██╔══╝   ██║   ██║  ██╔══╝
██║      ██║  ██║ ███████╗ ╚██████╔╝  ███████╗
╚═╝      ╚═╝  ╚═╝ ╚══════╝  ╚═════╝   ╚══════╝
`;

const PILOT_ART = `
  ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐
  │ │ │ │ │ │ │ │ │ │ │ │   self-serve setup
  └─┘ └─┘ └─┘ └─┘ └─┘ └─┘
`;

// Static terminal transcript — the "see it work" moment. CSS-only, no deps.
type Line = { kind: "prompt" | "out" | "ok" | "no" | "note" | "blank"; text: string };

const transcript: Line[] = [
  { kind: "prompt", text: "agent asks → get_context(\"refund policy for EU enterprise\")" },
  { kind: "out", text: "frege  resolving org · role · trust zone …" },
  { kind: "blank", text: "" },
  { kind: "ok", text: "ALLOWED  3 sources for role=support, zone=green" },
  { kind: "out", text: "  • Refund Policy v7        [billing/refunds.md#eu]" },
  { kind: "out", text: "  • EU Enterprise Addendum   [legal/contracts/eu.md]" },
  { kind: "out", text: "  • Escalation Runbook       [support/runbooks/refunds]" },
  { kind: "blank", text: "" },
  { kind: "no", text: "DENIED   2 sources out of zone (not returned, logged)" },
  { kind: "no", text: "  • Customer PII export      [zone=red]" },
  { kind: "no", text: "  • Unreleased pricing model  [zone=red]" },
  { kind: "blank", text: "" },
  { kind: "note", text: "agent proposes → memory: \"EU refunds need finance sign-off >$10k\"" },
  { kind: "out", text: "frege  queued as proposal #418 — pending human review" },
];

const workflow: [string, string][] = [
  ["Connect", "Issue a per-user API key and connect Claude Code, Codex, or an internal agent through MCP. No new client to install."],
  ["Build context", "Frege resolves org, role, and trust zone, then returns scoped context with citations — never the whole company."],
  ["Do work", "The agent uses its own model while Frege records what it read, what was denied, and what it cost."],
  ["Improve memory", "Useful discoveries land as reviewable proposals. A human accepts before the canonical brain changes."],
];

// Honest comparison: when CLAUDE.md is right, and where it breaks for a team.
const comparison: [string, string, string][] = [
  ["Shared across agents & people", "Each person copies their own file; it drifts", "One brain, versioned, same answer for everyone"],
  ["Who can see what", "Everything in the file is visible to everyone", "Role and trust-zone gates on every request"],
  ["Audit & cost", "No record of what an agent read", "Reads, denials, sessions, and cost logged per org"],
  ["Updating knowledge", "Anyone (or any agent) edits in place", "Agent writes land as proposals, accepted after review"],
  ["Sensitive sources", "All-or-nothing — paste it in or leave it out", "Restricted sources stay hidden, denial is logged"],
];

const outcomes: [string, string][] = [
  ["Stop re-pasting context", "No more dropping the same runbook into every session. Agents pull current, cited context on request."],
  ["Stop agents reading the wrong doc", "Scoped retrieval means an agent gets the source for its task — not a stale fork or a doc it shouldn't see."],
  ["Stop silent knowledge drift", "Durable memory updates are reviewed before they become canonical, so the brain stays trustworthy."],
];

export default function Home() {
  return (
    <main id="main" className="site">
      <section className="hero" aria-labelledby="hero-title">
        <pre className="hero__art" aria-hidden="true">{FREGE_ART}</pre>
        <p className="eyebrow">For platform &amp; AI teams running multiple agents</p>
        <h1 id="hero-title">
          Your agents share a company. <span className="dim">They should share a brain.</span>
        </h1>
        <p className="hero__copy">
          Once a team points several agents at shared company knowledge, ad-hoc{" "}
          <code className="inlineCode">CLAUDE.md</code> files drift, leak, and go stale. Frege is
          one governed memory layer: every agent gets scoped, cited context — with access control,
          audit, and reviewable writes built in.
        </p>
        <div className="hero__actions" aria-label="Primary actions">
          <a className="button button--primary" href="/signup">Start now</a>
          <a className="button" href="#demo">See it work</a>
        </div>
        <p className="hero__meta" aria-label="Product shape">
          <span><b>interface</b> mcp</span>
          <span><b>storage</b> hosted brain</span>
          <span><b>control</b> org, role &amp; trust zones</span>
        </p>
      </section>

      <hr className="rule" aria-hidden="true" />

      <section className="block" id="demo" aria-labelledby="demo-title">
        <div className="sectionHead">
          <p className="eyebrow">See it work</p>
          <h2 id="demo-title">One request: scoped context out, restricted sources held back.</h2>
          <p>
            A support agent asks for refund context. Frege checks who is asking, returns only what
            that role and trust zone allow — with citations — and turns a useful discovery into a
            proposal a human reviews.
          </p>
        </div>
        <div className="term" role="img" aria-label="An agent calls get_context for an EU enterprise refund policy. Frege resolves org, role, and trust zone, returns three allowed sources with citations, denies and logs two out-of-zone sources, and queues a memory proposal for human review.">
          <div className="term__bar" aria-hidden="true">
            <span className="term__dot" />
            <span className="term__dot" />
            <span className="term__dot" />
            <span className="term__title">agent@frege — mcp session</span>
          </div>
          <pre className="term__body">
{transcript.map((line, i) => (
  <span key={i} className={`tl tl--${line.kind}`}>{line.text || " "}{"\n"}</span>
))}
          </pre>
        </div>
        <p className="term__caption">
          Illustrative transcript. Sources, roles, and trust zones are configured in the Frege console.
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

      <section className="block" id="compare" aria-labelledby="compare-title">
        <div className="sectionHead">
          <p className="eyebrow">Why not just CLAUDE.md?</p>
          <h2 id="compare-title">CLAUDE.md is great for one person on one repo.</h2>
          <p>
            If that&apos;s you, use it — it&apos;s free and it works. Frege is for the next step:
            when several agents and people depend on the same knowledge, and not everyone should
            see everything.
          </p>
        </div>
        <div className="cmp" role="table" aria-label="CLAUDE.md compared with Frege">
          <div className="cmp__head" role="row">
            <span role="columnheader" />
            <span role="columnheader" className="cmp__col">Ad-hoc CLAUDE.md</span>
            <span role="columnheader" className="cmp__col cmp__col--us">Frege</span>
          </div>
          {comparison.map(([dim, claude, frege]) => (
            <div key={dim} className="cmp__row" role="row">
              <span className="cmp__dim" role="rowheader">{dim}</span>
              <span className="cmp__cell" role="cell">{claude}</span>
              <span className="cmp__cell cmp__cell--us" role="cell">{frege}</span>
            </div>
          ))}
        </div>
      </section>

      <hr className="rule" aria-hidden="true" />

      <section className="block" id="outcomes" aria-labelledby="outcomes-title">
        <div className="sectionHead">
          <p className="eyebrow">What changes for your team</p>
          <h2 id="outcomes-title">Less context babysitting. Fewer wrong answers.</h2>
        </div>
        <dl className="caps">
          {outcomes.map(([title, copy]) => (
            <div key={title} className="caps__row">
              <dt>{title}</dt>
              <dd>{copy}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="cta" id="start" aria-labelledby="start-title">
        <pre className="cta__art" aria-hidden="true">{PILOT_ART}</pre>
        <p className="eyebrow">Start today</p>
        <h2 id="start-title">Bring your agents. Frege brings the governed memory layer.</h2>
        <p>
          Create your account, choose a plan, and activate through Stripe checkout. Have a Frege
          code? Enter it in Stripe before you pay.
        </p>
        <div className="hero__actions">
          <a className="button button--primary" href="/signup">Create account</a>
          <a className="button" href="/pricing">See pricing</a>
          <a className="button" href="/architecture">How it&apos;s built</a>
        </div>
      </section>

      <footer className="foot">
        <div className="foot__top" aria-hidden="true" />
        <div className="foot__row">
          <span>Frege — agent memory, governed.</span>
          <span className="foot__links">
            <a href="/docs">docs</a>
            <a href="/architecture">architecture</a>
            <a href="/pricing">pricing</a>
            <a href="/contact">contact</a>
            <a href="/signup">sign up</a>
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
