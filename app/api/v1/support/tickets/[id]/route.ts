import { authenticateAdminRequest } from "@/lib/core/admin-auth";
import { routeError } from "@/lib/core/request-guards";
import { handleCustomerTicketDetailRequest } from "@/lib/core/support-tickets";
import { customerSupportTicketDeps } from "@/lib/core/support-tickets-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Org admin: ticket detail + thread. Cross-org access reads as 404, matching
// the platform-route convention of not revealing other orgs' resources.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authResult = await authenticateAdminRequest(req);
    if (!authResult.ok) return authResult.response;

    const { id } = await params;
    return await handleCustomerTicketDetailRequest(req, authResult.auth, id, customerSupportTicketDeps());
  } catch (err) {
    return routeError("support ticket detail failed", err);
  }
}
