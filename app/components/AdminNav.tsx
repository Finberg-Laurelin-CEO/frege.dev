// Admin shell navigation. Rendered on the admin-only deploy (admin.frege.dev)
// in place of the public marketing SiteNav. It intentionally omits all public
// links (how, memory, security, pricing, docs, GitHub, signup) and only
// surfaces operations entry points.
export default function AdminNav({ auth0 }: { auth0: boolean }) {
  return (
    <header className="bar" role="banner">
      <a className="bar__brand" href="/platform">Frege Admin</a>
      <nav className="bar__nav" aria-label="Admin">
        <a className="lnk" href="/platform">platform</a>
        <a className="lnk" href="/admin">org admin</a>
        {auth0 ? (
          <a className="lnk lnk--cta" href="/auth/logout">logout</a>
        ) : null}
      </nav>
    </header>
  );
}
