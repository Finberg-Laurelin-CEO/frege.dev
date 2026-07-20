import SiteFooter from "./SiteFooter";
import AsciiImageCascade from "./AsciiImageCascade";
import { CAPABILITY_GROUPS } from "@/lib/public-roadmap";
import styles from "../public-v2.module.css";

const proofLines: ["command" | "muted" | "allowed" | "withheld" | "proposal", string][] = [
  ["command", "agent → build_context(\"EU enterprise refund\")"],
  ["muted", "frege → resolve organization · key owner · role · trust zone"],
  ["allowed", "allowed → 3 cited sources returned"],
  ["muted", "refund-policy.md@v7 · eu-addendum.md@v3 · escalation.md@v5"],
  ["withheld", "withheld → 2 restricted matches omitted from the packet"],
  ["proposal", "proposal → finance sign-off note queued for human review"],
];

const comparison = [
  ["Shared across agents & people", "Each person copies their own file; it drifts", "One versioned memory, with authorized views by role"],
  ["Who can see what", "Everything in the file is visible to everyone", "Role and trust-zone gates on every request"],
  ["Activity & decisions", "No shared record of the work", "Context builds, sessions, and access decisions recorded per org"],
  ["Updating knowledge", "Anyone—or any agent—edits in place", "Agent writes land as proposals, accepted after review"],
  ["Sensitive sources", "All-or-nothing: paste it in or leave it out", "Restricted content stays hidden; packets report withheld counts"],
] as const;

const workflow = [
  ["Connect", "Connect Claude Code, Codex, or an internal client through MCP—or download the local Frege Agent profile for Hermes."],
  ["Build context", "Frege resolves organization, role, and trust zone, then returns scoped context with citations."],
  ["Do work", "The agent keeps its own model and tools while Frege records supported context builds and session activity."],
  ["Improve memory", "Useful discoveries land as proposals. A human accepts before canonical memory changes."],
] as const;

const outcomes = [
  ["Stop re-pasting context", "Agents pull current, cited context on request instead of receiving the same runbook in every session."],
  ["Stop agents reading the wrong document", "Scoped retrieval returns the source for the task—not a stale fork or a document the actor should not see."],
  ["Stop silent knowledge drift", "Durable updates are reviewed before they become canonical, so organizational memory stays trustworthy."],
] as const;

const systemAscii = String.raw`
  codex ───────────┐
  claude ──────────┼──► frege://context + policy ───► organizational memory
  internal agents ─┘              │                         ▲
                                  └── scope · cite · review ─┘
`;

const systemAsciiMobile = String.raw`
  codex ──────┐
  claude ─────┼──► frege://context
  agents ─────┘           │
                           ▼
                    policy + scope
                           │
                           ▼
               organizational memory
                           ▲
                    cite + review
`;

function AsciiDivider({ index, label }: { index: string; label: string }) {
  return (
    <div className={styles.asciiDivider} aria-hidden="true">
      <span>{index}</span>
      <span className={styles.asciiRule}>+························································+</span>
      <span>{label}</span>
    </div>
  );
}

export default function PublicHomeV2() {
  return (
    <main id="main" className={styles.site}>
      <section className={styles.hero} aria-labelledby="v2-hero-title">
        <AsciiImageCascade
          className={styles.heroAsciiCascade}
          imageId="home-hesperus-art"
          charSet="fregegovernedmemory"
          cellSize={48}
          compactCellSize={42}
          duration={3400}
          fps={22}
          opacity={0.58}
          compactOpacity={0.44}
          washColor="#003d25"
          washOpacity={0.08}
          compactWashOpacity={0.05}
          shadowColor="#071b13"
          midColor="#377456"
          highlightColor="#c5d5aa"
          edgeEmphasis={0.72}
          darkThreshold={0.64}
          bloom={3}
          density={0.68}
          compactDensity={0.58}
          ditherStrength={0.8}
          cascadeWidth={0.11}
          focusX={0.58}
          focusY={0.38}
        />
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>The governed operating layer for teams running multiple AI agents</p>
          <h1 id="v2-hero-title">Many agents. <em>One organizational reality.</em></h1>
          <p className={styles.heroLead}>
            Frege gives MCP-connected agents one governed organizational memory: scoped,
            cited context and reviewable updates—without locking company knowledge to one
            model, account, or repository.
          </p>
          <div className={styles.actions} aria-label="Primary actions">
            <a className={styles.primaryAction} href="/signup">Start now</a>
            <a className={`${styles.secondaryAction} ${styles.heroEnter}`} href="#demo">
              Enter the operating layer <span aria-hidden="true">↓</span>
            </a>
          </div>
          <dl className={styles.heroFacts} aria-label="Frege product facts">
            <div><dt>Interface</dt><dd>MCP + REST</dd></div>
            <div><dt>Control</dt><dd>Organization + role</dd></div>
            <div><dt>Memory</dt><dd>Cited + reviewable</dd></div>
          </dl>
        </div>

        <figure className={styles.heroArt}>
          <div className={styles.artRegistration} aria-hidden="true">
            <span>HESPERUS</span><span>EVENING STAR</span><span>VENUS</span>
          </div>
          <picture>
            <source
              media="(max-width: 700px)"
              srcSet="/art/hesperus/hesperus-halftone-mobile.avif"
              type="image/avif"
            />
            <source srcSet="/art/hesperus/hesperus-halftone-desktop.avif" type="image/avif" />
            <source
              media="(max-width: 700px)"
              srcSet="/art/hesperus/hesperus-halftone-mobile.webp"
              type="image/webp"
            />
            <img
              id="home-hesperus-art"
              src="/art/hesperus/hesperus-halftone-desktop.webp"
              width="1440"
              height="1080"
              fetchPriority="high"
              decoding="async"
              alt="Hesperus, the winged personification of evening, holding arrows beneath the evening star."
            />
          </picture>
          <pre className={styles.referenceMark} aria-hidden="true">
            {["\\  |  /", " -- ✦ --", " /  |  \\"].join("\n")}
          </pre>
          <figcaption>Hesperus / one reference, many modes of presentation.</figcaption>
        </figure>
      </section>

      <AsciiDivider index="01" label="current wedge / governed context" />

      <section className={styles.proofSection} id="demo" aria-labelledby="proof-title">
        <div className={styles.sectionIntro}>
          <p className={styles.label}>Available now / governed context</p>
          <h2 id="proof-title">The agent sees what it can use—and the source behind it.</h2>
          <p>
            Frege resolves the caller before assembling context. Allowed sources arrive with
            citations. Restricted matches stay outside the packet. Durable changes enter a
            human review queue instead of silently rewriting memory.
          </p>
        </div>
        <div className={styles.proofVisualStack}>
          <figure className={`${styles.visualPlate} ${styles.contextArt}`}>
            <picture>
              <source srcSet="/art/system/context-lines.avif" type="image/avif" />
              <img
                src="/art/system/context-lines.webp"
                width="1440"
                height="900"
                loading="lazy"
                decoding="async"
                alt="An astronomical aperture selects a small set of pages from a larger archive."
              />
            </picture>
            <figcaption>Scoped passage / vertical-stroke study</figcaption>
          </figure>
          <div className={styles.evidencePlate}>
            <div className={styles.evidenceBar}>
              <span>Sanitized demonstration</span>
              <span>Current capability</span>
            </div>
            <div className={styles.evidenceBody}>
              {proofLines.map(([kind, line], index) => (
                <p key={line} className={styles[kind]}>
                  <span aria-hidden="true">{index === proofLines.length - 1 ? "└─" : "├─"}</span>
                  {line}
                </p>
              ))}
            </div>
            <div className={styles.receiptRow}>
              <span>actor: support-agent</span>
              <span>zone: green</span>
              <span>sources: versioned</span>
              <span>write: proposed</span>
            </div>
            <a className={styles.proofLink} href="/demo">
              Run the complete 90-second product proof <span aria-hidden="true">→</span>
            </a>
          </div>
        </div>
      </section>

      <AsciiDivider index="02" label="why an organizational layer" />

      <section className={styles.fragmentSection} id="compare" aria-labelledby="fragment-title">
        <div className={styles.sectionIntroDark}>
          <p className={styles.label}>Why not just CLAUDE.md?</p>
          <h2 id="fragment-title">CLAUDE.md is great for one person on one repository.</h2>
          <p>
            If that is you, use it—it is free and it works. Frege is for the next step: when
            several agents and people depend on the same knowledge, and not everyone should see
            everything.
          </p>
        </div>
        <div className={styles.fragmentVisualStack}>
          <figure className={`${styles.visualPlate} ${styles.fragmentArt}`}>
            <picture>
              <source srcSet="/art/system/fragmentation-atkinson.avif" type="image/avif" />
              <img
                src="/art/system/fragmentation-atkinson.webp"
                width="1200"
                height="750"
                loading="lazy"
                decoding="async"
                alt="Three classical messengers guard separate fragments in a divided archive."
              />
            </picture>
            <figcaption>Fragmented memory / Atkinson dither</figcaption>
          </figure>
          <div className={styles.fragments}>
            {comparison.map(([title, local, frege], index) => (
              <article key={title} className={styles.fragmentCard}>
                <span aria-hidden="true">0{index + 1}</span>
                <h3>{title}</h3>
                <div className={styles.comparisonPair}>
                  <p><strong>Ad-hoc CLAUDE.md</strong>{local}</p>
                  <p><strong>Frege</strong>{frege}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <AsciiDivider index="03" label="one controlled path" />

      <section className={styles.systemSection} id="how" aria-labelledby="system-title">
        <div className={styles.sectionIntro}>
          <p className={styles.label}>How it works</p>
          <h2 id="system-title">One controlled path from company knowledge to agent action.</h2>
        </div>
        <div className={styles.systemPlate}>
          <pre className={`${styles.systemAscii} ${styles.systemAsciiDesktop}`} aria-hidden="true">{systemAscii}</pre>
          <pre className={`${styles.systemAscii} ${styles.systemAsciiMobile}`} aria-hidden="true">{systemAsciiMobile}</pre>
          <ol className={styles.systemSteps} aria-label="How teams use Frege">
            {workflow.map(([title, copy], index) => (
              <li key={title}><span>0{index + 1} / {title}</span>{copy}</li>
            ))}
          </ol>
          <p className={styles.deniedPath}>// restricted context is withheld before the packet reaches the agent</p>
        </div>
      </section>

      <AsciiDivider index="04" label="customer outcomes / source to decision" />

      <section className={styles.provenanceSection} id="outcomes" aria-labelledby="provenance-title">
        <div className={styles.sectionIntroDark}>
          <p className={styles.label}>What changes for your team</p>
          <h2 id="provenance-title">Less context babysitting. Fewer wrong answers.</h2>
          <p>
            Frege keeps the chain from source to agent context visible and keeps proposed changes
            separate from accepted memory, so your agents can move faster without losing control.
          </p>
        </div>
        <figure className={`${styles.visualPlate} ${styles.provenanceArt}`}>
          <picture>
            <source srcSet="/art/system/provenance-diamonds.avif" type="image/avif" />
            <img
              src="/art/system/provenance-diamonds.webp"
              width="900"
              height="1400"
              loading="lazy"
              decoding="async"
              alt="A single thread connects source material, revision, evidence, review, and an accepted volume."
            />
          </picture>
          <figcaption>Visible lineage / diamond-glyph study</figcaption>
        </figure>
        <ol className={`${styles.provenanceRail} ${styles.outcomeRail}`}>
          {outcomes.map(([title, copy], index) => (
            <li key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{copy}</p></li>
          ))}
        </ol>
      </section>

      <AsciiDivider index="05" label="direction / status not promises" />

      <section className={styles.roadmapSection} aria-labelledby="roadmap-preview-title">
        <div className={styles.sectionIntro}>
          <p className={styles.label}>Product roadmap</p>
          <h2 id="roadmap-preview-title">Start with governed memory. Build toward the operating layer.</h2>
          <p>
            The category is the destination; status labels show what teams can use today and what
            Frege is building next.
          </p>
        </div>
        <div className={styles.roadmapBands}>
          {CAPABILITY_GROUPS.map((group) => (
            <article key={group.id} className={styles.roadmapBand}>
              <p>{group.eyebrow}</p>
              <h3>{group.title}</h3>
              <ul>
                {group.capabilities.slice(0, 3).map((capability) => (
                  <li key={capability.id}>{capability.title}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
        <a className={styles.textLink} href="/roadmap">Read the full product roadmap <span aria-hidden="true">→</span></a>
      </section>

      <section className={styles.closing} id="start" aria-labelledby="closing-title">
        <figure className={styles.persistenceArt}>
          <picture>
            <source srcSet="/art/system/persistence-dots.avif" type="image/avif" />
            <img
              src="/art/system/persistence-dots.webp"
              width="1600"
              height="900"
              loading="lazy"
              decoding="async"
              alt="Orbital paths change above a fixed classical archive."
            />
          </picture>
          <AsciiImageCascade
            className={styles.closingAsciiCascade}
            charSet="fregegovernedmemory"
            cellSize={48}
            compactCellSize={42}
            duration={4200}
            fps={18}
            opacity={0.34}
            compactOpacity={0.26}
            washColor="#1e5a43"
            washOpacity={0.03}
            compactWashOpacity={0.02}
            shadowColor="#07100d"
            midColor="#4f6d60"
            highlightColor="#c9d1c7"
            edgeEmphasis={0.62}
            darkThreshold={0.68}
            bloom={1.5}
            density={0.5}
            compactDensity={0.42}
            ditherStrength={0.58}
            cascadeWidth={0.1}
            focusX={0.5}
            focusY={0.48}
            phaseMode="ambient"
          />
          <figcaption>Persistent institution / dot-halftone study</figcaption>
        </figure>
        <p className={styles.label}>Persistent by design</p>
        <h2 id="closing-title">Models change. <em>Your organization remembers.</em></h2>
        <p>
          Create your account, choose a plan, and connect the agents your team already uses—or
          run the downloadable Frege Agent locally. Billing activates through Stripe when you are ready.
        </p>
        <div className={styles.actions}>
          <a className={styles.primaryAction} href="/signup">Create account</a>
          <a className={styles.secondaryAction} href="/docs#local-agent">Run Frege Agent</a>
          <a className={styles.secondaryAction} href="/pricing">See pricing</a>
          <a className={styles.secondaryAction} href="/architecture">How it&apos;s built</a>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
