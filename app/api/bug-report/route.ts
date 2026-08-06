import { handleBugReportRequest } from "@/lib/core/bug-report-flow";
import { checkRateLimit, rateLimitedResponse } from "@/lib/core/rate-limit";
import { assertSafeBrowserMutation } from "@/lib/core/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  return handleBugReportRequest(req, {
    apiKey: process.env.AGENTMAIL_BUG_REPORT_API_KEY,
    fetch,
    checkRateLimit,
    rateLimitedResponse,
  });
}
