#!/usr/bin/env node
// Replay cron work locally against DATABASE_URL without going through HTTP.
//
// Usage:
//   DATABASE_URL=... node scripts/prototype/replay-cron.mjs usage-rollup [days]
//   DATABASE_URL=... node scripts/prototype/replay-cron.mjs frege-signup-stats

import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);

    const target = join(root, specifier.slice(2));
    const resolved = existsSync(target) ? target : `${target}.ts`;
    return nextResolve(pathToFileURL(resolved).href, context);
  },
});

function usage() {
  console.error("Usage: DATABASE_URL=... node scripts/prototype/replay-cron.mjs <usage-rollup|frege-signup-stats> [days]");
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const job = process.argv[2];
if (!job) {
  usage();
  process.exit(1);
}

if (job === "usage-rollup") {
  const days = Number(process.argv[3] ?? 14);
  if (!Number.isFinite(days) || days < 1) {
    console.error("days must be a positive number");
    process.exit(1);
  }

  const { rollupUsage } = await import(pathToFileURL(join(root, "lib/prototype/usage.ts")).href);
  const result = await rollupUsage(days);
  console.log(JSON.stringify({ ok: true, job, days, rolled_rows: result.rows }, null, 2));
} else if (job === "frege-signup-stats") {
  const { getFregeSignupStats } = await import(pathToFileURL(join(root, "lib/frege-signup-stats.ts")).href);
  const stats = await getFregeSignupStats();
  console.log(JSON.stringify({ ok: true, job, stats }, null, 2));
} else {
  usage();
  process.exit(1);
}
