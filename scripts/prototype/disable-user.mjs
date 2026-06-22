#!/usr/bin/env node
import { neon } from "@neondatabase/serverless";

const email = process.argv[2]?.trim().toLowerCase();
if (!process.env.DATABASE_URL || !email) {
  console.error("Usage: DATABASE_URL=... node scripts/prototype/disable-user.mjs user@example.com");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const [user] = await sql`
  update users
  set status = 'disabled'
  where email = ${email}
  returning id, email, status
`;

if (!user) {
  console.error(`No user found for ${email}`);
  process.exit(1);
}

await sql`
  update user_sessions
  set status = 'revoked', revoked_at = now()
  where user_id = ${user.id}
    and status = 'active'
`;

console.log(JSON.stringify({ disabled: user.email, status: user.status }, null, 2));
