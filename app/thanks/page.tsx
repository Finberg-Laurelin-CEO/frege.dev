import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Thanks — Frege",
  robots: { index: false, follow: false },
};

export default function Thanks() {
  return (
    <>
      <header className="bar" role="banner">
        <span className="bar__dots" aria-hidden="true">● ● ●</span>
        <span className="bar__title">frege — ssh agent@frege.dev</span>
        <a className="lnk" href="/">home →</a>
      </header>

      <main id="main" className="screen">
        <section aria-label="Thanks">
          <p className="line"><span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <span className="cmd">echo "submitted"</span></p>
          <p className="out wrap">Thanks — we'll be in touch. — Frege team.</p>
          <p className="out wrap muted">We will follow up with validation questions before inviting teams into the first pilot.</p>
          <p className="line"><span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <a className="lnk" href="/">cd ~</a><span className="cursor" aria-hidden="true">█</span></p>
        </section>
      </main>
    </>
  );
}
