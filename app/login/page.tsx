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
  // Config presence only (booleans) — secrets never reach the client. The Clerk
  // publishable key is public by design (it boots clerk-js in the browser);
  // when present, Clerk mode takes precedence over the hand-rolled providers.
  return (
    <LoginPanel
      oauthProviders={oauthProvidersConfigured()}
      clerkPublishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? null}
    />
  );
}
