import type { ReactNode } from "react";
import { oauthProvidersConfigured } from "@/lib/core/oauth-core";

// Server wrapper for the (client) signup page. It exists so we can check OAuth
// env config on the server and render a sign-in hint without touching the
// signup form itself — config presence only, no secrets reach the client.
//
// Clerk mode (publishable key present) wins over the hand-rolled providers:
// the Clerk handshake runs client-side on the login page, so the hint sends
// users there instead of the (dormant) hand-rolled start routes.
export default function SignupLayout({ children }: { children: ReactNode }) {
  const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const providers = oauthProvidersConfigured();
  const anyProvider = providers.google || providers.github;

  return (
    <>
      {children}
      {clerkEnabled ? (
        <p
          style={{ textAlign: "center", margin: "0 auto 3rem", maxWidth: "40rem" }}
          aria-label="Single sign-on"
        >
          Prefer single sign-on? {" "}
          <a className="lnk" href="/login">
            Continue with Google or GitHub
          </a>
          {" "} from the login page — an account is created automatically.
        </p>
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
