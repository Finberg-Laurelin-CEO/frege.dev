const githubUrl = "https://github.com/Finberg-Laurelin-CEO/frege.dev";

// Shared marketing footer. Every public page renders this so privacy, terms,
// and contact are always one click away.
export default function SiteFooter() {
  return (
    <footer className="foot">
      <div className="foot__top" aria-hidden="true" />
      <div className="foot__row">
        <span>Frege — agent memory, governed.</span>
        <span className="foot__links">
          <a href="/docs">docs</a>
          <a href="/architecture">architecture</a>
          <a href="/pricing">pricing</a>
          <a href="/contact">contact</a>
          <a href="/signup">sign up</a>
          <a href="/login?next=/console">sign in</a>
          <a href={githubUrl}>github</a>
          <a href="mailto:hello@frege.dev">hello@frege.dev</a>
          <a href="/privacy">privacy</a>
          <a href="/terms">terms</a>
        </span>
      </div>
    </footer>
  );
}
