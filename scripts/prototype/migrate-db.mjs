#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { readdirSync } from "node:fs";
import { Pool } from "@neondatabase/serverless";

const dbDir = join(process.cwd(), "db");
const mode = process.argv.includes("--status") ? "status" : process.argv.includes("--verify") ? "verify" : "migrate";

function usage() {
  console.error("Usage: DATABASE_URL=... node scripts/prototype/migrate-db.mjs [--status|--verify]");
}

if (!process.env.DATABASE_URL) {
  usage();
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const migrations = readdirSync(dbDir)
  .filter((file) => /^\d+_.+\.sql$/.test(file))
  .sort();

async function query(text, params = []) {
  return pool.query(text, params);
}

async function ensureLedger() {
  await query(`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);
}

async function appliedSet() {
  await ensureLedger();
  const { rows } = await query("select name from schema_migrations order by name asc");
  return new Set(rows.map((row) => String(row.name)));
}

async function applyMigration(name) {
  const body = await readFile(join(dbDir, name), "utf8");
  await query(body);
  await query("insert into schema_migrations (name) values ($1) on conflict (name) do nothing", [name]);
}

async function main() {
  const applied = await appliedSet();
  const pending = migrations.filter((name) => !applied.has(name));

  if (mode === "status") {
    console.log(JSON.stringify({ migrations: migrations.map((name) => ({ name, applied: applied.has(name) })) }, null, 2));
    return;
  }

  if (mode === "verify") {
    if (pending.length > 0) {
      console.error(`Pending migrations: ${pending.join(", ")}`);
      process.exit(1);
    }
    console.log("All migrations applied.");
    return;
  }

  for (const name of pending) {
    console.log(`Applying ${basename(name)}`);
    await applyMigration(name);
  }
  console.log(pending.length === 0 ? "No pending migrations." : `Applied ${pending.length} migration(s).`);
}

main()
  .catch((err) => {
    console.error(err?.message ?? err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
