import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Thanks — Frege",
  robots: { index: false, follow: false },
};

export default function Thanks() {
  return (
    <>
      <main id="main" className="screen">
        <section aria-label="Thanks">
          <p className="line"><span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <span className="cmd">echo "submitted"</span></p>
          <p className="out wrap">Thanks — we&apos;ll reply within two business days. — Frege team.</p>
          <p className="out wrap muted"># what happens next</p>
          <ol className="out wrap" style={{ paddingLeft: "1.4em", margin: "4px 0 20px" }}>
            <li>We review your request and confirm pilot fit.</li>
            <li>We book a short onboarding call to set trust zones and pick your first sources.</li>
            <li>We provision your hosted brain and issue your first MCP key.</li>
          </ol>
          <p className="line"><span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <a className="lnk" href="/">cd ~</a><span className="cursor" aria-hidden="true">█</span></p>
        </section>
      </main>
    </>
  );
}
