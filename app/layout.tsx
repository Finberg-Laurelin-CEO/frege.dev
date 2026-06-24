import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import SiteNav from "./components/SiteNav";
import AdminNav from "./components/AdminNav";
import { isAuth0AdminMode } from "@/lib/prototype/auth0";

// The admin-only deploy (admin.frege.dev) is an operations console, not the
// public marketing site. We gate the nav and metadata on this flag.
const isAdminOnly = process.env.FREGE_ADMIN_ONLY === "true";

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

const siteMetadata: Metadata = {
  metadataBase: new URL("https://frege.dev/"),
  title: "Frege — the company brain for AI agents",
  description:
    "Frege is the company brain for AI agents: a living, permission-aware knowledge layer that turns scattered institutional know-how into an executable skills file every agent can safely use. Versioned, audited, MCP-native.",
  alternates: {
    canonical: "https://frege.dev/",
  },
  openGraph: {
    type: "website",
    url: "https://frege.dev/",
    title: "Frege — the company brain for AI agents",
    description:
      "A living map of how your company actually works — versioned, audited, permission-aware. The missing layer between raw company data and reliable AI automation.",
    siteName: "Frege",
  },
  twitter: {
    card: "summary_large_image",
    title: "Frege — the company brain for AI agents",
    description:
      "Turn scattered institutional knowledge into an executable skills file every agent can safely use. Versioned, audited, MCP-native.",
  },
};

export const metadata: Metadata = isAdminOnly ? adminMetadata : siteMetadata;

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
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>
        <a className="skip" href="#main">skip to content</a>
        {isAdminOnly ? <AdminNav auth0={isAuth0AdminMode()} /> : <SiteNav />}
        {children}
        <Analytics />
      </body>
    </html>
  );
}
