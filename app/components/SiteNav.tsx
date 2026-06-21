const githubUrl = "https://github.com/Finberg-Laurelin-CEO/frege.dev";

export default function SiteNav() {
  return (
    <header className="bar" role="banner">
      <nav className="bar__nav" aria-label="Site">
        <a className="lnk" href="/">home</a>
        <a className="lnk" href="/docs">docs</a>
        <a className="lnk" href="/#how">how</a>
        <a className="lnk" href="/#memory">memory</a>
        <a className="lnk" href="/#security">security</a>
        <a className="lnk" href="/#pilot">pilot</a>
        <a className="lnk" href="/signup">claim pilot</a>
        <a className="lnk" href={githubUrl} target="_blank" rel="noreferrer">github</a>
        <a className="lnk" href="mailto:hello@frege.dev">hello@frege.dev</a>
        <a className="button button--small" href="/login?next=/admin">sign in</a>
      </nav>
      <p className="bar__hint">agent memory, governed</p>
    </header>
  );
}
