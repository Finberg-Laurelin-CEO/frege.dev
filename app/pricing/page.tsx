import type { Metadata } from "next";
import styles from "./pricing.module.css";

export const metadata: Metadata = {
  title: "Frege Pricing",
  description:
    "Frege pricing: $20/month for a single user, $20 per user/month for teams ($15 per user/month billed annually), and custom enterprise plans.",
  alternates: {
    canonical: "https://frege.dev/pricing",
  },
};

const soloFeatures = [
  "Stop re-pasting context into every session",
  "Your knowledge stays versioned, not scattered across files",
  "Connect Claude Code, Codex, or your own agent over MCP",
  "Every answer comes back cited, so you can trust it",
  "Memory updates you approve before they stick",
];

const teamFeatures = [
  "Everyone's agents share one brain that can't drift",
  "Not everyone sees everything — role and trust-zone gates",
  "Know what each agent read, was denied, and cost",
  "Agent writes are reviewed before they become canonical",
  "Monthly, or save with annual billing",
];

const enterpriseFeatures = [
  "We onboard your org and connect your sources",
  "Advanced access control and review workflows",
  "Security review and custom terms",
  "Priority support",
  "Custom pricing",
];

export default function PricingPage() {
  return (
    <main id="main" className="docs">
      <header className="docs__head">
        <p className="eyebrow">Pricing</p>
        <h1>Governed agent memory, priced per user.</h1>
        <p>
          You&apos;re replacing the patchwork: copies of <code>CLAUDE.md</code> that drift, context
          pasted into every session, and no record of what agents read. Start solo, grow into a
          team, or talk to us for enterprise. Every plan includes the hosted brain, MCP access,
          trust zones, and reviewable memory.
        </p>
      </header>

      <section aria-label="Plans">
        <div className={styles.grid}>
          <article className={styles.card}>
            <p className={styles.tier}>Solo</p>
            <div className={styles.price}>
              <span className={styles.amount}>$20</span>
              <span className={styles.unit}>/ month</span>
            </div>
            <p className={styles.billing}>Single user.</p>
            <ul className={styles.features}>
              {soloFeatures.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <div className={styles.cardCta}>
              <a className="button button--primary" href="/signup?plan=solo">Start solo</a>
            </div>
          </article>

          <article className={`${styles.card} ${styles.cardFeatured}`}>
            <p className={styles.tier}>Team</p>
            <div className={styles.price}>
              <span className={styles.amount}>$20</span>
              <span className={styles.unit}>/ user / month</span>
            </div>
            <p className={styles.billing}>Billed monthly.</p>
            <p className={styles.annual}>Or $15 / user / month billed annually.</p>
            <ul className={styles.features}>
              {teamFeatures.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <div className={styles.cardCta}>
              <a className="button button--primary" href="/signup?plan=team-monthly">Start team</a>
            </div>
          </article>

          <article className={styles.card}>
            <p className={styles.tier}>Enterprise</p>
            <div className={styles.price}>
              <span className={styles.amount}>Custom</span>
            </div>
            <p className={styles.billing}>For orgs and teams with advanced needs.</p>
            <ul className={styles.features}>
              {enterpriseFeatures.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <div className={styles.cardCta}>
              <a className="button button--primary" href="/contact">Contact us</a>
            </div>
          </article>
        </div>
        <p className="docs__note">
          New here? <a className="lnk" href="/signup">Create an account</a>, choose a plan, then start Stripe billing from your account page.
          Have a Frege code? Enter it in Stripe before paying.
        </p>
      </section>

      <hr className="rule" aria-hidden="true" />

      <section aria-label="Billing details">
        <h2>Billing details</h2>
        <dl className="caps">
          <div className="caps__row">
            <dt>Per-user pricing</dt>
            <dd>
              Teams pay per active user. Add or remove members as your team changes; pricing
              follows the number of users on the plan.
            </dd>
          </div>
          <div className="caps__row">
            <dt>Annual billing</dt>
            <dd>
              The $15 / user / month team rate is billed annually, paid yearly upfront
              ($180 per user per year). The monthly option is $20 / user / month with no
              annual commitment.
            </dd>
          </div>
          <div className="caps__row">
            <dt>Teams</dt>
            <dd>
              Users can create a team and invite members. Each member gets a role and
              trust-zone scoped access to the shared company brain.
            </dd>
          </div>
          <div className="caps__row">
            <dt>Enterprise</dt>
            <dd>
              Larger orgs with advanced access-control, audit, or compliance needs get custom
              pricing and terms. <a className="lnk" href="/contact">Contact us</a>.
            </dd>
          </div>
        </dl>
        <p className="docs__note">
          Pricing may change as the product matures. Promotion codes are applied in Stripe checkout.
        </p>
      </section>

      <footer className="foot">
        <div className="foot__top" aria-hidden="true" />
        <div className="foot__row">
          <span>Frege — agent memory, governed.</span>
          <span className="foot__links">
            <a href="/docs">docs</a>
            <a href="/contact">contact</a>
            <a href="/signup">sign up</a>
            <a href="/login?next=/admin">sign in</a>
          </span>
        </div>
      </footer>
    </main>
  );
}
