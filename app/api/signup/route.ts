import { getSql } from "@/lib/db";
import { postHermesEvent } from "@/lib/hermes-webhook";
import { sendEmailVerificationEmail, sendSignupWelcomeEmail } from "@/lib/core/email";
import { maybeSendHotLeadAlert } from "@/lib/core/lead-alert";
import { hashPassword } from "@/lib/core/password";
import { checkRateLimit, rateLimitedResponse } from "@/lib/core/rate-limit";
import { createUserSession } from "@/lib/core/session";
import { handleSignupRequest } from "@/lib/core/signup-flow-core";
import { recordSignupMonitorEvent } from "@/lib/core/signup-monitor";
import { logTelemetryEvent } from "@/lib/core/telemetry";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handleSignupRequest(req, {
    getSql,
    checkRateLimit,
    rateLimitedResponse,
    hashPassword,
    createUserSession,
    logTelemetryEvent,
    sendSignupWelcomeEmail,
    sendEmailVerificationEmail,
    postHermesEvent,
    recordSignupMonitorEvent,
    maybeSendHotLeadAlert,
  });
}
