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
          <p className="line"><span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <span className="cmd">echo "received"</span></p>
          <p className="out wrap">Thanks. If you meant to create an account, continue from signup or sign in.</p>
          <p className="out wrap muted"># what happens next</p>
          <ol className="out wrap" style={{ paddingLeft: "1.4em", margin: "4px 0 20px" }}>
            <li>Create your Frege account.</li>
            <li>Choose a plan and activate through Stripe checkout.</li>
            <li>Use the console to configure your org and MCP keys.</li>
          </ol>
          <p className="line"><span className="prompt">agent@frege</span><span className="path">:~</span><span className="sigil">$</span> <a className="lnk" href="/signup">signup</a> <a className="lnk" href="/login">login</a><span className="cursor" aria-hidden="true">█</span></p>
        </section>
      </main>
    </>
  );
}
