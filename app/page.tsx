export default function Home() {
  return (
    <>
      <a className="skip" href="#main">skip to content</a>

      {/* top status line, edge to edge */}
      <header className="bar" role="banner">
        <span className="bar__dots" aria-hidden="true">● ● ●</span>
        <span className="bar__title">frege — ssh agent@frege.dev</span>
        <a className="lnk" href="/signup">claim pilot seat →</a>
      </header>

      <main id="main" className="screen">

        {/* ── link index (top) ── */}
        <nav className="links links--top" aria-label="Links">
          <a className="lnk" data-nav href="/signup">claim pilot seat</a>
          <a className="lnk" data-nav href="#status">status</a>
          <a className="lnk" data-nav href="#how">how it works</a>
          <a className="lnk" data-nav href="#memory">memory</a>
          <a className="lnk" data-nav href="#applications">applications</a>
          <a className="lnk" data-nav href="#privacy">privacy</a>
          <a className="lnk" data-nav href="#soc2">soc 2</a>
          <a className="lnk" data-nav href="mailto:hello@frege.dev">hello@frege.dev</a>
        </nav>
        <p className="hint hint--top">press a <b>number</b> to follow a link · <b>g</b> top · <b>G</b> bottom</p>

        <hr className="rule" />

        {/* ── whoami / hero ── */}
        <section aria-label="Overview">
          <p className="line"><span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <span className="cmd">whoami</span></p>
          <h1 className="hero-h">
            <span className="sr-only">FREGE</span>
            <span className="hero-word" aria-hidden="true">FREGE</span>
            <span className="hero-ansi" aria-hidden="true">{`███████╗██████╗ ███████╗ ██████╗ ███████╗
██╔════╝██╔══██╗██╔════╝██╔════╝ ██╔════╝
█████╗  ██████╔╝█████╗  ██║  ███╗█████╗  
██╔══╝  ██╔══██╗██╔══╝  ██║   ██║██╔══╝  
██║     ██║  ██║███████╗╚██████╔╝███████╗
╚═╝     ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚══════╝`}</span>
          </h1>
          <p className="hero-tag">the company brain for AI agents.</p>
          <p className="out wrap">Give every agent the institutional knowledge it needs — without giving it access to everything. Frege turns scattered documents, runbooks, tickets, and tribal knowledge into a permission-aware memory layer for Codex, Claude Code, MCP clients, and internal agents.</p>

          <p className="line"><span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <a className="lnk" href="/signup">claim your pilot seat</a><span className="cursor" aria-hidden="true">█</span></p>
        </section>

        <hr className="rule" />

        {/* ── proof / status ── */}
        <section id="status" aria-label="Status and proof">
          <p className="line"><span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <span className="cmd">frege status --pilot</span></p>
          <dl className="rows">
            <div><dt>status</dt><dd>founding pilots opening now. bring your existing runbooks, docs, and agent workflows.</dd></div>
            <div><dt>works with</dt><dd>Codex, Claude Code, internal agents, and any MCP client.</dd></div>
            <div><dt>setup</dt><dd>pilot target: under 30 minutes from existing markdown or docs to first agent-readable skill.</dd></div>
            <div><dt>deployment</dt><dd>hosted or self-hosted private backend, with exportable markdown and backups.</dd></div>
            <div><dt>demo</dt><dd>pilot walkthroughs available for teams already using agents in production workflows.</dd></div>
          </dl>
        </section>

        <hr className="rule" />

        {/* ── the problem ── */}
        <section aria-label="The problem">
          <p className="line"><span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <span className="cmd">cat problem.txt</span></p>
          <p className="out wrap cmt"># most teams already have the knowledge. agents just need a safe way to use it.</p>
          <ul className="bul">
            <li>"our runbooks, tickets, and docs are scattered everywhere."</li>
            <li>"we don't know what our agents are reading."</li>
            <li>"we want agents to help without giving them the whole company."</li>
          </ul>
        </section>

        <hr className="rule" />

        {/* ── thesis ── */}
        <section aria-label="Thesis">
          <p className="line"><span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <span className="cmd">cat thesis.txt</span></p>
          <p className="out wrap cmt"># AI agents are only as useful as the company knowledge they can safely reach.</p>
          <p className="out wrap">Companies already have the raw material: docs, runbooks, support history, Slack threads, tickets, and the judgment people use every day. Frege turns that fragmented knowledge into a durable company brain — structured, kept current, and exposed as executable skills for AI.</p>
          <p className="out wrap">Search and chatbots help humans find information. Frege helps agents apply it safely: how refunds get handled, how pricing exceptions are decided, how engineers respond to incidents, and what each agent is allowed to know while doing the work.</p>
          <p className="say">frege is the missing layer between raw company data and reliable AI automation.</p>
        </section>

        <hr className="rule" />

        {/* ── what we are building ── */}
        <section aria-label="What we are building">
          <p className="line"><span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <span className="cmd">frege --help</span></p>
          <p className="out wrap">frege is a living map of how your company actually works — refunds, pricing exceptions, incident response, deploys — turned into an executable skills file every agent can read.</p>
          <dl className="rows">
            <div><dt>brain</dt><dd>one structured map of how your company actually runs</dd></div>
            <div><dt>skills</dt><dd>institutional knowledge compiled into an executable skills file for agents</dd></div>
            <div><dt>versions</dt><dd>versioned markdown with a real audit trail</dd></div>
            <div><dt>access</dt><dd>role-based control over what each agent can read or write</dd></div>
            <div><dt>mcp</dt><dd>MCP-native and model agnostic — the same brain for every stack</dd></div>
            <div><dt>usage</dt><dd>audit logs, usage, and estimated cost by user, key, and org</dd></div>
          </dl>
        </section>

        <hr className="rule" />

        {/* ── who it is for ── */}
        <section aria-label="Who it is for">
          <p className="line"><span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <span className="cmd">frege whois</span></p>
          <dl className="rows">
            <div><dt>founders</dt><dd>every agent on the same trusted knowledge, without exposing everything</dd></div>
            <div><dt>CTOs</dt><dd>one controlled place agents read from, not a folder per harness</dd></div>
            <div><dt>platform leads</dt><dd>a memory layer that works across Codex, Claude Code, and internal agents</dd></div>
            <div><dt>security leads</dt><dd>access control and a clean audit trail over what an agent did</dd></div>
          </dl>
        </section>

        <hr className="rule" />

        {/* ── how it works ── */}
        <section id="how" aria-label="How it works">
          <p className="line"><span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <span className="cmd">frege pipeline --explain</span></p>
          <dl className="rows steps">
            <div><dt>[1] store</dt><dd>bring your markdown. it becomes versioned company knowledge.</dd></div>
            <div><dt>[2] govern</dt><dd>define orgs, roles, and API keys. RBAC decides who reads or writes.</dd></div>
            <div><dt>[3] connect</dt><dd>agents reach approved context through MCP tools, across any stack.</dd></div>
            <div><dt>[4] audit</dt><dd>every access is logged. review usage and cost by user, key, and org.</dd></div>
          </dl>
        </section>

        <hr className="rule" />

        {/* ── access demo ── */}
        <section aria-label="Access example">
          <p className="line"><span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <span className="cmd">frege read --as claude-code@platform</span></p>
          <dl className="rows acl">
            <div><dt>read /eng/runbooks/deploy.md</dt><dd className="ok">[granted]</dd></div>
            <div><dt>read /eng/architecture/v3.md</dt><dd className="ok">[granted]</dd></div>
            <div><dt>read /hr/compensation.md</dt><dd className="no">[denied: role]</dd></div>
            <div><dt>edit /eng/runbooks/deploy.md</dt><dd className="ok">[proposed: v14]</dd></div>
          </dl>
        </section>

        <hr className="rule" />

        {/* ── skill storage + persistent memory ── */}
        <section id="memory" aria-label="Skill storage and persistent memory">
          <p className="line"><span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <span className="cmd">frege memory --explain</span></p>
          <p className="out wrap cmt"># your company brain is a store, not a prompt. it outlives any single model, any single agent, any single chat.</p>
          <p className="out wrap">Models churn. Vendors come and go. Your institutional knowledge shouldn't. Frege keeps your company's skills and memory in one durable store you own — not buried inside a vendor's chat history, not pinned to one provider's context window. The same brain serves Codex today, the next frontier model tomorrow, and whatever internal agent you build next.</p>
          <dl className="rows">
            <div><dt>skills</dt><dd>structured, executable knowledge units — how a refund gets handled, how a deploy gets rolled back, how an incident is triaged — that any agent can load and run</dd></div>
            <div><dt>persistent memory</dt><dd>facts, decisions, and context that survive the chat session, the model swap, and the vendor change. your brain, not theirs.</dd></div>
            <div><dt>model agnostic</dt><dd>same MCP surface for Codex, Claude Code, OpenRouter, local models, internal agents. swap the model without rebuilding the memory.</dd></div>
            <div><dt>private backend</dt><dd>self-host on your infrastructure, or run hosted in an isolated tenant. either way the data stays yours and the keys stay yours.</dd></div>
            <div><dt>backups</dt><dd>point-in-time snapshots, export to plain markdown, no lock-in. if you ever leave, you leave with everything readable.</dd></div>
          </dl>
        </section>

        <hr className="rule" />

        {/* ── applications ── */}
        <section id="applications" aria-label="Applications">
          <p className="line"><span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <span className="cmd">frege applications --list</span></p>
          <p className="out wrap cmt"># the company brain is a primitive. anywhere humans hold knowledge that agents shouldn't see in full, frege fits.</p>
          <dl className="rows steps">
            <div>
              <dt>[1] engineering teams</dt>
              <dd>runbooks, architecture decisions, on-call playbooks, deploy procedures. Codex and Claude Code read the right context for the task; an intern agent never sees prod credentials or compensation docs. one audit trail per repo, per agent, per key.</dd>
            </div>
            <div>
              <dt>[2] therapy &amp; clinical practices</dt>
              <dd>per-client intake notes, treatment plans, session summaries. a scheduling agent reads the calendar but never the chart. a billing agent reads CPT codes but never the narrative. clinician-grade audit trail, HIPAA-shaped access control, BAA-ready hosting on request.</dd>
            </div>
            <div>
              <dt>[3] property &amp; house managers</dt>
              <dd>per-unit history, vendor contacts, lease terms, owner preferences. a tenant-facing agent answers from the unit's playbook and nothing else; an owner-facing agent sees financials a tenant agent never can. one brain across units, scoped per relationship.</dd>
            </div>
            <div>
              <dt>[4] HIPAA / privacy-sensitive SMBs</dt>
              <dd>law firms, dental groups, specialty clinics, financial advisors — anywhere agents need real domain knowledge but seeing everything is a liability. role-based access, encryption at rest and in transit, audit logs by user and key, deployable on infrastructure you control.</dd>
            </div>
          </dl>
          <p className="out wrap">Same primitive, different brain. The contract is always the same: one durable, permission-aware store of how your organization actually works — and a clean record of every agent that ever touched it.</p>
        </section>

        <hr className="rule" />

        {/* ── why now ── */}
        <section aria-label="Why now">
          <p className="line"><span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <span className="cmd">cat why-now.txt</span></p>
          <p className="say">agent adoption is outpacing the company brain.</p>
          <p className="out wrap">companies are adopting agents faster than they are standardizing the knowledge those agents need. every team rebuilds the same internal infrastructure — a markdown folder for one harness, a different setup for the next, ad hoc rules about what an agent can read, and no shared audit trail for who or what touched institutional context.</p>
          <p className="out wrap">the issue is not that markdown files are hard. it is that institutional context becomes unsafe, fragmented, and expensive to maintain when every team invents its own agent-readable knowledge layer. the job now is one controlled place to read, write, version, and audit institutional knowledge — before the next agent gets there first.</p>
        </section>

        <hr className="rule" />

        {/* ── pilot CTA ── */}
        <section aria-label="Join the pilot">
          <p className="line"><span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <span className="cmd">frege pilot --join</span></p>
          <p className="out wrap">We are taking a limited founding pilot. Founding pilots help shape the roadmap, get hands-on onboarding from the team, and lock in early pricing before general availability. Bring your agents; we'll bring the memory layer.</p>
          <p className="line cta-big"><span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <a className="lnk strong" href="/signup">claim your founding pilot seat →</a></p>
          <p className="out muted">seats are limited · no credit card · 2-minute form</p>
        </section>

        <hr className="rule" />

        {/* ── privacy policy (inline, single page) ── */}
        <section id="privacy" aria-label="Privacy policy">
          <p className="line"><span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <span className="cmd">cat privacy-policy.txt</span></p>
          <p className="out wrap cmt"># frege privacy policy · last updated 2026-06-07. plain language, no dark patterns.</p>
          <dl className="rows policy">
            <div><dt>what we collect</dt><dd>only what you type into the early-access form: name, work email, company, role, company size, expected users, current agent tools, monthly AI spend, what you'd expect to pay, decision timeline, your main pain point, and any optional comments. nothing else.</dd></div>
            <div><dt>what we never collect</dt><dd>we do not ask for, store, or transmit your company documents, source code, customer data, or API keys through this site. there is no tracking pixel, no third-party analytics, and no advertising cookie on this page.</dd></div>
            <div><dt>why we collect it</dt><dd>to evaluate early demand, gauge fit for a pilot, and reach out about early access. that is the only purpose.</dd></div>
            <div><dt>how it is stored</dt><dd>submissions are written to a private Postgres database with access limited to the Frege founding team. data is encrypted in transit (TLS) and at rest.</dd></div>
            <div><dt>sharing</dt><dd>we do not sell your data and do not share it with advertisers. limited processors (database host, email) act on our instructions under contract.</dd></div>
            <div><dt>retention</dt><dd>we keep early-access submissions until the validation phase ends, then delete or anonymize records we no longer need.</dd></div>
            <div><dt>your rights</dt><dd>email <a className="lnk" href="mailto:hello@frege.dev">hello@frege.dev</a> any time to access, correct, or delete your data, or to opt out of contact. we will action it.</dd></div>
            <div><dt>contact</dt><dd><a className="lnk" href="mailto:hello@frege.dev">hello@frege.dev</a></dd></div>
          </dl>
        </section>

        <hr className="rule" />

        {/* ── soc 2 compliance statement (inline) ── */}
        <section id="soc2" aria-label="SOC 2 compliance">
          <p className="line"><span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <span className="cmd">frege compliance --status</span></p>
          <p className="out wrap cmt"># security and compliance posture · validation stage.</p>
          <dl className="rows policy">
            <div><dt>soc 2</dt><dd>Frege is pre-certification. SOC 2 Type II is on our roadmap and we are building the product to SOC 2 control objectives — access control, encryption, audit logging, and change management — from day one. We will pursue a formal Type II audit before general availability.</dd></div>
            <div><dt>today</dt><dd>data in transit is encrypted with TLS; data at rest is encrypted; access to early-access submissions is restricted to the founding team and logged.</dd></div>
            <div><dt>by GA</dt><dd>SOC 2 Type II report, role-based access control, full tenant isolation, and per-org audit trails. permission-aware access and audit logging are core product features, not afterthoughts.</dd></div>
            <div><dt>questions</dt><dd>security or compliance diligence: <a className="lnk" href="mailto:hello@frege.dev">hello@frege.dev</a></dd></div>
          </dl>
          <p className="out wrap dim">This statement describes our current posture and forward-looking plans. It is not a representation that Frege currently holds a SOC 2 certification.</p>
        </section>

        <hr className="rule" />

        {/* ── footer ── */}
        <footer className="foot" role="contentinfo">
          <p className="out muted">frege · the company brain for AI agents</p>
          <p className="hint" id="navhint">press a <b>number</b> to follow a link · <b>g</b> top · <b>G</b> bottom · index at top</p>
        </footer>

      </main>
    </>
  );
}
