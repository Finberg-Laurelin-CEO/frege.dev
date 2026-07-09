import type { ReactNode } from "react";
import { oauthProvidersConfigured } from "@/lib/core/oauth-core";

// Server wrapper for the (client) signup page. It exists so we can check OAuth
// env config on the server and render a sign-in hint without touching the
// signup form itself — config presence only, no secrets reach the client.
export default function SignupLayout({ children }: { children: ReactNode }) {
  const providers = oauthProvidersConfigured();
  const anyProvider = providers.google || providers.github;

  return (
    <>
      {children}
      {anyProvider ? (
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
