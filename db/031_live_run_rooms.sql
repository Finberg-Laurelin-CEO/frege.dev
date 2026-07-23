-- Flag-gated Live Run Rooms foundations.

alter table brain_sessions
  add column if not exists live_status text not null default 'none',
  add column if not exists controller_user_id uuid,
  add column if not exists lease_acquired_at timestamptz,
  add column if not exists bridge_last_seen_at timestamptz;

alter table brain_sessions
  drop constraint if exists brain_sessions_live_status_chk;

alter table brain_sessions
  add constraint brain_sessions_live_status_chk
    check (live_status in ('none', 'live', 'ended'));

alter table brain_session_events
  drop constraint if exists brain_session_events_type_chk;

alter table brain_session_events
  add constraint brain_session_events_type_chk
    check (event_type in (
      'user_message',
      'assistant_message',
      'tool_call',
      'tool_result',
      'context_build',
      'model_invoke',
      'memory_signal',
      'note',
      'run.live.started',
      'run.live.agent_message',
      'run.live.command.started',
      'run.live.command.finished',
      'run.live.file_change',
      'run.live.approval.requested',
      'run.live.approval.resolved',
      'run.live.interrupted',
      'run.live.redirected',
      'run.live.lease.claimed',
      'run.live.lease.handed_off',
      'run.live.lease.released',
      'run.live.bridge.disconnected',
      'run.live.ended',
      'run.live.denied'
    ));

create table if not exists brain_session_directives (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references brain_sessions(id) on delete cascade,
  org_id       uuid not null references organizations(id) on delete cascade,
  type         text not null,
  payload      jsonb not null default '{}'::jsonb,
  created_by   uuid not null,
  created_at   timestamptz not null default now(),
  delivered_at timestamptz,
  acked_at     timestamptz,
  result       jsonb,

  constraint brain_session_directives_type_chk
    check (type in ('stop', 'redirect', 'resolve_approval', 'lease_notice'))
);

create index if not exists brain_session_directives_pending_idx
  on brain_session_directives (session_id, created_at)
  where acked_at is null;
