import { getSql } from "@/lib/db";
import {
  defaultOAuthUserStore,
  exchangeOAuthCode,
  handleOAuthCallbackRequest,
  parseOAuthProvider,
} from "@/lib/core/oauth-core";
import { checkRateLimit } from "@/lib/core/rate-limit";
import { createUserSession } from "@/lib/core/session";
import { logTelemetryEvent } from "@/lib/core/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ provider: string }>;
};

export async function GET(req: Request, context: RouteContext) {
  const { provider: rawProvider } = await context.params;
  const provider = parseOAuthProvider(rawProvider);
  if (!provider) return Response.json({ error: "oauth_not_configured" }, { status: 404 });

  return handleOAuthCallbackRequest(req, provider, {
    userStore: defaultOAuthUserStore(getSql()),
    exchangeCode: exchangeOAuthCode,
    createUserSession,
    logTelemetryEvent,
    checkRateLimit,
  });
}
