import type { Metadata } from "next";
import SiteFooter from "../components/SiteFooter";
import v2Styles from "../secondary-public-v2.module.css";
import BugReportForm from "./BugReportForm";
import styles from "./report-a-bug.module.css";

const publicSiteV2 = process.env.FREGE_PUBLIC_SITE_V2 === "true";

export const metadata: Metadata = {
  title: "Report a bug — Frege",
  description: "Report a reproducible problem with Frege.",
  alternates: { canonical: "https://frege.dev/report-a-bug" },
};

export default function ReportABugPage() {
  return (
    <main
      id="main"
      className={publicSiteV2 ? `${v2Styles.page} ${styles.v2}` : "docs"}
    >
      <header className="docs__head">
        <p className="eyebrow">Support</p>
        <h1>Report a bug.</h1>
        <p>
          Give us a concise, reproducible report. For account or billing help, use the{" "}
          <a className="lnk" href="/contact">contact page</a> instead.
        </p>
      </header>

      <section className={styles.formSection} aria-label="Bug report form">
        <BugReportForm />
      </section>

      <SiteFooter />
    </main>
  );
}
