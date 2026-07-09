"use client";

import { useEffect, useState } from "react";
import {
  appOrigin,
  clerkOAuthStatusText,
  finishClerkBridgeCallback,
  startClerkOAuth,
} from "@/app/components/clerk-client";

// Social signup on /signup (Clerk mode): the same Clerk browser flow as the
// login page, shared via app/components/clerk-client.ts. Clerk returns the
// browser to /signup?clerk=cb; the bridge mints the frege_session and reports
// flow/hasOrg so brand-new (or org-less) users continue to /setup-workspace.
export default function SignupSso({ clerkPublishableKey }: { clerkPublishableKey: string }) {
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);

  async function start(provider: "google" | "github") {
    setPending(true);
    setStatus(`redirecting to ${provider}...`);
    try {
      await startClerkOAuth(clerkPublishableKey, provider, "/signup?clerk=cb");
    } catch {
      setStatus(clerkOAuthStatusText.oauth_failed);
      setPending(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("clerk") !== "cb") return;

    let cancelled = false;

    (async () => {
      setPending(true);
      setStatus("finishing sign-up...");

      const result = await finishClerkBridgeCallback(clerkPublishableKey, {});
      if (cancelled) return;

      if (!result.ok) {
        setStatus(clerkOAuthStatusText[result.code] ?? clerkOAuthStatusText.oauth_failed);
        setPending(false);
        return;
      }

      setStatus("Signed in. Redirecting...");
      const destination =
        result.flow === "created" || result.hasOrg === false
          ? "/setup-workspace"
          : result.next && result.next.startsWith("/") && !result.next.startsWith("//")
            ? result.next
            : "/console";
      window.location.href = `${appOrigin()}${destination}`;
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clerkPublishableKey]);

  return (
    <div style={{ textAlign: "center", margin: "0 auto 3rem", maxWidth: "40rem" }} aria-label="Social signup">
      <p style={{ margin: "0 0 10px" }}>Or create your account with single sign-on — workspace setup follows.</p>
      <p style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap", margin: 0 }}>
        <button className="button" type="button" disabled={pending} onClick={() => start("google")}>
          Sign up with Google
        </button>
        <button className="button" type="button" disabled={pending} onClick={() => start("github")}>
          Sign up with GitHub
        </button>
      </p>
      {status ? (
        <p role="status" aria-live="polite" style={{ margin: "10px 0 0" }}>
          {status}
        </p>
      ) : null}
    </div>
  );
}
