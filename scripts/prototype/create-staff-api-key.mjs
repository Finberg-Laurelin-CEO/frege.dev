// Create a platform-staff API key for agentic admin access.
//
// The key authorizes its owner as platform staff across all orgs. Access is
// gated at request time by the owner still having users.is_platform_staff = true,
// so revoking staff status (or revoking the key) immediately removes access.
//
// Required env:
//   DATABASE_URL
//   FREGE_API_KEY_SALT
//
// Usage:
//   node --env-file=.env.local scripts/prototype/create-staff-api-key.mjs <owner-email> [key-name]
//
// Example:
//   node --env-file=.env.local scripts/prototype/create-staff-api-key.mjs joe@frege.dev "Admin agent"

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

const ownerEmail = process.argv[2]?.trim().toLowerCase();
const keyName = process.argv[3] ?? "Admin agent key";

if (!ownerEmail) {
  console.error("Usage: node --env-file=.env.local scripts/prototype/create-staff-api-key.mjs <owner-email> [key-name]");
  process.exit(1);
}

function hashApiKey(rawKey) {
  return createHash("sha256").update(`${rawKey}|${apiKeySalt}`).digest("hex");
}

function generateStaffApiKey() {
  const keyPrefix = randomBytes(6).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  const rawKey = `frg_admin_${keyPrefix}_${secret}`;

  return {
    rawKey,
    keyPrefix,
    keyHash: hashApiKey(rawKey),
  };
}

const sql = neon(databaseUrl);

const [owner] = await sql`
  select id, email, is_platform_staff, status
  from users
  where lower(email) = ${ownerEmail}
  limit 1
`;

if (!owner) {
  console.error(`No user found for email=${ownerEmail}.`);
  process.exit(1);
}

if (owner.is_platform_staff !== true) {
  console.error(
    `User ${owner.email} is not platform staff. Run set-platform-staff first; the key will be inert otherwise.`,
  );
  process.exit(1);
}

const key = generateStaffApiKey();
const [row] = await sql`
  insert into platform_staff_api_keys (owner_user_id, name, key_prefix, key_hash)
  values (${owner.id}, ${keyName}, ${key.keyPrefix}, ${key.keyHash})
  returning id, name, key_prefix
`;

console.log("Created platform-staff API key.");
console.log(`owner: ${owner.email}`);
console.log(`key_id: ${row.id}`);
console.log(`key_name: ${row.name}`);
console.log(`key_prefix: ${row.key_prefix}`);
console.log("");
console.log("Raw key. Copy it now; only the hash is stored:");
console.log(key.rawKey);
