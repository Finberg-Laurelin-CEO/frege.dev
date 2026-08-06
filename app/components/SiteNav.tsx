"use client";

import { usePathname } from "next/navigation";
import styles from "../public-v2.module.css";

const githubUrl = "https://github.com/Finberg-Laurelin-CEO/frege.dev";

const publicV2Routes = new Set([
  "/",
  "/architecture",
  "/contact",
  "/docs",
  "/pricing",
  "/privacy",
  "/report-a-bug",
  "/roadmap",
  "/terms",
]);

export default function SiteNav({ publicV2 = false }: { publicV2?: boolean }) {
  const pathname = usePathname();
  const showPublicV2 = publicV2 && publicV2Routes.has(pathname);

  if (showPublicV2) {
    return (
      <header className={styles.nav} role="banner">
        <a className={styles.navBrand} href="/">Frege</a>
        <nav className={styles.navLinks} aria-label="Site">
          <a href="/#demo">product</a>
          <a href="/architecture">architecture</a>
          <a href="/docs">docs</a>
          <a href="/pricing">pricing</a>
          <a href="/roadmap">roadmap</a>
          <a href={githubUrl}>github</a>
          <a href="/login?next=/console">sign in</a>
          <a className={styles.navCta} href="/signup">start now</a>
        </nav>
      </header>
    );
  }

  return (
    <header className="bar" role="banner">
      <a className="bar__brand" href="/">Frege</a>
      <nav className="bar__nav" aria-label="Site">
        <a className="lnk" href="/docs">docs</a>
        <a className="lnk" href="/architecture">architecture</a>
        <a className="lnk" href="/pricing">pricing</a>
        <a className="lnk" href={githubUrl}>github</a>
        <a className="lnk" href="/login?next=/console">sign in</a>
        <a className="lnk lnk--cta" href="/signup">sign up</a>
      </nav>
    </header>
  );
}
