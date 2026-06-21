export default function SiteNav() {
  return (
    <header className="bar" role="banner">
      <nav className="bar__nav" aria-label="Site">
        <a className="lnk" data-nav href="/prototype">prototype</a>
        <a className="lnk" data-nav href="/admin">admin</a>
        <a className="lnk" data-nav href="/login">login</a>
        <a className="lnk" data-nav href="/setup">setup</a>
        <a className="lnk" data-nav href="/signup">claim pilot</a>
        <a className="lnk" data-nav href="/">home</a>
        <a className="lnk" data-nav href="/#status">status</a>
        <a className="lnk" data-nav href="/#how">how</a>
        <a className="lnk" data-nav href="/#memory">memory</a>
        <a className="lnk" data-nav href="/#applications">apps</a>
        <a className="lnk" data-nav href="/#privacy">privacy</a>
        <a className="lnk" data-nav href="/#soc2">soc2</a>
        <a className="lnk" data-nav href="mailto:hello@frege.dev">hello@frege.dev</a>
      </nav>
      <p className="bar__hint">1-9 nav · C-p/C-n line · [ ] page · &lt; &gt; top/bottom</p>
    </header>
  );
}
