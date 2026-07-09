import { getSql } from "@/lib/db";
import { handleInviteAcceptRequest } from "@/lib/core/auth-flow-core";
import { hashPassword } from "@/lib/core/password";
import { checkRateLimit, rateLimitedResponse } from "@/lib/core/rate-limit";
import { routeError } from "@/lib/core/request-guards";
import { createUserSession } from "@/lib/core/session";
import { logTelemetryEvent } from "@/lib/core/telemetry";

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
