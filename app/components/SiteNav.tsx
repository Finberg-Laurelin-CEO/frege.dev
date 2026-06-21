const githubUrl = "https://github.com/Finberg-Laurelin-CEO/frege.dev";

export default function SiteNav() {
  return (
    <header className="bar" role="banner">
      <a className="bar__brand" href="/">Frege</a>
      <nav className="bar__nav" aria-label="Site">
        <a className="lnk" href="/#how">how</a>
        <a className="lnk" href="/#memory">memory</a>
        <a className="lnk" href="/#security">security</a>
        <a className="lnk" href="/docs">docs</a>
        <a className="lnk" href={githubUrl}>github</a>
        <a className="lnk" href="/login?next=/admin">sign in</a>
        <a className="lnk lnk--cta" href="/signup">request access</a>
      </nav>
    </header>
  );
}
