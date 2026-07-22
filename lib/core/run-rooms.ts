import { z } from "zod";
import type { getSql } from "@/lib/db";

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
export const RUN_ROOM_CONTROL = "run_room.control";
export const SESSION_LIVE_STOP = "session.live.stop";
export const SESSION_LIVE_REDIRECT = "session.live.redirect";
export const SESSION_LIVE_APPROVAL = "session.live.approval";
export const SESSION_LIVE_HANDOFF = "session.live.handoff";
export const SESSION_LIVE_LEASE = "session.live.lease";

export async function claimLease(sql: RunRoomsSql, sessionId: string, userId: string): Promise<LiveLease | null> {
  void sql;
  void sessionId;
  void userId;
  throw new Error("run_rooms_not_implemented");
}

export async function handoffLease(
  sql: RunRoomsSql,
  sessionId: string,
  fromUserId: string,
  toUserId: string,
): Promise<LiveLease | null> {
  void sql;
  void sessionId;
  void fromUserId;
  void toUserId;
  throw new Error("run_rooms_not_implemented");
}

export async function releaseLease(sql: RunRoomsSql, sessionId: string, userId: string): Promise<LiveLease | null> {
  void sql;
  void sessionId;
  void userId;
  throw new Error("run_rooms_not_implemented");
}

export async function createDirective(sql: RunRoomsSql, input: CreateDirectiveInput): Promise<LiveDirective> {
  void sql;
  void input;
  throw new Error("run_rooms_not_implemented");
}

export async function takeUndeliveredDirectives(
  sql: RunRoomsSql,
  sessionId: string,
  orgId: string,
): Promise<LiveDirective[]> {
  void sql;
  void sessionId;
  void orgId;
  throw new Error("run_rooms_not_implemented");
}

export async function ackDirective(
  sql: RunRoomsSql,
  directiveId: string,
  sessionId: string,
  orgId: string,
  result: Record<string, unknown>,
): Promise<LiveDirective | null> {
  void sql;
  void directiveId;
  void sessionId;
  void orgId;
  void result;
  throw new Error("run_rooms_not_implemented");
}
