import { logPrototypeAuditEvent } from "@/lib/prototype/audit";
import { assertActiveOrg, authenticatePrototypeRequest, prototypeUnauthorized } from "@/lib/prototype/auth";
import { parseLimit } from "@/lib/prototype/documents";
import { searchVisibleConcepts } from "@/lib/prototype/semantic-map";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await authenticatePrototypeRequest(req);
    if (!auth) return prototypeUnauthorized();
    const inactive = assertActiveOrg(auth);
    if (inactive) return inactive;

    const url = new URL(req.url);
    const query = url.searchParams.get("q")?.trim() ?? "";
    if (query.length < 2) {
      return Response.json({ error: "invalid_query" }, { status: 400 });
    }

    const limit = parseLimit(url.searchParams, 10, 25);
    const concepts = await searchVisibleConcepts(auth, query, limit);

    await logPrototypeAuditEvent(auth, req, {
      action: "map.concepts",
      resourceType: "concept_node",
      metadata: {
        query,
        result_count: concepts.length,
      },
    });

    return Response.json({ query, concepts }, { status: 200 });
  } catch (err: unknown) {
    console.error("prototype map concepts failed", {
      message: (err as Error)?.message,
    });
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
