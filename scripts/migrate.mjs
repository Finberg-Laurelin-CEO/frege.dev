// One-off migration runner. Reads a .sql file and executes each statement
// against DATABASE_URL via @neondatabase/serverless. Used because psql is not
// installed locally. Run after `vercel env pull .env.local`:
//
//   node --env-file=.env.local scripts/migrate.mjs db/001_signups.sql
//
// We use Pool (a pg-compatible client) here rather than the `neon()` tagged-
// template helper because Pool exposes `.query(text)` for arbitrary DDL.
import { readFile } from "node:fs/promises";
import { Pool } from "@neondatabase/serverless";

const file = process.argv[2] ?? "db/001_signups.sql";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Run `vercel env pull .env.local` first,");
  console.error("then: node --env-file=.env.local scripts/migrate.mjs " + file);
  process.exit(1);
}

const raw = await readFile(file, "utf8");

// Strip line comments, then split on semicolons at statement boundaries.
// (Our migration has no semicolons inside string literals, so this is safe.)
const statements = raw
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

console.log(`Running ${statements.length} statement(s) from ${file}…`);
try {
  for (const stmt of statements) {
    const preview = stmt.replace(/\s+/g, " ").slice(0, 70);
    process.stdout.write(`  • ${preview}… `);
    await pool.query(stmt);
    console.log("ok");
  }
  console.log("Migration complete.");
} finally {
  await pool.end();
}
