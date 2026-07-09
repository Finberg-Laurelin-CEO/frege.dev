import { getSql } from "@/lib/db";
import {
  fetchClerkUser,
  handleClerkBridgeRequest,
  verifyClerkSessionToken,
} from "@/lib/core/clerk-auth";
import { defaultOAuthUserStore } from "@/lib/core/oauth-core";
import { checkRateLimit, rateLimitedResponse } from "@/lib/core/rate-limit";
import { createUserSession } from "@/lib/core/session";
import { logTelemetryEvent } from "@/lib/core/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Clerk → Frege session bridge. The browser signs in with Clerk (clerk-js on
// the login page), then POSTs the Clerk session JWT here; we verify it against
// CLERK_SECRET_KEY, link-or-create the user through the shared OAuth user
// store, and mint the normal frege_session cookie. 404s until Clerk keys are
// provisioned (Vercel marketplace integration).
export async function POST(req: Request) {
  return handleClerkBridgeRequest(req, {
    userStore: defaultOAuthUserStore(getSql()),
    verifyClerkToken: verifyClerkSessionToken,
    getClerkUser: fetchClerkUser,
    createUserSession,
    logTelemetryEvent,
    checkRateLimit,
    rateLimitedResponse,
  });
}
