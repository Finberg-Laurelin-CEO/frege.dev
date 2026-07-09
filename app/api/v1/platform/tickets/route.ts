import { authenticatePlatformStaff } from "@/lib/core/platform-auth";
import { routeError } from "@/lib/core/request-guards";
import { handleStaffTicketsListRequest } from "@/lib/core/support-tickets";
import { staffSupportTicketDeps } from "@/lib/core/support-tickets-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Staff: list support tickets across all orgs, filterable by status/priority/
// assignee, newest-updated first, with org + billing context per row.
export async function GET(req: Request) {
  try {
    const staff = await authenticatePlatformStaff(req);
    if (!staff.ok) return staff.response;

    return await handleStaffTicketsListRequest(req, staff.auth, staffSupportTicketDeps(staff.auth));
  } catch (err) {
    return routeError("platform tickets list failed", err);
  }
}
