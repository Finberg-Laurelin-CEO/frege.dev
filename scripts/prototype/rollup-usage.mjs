#!/usr/bin/env node
// Recompute usage_daily from telemetry_events for a trailing window.
//
// Usage:
//   DATABASE_URL=... node scripts/prototype/rollup-usage.mjs [days]
//
// Default window is 14 days.

import { Pool } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const days = Number(process.argv[2] ?? 14);
if (!Number.isFinite(days) || days < 1) {
  console.error("days must be a positive number");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const since = `${days} days`;

async function main() {
  const perUser = await pool.query(
    `
    insert into usage_daily (
      org_id, day, actor_user_id,
      model_calls, context_builds, denied_events,
      input_tokens, output_tokens, estimated_cost_usd, updated_at
    )
    select
      org_id, created_at::date, actor_user_id,
      count(*) filter (where action = 'model.invoke')::int,
      count(*) filter (where action = 'context.build')::int,
      count(*) filter (where outcome = 'denied')::int,
      coalesce(sum(input_tokens), 0)::bigint,
      coalesce(sum(output_tokens), 0)::bigint,
      coalesce(sum(estimated_cost_usd), 0)::numeric,
      now()
    from telemetry_events
    where org_id is not null and actor_user_id is not null
      and created_at > now() - $1::interval
    group by org_id, created_at::date, actor_user_id
    on conflict (org_id, day, coalesce(actor_user_id, '00000000-0000-0000-0000-000000000000'::uuid))
    do update set
      model_calls = excluded.model_calls,
      context_builds = excluded.context_builds,
      denied_events = excluded.denied_events,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      estimated_cost_usd = excluded.estimated_cost_usd,
      updated_at = now()
  `,
    [since],
  );

  const perOrg = await pool.query(
    `
    insert into usage_daily (
      org_id, day, actor_user_id,
      model_calls, context_builds, denied_events,
      input_tokens, output_tokens, estimated_cost_usd, updated_at
    )
    select
      org_id, created_at::date, null::uuid,
      count(*) filter (where action = 'model.invoke')::int,
      count(*) filter (where action = 'context.build')::int,
      count(*) filter (where outcome = 'denied')::int,
      coalesce(sum(input_tokens), 0)::bigint,
      coalesce(sum(output_tokens), 0)::bigint,
      coalesce(sum(estimated_cost_usd), 0)::numeric,
      now()
    from telemetry_events
    where org_id is not null
      and created_at > now() - $1::interval
    group by org_id, created_at::date
    on conflict (org_id, day, coalesce(actor_user_id, '00000000-0000-0000-0000-000000000000'::uuid))
    do update set
      model_calls = excluded.model_calls,
      context_builds = excluded.context_builds,
      denied_events = excluded.denied_events,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      estimated_cost_usd = excluded.estimated_cost_usd,
      updated_at = now()
  `,
    [since],
  );

  console.log(`Rolled up usage for last ${days} day(s): ${perUser.rowCount} user-day rows, ${perOrg.rowCount} org-day rows.`);
}

main()
  .catch((err) => {
    console.error(err?.message ?? err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
