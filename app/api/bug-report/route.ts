import { handleBugReportRequest } from "@/lib/bug-report";
import { assertSafeBrowserMutation } from "@/lib/core/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  return handleBugReportRequest(req, {
    formId: process.env.FORMSPREE_BUG_REPORT_FORM_ID,
    fetch,
  });
}
