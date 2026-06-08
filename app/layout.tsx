import type { Metadata } from "next";
import Script from "next/script";

export const metadata: Metadata = {
  metadataBase: new URL("https://frege.dev/"),
  title: "Frege — make institutional knowledge executable",
  description:
    "Frege is the semantic brain for your company: a secure, permission-aware knowledge layer that gives AI agents the right institutional context with version history and audit logs.",
  alternates: {
    canonical: "https://frege.dev/",
  },
  openGraph: {
    type: "website",
    url: "https://frege.dev/",
    title: "Frege — make institutional knowledge executable",
    description:
      "Frege turns institutional knowledge into secure, versioned, permission-aware tools for Codex, Claude Code, OpenRouter, and internal agents.",
    siteName: "Frege",
  },
  twitter: {
    card: "summary",
    title: "Frege — make institutional knowledge executable",
    description:
      "The semantic brain for your company: secure, versioned institutional context for every AI agent stack.",
  },
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%23ffffff'/%3E%3Ctext x='7' y='23' font-family='monospace' font-size='20' fill='%23000'%3EF%3C/text%3E%3C/svg%3E",
  },
};

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
        <link rel="stylesheet" href="/signup.css" />
      </head>
      <body>
        {children}
        <Script src="/nav.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
