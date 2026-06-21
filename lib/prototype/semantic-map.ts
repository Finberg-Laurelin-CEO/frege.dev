import { getSql } from "@/lib/db";
import type { PrototypeAuthContext } from "@/lib/prototype/auth";
import type { DocumentLinkType, SensitivityLabel } from "@/lib/prototype/types";
import { DOCUMENT_LINK_TYPES } from "@/lib/prototype/types";

export type SemanticMapDocument = {
  id: string;
  slug: string;
  path: string;
  title: string;
  sensitivity: SensitivityLabel;
  tags: string[];
  summary: string;
  revision_id: string;
  revision_number: number;
  updated_at: Date | string;
};

export type SemanticMapLink = {
  id: string;
  direction: "outbound" | "inbound";
  link_type: DocumentLinkType;
  confidence: number;
  evidence: string;
  document: SemanticMapDocument;
};

export type SemanticMapConcept = {
  id: string;
  slug: string;
  name: string;
  description: string;
  confidence?: number;
};

export type SemanticMapChunk = {
  id: string;
  chunk_index: number;
  body_md: string;
  token_count: number;
  embedding_model: string | null;
};

export type SemanticRelatedResult = {
  source: SemanticMapDocument;
  links: SemanticMapLink[];
  concepts: SemanticMapConcept[];
};

export type SemanticContextResult = SemanticRelatedResult & {
  chunks: SemanticMapChunk[];
};

export type SemanticConceptSearchResult = SemanticMapConcept & {
  documents: SemanticMapDocument[];
};

export type CreateDocumentLinkInput = {
  sourceSlug: string;
  targetSlug: string;
  linkType: DocumentLinkType;
  confidence: number;
  evidence: string;
};

type DocumentRow = SemanticMapDocument;

type LinkRow = {
  id: string;
  direction: "outbound" | "inbound";
  link_type: DocumentLinkType;
  confidence: number | string;
  evidence: string;
  document_id: string;
  slug: string;
  path: string;
  title: string;
  sensitivity: SensitivityLabel;
  tags: string[];
  summary: string;
  revision_id: string;
  revision_number: number;
  updated_at: Date | string;
};

type ConceptRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  confidence?: number | string;
};

type ChunkRow = SemanticMapChunk;

type ConceptSearchRow = ConceptRow & {
  document_id: string;
  document_slug: string;
  document_path: string;
  document_title: string;
  document_sensitivity: SensitivityLabel;
  document_tags: string[];
  document_summary: string;
  revision_id: string;
  revision_number: number;
  document_updated_at: Date | string;
};

function toDocument(row: DocumentRow): SemanticMapDocument {
  return {
    id: row.id,
    slug: row.slug,
    path: row.path,
    title: row.title,
    sensitivity: row.sensitivity,
    tags: row.tags,
    summary: row.summary,
    revision_id: row.revision_id,
    revision_number: row.revision_number,
    updated_at: row.updated_at,
  };
}

function toLink(row: LinkRow): SemanticMapLink {
  return {
    id: row.id,
    direction: row.direction,
    link_type: row.link_type,
    confidence: Number(row.confidence),
    evidence: row.evidence,
    document: {
      id: row.document_id,
      slug: row.slug,
      path: row.path,
      title: row.title,
      sensitivity: row.sensitivity,
      tags: row.tags,
      summary: row.summary,
      revision_id: row.revision_id,
      revision_number: row.revision_number,
      updated_at: row.updated_at,
    },
  };
}

function toConcept(row: ConceptRow): SemanticMapConcept {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    confidence: row.confidence === undefined ? undefined : Number(row.confidence),
  };
}

export function isDocumentLinkType(value: string): value is DocumentLinkType {
  return DOCUMENT_LINK_TYPES.includes(value as DocumentLinkType);
}

export async function findVisibleMapDocument(
  auth: PrototypeAuthContext,
  slug: string,
): Promise<SemanticMapDocument | null> {
  const sql = getSql();
  const rows = await sql`
    select
      knowledge_documents.id,
      knowledge_documents.slug,
      knowledge_documents.path,
      knowledge_documents.title,
      knowledge_documents.sensitivity,
      knowledge_documents.tags,
      knowledge_documents.updated_at,
      latest.id as revision_id,
      latest.revision_number,
      latest.summary
    from knowledge_documents
    join lateral (
      select id, revision_number, summary
      from knowledge_document_revisions
      where document_id = knowledge_documents.id
      order by revision_number desc
      limit 1
    ) latest on true
    where knowledge_documents.org_id = ${auth.organization.id}
      and knowledge_documents.slug = ${slug}
      and knowledge_documents.status = 'published'
      and knowledge_documents.sensitivity = any(${auth.allowedLabels}::text[])
    limit 1
  `;

  const row = rows[0] as DocumentRow | undefined;
  return row ? toDocument(row) : null;
}

export async function listVisibleDocumentLinks(
  auth: PrototypeAuthContext,
  source: SemanticMapDocument,
  limit: number,
): Promise<SemanticMapLink[]> {
  const sql = getSql();
  const rows = await sql`
    select
      document_links.id,
      case
        when document_links.source_document_id = ${source.id} then 'outbound'
        else 'inbound'
      end as direction,
      document_links.link_type,
      document_links.confidence,
      document_links.evidence,
      neighbor.id as document_id,
      neighbor.slug,
      neighbor.path,
      neighbor.title,
      neighbor.sensitivity,
      neighbor.tags,
      neighbor.updated_at,
      latest.id as revision_id,
      latest.revision_number,
      latest.summary
    from document_links
    join knowledge_documents neighbor on neighbor.id = case
      when document_links.source_document_id = ${source.id} then document_links.target_document_id
      else document_links.source_document_id
    end
    join lateral (
      select id, revision_number, summary
      from knowledge_document_revisions
      where document_id = neighbor.id
      order by revision_number desc
      limit 1
    ) latest on true
    where document_links.org_id = ${auth.organization.id}
      and (${source.id} in (document_links.source_document_id, document_links.target_document_id))
      and neighbor.org_id = ${auth.organization.id}
      and neighbor.status = 'published'
      and neighbor.sensitivity = any(${auth.allowedLabels}::text[])
    order by document_links.confidence desc, neighbor.title asc
    limit ${limit}
  `;

  return (rows as LinkRow[]).map(toLink);
}

export async function listVisibleDocumentConcepts(
  auth: PrototypeAuthContext,
  source: SemanticMapDocument,
  limit: number,
): Promise<SemanticMapConcept[]> {
  const sql = getSql();
  const rows = await sql`
    select
      concept_nodes.id,
      concept_nodes.slug,
      concept_nodes.name,
      concept_nodes.description,
      document_concepts.confidence
    from document_concepts
    join concept_nodes on concept_nodes.id = document_concepts.concept_id
    where document_concepts.org_id = ${auth.organization.id}
      and concept_nodes.org_id = ${auth.organization.id}
      and document_concepts.document_id = ${source.id}
    order by document_concepts.confidence desc, concept_nodes.name asc
    limit ${limit}
  `;

  return (rows as ConceptRow[]).map(toConcept);
}

export async function listVisibleDocumentChunks(
  auth: PrototypeAuthContext,
  source: SemanticMapDocument,
  limit: number,
): Promise<SemanticMapChunk[]> {
  const sql = getSql();
  const rows = await sql`
    select
      knowledge_chunks.id,
      knowledge_chunks.chunk_index,
      knowledge_chunks.body_md,
      knowledge_chunks.token_count,
      knowledge_chunks.embedding_model
    from knowledge_chunks
    where knowledge_chunks.org_id = ${auth.organization.id}
      and knowledge_chunks.document_id = ${source.id}
      and knowledge_chunks.revision_id = ${source.revision_id}
    order by knowledge_chunks.chunk_index asc
    limit ${limit}
  `;

  return rows as ChunkRow[];
}

export async function getRelatedMap(
  auth: PrototypeAuthContext,
  slug: string,
  limit: number,
): Promise<SemanticRelatedResult | null> {
  const source = await findVisibleMapDocument(auth, slug);
  if (!source) return null;

  const [links, concepts] = await Promise.all([
    listVisibleDocumentLinks(auth, source, limit),
    listVisibleDocumentConcepts(auth, source, limit),
  ]);

  return { source, links, concepts };
}

export async function getContextMap(
  auth: PrototypeAuthContext,
  slug: string,
  limit: number,
): Promise<SemanticContextResult | null> {
  const source = await findVisibleMapDocument(auth, slug);
  if (!source) return null;

  const [links, concepts, chunks] = await Promise.all([
    listVisibleDocumentLinks(auth, source, limit),
    listVisibleDocumentConcepts(auth, source, limit),
    listVisibleDocumentChunks(auth, source, Math.min(limit, 5)),
  ]);

  return { source, links, concepts, chunks };
}

export async function searchVisibleConcepts(
  auth: PrototypeAuthContext,
  query: string,
  limit: number,
): Promise<SemanticConceptSearchResult[]> {
  const sql = getSql();
  const pattern = `%${query}%`;
  const rows = await sql`
    select
      concept_nodes.id,
      concept_nodes.slug,
      concept_nodes.name,
      concept_nodes.description,
      document_concepts.confidence,
      knowledge_documents.id as document_id,
      knowledge_documents.slug as document_slug,
      knowledge_documents.path as document_path,
      knowledge_documents.title as document_title,
      knowledge_documents.sensitivity as document_sensitivity,
      knowledge_documents.tags as document_tags,
      knowledge_documents.updated_at as document_updated_at,
      latest.id as revision_id,
      latest.revision_number,
      latest.summary as document_summary
    from concept_nodes
    join document_concepts on document_concepts.concept_id = concept_nodes.id
    join knowledge_documents on knowledge_documents.id = document_concepts.document_id
    join lateral (
      select id, revision_number, summary
      from knowledge_document_revisions
      where document_id = knowledge_documents.id
      order by revision_number desc
      limit 1
    ) latest on true
    where concept_nodes.org_id = ${auth.organization.id}
      and document_concepts.org_id = ${auth.organization.id}
      and knowledge_documents.org_id = ${auth.organization.id}
      and knowledge_documents.status = 'published'
      and knowledge_documents.sensitivity = any(${auth.allowedLabels}::text[])
      and (
        concept_nodes.slug ilike ${pattern}
        or concept_nodes.name ilike ${pattern}
        or concept_nodes.description ilike ${pattern}
      )
    order by concept_nodes.name asc, document_concepts.confidence desc, knowledge_documents.title asc
    limit ${limit * 5}
  `;

  const grouped = new Map<string, SemanticConceptSearchResult>();
  for (const row of rows as ConceptSearchRow[]) {
    let concept = grouped.get(row.id);
    if (!concept) {
      if (grouped.size >= limit) continue;
      concept = {
        ...toConcept(row),
        documents: [],
      };
      grouped.set(row.id, concept);
    }

    concept.documents.push({
      id: row.document_id,
      slug: row.document_slug,
      path: row.document_path,
      title: row.document_title,
      sensitivity: row.document_sensitivity,
      tags: row.document_tags,
      summary: row.document_summary,
      revision_id: row.revision_id,
      revision_number: row.revision_number,
      updated_at: row.document_updated_at,
    });
  }

  return [...grouped.values()];
}

export async function createDocumentLink(
  auth: PrototypeAuthContext,
  input: CreateDocumentLinkInput,
): Promise<SemanticMapLink | null> {
  const [source, target] = await Promise.all([
    findVisibleMapDocument(auth, input.sourceSlug),
    findVisibleMapDocument(auth, input.targetSlug),
  ]);
  if (!source || !target) return null;

  const sql = getSql();
  const rows = await sql`
    insert into document_links (
      org_id,
      source_document_id,
      target_document_id,
      source_revision_id,
      link_type,
      confidence,
      evidence,
      created_by_key_id
    ) values (
      ${auth.organization.id},
      ${source.id},
      ${target.id},
      ${source.revision_id},
      ${input.linkType},
      ${input.confidence},
      ${input.evidence},
      ${auth.key.id}
    )
    on conflict (source_document_id, target_document_id, link_type) do update set
      source_revision_id = excluded.source_revision_id,
      confidence = excluded.confidence,
      evidence = excluded.evidence,
      created_by_key_id = excluded.created_by_key_id,
      created_at = now()
    returning id, link_type, confidence, evidence
  `;

  const row = rows[0] as Pick<LinkRow, "id" | "link_type" | "confidence" | "evidence"> | undefined;
  if (!row) return null;

  return {
    id: row.id,
    direction: "outbound",
    link_type: row.link_type,
    confidence: Number(row.confidence),
    evidence: row.evidence,
    document: target,
  };
}
