#!/usr/bin/env node
// Grant or revoke platform staff (cross-org operator) access for a user.
//
// Usage:
//   DATABASE_URL=... node scripts/prototype/set-platform-staff.mjs user@example.com [--revoke]

import { neon } from "@neondatabase/serverless";

const email = process.argv[2]?.trim().toLowerCase();
const revoke = process.argv.includes("--revoke");

if (!process.env.DATABASE_URL || !email) {
  console.error("Usage: DATABASE_URL=... node scripts/prototype/set-platform-staff.mjs user@example.com [--revoke]");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const [user] = await sql`
  update users
  set is_platform_staff = ${!revoke}
  where email = ${email}
  returning id, email, is_platform_staff
`;

if (!user) {
  console.error(`No user found for ${email}`);
  process.exit(1);
}

console.log(JSON.stringify({ email: user.email, is_platform_staff: user.is_platform_staff }, null, 2));
