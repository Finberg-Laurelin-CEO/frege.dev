#!/usr/bin/env node
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { neon } from "@neondatabase/serverless";

const scrypt = promisify(scryptCallback);
const email = process.argv[2]?.trim().toLowerCase();
const password = process.argv[3] || `Frege-${randomBytes(18).toString("base64url")}!9`;

if (!process.env.DATABASE_URL || !email) {
  console.error("Usage: DATABASE_URL=... node scripts/prototype/change-user-password.mjs user@example.com [new-password]");
  process.exit(1);
}

if (password.length < 12) {
  console.error("Password must be at least 12 characters.");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const rows = await sql`select id, email from users where email = ${email} limit 1`;
const user = rows[0];
if (!user) {
  console.error(`No user found for ${email}`);
  process.exit(1);
}

const salt = randomBytes(16).toString("hex");
const derived = await scrypt(password, salt, 64);
const params = { algorithm: "scrypt", key_length: 64 };

await sql`
  insert into user_password_credentials (user_id, password_hash, password_salt, password_params)
  values (${user.id}, ${derived.toString("hex")}, ${salt}, ${JSON.stringify(params)}::jsonb)
  on conflict (user_id) do update
    set password_hash = excluded.password_hash,
        password_salt = excluded.password_salt,
        password_params = excluded.password_params,
        updated_at = now()
`;
await sql`
  update user_sessions
  set status = 'revoked', revoked_at = now()
  where user_id = ${user.id}
    and status = 'active'
`;

console.log(JSON.stringify({ email: user.email, password }, null, 2));
