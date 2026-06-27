import { getSql } from "@/lib/db";
import { handleInviteAcceptRequest } from "@/lib/prototype/auth-flow-core";
import { hashPassword } from "@/lib/prototype/password";
import { checkRateLimit, rateLimitedResponse } from "@/lib/prototype/rate-limit";
import { routeError } from "@/lib/prototype/request-guards";
import { createUserSession } from "@/lib/prototype/session";
import { logTelemetryEvent } from "@/lib/prototype/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handleInviteAcceptRequest(req, {
    getSql,
    checkRateLimit,
    rateLimitedResponse,
    createUserSession,
    logTelemetryEvent,
    routeError,
    hashPassword,
  });
}
