-- Store the Live Run Rooms subset alongside each usage rollup snapshot.

alter table usage_daily
  add column if not exists live_room_watcher_seconds numeric not null default 0,
  add column if not exists live_room_estimated_cost_usd numeric not null default 0;
