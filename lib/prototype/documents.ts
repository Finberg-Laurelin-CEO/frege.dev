import { getSql } from "@/lib/db";
import type { PrototypeAuthContext } from "@/lib/prototype/auth";
import type { DocumentStatus, SensitivityLabel } from "@/lib/prototype/types";

export type DocumentListItem = {
  id: string;
  slug: string;
  path: string;
  title: string;
  sensitivity: SensitivityLabel;
  tags: string[];
  summary: string;
  revision_number: number;
  updated_at: Date | string;
};

export type DocumentReadResult = DocumentListItem & {
  status: DocumentStatus;
  body_md: string;
  revision_created_at: Date | string;
};

export type DocumentSearchResult = DocumentListItem & {
  snippet: string;
};

type DocumentRow = DocumentReadResult;

export function parseLimit(searchParams: URLSearchParams, defaultLimit = 20, maxLimit = 50): number {
  const rawLimit = searchParams.get("limit");
  if (!rawLimit) return defaultLimit;

  const limit = Number(rawLimit);
  if (!Number.isInteger(limit)) return defaultLimit;

  return Math.min(Math.max(limit, 1), maxLimit);
}

function toListItem(row: DocumentRow): DocumentListItem {
  return {
    id: row.id,
    slug: row.slug,
    path: row.path,
    title: row.title,
    sensitivity: row.sensitivity,
    tags: row.tags,
    summary: row.summary,
    revision_number: row.revision_number,
    updated_at: row.updated_at,
  };
}

function makeSnippet(body: string, query: string): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  if (!normalized) return "";

  const index = normalized.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return normalized.slice(0, 240);

  const start = Math.max(0, index - 80);
  const end = Math.min(normalized.length, index + query.length + 160);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < normalized.length ? "…" : "";

  return `${prefix}${normalized.slice(start, end)}${suffix}`;
}

export async function listVisibleDocuments(
  auth: PrototypeAuthContext,
  limit: number,
): Promise<DocumentListItem[]> {
  const sql = getSql();
  const rows = await sql`
    select
      knowledge_documents.id,
      knowledge_documents.slug,
      knowledge_documents.path,
      knowledge_documents.title,
      knowledge_documents.sensitivity,
      knowledge_documents.status,
      knowledge_documents.tags,
      knowledge_documents.updated_at,
      latest.revision_number,
      latest.summary,
      latest.body_md,
      latest.created_at as revision_created_at
    from knowledge_documents
    join lateral (
      select revision_number, summary, body_md, created_at
      from knowledge_document_revisions
      where document_id = knowledge_documents.id
      order by revision_number desc
      limit 1
    ) latest on true
    where knowledge_documents.org_id = ${auth.organization.id}
      and knowledge_documents.status = 'published'
      and knowledge_documents.sensitivity = any(${auth.allowedLabels}::text[])
    order by knowledge_documents.updated_at desc, knowledge_documents.slug asc
    limit ${limit}
  `;

  return (rows as DocumentRow[]).map(toListItem);
}

export async function readVisibleDocument(
  auth: PrototypeAuthContext,
  slug: string,
): Promise<DocumentReadResult | null> {
  const sql = getSql();
  const rows = await sql`
    select
      knowledge_documents.id,
      knowledge_documents.slug,
      knowledge_documents.path,
      knowledge_documents.title,
      knowledge_documents.sensitivity,
      knowledge_documents.status,
      knowledge_documents.tags,
      knowledge_documents.updated_at,
      latest.revision_number,
      latest.summary,
      latest.body_md,
      latest.created_at as revision_created_at
    from knowledge_documents
    join lateral (
      select revision_number, summary, body_md, created_at
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

  return (rows[0] as DocumentReadResult | undefined) ?? null;
}

export async function searchVisibleDocuments(
  auth: PrototypeAuthContext,
  query: string,
  limit: number,
): Promise<DocumentSearchResult[]> {
  const sql = getSql();
  const pattern = `%${query}%`;
  const rows = await sql`
    select
      knowledge_documents.id,
      knowledge_documents.slug,
      knowledge_documents.path,
      knowledge_documents.title,
      knowledge_documents.sensitivity,
      knowledge_documents.status,
      knowledge_documents.tags,
      knowledge_documents.updated_at,
      latest.revision_number,
      latest.summary,
      latest.body_md,
      latest.created_at as revision_created_at
    from knowledge_documents
    join lateral (
      select revision_number, summary, body_md, created_at
      from knowledge_document_revisions
      where document_id = knowledge_documents.id
      order by revision_number desc
      limit 1
    ) latest on true
    where knowledge_documents.org_id = ${auth.organization.id}
      and knowledge_documents.status = 'published'
      and knowledge_documents.sensitivity = any(${auth.allowedLabels}::text[])
      and (
        knowledge_documents.title ilike ${pattern}
        or knowledge_documents.path ilike ${pattern}
        or latest.summary ilike ${pattern}
        or latest.body_md ilike ${pattern}
        or exists (
          select 1 from unnest(knowledge_documents.tags) as tag(value)
          where tag.value ilike ${pattern}
        )
      )
    order by knowledge_documents.updated_at desc, knowledge_documents.slug asc
    limit ${limit}
  `;

  return (rows as DocumentRow[]).map((row) => ({
    ...toListItem(row),
    snippet: makeSnippet(row.body_md, query),
  }));
}
