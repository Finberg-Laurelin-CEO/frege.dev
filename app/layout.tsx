import type { Metadata } from "next";
import Script from "next/script";

export const metadata: Metadata = {
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
        {children}
        <Script src="/nav.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
