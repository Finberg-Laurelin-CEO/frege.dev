// Rebuild Frege prototype semantic-map rows from canonical markdown revisions.
//
// Required env:
//   DATABASE_URL
//
// Usage:
//   node --env-file=.env.local scripts/prototype/index-semantic-map.mjs [org-slug]
//
// Example:
//   node --env-file=.env.local scripts/prototype/index-semantic-map.mjs frege-demo

import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Run `vercel env pull .env.local` first.");
  process.exit(1);
}

const orgSlug = process.argv[2] ?? "frege-demo";
const embeddingProvider = process.env.FREGE_EMBEDDING_PROVIDER ?? "none";
const semanticModel = process.env.FREGE_EMBEDDING_MODEL ?? "frege-keyword-index-v1";
const sql = neon(databaseUrl);

const STOPWORDS = new Set([
  "and",
  "before",
  "business",
  "can",
  "data",
  "demo",
  "document",
  "for",
  "from",
  "into",
  "more",
  "only",
  "policy",
  "read",
  "should",
  "that",
  "the",
  "this",
  "used",
  "when",
  "with",
]);

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleize(value) {
  return value
    .split("-")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function tokenCount(value) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function hashTextToPgVector(text) {
  if (embeddingProvider !== "hash") return null;

  const values = [];
  let counter = 0;
  while (values.length < 1536) {
    const digest = createHash("sha256").update(`${counter}:${text}`).digest();
    for (const byte of digest) {
      values.push((byte / 127.5 - 1).toFixed(6));
      if (values.length === 1536) break;
    }
    counter += 1;
  }

  return `[${values.join(",")}]`;
}

function chunkMarkdown(body) {
  const blocks = body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const chunks = [];
  let current = [];
  let currentTokens = 0;

  for (const block of blocks) {
    const count = tokenCount(block);
    if (current.length > 0 && currentTokens + count > 180) {
      chunks.push(current.join("\n\n"));
      current = [];
      currentTokens = 0;
    }
    current.push(block);
    currentTokens += count;
  }

  if (current.length > 0) chunks.push(current.join("\n\n"));
  return chunks.length > 0 ? chunks : [body.trim()];
}

function extractConcepts(doc) {
  const raw = new Set(doc.tags.map(slugify));
  for (const word of `${doc.title} ${doc.summary}`.match(/[A-Za-z][A-Za-z-]{3,}/g) ?? []) {
    const slug = slugify(word);
    if (slug.length >= 4 && !STOPWORDS.has(slug)) raw.add(slug);
  }

  return [...raw].filter(Boolean).slice(0, 12).map((slug) => ({
    slug,
    name: titleize(slug),
    description: "Prototype concept extracted from document metadata.",
  }));
}

function sharedTags(a, b) {
  const bTags = new Set(b.tags);
  return a.tags.filter((tag) => bTags.has(tag));
}

function referencesTarget(source, target) {
  const haystack = `${source.body_md}\n${source.summary}`.toLowerCase();
  return haystack.includes(target.slug) || haystack.includes(target.path.toLowerCase()) || haystack.includes(target.title.toLowerCase());
}

async function upsertConcept(orgId, concept) {
  const [row] = await sql`
    insert into concept_nodes (org_id, slug, name, description, embedding_model, embedding)
    values (${orgId}, ${concept.slug}, ${concept.name}, ${concept.description}, ${semanticModel}, ${hashTextToPgVector(concept.name)}::vector)
    on conflict (org_id, slug) do update set
      name = excluded.name,
      description = excluded.description,
      embedding_model = excluded.embedding_model,
      embedding = excluded.embedding
    returning id, slug, name
  `;
  return row;
}

async function main() {
  const [org] = await sql`
    select id, slug, name
    from organizations
    where slug = ${orgSlug}
    limit 1
  `;

  if (!org) {
    console.error(`No org found for slug=${orgSlug}. Run seed-demo-org first.`);
    process.exit(1);
  }

  const [run] = await sql`
    insert into semantic_index_runs (org_id, status)
    values (${org.id}, 'running')
    returning id
  `;

  try {
    const docs = await sql`
      select
        knowledge_documents.id,
        knowledge_documents.slug,
        knowledge_documents.path,
        knowledge_documents.title,
        knowledge_documents.sensitivity,
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
      where knowledge_documents.org_id = ${org.id}
        and knowledge_documents.status = 'published'
      order by knowledge_documents.slug asc
    `;

    let chunkCount = 0;
    let conceptCount = 0;
    let linkCount = 0;
    const conceptIdsByDoc = new Map();

    for (const doc of docs) {
      await sql`delete from knowledge_chunks where revision_id = ${doc.revision_id}`;
      const chunks = chunkMarkdown(doc.body_md);
      for (const [index, chunk] of chunks.entries()) {
        await sql`
          insert into knowledge_chunks (
            org_id, document_id, revision_id, chunk_index, body_md, token_count, embedding_model, embedding
          ) values (
            ${org.id}, ${doc.id}, ${doc.revision_id}, ${index}, ${chunk}, ${tokenCount(chunk)}, ${semanticModel}, ${hashTextToPgVector(chunk)}::vector
          )
          on conflict (revision_id, chunk_index) do update set
            body_md = excluded.body_md,
            token_count = excluded.token_count,
            embedding_model = excluded.embedding_model,
            embedding = excluded.embedding,
            created_at = now()
        `;
        chunkCount += 1;
      }

      await sql`delete from document_concepts where document_id = ${doc.id}`;
      const conceptIds = [];
      for (const concept of extractConcepts(doc)) {
        const row = await upsertConcept(org.id, concept);
        conceptIds.push(row.id);
        await sql`
          insert into document_concepts (org_id, document_id, concept_id, confidence)
          values (${org.id}, ${doc.id}, ${row.id}, 0.8)
          on conflict (document_id, concept_id) do update set
            confidence = excluded.confidence,
            created_at = now()
        `;
        conceptCount += 1;
      }
      conceptIdsByDoc.set(doc.id, conceptIds);
    }

    await sql`
      delete from document_links
      where org_id = ${org.id}
        and created_by_key_id is null
        and evidence like 'Generated by semantic index:%'
    `;

    for (let i = 0; i < docs.length; i += 1) {
      for (let j = 0; j < docs.length; j += 1) {
        if (i === j) continue;
        const source = docs[i];
        const target = docs[j];
        const tags = sharedTags(source, target);
        const references = referencesTarget(source, target);
        if (!references && tags.length === 0) continue;

        const linkType = references ? "references" : "related";
        const evidence = references
          ? `Generated by semantic index: ${source.slug} mentions ${target.slug}.`
          : `Generated by semantic index: shared tags ${tags.join(", ")}.`;
        const confidence = references ? 0.85 : Math.min(0.75, 0.45 + tags.length * 0.1);

        await sql`
          insert into document_links (
            org_id, source_document_id, target_document_id, source_revision_id,
            link_type, confidence, evidence
          ) values (
            ${org.id}, ${source.id}, ${target.id}, ${source.revision_id},
            ${linkType}, ${confidence}, ${evidence}
          )
          on conflict (source_document_id, target_document_id, link_type) do update set
            source_revision_id = excluded.source_revision_id,
            confidence = excluded.confidence,
            evidence = excluded.evidence,
            created_at = now()
        `;
        linkCount += 1;
      }
    }

    await sql`delete from concept_edges where org_id = ${org.id} and evidence->>'generated_by' = 'semantic-index'`;
    for (const conceptIds of conceptIdsByDoc.values()) {
      for (let i = 0; i < conceptIds.length; i += 1) {
        for (let j = i + 1; j < conceptIds.length; j += 1) {
          await sql`
            insert into concept_edges (org_id, source_concept_id, target_concept_id, edge_type, weight, evidence)
            values (
              ${org.id}, ${conceptIds[i]}, ${conceptIds[j]}, 'related_to', 0.6,
              ${JSON.stringify({ generated_by: "semantic-index" })}::jsonb
            )
            on conflict (source_concept_id, target_concept_id, edge_type) do update set
              weight = greatest(concept_edges.weight, excluded.weight),
              evidence = excluded.evidence,
              created_at = now()
          `;
        }
      }
    }

    await sql`
      update semantic_index_runs
      set status = 'succeeded', completed_at = now()
      where id = ${run.id}
    `;

    console.log(`Indexed semantic map for ${org.slug}.`);
    console.log(`documents: ${docs.length}`);
    console.log(`chunks: ${chunkCount}`);
    console.log(`document_concepts: ${conceptCount}`);
    console.log(`document_links: ${linkCount}`);
  } catch (err) {
    await sql`
      update semantic_index_runs
      set status = 'failed', error = ${(err && err.message) || String(err)}, completed_at = now()
      where id = ${run.id}
    `;
    throw err;
  }
}

main().catch((err) => {
  console.error("semantic index failed", err);
  process.exit(1);
});
