import { logPrototypeAuditEvent } from "@/lib/prototype/audit";
import { assertActiveOrg, authenticatePrototypeRequest, prototypeUnauthorized } from "@/lib/prototype/auth";
import { parseLimit } from "@/lib/prototype/documents";
import { getContextMap } from "@/lib/prototype/semantic-map";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await authenticatePrototypeRequest(req);
    if (!auth) return prototypeUnauthorized();
    const inactive = assertActiveOrg(auth);
    if (inactive) return inactive;

    const url = new URL(req.url);
    const slug = url.searchParams.get("slug")?.trim() ?? "";
    if (!slug) return Response.json({ error: "missing_slug" }, { status: 400 });

    const limit = parseLimit(url.searchParams, 8, 20);
    const context = await getContextMap(auth, slug, limit);
    if (!context) return Response.json({ error: "not_found" }, { status: 404 });

    await logPrototypeAuditEvent(auth, req, {
      action: "map.context",
      resourceType: "knowledge_document",
      resourceId: context.source.id,
      metadata: {
        slug,
        link_count: context.links.length,
        concept_count: context.concepts.length,
        chunk_count: context.chunks.length,
      },
    });

    return Response.json(context, { status: 200 });
  } catch (err: unknown) {
    console.error("prototype map context failed", {
      message: (err as Error)?.message,
    });
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
