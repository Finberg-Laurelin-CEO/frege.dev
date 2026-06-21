import { logPrototypeAuditEvent } from "@/lib/prototype/audit";
import { authenticatePrototypeRequest, prototypeUnauthorized } from "@/lib/prototype/auth";
import { parseLimit } from "@/lib/prototype/documents";
import { getRelatedMap } from "@/lib/prototype/semantic-map";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await authenticatePrototypeRequest(req);
    if (!auth) return prototypeUnauthorized();

    const url = new URL(req.url);
    const slug = url.searchParams.get("slug")?.trim() ?? "";
    if (!slug) return Response.json({ error: "missing_slug" }, { status: 400 });

    const limit = parseLimit(url.searchParams, 10, 25);
    const related = await getRelatedMap(auth, slug, limit);
    if (!related) return Response.json({ error: "not_found" }, { status: 404 });

    await logPrototypeAuditEvent(auth, req, {
      action: "map.related",
      resourceType: "knowledge_document",
      resourceId: related.source.id,
      metadata: {
        slug,
        link_count: related.links.length,
        concept_count: related.concepts.length,
      },
    });

    return Response.json(related, { status: 200 });
  } catch (err: unknown) {
    console.error("prototype map related failed", {
      message: (err as Error)?.message,
    });
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
