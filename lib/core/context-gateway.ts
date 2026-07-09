import { getSql } from "@/lib/db";
import type { FregeActorContext } from "@/lib/core/actor-auth";
import {
  estimateTokens,
  trustZonesForActor,
  type DocumentLinkType,
  type SensitivityLabel,
  type TrustZone,
} from "@/lib/core/types";

export type ContextBuildInput = {
  query: string;
  slug?: string;
  limit: number;
  session_id?: string;
};

export type ContextPacket = {
  id: string;
  organization: {
    id: string;
    slug: string;
  };
  query: string;
  source_slug: string | null;
  trust_zone: TrustZone;
  token_estimate: number;
  denied_count: number;
  documents: ContextDocument[];
  brain_pages: ContextBrainPage[];
  links: ContextLink[];
  concepts: ContextConcept[];
};

export type ContextDocument = {
  id: string;
  slug: string;
  path: string;
  title: string;
  sensitivity: SensitivityLabel;
  trust_zone: TrustZone;
  tags: string[];
  summary: string;
  revision_id: string;
  revision_number: number;
  chunks: ContextChunk[];
};

export type ContextChunk = {
  id: string | null;
  chunk_index: number;
  body_md: string;
  token_count: number;
};

export type ContextBrainPage = {
  id: string;
  slug: string;
  title: string;
  source_slug: string | null;
  trust_zone: TrustZone;
  tags: string[];
  summary: string;
  revision_id: string;
  revision_number: number;
  body_md: string;
  token_count: number;
};

export type ContextLink = {
  id: string;
  source_slug: string;
  target_slug: string;
  link_type: DocumentLinkType;
  confidence: number;
  evidence: string;
};

export type ContextConcept = {
  id: string;
  slug: string;
  name: string;
  description: string;
  confidence: number;
  document_slug: string;
};

type DocumentRow = Omit<ContextDocument, "chunks"> & {
  body_md: string;
};

type ChunkRow = ContextChunk & {
  document_id: string;
};

type LinkRow = ContextLink;

type ConceptRow = ContextConcept;

type ContextBuildRow = {
  id: string;
  query: string;
  source_slug: string | null;
  denied_count: number;
  session_id: string | null;
};

type BrainPageRow = Omit<ContextBrainPage, "token_count">;

function pattern(query: string): string {
  return `%${query}%`;
}

function searchPatterns(query: string): string[] | null {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .slice(0, 12);

  if (!query && terms.length === 0) return null;
  return [...new Set([query.toLowerCase(), ...terms].filter(Boolean))].map(pattern);
}

function maxTrustZone(documents: ContextDocument[]): TrustZone {
  return documents.some((document) => document.trust_zone === "red") ? "red" : "green";
}

function maxPacketTrustZone(documents: ContextDocument[], brainPages: ContextBrainPage[]): TrustZone {
  return documents.some((document) => document.trust_zone === "red") ||
    brainPages.some((page) => page.trust_zone === "red")
    ? "red"
    : "green";
}

function actorKeyId(actor: FregeActorContext): string | null {
  return actor.actorType === "api_key" ? actor.apiKeyAuth.key.id : null;
}

function actorUserId(actor: FregeActorContext): string | null {
  return actor.actorType === "user" ? actor.userAuth.user.id : actor.apiKeyAuth.key.owner_user_id;
}

export async function buildContextPacket(actor: FregeActorContext, input: ContextBuildInput): Promise<ContextPacket> {
  const sql = getSql();
  const query = input.query.trim();
  const queryPatterns = searchPatterns(query);
  const rows = await sql`
    select
      knowledge_documents.id,
      knowledge_documents.slug,
      knowledge_documents.path,
      knowledge_documents.title,
      knowledge_documents.sensitivity,
      knowledge_documents.trust_zone,
      knowledge_documents.tags,
      latest.id as revision_id,
      latest.revision_number,
      latest.summary,
      latest.body_md
    from knowledge_documents
    join lateral (
      select id, revision_number, summary, body_md
      from knowledge_document_revisions
      where document_id = knowledge_documents.id
      order by revision_number desc
      limit 1
    ) latest on true
    where knowledge_documents.org_id = ${actor.organization.id}
      and knowledge_documents.status = 'published'
      and knowledge_documents.sensitivity = any(${actor.allowedLabels}::text[])
      and (${input.slug ?? null}::text is null or knowledge_documents.slug = ${input.slug ?? null})
      and (
        ${queryPatterns}::text[] is null
        or knowledge_documents.title ilike any(${queryPatterns}::text[])
        or knowledge_documents.path ilike any(${queryPatterns}::text[])
        or latest.summary ilike any(${queryPatterns}::text[])
        or latest.body_md ilike any(${queryPatterns}::text[])
        or exists (
          select 1 from unnest(knowledge_documents.tags) as tag(value)
          where tag.value ilike any(${queryPatterns}::text[])
        )
      )
    order by knowledge_documents.updated_at desc, knowledge_documents.slug asc
    limit ${input.limit}
  `;

  const documentRows = rows as DocumentRow[];
  const documentIds = documentRows.map((document) => document.id);

  const deniedRows = await sql`
    select count(*)::int as denied_count
    from knowledge_documents
    join lateral (
      select summary, body_md
      from knowledge_document_revisions
      where document_id = knowledge_documents.id
      order by revision_number desc
      limit 1
    ) latest on true
    where knowledge_documents.org_id = ${actor.organization.id}
      and knowledge_documents.status = 'published'
      and not (knowledge_documents.sensitivity = any(${actor.allowedLabels}::text[]))
      and (${input.slug ?? null}::text is null or knowledge_documents.slug = ${input.slug ?? null})
      and (
        ${queryPatterns}::text[] is null
        or knowledge_documents.title ilike any(${queryPatterns}::text[])
        or knowledge_documents.path ilike any(${queryPatterns}::text[])
        or latest.summary ilike any(${queryPatterns}::text[])
        or latest.body_md ilike any(${queryPatterns}::text[])
        or exists (
          select 1 from unnest(knowledge_documents.tags) as tag(value)
          where tag.value ilike any(${queryPatterns}::text[])
        )
      )
  `;

  const chunkRows = documentIds.length
    ? ((await sql`
        select
          knowledge_chunks.id,
          knowledge_chunks.document_id,
          knowledge_chunks.chunk_index,
          knowledge_chunks.body_md,
          knowledge_chunks.token_count
        from knowledge_chunks
        where knowledge_chunks.org_id = ${actor.organization.id}
          and knowledge_chunks.document_id = any(${documentIds}::uuid[])
        order by knowledge_chunks.document_id, knowledge_chunks.chunk_index
      `) as ChunkRow[])
    : [];

  const chunksByDocument = new Map<string, ContextChunk[]>();
  for (const chunk of chunkRows) {
    const current = chunksByDocument.get(chunk.document_id) ?? [];
    current.push({
      id: chunk.id,
      chunk_index: chunk.chunk_index,
      body_md: chunk.body_md,
      token_count: chunk.token_count,
    });
    chunksByDocument.set(chunk.document_id, current);
  }

  const documents: ContextDocument[] = documentRows.map((document) => {
    const chunks = chunksByDocument.get(document.id);
    return {
      id: document.id,
      slug: document.slug,
      path: document.path,
      title: document.title,
      sensitivity: document.sensitivity,
      trust_zone: document.trust_zone,
      tags: document.tags,
      summary: document.summary,
      revision_id: document.revision_id,
      revision_number: document.revision_number,
      chunks: chunks?.length
        ? chunks
        : [
            {
              id: null,
              chunk_index: 0,
              body_md: document.body_md.slice(0, 2400),
              token_count: estimateTokens(document.body_md.slice(0, 2400)),
            },
          ],
    };
  });

  const brainPageRows = (await sql`
    select
      brain_pages.id,
      brain_pages.slug,
      brain_pages.title,
      brain_sources.slug as source_slug,
      brain_pages.trust_zone,
      brain_pages.tags,
      latest.id as revision_id,
      latest.revision_number,
      latest.summary,
      latest.body_md
    from brain_pages
    join lateral (
      select id, revision_number, summary, body_md
      from brain_page_revisions
      where page_id = brain_pages.id
      order by revision_number desc
      limit 1
    ) latest on true
    left join brain_sources on brain_sources.id = brain_pages.source_id
    where brain_pages.org_id = ${actor.organization.id}
      and brain_pages.status = 'published'
      and brain_pages.trust_zone = any(${trustZonesForActor(actor)}::text[])
      and (${input.slug ?? null}::text is null or brain_pages.slug = ${input.slug ?? null})
      and (
        ${queryPatterns}::text[] is null
        or brain_pages.title ilike any(${queryPatterns}::text[])
        or brain_pages.slug ilike any(${queryPatterns}::text[])
        or latest.summary ilike any(${queryPatterns}::text[])
        or latest.body_md ilike any(${queryPatterns}::text[])
        or exists (
          select 1 from unnest(brain_pages.tags) as tag(value)
          where tag.value ilike any(${queryPatterns}::text[])
        )
      )
    order by brain_pages.updated_at desc, brain_pages.slug asc
    limit ${input.limit}
  `) as BrainPageRow[];

  const deniedBrainRows = await sql`
    select count(*)::int as denied_count
    from brain_pages
    join lateral (
      select summary, body_md
      from brain_page_revisions
      where page_id = brain_pages.id
      order by revision_number desc
      limit 1
    ) latest on true
    where brain_pages.org_id = ${actor.organization.id}
      and brain_pages.status = 'published'
      and not (brain_pages.trust_zone = any(${trustZonesForActor(actor)}::text[]))
      and (${input.slug ?? null}::text is null or brain_pages.slug = ${input.slug ?? null})
      and (
        ${queryPatterns}::text[] is null
        or brain_pages.title ilike any(${queryPatterns}::text[])
        or brain_pages.slug ilike any(${queryPatterns}::text[])
        or latest.summary ilike any(${queryPatterns}::text[])
        or latest.body_md ilike any(${queryPatterns}::text[])
        or exists (
          select 1 from unnest(brain_pages.tags) as tag(value)
          where tag.value ilike any(${queryPatterns}::text[])
        )
      )
  `;

  const brainPages: ContextBrainPage[] = brainPageRows.map((page) => {
    const body = page.body_md.slice(0, 2400);
    return {
      ...page,
      body_md: body,
      token_count: estimateTokens(body),
    };
  });

  const links = documentIds.length
    ? ((await sql`
        select
          document_links.id,
          source.slug as source_slug,
          target.slug as target_slug,
          document_links.link_type,
          document_links.confidence,
          document_links.evidence
        from document_links
        join knowledge_documents source on source.id = document_links.source_document_id
        join knowledge_documents target on target.id = document_links.target_document_id
        where document_links.org_id = ${actor.organization.id}
          and (document_links.source_document_id = any(${documentIds}::uuid[])
            or document_links.target_document_id = any(${documentIds}::uuid[]))
          and source.sensitivity = any(${actor.allowedLabels}::text[])
          and target.sensitivity = any(${actor.allowedLabels}::text[])
        order by document_links.confidence desc
        limit 50
      `) as LinkRow[])
    : [];

  const concepts = documentIds.length
    ? ((await sql`
        select
          concept_nodes.id,
          concept_nodes.slug,
          concept_nodes.name,
          concept_nodes.description,
          document_concepts.confidence,
          knowledge_documents.slug as document_slug
        from document_concepts
        join concept_nodes on concept_nodes.id = document_concepts.concept_id
        join knowledge_documents on knowledge_documents.id = document_concepts.document_id
        where document_concepts.org_id = ${actor.organization.id}
          and document_concepts.document_id = any(${documentIds}::uuid[])
        order by document_concepts.confidence desc, concept_nodes.name asc
        limit 50
      `) as ConceptRow[])
    : [];

  const tokenEstimate = documents.reduce(
    (total, document) => total + document.chunks.reduce((chunkTotal, chunk) => chunkTotal + chunk.token_count, 0),
    0,
  ) + brainPages.reduce((total, page) => total + page.token_count, 0);
  const trustZone = maxPacketTrustZone(documents, brainPages);
  const deniedCount =
    Number((deniedRows[0] as { denied_count?: number } | undefined)?.denied_count ?? 0) +
    Number((deniedBrainRows[0] as { denied_count?: number } | undefined)?.denied_count ?? 0);

  const [contextBuild] = await sql`
    insert into context_builds (
      org_id,
      actor_type,
      actor_user_id,
      actor_key_id,
      query,
      source_slug,
      trust_zone,
      token_estimate,
      denied_count,
      session_id,
      metadata
    ) values (
      ${actor.organization.id},
      ${actor.actorType},
      ${actorUserId(actor)},
      ${actorKeyId(actor)},
      ${query},
      ${input.slug ?? null},
      ${trustZone},
      ${tokenEstimate},
      ${deniedCount},
      ${input.session_id ?? null},
      ${JSON.stringify({
        document_count: documents.length,
        brain_page_count: brainPages.length,
        link_count: links.length,
        concept_count: concepts.length,
      })}::jsonb
    )
    returning id
  `;

  const contextBuildId = (contextBuild as { id: string }).id;

  // Batch the per-row inserts into a single transaction request: over the Neon
  // HTTP driver each awaited statement is its own round trip, so a large packet
  // (8 docs + 8 pages) was ~16 serial round trips on the hot context-build path.
  const rowInserts = [
    ...documents.map((document) => {
      const chunkIds = document.chunks.map((chunk) => chunk.id).filter((id): id is string => Boolean(id));
      const docTokenEstimate = document.chunks.reduce((total, chunk) => total + chunk.token_count, 0);
      return sql`
        insert into context_build_documents (
          context_build_id,
          document_id,
          revision_id,
          chunk_ids,
          inclusion_reason,
          trust_zone,
          token_estimate
        ) values (
          ${contextBuildId},
          ${document.id},
          ${document.revision_id},
          ${chunkIds}::uuid[],
          ${input.slug ? "source_slug" : "query_match"},
          ${document.trust_zone},
          ${docTokenEstimate}
        )
      `;
    }),
    ...brainPages.map((page) => sql`
      insert into context_build_brain_pages (
        context_build_id,
        page_id,
        revision_id,
        inclusion_reason,
        trust_zone,
        token_estimate
      ) values (
        ${contextBuildId},
        ${page.id},
        ${page.revision_id},
        ${input.slug ? "source_slug" : "query_match"},
        ${page.trust_zone},
        ${page.token_count}
      )
    `),
  ];
  if (rowInserts.length > 0) {
    await sql.transaction(rowInserts);
  }

  return {
    id: contextBuildId,
    organization: {
      id: actor.organization.id,
      slug: actor.organization.slug,
    },
    query,
    source_slug: input.slug ?? null,
    trust_zone: trustZone,
    token_estimate: tokenEstimate,
    denied_count: deniedCount,
    documents,
    brain_pages: brainPages,
    links,
    concepts,
  };
}

async function contextLinks(
  actor: FregeActorContext,
  documentIds: string[],
): Promise<ContextLink[]> {
  if (!documentIds.length) return [];

  const sql = getSql();
  return (await sql`
    select
      document_links.id,
      source.slug as source_slug,
      target.slug as target_slug,
      document_links.link_type,
      document_links.confidence,
      document_links.evidence
    from document_links
    join knowledge_documents source on source.id = document_links.source_document_id
    join knowledge_documents target on target.id = document_links.target_document_id
    where document_links.org_id = ${actor.organization.id}
      and (document_links.source_document_id = any(${documentIds}::uuid[])
        or document_links.target_document_id = any(${documentIds}::uuid[]))
      and source.sensitivity = any(${actor.allowedLabels}::text[])
      and target.sensitivity = any(${actor.allowedLabels}::text[])
    order by document_links.confidence desc
    limit 50
  `) as ContextLink[];
}

async function contextConcepts(
  actor: FregeActorContext,
  documentIds: string[],
): Promise<ContextConcept[]> {
  if (!documentIds.length) return [];

  const sql = getSql();
  return (await sql`
    select
      concept_nodes.id,
      concept_nodes.slug,
      concept_nodes.name,
      concept_nodes.description,
      document_concepts.confidence,
      knowledge_documents.slug as document_slug
    from document_concepts
    join concept_nodes on concept_nodes.id = document_concepts.concept_id
    join knowledge_documents on knowledge_documents.id = document_concepts.document_id
    where document_concepts.org_id = ${actor.organization.id}
      and document_concepts.document_id = any(${documentIds}::uuid[])
    order by document_concepts.confidence desc, concept_nodes.name asc
    limit 50
  `) as ContextConcept[];
}

export async function getContextPacketById(
  actor: FregeActorContext,
  contextBuildId: string,
): Promise<ContextPacket | null> {
  const sql = getSql();
  const [contextBuild] = (await sql`
    select id, query, source_slug, denied_count, session_id
    from context_builds
    where id = ${contextBuildId}
      and org_id = ${actor.organization.id}
    limit 1
  `) as ContextBuildRow[];

  if (!contextBuild) return null;

  const documentRows = (await sql`
    select
      knowledge_documents.id,
      knowledge_documents.slug,
      knowledge_documents.path,
      knowledge_documents.title,
      knowledge_documents.sensitivity,
      knowledge_documents.trust_zone,
      knowledge_documents.tags,
      knowledge_document_revisions.id as revision_id,
      knowledge_document_revisions.revision_number,
      knowledge_document_revisions.summary,
      knowledge_document_revisions.body_md
    from context_build_documents
    join knowledge_documents on knowledge_documents.id = context_build_documents.document_id
    join knowledge_document_revisions on knowledge_document_revisions.id = context_build_documents.revision_id
    where context_build_documents.context_build_id = ${contextBuildId}
      and knowledge_documents.org_id = ${actor.organization.id}
      and knowledge_documents.status = 'published'
      and knowledge_documents.sensitivity = any(${actor.allowedLabels}::text[])
    order by context_build_documents.token_estimate desc, knowledge_documents.slug asc
  `) as DocumentRow[];

  const deniedRows = await sql`
    select count(*)::int as denied_count
    from context_build_documents
    join knowledge_documents on knowledge_documents.id = context_build_documents.document_id
    where context_build_documents.context_build_id = ${contextBuildId}
      and knowledge_documents.org_id = ${actor.organization.id}
      and not (knowledge_documents.sensitivity = any(${actor.allowedLabels}::text[]))
  `;

  const documentIds = documentRows.map((document) => document.id);
  const chunkRows = documentIds.length
    ? ((await sql`
        select
          knowledge_chunks.id,
          knowledge_chunks.document_id,
          knowledge_chunks.chunk_index,
          knowledge_chunks.body_md,
          knowledge_chunks.token_count
        from context_build_documents
        join knowledge_chunks on knowledge_chunks.id = any(context_build_documents.chunk_ids)
        where context_build_documents.context_build_id = ${contextBuildId}
          and knowledge_chunks.org_id = ${actor.organization.id}
          and knowledge_chunks.document_id = any(${documentIds}::uuid[])
        order by knowledge_chunks.document_id, knowledge_chunks.chunk_index
      `) as ChunkRow[])
    : [];

  const chunksByDocument = new Map<string, ContextChunk[]>();
  for (const chunk of chunkRows) {
    const current = chunksByDocument.get(chunk.document_id) ?? [];
    current.push({
      id: chunk.id,
      chunk_index: chunk.chunk_index,
      body_md: chunk.body_md,
      token_count: chunk.token_count,
    });
    chunksByDocument.set(chunk.document_id, current);
  }

  const documents: ContextDocument[] = documentRows.map((document) => {
    const chunks = chunksByDocument.get(document.id);
    return {
      id: document.id,
      slug: document.slug,
      path: document.path,
      title: document.title,
      sensitivity: document.sensitivity,
      trust_zone: document.trust_zone,
      tags: document.tags,
      summary: document.summary,
      revision_id: document.revision_id,
      revision_number: document.revision_number,
      chunks: chunks?.length
        ? chunks
        : [
            {
              id: null,
              chunk_index: 0,
              body_md: document.body_md.slice(0, 2400),
              token_count: estimateTokens(document.body_md.slice(0, 2400)),
            },
          ],
    };
  });

  const brainPages = (await sql`
    select
      brain_pages.id,
      brain_pages.slug,
      brain_pages.title,
      brain_sources.slug as source_slug,
      brain_pages.trust_zone,
      brain_pages.tags,
      brain_page_revisions.id as revision_id,
      brain_page_revisions.revision_number,
      brain_page_revisions.summary,
      brain_page_revisions.body_md,
      context_build_brain_pages.token_estimate as token_count
    from context_build_brain_pages
    join brain_pages on brain_pages.id = context_build_brain_pages.page_id
    join brain_page_revisions on brain_page_revisions.id = context_build_brain_pages.revision_id
    left join brain_sources on brain_sources.id = brain_pages.source_id
    where context_build_brain_pages.context_build_id = ${contextBuildId}
      and brain_pages.org_id = ${actor.organization.id}
      and brain_pages.status = 'published'
      and brain_pages.trust_zone = any(${trustZonesForActor(actor)}::text[])
    order by context_build_brain_pages.token_estimate desc, brain_pages.slug asc
  `) as ContextBrainPage[];

  const deniedBrainRows = await sql`
    select count(*)::int as denied_count
    from context_build_brain_pages
    join brain_pages on brain_pages.id = context_build_brain_pages.page_id
    where context_build_brain_pages.context_build_id = ${contextBuildId}
      and brain_pages.org_id = ${actor.organization.id}
      and not (brain_pages.trust_zone = any(${trustZonesForActor(actor)}::text[]))
  `;

  const [links, concepts] = await Promise.all([
    contextLinks(actor, documentIds),
    contextConcepts(actor, documentIds),
  ]);

  const tokenEstimate = documents.reduce(
    (total, document) => total + document.chunks.reduce((chunkTotal, chunk) => chunkTotal + chunk.token_count, 0),
    0,
  ) + brainPages.reduce((total, page) => total + page.token_count, 0);
  const deniedCount =
    Number((deniedRows[0] as { denied_count?: number } | undefined)?.denied_count ?? 0) +
    Number((deniedBrainRows[0] as { denied_count?: number } | undefined)?.denied_count ?? 0) +
    contextBuild.denied_count;

  return {
    id: contextBuild.id,
    organization: {
      id: actor.organization.id,
      slug: actor.organization.slug,
    },
    query: contextBuild.query,
    source_slug: contextBuild.source_slug,
    trust_zone: maxPacketTrustZone(documents, brainPages),
    token_estimate: tokenEstimate,
    denied_count: deniedCount,
    documents,
    brain_pages: brainPages,
    links,
    concepts,
  };
}
