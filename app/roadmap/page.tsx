import type { Metadata } from "next";
import AsciiImageCascade from "../components/AsciiImageCascade";
import SiteFooter from "../components/SiteFooter";
import {
  CAPABILITY_GROUPS,
  CAPABILITY_STATUS_LABELS,
  PUBLIC_ROADMAP_SUMMARY,
} from "@/lib/public-roadmap";
import styles from "./roadmap.module.css";

const TIME_DIAL_GLYPHS = String.raw`
                    12
             11      |      01
       10       \\    |    /       02
  09 ------------- [ + ] ------------- 03
       08       /    |    \\       04
             07      |      05
                    06
`;

const TIME_DENSITY_GLYPHS = String.raw`
. . : : + + * # % @ % # * + + : : . .   . : + * # % @ % # * + : .   . : + * # % @ % # * + : .
  . . : + + * # % % # * + + : . .   . . : + * # % % # * + : .   . . : + * # % % # * + : .
.   . : : + * # # * + : : .   . : : + * # @ # * + : : .   . : : + * # # * + : : .   .
  .   . : + * * + : .   .   . : + * # % # * + : .   .   . : + * # % # * + : .   .   .
. . : : + + * # % @ % # * + + : : . .   . : + * # % @ % # * + : .   . : + * # % @ % # * + : .
  . . : + + * # % % # * + + : . .   . . : + * # % % # * + : .   . . : + * # % % # * + : .
.   . : : + * # # * + : : .   . : : + * # @ # * + : : .   . : : + * # # * + : : .   .
  .   . : + * * + : .   .   . : + * # % # * + : .   .   . : + * # % # * + : .   .   .
`;

const TIME_MEASURE_GLYPHS = String.raw`
T-06  ......... | memory / retained
T-03  ::::::::: | policy / evaluated
T+00  +++++++++ | state  / present
T+03  ********* | action / bounded
T+06  ######### | trace  / recorded
`;

export const metadata: Metadata = {
  title: "Product roadmap — Frege",
  description:
    "What Frege offers today and what comes next for governed organizational memory, policy, provenance, integrations, and agent execution.",
  alternates: {
    canonical: "https://frege.dev/roadmap",
  },
  openGraph: {
    title: "Product roadmap — Frege",
    description:
      "Available now, building next, and later: Frege's public product direction for governed AI-agent infrastructure.",
    url: "https://frege.dev/roadmap",
  },
};

export default function RoadmapPage() {
  return (
    <main id="main" className={styles.roadmapV2Page}>
      <header className={styles.roadmapV2Hero} aria-labelledby="roadmap-title">
        <div className={styles.roadmapV2HeroContent}>
          <p className={styles.roadmapV2Eyebrow}>Public product roadmap</p>
          <h1 id="roadmap-title">
            Governed memory first. <em>Controlled action follows.</em>
          </h1>
          <p className={styles.roadmapV2Summary}>{PUBLIC_ROADMAP_SUMMARY}</p>

          <div className={styles.roadmapV2HeroActions} aria-label="Roadmap links">
            <a className={styles.roadmapV2PrimaryLink} href="/architecture">
              See how Frege works
            </a>
            <a className={styles.roadmapV2SecondaryLink} href="/docs">
              Read the docs
            </a>
          </div>

          <div className={styles.roadmapV2HeroAside}>
            <dl className={styles.roadmapV2StatusKey} aria-label="Capability status key">
              <div>
                <dt>Available</dt>
                <dd>Supported in the current product.</dd>
              </div>
              <div>
                <dt>Beta</dt>
                <dd>Usable now; interfaces may change.</dd>
              </div>
              <div>
                <dt>Planned</dt>
                <dd>Direction, not a delivery-date commitment.</dd>
              </div>
            </dl>
          </div>
        </div>

        <figure className={styles.roadmapV2TimeArt}>
          <picture>
            <source srcSet="/art/user/sundial-characters.avif" type="image/avif" />
            <img
              src="/art/user/sundial-characters.webp"
              width="1050"
              height="1313"
              loading="eager"
              decoding="async"
              alt="A stone facade centered on a sundial and arched doorway, rendered with numeric glyphs."
            />
          </picture>
          <AsciiImageCascade
            className={styles.roadmapV2AsciiStorm}
            charSet="frege0123456789:.-memory"
            cellSize={48}
            compactCellSize={42}
            duration={3600}
            fps={20}
            opacity={0.31}
            compactOpacity={0.24}
            washColor="#725a2e"
            washOpacity={0.025}
            compactWashOpacity={0.015}
            shadowColor="#10231d"
            midColor="#898066"
            highlightColor="#e0cf9f"
            edgeEmphasis={0.56}
            darkThreshold={0.7}
            bloom={1}
            density={0.44}
            compactDensity={0.36}
            ditherStrength={0.64}
            cascadeWidth={0.105}
            focusX={0.5}
            focusY={0.6}
            phaseMode="radial-out"
          />
          <div className={styles.roadmapV2TimeAscii} aria-hidden="true">
            <pre className={styles.roadmapV2TimeDensity}>{TIME_DENSITY_GLYPHS}</pre>
            <pre className={styles.roadmapV2TimeDial}>{TIME_DIAL_GLYPHS}</pre>
            <pre className={styles.roadmapV2TimeMeasure}>{TIME_MEASURE_GLYPHS}</pre>
            <span className={styles.roadmapV2TimeCoordinate}>51.7520 N / 1.2577 W</span>
            <span className={styles.roadmapV2TimeSequence}>
              06 : 07 : 08 : 09 : 10 : 11 : 12 : 01 : 02 : 03 : 04 : 05
            </span>
          </div>
          <figcaption>
            <span>Status over time</span>
            <span>Numeric-character study / source 03</span>
          </figcaption>
        </figure>
      </header>

      <div className={styles.roadmapV2Stages}>
        {CAPABILITY_GROUPS.map((group, groupIndex) => (
          <section
            className={styles.roadmapV2Stage}
            id={group.id}
            key={group.id}
            aria-labelledby={`${group.id}-title`}
          >
            <header className={styles.roadmapV2StageHeader}>
              <div className={styles.roadmapV2StageIndex} aria-hidden="true">
                {String(groupIndex + 1).padStart(2, "0")}
              </div>
              <div>
                <p className={styles.roadmapV2StageEyebrow}>{group.eyebrow}</p>
                <h2 id={`${group.id}-title`}>{group.title}</h2>
              </div>
              <p className={styles.roadmapV2StageDescription}>{group.description}</p>
            </header>

            <div className={styles.roadmapV2CapabilityGrid}>
              {group.capabilities.map((capability) => (
                <article className={styles.roadmapV2CapabilityCard} key={capability.id}>
                  <div className={styles.roadmapV2CapabilityMeta}>
                    <span
                      className={styles.roadmapV2StatusBadge}
                      data-status={capability.status}
                    >
                      {CAPABILITY_STATUS_LABELS[capability.status]}
                    </span>
                    <span className={styles.roadmapV2CapabilityId} aria-hidden="true">
                      {capability.id.replaceAll("-", " / ")}
                    </span>
                  </div>
                  <h3>{capability.title}</h3>
                  <p>{capability.description}</p>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>

      <aside className={styles.roadmapV2Commitment} aria-labelledby="roadmap-commitment">
        <p className={styles.roadmapV2Eyebrow}>Product commitment</p>
        <h2 id="roadmap-commitment">Control is part of the architecture.</h2>
        <p>
          New integrations and execution capabilities will use the same identity,
          policy, provenance, and review boundaries as Frege&apos;s memory layer. Planned
          items can change as we learn from customers; available capabilities remain
          documented in the product docs.
        </p>
        <a className={styles.roadmapV2PrimaryLink} href="/signup">
          Start with governed memory
        </a>
      </aside>

      <SiteFooter />
    </main>
  );
}
