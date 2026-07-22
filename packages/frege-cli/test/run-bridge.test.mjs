import assert from "node:assert/strict";
import test from "node:test";

import {
  EventBatcher,
  createBridgeState,
  handleDirective,
  mapCodexEvent,
} from "../bin/frege-run-bridge.mjs";

const fixtures = [
  {
    raw: { method: "thread/started", params: { thread: { id: "thread-1" } } },
    kind: "run.live.started",
  },
  {
    raw: { method: "item/agentMessage/delta", params: { itemId: "msg-1", delta: "hello" } },
    kind: "run.live.agent_message",
  },
  {
    raw: {
      method: "item/started",
      params: { threadId: "thread-1", turnId: "turn-1", item: { id: "cmd-1", type: "commandExecution", command: "pwd", cwd: "/tmp", status: "inProgress" } },
    },
    kind: "run.live.command.started",
  },
  {
    raw: {
      method: "item/completed",
      params: { threadId: "thread-1", turnId: "turn-1", item: { id: "cmd-1", type: "commandExecution", command: "pwd", aggregatedOutput: "/tmp", exitCode: 0, status: "completed" } },
    },
    kind: "run.live.command.finished",
  },
  {
    raw: { method: "item/fileChange/patchUpdated", params: { threadId: "thread-1", turnId: "turn-1", itemId: "patch-1", patch: "*** Begin Patch" } },
    kind: "run.live.file_change",
  },
  {
    raw: { id: 19, method: "item/commandExecution/requestApproval", params: { threadId: "thread-1", turnId: "turn-1", itemId: "cmd-2", command: "touch file" } },
    kind: "run.live.approval.requested",
  },
];

test("recorded Codex fixtures map to stable Frege event kinds", () => {
  for (const { raw, kind } of fixtures) {
    assert.equal(mapCodexEvent(raw, createBridgeState())[0]?.kind, kind, raw.method);
  }
});

test("agent completion sends only text not already emitted as deltas", () => {
  const state = createBridgeState();
  mapCodexEvent({ method: "item/agentMessage/delta", params: { itemId: "msg-1", delta: "hello" } }, state);
  const [completed] = mapCodexEvent({
    method: "item/completed",
    params: { item: { id: "msg-1", type: "agentMessage", text: "hello world", phase: "final_answer" } },
  }, state);
  assert.equal(completed.payload.delta, " world");
  assert.equal(completed.payload.final, true);
  assert.equal("text" in completed.payload, false);
});

test("event batcher flushes buffered events without blocking push", async () => {
  const sent = [];
  const batcher = new EventBatcher({
    windowMs: 10,
    send: async (batch) => sent.push(batch),
    spool: async () => assert.fail("should not spool"),
  });
  batcher.push({ kind: "one" });
  batcher.push({ kind: "two" });
  assert.equal(sent.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 25));
  await batcher.drain();
  assert.deepEqual(sent, [[{ kind: "one" }, { kind: "two" }]]);
});

test("events arriving during a network flush are sent in the next batch", async () => {
  const sent = [];
  let releaseFirst;
  const batcher = new EventBatcher({
    windowMs: 10,
    send: async (batch) => {
      sent.push(batch);
      if (sent.length === 1) await new Promise((resolve) => {
        releaseFirst = resolve;
      });
    },
    spool: async () => assert.fail("should not spool"),
  });
  batcher.push({ kind: "one" });
  const firstFlush = batcher.flush();
  batcher.push({ kind: "two" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(sent.length, 1);
  releaseFirst();
  await firstFlush;
  await batcher.drain();
  assert.deepEqual(sent, [[{ kind: "one" }], [{ kind: "two" }]]);
});

test("event batcher spools after repeated send failure", async () => {
  let attempts = 0;
  let spooled;
  const batcher = new EventBatcher({
    maxAttempts: 2,
    sleep: async () => {},
    send: async () => {
      attempts += 1;
      throw new Error("offline");
    },
    spool: async (batch, error) => {
      spooled = { batch, error: error.message };
    },
  });
  batcher.push({ kind: "run.live.started" });
  await batcher.flush();
  assert.equal(attempts, 2);
  assert.deepEqual(spooled, { batch: [{ kind: "run.live.started" }], error: "offline" });
});

test("stop interrupts the active turn", async () => {
  const calls = [];
  const result = await handleDirective({ type: "stop" }, {
    state: { threadId: "thread-1", activeTurnId: "turn-1", approvals: new Map() },
    rpc: { request: async (...args) => calls.push(args) },
  });
  assert.deepEqual(calls, [["turn/interrupt", { threadId: "thread-1", turnId: "turn-1" }]]);
  assert.deepEqual(result, { ok: true });
});

test("redirect steers an active turn and starts a new turn when idle", async () => {
  const calls = [];
  const rpc = {
    request: async (method, params) => {
      calls.push([method, params]);
      return method === "turn/start" ? { turn: { id: "turn-2" } } : { turnId: "turn-1" };
    },
  };
  const active = { threadId: "thread-1", activeTurnId: "turn-1", approvals: new Map() };
  await handleDirective({ type: "redirect", payload: { message: "change course" } }, { rpc, state: active });
  assert.equal(calls[0][0], "turn/steer");
  assert.equal(calls[0][1].expectedTurnId, "turn-1");

  const idle = { threadId: "thread-1", activeTurnId: null, approvals: new Map() };
  const result = await handleDirective({ type: "redirect", payload: { message: "continue" } }, { rpc, state: idle });
  assert.equal(calls[1][0], "turn/start");
  assert.equal(result.turn_id, "turn-2");
});

test("approval directives match exactly and fail closed", async () => {
  const responses = [];
  const rpc = { respond: (...args) => responses.push(args) };
  const state = { approvals: new Map([["approval-1", { requestId: 42 }]]) };

  assert.deepEqual(
    await handleDirective({ type: "resolve_approval", payload: { approval_id: "wrong", decision: "approve" } }, { rpc, state }),
    { error: "unknown_approval" },
  );
  assert.deepEqual(responses, []);

  assert.deepEqual(
    await handleDirective({ type: "resolve_approval", payload: { approval_id: "approval-1", decision: "deny" } }, { rpc, state }),
    { ok: true },
  );
  assert.deepEqual(responses, [[42, { decision: "decline" }]]);
  assert.equal(state.approvals.size, 0);
});
