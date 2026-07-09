import { logPrototypeAuditEvent } from "@/lib/core/audit";
import { assertActiveOrg, authenticatePrototypeRequest, prototypeUnauthorized } from "@/lib/core/auth";
import { updateDocumentSchema } from "@/lib/core/document-write-schema";
import { readVisibleDocument, updateDocument } from "@/lib/core/documents";

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
    const inactive = assertActiveOrg(auth);
    if (inactive) return inactive;

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

export async function PUT(req: Request, context: RouteContext) {
  try {
    const auth = await authenticatePrototypeRequest(req);
    if (!auth) return prototypeUnauthorized();
    const inactive = assertActiveOrg(auth);
    if (inactive) return inactive;
    if (!auth.capabilities.canUpdateDocs) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }

    const parsed = updateDocumentSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "validation", fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }
    if (parsed.data.sensitivity && !auth.allowedLabels.includes(parsed.data.sensitivity)) {
      return Response.json({ error: "forbidden_sensitivity" }, { status: 403 });
    }

    const { slug } = await context.params;
    const document = await updateDocument(auth, slug, parsed.data);
    if (!document) return Response.json({ error: "not_found" }, { status: 404 });

    await logPrototypeAuditEvent(auth, req, {
      action: "documents.updated",
      resourceType: "knowledge_document",
      resourceId: document.id,
      metadata: {
        slug: document.slug,
        revision_number: document.revision_number,
        sensitivity: document.sensitivity,
      },
    });

    return Response.json({ document }, { status: 200 });
  } catch (err: unknown) {
    console.error("prototype document update failed", {
      message: (err as Error)?.message,
    });
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
