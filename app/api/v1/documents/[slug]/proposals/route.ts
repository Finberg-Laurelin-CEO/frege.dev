import { logPrototypeAuditEvent } from "@/lib/prototype/audit";
import { assertActiveOrg, authenticatePrototypeRequest, prototypeUnauthorized } from "@/lib/prototype/auth";
import { proposeDocumentRevisionSchema } from "@/lib/prototype/document-write-schema";
import { createDocumentRevisionProposal } from "@/lib/prototype/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    slug: string;
  }>;
};

export async function POST(req: Request, context: RouteContext) {
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

    const parsed = proposeDocumentRevisionSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "validation", fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { slug } = await context.params;
    const proposal = await createDocumentRevisionProposal(auth, slug, parsed.data);
    if (!proposal) return Response.json({ error: "not_found" }, { status: 404 });

    await logPrototypeAuditEvent(auth, req, {
      action: "documents.proposal.created",
      resourceType: "knowledge_document",
      resourceId: proposal.document_id,
      metadata: {
        slug: proposal.document_slug,
        proposal_id: proposal.id,
        base_revision_number: proposal.base_revision_number,
      },
    });

    return Response.json({ proposal }, { status: 201 });
  } catch (err: unknown) {
    console.error("prototype document proposal failed", {
      message: (err as Error)?.message,
    });
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
