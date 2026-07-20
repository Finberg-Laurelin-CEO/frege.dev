import type { Metadata } from "next";
import AsciiImageCascade from "../components/AsciiImageCascade";
import SiteFooter from "../components/SiteFooter";
import { PUBLIC_PROOF } from "@/lib/public-proof";
import styles from "./demo.module.css";

export const metadata: Metadata = {
  title: "90-second product proof — Frege",
  description:
    "A sanitized Frege product walkthrough for AI engineering teams: scoped context, citations, denied access, memory review, and an attributable audit trail.",
  alternates: { canonical: "https://frege.dev/demo" },
  openGraph: {
    title: "A governed coding-agent workflow in 90 seconds — Frege",
    description:
      "See the identity, context, denial, proposal, approval, and audit path that Frege provides to AI engineering teams.",
    url: "https://frege.dev/demo",
  },
};

export default function DemoPage() {
  return (
    <main id="main" className={styles.page}>
      <header className={styles.hero} aria-labelledby="demo-title">
        <figure className={styles.heroArt}>
          <picture>
            <source srcSet="/art/system/provenance-diamonds.avif" type="image/avif" />
            <img
              id="demo-provenance-art"
              src="/art/system/provenance-diamonds.webp"
              width="900"
              height="1400"
              fetchPriority="high"
              decoding="async"
              alt="A continuous thread links source material, evidence, review, and an accepted record."
            />
          </picture>
          <AsciiImageCascade
            className={styles.heroAscii}
            imageId="demo-provenance-art"
            charSet="identitycontextdenyproposereviewreceipt"
            cellSize={44}
            compactCellSize={38}
            duration={3000}
            fps={20}
            opacity={0.38}
            compactOpacity={0.3}
            washColor="#083a2e"
            washOpacity={0.04}
            shadowColor="#061f18"
            midColor="#4f7f67"
            highlightColor="#c9d8b5"
            edgeEmphasis={0.64}
            darkThreshold={0.67}
            bloom={2}
            density={0.54}
            compactDensity={0.44}
            ditherStrength={0.7}
            cascadeWidth={0.1}
            focusX={0.54}
            focusY={0.5}
          />
          <figcaption>Visible lineage / sanitized engineering-release proof</figcaption>
        </figure>

        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>{PUBLIC_PROOF.duration} / {PUBLIC_PROOF.audience}</p>
          <h1 id="demo-title">The work moves. <em>The boundary stays visible.</em></h1>
          <p>{PUBLIC_PROOF.title}</p>
          <div className={styles.actions}>
            <a className={styles.primaryAction} href="#transcript">Run the sequence</a>
            <a href="/docs#agent-install">Connect an agent</a>
          </div>
        </div>
      </header>

      <section className={styles.disclosure} aria-labelledby="proof-scope-title">
        <div>
          <p className={styles.eyebrow}>What this is</p>
          <h2 id="proof-scope-title">Product proof, not customer theatre.</h2>
        </div>
        <p>{PUBLIC_PROOF.summary}</p>
        <dl>
          <div><dt>Actor</dt><dd>{PUBLIC_PROOF.actor.label}</dd></div>
          <div><dt>Credential</dt><dd>{PUBLIC_PROOF.actor.credential}</dd></div>
          <div><dt>Role</dt><dd>{PUBLIC_PROOF.actor.role}</dd></div>
          <div><dt>Trust zone</dt><dd>{PUBLIC_PROOF.actor.trustZone}</dd></div>
        </dl>
      </section>

      <section className={styles.transcript} id="transcript" aria-labelledby="transcript-title">
        <header>
          <p className={styles.eyebrow}>One governed loop</p>
          <h2 id="transcript-title">From question to accepted memory.</h2>
          <p>Each row names the acting surface, the visible result, and the evidence retained.</p>
        </header>

        <ol>
          {PUBLIC_PROOF.steps.map((step, index) => (
            <li key={step.id} data-tone={step.tone}>
              <div className={styles.stepRail} aria-hidden="true">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <span>{step.elapsed}</span>
              </div>
              <div className={styles.stepBody}>
                <p className={styles.stepSurface}>{step.surface}</p>
                <h3>{step.title}</h3>
                <code>{step.command}</code>
                <p>{step.result}</p>
              </div>
              <ul className={styles.evidence} aria-label={`${step.title} evidence`}>
                {step.evidence.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.close} aria-labelledby="proof-close-title">
        <p className={styles.eyebrow}>Try the real path</p>
        <h2 id="proof-close-title">Bring your agent. Keep your organizational record.</h2>
        <p>
          The CLI and MCP server use the same hosted API path shown here. Start with governed
          memory; add broader capabilities only when identity, policy, and provenance are ready.
        </p>
        <div className={styles.actions}>
          <a className={styles.primaryAction} href="/signup">Create an account</a>
          <a href="/architecture">Inspect the architecture</a>
          <a href="/roadmap">Read the roadmap</a>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
