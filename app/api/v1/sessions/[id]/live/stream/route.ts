import { randomUUID } from "node:crypto";
import { orgContextFromMembership } from "@/lib/core/org-guard";
import {
  LIVE_RUN_ROOMS_ENABLED,
  RUN_ROOM_WATCH_OPENED,
  bridgeIsStale,
  getLiveSessionRow,
  hasUndeliveredDirectives,
  listLiveEventsAfter,
  liveRunRoomsNotFound,
  resolveEventCursor,
  resolveWatcher,
  type LiveLedgerEvent,
} from "@/lib/core/run-rooms";
import { logTelemetryEvent } from "@/lib/core/telemetry";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const HEARTBEAT_MS = 15_000;

function pollIntervalMs(): number {
  const configured = Number(process.env.FREGE_LIVE_POLL_MS ?? 1000);
  return Number.isFinite(configured) && configured > 0 ? configured : 1000;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

// Default SSE messages only (no custom `event:` field): the watcher UI consumes
// EventSource.onmessage, and named events would never reach it. The kind lives
// in data.event_type; the ledger id doubles as the SSE id for reconnect.
function sseEvent(event: LiveLedgerEvent): string {
  const data = JSON.stringify({
    id: event.id,
    session_id: event.session_id,
    event_type: event.event_type,
    actor_type: event.actor_type,
    actor_user_id: event.actor_user_id,
    body_md: event.body_md,
    payload: event.payload,
    created_at: event.created_at,
  });
  return `id: ${event.id}\ndata: ${data}\n\n`;
}

// Watcher live view. Replays the ledger from the reconnect cursor
// (Last-Event-ID header or ?after=), then tails on a ~1s poll. The ledger
// event id doubles as the SSE id, so reconnects are gapless by construction.
export async function GET(req: Request, context: RouteContext) {
  if (!LIVE_RUN_ROOMS_ENABLED()) return liveRunRoomsNotFound();

  const { id } = await context.params;
  const resolution = await resolveWatcher(req, id);
  if (!resolution.ok) return resolution.response;
  const { watcher } = resolution;

  const sql = getSql();
  const cursorId = req.headers.get("last-event-id") ?? new URL(req.url).searchParams.get("after");
  const cursor = cursorId ? await resolveEventCursor(sql, id, watcher.session.org_id, cursorId) : null;

  await logTelemetryEvent({
    actor: { type: "user", auth: orgContextFromMembership(watcher.userSession, watcher.membership) },
    req,
    action: RUN_ROOM_WATCH_OPENED,
    resourceType: "brain_session",
    resourceId: id,
    sessionId: id,
    outcome: "success",
    metadata: { resumed_from: cursor?.id ?? null },
  });

  const pollMs = pollIntervalMs();
  const encoder = new TextEncoder();
  const signal = req.signal;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed || signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      let after = cursor;
      let lastWriteAt = Date.now();
      let bridgeDownAnnounced = false;

      write("retry: 3000\n\n");

      try {
        while (!closed && !signal.aborted) {
          const events = await listLiveEventsAfter(sql, {
            sessionId: id,
            orgId: watcher.session.org_id,
            zones: watcher.zones,
            after,
          });
          for (const event of events) {
            write(sseEvent(event));
            after = { createdAt: event.created_at, id: event.id };
            lastWriteAt = Date.now();
          }

          // Truth-telling: a stale bridge with directives it never picked up
          // means nobody is listening on the other end. Announce once per
          // outage, synthetically (not written to the ledger).
          const sessionRow = await getLiveSessionRow(sql, id);
          if (sessionRow && sessionRow.live_status === "live") {
            const stale = bridgeIsStale(sessionRow) && (await hasUndeliveredDirectives(sql, id, sessionRow.org_id));
            if (stale && !bridgeDownAnnounced) {
              // Default message with a unique non-ledger data.id so the UI
              // renders it without deduping, but NO SSE id: Last-Event-ID must
              // stay a real ledger cursor.
              write(
                `data: ${JSON.stringify({
                  id: `bridge-disconnected-${randomUUID()}`,
                  session_id: id,
                  event_type: "run.live.bridge.disconnected",
                  payload: { bridge_last_seen_at: sessionRow.bridge_last_seen_at },
                })}\n\n`,
              );
              bridgeDownAnnounced = true;
              lastWriteAt = Date.now();
            } else if (!stale) {
              bridgeDownAnnounced = false;
            }
          }

          if (Date.now() - lastWriteAt >= HEARTBEAT_MS) {
            write(": hb\n\n");
            lastWriteAt = Date.now();
          }

          await sleep(pollMs, signal);
        }
      } catch (err) {
        console.error("live stream poll failed", { message: (err as Error)?.message });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed by the runtime on abort
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
