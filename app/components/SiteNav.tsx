const githubUrl = "https://github.com/Finberg-Laurelin-CEO/frege.dev";

export default function SiteNav() {
  return (
    <header className="bar" role="banner">
      <a className="bar__brand" href="/">Frege</a>
      <nav className="bar__nav" aria-label="Site">
        <a className="lnk" href="/docs">docs</a>
        <a className="lnk" href="/architecture">architecture</a>
        <a className="lnk" href="/pricing">pricing</a>
        <a className="lnk" href={githubUrl}>github</a>
        <a className="lnk" href="/login?next=/admin">sign in</a>
        <a className="lnk lnk--cta" href="/signup">request access</a>
      </nav>
    </header>
  );
}
