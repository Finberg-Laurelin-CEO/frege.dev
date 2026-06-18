import { logPrototypeAuditEvent } from "@/lib/prototype/audit";
import { authenticatePrototypeRequest, prototypeUnauthorized } from "@/lib/prototype/auth";
import { createDocumentSchema } from "@/lib/prototype/document-write-schema";
import { createDocument, listVisibleDocuments, parseLimit } from "@/lib/prototype/documents";

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

export async function POST(req: Request) {
  try {
    const auth = await authenticatePrototypeRequest(req);
    if (!auth) return prototypeUnauthorized();
    if (!auth.capabilities.canCreateDocs) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }

    const parsed = createDocumentSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "validation", fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }
    if (!auth.allowedLabels.includes(parsed.data.sensitivity)) {
      return Response.json({ error: "forbidden_sensitivity" }, { status: 403 });
    }

    const document = await createDocument(auth, parsed.data);
    await logPrototypeAuditEvent(auth, req, {
      action: "documents.created",
      resourceType: "knowledge_document",
      resourceId: document.id,
      metadata: {
        slug: document.slug,
        revision_number: document.revision_number,
        sensitivity: document.sensitivity,
      },
    });

    return Response.json({ document }, { status: 201 });
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      return Response.json({ error: "conflict" }, { status: 409 });
    }

    console.error("prototype document create failed", {
      code,
      message: (err as Error)?.message,
    });
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
