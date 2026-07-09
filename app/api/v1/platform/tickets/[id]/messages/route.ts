import { authenticatePlatformStaff } from "@/lib/core/platform-auth";
import { assertSafeBrowserMutation, routeError } from "@/lib/core/request-guards";
import { handleStaffTicketReplyRequest } from "@/lib/core/support-tickets";
import { staffSupportTicketDeps } from "@/lib/core/support-tickets-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Staff: reply on a ticket. Stamps first_response_at on the first staff reply,
// flips open -> pending, and emails the ticket creator (best-effort).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  try {
    const staff = await authenticatePlatformStaff(req);
    if (!staff.ok) return staff.response;

    const { id } = await params;
    return await handleStaffTicketReplyRequest(req, staff.auth, id, staffSupportTicketDeps(staff.auth));
  } catch (err) {
    return routeError("platform ticket reply failed", err);
  }
}
