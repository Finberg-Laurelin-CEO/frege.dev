import { appendSessionEvent } from "@/lib/core/brain";
import { orgContextFromMembership } from "@/lib/core/org-guard";
import { assertSafeBrowserMutation, readJson, routeError } from "@/lib/core/request-guards";
import {
  ControlActionSchema,
  LIVE_RUN_ROOMS_ENABLED,
  RUN_ROOM_CONTROL,
  SESSION_LIVE_APPROVAL,
  SESSION_LIVE_REDIRECT,
  SESSION_LIVE_STOP,
  createDirective,
  findUnresolvedApproval,
  liveRunRoomsNotFound,
  logLiveOrgAudit,
  resolveWatcher,
  watcherActorContext,
  type DirectiveType,
} from "@/lib/core/run-rooms";
import { logTelemetryEvent } from "@/lib/core/telemetry";
import type { BrainSessionEventType } from "@/lib/core/types";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

// Control actions: only the current lease holder may stop, redirect, or resolve
// approvals. Every action becomes a directive for the bridge AND a governed
// ledger event with the acting identity.
export async function POST(req: Request, context: RouteContext) {
  if (!LIVE_RUN_ROOMS_ENABLED()) return liveRunRoomsNotFound();

  const guardError = assertSafeBrowserMutation(req);
  if (guardError) return guardError;

  const { id } = await context.params;
  const resolution = await resolveWatcher(req, id);
  if (!resolution.ok) return resolution.response;
  const { watcher } = resolution;
  const userId = watcher.userSession.user.id;
  const telemetryAuth = orgContextFromMembership(watcher.userSession, watcher.membership);

  try {
    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = ControlActionSchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }
    const action = parsed.data;

    if (watcher.session.controller_user_id !== userId) {
      // Denied control attempts are part of the governed history too.
      await appendSessionEvent(watcherActorContext(watcher), {
        session_id: id,
        event_type: "run.live.denied" as BrainSessionEventType,
        payload: { action: action.action, reason: "not_controller", user_id: userId },
      });
      await logTelemetryEvent({
        actor: { type: "user", auth: telemetryAuth },
        req,
        action: RUN_ROOM_CONTROL,
        resourceType: "brain_session",
        resourceId: id,
        sessionId: id,
        outcome: "denied",
        metadata: { action: action.action, reason: "not_controller" },
      });
      return Response.json({ error: "not_controller" }, { status: 409 });
    }

    const sql = getSql();
    const resolver = { user_id: userId, email: watcher.userSession.user.email };

    let directiveType: DirectiveType;
    let directivePayload: Record<string, unknown>;
    let eventKind: BrainSessionEventType;
    let eventPayload: Record<string, unknown>;
    let eventBody = "";
    let auditAction: string;

    if (action.action === "stop") {
      directiveType = "stop";
      directivePayload = { requested_by: resolver };
      eventKind = "run.live.interrupted" as BrainSessionEventType;
      eventPayload = { requested_by: userId };
      auditAction = SESSION_LIVE_STOP;
    } else if (action.action === "redirect") {
      directiveType = "redirect";
      directivePayload = { message: action.message, requested_by: resolver };
      eventKind = "run.live.redirected" as BrainSessionEventType;
      eventPayload = { message: action.message, requested_by: userId };
      eventBody = action.message;
      auditAction = SESSION_LIVE_REDIRECT;
    } else {
      // resolve_approval: the approval id must reference an unresolved
      // run.live.approval.requested event in THIS session's ledger — the
      // server never lets a resolver invent approvals the run didn't ask for.
      const approval = await findUnresolvedApproval(sql, id, watcher.session.org_id, action.approval_id);
      if (!approval) {
        await appendSessionEvent(watcherActorContext(watcher), {
          session_id: id,
          event_type: "run.live.denied" as BrainSessionEventType,
          payload: { action: action.action, reason: "invalid_approval", approval_id: action.approval_id, user_id: userId },
        });
        await logTelemetryEvent({
          actor: { type: "user", auth: telemetryAuth },
          req,
          action: RUN_ROOM_CONTROL,
          resourceType: "brain_session",
          resourceId: id,
          sessionId: id,
          outcome: "denied",
          metadata: { action: action.action, reason: "invalid_approval", approval_id: action.approval_id },
        });
        return Response.json({ error: "invalid_approval" }, { status: 400 });
      }
      directiveType = "resolve_approval";
      directivePayload = {
        approval_id: action.approval_id,
        decision: action.decision,
        resolved_by: resolver,
      };
      eventKind = "run.live.approval.resolved" as BrainSessionEventType;
      eventPayload = {
        approval_id: action.approval_id,
        decision: action.decision,
        resolved_by: resolver,
        requested_event_id: approval.id,
      };
      auditAction = SESSION_LIVE_APPROVAL;
    }

    const directive = await createDirective(sql, {
      sessionId: id,
      orgId: watcher.session.org_id,
      type: directiveType,
      payload: directivePayload,
      createdBy: userId,
    });

    const ledgerEvent = await appendSessionEvent(watcherActorContext(watcher), {
      session_id: id,
      event_type: eventKind,
      body_md: eventBody,
      payload: { ...eventPayload, directive_id: directive.id },
    });

    await logLiveOrgAudit(sql, req, {
      orgId: watcher.session.org_id,
      actorUser: { id: userId, email: watcher.userSession.user.email },
      action: auditAction,
      resourceType: "brain_session",
      resourceId: id,
      metadata: { action: action.action, directive_id: directive.id },
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
      metadata: { action: action.action, directive_id: directive.id },
    });

    return Response.json({ directive_id: directive.id }, { status: 202 });
  } catch (err) {
    return routeError("live control action failed", err);
  }
}
