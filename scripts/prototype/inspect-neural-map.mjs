// Inspect semantic-map rows for one prototype document.
//
// Required env:
//   DATABASE_URL
//
// Usage:
//   node --env-file=.env.local scripts/prototype/inspect-neural-map.mjs [org-slug] <doc-slug>
//
// Example:
//   node --env-file=.env.local scripts/prototype/inspect-neural-map.mjs frege-demo customer-refunds

import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Run `vercel env pull .env.local` first.");
  process.exit(1);
}

const firstArg = process.argv[2];
const secondArg = process.argv[3];
const orgSlug = secondArg ? firstArg : "frege-demo";
const docSlug = secondArg ?? firstArg;

if (!docSlug) {
  console.error("Usage: node --env-file=.env.local scripts/prototype/inspect-neural-map.mjs [org-slug] <doc-slug>");
  process.exit(1);
}

const sql = neon(databaseUrl);

const [doc] = await sql`
  select
    organizations.id as org_id,
    organizations.slug as org_slug,
    knowledge_documents.id as document_id,
    knowledge_documents.slug,
    knowledge_documents.title,
    knowledge_documents.sensitivity,
    latest.id as revision_id,
    latest.revision_number,
    latest.summary
  from organizations
  join knowledge_documents on knowledge_documents.org_id = organizations.id
  join lateral (
    select id, revision_number, summary
    from knowledge_document_revisions
    where document_id = knowledge_documents.id
    order by revision_number desc
    limit 1
  ) latest on true
  where organizations.slug = ${orgSlug}
    and knowledge_documents.slug = ${docSlug}
  limit 1
`;

if (!doc) {
  console.error(`No document found for org=${orgSlug} slug=${docSlug}.`);
  process.exit(1);
}

const chunks = await sql`
  select chunk_index, token_count, embedding_model, left(body_md, 180) as preview
  from knowledge_chunks
  where org_id = ${doc.org_id}
    and document_id = ${doc.document_id}
    and revision_id = ${doc.revision_id}
  order by chunk_index asc
`;

const concepts = await sql`
  select concept_nodes.slug, concept_nodes.name, document_concepts.confidence
  from document_concepts
  join concept_nodes on concept_nodes.id = document_concepts.concept_id
  where document_concepts.org_id = ${doc.org_id}
    and document_concepts.document_id = ${doc.document_id}
  order by document_concepts.confidence desc, concept_nodes.name asc
`;

const links = await sql`
  select
    case
      when document_links.source_document_id = ${doc.document_id} then 'outbound'
      else 'inbound'
    end as direction,
    document_links.link_type,
    document_links.confidence,
    document_links.evidence,
    neighbor.slug as neighbor_slug,
    neighbor.title as neighbor_title,
    neighbor.sensitivity as neighbor_sensitivity
  from document_links
  join knowledge_documents neighbor on neighbor.id = case
    when document_links.source_document_id = ${doc.document_id} then document_links.target_document_id
    else document_links.source_document_id
  end
  where document_links.org_id = ${doc.org_id}
    and (${doc.document_id} in (document_links.source_document_id, document_links.target_document_id))
  order by document_links.confidence desc, neighbor.slug asc
`;

console.log(`${doc.org_slug}/${doc.slug}`);
console.log(`${doc.title} (${doc.sensitivity}) rev ${doc.revision_number}`);
console.log(doc.summary);
console.log("");

console.log(`chunks (${chunks.length})`);
for (const chunk of chunks) {
  console.log(`- #${chunk.chunk_index} tokens=${chunk.token_count} model=${chunk.embedding_model ?? "none"}`);
  console.log(`  ${chunk.preview.replace(/\s+/g, " ")}`);
}
console.log("");

console.log(`concepts (${concepts.length})`);
for (const concept of concepts) {
  console.log(`- ${concept.slug} (${concept.name}) confidence=${Number(concept.confidence).toFixed(2)}`);
}
console.log("");

console.log(`links (${links.length})`);
for (const link of links) {
  console.log(
    `- ${link.direction} ${link.link_type} -> ${link.neighbor_slug} (${link.neighbor_sensitivity}) confidence=${Number(link.confidence).toFixed(2)}`,
  );
  if (link.evidence) console.log(`  ${link.evidence}`);
}
