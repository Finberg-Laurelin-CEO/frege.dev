import type { Metadata } from "next";
import { oauthProvidersConfigured } from "@/lib/core/oauth-core";
import LoginPanel from "./LoginPanel";

export const metadata: Metadata = {
  title: "Login — Frege",
  robots: {
    index: false,
    follow: false,
  },
};

export const dynamic = "force-dynamic";

export default function LoginPage() {
  // Config presence only (booleans) — secrets never reach the client.
  return <LoginPanel oauthProviders={oauthProvidersConfigured()} />;
}
