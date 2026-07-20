import type { Metadata } from "next";
import AsciiImageCascade from "../components/AsciiImageCascade";
import SiteFooter from "../components/SiteFooter";
import ArchitectureSectionNav from "./ArchitectureSectionNav";
import styles from "./architecture-v2.module.css";

const publicSiteV2 = process.env.FREGE_PUBLIC_SITE_V2 === "true";
const githubUrl = "https://github.com/Finberg-Laurelin-CEO/frege.dev";

const legacyToc: [string, string, string][] = [
  ["01", "overview", "Overview"],
  ["02", "product-shape", "Product shape"],
  ["03", "request-flow", "Request flow"],
  ["04", "identity", "Identity & control plane"],
  ["05", "brain", "Hosted brain"],
  ["06", "sessions", "Session ledger"],
  ["07", "proposals", "Memory proposals"],
  ["08", "context", "Context gateway"],
  ["09", "execution-boundary", "Execution boundary"],
  ["10", "telemetry", "Telemetry & audit"],
  ["11", "trust", "Trust & tenancy"],
  ["12", "mcp", "MCP surface"],
];

const v2Toc: [string, string, string][] = [
  ["01", "overview", "Overview"],
  ["02", "product-shape", "Product shape"],
  ["03", "request-flow", "Request flow"],
  ["04", "subsystems", "Backend subsystems"],
  ["05", "identity-detail", "Identity & control plane"],
  ["06", "brain-detail", "Hosted brain"],
  ["07", "sessions-detail", "Session ledger"],
  ["08", "proposals-detail", "Memory proposals"],
  ["09", "context-detail", "Context gateway"],
  ["10", "execution-boundary-detail", "Execution boundary"],
  ["11", "telemetry-detail", "Telemetry & audit"],
  ["12", "trust-detail", "Trust & tenancy"],
  ["13", "mcp", "MCP surface"],
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
  keys · sources · proposals     sessions · telemetry
`;

const RUNTIME_ART = `  Customer environment
    -> Codex / Claude Code / internal agent
    -> customer's model credentials, tools, and compute
    -> local frege mcp serve process

  Frege hosted API
    -> authenticates the scoped API key
    -> returns governed, cited context
    -> records sessions and reviewable memory proposals

  Frege does not run the agent or call its model in the MVP
`;

const PATH_GLYPHS = String.raw`
+-- FREGE / BOUNDED SUBSYSTEM LATTICE --------------------------------------+
|                                                                           |
|  org / actor                                                              |
|     +-- identity + control  ------ users / roles / keys                    |
|     +-- hosted brain       -------- pages / sources / revisions            |
|     +-- session ledger     -------- events / tools / signals               |
|     +-- memory proposals  --------- review / accept / revise               |
|     +-- context gateway    -------- scope / cite / withhold                 |
|     +-- client boundary    -------- bring / connect / govern               |
|     +-- telemetry + audit  -------- receipt / cost / provenance            |
|     +-- trust + tenancy    -------- green / red / deny                     |
|                                                                           |
+----------------------------------------------- one governed system / eight -+`;

const PATH_DITHER = String.raw`
..  .    .   :      .        .      :     .        .     .       .      ..
  ..  .    :::.      ..   .    .:::.   .    ..      .:.    .       .:.
 .  :..::--==++**##%%@@%%##**++==--::..:.  .::--==++**##%%@@%%##**++==--
    ..::--==++**##%%@@%%##**++==--::..     ..::--==++**##%%@@%%##**++==
       .::--==++**##%%@@%%##**++==--::.       .::--==++**##%%@@%%##**++
          ..:--==++**##%%%%##**++==--:..          ..:--==++**##%%%%##**
             .::--==++**####**++==--::.              .::--==++**####**
                ..:--==++****++==--:..                   ..:--==++****
                   .::--==++++==--::.                        .::--==++
                      ..:--====--:..                             ..:--
                         .::----::.                                  .
                            ..::..
                               .`;

const CONTEXT_ORBIT_ART = String.raw`
                                      *
                              PHOSPHORUS / MORNING
                         . - '         |         ' - .
                    . '                |                ' .
                 .                     |                     .
               .                  ONE STAR                     .
              .                       |                         .
              :                       |                         :
              .                GOVERNED SOURCE                  .
               .                 /           \                 .
                 .              /             \              .
                    .          /               \          .
                         ' - .                   . - '
                           WEB                   MCP
                     ALLOWED + CITED       ALLOWED + CITED
                                      |
                               HESPERUS / EVENING
                                      *`;

const CONTEXT_POLICY_ART = String.raw`
  org  .  actor  .  role  .  labels  .  trust
   \          \          |          /          /
     '---------- resolve ----------'
                    |
              allowed / cited

  withheld ::::::::::::::::::::::::: count only`;

const subsystems: [string, string, string][] = [
  ["identity", "Identity & control plane", "Users, sessions, memberships, invites, roles, and per-user API keys. Org scope is always derived from the session or key, never from client input."],
  ["brain", "Hosted brain", "Institutional knowledge stored as versioned pages with sources, revisions, trust zones, tags, and extracted links. The database is canonical; markdown is the human and agent representation."],
  ["sessions", "Session ledger", "Durable per-task context: user and assistant messages, tool calls, tool results, context builds, client-reported model activity, memory signals, and notes. Secrets are redacted before any write."],
  ["proposals", "Memory proposals", "Agents do not silently rewrite canonical knowledge. Durable updates land as reviewable proposals; an accepted page proposal creates a new brain revision and refreshes links."],
  ["context", "Context gateway", "Context builds resolve org, role, sensitivity labels, and trust zones, then return allowed chunks with citations and withheld counts."],
  ["execution-boundary", "Agent execution boundary", "The customer's agent supplies the model, tools, and compute. Frege supplies a scoped MCP/API memory service and does not run the agent in the current product."],
  ["telemetry", "Telemetry & audit", "Supported context, session, proposal, and review paths record actor, action, outcome, latency, and trust zone alongside a separate audit trail."],
  ["trust", "Trust & tenancy", "Green and red trust zones gate context before any packet reaches an agent or model. Denied counts can be reported, but denied titles and bodies never leak."],
];

export const metadata: Metadata = {
  title: "Architecture — Frege",
  description:
    "How Frege works: a hosted control plane and organizational-memory database with a thin MCP/CLI client, governed context, role-scoped access, and reviewable updates.",
  alternates: { canonical: "https://frege.dev/architecture" },
  openGraph: {
    title: "Architecture — Frege",
    description:
      "How Frege works: a hosted control plane and organizational-memory database with a thin MCP/CLI client, governed context, role-scoped access, and reviewable updates.",
    url: "https://frege.dev/architecture",
  },
};

export default function ArchitecturePage() {
  return (
    <main
      id="main"
      className={publicSiteV2
        ? `docs docs--withSidebar ${styles.architectureV2}`
        : "docs docs--withSidebar"}
    >
      <header className="docs__head">
        {publicSiteV2 ? (
          <figure className={styles.architectureHeroArt}>
            <picture>
              <source
                media="(max-width: 820px)"
                srcSet="/art/demorgan/phosphorus-hesperus-dither-mobile.avif"
                type="image/avif"
              />
              <source
                media="(max-width: 820px)"
                srcSet="/art/demorgan/phosphorus-hesperus-dither-mobile.webp"
                type="image/webp"
              />
              <source
                srcSet="/art/demorgan/phosphorus-hesperus-dither.avif"
                type="image/avif"
              />
              <img
                src="/art/demorgan/phosphorus-hesperus-dither.webp"
                width="1920"
                height="1080"
                loading="eager"
                fetchPriority="high"
                decoding="async"
                alt="Evelyn De Morgan's Phosphorus and Hesperus: two figures bearing morning and evening torches beside the sea."
              />
            </picture>
            <AsciiImageCascade
              className={styles.architectureHeroAscii}
              charSet="fregegovernedmemory"
              cellSize={46}
              compactCellSize={40}
              duration={3600}
              fps={20}
              opacity={0.42}
              compactOpacity={0.32}
              washColor="#356a58"
              washOpacity={0.04}
              compactWashOpacity={0.03}
              shadowColor="#092b23"
              midColor="#71ad89"
              highlightColor="#e2c58f"
              edgeEmphasis={0.68}
              darkThreshold={0.65}
              bloom={2}
              density={0.6}
              compactDensity={0.52}
              ditherStrength={0.72}
              cascadeWidth={0.105}
              focusX={0.67}
              focusY={0.4}
              phaseMode="radial-out"
            />
            <figcaption>
              <span>Evelyn De Morgan / Phosphorus and Hesperus / 1881</span>
              <span>dither study / governed context</span>
            </figcaption>
          </figure>
        ) : null}
        <p className="eyebrow">Architecture</p>
        <h1>
          {publicSiteV2 ? <>How Frege <em>works.</em></> : "How Frege works."}
        </h1>
        <p>
          Frege is a hosted SaaS control plane and brain database with a thin MCP/CLI
          client. Humans manage organizations, roles, keys, and review queues. Agents
          connect over MCP and only ever receive context allowed by their org, role, and
          trust zone. Protected memory and context routes derive organization scope on the server.
        </p>
        <div className="hero__actions">
          <a className="button button--primary" href="/docs">Read the docs</a>
          {publicSiteV2 ? <a className="button" href="/roadmap">View the roadmap</a> : null}
          <a className="button" href={githubUrl}>View GitHub</a>
        </div>
      </header>

      <div className="docs__layout">
        {publicSiteV2 ? (
          <ArchitectureSectionNav items={v2Toc} />
        ) : (
          <nav className="docs__sidebar" aria-label="Contents">
            {legacyToc.map(([n, id, label]) => (
              <a key={id} href={`#${id}`} data-n={n}>{label}</a>
            ))}
          </nav>
        )}

        <div className="docs__main">
      <section id="overview">
        <h2>Overview</h2>
        <p>
          A Frege brain stores institutional knowledge as versioned pages with sources,
          links, and trust zones. Agents never read raw files or the database directly.
          Instead they request scoped context, and Frege resolves org, role, and source
          permissions before returning anything. The backend supports login and
          bootstrap, org management, per-user API keys, hosted brain pages, agent
          sessions, memory proposals, context builds, telemetry, and MCP access.
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
          <li><b>Control plane</b>: the hosted app, admin UI, REST APIs, permissions, review, and provenance.</li>
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
          aria-label="Human admins reach /api/v1/admin/* with a session cookie to manage organizations, users, roles, keys, sources, and proposals. Customer-run agents reach /api/v1/* with a bearer API key to use the brain, context gateway, sessions, and telemetry."
        >{REQUEST_FLOW_ART}</pre>
      </section>

      <section id="subsystems">
        {publicSiteV2 ? (
          <div className={styles.architectureRequestVisual}>
            <figure className={styles.architecturePathArt}>
              <picture>
                <source srcSet="/art/user/corridor-diagonal.avif" type="image/avif" />
                <img
                  src="/art/user/corridor-diagonal.webp"
                  width="1200"
                  height="1500"
                  loading="lazy"
                  decoding="async"
                  alt="An ornate corridor seen through open doors converges on one distant doorway."
                />
              </picture>
              <AsciiImageCascade
                className={styles.architecturePathAscii}
                charSet="fregegovernedmemory"
                cellSize={50}
                compactCellSize={42}
                duration={3000}
                fps={20}
                opacity={0.3}
                compactOpacity={0.24}
                washColor="#2c684f"
                washOpacity={0.02}
                compactWashOpacity={0.015}
                shadowColor="#09261f"
                midColor="#578a75"
                highlightColor="#d0ded5"
                edgeEmphasis={0.56}
                darkThreshold={0.7}
                bloom={1}
                density={0.46}
                compactDensity={0.38}
                ditherStrength={0.64}
                cascadeWidth={0.1}
                focusX={0.5}
                focusY={0.5}
                phaseMode="radial-in"
              />
              <pre className={styles.architecturePathGlyphs} aria-hidden="true">{PATH_GLYPHS}</pre>
              <pre className={styles.architecturePathDither} aria-hidden="true">{PATH_DITHER}</pre>
              <div className={styles.architecturePathTrace} aria-hidden="true">
                <span>identity</span>
                <span>memory</span>
                <span>context</span>
                <span>audit</span>
              </div>
              <figcaption>
                <span>Eight bounded systems / corridor projection 01</span>
                <span>identity → memory → context → audit</span>
              </figcaption>
            </figure>
            <div className={styles.architectureRequestCopy}>
              <p className={styles.architectureRequestEyebrow}>04 / system lattice</p>
              <h2>Backend subsystems</h2>
              <p>
                Frege is composed of focused subsystems. Each one is org-scoped and governed by
                the same identity and trust rules.
              </p>
              <a className={styles.architectureRequestNext} href="#identity-detail">
                <span>next / 05</span>
                Identity &amp; control plane <span aria-hidden="true">↓</span>
              </a>
            </div>
          </div>
        ) : (
          <>
            <h2>Backend subsystems</h2>
            <p>
              Frege is composed of focused subsystems. Each one is org-scoped and governed by
              the same identity and trust rules.
            </p>
          </>
        )}
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
          assistant messages, tool calls, tool results, context builds, client-reported model activity,
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
        {publicSiteV2 ? (
          <div className={styles.architectureContextVisual}>
            <figure className={styles.architectureContextArt}>
              <picture>
                <source
                  media="(max-width: 820px)"
                  srcSet="/art/demorgan/phosphorus-hesperus-dither-mobile.avif"
                  type="image/avif"
                />
                <source
                  media="(max-width: 820px)"
                  srcSet="/art/demorgan/phosphorus-hesperus-dither-mobile.webp"
                  type="image/webp"
                />
                <source
                  srcSet="/art/demorgan/phosphorus-hesperus-dither.avif"
                  type="image/avif"
                />
                <img
                  src="/art/demorgan/phosphorus-hesperus-dither.webp"
                  width="1920"
                  height="1080"
                  loading="lazy"
                  decoding="async"
                  alt="Evelyn De Morgan's Phosphorus and Hesperus: two figures bearing morning and evening torches beside the sea."
                />
              </picture>
              <AsciiImageCascade
                className={styles.architectureContextAscii}
                charSet="fregegovernedmemory"
                cellSize={46}
                compactCellSize={40}
                duration={3600}
                fps={20}
                opacity={0.36}
                compactOpacity={0.28}
                washColor="#7a5a34"
                washOpacity={0.035}
                compactWashOpacity={0.025}
                shadowColor="#1a211c"
                midColor="#a8865d"
                highlightColor="#efd5a4"
                edgeEmphasis={0.64}
                darkThreshold={0.66}
                bloom={2}
                density={0.56}
                compactDensity={0.48}
                ditherStrength={0.68}
                cascadeWidth={0.105}
                focusX={0.7}
                focusY={0.38}
                phaseMode="radial-out"
              />
              <pre className={styles.architectureContextOrbit} aria-hidden="true">
                {CONTEXT_ORBIT_ART}
              </pre>
              <pre className={styles.architectureContextPolicy} aria-hidden="true">
                {CONTEXT_POLICY_ART}
              </pre>
              <div className={styles.architectureContextStars} aria-hidden="true">
                <span>*</span><span>.</span><span>+</span><span>*</span><span>.</span><span>+</span>
              </div>
              <figcaption>
                <span>Evelyn De Morgan / Phosphorus and Hesperus / 1881</span>
                <span>one governed source / two cited interfaces</span>
              </figcaption>
            </figure>
            <div className={styles.architectureContextCopy}>
              <p className={styles.architectureContextEyebrow}>09 / governed light</p>
              <h2 id="context-detail-title">Context gateway</h2>
              <p>
                The context build endpoint returns a governed packet that combines documents,
                chunks, and hosted brain pages. Frege resolves the API key into organization,
                human key owner, role, allowed labels, trust zones, and capabilities, then filters
                by org, role permissions, sensitivity labels, and trust zone. It returns only
                allowed pages, documents, chunks, links, citations, token estimates, and denied
                counts. When a session is provided, the context build is linked into the session
                ledger.
              </p>
              <a className={styles.architectureContextNext} href="#execution-boundary-detail">
                <span>next / 10</span>
                Execution boundary <span aria-hidden="true">↓</span>
              </a>
            </div>
          </div>
        ) : (
          <>
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
          </>
        )}
      </section>

      <section id="execution-boundary-detail">
        <h2>Agent execution boundary</h2>
        <p>
          The customer&apos;s agent supplies the model access, tools, and compute. Codex, Claude
          Code, or an internal agent runs in the customer&apos;s environment and calls the local
          <code> frege mcp serve</code> bridge. Frege authenticates that client, returns scoped
          and cited context, and accepts session events or reviewable memory proposals.
        </p>
        <p>
          The hosted app is a memory and control plane, not an inference host. Frege does not
          run customer agents or call their models in the MVP. Optional hosted execution can
          be considered later if customers need it and the policy boundary is ready.
        </p>
        <pre
          className="diagram"
          role="img"
          aria-label="The customer runs the agent, model, and tools in their own environment. The local Frege MCP process calls the hosted Frege API for governed context, sessions, and reviewable memory proposals."
        >{RUNTIME_ART}</pre>
        <p className="docs__note">
          Model credentials stay with the customer&apos;s agent client. Frege only needs the scoped
          API key used to reach the organization&apos;s governed memory.
        </p>
      </section>

      <section id="telemetry-detail">
        <h2>Telemetry &amp; audit</h2>
        <p>
          Telemetry is the metrics and observability spine for supported product paths. It records
          actor, user or key, request, route action, outcome, latency, trust zone, and redacted
          metadata, and links to sessions, session events, context builds, proposals, and reviews.
          Clients may attach their own model metadata to session events. Compliance history
          lives in a separate audit trail, while raw task memory stays in the brain and session
          ledger.
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
          documents, build governed context, manage sessions, and propose memory. The
          recommended workflow is to start or attach to a session, append
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
