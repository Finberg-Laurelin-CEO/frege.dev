import { listPrototypeAuditEvents, logPrototypeAuditEvent } from "@/lib/prototype/audit";
import { assertActiveOrg, authenticatePrototypeRequest, prototypeUnauthorized } from "@/lib/prototype/auth";
import { parseLimit } from "@/lib/prototype/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function stringParam(searchParams: URLSearchParams, name: string): string | undefined {
  const value = searchParams.get(name)?.trim();
  return value || undefined;
}

export async function GET(req: Request) {
  try {
    const auth = await authenticatePrototypeRequest(req);
    if (!auth) return prototypeUnauthorized();
    const inactive = assertActiveOrg(auth);
    if (inactive) return inactive;
    if (!auth.capabilities.canReadAudit) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }

    const url = new URL(req.url);
    const limit = parseLimit(url.searchParams, 50, 100);
    const action = stringParam(url.searchParams, "action");
    const resourceType = stringParam(url.searchParams, "resource_type");
    const before = stringParam(url.searchParams, "before");
    if (before && Number.isNaN(Date.parse(before))) {
      return Response.json({ error: "invalid_before" }, { status: 400 });
    }

    const events = await listPrototypeAuditEvents(auth, {
      action,
      resourceType,
      before,
      limit,
    });

    await logPrototypeAuditEvent(auth, req, {
      action: "audit_events.list",
      resourceType: "audit_event",
      metadata: {
        action_filter: action ?? null,
        resource_type_filter: resourceType ?? null,
        before: before ?? null,
        result_count: events.length,
      },
    });

    return Response.json({ events }, { status: 200 });
  } catch (err: unknown) {
    console.error("prototype audit-events list failed", {
      message: (err as Error)?.message,
    });
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
