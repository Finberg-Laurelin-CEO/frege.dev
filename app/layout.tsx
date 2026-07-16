import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import SiteNav from "./components/SiteNav";
import AdminNav from "./components/AdminNav";
import { isAuth0AdminMode } from "@/lib/core/auth0";

// The admin-only deploy (admin.frege.dev) is an operations console, not the
// public marketing site. We gate the nav and metadata on this flag.
const isAdminOnly = process.env.FREGE_ADMIN_ONLY === "true";
const publicSiteV2 = process.env.FREGE_PUBLIC_SITE_V2 === "true";

// Marketing metadata for the public site. On the admin-only deploy we serve a
// minimal noindex shell instead so the operations console is never indexed and
// never advertises the marketing brand.
const adminMetadata: Metadata = {
  title: "Frege Admin",
  robots: {
    index: false,
    follow: false,
  },
};

const legacySiteMetadata: Metadata = {
  metadataBase: new URL("https://frege.dev/"),
  title: "Frege — one governed brain for your AI agents",
  description:
    "For platform & AI teams running multiple agents: when ad-hoc CLAUDE.md files drift and leak, Frege gives every agent one shared memory layer — scoped, cited context with access control, audit, and reviewable writes. MCP-native.",
  alternates: {
    canonical: "https://frege.dev/",
  },
  openGraph: {
    type: "website",
    url: "https://frege.dev/",
    title: "Your agents share a company. They should share a brain.",
    description:
      "Frege is the governed memory layer for teams running multiple agents: scoped, cited context with role and trust-zone access control, audit, and reviewable writes. MCP-native.",
    siteName: "Frege",
  },
  twitter: {
    card: "summary_large_image",
    title: "Your agents share a company. They should share a brain.",
    description:
      "When ad-hoc CLAUDE.md files drift and leak, Frege gives every agent one governed memory layer — scoped, cited context with access control, audit, and reviewable writes.",
  },
};

const publicV2Metadata: Metadata = {
  metadataBase: new URL("https://frege.dev/"),
  title: "Frege — one governed operating layer for your AI agents",
  description:
    "Frege gives MCP-connected agents governed organizational memory, scoped and cited context, and reviewable updates without locking company knowledge to one model.",
  alternates: { canonical: "https://frege.dev/" },
  openGraph: {
    type: "website",
    url: "https://frege.dev/",
    title: "Many agents. One organizational reality.",
    description:
      "Governed organizational memory and scoped, cited context for the agents your team already uses.",
    siteName: "Frege",
  },
  twitter: {
    card: "summary_large_image",
    title: "Many agents. One organizational reality.",
    description:
      "Frege is building the operating system for AI agents, starting with governed memory and context.",
  },
};

export const metadata: Metadata = isAdminOnly
  ? adminMetadata
  : publicSiteV2
    ? publicV2Metadata
    : legacySiteMetadata;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link
          rel="preload"
          href="/fonts/DepartureMono-Regular.woff2"
          as="font"
          type="font/woff2"
          crossOrigin=""
        />
        {publicSiteV2 ? (
          <link
            rel="preload"
            href="/fonts/Newsreader-Variable.woff2"
            as="font"
            type="font/woff2"
            crossOrigin=""
          />
        ) : null}
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>
        <a className="skip" href="#main">skip to content</a>
        {isAdminOnly ? <AdminNav auth0={isAuth0AdminMode()} /> : <SiteNav publicV2={publicSiteV2} />}
        {children}
        <Analytics />
      </body>
    </html>
  );
}
