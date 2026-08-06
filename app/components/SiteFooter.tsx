import styles from "../public-v2.module.css";

const publicSiteV2 = process.env.FREGE_PUBLIC_SITE_V2 === "true";
const githubUrl = "https://github.com/Finberg-Laurelin-CEO/frege.dev";

// Shared public footer. The v2 variant is selected at build time, while the
// authenticated product keeps its existing route-specific interface.
export default function SiteFooter() {
  if (publicSiteV2) {
    return (
      <footer className={styles.footer}>
        <span className={styles.footerMark}>Frege — organizational memory, governed.</span>
        <span className={styles.footerLinks}>
          <a href="/docs">docs</a>
          <a href="/architecture">architecture</a>
          <a href="/roadmap">roadmap</a>
          <a href="/pricing">pricing</a>
          <a href="/contact">contact</a>
          <a href="/report-a-bug">report a bug</a>
          <a href="/signup">sign up</a>
          <a href="/login?next=/console">sign in</a>
          <a href={githubUrl}>github</a>
          <a href="mailto:hello@frege.dev">hello@frege.dev</a>
          <a href="/privacy">privacy</a>
          <a href="/terms">terms</a>
        </span>
      </footer>
    );
  }

  return (
    <footer className="foot">
      <div className="foot__top" aria-hidden="true" />
      <div className="foot__row">
        <span>Frege — agent memory, governed.</span>
        <span className="foot__links">
          <a href="/docs">docs</a>
          <a href="/architecture">architecture</a>
          <a href="/pricing">pricing</a>
          <a href="/contact">contact</a>
          <a href="/report-a-bug">report a bug</a>
          <a href="/signup">sign up</a>
          <a href="/login?next=/console">sign in</a>
          <a href={githubUrl}>github</a>
          <a href="mailto:hello@frege.dev">hello@frege.dev</a>
          <a href="/privacy">privacy</a>
          <a href="/terms">terms</a>
        </span>
      </div>
    </footer>
  );
}
