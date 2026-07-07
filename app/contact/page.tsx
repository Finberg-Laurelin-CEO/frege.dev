import type { Metadata } from "next";

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
    <main id="main" className="docs">
      <header className="docs__head">
        <p className="eyebrow">Contact</p>
        <h1>Talk to the Frege team.</h1>
        <p>
          For enterprise pricing, team onboarding, security review, or anything not covered
          on the site, reach out directly. We read every message.
        </p>
        <div className="hero__actions">
          <a className="button button--primary" href="mailto:hello@frege.dev">Email hello@frege.dev</a>
          <a className="button" href="/signup">Create account</a>
          <a className="button" href={githubUrl}>GitHub</a>
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

      <footer className="foot">
        <div className="foot__top" aria-hidden="true" />
        <div className="foot__row">
          <span>Frege — agent memory, governed.</span>
          <span className="foot__links">
            <a href="/pricing">pricing</a>
            <a href="/docs">docs</a>
            <a href="/signup">sign up</a>
            <a href="mailto:hello@frege.dev">hello@frege.dev</a>
          </span>
        </div>
      </footer>
    </main>
  );
}
