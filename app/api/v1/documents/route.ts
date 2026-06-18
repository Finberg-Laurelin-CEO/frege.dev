import { authenticatePrototypeRequest, prototypeUnauthorized } from "@/lib/prototype/auth";
import { listVisibleDocuments, parseLimit } from "@/lib/prototype/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await authenticatePrototypeRequest(req);
    if (!auth) return prototypeUnauthorized();

    const url = new URL(req.url);
    const limit = parseLimit(url.searchParams);
    const documents = await listVisibleDocuments(auth, limit);

    return Response.json({ documents }, { status: 200 });
  } catch (err: unknown) {
    console.error("prototype document list failed", {
      message: (err as Error)?.message,
    });
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
