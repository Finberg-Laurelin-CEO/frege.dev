// Import a directory of Markdown files into a Frege prototype org.
//
// Required env:
//   DATABASE_URL
//
// Usage:
//   node --env-file=.env.local scripts/prototype/import-markdown-dir.mjs <org-slug> <markdown-dir> [sensitivity] [status]
//
// Example:
//   node --env-file=.env.local scripts/prototype/import-markdown-dir.mjs frege-demo ./docs internal published

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Run `vercel env pull .env.local` first.");
  process.exit(1);
}

const orgSlug = process.argv[2];
const markdownDir = process.argv[3];
const sensitivity = process.argv[4] ?? "internal";
const status = process.argv[5] ?? "published";
const trustZone = sensitivity === "restricted" ? "red" : "green";

if (!orgSlug || !markdownDir) {
  console.error(
    "Usage: node --env-file=.env.local scripts/prototype/import-markdown-dir.mjs <org-slug> <markdown-dir> [sensitivity] [status]",
  );
  process.exit(1);
}

if (!["public", "internal", "restricted"].includes(sensitivity)) {
  console.error(`Invalid sensitivity: ${sensitivity}`);
  process.exit(1);
}

if (!["draft", "published", "archived"].includes(status)) {
  console.error(`Invalid status: ${status}`);
  process.exit(1);
}

const sql = neon(databaseUrl);

function slugify(value) {
  const slug = value
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "document";
}

function titleize(value) {
  return value
    .replace(/\.md$/i, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function extractTitle(relativePath, body) {
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;

  return titleize(path.basename(relativePath));
}

function extractSummary(body) {
  return body
    .replace(/^#+\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function tagsFor(relativePath) {
  const parsed = path.parse(relativePath);
  const segments = parsed.dir.split(path.sep).filter(Boolean);
  return [...new Set(segments.map(slugify).filter(Boolean))].slice(0, 20);
}

async function markdownFiles(rootDir, currentDir = rootDir) {
  const entries = await readdir(currentDir);
  const files = [];

  for (const entry of entries) {
    if (entry.startsWith(".")) continue;

    const absolutePath = path.join(currentDir, entry);
    const entryStat = await stat(absolutePath);
    if (entryStat.isDirectory()) {
      files.push(...(await markdownFiles(rootDir, absolutePath)));
    } else if (entryStat.isFile() && entry.toLowerCase().endsWith(".md")) {
      files.push(absolutePath);
    }
  }

  return files;
}

const [org] = await sql`
  select id, slug
  from organizations
  where slug = ${orgSlug}
  limit 1
`;

if (!org) {
  console.error(`No org found for slug=${orgSlug}. Run create-org first.`);
  process.exit(1);
}

const rootDir = path.resolve(markdownDir);
const files = await markdownFiles(rootDir);
let imported = 0;

for (const absolutePath of files) {
  const relativePath = path.relative(rootDir, absolutePath).split(path.sep).join("/");
  const body = await readFile(absolutePath, "utf8");
  const slug = slugify(relativePath);
  const title = extractTitle(relativePath, body);
  const summary = extractSummary(body);
  const tags = tagsFor(relativePath);

  const [row] = await sql`
    with upserted_document as (
      insert into knowledge_documents (
        org_id, slug, path, title, sensitivity, trust_zone, status, tags, updated_at
      ) values (
        ${org.id}, ${slug}, ${relativePath}, ${title}, ${sensitivity}, ${trustZone}, ${status}, ${tags}, now()
      )
      on conflict (org_id, slug) do update set
        path = excluded.path,
        title = excluded.title,
        sensitivity = excluded.sensitivity,
        trust_zone = excluded.trust_zone,
        status = excluded.status,
        tags = excluded.tags,
        updated_at = now()
      returning id, slug
    ),
    next_revision as (
      select coalesce(max(revision_number), 0) + 1 as revision_number
      from knowledge_document_revisions
      where document_id = (select id from upserted_document)
    ),
    inserted_revision as (
      insert into knowledge_document_revisions (document_id, revision_number, body_md, summary)
      select upserted_document.id, next_revision.revision_number, ${body}, ${summary}
      from upserted_document, next_revision
      returning revision_number
    )
    select upserted_document.slug, inserted_revision.revision_number
    from upserted_document, inserted_revision
  `;

  imported += 1;
  console.log(`imported ${row.slug} revision ${row.revision_number}`);
}

console.log(`Imported ${imported} markdown file(s) into ${org.slug}.`);
