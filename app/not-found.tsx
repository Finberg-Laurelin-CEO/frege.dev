import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "404 — Frege",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main id="main" className="screen">
      <section aria-label="Page not found">
        <p className="line">
          <span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <span className="cmd">frege open ./requested-page</span>
        </p>
        <p className="out wrap cmt"># 404: page not found</p>
        <p className="out wrap">
          The path you requested does not exist, or it moved. No context was returned
          and nothing was logged against your trust zone.
        </p>
        <p className="line">
          <span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span>{" "}
          <a className="lnk" href="/">cd ~</a> <a className="lnk" href="/docs">man frege</a>
          <span className="cursor" aria-hidden="true">█</span>
        </p>
      </section>
    </main>
  );
}
