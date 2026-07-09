import { authenticateAdminRequest } from "@/lib/core/admin-auth";
import { assertSafeBrowserMutation, routeError } from "@/lib/core/request-guards";
import { handleCustomerTicketReplyRequest } from "@/lib/core/support-tickets";
import { customerSupportTicketDeps } from "@/lib/core/support-tickets-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Org admin: reply on the org's own ticket. Flips pending -> open so the
// ticket lands back in staff's queue; closed tickets reject replies.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  try {
    const authResult = await authenticateAdminRequest(req);
    if (!authResult.ok) return authResult.response;

    const { id } = await params;
    return await handleCustomerTicketReplyRequest(req, authResult.auth, id, customerSupportTicketDeps());
  } catch (err) {
    return routeError("support ticket reply failed", err);
  }
}
