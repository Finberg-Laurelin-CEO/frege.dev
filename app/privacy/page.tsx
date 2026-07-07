import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy — Frege",
  description:
    "Frege privacy policy: what we collect during signup, why, how it is stored, and your rights.",
};

export default function Privacy() {
  return (
    <>
      <main id="main" className="screen">
        <section aria-label="Privacy policy">
          <p className="line"><span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <span className="cmd">cat privacy-policy.txt</span></p>
          <p className="out wrap cmt"># frege privacy policy · last updated 2026-07-06. plain language, no dark patterns.</p>
          <dl className="rows policy">
            <div><dt>what we collect</dt><dd>what you type during signup: name, work email, company, password (stored only as a hash), role/title if provided, org size, optional other info, billing status from Stripe, and permission to contact you. nothing else.</dd></div>
            <div><dt>what we never collect</dt><dd>we do not ask for, store, or transmit your company documents, source code, customer data, or API keys through this site. there is no tracking pixel, no third-party analytics, and no advertising cookie on this page.</dd></div>
            <div><dt>why we collect it</dt><dd>to create your account, provision your organization, process billing, support the product, and contact you about Frege.</dd></div>
            <div><dt>how it is stored</dt><dd>account and signup records are written to a private Postgres database. billing is handled by Stripe. data is encrypted in transit (TLS) and at rest.</dd></div>
            <div><dt>sharing</dt><dd>we do not sell your data and do not share it with advertisers. limited processors (database host, Stripe, email) act on our instructions under contract.</dd></div>
            <div><dt>retention</dt><dd>we keep account and billing records while your account is active and as needed for security, legal, and operational purposes.</dd></div>
            <div><dt>your rights</dt><dd>email <a className="lnk" href="mailto:hello@frege.dev">hello@frege.dev</a> any time to access, correct, or delete your data, or to opt out of contact. we will action it.</dd></div>
            <div><dt>contact</dt><dd><a className="lnk" href="mailto:hello@frege.dev">hello@frege.dev</a></dd></div>
          </dl>
          <p className="line"><span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <a className="lnk" href="/">cd ~</a><span className="cursor" aria-hidden="true">█</span></p>
        </section>
      </main>
    </>
  );
}
