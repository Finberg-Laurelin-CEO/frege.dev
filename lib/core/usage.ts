import { getSql } from "@/lib/db";

export type UsageRow = {
  org_id: string;
  day: string;
  actor_user_id: string | null;
  model_calls: number;
  context_builds: number;
  denied_events: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
};

export type UsageTotals = {
  model_calls: number;
  context_builds: number;
  denied_events: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
};

const EMPTY_TOTALS: UsageTotals = {
  model_calls: 0,
  context_builds: 0,
  denied_events: 0,
  input_tokens: 0,
  output_tokens: 0,
  estimated_cost_usd: 0,
};

// Rebuild usage_daily for the trailing window from raw telemetry_events.
// Idempotent: recomputes each (org, day, user) and the per-day org aggregate.
export async function rollupUsage(days = 14): Promise<{ rows: number }> {
  const sql = getSql();
  const since = `${days} days`;

  // Per-user daily rollup (actor_user_id is not null).
  const perUser = await sql`
    insert into usage_daily (
      org_id, day, actor_user_id,
      model_calls, context_builds, denied_events,
      input_tokens, output_tokens, estimated_cost_usd, updated_at
    )
    select
      org_id,
      created_at::date as day,
      actor_user_id,
      count(*) filter (where action = 'model.invoke')::int,
      count(*) filter (where action = 'context.build')::int,
      count(*) filter (where outcome = 'denied')::int,
      coalesce(sum(input_tokens), 0)::bigint,
      coalesce(sum(output_tokens), 0)::bigint,
      coalesce(sum(estimated_cost_usd), 0)::numeric,
      now()
    from telemetry_events
    where org_id is not null
      and actor_user_id is not null
      and created_at > now() - ${since}::interval
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
    returning 1
  `;

  // Whole-org daily aggregate (actor_user_id null), covers all actors incl. api keys/system.
  const perOrg = await sql`
    insert into usage_daily (
      org_id, day, actor_user_id,
      model_calls, context_builds, denied_events,
      input_tokens, output_tokens, estimated_cost_usd, updated_at
    )
    select
      org_id,
      created_at::date as day,
      null::uuid,
      count(*) filter (where action = 'model.invoke')::int,
      count(*) filter (where action = 'context.build')::int,
      count(*) filter (where outcome = 'denied')::int,
      coalesce(sum(input_tokens), 0)::bigint,
      coalesce(sum(output_tokens), 0)::bigint,
      coalesce(sum(estimated_cost_usd), 0)::numeric,
      now()
    from telemetry_events
    where org_id is not null
      and created_at > now() - ${since}::interval
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
    returning 1
  `;

  return { rows: perUser.length + perOrg.length };
}

// Per-org totals for a trailing window, from the org aggregate rows.
export async function orgUsageTotals(orgId: string, days = 30): Promise<UsageTotals> {
  const sql = getSql();
  const [row] = await sql`
    select
      coalesce(sum(model_calls), 0)::int as model_calls,
      coalesce(sum(context_builds), 0)::int as context_builds,
      coalesce(sum(denied_events), 0)::int as denied_events,
      coalesce(sum(input_tokens), 0)::bigint as input_tokens,
      coalesce(sum(output_tokens), 0)::bigint as output_tokens,
      coalesce(sum(estimated_cost_usd), 0)::float as estimated_cost_usd
    from usage_daily
    where org_id = ${orgId}
      and actor_user_id is null
      and day > (now() - ${`${days} days`}::interval)::date
  `;
  return (row as UsageTotals) ?? EMPTY_TOTALS;
}

// Per-user breakdown for an org over a trailing window.
export async function orgUsageByUser(orgId: string, days = 30) {
  const sql = getSql();
  return sql`
    select
      u.id as user_id,
      u.email,
      u.name,
      coalesce(sum(ud.model_calls), 0)::int as model_calls,
      coalesce(sum(ud.context_builds), 0)::int as context_builds,
      coalesce(sum(ud.denied_events), 0)::int as denied_events,
      coalesce(sum(ud.input_tokens), 0)::bigint as input_tokens,
      coalesce(sum(ud.output_tokens), 0)::bigint as output_tokens,
      coalesce(sum(ud.estimated_cost_usd), 0)::float as estimated_cost_usd
    from usage_daily ud
    join users u on u.id = ud.actor_user_id
    where ud.org_id = ${orgId}
      and ud.actor_user_id is not null
      and ud.day > (now() - ${`${days} days`}::interval)::date
    group by u.id, u.email, u.name
    order by estimated_cost_usd desc, model_calls desc
  `;
}

// Platform-wide per-org usage (for the staff console).
export async function platformUsageByOrg(days = 30) {
  const sql = getSql();
  return sql`
    select
      o.id as org_id,
      o.slug,
      o.name,
      o.status,
      coalesce(sum(ud.model_calls), 0)::int as model_calls,
      coalesce(sum(ud.context_builds), 0)::int as context_builds,
      coalesce(sum(ud.denied_events), 0)::int as denied_events,
      coalesce(sum(ud.input_tokens), 0)::bigint as input_tokens,
      coalesce(sum(ud.output_tokens), 0)::bigint as output_tokens,
      coalesce(sum(ud.estimated_cost_usd), 0)::float as estimated_cost_usd,
      coalesce(rr.watcher_hours, 0)::float as live_room_watcher_hours,
      coalesce(rr.estimated_cost_usd, 0)::float as live_room_estimated_cost_usd
    from organizations o
    left join usage_daily ud
      on ud.org_id = o.id
      and ud.actor_user_id is null
      and ud.day > (now() - ${`${days} days`}::interval)::date
    left join lateral (
      select
        coalesce(sum((metadata->>'watcher_hours')::numeric), 0) as watcher_hours,
        coalesce(sum(estimated_cost_usd), 0) as estimated_cost_usd
      from telemetry_events
      where org_id = o.id
        and action = 'run_room.watch_metered'
        and created_at > now() - ${`${days} days`}::interval
    ) rr on true
    group by o.id, o.slug, o.name, o.status, rr.watcher_hours, rr.estimated_cost_usd
    order by estimated_cost_usd desc, model_calls desc
  `;
}

// Platform-wide daily totals across all orgs (trend over time).
export async function platformUsageDailySeries(days = 30) {
  const sql = getSql();
  return sql`
    select
      ud.day,
      coalesce(sum(ud.model_calls), 0)::int as model_calls,
      coalesce(sum(ud.context_builds), 0)::int as context_builds,
      coalesce(sum(ud.denied_events), 0)::int as denied_events,
      coalesce(sum(ud.input_tokens), 0)::bigint as input_tokens,
      coalesce(sum(ud.output_tokens), 0)::bigint as output_tokens,
      coalesce(sum(ud.estimated_cost_usd), 0)::float as estimated_cost_usd
    from usage_daily ud
    where ud.actor_user_id is null
      and ud.day > (now() - ${`${days} days`}::interval)::date
    group by ud.day
    order by ud.day asc
  `;
}
