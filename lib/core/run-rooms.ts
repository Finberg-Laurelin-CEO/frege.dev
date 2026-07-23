import { createHash } from "node:crypto";
import { z } from "zod";
import { getSql } from "@/lib/db";
import type { FregeActorContext } from "@/lib/core/actor-auth";
import { orgContextFromMembership } from "@/lib/core/org-guard";
import {
  authenticateUserRequest,
  userUnauthorized,
  type UserSessionContext,
  type UserSessionMembership,
} from "@/lib/core/session";
import type { TrustZone } from "@/lib/core/types";

type RunRoomsSql = ReturnType<typeof getSql>;

export const LIVE_RUN_ROOMS_ENABLED = () => process.env.FREGE_LIVE_RUN_ROOMS === "true";

export const LIVE_EVENT_KINDS = [
  "run.live.started",
  "run.live.agent_message",
  "run.live.command.started",
  "run.live.command.finished",
  "run.live.file_change",
  "run.live.approval.requested",
  "run.live.approval.resolved",
  "run.live.interrupted",
  "run.live.redirected",
  "run.live.lease.claimed",
  "run.live.lease.handed_off",
  "run.live.lease.released",
  "run.live.bridge.disconnected",
  "run.live.ended",
  "run.live.denied",
] as const;

export type LiveEventKind = (typeof LIVE_EVENT_KINDS)[number];

export const ControlActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("stop") }),
  z.object({ action: z.literal("redirect"), message: z.string().trim().min(1).max(10_000) }),
  z.object({
    action: z.literal("resolve_approval"),
    approval_id: z.string().trim().min(1).max(240),
    decision: z.enum(["approve", "deny"]),
  }),
]);

export const LeaseActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim") }),
  z.object({ action: z.literal("release") }),
  z.object({ action: z.literal("handoff"), to_user_id: z.string().uuid() }),
]);

export const LiveEventBatchSchema = z
  .array(
    z.object({
      kind: z.enum(LIVE_EVENT_KINDS),
      payload: z.record(z.unknown()).default({}),
      occurred_at: z.string().datetime(),
    }),
  )
  .min(1)
  .max(100);

export const DIRECTIVE_TYPES = ["stop", "redirect", "resolve_approval", "lease_notice"] as const;
export type DirectiveType = (typeof DIRECTIVE_TYPES)[number];

export type LiveLease = {
  id: string;
  org_id: string;
  controller_user_id: string | null;
  lease_acquired_at: Date | string | null;
};

export type LiveDirective = {
  id: string;
  session_id: string;
  org_id: string;
  type: DirectiveType;
  payload: Record<string, unknown>;
  created_by: string;
  created_at: Date | string;
  delivered_at: Date | string | null;
  acked_at: Date | string | null;
  result: Record<string, unknown> | null;
};

export type CreateDirectiveInput = {
  sessionId: string;
  orgId: string;
  type: DirectiveType;
  payload?: Record<string, unknown>;
  createdBy: string;
};

export const RUN_ROOM_WATCH_OPENED = "run_room.watch_opened";
export const RUN_ROOM_WATCH_METERED = "run_room.watch_metered";
export const RUN_ROOM_CONTROL = "run_room.control";
export const SESSION_LIVE_STOP = "session.live.stop";
export const SESSION_LIVE_REDIRECT = "session.live.redirect";
export const SESSION_LIVE_APPROVAL = "session.live.approval";
export const SESSION_LIVE_HANDOFF = "session.live.handoff";
export const SESSION_LIVE_LEASE = "session.live.lease";

// The bridge is considered gone when it has not touched the server for this long.
export const BRIDGE_STALE_MS = 60_000;
export const DEFAULT_RUN_ROOM_WATCHER_COST_USD_PER_HOUR = 0.08;

export function runRoomWatcherUsage(durationMs: number): {
  watcherHours: number;
  estimatedCostUsd: number;
  costRateUsdPerHour: number;
} {
  const configuredRate = Number(process.env.FREGE_LIVE_WATCHER_COST_USD_PER_HOUR);
  const costRateUsdPerHour =
    Number.isFinite(configuredRate) && configuredRate >= 0
      ? configuredRate
      : DEFAULT_RUN_ROOM_WATCHER_COST_USD_PER_HOUR;
  const watcherHours = Math.max(0, durationMs) / 3_600_000;

  return {
    watcherHours,
    estimatedCostUsd: Number((watcherHours * costRateUsdPerHour).toFixed(6)),
    costRateUsdPerHour,
  };
}

const LEASE_RETURNING = "id, org_id, controller_user_id, lease_acquired_at";

export async function claimLease(sql: RunRoomsSql, sessionId: string, userId: string): Promise<LiveLease | null> {
  const rows = (await sql`
    update brain_sessions
    set controller_user_id = ${userId}, lease_acquired_at = now()
    where id = ${sessionId}
      and controller_user_id is null
    returning id, org_id, controller_user_id, lease_acquired_at
  `) as LiveLease[];
  return rows[0] ?? null;
}

export async function handoffLease(
  sql: RunRoomsSql,
  sessionId: string,
  fromUserId: string,
  toUserId: string,
): Promise<LiveLease | null> {
  const rows = (await sql`
    update brain_sessions
    set controller_user_id = ${toUserId}, lease_acquired_at = now()
    where id = ${sessionId}
      and controller_user_id = ${fromUserId}
    returning id, org_id, controller_user_id, lease_acquired_at
  `) as LiveLease[];
  return rows[0] ?? null;
}

export async function releaseLease(sql: RunRoomsSql, sessionId: string, userId: string): Promise<LiveLease | null> {
  const rows = (await sql`
    update brain_sessions
    set controller_user_id = null, lease_acquired_at = null
    where id = ${sessionId}
      and controller_user_id = ${userId}
    returning id, org_id, controller_user_id, lease_acquired_at
  `) as LiveLease[];
  return rows[0] ?? null;
}

export async function createDirective(sql: RunRoomsSql, input: CreateDirectiveInput): Promise<LiveDirective> {
  const rows = (await sql`
    insert into brain_session_directives (session_id, org_id, type, payload, created_by)
    values (
      ${input.sessionId},
      ${input.orgId},
      ${input.type},
      ${JSON.stringify(input.payload ?? {})}::jsonb,
      ${input.createdBy}
    )
    returning *
  `) as LiveDirective[];
  const directive = rows[0];
  if (!directive) throw new Error("directive_insert_failed");
  return directive;
}

export async function takeUndeliveredDirectives(
  sql: RunRoomsSql,
  sessionId: string,
  orgId: string,
): Promise<LiveDirective[]> {
  const rows = (await sql`
    update brain_session_directives
    set delivered_at = now()
    where session_id = ${sessionId}
      and org_id = ${orgId}
      and delivered_at is null
      and acked_at is null
    returning *
  `) as LiveDirective[];
  return rows.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

export async function ackDirective(
  sql: RunRoomsSql,
  directiveId: string,
  sessionId: string,
  orgId: string,
  result: Record<string, unknown>,
): Promise<LiveDirective | null> {
  const rows = (await sql`
    update brain_session_directives
    set acked_at = now(), result = ${JSON.stringify(result ?? {})}::jsonb
    where id = ${directiveId}
      and session_id = ${sessionId}
      and org_id = ${orgId}
      and acked_at is null
    returning *
  `) as LiveDirective[];
  return rows[0] ?? null;
}

// --- Shared route helpers (WT-A) -------------------------------------------

export type LiveSessionRow = {
  id: string;
  org_id: string;
  status: string;
  trust_zone: TrustZone;
  live_status: "none" | "live" | "ended";
  controller_user_id: string | null;
  lease_acquired_at: Date | string | null;
  bridge_last_seen_at: Date | string | null;
};

export function liveRunRoomsNotFound(): Response {
  return Response.json({ error: "not_found" }, { status: 404 });
}

export async function getLiveSessionRow(sql: RunRoomsSql, sessionId: string): Promise<LiveSessionRow | null> {
  const rows = (await sql`
    select id, org_id, status, trust_zone, live_status, controller_user_id, lease_acquired_at, bridge_last_seen_at
    from brain_sessions
    where id = ${sessionId}
    limit 1
  `) as LiveSessionRow[];
  return rows[0] ?? null;
}

export async function markBridgeSeen(
  sql: RunRoomsSql,
  sessionId: string,
  orgId: string,
  liveStatus?: "live" | "ended",
): Promise<void> {
  if (liveStatus) {
    await sql`
      update brain_sessions
      set bridge_last_seen_at = now(), live_status = ${liveStatus}
      where id = ${sessionId}
        and org_id = ${orgId}
    `;
    return;
  }
  await sql`
    update brain_sessions
    set bridge_last_seen_at = now()
    where id = ${sessionId}
      and org_id = ${orgId}
  `;
}

export function bridgeIsStale(row: Pick<LiveSessionRow, "bridge_last_seen_at">, now = Date.now()): boolean {
  if (!row.bridge_last_seen_at) return true;
  return now - new Date(row.bridge_last_seen_at).getTime() > BRIDGE_STALE_MS;
}

export async function hasUndeliveredDirectives(sql: RunRoomsSql, sessionId: string, orgId: string): Promise<boolean> {
  const rows = (await sql`
    select id
    from brain_session_directives
    where session_id = ${sessionId}
      and org_id = ${orgId}
      and delivered_at is null
      and acked_at is null
    limit 1
  `) as Array<{ id: string }>;
  return rows.length > 0;
}

export async function findUnresolvedApproval(
  sql: RunRoomsSql,
  sessionId: string,
  orgId: string,
  approvalId: string,
): Promise<{ id: string } | null> {
  const rows = (await sql`
    select id
    from brain_session_events
    where session_id = ${sessionId}
      and org_id = ${orgId}
      and event_type = 'run.live.approval.requested'
      and payload->>'approval_id' = ${approvalId}
      and not exists (
        select 1
        from brain_session_events resolved
        where resolved.session_id = ${sessionId}
          and resolved.org_id = ${orgId}
          and resolved.event_type = 'run.live.approval.resolved'
          and resolved.payload->>'approval_id' = ${approvalId}
      )
    limit 1
  `) as Array<{ id: string }>;
  return rows[0] ?? null;
}

export type LiveLedgerEvent = {
  id: string;
  session_id: string;
  actor_type: string;
  actor_user_id: string | null;
  event_type: string;
  body_md: string;
  payload: Record<string, unknown>;
  trust_zone: TrustZone;
  created_at: Date | string;
};

export async function listLiveEventsAfter(
  sql: RunRoomsSql,
  input: {
    sessionId: string;
    orgId: string;
    zones: TrustZone[];
    after?: { createdAt: Date | string; id: string } | null;
    limit?: number;
  },
): Promise<LiveLedgerEvent[]> {
  const limit = input.limit ?? 200;
  if (input.after) {
    return (await sql`
      select id, session_id, actor_type, actor_user_id, event_type, body_md, payload, trust_zone, created_at
      from brain_session_events
      where session_id = ${input.sessionId}
        and org_id = ${input.orgId}
        and trust_zone = any(${input.zones}::text[])
        and (created_at, id) > (${input.after.createdAt}::timestamptz, ${input.after.id}::uuid)
      order by created_at asc, id asc
      limit ${limit}
    `) as LiveLedgerEvent[];
  }
  return (await sql`
    select id, session_id, actor_type, actor_user_id, event_type, body_md, payload, trust_zone, created_at
    from brain_session_events
    where session_id = ${input.sessionId}
      and org_id = ${input.orgId}
      and trust_zone = any(${input.zones}::text[])
    order by created_at asc, id asc
    limit ${limit}
  `) as LiveLedgerEvent[];
}

export async function resolveEventCursor(
  sql: RunRoomsSql,
  sessionId: string,
  orgId: string,
  eventId: string,
): Promise<{ createdAt: Date | string; id: string } | null> {
  const rows = (await sql`
    select id, created_at
    from brain_session_events
    where id = ${eventId}
      and session_id = ${sessionId}
      and org_id = ${orgId}
    limit 1
  `) as Array<{ id: string; created_at: Date | string }>;
  const row = rows[0];
  return row ? { createdAt: row.created_at, id: row.id } : null;
}

export function watcherTrustZones(membership: UserSessionMembership): TrustZone[] {
  return membership.role === "owner" || membership.role === "admin" ? ["green", "red"] : ["green"];
}

export type WatcherContext = {
  userSession: UserSessionContext;
  membership: UserSessionMembership;
  session: LiveSessionRow;
  zones: TrustZone[];
};

export type WatcherResolution = { ok: true; watcher: WatcherContext } | { ok: false; response: Response };

// Same-org active membership is the watch bar (§1). Everything else — absent
// session, out-of-org, trust-zone mismatch — collapses into the indistinguishable
// 404 not_found denial shape existing brain routes use.
export async function resolveWatcher(req: Request, sessionId: string): Promise<WatcherResolution> {
  const userSession = await authenticateUserRequest(req);
  if (!userSession) return { ok: false, response: userUnauthorized() };

  const sql = getSql();
  const session = await getLiveSessionRow(sql, sessionId);
  if (!session) return { ok: false, response: liveRunRoomsNotFound() };

  const membership = userSession.memberships.find(
    (item) => item.org_id === session.org_id && item.status === "active",
  );
  if (!membership || membership.org_status !== "active") {
    return { ok: false, response: liveRunRoomsNotFound() };
  }

  const zones = watcherTrustZones(membership);
  if (!zones.includes(session.trust_zone)) return { ok: false, response: liveRunRoomsNotFound() };

  return { ok: true, watcher: { userSession, membership, session, zones } };
}

// A ledger-writing actor context for a watcher who has already passed the
// same-org membership + lease checks above. Session read/write capability is
// granted explicitly here: the run-rooms trust decision is membership+lease,
// not the doc-role capability matrix.
export function watcherActorContext(watcher: WatcherContext): FregeActorContext {
  const base = orgContextFromMembership(watcher.userSession, watcher.membership);
  return {
    actorType: "user",
    userAuth: base,
    organization: { ...base.organization, status: watcher.membership.org_status },
    allowedLabels: base.allowedLabels,
    capabilities: {
      canCreateDocs: base.capabilities.canManageOrg,
      canUpdateDocs: base.capabilities.canManageOrg,
      canReadAudit: base.capabilities.canReadAudit,
      canManageOrg: base.capabilities.canManageOrg,
      canManageKeys: base.capabilities.canManageKeys,
      canManageModels: base.capabilities.canManageModels,
      canProposeMemory: base.capabilities.canProposeMemory,
      canReviewMemoryProposals: base.capabilities.canReviewMemoryProposals,
      canManageSources: base.capabilities.canManageSources,
      canExecuteAgents: base.capabilities.canExecuteAgents,
      canReadSessions: true,
      canWriteSessions: true,
    },
  };
}

function auditIpHash(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  const ip = xff ? xff.split(",")[0]!.trim() : req.headers.get("x-real-ip") ?? "unknown";
  const day = new Date().toISOString().slice(0, 10);
  const salt = process.env.IP_HASH_SALT ?? "frege-default-salt";
  return createHash("sha256").update(`${ip}|${day}|${salt}`).digest("hex");
}

// Org audit for console-session actors. audit_events has no actor_user_id
// column (it predates human actors), so the acting user is recorded in
// metadata; actor_key_id stays null.
export async function logLiveOrgAudit(
  sql: RunRoomsSql,
  req: Request,
  input: {
    orgId: string;
    actorUser: { id: string; email: string };
    action: string;
    resourceType?: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await sql`
    insert into audit_events (org_id, actor_key_id, action, resource_type, resource_id, ip_hash, user_agent, metadata)
    values (
      ${input.orgId},
      ${null},
      ${input.action},
      ${input.resourceType ?? null},
      ${input.resourceId ?? null},
      ${auditIpHash(req)},
      ${req.headers.get("user-agent")},
      ${JSON.stringify({
        ...(input.metadata ?? {}),
        actor_user_id: input.actorUser.id,
        actor_email: input.actorUser.email,
      })}::jsonb
    )
  `;
}
