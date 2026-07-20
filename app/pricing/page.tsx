import type { Metadata } from "next";
import pricingStyles from "./pricing.module.css";
import v2Styles from "../secondary-public-v2.module.css";
import SiteFooter from "../components/SiteFooter";

const publicSiteV2 = process.env.FREGE_PUBLIC_SITE_V2 === "true";

function withPublicV2(base: string, ...v2: string[]) {
  return publicSiteV2 ? [base, ...v2].join(" ") : base;
}

export const metadata: Metadata = {
  title: "Pricing — Frege",
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
  "Frege context packets cite the sources they return",
  "Memory updates you approve before they stick",
];

const teamFeatures = [
  "Everyone's agents can use the same versioned memory",
  "Not everyone sees everything — role and trust-zone gates",
  "Record context builds, sessions, and access decisions",
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
    <main
      id="main"
      className={publicSiteV2 ? `${v2Styles.page} ${v2Styles.pricingPage}` : "docs"}
    >
      <header className="docs__head">
        <p className="eyebrow">Pricing</p>
        <h1>Governed agent memory, priced per user.</h1>
        <p>
          You&apos;re replacing the patchwork: copies of <code>CLAUDE.md</code> that drift, context
          pasted into every session, and no shared record of agent work. Start solo, grow into a
          team, or talk to us for enterprise. Every plan includes the hosted brain, MCP access,
          trust zones, and reviewable memory.
        </p>
      </header>

      <section aria-label="Plans">
        <div className={withPublicV2(pricingStyles.grid, v2Styles.plans)}>
          <article className={withPublicV2(pricingStyles.card, v2Styles.plan)}>
            <p className={withPublicV2(pricingStyles.tier, v2Styles.tier)}>Solo</p>
            <div className={withPublicV2(pricingStyles.price, v2Styles.price)}>
              <span className={withPublicV2(pricingStyles.amount, v2Styles.amount)}>$20</span>
              <span className={withPublicV2(pricingStyles.unit, v2Styles.unit)}>/ month</span>
            </div>
            <p className={withPublicV2(pricingStyles.billing, v2Styles.billing)}>Single user.</p>
            <ul className={withPublicV2(pricingStyles.features, v2Styles.featureList)}>
              {soloFeatures.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <div className={withPublicV2(pricingStyles.cardCta, v2Styles.planCta)}>
              <a
                className={publicSiteV2 ? `button button--primary ${v2Styles.action} ${v2Styles.primaryAction}` : "button button--primary"}
                href="/signup?plan=solo"
              >Start solo</a>
            </div>
          </article>

          <article className={withPublicV2(`${pricingStyles.card} ${pricingStyles.cardFeatured}`, v2Styles.plan, v2Styles.planFeatured)}>
            <p className={withPublicV2(pricingStyles.tier, v2Styles.tier)}>Team</p>
            <div className={withPublicV2(pricingStyles.price, v2Styles.price)}>
              <span className={withPublicV2(pricingStyles.amount, v2Styles.amount)}>$20</span>
              <span className={withPublicV2(pricingStyles.unit, v2Styles.unit)}>/ user / month</span>
            </div>
            <p className={withPublicV2(pricingStyles.billing, v2Styles.billing)}>Billed monthly.</p>
            <p className={withPublicV2(pricingStyles.annual, v2Styles.annual)}>Or $15 / user / month billed annually.</p>
            <ul className={withPublicV2(pricingStyles.features, v2Styles.featureList)}>
              {teamFeatures.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <div className={withPublicV2(pricingStyles.cardCta, v2Styles.planCta)}>
              <a
                className={publicSiteV2 ? `button button--primary ${v2Styles.action} ${v2Styles.primaryAction}` : "button button--primary"}
                href="/signup?plan=team-monthly"
              >Start team</a>
            </div>
          </article>

          <article className={withPublicV2(pricingStyles.card, v2Styles.plan)}>
            <p className={withPublicV2(pricingStyles.tier, v2Styles.tier)}>Enterprise</p>
            <div className={withPublicV2(pricingStyles.price, v2Styles.price)}>
              <span className={withPublicV2(pricingStyles.amount, v2Styles.amount)}>Custom</span>
            </div>
            <p className={withPublicV2(pricingStyles.billing, v2Styles.billing)}>For orgs and teams with advanced needs.</p>
            <ul className={withPublicV2(pricingStyles.features, v2Styles.featureList)}>
              {enterpriseFeatures.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <div className={withPublicV2(pricingStyles.cardCta, v2Styles.planCta)}>
              <a
                className={publicSiteV2 ? `button button--primary ${v2Styles.action} ${v2Styles.primaryAction}` : "button button--primary"}
                href="/contact"
              >Contact us</a>
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
        <dl className={publicSiteV2 ? `caps ${v2Styles.detailList}` : "caps"}>
          <div className={publicSiteV2 ? `caps__row ${v2Styles.detailRow}` : "caps__row"}>
            <dt>Per-user pricing</dt>
            <dd>
              Teams pay per active user. Add or remove members as your team changes; pricing
              follows the number of users on the plan.
            </dd>
          </div>
          <div className={publicSiteV2 ? `caps__row ${v2Styles.detailRow}` : "caps__row"}>
            <dt>Annual billing</dt>
            <dd>
              The $15 / user / month team rate is billed annually, paid yearly upfront
              ($180 per user per year). The monthly option is $20 / user / month with no
              annual commitment.
            </dd>
          </div>
          <div className={publicSiteV2 ? `caps__row ${v2Styles.detailRow}` : "caps__row"}>
            <dt>Teams</dt>
            <dd>
              Users can create a team and invite members. Each member gets a role and
              trust-zone scoped access to the shared company brain.
            </dd>
          </div>
          <div className={publicSiteV2 ? `caps__row ${v2Styles.detailRow}` : "caps__row"}>
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

      <SiteFooter />
    </main>
  );
}
