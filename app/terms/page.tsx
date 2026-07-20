import type { Metadata } from "next";
import SiteFooter from "../components/SiteFooter";
import v2Styles from "../secondary-public-v2.module.css";

const publicSiteV2 = process.env.FREGE_PUBLIC_SITE_V2 === "true";

export const metadata: Metadata = {
  title: "Terms — Frege",
  description: "Terms governing access to and use of Frege.",
};

const rows: [string, React.ReactNode][] = [
  [
    "the service",
    <>
      Frege provides hosted organizational memory, governed context, reviewable updates, agent
      sessions, and related CLI, MCP, API, billing, and support services. Available and beta
      capabilities may evolve; planned roadmap items are not a promise of delivery.
    </>,
  ],
  [
    "authority and accounts",
    <>
      You must be legally able to agree to these terms and authorized to act for any organization
      you create or join. Keep account credentials and agent keys secure, use accurate information,
      and notify us promptly of suspected unauthorized access.
    </>,
  ],
  [
    "customer content",
    <>
      You retain ownership of documents, source material, prompts, session data, and other content
      you submit. You grant Frege the limited rights needed to host, copy, transform, transmit, and
      otherwise process that content solely to operate, secure, and support the service. You are
      responsible for having permission to submit the content and configure who may access it.
    </>,
  ],
  [
    "acceptable use",
    <>
      Do not use Frege to violate law or another person&apos;s rights; distribute malware; probe or
      bypass security or permission boundaries; abuse the service; impersonate others; or submit
      data you are not authorized to process. Use Frege&apos;s credential controls for integration secrets
      rather than embedding secrets in documents or prompts.
    </>,
  ],
  [
    "agents and outputs",
    <>
      AI systems can be inaccurate and should not be treated as a substitute for appropriate human
      review. You are responsible for decisions, actions, and external communications made using
      agent output. Permission checks and citations reduce risk but do not guarantee correctness.
    </>,
  ],
  [
    "third-party services",
    <>
      Integrations, authentication, payments, and other third-party services may have separate
      terms. You are responsible for the services you enable and the data you direct Frege to send
      to them. Your agent&apos;s model provider remains part of your own agent environment.
    </>,
  ],
  [
    "billing",
    <>
      Paid plans renew according to the interval shown at checkout until canceled. Stripe handles
      payment processing. Prices, included usage, taxes, and refund terms are shown at purchase or
      in a separate written agreement. We may suspend paid capabilities when payment is overdue or
      incomplete.
    </>,
  ],
  [
    "Frege IP",
    <>
      Frege and its licensors retain all rights in the service, software, branding, documentation,
      and system design. Public source visibility does not grant a license to copy, modify,
      redistribute, host, or commercialize Frege code. Official client use is subject to these
      terms and any accompanying license notice.
    </>,
  ],
  [
    "suspension and termination",
    <>
      You may stop using Frege at any time. We may restrict or suspend access to protect customers,
      the service, or third parties; respond to legal requirements; address nonpayment; or enforce
      these terms. Contact us to request account closure and content export or deletion.
    </>,
  ],
  [
    "service status",
    <>
      Unless a separate written agreement says otherwise, Frege is provided on an "as is" and "as
      available" basis. We do not promise uninterrupted operation, perfect security, or that agent
      output will be complete or correct.
    </>,
  ],
  [
    "privacy and contact",
    <>
      Our <a className="lnk" href="/privacy">privacy notice</a> explains data handling. Questions
      about these terms can be sent to <a className="lnk" href="mailto:legal@frege.dev">legal@frege.dev</a>.
    </>,
  ],
];

export default function Terms() {
  return (
    <main
      id="main"
      className={publicSiteV2 ? `${v2Styles.page} ${v2Styles.policyPage}` : "screen"}
    >
      <section aria-labelledby="terms-title">
        <p className="eyebrow">Service terms</p>
        <h1
          className={publicSiteV2 ? `hero-tag ${v2Styles.policyTitle}` : "hero-tag"}
          id="terms-title"
        >Terms for using Frege.</h1>
        <p className={publicSiteV2 ? `out wrap ${v2Styles.policyLead}` : "out wrap"}>
          These terms govern access to Frege unless your organization has a separate written
          agreement with us.
        </p>
        <p className={publicSiteV2 ? `out wrap cmt ${v2Styles.policyDate}` : "out wrap cmt"}>Last updated July 15, 2026.</p>
        <dl className={publicSiteV2 ? `rows policy ${v2Styles.legalRows}` : "rows policy"}>
          {rows.map(([title, copy]) => (
            <div key={title}><dt>{title}</dt><dd>{copy}</dd></div>
          ))}
        </dl>
      </section>
      <SiteFooter />
    </main>
  );
}
