#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Live Run Rooms server tests (WT-A). Same registerHooks trick as
// test-brain-proposals.mjs: resolve the "@/" alias for Node, stub "@/lib/db"
// with globalThis.__fakeSql, and additionally stub the auth entrypoints
// ("@/lib/core/session", "@/lib/core/actor-auth") and telemetry so route
// handlers are testable end-to-end without a DB or a browser session.
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const VIRTUAL = {
  "@/lib/db": "export function getSql(){ return globalThis.__fakeSql; }",
  "@/lib/core/session": `
    export async function authenticateUserRequest(){ return globalThis.__fakeUserSession ?? null; }
    export function userUnauthorized(){ return Response.json({ error: "unauthorized" }, { status: 401 }); }
    export function readSessionToken(){ return null; }
  `,
  "@/lib/core/actor-auth": `
    export async function authenticateFregeActor(){
      return globalThis.__fakeActorResult ?? { ok: false, response: Response.json({ error: "unauthorized" }, { status: 401 }) };
    }
    export function telemetryActorForFregeActor(actor){
      return actor.actorType === "api_key" ? { type: "api_key", auth: actor.apiKeyAuth } : { type: "user", auth: actor.userAuth };
    }
  `,
  "@/lib/core/telemetry": `
    export async function logTelemetryEvent(input){ (globalThis.__telemetryLog ??= []).push(input); }
  `,
};

function resolveRealAlias(specifier) {
  const base = path.join(rootDir, specifier.slice(2));
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return `${base}.ts`;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier in VIRTUAL) return { url: `virtual:${specifier}`, shortCircuit: true };
    if (specifier.startsWith("@/")) return { url: pathToFileURL(resolveRealAlias(specifier)).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("virtual:")) {
      return { format: "module", source: VIRTUAL[url.slice("virtual:".length)], shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const runRooms = await import(pathToFileURL(path.join(rootDir, "lib/core/run-rooms.ts")).href);
const routeModule = (relative) => import(pathToFileURL(path.join(rootDir, relative)).href);
const eventsRoute = await routeModule("app/api/v1/sessions/[id]/live/events/route.ts");
const streamRoute = await routeModule("app/api/v1/sessions/[id]/live/stream/route.ts");
const leaseRoute = await routeModule("app/api/v1/sessions/[id]/live/lease/route.ts");
const controlRoute = await routeModule("app/api/v1/sessions/[id]/live/control/route.ts");
const directivesRoute = await routeModule("app/api/v1/sessions/[id]/live/directives/route.ts");
const ackRoute = await routeModule("app/api/v1/sessions/[id]/live/directives/[directiveId]/ack/route.ts");

const FIXED_NOW = "2026-07-22T12:00:00.000Z";

function normalize(strings) {
  return strings.join(" ? ").toLowerCase().replace(/\s+/g, " ").trim();
}

// --- in-memory stand-in for the run-rooms SQL surface -----------------------

function makeStore({ sessions = [], events = [], directives = [], memberships = [] } = {}) {
  let seq = events.length;
  const store = {
    sessions: new Map(sessions.map((row) => [row.id, row])),
    events: [...events],
    directives: new Map(directives.map((row) => [row.id, row])),
    audits: [],
    memberships,
    nextEventAt() {
      seq += 1;
      return new Date(Date.parse(FIXED_NOW) + seq * 1000).toISOString();
    },
    nextId(prefix) {
      seq += 1;
      return `${prefix}-${seq}`;
    },
  };
  return store;
}

function leaseRow(session) {
  return {
    id: session.id,
    org_id: session.org_id,
    controller_user_id: session.controller_user_id,
    lease_acquired_at: session.lease_acquired_at,
  };
}

function makeSql(store) {
  function run(strings, values) {
    const text = normalize(strings);

    // run-rooms.getLiveSessionRow
    if (text.startsWith("select id, org_id, status, trust_zone, live_status")) {
      const [id] = values;
      const session = store.sessions.get(id);
      return session ? [{ ...session }] : [];
    }

    // run-rooms.claimLease (CAS on controller_user_id IS NULL)
    if (
      text.startsWith("update brain_sessions set controller_user_id = ? , lease_acquired_at = now()") &&
      text.includes("controller_user_id is null")
    ) {
      const [userId, id] = values;
      const session = store.sessions.get(id);
      if (!session || session.controller_user_id !== null) return [];
      session.controller_user_id = userId;
      session.lease_acquired_at = FIXED_NOW;
      return [leaseRow(session)];
    }

    // run-rooms.handoffLease (CAS on controller_user_id = from)
    if (
      text.startsWith("update brain_sessions set controller_user_id = ? , lease_acquired_at = now()") &&
      text.includes("and controller_user_id = ?")
    ) {
      const [toUserId, id, fromUserId] = values;
      const session = store.sessions.get(id);
      if (!session || session.controller_user_id !== fromUserId) return [];
      session.controller_user_id = toUserId;
      session.lease_acquired_at = FIXED_NOW;
      return [leaseRow(session)];
    }

    // run-rooms.releaseLease
    if (text.startsWith("update brain_sessions set controller_user_id = null")) {
      const [id, userId] = values;
      const session = store.sessions.get(id);
      if (!session || session.controller_user_id !== userId) return [];
      session.controller_user_id = null;
      session.lease_acquired_at = null;
      return [leaseRow(session)];
    }

    // run-rooms.markBridgeSeen (with live_status)
    if (text.startsWith("update brain_sessions set bridge_last_seen_at = now(), live_status = ?")) {
      const [liveStatus, id, orgId] = values;
      const session = store.sessions.get(id);
      if (session && session.org_id === orgId) {
        session.bridge_last_seen_at = new Date().toISOString();
        session.live_status = liveStatus;
      }
      return [];
    }

    // run-rooms.markBridgeSeen (poll bump)
    if (text.startsWith("update brain_sessions set bridge_last_seen_at = now() where")) {
      const [id, orgId] = values;
      const session = store.sessions.get(id);
      if (session && session.org_id === orgId) session.bridge_last_seen_at = new Date().toISOString();
      return [];
    }

    // brain.appendSessionEvent: session ownership lookup
    if (text.startsWith("select id, trust_zone from brain_sessions")) {
      const [id, orgId] = values;
      const session = store.sessions.get(id);
      return session && session.org_id === orgId ? [{ id: session.id, trust_zone: session.trust_zone }] : [];
    }

    // brain.appendSessionEvent: ledger insert
    if (text.startsWith("insert into brain_session_events")) {
      const [orgId, sessionId, actorType, actorUserId, actorKeyId, eventType, bodyMd, payloadJson, trustZone, sourceIds, requestId] = values;
      const row = {
        id: store.nextId("evt"),
        org_id: orgId,
        session_id: sessionId,
        actor_type: actorType,
        actor_user_id: actorUserId,
        actor_key_id: actorKeyId,
        event_type: eventType,
        body_md: bodyMd,
        payload: JSON.parse(payloadJson),
        trust_zone: trustZone,
        source_ids: sourceIds,
        request_id: requestId,
        created_at: store.nextEventAt(),
      };
      store.events.push(row);
      return [{ ...row }];
    }

    // brain.appendSessionEvent: last_event_at bump
    if (text.startsWith("update brain_sessions set last_event_at = now()")) return [];

    // run-rooms.createDirective
    if (text.startsWith("insert into brain_session_directives")) {
      const [sessionId, orgId, type, payloadJson, createdBy] = values;
      const row = {
        id: store.nextId("dir"),
        session_id: sessionId,
        org_id: orgId,
        type,
        payload: JSON.parse(payloadJson),
        created_by: createdBy,
        created_at: store.nextEventAt(),
        delivered_at: null,
        acked_at: null,
        result: null,
      };
      store.directives.set(row.id, row);
      return [{ ...row }];
    }

    // run-rooms.takeUndeliveredDirectives
    if (text.startsWith("update brain_session_directives set delivered_at = now()")) {
      const [sessionId, orgId] = values;
      const taken = [];
      for (const row of store.directives.values()) {
        if (row.session_id === sessionId && row.org_id === orgId && !row.delivered_at && !row.acked_at) {
          row.delivered_at = new Date().toISOString();
          taken.push({ ...row });
        }
      }
      return taken;
    }

    // run-rooms.ackDirective
    if (text.startsWith("update brain_session_directives set acked_at = now()")) {
      const [resultJson, id, sessionId, orgId] = values;
      const row = store.directives.get(id);
      if (!row || row.session_id !== sessionId || row.org_id !== orgId || row.acked_at) return [];
      row.acked_at = new Date().toISOString();
      row.result = JSON.parse(resultJson);
      return [{ ...row }];
    }

    // ack fallback: does the directive exist at all?
    if (text.startsWith("select id from brain_session_directives where id = ?")) {
      const [id, sessionId, orgId] = values;
      const row = store.directives.get(id);
      return row && row.session_id === sessionId && row.org_id === orgId ? [{ id: row.id }] : [];
    }

    // run-rooms.hasUndeliveredDirectives
    if (text.startsWith("select id from brain_session_directives where session_id = ?")) {
      const [sessionId, orgId] = values;
      for (const row of store.directives.values()) {
        if (row.session_id === sessionId && row.org_id === orgId && !row.delivered_at && !row.acked_at) {
          return [{ id: row.id }];
        }
      }
      return [];
    }

    // run-rooms.findUnresolvedApproval
    if (text.includes("event_type = 'run.live.approval.requested'")) {
      const [sessionId, orgId, approvalId] = values;
      const requested = store.events.find(
        (row) =>
          row.session_id === sessionId &&
          row.org_id === orgId &&
          row.event_type === "run.live.approval.requested" &&
          row.payload?.approval_id === approvalId,
      );
      if (!requested) return [];
      const resolved = store.events.some(
        (row) =>
          row.session_id === sessionId &&
          row.org_id === orgId &&
          row.event_type === "run.live.approval.resolved" &&
          row.payload?.approval_id === approvalId,
      );
      return resolved ? [] : [{ id: requested.id }];
    }

    // run-rooms.resolveEventCursor
    if (text.startsWith("select id, created_at from brain_session_events")) {
      const [eventId, sessionId, orgId] = values;
      const row = store.events.find((item) => item.id === eventId && item.session_id === sessionId && item.org_id === orgId);
      return row ? [{ id: row.id, created_at: row.created_at }] : [];
    }

    // run-rooms.listLiveEventsAfter (with and without cursor)
    if (text.startsWith("select id, session_id, actor_type, actor_user_id, event_type, body_md, payload, trust_zone, created_at")) {
      const hasCursor = text.includes("(created_at, id) >");
      const [sessionId, orgId, zones, ...rest] = values;
      const cursor = hasCursor ? { createdAt: rest[0], id: rest[1] } : null;
      const limit = hasCursor ? rest[2] : rest[0];
      const rows = store.events
        .filter((row) => row.session_id === sessionId && row.org_id === orgId && zones.includes(row.trust_zone))
        .filter((row) => {
          if (!cursor) return true;
          if (row.created_at !== cursor.createdAt) return row.created_at > cursor.createdAt;
          return row.id > cursor.id;
        })
        .sort((a, b) => (a.created_at === b.created_at ? (a.id > b.id ? 1 : -1) : a.created_at > b.created_at ? 1 : -1))
        .slice(0, limit);
      return rows.map((row) => ({ ...row }));
    }

    // run-rooms.logLiveOrgAudit
    if (text.startsWith("insert into audit_events")) {
      const [orgId, actorKeyId, action, resourceType, resourceId, ipHash, userAgent, metadataJson] = values;
      store.audits.push({
        org_id: orgId,
        actor_key_id: actorKeyId,
        action,
        resource_type: resourceType,
        resource_id: resourceId,
        ip_hash: ipHash,
        user_agent: userAgent,
        metadata: JSON.parse(metadataJson),
      });
      return [];
    }

    // lease handoff target membership check
    if (text.startsWith("select user_id from organization_memberships")) {
      const [orgId, userId] = values;
      return store.memberships.some((row) => row.org_id === orgId && row.user_id === userId && row.status === "active")
        ? [{ user_id: userId }]
        : [];
    }

    throw new Error(`unexpected run-rooms SQL: ${text}`);
  }

  function sql(strings, ...values) {
    return {
      then(resolve, reject) {
        try {
          resolve(run(strings, values));
        } catch (err) {
          reject(err);
        }
      },
      catch(onRejected) {
        return Promise.resolve()
          .then(() => run(strings, values))
          .catch(onRejected);
      },
    };
  }

  return sql;
}

// --- fixtures ---------------------------------------------------------------

function sessionRow(overrides = {}) {
  return {
    id: "sess-1",
    org_id: "org-1",
    status: "active",
    trust_zone: "green",
    live_status: "live",
    controller_user_id: null,
    lease_acquired_at: null,
    bridge_last_seen_at: new Date().toISOString(),
    last_event_at: null,
    ...overrides,
  };
}

function userSession(userId, orgId = "org-1", role = "admin") {
  return {
    user: { id: userId, email: `${userId}@acme.dev`, name: userId, status: "active", email_verified_at: FIXED_NOW },
    session: { id: "browser-sess", expires_at: FIXED_NOW },
    memberships: [
      { org_id: orgId, org_slug: "acme", org_name: "Acme", org_status: "active", role, status: "active" },
    ],
  };
}

function apiKeyActor(orgId = "org-1") {
  const organization = { id: orgId, slug: "acme", name: "Acme", status: "active" };
  return {
    ok: true,
    actor: {
      actorType: "api_key",
      apiKeyAuth: { organization, key: { id: "key-1", owner_user_id: "user-owner" }, allowedLabels: ["public", "internal"], capabilities: {} },
      organization,
      allowedLabels: ["public", "internal"],
      capabilities: { canReadSessions: true, canWriteSessions: true },
    },
  };
}

function ledgerEvent(overrides = {}) {
  return {
    id: "evt-seed-1",
    org_id: "org-1",
    session_id: "sess-1",
    actor_type: "api_key",
    actor_user_id: null,
    actor_key_id: "key-1",
    event_type: "run.live.started",
    body_md: "",
    payload: {},
    trust_zone: "green",
    source_ids: [],
    request_id: null,
    created_at: "2026-07-22T11:59:00.000Z",
    ...overrides,
  };
}

function setup(data = {}) {
  const store = makeStore(data);
  globalThis.__fakeSql = makeSql(store);
  globalThis.__telemetryLog = [];
  globalThis.__fakeUserSession = null;
  globalThis.__fakeActorResult = null;
  process.env.FREGE_LIVE_RUN_ROOMS = "true";
  process.env.FREGE_LIVE_POLL_MS = "20";
  return store;
}

const ctx = (id, extra = {}) => ({ params: Promise.resolve({ id, ...extra }) });

function jsonRequest(url, body, headers = {}) {
  return new Request(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });
}

async function readStreamUntil(res, predicate, { maxReads = 200 } = {}) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (let i = 0; i < maxReads; i += 1) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    if (predicate(buffer)) break;
  }
  return { buffer, reader };
}

// --- tests ------------------------------------------------------------------

test("flag off: every live route answers 404 not_found", async () => {
  setup({ sessions: [sessionRow()] });
  delete process.env.FREGE_LIVE_RUN_ROOMS;
  globalThis.__fakeUserSession = userSession("user-a");
  globalThis.__fakeActorResult = apiKeyActor();

  const calls = [
    () => eventsRoute.POST(jsonRequest("http://localhost/live/events", []), ctx("sess-1")),
    () => streamRoute.GET(new Request("http://localhost/live/stream"), ctx("sess-1")),
    () => leaseRoute.POST(jsonRequest("http://localhost/live/lease", { action: "claim" }), ctx("sess-1")),
    () => controlRoute.POST(jsonRequest("http://localhost/live/control", { action: "stop" }), ctx("sess-1")),
    () => directivesRoute.GET(new Request("http://localhost/live/directives"), ctx("sess-1")),
    () => ackRoute.POST(jsonRequest("http://localhost/live/ack", { result: {} }), ctx("sess-1", { directiveId: "dir-1" })),
  ];

  for (const call of calls) {
    const res = await call();
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "not_found" });
  }
});

test("lease CAS: two interleaved claims — exactly one wins", async () => {
  const store = setup({ sessions: [sessionRow()] });
  const sql = globalThis.__fakeSql;

  const [first, second] = await Promise.all([
    runRooms.claimLease(sql, "sess-1", "user-a"),
    runRooms.claimLease(sql, "sess-1", "user-b"),
  ]);

  const winners = [first, second].filter(Boolean);
  assert.equal(winners.length, 1, "exactly one claim must win the CAS race");
  assert.equal(store.sessions.get("sess-1").controller_user_id, winners[0].controller_user_id);
});

test("lease claim: writes ledger event, lease_notice directive, and org audit; rival claim gets 409 lease_held", async () => {
  const store = setup({ sessions: [sessionRow()] });

  globalThis.__fakeUserSession = userSession("user-a");
  const res = await leaseRoute.POST(jsonRequest("http://localhost/live/lease", { action: "claim" }), ctx("sess-1"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.lease.controller_user_id, "user-a");

  const ledger = store.events.find((row) => row.event_type === "run.live.lease.claimed");
  assert.ok(ledger, "lease claim must be a governed ledger event");
  assert.equal(ledger.actor_user_id, "user-a");

  const notice = [...store.directives.values()].find((row) => row.type === "lease_notice");
  assert.ok(notice, "bridge must learn of the lease via a lease_notice directive");
  assert.equal(notice.payload.holder_user_id, "user-a");

  const audit = store.audits.find((row) => row.action === "session.live.lease");
  assert.ok(audit, "lease claim must be org-audited");
  assert.equal(audit.metadata.actor_user_id, "user-a");

  globalThis.__fakeUserSession = userSession("user-b");
  const rival = await leaseRoute.POST(jsonRequest("http://localhost/live/lease", { action: "claim" }), ctx("sess-1"));
  assert.equal(rival.status, 409);
  assert.deepEqual(await rival.json(), { error: "lease_held" });

  const denied = store.events.find((row) => row.event_type === "run.live.denied");
  assert.ok(denied, "the CAS loser must appear in the governed ledger");
  assert.equal(denied.payload.reason, "lease_held");
  assert.equal(denied.payload.user_id, "user-b");
});

test("lease handoff: non-member target 400, member target moves the lease, non-holder release 409", async () => {
  const store = setup({
    sessions: [sessionRow({ controller_user_id: "user-a", lease_acquired_at: FIXED_NOW })],
    memberships: [
      { org_id: "org-1", user_id: "user-a", status: "active" },
      { org_id: "org-1", user_id: "user-b", status: "active" },
    ],
  });
  globalThis.__fakeUserSession = userSession("user-a");

  const outsider = await leaseRoute.POST(
    jsonRequest("http://localhost/live/lease", { action: "handoff", to_user_id: "3d5a3f4e-0000-4000-8000-000000000099" }),
    ctx("sess-1"),
  );
  assert.equal(outsider.status, 400);
  assert.deepEqual(await outsider.json(), { error: "invalid_target" });

  store.memberships.push({ org_id: "org-1", user_id: "3d5a3f4e-0000-4000-8000-000000000001", status: "active" });
  const handoff = await leaseRoute.POST(
    jsonRequest("http://localhost/live/lease", { action: "handoff", to_user_id: "3d5a3f4e-0000-4000-8000-000000000001" }),
    ctx("sess-1"),
  );
  assert.equal(handoff.status, 200);
  assert.equal(store.sessions.get("sess-1").controller_user_id, "3d5a3f4e-0000-4000-8000-000000000001");
  assert.ok(store.events.find((row) => row.event_type === "run.live.lease.handed_off"));
  assert.ok(store.audits.find((row) => row.action === "session.live.handoff"));

  // user-a no longer holds the lease, so a release is a CAS loss.
  const release = await leaseRoute.POST(jsonRequest("http://localhost/live/lease", { action: "release" }), ctx("sess-1"));
  assert.equal(release.status, 409);
  assert.deepEqual(await release.json(), { error: "lease_held" });
});

test("control: non-holder rejected with 409 not_controller, denied telemetry and denied ledger event", async () => {
  const store = setup({ sessions: [sessionRow({ controller_user_id: "user-a" })] });
  globalThis.__fakeUserSession = userSession("user-b");

  const res = await controlRoute.POST(jsonRequest("http://localhost/live/control", { action: "stop" }), ctx("sess-1"));
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: "not_controller" });

  const denied = globalThis.__telemetryLog.find((row) => row.action === "run_room.control" && row.outcome === "denied");
  assert.ok(denied, "denied control attempts must be visible in telemetry");
  assert.equal(denied.metadata.reason, "not_controller");

  const deniedEvent = store.events.find((row) => row.event_type === "run.live.denied");
  assert.ok(deniedEvent, "denied control attempts must be in the governed ledger");
  assert.equal(deniedEvent.payload.reason, "not_controller");
});

test("control stop + redirect by the holder: directive created, ledger event carries directive_id, audit written", async () => {
  const store = setup({ sessions: [sessionRow({ controller_user_id: "user-a" })] });
  globalThis.__fakeUserSession = userSession("user-a");

  const stop = await controlRoute.POST(jsonRequest("http://localhost/live/control", { action: "stop" }), ctx("sess-1"));
  assert.equal(stop.status, 202);
  const { directive_id } = await stop.json();
  const stopDirective = store.directives.get(directive_id);
  assert.equal(stopDirective.type, "stop");
  const interrupted = store.events.find((row) => row.event_type === "run.live.interrupted");
  assert.equal(interrupted.payload.directive_id, directive_id);
  assert.ok(store.audits.find((row) => row.action === "session.live.stop"));

  const redirect = await controlRoute.POST(
    jsonRequest("http://localhost/live/control", { action: "redirect", message: "focus on the failing test" }),
    ctx("sess-1"),
  );
  assert.equal(redirect.status, 202);
  const redirected = store.events.find((row) => row.event_type === "run.live.redirected");
  assert.equal(redirected.payload.message, "focus on the failing test");
  assert.ok(store.audits.find((row) => row.action === "session.live.redirect"));
});

test("control resolve_approval: unknown or already-resolved approval_id rejected with 400", async () => {
  const store = setup({
    sessions: [sessionRow({ controller_user_id: "user-a" })],
    events: [
      ledgerEvent({ id: "evt-req", event_type: "run.live.approval.requested", payload: { approval_id: "appr-1" } }),
      ledgerEvent({ id: "evt-res", event_type: "run.live.approval.resolved", payload: { approval_id: "appr-1" }, created_at: "2026-07-22T11:59:30.000Z" }),
    ],
  });
  globalThis.__fakeUserSession = userSession("user-a");

  const unknown = await controlRoute.POST(
    jsonRequest("http://localhost/live/control", { action: "resolve_approval", approval_id: "appr-nope", decision: "approve" }),
    ctx("sess-1"),
  );
  assert.equal(unknown.status, 400);
  assert.deepEqual(await unknown.json(), { error: "invalid_approval" });

  const alreadyResolved = await controlRoute.POST(
    jsonRequest("http://localhost/live/control", { action: "resolve_approval", approval_id: "appr-1", decision: "approve" }),
    ctx("sess-1"),
  );
  assert.equal(alreadyResolved.status, 400);
  assert.deepEqual(await alreadyResolved.json(), { error: "invalid_approval" });

  const deniedEvents = store.events.filter((row) => row.event_type === "run.live.denied");
  assert.equal(deniedEvents.length, 2, "each invalid approval attempt lands in the governed ledger");
  assert.ok(deniedEvents.every((row) => row.payload.reason === "invalid_approval"));
});

test("control resolve_approval: valid pending approval resolves with resolver identity in directive and ledger", async () => {
  const store = setup({
    sessions: [sessionRow({ controller_user_id: "user-a" })],
    events: [ledgerEvent({ id: "evt-req", event_type: "run.live.approval.requested", payload: { approval_id: "appr-2" } })],
  });
  globalThis.__fakeUserSession = userSession("user-a");

  const res = await controlRoute.POST(
    jsonRequest("http://localhost/live/control", { action: "resolve_approval", approval_id: "appr-2", decision: "deny" }),
    ctx("sess-1"),
  );
  assert.equal(res.status, 202);
  const { directive_id } = await res.json();

  const directive = store.directives.get(directive_id);
  assert.equal(directive.type, "resolve_approval");
  assert.equal(directive.payload.decision, "deny");
  assert.deepEqual(directive.payload.resolved_by, { user_id: "user-a", email: "user-a@acme.dev" });

  const resolved = store.events.find((row) => row.event_type === "run.live.approval.resolved");
  assert.equal(resolved.payload.approval_id, "appr-2");
  assert.equal(resolved.payload.requested_event_id, "evt-req");
  assert.deepEqual(resolved.payload.resolved_by, { user_id: "user-a", email: "user-a@acme.dev" });
  assert.ok(store.audits.find((row) => row.action === "session.live.approval"));
});

test("stream: non-member gets the 404 not_found denial shape", async () => {
  setup({ sessions: [sessionRow()] });
  globalThis.__fakeUserSession = userSession("user-x", "org-other");

  const res = await streamRoute.GET(new Request("http://localhost/live/stream"), ctx("sess-1"));
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "not_found" });
});

test("stream: member replay carries ledger ids as SSE ids, then tears down on abort", async () => {
  setup({
    sessions: [sessionRow()],
    events: [
      ledgerEvent({ id: "evt-1", event_type: "run.live.started" }),
      ledgerEvent({ id: "evt-2", event_type: "run.live.agent_message", body_md: "hello", created_at: "2026-07-22T11:59:10.000Z" }),
    ],
  });
  globalThis.__fakeUserSession = userSession("user-a");

  const abort = new AbortController();
  const res = await streamRoute.GET(
    new Request("http://localhost/live/stream", { signal: abort.signal }),
    ctx("sess-1"),
  );
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/event-stream/);

  const { buffer, reader } = await readStreamUntil(res, (text) => text.includes("evt-2"));
  assert.ok(buffer.includes("id: evt-1"), "SSE id must be the ledger event id");
  assert.ok(buffer.includes("id: evt-2"));
  assert.ok(
    !buffer.includes("\nevent:") && !buffer.startsWith("event:"),
    "ledger rows must be default SSE messages (EventSource.onmessage) — no custom event field",
  );
  assert.ok(buffer.includes('"event_type":"run.live.started"'), "the kind travels in data.event_type");

  abort.abort();
  await assert.doesNotReject(async () => {
    for (let i = 0; i < 50; i += 1) {
      const { done } = await reader.read();
      if (done) return;
    }
    throw new Error("stream did not close after client abort");
  });

  const opened = globalThis.__telemetryLog.find((row) => row.action === "run_room.watch_opened");
  assert.ok(opened, "watch_opened telemetry must fire once per connection");
});

test("stream: reconnect cursor (Last-Event-ID) replays only events after the cursor", async () => {
  setup({
    sessions: [sessionRow()],
    events: [
      ledgerEvent({ id: "evt-1", event_type: "run.live.started" }),
      ledgerEvent({ id: "evt-2", event_type: "run.live.agent_message", created_at: "2026-07-22T11:59:10.000Z" }),
    ],
  });
  globalThis.__fakeUserSession = userSession("user-a");

  const abort = new AbortController();
  const res = await streamRoute.GET(
    new Request("http://localhost/live/stream", { signal: abort.signal, headers: { "last-event-id": "evt-1" } }),
    ctx("sess-1"),
  );
  const { buffer } = await readStreamUntil(res, (text) => text.includes("evt-2"));
  abort.abort();

  assert.ok(!buffer.includes("id: evt-1"), "events at or before the cursor must not replay");
  assert.ok(buffer.includes("id: evt-2"));
});

test("stream: stale bridge with undelivered directives surfaces run.live.bridge.disconnected", async () => {
  setup({
    sessions: [sessionRow({ bridge_last_seen_at: "2026-07-22T11:00:00.000Z" })],
    directives: [
      {
        id: "dir-stale",
        session_id: "sess-1",
        org_id: "org-1",
        type: "stop",
        payload: {},
        created_by: "user-a",
        created_at: FIXED_NOW,
        delivered_at: null,
        acked_at: null,
        result: null,
      },
    ],
  });
  globalThis.__fakeUserSession = userSession("user-a");

  const abort = new AbortController();
  const res = await streamRoute.GET(
    new Request("http://localhost/live/stream", { signal: abort.signal }),
    ctx("sess-1"),
  );
  const { buffer } = await readStreamUntil(res, (text) => text.includes("run.live.bridge.disconnected"));
  abort.abort();

  const frame = buffer
    .split("\n\n")
    .find((chunk) => chunk.includes("run.live.bridge.disconnected"));
  assert.ok(frame, "watchers must see the bridge truth");
  assert.ok(!frame.includes("event:"), "synthetic frame must be a default message so onmessage fires");
  assert.ok(!/^id:/m.test(frame), "synthetic frame must carry NO SSE id — Last-Event-ID stays a ledger cursor");

  const data = JSON.parse(frame.replace(/^data: /, ""));
  assert.equal(data.event_type, "run.live.bridge.disconnected");
  assert.match(data.id, /^bridge-disconnected-/, "data.id must be unique and non-ledger");
  assert.equal(data.payload.bridge_last_seen_at, "2026-07-22T11:00:00.000Z");
});

test("events: bridge batch appends run.live.* ledger events and marks the bridge live", async () => {
  const store = setup({ sessions: [sessionRow({ live_status: "none", bridge_last_seen_at: null })] });
  globalThis.__fakeActorResult = apiKeyActor();

  const res = await eventsRoute.POST(
    jsonRequest("http://localhost/live/events", [
      { kind: "run.live.started", payload: { thread_id: "t-1" }, occurred_at: FIXED_NOW },
      { kind: "run.live.command.started", payload: { command: "pwd" }, occurred_at: FIXED_NOW },
    ]),
    ctx("sess-1"),
  );
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { appended: 2 });

  const kinds = store.events.map((row) => row.event_type);
  assert.deepEqual(kinds, ["run.live.started", "run.live.command.started"]);
  assert.equal(store.events[0].payload.occurred_at, FIXED_NOW);
  assert.equal(store.sessions.get("sess-1").live_status, "live");
  assert.ok(store.sessions.get("sess-1").bridge_last_seen_at, "batch must refresh bridge_last_seen_at");

  const ended = await eventsRoute.POST(
    jsonRequest("http://localhost/live/events", [{ kind: "run.live.ended", payload: {}, occurred_at: FIXED_NOW }]),
    ctx("sess-1"),
  );
  assert.equal(ended.status, 202);
  assert.equal(store.sessions.get("sess-1").live_status, "ended");
});

test("events: console-session actors and out-of-org agent keys both get 404 not_found", async () => {
  setup({ sessions: [sessionRow()] });

  globalThis.__fakeActorResult = {
    ok: true,
    actor: { actorType: "user", organization: { id: "org-1" }, capabilities: {} },
  };
  const asUser = await eventsRoute.POST(
    jsonRequest("http://localhost/live/events", [{ kind: "run.live.started", payload: {}, occurred_at: FIXED_NOW }]),
    ctx("sess-1"),
  );
  assert.equal(asUser.status, 404);

  globalThis.__fakeActorResult = apiKeyActor("org-other");
  const wrongOrg = await eventsRoute.POST(
    jsonRequest("http://localhost/live/events", [{ kind: "run.live.started", payload: {}, occurred_at: FIXED_NOW }]),
    ctx("sess-1"),
  );
  assert.equal(wrongOrg.status, 404);
  assert.deepEqual(await wrongOrg.json(), { error: "not_found" });
});

test("directives: poll marks delivered exactly once and bumps bridge_last_seen_at; wrong org 404s", async () => {
  const store = setup({
    sessions: [sessionRow({ bridge_last_seen_at: null })],
    directives: [
      {
        id: "dir-1",
        session_id: "sess-1",
        org_id: "org-1",
        type: "redirect",
        payload: { message: "hi" },
        created_by: "user-a",
        created_at: FIXED_NOW,
        delivered_at: null,
        acked_at: null,
        result: null,
      },
    ],
  });
  globalThis.__fakeActorResult = apiKeyActor();

  const first = await directivesRoute.GET(new Request("http://localhost/live/directives"), ctx("sess-1"));
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.directives.length, 1);
  assert.equal(firstBody.directives[0].id, "dir-1");
  assert.ok(store.directives.get("dir-1").delivered_at, "GET must mark the directive delivered");
  assert.ok(store.sessions.get("sess-1").bridge_last_seen_at, "poll must refresh bridge liveness");

  const second = await directivesRoute.GET(new Request("http://localhost/live/directives"), ctx("sess-1"));
  assert.deepEqual((await second.json()).directives, [], "delivered directives are not re-delivered");

  globalThis.__fakeActorResult = apiKeyActor("org-other");
  const wrongOrg = await directivesRoute.GET(new Request("http://localhost/live/directives"), ctx("sess-1"));
  assert.equal(wrongOrg.status, 404);
});

test("ack: stores result once; double-ack 409; unknown directive 404", async () => {
  const store = setup({
    sessions: [sessionRow()],
    directives: [
      {
        id: "dir-1",
        session_id: "sess-1",
        org_id: "org-1",
        type: "stop",
        payload: {},
        created_by: "user-a",
        created_at: FIXED_NOW,
        delivered_at: FIXED_NOW,
        acked_at: null,
        result: null,
      },
    ],
  });
  globalThis.__fakeActorResult = apiKeyActor();

  const ok = await ackRoute.POST(
    jsonRequest("http://localhost/live/ack", { result: { interrupted: true } }),
    ctx("sess-1", { directiveId: "dir-1" }),
  );
  assert.equal(ok.status, 200);
  assert.deepEqual(store.directives.get("dir-1").result, { interrupted: true });
  assert.ok(store.directives.get("dir-1").acked_at);

  const twice = await ackRoute.POST(
    jsonRequest("http://localhost/live/ack", { result: {} }),
    ctx("sess-1", { directiveId: "dir-1" }),
  );
  assert.equal(twice.status, 409);
  assert.deepEqual(await twice.json(), { error: "already_acked" });

  const unknown = await ackRoute.POST(
    jsonRequest("http://localhost/live/ack", { result: {} }),
    ctx("sess-1", { directiveId: "dir-missing" }),
  );
  assert.equal(unknown.status, 404);
});
