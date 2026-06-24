// Revoke a platform-staff API key by key prefix.
//
// Required env:
//   DATABASE_URL
//
// Usage:
//   node --env-file=.env.local scripts/prototype/revoke-staff-api-key.mjs <key-prefix>

import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Run `vercel env pull .env.local` first.");
  process.exit(1);
}

const keyPrefix = process.argv[2];
if (!keyPrefix) {
  console.error("Usage: node --env-file=.env.local scripts/prototype/revoke-staff-api-key.mjs <key-prefix>");
  process.exit(1);
}

const sql = neon(databaseUrl);
const [key] = await sql`
  update platform_staff_api_keys
  set status = 'revoked'
  where key_prefix = ${keyPrefix}
  returning id, name, key_prefix, status
`;

if (!key) {
  console.error(`No platform-staff API key found for prefix=${keyPrefix}.`);
  process.exit(1);
}

console.log("Revoked platform-staff API key.");
console.log(`key_id: ${key.id}`);
console.log(`key_name: ${key.name}`);
console.log(`key_prefix: ${key.key_prefix}`);
console.log(`status: ${key.status}`);
