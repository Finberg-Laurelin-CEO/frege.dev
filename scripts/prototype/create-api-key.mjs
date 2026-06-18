// Create a Frege prototype API key for an existing org + role.
//
// Required env:
//   DATABASE_URL
//   FREGE_API_KEY_SALT
//
// Usage:
//   node --env-file=.env.local scripts/prototype/create-api-key.mjs <org-slug> <role-slug> [key-name]
//
// Example:
//   node --env-file=.env.local scripts/prototype/create-api-key.mjs frege-demo reader "Local reader"

import { createHash, randomBytes } from "node:crypto";
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Run `vercel env pull .env.local` first.");
  process.exit(1);
}

const apiKeySalt = process.env.FREGE_API_KEY_SALT;
if (!apiKeySalt) {
  console.error("FREGE_API_KEY_SALT is not set. Add it to .env.local before creating keys.");
  process.exit(1);
}

const orgSlug = process.argv[2];
const roleSlug = process.argv[3];
const keyName = process.argv[4] ?? `${roleSlug ?? "prototype"} key`;

if (!orgSlug || !roleSlug) {
  console.error("Usage: node --env-file=.env.local scripts/prototype/create-api-key.mjs <org-slug> <role-slug> [key-name]");
  process.exit(1);
}

function hashApiKey(rawKey) {
  return createHash("sha256").update(`${rawKey}|${apiKeySalt}`).digest("hex");
}

function generateApiKey() {
  const keyPrefix = randomBytes(6).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  const rawKey = `frg_live_${keyPrefix}_${secret}`;

  return {
    rawKey,
    keyPrefix,
    keyHash: hashApiKey(rawKey),
  };
}

const sql = neon(databaseUrl);

const [role] = await sql`
  select
    organizations.id as org_id,
    organizations.slug as org_slug,
    roles.id as role_id,
    roles.slug as role_slug
  from organizations
  join roles on roles.org_id = organizations.id
  where organizations.slug = ${orgSlug}
    and roles.slug = ${roleSlug}
  limit 1
`;

if (!role) {
  console.error(`No role found for org=${orgSlug} role=${roleSlug}. Run seed-demo-org first or create the org/role.`);
  process.exit(1);
}

const key = generateApiKey();
const [row] = await sql`
  insert into api_keys (org_id, role_id, name, key_prefix, key_hash)
  values (${role.org_id}, ${role.role_id}, ${keyName}, ${key.keyPrefix}, ${key.keyHash})
  returning id, name, key_prefix
`;

console.log("Created prototype API key.");
console.log(`org: ${role.org_slug}`);
console.log(`role: ${role.role_slug}`);
console.log(`key_id: ${row.id}`);
console.log(`key_name: ${row.name}`);
console.log(`key_prefix: ${row.key_prefix}`);
console.log("");
console.log("Raw key. Copy it now; only the hash is stored:");
console.log(key.rawKey);
