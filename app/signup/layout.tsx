import type { ReactNode } from "react";
import { oauthProvidersConfigured } from "@/lib/core/oauth-core";
import SignupSso from "./SignupSso";

// Server wrapper for the (client) signup page. It exists so we can check OAuth
// env config on the server and render the social-signup block without touching
// the signup form itself — config presence only, no secrets reach the client
// (the Clerk publishable key is public by design).
//
// Clerk mode (publishable key present) wins over the hand-rolled providers:
// the Clerk handshake runs client-side right here (SignupSso shares the exact
// login-page flow via app/components/clerk-client.ts).
export default function SignupLayout({ children }: { children: ReactNode }) {
  const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? null;
  const providers = oauthProvidersConfigured();
  const anyProvider = providers.google || providers.github;

  return (
    <>
      {children}
      {clerkPublishableKey ? (
        <SignupSso clerkPublishableKey={clerkPublishableKey} />
      ) : anyProvider ? (
        <p
          style={{ textAlign: "center", margin: "0 auto 3rem", maxWidth: "40rem" }}
          aria-label="Single sign-on"
        >
          Prefer single sign-on? {" "}
          {providers.google ? (
            <a className="lnk" href="/api/v1/auth/oauth/google/start">
              Continue with Google
            </a>
          ) : null}
          {providers.google && providers.github ? <> {" · "} </> : null}
          {providers.github ? (
            <a className="lnk" href="/api/v1/auth/oauth/github/start">
              Continue with GitHub
            </a>
          ) : null}
        </p>
      ) : null}
    </>
  );
}
