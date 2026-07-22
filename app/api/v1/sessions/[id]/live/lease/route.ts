import { appendSessionEvent } from "@/lib/core/brain";
import { orgContextFromMembership } from "@/lib/core/org-guard";
import { assertSafeBrowserMutation, readJson, routeError } from "@/lib/core/request-guards";
import {
  LIVE_RUN_ROOMS_ENABLED,
  LeaseActionSchema,
  RUN_ROOM_CONTROL,
  SESSION_LIVE_HANDOFF,
  SESSION_LIVE_LEASE,
  claimLease,
  createDirective,
  handoffLease,
  liveRunRoomsNotFound,
  logLiveOrgAudit,
  releaseLease,
  resolveWatcher,
  watcherActorContext,
  type LiveLease,
} from "@/lib/core/run-rooms";
import { logTelemetryEvent } from "@/lib/core/telemetry";
import type { BrainSessionEventType } from "@/lib/core/types";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function isActiveOrgMember(sql: ReturnType<typeof getSql>, orgId: string, userId: string): Promise<boolean> {
  const rows = (await sql`
    select user_id
    from organization_memberships
    where org_id = ${orgId}
      and user_id = ${userId}
      and status = 'active'
    limit 1
  `) as Array<{ user_id: string }>;
  return rows.length > 0;
}

// Control lease: exactly one controller at a time, enforced by a single
// compare-and-set UPDATE. The loser of any race sees 409 lease_held.
export async function POST(req: Request, context: RouteContext) {
  if (!LIVE_RUN_ROOMS_ENABLED()) return liveRunRoomsNotFound();

  const guardError = assertSafeBrowserMutation(req);
  if (guardError) return guardError;

  const { id } = await context.params;
  const resolution = await resolveWatcher(req, id);
  if (!resolution.ok) return resolution.response;
  const { watcher } = resolution;
  const userId = watcher.userSession.user.id;

  try {
    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = LeaseActionSchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }
    const action = parsed.data;

    const sql = getSql();
    let lease: LiveLease | null = null;
    let eventKind: BrainSessionEventType;
    let eventPayload: Record<string, unknown>;
    let auditAction: string = SESSION_LIVE_LEASE;

    if (action.action === "claim") {
      lease = await claimLease(sql, id, userId);
      eventKind = "run.live.lease.claimed" as BrainSessionEventType;
      eventPayload = { user_id: userId };
    } else if (action.action === "release") {
      lease = await releaseLease(sql, id, userId);
      eventKind = "run.live.lease.released" as BrainSessionEventType;
      eventPayload = { user_id: userId };
    } else {
      if (!(await isActiveOrgMember(sql, watcher.session.org_id, action.to_user_id))) {
        return Response.json({ error: "invalid_target" }, { status: 400 });
      }
      lease = await handoffLease(sql, id, userId, action.to_user_id);
      eventKind = "run.live.lease.handed_off" as BrainSessionEventType;
      eventPayload = { from_user_id: userId, to_user_id: action.to_user_id };
      auditAction = SESSION_LIVE_HANDOFF;
    }

    const telemetryAuth = orgContextFromMembership(watcher.userSession, watcher.membership);

    if (!lease) {
      await logTelemetryEvent({
        actor: { type: "user", auth: telemetryAuth },
        req,
        action: RUN_ROOM_CONTROL,
        resourceType: "brain_session",
        resourceId: id,
        sessionId: id,
        outcome: "denied",
        metadata: { action: `lease.${action.action}`, reason: "lease_held" },
      });
      return Response.json({ error: "lease_held" }, { status: 409 });
    }

    const ledgerEvent = await appendSessionEvent(watcherActorContext(watcher), {
      session_id: id,
      event_type: eventKind,
      payload: eventPayload,
    });

    await createDirective(sql, {
      sessionId: id,
      orgId: watcher.session.org_id,
      type: "lease_notice",
      payload: {
        action: action.action,
        holder_user_id: lease.controller_user_id,
        ...eventPayload,
      },
      createdBy: userId,
    });

    await logLiveOrgAudit(sql, req, {
      orgId: watcher.session.org_id,
      actorUser: { id: userId, email: watcher.userSession.user.email },
      action: auditAction,
      resourceType: "brain_session",
      resourceId: id,
      metadata: { action: action.action, ...eventPayload },
    });
    await logTelemetryEvent({
      actor: { type: "user", auth: telemetryAuth },
      req,
      action: RUN_ROOM_CONTROL,
      resourceType: "brain_session",
      resourceId: id,
      sessionId: id,
      sessionEventId: ledgerEvent.id,
      outcome: "success",
      metadata: { action: `lease.${action.action}`, ...eventPayload },
    });

    return Response.json(
      {
        lease: {
          controller_user_id: lease.controller_user_id,
          lease_acquired_at: lease.lease_acquired_at,
        },
      },
      { status: 200 },
    );
  } catch (err) {
    return routeError("live lease action failed", err);
  }
}
