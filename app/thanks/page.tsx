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
          <p className="out wrap">Thanks — we'll be in touch. — Frege team.</p>
          <p className="out wrap muted">Next we will confirm your first source set, trust zones, and MCP client so we can provision a pilot org.</p>
          <p className="line"><span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <a className="lnk" href="/">cd ~</a><span className="cursor" aria-hidden="true">█</span></p>
        </section>
      </main>
    </>
  );
}
