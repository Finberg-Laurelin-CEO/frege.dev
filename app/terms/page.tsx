import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms — Frege",
  description: "Terms of use for the Frege early-access site.",
};

export default function Terms() {
  return (
    <>
      <header className="bar" role="banner">
        <span className="bar__dots" aria-hidden="true">● ● ●</span>
        <span className="bar__title">frege — ssh agent@frege.dev</span>
        <a className="lnk" href="/">home →</a>
      </header>

      <main id="main" className="screen">
        <section aria-label="Terms of use">
          <p className="line"><span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <span className="cmd">cat terms.txt</span></p>
          <p className="out wrap cmt"># frege terms of use · validation stage · last updated 2026-06-07.</p>
          <dl className="rows policy">
            <div><dt>what this is</dt><dd>this site is an early-access page for Frege. it collects expressions of interest for a founding pilot. it is not yet a product you can log into.</dd></div>
            <div><dt>no warranty</dt><dd>the site and any information on it are provided "as is" during validation, without warranties of any kind. features described are forward-looking and may change.</dd></div>
            <div><dt>your submission</dt><dd>by submitting the form you confirm the information is accurate and that you are authorized to share it. handling of your data is described in our <a className="lnk" href="/privacy">privacy policy</a>.</dd></div>
            <div><dt>acceptable use</dt><dd>do not submit confidential company documents, source code, customer data, or API keys through this site. we do not ask for them.</dd></div>
            <div><dt>contact</dt><dd>questions about these terms: <a className="lnk" href="mailto:hello@frege.dev">hello@frege.dev</a></dd></div>
          </dl>
          <p className="line"><span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <a className="lnk" href="/">cd ~</a><span className="cursor" aria-hidden="true">█</span></p>
        </section>
      </main>
    </>
  );
}
