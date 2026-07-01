-- Retry accounting for agent runs.
--
-- attempt_count is bumped every time a run is claimed for execution; when it exceeds
-- the runtime's max-attempts budget the run is dead-lettered instead of retried
-- forever. last_error records the most recent failure reason for diagnostics.

alter table agent_runs add column if not exists attempt_count int not null default 0;

alter table agent_runs add column if not exists last_error text;
