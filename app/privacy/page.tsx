import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy — Frege",
  description:
    "Frege privacy policy: what we collect on the early-access form, why, how it is stored, and your rights.",
};

export default function Privacy() {
  return (
    <>
      <main id="main" className="screen">
        <section aria-label="Privacy policy">
          <p className="line"><span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <span className="cmd">cat privacy-policy.txt</span></p>
          <p className="out wrap cmt"># frege privacy policy · last updated 2026-06-07. plain language, no dark patterns.</p>
          <dl className="rows policy">
            <div><dt>what we collect</dt><dd>only what you type into the early-access form: name, work email, company, role, company size, expected users, current agent tools, monthly AI spend, what you'd expect to pay, decision timeline, your main pain point, and any optional comments. nothing else.</dd></div>
            <div><dt>what we never collect</dt><dd>we do not ask for, store, or transmit your company documents, source code, customer data, or API keys through this site. there is no tracking pixel, no third-party analytics, and no advertising cookie on this page.</dd></div>
            <div><dt>why we collect it</dt><dd>to evaluate early demand, gauge fit for a pilot, and reach out about early access. that is the only purpose.</dd></div>
            <div><dt>how it is stored</dt><dd>submissions are written to a private Postgres database with access limited to the Frege founding team. data is encrypted in transit (TLS) and at rest.</dd></div>
            <div><dt>sharing</dt><dd>we do not sell your data and do not share it with advertisers. limited processors (database host, email) act on our instructions under contract.</dd></div>
            <div><dt>retention</dt><dd>we keep early-access submissions until the validation phase ends, then delete or anonymize records we no longer need.</dd></div>
            <div><dt>your rights</dt><dd>email <a className="lnk" href="mailto:hello@frege.dev">hello@frege.dev</a> any time to access, correct, or delete your data, or to opt out of contact. we will action it.</dd></div>
            <div><dt>contact</dt><dd><a className="lnk" href="mailto:hello@frege.dev">hello@frege.dev</a></dd></div>
          </dl>
          <p className="line"><span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <a className="lnk" href="/">cd ~</a><span className="cursor" aria-hidden="true">█</span></p>
        </section>
      </main>
    </>
  );
}
