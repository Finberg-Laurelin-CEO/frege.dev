"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "../run-rooms.module.css";

/* ── Types ── */

type Member = { id: string; name: string; email: string };

type LiveEvent = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  bodyMd: string;
  actorUserId: string | null;
  createdAt: string | null;
};

type FeedItem =
  | { type: "agent"; key: string; text: string; at: string | null }
  | {
      type: "command";
      key: string;
      command: string;
      cwd: string | null;
      running: boolean;
      exitCode: number | null;
      durationMs: number | null;
      output: string | null;
      at: string | null;
    }
  | { type: "file"; key: string; label: string; at: string | null }
  | {
      type: "approval";
      key: string;
      approvalId: string;
      summary: string;
      status: "pending" | "approved" | "denied";
      resolvedBy: string | null;
      at: string | null;
    }
  | { type: "system"; key: string; flavor: "lease" | "interrupt" | "redirect" | "lifecycle" | "denied" | "other"; text: string; at: string | null };

type ConnState = "connecting" | "live" | "reconnecting";

/* ── Payload helpers (tolerant of bridge naming variants) ── */

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function firstString(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = payload[key];
    if (typeof v === "string" && v.length > 0) return v;
    if (Array.isArray(v) && v.every((x) => typeof x === "string") && v.length > 0) return (v as string[]).join(" ");
  }
  return null;
}

function firstNumber(payload: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const v = payload[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function itemKeyOf(ev: LiveEvent): string {
  return firstString(ev.payload, ["item_id", "itemId", "id"]) ?? ev.id;
}

function approvalIdOf(ev: LiveEvent): string {
  return firstString(ev.payload, ["approval_id", "approvalId", "item_id", "itemId", "id"]) ?? ev.id;
}

function fileLabelOf(payload: Record<string, unknown>): string {
  const single = firstString(payload, ["path", "file", "filename"]);
  if (single) return single;
  const files = payload.files ?? payload.changes ?? payload.paths;
  if (Array.isArray(files) && files.length > 0) {
    const names = files
      .map((f) => (typeof f === "string" ? f : firstString(asRecord(f), ["path", "file", "filename"])))
      .filter((f): f is string => Boolean(f));
    if (names.length > 0) return names.join(", ");
  }
  return "file change";
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour12: false });
}

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

/* ── Event → room state derivation ── */

type RoomView = {
  items: FeedItem[];
  controllerId: string | null;
  controllerFromEvents: boolean;
  liveStatus: string;
  liveStatusFromEvents: boolean;
  bridgeDown: boolean;
  pendingApprovals: { approvalId: string; summary: string }[];
};

const BRIDGE_LIVENESS_KINDS = new Set([
  "run.live.started",
  "run.live.agent_message",
  "run.live.command.started",
  "run.live.command.finished",
  "run.live.file_change",
  "run.live.approval.requested",
]);

function leaseTargetOf(ev: LiveEvent): string | null {
  return firstString(ev.payload, ["to_user_id", "toUserId", "user_id", "userId", "controller_user_id"]) ?? ev.actorUserId;
}

function deriveRoom(events: LiveEvent[], nameOf: (id: string | null) => string): RoomView {
  const items: FeedItem[] = [];
  const index = new Map<string, number>(); // coalescing key → items index
  const approvalIndex = new Map<string, number>();

  let controllerId: string | null = null;
  let controllerFromEvents = false;
  let liveStatus = "";
  let liveStatusFromEvents = false;
  let bridgeDown = false;

  const push = (item: FeedItem) => {
    items.push(item);
    return items.length - 1;
  };

  for (const ev of events) {
    if (BRIDGE_LIVENESS_KINDS.has(ev.kind)) bridgeDown = false;

    switch (ev.kind) {
      case "run.live.started": {
        liveStatus = "live";
        liveStatusFromEvents = true;
        push({ type: "system", key: ev.id, flavor: "lifecycle", text: "Run is live — bridge connected.", at: ev.createdAt });
        break;
      }
      case "run.live.agent_message": {
        const key = `agent:${itemKeyOf(ev)}`;
        const full = firstString(ev.payload, ["text", "message"]) ?? (ev.bodyMd || null);
        const delta = firstString(ev.payload, ["delta"]);
        const existing = index.get(key);
        if (existing !== undefined && items[existing].type === "agent") {
          const item = items[existing] as Extract<FeedItem, { type: "agent" }>;
          items[existing] = { ...item, text: full ?? item.text + (delta ?? "") };
        } else {
          index.set(key, push({ type: "agent", key, text: full ?? delta ?? "", at: ev.createdAt }));
        }
        break;
      }
      case "run.live.command.started": {
        const key = `cmd:${itemKeyOf(ev)}`;
        index.set(
          key,
          push({
            type: "command",
            key,
            command: firstString(ev.payload, ["command", "cmd"]) ?? "(command)",
            cwd: firstString(ev.payload, ["cwd"]),
            running: true,
            exitCode: null,
            durationMs: null,
            output: null,
            at: ev.createdAt,
          }),
        );
        break;
      }
      case "run.live.command.finished": {
        const key = `cmd:${itemKeyOf(ev)}`;
        const exitCode = firstNumber(ev.payload, ["exit_code", "exitCode"]);
        const durationMs = firstNumber(ev.payload, ["duration_ms", "durationMs"]);
        const output = firstString(ev.payload, ["aggregated_output", "aggregatedOutput", "output"]);
        const existing = index.get(key);
        if (existing !== undefined && items[existing].type === "command") {
          const item = items[existing] as Extract<FeedItem, { type: "command" }>;
          items[existing] = { ...item, running: false, exitCode, durationMs, output: output ?? item.output };
        } else {
          // Finished event whose started counterpart predates the replay cursor.
          push({
            type: "command",
            key: `${key}:finished:${ev.id}`,
            command: firstString(ev.payload, ["command", "cmd"]) ?? "(command)",
            cwd: firstString(ev.payload, ["cwd"]),
            running: false,
            exitCode,
            durationMs,
            output,
            at: ev.createdAt,
          });
        }
        break;
      }
      case "run.live.file_change": {
        push({ type: "file", key: ev.id, label: fileLabelOf(ev.payload), at: ev.createdAt });
        break;
      }
      case "run.live.approval.requested": {
        const approvalId = approvalIdOf(ev);
        const summary =
          firstString(ev.payload, ["command", "cmd", "path", "file", "reason", "summary"]) ?? "approval requested by the run";
        approvalIndex.set(
          approvalId,
          push({ type: "approval", key: ev.id, approvalId, summary, status: "pending", resolvedBy: null, at: ev.createdAt }),
        );
        break;
      }
      case "run.live.approval.resolved": {
        const approvalId = approvalIdOf(ev);
        const decision = firstString(ev.payload, ["decision"]);
        const status: "approved" | "denied" = decision === "deny" || decision === "denied" || decision === "decline" ? "denied" : "approved";
        const existing = approvalIndex.get(approvalId);
        if (existing !== undefined && items[existing].type === "approval") {
          const item = items[existing] as Extract<FeedItem, { type: "approval" }>;
          items[existing] = { ...item, status, resolvedBy: nameOf(ev.actorUserId) };
        } else {
          push({
            type: "system",
            key: ev.id,
            flavor: "other",
            text: `Approval ${shortId(approvalId)} ${status} by ${nameOf(ev.actorUserId)}.`,
            at: ev.createdAt,
          });
        }
        break;
      }
      case "run.live.interrupted": {
        push({ type: "system", key: ev.id, flavor: "interrupt", text: `Run stopped by ${nameOf(ev.actorUserId)}.`, at: ev.createdAt });
        break;
      }
      case "run.live.redirected": {
        const message = firstString(ev.payload, ["message"]);
        push({
          type: "system",
          key: ev.id,
          flavor: "redirect",
          text: `${nameOf(ev.actorUserId)} redirected the run${message ? `: “${message}”` : "."}`,
          at: ev.createdAt,
        });
        break;
      }
      case "run.live.lease.claimed": {
        controllerId = leaseTargetOf(ev);
        controllerFromEvents = true;
        push({ type: "system", key: ev.id, flavor: "lease", text: `${nameOf(controllerId)} took control.`, at: ev.createdAt });
        break;
      }
      case "run.live.lease.handed_off": {
        controllerId = firstString(ev.payload, ["to_user_id", "toUserId"]) ?? leaseTargetOf(ev);
        controllerFromEvents = true;
        push({
          type: "system",
          key: ev.id,
          flavor: "lease",
          text: `${nameOf(ev.actorUserId)} handed control to ${nameOf(controllerId)}.`,
          at: ev.createdAt,
        });
        break;
      }
      case "run.live.lease.released": {
        controllerId = null;
        controllerFromEvents = true;
        push({ type: "system", key: ev.id, flavor: "lease", text: `${nameOf(ev.actorUserId)} released control.`, at: ev.createdAt });
        break;
      }
      case "run.live.bridge.disconnected": {
        bridgeDown = true;
        push({ type: "system", key: ev.id, flavor: "lifecycle", text: "Bridge disconnected — the host stopped reporting.", at: ev.createdAt });
        break;
      }
      case "run.live.ended": {
        liveStatus = "ended";
        liveStatusFromEvents = true;
        push({ type: "system", key: ev.id, flavor: "lifecycle", text: "Run ended.", at: ev.createdAt });
        break;
      }
      case "run.live.denied": {
        push({ type: "system", key: ev.id, flavor: "denied", text: "A control action was denied.", at: ev.createdAt });
        break;
      }
      default: {
        const snippet = ev.bodyMd || firstString(ev.payload, ["text", "message", "summary"]) || "";
        push({
          type: "system",
          key: ev.id,
          flavor: "other",
          text: snippet ? `${ev.kind}: ${snippet.slice(0, 300)}` : ev.kind,
          at: ev.createdAt,
        });
      }
    }
  }

  const pendingApprovals = items
    .filter((i): i is Extract<FeedItem, { type: "approval" }> => i.type === "approval" && i.status === "pending")
    .map((i) => ({ approvalId: i.approvalId, summary: i.summary }));

  return { items, controllerId, controllerFromEvents, liveStatus, liveStatusFromEvents, bridgeDown, pendingApprovals };
}

/* ── Component ── */

export default function RunRoom({
  sessionId,
  viewerId,
  orgName,
  initialTitle,
  initialClient,
  initialLiveStatus,
  initialControllerId,
  members,
}: {
  sessionId: string;
  viewerId: string;
  orgName: string;
  initialTitle: string;
  initialClient: string;
  initialLiveStatus: string;
  initialControllerId: string | null;
  members: Member[];
}) {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [conn, setConn] = useState<ConnState>("connecting");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingStop, setConfirmingStop] = useState(false);
  const [redirectText, setRedirectText] = useState("");
  const [handoffTarget, setHandoffTarget] = useState("");
  // Optimistic lease state after a 2xx lease call, cleared once the stream
  // replays the authoritative run.live.lease.* event.
  const [leaseOverride, setLeaseOverride] = useState<{ controllerId: string | null; afterCount: number } | null>(null);

  const lastIdRef = useRef<string | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const feedRef = useRef<HTMLDivElement | null>(null);
  const hoverRef = useRef(false);
  const noticeTimerRef = useRef<number | undefined>(undefined);

  const memberName = useMemo(() => {
    const map = new Map(members.map((m) => [m.id, m.name]));
    return (id: string | null): string => {
      if (!id) return "someone";
      if (id === viewerId) return "you";
      return map.get(id) ?? `member ${shortId(id)}`;
    };
  }, [members, viewerId]);

  /* ── SSE lifecycle ── */
  useEffect(() => {
    let closed = false;
    let es: EventSource | null = null;
    let retryTimer: number | undefined;
    let attempts = 0;

    const connect = () => {
      const cursor = lastIdRef.current;
      const url = cursor
        ? `/api/v1/sessions/${sessionId}/live/stream?after=${encodeURIComponent(cursor)}`
        : `/api/v1/sessions/${sessionId}/live/stream`;
      es = new EventSource(url);

      es.onopen = () => {
        attempts = 0;
        setConn("live");
      };

      es.onmessage = (msg: MessageEvent<string>) => {
        if (msg.lastEventId) lastIdRef.current = msg.lastEventId;
        let data: unknown;
        try {
          data = JSON.parse(msg.data);
        } catch {
          return; // heartbeats / non-JSON frames
        }
        const record = asRecord(data);
        const kind = firstString(record, ["event_type", "kind", "type"]);
        if (!kind) return;
        const id = firstString(record, ["id"]) ?? msg.lastEventId ?? `local-${seenRef.current.size}`;
        if (seenRef.current.has(id)) return;
        seenRef.current.add(id);
        const ev: LiveEvent = {
          id,
          kind,
          payload: asRecord(record.payload),
          bodyMd: firstString(record, ["body_md"]) ?? "",
          actorUserId: firstString(record, ["actor_user_id", "actorUserId"]),
          createdAt: firstString(record, ["created_at", "occurred_at", "createdAt"]),
        };
        setEvents((prev) => [...prev, ev]);
      };

      es.onerror = () => {
        if (closed || !es) return;
        setConn("reconnecting");
        if (es.readyState === EventSource.CLOSED) {
          // The browser gave up (e.g. non-200 response). Back off and rebuild
          // the connection ourselves, resuming from the last seen ledger id.
          es.close();
          attempts += 1;
          const delay = Math.min(15000, 1000 * 2 ** Math.min(attempts, 4));
          retryTimer = window.setTimeout(connect, delay);
        }
        // readyState CONNECTING: the browser is auto-reconnecting and will
        // send Last-Event-ID itself; nothing to do.
      };
    };

    connect();
    return () => {
      closed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      es?.close();
    };
  }, [sessionId]);

  /* ── Derived room state ── */
  const view = useMemo(() => deriveRoom(events, memberName), [events, memberName]);

  const leaseEventCount = useMemo(
    () => events.filter((e) => e.kind.startsWith("run.live.lease.")).length,
    [events],
  );

  let controllerId = view.controllerFromEvents ? view.controllerId : initialControllerId;
  if (leaseOverride && leaseEventCount <= leaseOverride.afterCount) controllerId = leaseOverride.controllerId;
  const isController = controllerId === viewerId;

  const liveStatus = view.liveStatusFromEvents ? view.liveStatus : initialLiveStatus;

  /* ── Auto-scroll with pause-on-hover ── */
  useEffect(() => {
    const el = feedRef.current;
    if (el && !hoverRef.current) el.scrollTop = el.scrollHeight;
  }, [view.items.length]);

  /* ── Actions ── */
  function showNotice(text: string) {
    setNotice(text);
    if (noticeTimerRef.current !== undefined) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 6000);
  }

  async function postAction(path: "lease" | "control", body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/live/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) return true;
      let error = "";
      try {
        error = String(((await res.json()) as { error?: string }).error ?? "");
      } catch {
        /* non-JSON error body */
      }
      if (res.status === 409 && error === "lease_held") showNotice("Someone else holds control.");
      else if (res.status === 409) showNotice("You no longer hold control.");
      else if (res.status === 400 && path === "control") showNotice("That approval is no longer pending.");
      else if (res.status === 404) showNotice("This run room is not available.");
      else showNotice(`Action failed (${res.status}).`);
      return false;
    } catch {
      showNotice("Network error — action not sent.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function claim() {
    if (await postAction("lease", { action: "claim" })) {
      setLeaseOverride({ controllerId: viewerId, afterCount: leaseEventCount });
    }
  }

  async function release() {
    if (await postAction("lease", { action: "release" })) {
      setLeaseOverride({ controllerId: null, afterCount: leaseEventCount });
    }
  }

  async function handoff() {
    if (!handoffTarget) return;
    if (await postAction("lease", { action: "handoff", to_user_id: handoffTarget })) {
      setLeaseOverride({ controllerId: handoffTarget, afterCount: leaseEventCount });
      setHandoffTarget("");
    }
  }

  async function stopRun() {
    setConfirmingStop(false);
    await postAction("control", { action: "stop" });
  }

  async function redirect() {
    const message = redirectText.trim();
    if (!message) return;
    if (await postAction("control", { action: "redirect", message })) setRedirectText("");
  }

  async function resolveApproval(approvalId: string, decision: "approve" | "deny") {
    await postAction("control", { action: "resolve_approval", approval_id: approvalId, decision });
  }

  /* ── Render ── */
  const statusChipClass =
    liveStatus === "live" ? `${styles.statusChip} ${styles.statusLive}` : liveStatus === "ended" ? `${styles.statusChip} ${styles.statusEnded}` : styles.statusChip;
  const statusLabel = liveStatus === "live" ? "live" : liveStatus === "ended" ? "ended" : "not live yet";

  const otherMembers = members.filter((m) => m.id !== viewerId);

  return (
    <main id="main" className={styles.room}>
      <header className={styles.topbar}>
        <div className={styles.titleBlock}>
          <div className={styles.eyebrow}>
            <span className={styles.eyebrowSlash}>// </span>run room
          </div>
          <h1>{initialTitle}</h1>
          <p className={styles.titleMeta}>
            {initialClient} · {orgName} · session {shortId(sessionId)}
          </p>
        </div>
        <a className={styles.backLink} href="/console">
          ← console
        </a>
      </header>

      <div className={styles.controlStrip}>
        <div className={styles.presence}>
          <span className={statusChipClass}>
            <span className={styles.statusDot} aria-hidden="true">
              ●
            </span>
            {statusLabel}
          </span>
          <span className={styles.controllerLabel}>
            controller:{" "}
            <strong>{controllerId ? (controllerId === viewerId ? "you" : memberName(controllerId)) : "no controller"}</strong>
          </span>
          {notice ? <span className={styles.notice}>{notice}</span> : null}
        </div>
        <div className={styles.leaseButtons}>
          {isController ? (
            <>
              {otherMembers.length > 0 ? (
                <>
                  <select
                    className={styles.select}
                    value={handoffTarget}
                    onChange={(e) => setHandoffTarget(e.target.value)}
                    aria-label="Hand off control to"
                  >
                    <option value="">hand off to…</option>
                    {otherMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <button type="button" className={styles.btn} disabled={busy || !handoffTarget} onClick={handoff}>
                    Hand off
                  </button>
                </>
              ) : null}
              <button type="button" className={styles.btn} disabled={busy} onClick={release}>
                Release control
              </button>
            </>
          ) : (
            <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy} onClick={claim}>
              Take control
            </button>
          )}
        </div>
      </div>

      {conn === "reconnecting" ? <div className={`${styles.banner} ${styles.bannerWarn}`}>reconnecting… live stream interrupted; the feed will resume where it left off.</div> : null}
      {conn === "connecting" ? <div className={`${styles.banner} ${styles.bannerInfo}`}>connecting to live stream…</div> : null}
      {view.bridgeDown ? (
        <div className={`${styles.banner} ${styles.bannerBad}`}>bridge disconnected — the machine running this session has stopped reporting. Control actions may not be delivered.</div>
      ) : null}
      {liveStatus === "ended" ? <div className={`${styles.banner} ${styles.bannerInfo}`}>This run has ended. The feed below is the recorded session history.</div> : null}

      <div
        ref={feedRef}
        className={`${styles.feed} frgscroll`}
        onMouseEnter={() => {
          hoverRef.current = true;
        }}
        onMouseLeave={() => {
          hoverRef.current = false;
          const el = feedRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        }}
      >
        <div className={styles.feedInner}>
          {view.items.length === 0 ? (
            <p className={styles.feedEmpty}>
              {conn === "live" ? "No live events yet. Start the bridge with `frege run codex` to see this run here." : "Waiting for the live stream…"}
            </p>
          ) : (
            view.items.map((item) => <FeedRow key={item.key} item={item} isController={isController} busy={busy} onResolve={resolveApproval} />)
          )}
        </div>
      </div>

      {isController ? (
        <div className={styles.actionBar}>
          <div className={styles.actionBarInner}>
            {confirmingStop ? (
              <div className={styles.confirmStrip}>
                <span>Stop this run for everyone? The agent will be interrupted on its host.</span>
                <button type="button" className={`${styles.btn} ${styles.btnDanger}`} disabled={busy} onClick={stopRun}>
                  Stop run
                </button>
                <button type="button" className={styles.btn} disabled={busy} onClick={() => setConfirmingStop(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className={styles.actionRow}>
                <span className={styles.actionLabel}>controller</span>
                <button type="button" className={`${styles.btn} ${styles.btnDanger}`} disabled={busy} onClick={() => setConfirmingStop(true)}>
                  Stop
                </button>
                <input
                  className={styles.redirectInput}
                  value={redirectText}
                  maxLength={10000}
                  placeholder="Redirect the run — message lands in the same thread"
                  onChange={(e) => setRedirectText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") redirect();
                  }}
                />
                <button type="button" className={styles.btn} disabled={busy || redirectText.trim().length === 0} onClick={redirect}>
                  Redirect
                </button>
              </div>
            )}
            <div className={styles.actionRow}>
              <span className={styles.experimentalTag}>approvals · last-built surface</span>
              <span className={styles.titleMeta} style={{ margin: 0 }}>
                {view.pendingApprovals.length === 0
                  ? "No pending approvals. Approve/Deny appears on approval requests in the feed."
                  : `${view.pendingApprovals.length} pending approval${view.pendingApprovals.length === 1 ? "" : "s"} in the feed above.`}
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

/* ── Feed row renderer ── */

function FeedRow({
  item,
  isController,
  busy,
  onResolve,
}: {
  item: FeedItem;
  isController: boolean;
  busy: boolean;
  onResolve: (approvalId: string, decision: "approve" | "deny") => void;
}) {
  const time = formatTime(item.at);

  if (item.type === "agent") {
    return (
      <article className={`${styles.event} ${styles.eventAgent}`}>
        <div className={styles.eventHead}>
          <span className={styles.eventKind}>agent</span>
          {time ? <span className={styles.eventTime}>{time}</span> : null}
        </div>
        <p className={styles.eventBody}>{item.text || "…"}</p>
      </article>
    );
  }

  if (item.type === "command") {
    return (
      <article className={`${styles.event} ${styles.eventCommand}`}>
        <div className={styles.eventHead}>
          <span className={styles.eventKind}>command</span>
          {time ? <span className={styles.eventTime}>{time}</span> : null}
        </div>
        <p className={styles.commandLine}>
          <span className={styles.commandSigil}>$ </span>
          {item.command}
        </p>
        <p className={styles.commandMeta}>
          {item.cwd ? <>in {item.cwd} · </> : null}
          {item.running ? (
            <span className={styles.commandRunning}>running…</span>
          ) : (
            <span className={item.exitCode === 0 || item.exitCode === null ? undefined : styles.commandFailed}>
              finished{item.exitCode !== null ? ` · exit ${item.exitCode}` : ""}
              {item.durationMs !== null ? ` · ${(item.durationMs / 1000).toFixed(1)}s` : ""}
            </span>
          )}
        </p>
        {item.output ? (
          <details className={styles.commandOutput}>
            <summary>output</summary>
            <pre>{item.output}</pre>
          </details>
        ) : null}
      </article>
    );
  }

  if (item.type === "file") {
    return (
      <article className={`${styles.event} ${styles.eventFile}`}>
        <div className={styles.eventHead}>
          <span className={styles.eventKind}>file change</span>
          {time ? <span className={styles.eventTime}>{time}</span> : null}
        </div>
        <p className={styles.eventBody}>{item.label}</p>
      </article>
    );
  }

  if (item.type === "approval") {
    const pending = item.status === "pending";
    return (
      <article className={`${styles.event} ${pending ? styles.eventApproval : styles.eventApprovalResolved}`}>
        <div className={styles.eventHead}>
          <span className={styles.eventKind}>approval {pending ? "requested" : item.status}</span>
          {time ? <span className={styles.eventTime}>{time}</span> : null}
        </div>
        <p className={styles.eventBody}>{item.summary}</p>
        {pending ? (
          isController ? (
            <div className={styles.approvalActions}>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy} onClick={() => onResolve(item.approvalId, "approve")}>
                Approve
              </button>
              <button type="button" className={`${styles.btn} ${styles.btnDanger}`} disabled={busy} onClick={() => onResolve(item.approvalId, "deny")}>
                Deny
              </button>
              <span className={styles.approvalTag}>resolves on the run’s host</span>
            </div>
          ) : (
            <div className={styles.approvalActions}>
              <span className={styles.approvalTag}>waiting on the controller</span>
            </div>
          )
        ) : item.resolvedBy ? (
          <div className={styles.approvalActions}>
            <span className={styles.approvalTag}>
              {item.status} by {item.resolvedBy}
            </span>
          </div>
        ) : null}
      </article>
    );
  }

  const flavorClass =
    item.flavor === "interrupt" ? styles.eventInterrupt : item.flavor === "denied" ? styles.eventDenied : undefined;
  return (
    <article className={`${styles.eventSystem} ${flavorClass ?? ""}`}>
      <p className={styles.eventBody}>
        {item.text}
        {time ? <span className={styles.eventTime}> · {time}</span> : null}
      </p>
    </article>
  );
}
