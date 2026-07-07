import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms — Frege",
  description: "Terms of use for Frege.",
};

export default function Terms() {
  return (
    <>
      <main id="main" className="screen">
        <section aria-label="Terms of use">
          <p className="line"><span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <span className="cmd">cat terms.txt</span></p>
          <p className="out wrap cmt"># frege terms of use · last updated 2026-07-06.</p>
          <dl className="rows policy">
            <div><dt>what this is</dt><dd>Frege is a hosted agent-memory product. signup creates an account and organization; billing and promotion codes are handled through Stripe checkout.</dd></div>
            <div><dt>no warranty</dt><dd>the site and product are provided "as is" unless a separate written agreement says otherwise. features described may change.</dd></div>
            <div><dt>your account</dt><dd>by signing up you confirm the information is accurate and that you are authorized to create the organization. handling of your data is described in our <a className="lnk" href="/privacy">privacy policy</a>.</dd></div>
            <div><dt>acceptable use</dt><dd>do not submit confidential company documents, source code, customer data, or API keys through this site. we do not ask for them.</dd></div>
            <div><dt>contact</dt><dd>questions about these terms: <a className="lnk" href="mailto:hello@frege.dev">hello@frege.dev</a></dd></div>
          </dl>
          <p className="line"><span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <a className="lnk" href="/">cd ~</a><span className="cursor" aria-hidden="true">█</span></p>
        </section>
      </main>
    </>
  );
}
