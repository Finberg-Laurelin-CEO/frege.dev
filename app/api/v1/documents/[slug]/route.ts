import { logPrototypeAuditEvent } from "@/lib/prototype/audit";
import { authenticatePrototypeRequest, prototypeUnauthorized } from "@/lib/prototype/auth";
import { readVisibleDocument } from "@/lib/prototype/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    slug: string;
  }>;
};

export async function GET(req: Request, context: RouteContext) {
  try {
    const auth = await authenticatePrototypeRequest(req);
    if (!auth) return prototypeUnauthorized();

    const { slug } = await context.params;
    const document = await readVisibleDocument(auth, slug);
    if (!document) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    await logPrototypeAuditEvent(auth, req, {
      action: "documents.read",
      resourceType: "knowledge_document",
      resourceId: document.id,
      metadata: {
        slug: document.slug,
        revision_number: document.revision_number,
      },
    });

    return Response.json({ document }, { status: 200 });
  } catch (err: unknown) {
    console.error("prototype document read failed", {
      message: (err as Error)?.message,
    });
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
