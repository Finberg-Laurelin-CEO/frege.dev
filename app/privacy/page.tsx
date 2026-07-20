import type { Metadata } from "next";
import SiteFooter from "../components/SiteFooter";
import v2Styles from "../secondary-public-v2.module.css";

const publicSiteV2 = process.env.FREGE_PUBLIC_SITE_V2 === "true";

export const metadata: Metadata = {
  title: "Privacy — Frege",
  description:
    "How Frege handles account data, organizational content, agent activity, billing records, and service telemetry.",
};

const rows: [string, React.ReactNode][] = [
  [
    "data we process",
    <>
      Account and organization information; memberships and roles; documents, source material,
      revisions, and metadata you choose to add; agent sessions, context builds, proposals, and
      related events; support messages; billing and subscription status; and technical data such
      as IP address, user agent, request outcome, latency, and customer-supplied event metadata.
    </>,
  ],
  [
    "credentials",
    <>
      Passwords are stored as one-way hashes or handled by an identity provider. Frege-issued API
      keys are stored in protected form. Integration credentials you configure are encrypted before
      storage. Do not place raw secrets inside documents, prompts, or support messages.
    </>,
  ],
  [
    "how content is used",
    <>
      We process organizational content to store and retrieve governed memory, assemble scoped
      context, maintain revisions and proposals, operate agent sessions, provide support, secure
      the service, and improve reliability. We do not sell customer content or use it for
      advertising.
    </>,
  ],
  [
    "integrations",
    <>
      When you enable an integration, Frege sends the content and request data needed to perform
      the action you initiated. That service processes data under its own terms and your
      configuration. The current product does not send prompts or governed context to a model
      provider on your behalf.
    </>,
  ],
  [
    "service providers",
    <>
      We use vendors for hosting, databases, authentication, payments, transactional email,
      analytics, and support. They process data on our instructions to provide their services.
      Stripe processes payment-card details; Frege stores customer, subscription, and payment
      status rather than complete card numbers.
    </>,
  ],
  [
    "cookies and analytics",
    <>
      Frege uses authentication and security cookies where needed and Vercel Analytics to
      understand aggregate site usage and performance. We do not run an advertising network or
      sell behavioral profiles.
    </>,
  ],
  [
    "retention and deletion",
    <>
      We retain account and organizational data while the service is active and as reasonably
      needed for security, backups, dispute resolution, and legal obligations. Account deletion
      requests are applied to active systems and age out of backups on their normal lifecycle,
      subject to records we must retain.
    </>,
  ],
  [
    "security",
    <>
      We use access controls, tenant scoping, encryption in transit, protected credential storage,
      and operational monitoring. No online service can guarantee absolute security. Report a
      suspected vulnerability to <a className="lnk" href="mailto:security@frege.dev">security@frege.dev</a>.
    </>,
  ],
  [
    "your choices",
    <>
      Organization administrators control members, agent keys, sources, and enabled integrations.
      Email <a className="lnk" href="mailto:privacy@frege.dev">privacy@frege.dev</a> to request
      access, correction, export, or deletion. We may need to verify your identity and authority
      over the organization before acting.
    </>,
  ],
  [
    "children",
    <>Frege is a business service and is not directed to children under 13.</>,
  ],
  [
    "contact",
    <>
      Privacy questions: <a className="lnk" href="mailto:privacy@frege.dev">privacy@frege.dev</a>.
      General support: <a className="lnk" href="mailto:hello@frege.dev">hello@frege.dev</a>.
    </>,
  ],
];

export default function Privacy() {
  return (
    <main
      id="main"
      className={publicSiteV2 ? `${v2Styles.page} ${v2Styles.policyPage}` : "screen"}
    >
      <section aria-labelledby="privacy-title">
        <p className="eyebrow">Data handling</p>
        <h1
          className={publicSiteV2 ? `hero-tag ${v2Styles.policyTitle}` : "hero-tag"}
          id="privacy-title"
        >Privacy at Frege.</h1>
        <p className={publicSiteV2 ? `out wrap ${v2Styles.policyLead}` : "out wrap"}>
          This notice describes the information Frege processes when people and agents use the
          website, hosted control plane, CLI, MCP gateway, and related services.
        </p>
        <p className={publicSiteV2 ? `out wrap cmt ${v2Styles.policyDate}` : "out wrap cmt"}>Last updated July 15, 2026.</p>
        <dl className={publicSiteV2 ? `rows policy ${v2Styles.legalRows}` : "rows policy"}>
          {rows.map(([title, copy]) => (
            <div key={title}><dt>{title}</dt><dd>{copy}</dd></div>
          ))}
        </dl>
        <p className={publicSiteV2 ? `out wrap cmt ${v2Styles.policyTail}` : "out wrap cmt"}>
          We may update this notice as Frege changes. Material changes will be posted here with a
          new effective date.
        </p>
      </section>
      <SiteFooter />
    </main>
  );
}
