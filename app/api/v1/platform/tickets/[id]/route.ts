import { authenticatePlatformStaff } from "@/lib/core/platform-auth";
import { assertSafeBrowserMutation, routeError } from "@/lib/core/request-guards";
import { handleStaffTicketDetailRequest, handleStaffTicketPatchRequest } from "@/lib/core/support-tickets";
import { staffSupportTicketDeps } from "@/lib/core/support-tickets-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Staff: ticket detail with the full message thread and org/billing context.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const staff = await authenticatePlatformStaff(req);
    if (!staff.ok) return staff.response;

    const { id } = await params;
    return await handleStaffTicketDetailRequest(req, id, staffSupportTicketDeps(staff.auth));
  } catch (err) {
    return routeError("platform ticket detail failed", err);
  }
}

// Staff: update status/priority/assignment. resolved/closed stamps
// resolved_at; reopening clears it.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  try {
    const staff = await authenticatePlatformStaff(req);
    if (!staff.ok) return staff.response;

    const { id } = await params;
    return await handleStaffTicketPatchRequest(req, staff.auth, id, staffSupportTicketDeps(staff.auth));
  } catch (err) {
    return routeError("platform ticket update failed", err);
  }
}
