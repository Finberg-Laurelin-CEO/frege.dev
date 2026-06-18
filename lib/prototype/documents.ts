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

export type DocumentWriteInput = {
  slug?: string;
  path: string;
  title: string;
  sensitivity: SensitivityLabel;
  status: DocumentStatus;
  tags: string[];
  summary?: string;
  body_md: string;
};

export type DocumentUpdateInput = {
  title?: string;
  sensitivity?: SensitivityLabel;
  status?: DocumentStatus;
  tags?: string[];
  summary?: string;
  body_md: string;
};

export type DocumentRevisionHistoryItem = {
  id: string;
  revision_number: number;
  summary: string;
  created_by_key_id: string | null;
  created_at: Date | string;
};

export type DocumentRevisionProposalResult = {
  id: string;
  document_id: string;
  document_slug: string;
  base_revision_id: string;
  base_revision_number: number;
  summary: string;
  status: string;
  created_at: Date | string;
};

export type DocumentWriteResult = DocumentReadResult & {
  revision_id: string;
};

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "document";
}

export function documentSlugFromInput(input: Pick<DocumentWriteInput, "path" | "title" | "slug">): string {
  if (input.slug) return input.slug;

  const filename = input.path.split("/").filter(Boolean).at(-1);
  return slugify(filename ?? input.title);
}

function summarizeMarkdown(body: string): string {
  return body
    .replace(/^#+\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function toWriteResult(row: DocumentWriteResult): DocumentWriteResult {
  return {
    id: row.id,
    slug: row.slug,
    path: row.path,
    title: row.title,
    sensitivity: row.sensitivity,
    status: row.status,
    tags: row.tags,
    summary: row.summary,
    body_md: row.body_md,
    revision_id: row.revision_id,
    revision_number: row.revision_number,
    revision_created_at: row.revision_created_at,
    updated_at: row.updated_at,
  };
}

export async function createDocument(
  auth: PrototypeAuthContext,
  input: DocumentWriteInput,
): Promise<DocumentWriteResult> {
  const sql = getSql();
  const slug = documentSlugFromInput(input);
  const summary = input.summary ?? summarizeMarkdown(input.body_md);
  const rows = await sql`
    with inserted_document as (
      insert into knowledge_documents (
        org_id, slug, path, title, sensitivity, status, tags, updated_at
      ) values (
        ${auth.organization.id}, ${slug}, ${input.path}, ${input.title}, ${input.sensitivity}, ${input.status}, ${input.tags}, now()
      )
      returning id, slug, path, title, sensitivity, status, tags, updated_at
    ),
    inserted_revision as (
      insert into knowledge_document_revisions (
        document_id, revision_number, body_md, summary, created_by_key_id
      )
      select id, 1, ${input.body_md}, ${summary}, ${auth.key.id}
      from inserted_document
      returning id as revision_id, revision_number, body_md, summary, created_at as revision_created_at
    )
    select
      inserted_document.id,
      inserted_document.slug,
      inserted_document.path,
      inserted_document.title,
      inserted_document.sensitivity,
      inserted_document.status,
      inserted_document.tags,
      inserted_document.updated_at,
      inserted_revision.revision_id,
      inserted_revision.revision_number,
      inserted_revision.body_md,
      inserted_revision.summary,
      inserted_revision.revision_created_at
    from inserted_document, inserted_revision
  `;

  return toWriteResult(rows[0] as DocumentWriteResult);
}

export async function updateDocument(
  auth: PrototypeAuthContext,
  slug: string,
  input: DocumentUpdateInput,
): Promise<DocumentWriteResult | null> {
  const sql = getSql();
  const summary = input.summary ?? summarizeMarkdown(input.body_md);
  const rows = await sql`
    with existing as (
      select id, title, sensitivity, status, tags
      from knowledge_documents
      where org_id = ${auth.organization.id}
        and slug = ${slug}
        and sensitivity = any(${auth.allowedLabels}::text[])
      limit 1
    ),
    updated_document as (
      update knowledge_documents
      set
        title = coalesce(${input.title ?? null}, existing.title),
        sensitivity = coalesce(${input.sensitivity ?? null}, existing.sensitivity),
        status = coalesce(${input.status ?? null}, existing.status),
        tags = coalesce(${input.tags ?? null}::text[], existing.tags),
        updated_at = now()
      from existing
      where knowledge_documents.id = existing.id
      returning
        knowledge_documents.id,
        knowledge_documents.slug,
        knowledge_documents.path,
        knowledge_documents.title,
        knowledge_documents.sensitivity,
        knowledge_documents.status,
        knowledge_documents.tags,
        knowledge_documents.updated_at
    ),
    next_revision as (
      select coalesce(max(revision_number), 0) + 1 as revision_number
      from knowledge_document_revisions
      where document_id = (select id from existing)
    ),
    inserted_revision as (
      insert into knowledge_document_revisions (
        document_id, revision_number, body_md, summary, created_by_key_id
      )
      select updated_document.id, next_revision.revision_number, ${input.body_md}, ${summary}, ${auth.key.id}
      from updated_document, next_revision
      returning id as revision_id, revision_number, body_md, summary, created_at as revision_created_at
    )
    select
      updated_document.id,
      updated_document.slug,
      updated_document.path,
      updated_document.title,
      updated_document.sensitivity,
      updated_document.status,
      updated_document.tags,
      updated_document.updated_at,
      inserted_revision.revision_id,
      inserted_revision.revision_number,
      inserted_revision.body_md,
      inserted_revision.summary,
      inserted_revision.revision_created_at
    from updated_document, inserted_revision
  `;

  const row = rows[0] as DocumentWriteResult | undefined;
  return row ? toWriteResult(row) : null;
}

export async function listDocumentRevisions(
  auth: PrototypeAuthContext,
  slug: string,
): Promise<DocumentRevisionHistoryItem[]> {
  const sql = getSql();
  const rows = await sql`
    select
      knowledge_document_revisions.id,
      knowledge_document_revisions.revision_number,
      knowledge_document_revisions.summary,
      knowledge_document_revisions.created_by_key_id,
      knowledge_document_revisions.created_at
    from knowledge_documents
    join knowledge_document_revisions on knowledge_document_revisions.document_id = knowledge_documents.id
    where knowledge_documents.org_id = ${auth.organization.id}
      and knowledge_documents.slug = ${slug}
      and knowledge_documents.sensitivity = any(${auth.allowedLabels}::text[])
    order by knowledge_document_revisions.revision_number desc
  `;

  return rows as DocumentRevisionHistoryItem[];
}

export async function createDocumentRevisionProposal(
  auth: PrototypeAuthContext,
  slug: string,
  input: { proposed_body_md: string; summary?: string },
): Promise<DocumentRevisionProposalResult | null> {
  const sql = getSql();
  const summary = input.summary ?? summarizeMarkdown(input.proposed_body_md);
  const rows = await sql`
    with target_document as (
      select id, slug
      from knowledge_documents
      where org_id = ${auth.organization.id}
        and slug = ${slug}
        and status = 'published'
        and sensitivity = any(${auth.allowedLabels}::text[])
      limit 1
    ),
    latest_revision as (
      select id, revision_number
      from knowledge_document_revisions
      where document_id = (select id from target_document)
      order by revision_number desc
      limit 1
    ),
    inserted_proposal as (
      insert into document_revision_proposals (
        org_id, document_id, base_revision_id, proposed_body_md, summary, created_by_key_id
      )
      select
        ${auth.organization.id},
        target_document.id,
        latest_revision.id,
        ${input.proposed_body_md},
        ${summary},
        ${auth.key.id}
      from target_document, latest_revision
      returning id, document_id, base_revision_id, summary, status, created_at
    )
    select
      inserted_proposal.id,
      inserted_proposal.document_id,
      target_document.slug as document_slug,
      inserted_proposal.base_revision_id,
      latest_revision.revision_number as base_revision_number,
      inserted_proposal.summary,
      inserted_proposal.status,
      inserted_proposal.created_at
    from inserted_proposal, target_document, latest_revision
  `;

  return (rows[0] as DocumentRevisionProposalResult | undefined) ?? null;
}
