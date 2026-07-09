-- Backend hygiene: index telemetry_events for the hourly usage rollup.
--
-- NOTE — db/015 gap: db/015_free_activation_codes.sql was added and then deleted
-- from the tree (commits b785a19 -> b3b53f2) without a down-migration, so prod
-- may still carry the orphaned free_activation_codes table and its
-- schema_migrations row for 015. This migration intentionally does not touch it.
-- Manual check: run `pnpm db:status` — if 015 shows as applied, confirm the
-- table is unused before dropping it and its schema_migrations row by hand.

-- rollupUsage (lib/core/usage.ts) rebuilds usage_daily every hour by scanning
-- telemetry_events on bare created_at (`created_at > now() - interval`). All
-- existing telemetry_events indexes are org_id-prefixed, so that scan is a
-- sequential read of the whole table without this index.
create index if not exists telemetry_events_created_at_idx
  on telemetry_events (created_at);
