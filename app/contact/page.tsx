import type { Metadata } from "next";
import SiteFooter from "../components/SiteFooter";
import v2Styles from "../secondary-public-v2.module.css";

const publicSiteV2 = process.env.FREGE_PUBLIC_SITE_V2 === "true";
const githubUrl = "https://github.com/Finberg-Laurelin-CEO/frege.dev";

export const metadata: Metadata = {
  title: "Contact — Frege",
  description:
    "Talk to the Frege team about enterprise plans, team onboarding, security review, or support.",
  alternates: {
    canonical: "https://frege.dev/contact",
  },
};

export default function ContactPage() {
  return (
    <main
      id="main"
      className={publicSiteV2 ? `${v2Styles.page} ${v2Styles.contactPage}` : "docs"}
    >
      <header className="docs__head">
        <p className="eyebrow">Contact</p>
        <h1>Talk to the Frege team.</h1>
        <p>
          For enterprise pricing, team onboarding, security review, or anything not covered
          on the site, reach out directly. We read every message.
        </p>
        <div className={publicSiteV2 ? `hero__actions ${v2Styles.actions}` : "hero__actions"}>
          <a
            className={publicSiteV2 ? `button button--primary ${v2Styles.action} ${v2Styles.primaryAction}` : "button button--primary"}
            href="mailto:hello@frege.dev"
          >Email hello@frege.dev</a>
          <a className={publicSiteV2 ? `button ${v2Styles.action}` : "button"} href="/signup">Create account</a>
          {publicSiteV2 ? (
            <a className={`button ${v2Styles.action}`} href="/roadmap">Product roadmap</a>
          ) : null}
          <a className={publicSiteV2 ? `button ${v2Styles.action}` : "button"} href={githubUrl}>GitHub</a>
        </div>
      </header>

      <section aria-label="What to include">
        <h2>What to tell us</h2>
        <ul>
          <li>How many agents and people will use Frege.</li>
          <li>Where your institutional knowledge lives today.</li>
          <li>Any access-control, audit, or compliance requirements.</li>
          <li>Whether you want monthly, annual, or enterprise terms.</li>
        </ul>
        <p className="docs__note">
          Prefer email: <a className="lnk" href="mailto:hello@frege.dev">hello@frege.dev</a>.
          To start self-serve, use the{" "}
          <a className="lnk" href="/signup">signup form</a>.
        </p>
      </section>

      <SiteFooter />
    </main>
  );
}
