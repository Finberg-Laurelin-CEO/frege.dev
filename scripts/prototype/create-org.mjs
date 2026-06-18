// Create or update a Frege prototype organization.
//
// Required env:
//   DATABASE_URL
//
// Usage:
//   node --env-file=.env.local scripts/prototype/create-org.mjs <org-slug> <org-name>

import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Run `vercel env pull .env.local` first.");
  process.exit(1);
}

const orgSlug = process.argv[2];
const orgName = process.argv[3];

if (!orgSlug || !orgName) {
  console.error("Usage: node --env-file=.env.local scripts/prototype/create-org.mjs <org-slug> <org-name>");
  process.exit(1);
}

const sql = neon(databaseUrl);
const [org] = await sql`
  insert into organizations (slug, name)
  values (${orgSlug}, ${orgName})
  on conflict (slug) do update set name = excluded.name
  returning id, slug, name, created_at
`;

console.log("Created/updated prototype organization.");
console.log(`org: ${org.slug} (${org.id})`);
console.log(`name: ${org.name}`);
