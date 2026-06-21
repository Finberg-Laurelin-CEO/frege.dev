import { logPrototypeAuditEvent } from "@/lib/prototype/audit";
import { authenticatePrototypeRequest, prototypeUnauthorized } from "@/lib/prototype/auth";
import { parseLimit, searchVisibleDocuments } from "@/lib/prototype/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await authenticatePrototypeRequest(req);
    if (!auth) return prototypeUnauthorized();

    const url = new URL(req.url);
    const query = url.searchParams.get("q")?.trim() ?? "";
    if (query.length < 2) {
      return Response.json({ error: "invalid_query" }, { status: 400 });
    }

    const limit = parseLimit(url.searchParams, 10, 25);
    const documents = await searchVisibleDocuments(auth, query, limit);

    await logPrototypeAuditEvent(auth, req, {
      action: "documents.search",
      resourceType: "knowledge_document",
      metadata: {
        query,
        result_count: documents.length,
      },
    });

    return Response.json({ query, documents }, { status: 200 });
  } catch (err: unknown) {
    console.error("prototype document search failed", {
      message: (err as Error)?.message,
    });
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
