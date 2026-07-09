import { getSql } from "@/lib/db";
import { postHermesEvent } from "@/lib/hermes-webhook";
import { maybeSendHotLeadAlert } from "@/lib/core/lead-alert";
import { checkRateLimit, rateLimitedResponse } from "@/lib/core/rate-limit";
import { authenticateUserRequest } from "@/lib/core/session";
import { recordSignupMonitorEvent } from "@/lib/core/signup-monitor";
import { logTelemetryEvent } from "@/lib/core/telemetry";
import { handleWorkspaceCreateRequest } from "@/lib/core/workspace-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Workspace setup for social signups (Clerk bridge users without an org):
// provisions org + default roles + owner membership + billing selection + a
// qualified signups row in one atomic batch. Requires a valid frege_session.
// Logic lives in lib/core/workspace-core.ts (DI, testable).
export async function POST(req: Request) {
  return handleWorkspaceCreateRequest(req, {
    getSql,
    authenticateUser: authenticateUserRequest,
    checkRateLimit,
    rateLimitedResponse,
    logTelemetryEvent,
    postHermesEvent,
    recordSignupMonitorEvent,
    maybeSendHotLeadAlert,
  });
}
