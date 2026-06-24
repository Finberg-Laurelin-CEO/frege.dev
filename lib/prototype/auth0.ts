import { NextResponse } from "next/server";
import { Auth0Client } from "@auth0/nextjs-auth0/server";

// Auth0 is the human sign-in for the admin-only deploy. The client is only
// constructed when Auth0 env vars are present (injected by the Vercel Auth0
// integration on the frege-admin project). On the main site these are unset and
// auth0 stays null, so nothing Auth0-related runs there.
function hasAuth0Env(): boolean {
  return Boolean(
    process.env.AUTH0_DOMAIN &&
      process.env.AUTH0_CLIENT_ID &&
      process.env.AUTH0_CLIENT_SECRET &&
      process.env.AUTH0_SECRET &&
      (process.env.APP_BASE_URL || process.env.AUTH0_BASE_URL),
  );
}

export function isAuth0AdminMode(): boolean {
  return process.env.FREGE_ADMIN_ONLY === "true" && hasAuth0Env();
}

export const auth0: Auth0Client | null = hasAuth0Env()
  ? new Auth0Client({
      domain: process.env.AUTH0_DOMAIN,
      clientId: process.env.AUTH0_CLIENT_ID,
      clientSecret: process.env.AUTH0_CLIENT_SECRET,
      secret: process.env.AUTH0_SECRET,
      appBaseUrl: process.env.APP_BASE_URL ?? process.env.AUTH0_BASE_URL,
      // On callback error (e.g. user cancels, connection misconfigured), show a
      // readable message instead of crashing with a 500.
      onCallback: async (error, _ctx, session) => {
        const base = process.env.APP_BASE_URL ?? process.env.AUTH0_BASE_URL ?? "";
        if (error) {
          const url = new URL("/auth/error", base);
          url.searchParams.set("error", error.code ?? "callback_error");
          if (error.message) url.searchParams.set("message", error.message);
          return NextResponse.redirect(url);
        }
        return NextResponse.redirect(new URL(session ? "/platform" : "/auth/login", base));
      },
    })
  : null;
