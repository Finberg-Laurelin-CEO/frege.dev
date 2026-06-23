import { logPrototypeAuditEvent } from "@/lib/prototype/audit";
import { assertActiveOrg, authenticatePrototypeRequest, prototypeUnauthorized } from "@/lib/prototype/auth";
import { createDocumentLink, isDocumentLinkType } from "@/lib/prototype/semantic-map";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LinkRequestBody = {
  source_slug?: unknown;
  target_slug?: unknown;
  link_type?: unknown;
  confidence?: unknown;
  evidence?: unknown;
};

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function confidenceValue(value: unknown): number {
  if (value === undefined) return 1;
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) return 1;
  return Math.min(Math.max(confidence, 0), 1);
}

export async function POST(req: Request) {
  try {
    const auth = await authenticatePrototypeRequest(req);
    if (!auth) return prototypeUnauthorized();
    const inactive = assertActiveOrg(auth);
    if (inactive) return inactive;
    if (!auth.capabilities.canUpdateDocs) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }

    let body: LinkRequestBody;
    try {
      body = (await req.json()) as LinkRequestBody;
    } catch {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }

    const sourceSlug = stringValue(body.source_slug);
    const targetSlug = stringValue(body.target_slug);
    const linkType = stringValue(body.link_type);
    if (!sourceSlug || !targetSlug || !linkType || !isDocumentLinkType(linkType)) {
      return Response.json({ error: "validation" }, { status: 400 });
    }

    const link = await createDocumentLink(auth, {
      sourceSlug,
      targetSlug,
      linkType,
      confidence: confidenceValue(body.confidence),
      evidence: stringValue(body.evidence) ?? "",
    });
    if (!link) return Response.json({ error: "not_found" }, { status: 404 });

    await logPrototypeAuditEvent(auth, req, {
      action: "map.links.create",
      resourceType: "knowledge_document",
      resourceId: link.document.id,
      metadata: {
        source_slug: sourceSlug,
        target_slug: targetSlug,
        link_type: link.link_type,
        confidence: link.confidence,
      },
    });

    return Response.json({ link }, { status: 200 });
  } catch (err: unknown) {
    console.error("prototype map link create failed", {
      message: (err as Error)?.message,
    });
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
