import { getSql } from "@/lib/db";
import { sendLoginLinkEmail } from "@/lib/core/email";
import { handleLoginLinkRequest } from "@/lib/core/login-link";
import { checkRateLimit, rateLimitedResponse } from "@/lib/core/rate-limit";
import { routeError } from "@/lib/core/request-guards";
import { createUserSession } from "@/lib/core/session";
import { logTelemetryEvent } from "@/lib/core/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Email sign-in link, step 1: POST {email} → always 200 {ok:true} (no user
// enumeration). If the account exists and is active, a single-use 15-minute
// token is emailed. Logic lives in lib/core/login-link.ts (DI, testable).
export async function POST(req: Request) {
  return handleLoginLinkRequest(req, {
    getSql,
    checkRateLimit,
    rateLimitedResponse,
    createUserSession,
    logTelemetryEvent,
    sendLoginLinkEmail,
    routeError,
  });
}
