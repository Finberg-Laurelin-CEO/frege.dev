import { getSql } from "@/lib/db";
import { sendLoginLinkEmail } from "@/lib/core/email";
import { handleLoginLinkConfirm } from "@/lib/core/login-link";
import { checkRateLimit, rateLimitedResponse } from "@/lib/core/rate-limit";
import { routeError } from "@/lib/core/request-guards";
import { createUserSession } from "@/lib/core/session";
import { logTelemetryEvent } from "@/lib/core/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Email sign-in link, step 2: GET ?token= → validate unused + unexpired, mark
// used, mint the normal frege_session, 302 to /console (or the validated
// next). Invalid/expired links land on /login?error=login_link_invalid; this
// handler never returns a raw 500 (users arrive here from an email link).
export async function GET(req: Request) {
  return handleLoginLinkConfirm(req, {
    getSql,
    checkRateLimit,
    rateLimitedResponse,
    createUserSession,
    logTelemetryEvent,
    sendLoginLinkEmail,
    routeError,
  });
}
