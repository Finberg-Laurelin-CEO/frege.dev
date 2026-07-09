#!/usr/bin/env node
// Backfill lead scores for existing signups rows where score is null.
//
// Usage:
//   DATABASE_URL=... node scripts/prototype/backfill-lead-scores.mjs [batchSize]
//
// Default batch size is 200. Requires db/026_signup_intel.sql to be applied.
// Scores come from the same pure function used at signup time
// (lib/core/lead-score.ts), so backfilled rows match new rows exactly.

import { Pool } from "@neondatabase/serverless";
import { scoreLead } from "../../lib/core/lead-score.ts";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const batchSize = Number(process.argv[2] ?? 200);
if (!Number.isInteger(batchSize) || batchSize < 1) {
  console.error("batchSize must be a positive integer");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  let scored = 0;

  for (;;) {
    const { rows } = await pool.query(
      `
      select
        id, work_email, company_size, expected_users, current_agent_tools,
        monthly_ai_spend, willing_to_pay, decision_timeline, main_pain_point
      from signups
      where score is null
      order by created_at asc
      limit $1
    `,
      [batchSize],
    );
    if (rows.length === 0) break;

    for (const row of rows) {
      const lead = scoreLead({
        work_email: row.work_email ?? "",
        company_size: row.company_size ?? "",
        expected_users: Number(row.expected_users ?? 0),
        current_agent_tools: row.current_agent_tools ?? [],
        monthly_ai_spend: row.monthly_ai_spend ?? "Not provided",
        willing_to_pay: row.willing_to_pay ?? "Not provided",
        decision_timeline: row.decision_timeline ?? "Not provided",
        main_pain_point: row.main_pain_point ?? "",
      });
      await pool.query(`update signups set score = $1, band = $2 where id = $3`, [
        lead.score,
        lead.band,
        row.id,
      ]);
      scored += 1;
    }

    console.log(`Scored ${scored} signup(s) so far…`);
  }

  console.log(`Backfill complete: ${scored} signup(s) scored.`);
}

main()
  .catch((err) => {
    console.error(err?.message ?? err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
