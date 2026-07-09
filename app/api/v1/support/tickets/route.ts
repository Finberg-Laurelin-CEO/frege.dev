import { authenticateAdminRequest } from "@/lib/core/admin-auth";
import { assertSafeBrowserMutation, routeError } from "@/lib/core/request-guards";
import { handleCustomerTicketCreateRequest, handleCustomerTicketsListRequest } from "@/lib/core/support-tickets";
import { customerSupportTicketDeps } from "@/lib/core/support-tickets-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Org admin: list the org's own support tickets.
export async function GET(req: Request) {
  try {
    const authResult = await authenticateAdminRequest(req);
    if (!authResult.ok) return authResult.response;

    return await handleCustomerTicketsListRequest(req, authResult.auth, customerSupportTicketDeps());
  } catch (err) {
    return routeError("support tickets list failed", err);
  }
}

// Org admin: open a ticket (subject + first message). Org comes from the
// session membership; staff are notified by email when configured.
export async function POST(req: Request) {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  try {
    const authResult = await authenticateAdminRequest(req);
    if (!authResult.ok) return authResult.response;

    return await handleCustomerTicketCreateRequest(req, authResult.auth, customerSupportTicketDeps());
  } catch (err) {
    return routeError("support ticket create failed", err);
  }
}
