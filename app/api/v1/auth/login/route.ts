import { getSql } from "@/lib/db";
import { handleLoginRequest } from "@/lib/core/auth-flow-core";
import { verifyPassword } from "@/lib/core/password";
import { checkRateLimit, rateLimitedResponse } from "@/lib/core/rate-limit";
import { routeError } from "@/lib/core/request-guards";
import { createUserSession } from "@/lib/core/session";
import { logTelemetryEvent } from "@/lib/core/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handleLoginRequest(req, {
    getSql,
    checkRateLimit,
    rateLimitedResponse,
    createUserSession,
    logTelemetryEvent,
    routeError,
    verifyPassword,
  });
}
