#!/usr/bin/env node
import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const DEFAULT_BASE_URL = "http://localhost:3000";
const CONFIG_PATH = path.join(homedir(), ".frege", "mcp", "config.json");
const APPROVAL_METHODS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
]);

const event = (kind, payload = {}) => ({ kind, payload, occurred_at: new Date().toISOString() });

export function createBridgeState() {
  return {
    threadId: null,
    activeTurnId: null,
    agentText: new Map(),
    commandOutput: new Map(),
    approvals: new Map(),
    ended: false,
  };
}

function itemPayload(state, params, item = params.item ?? {}) {
  return {
    thread_id: params.threadId ?? state.threadId,
    turn_id: params.turnId ?? state.activeTurnId,
    item_id: item.id ?? params.itemId,
  };
}

export function mapCodexEvent(message, state = createBridgeState()) {
  const { method, params = {} } = message;
  const item = params.item ?? {};
  const ids = itemPayload(state, params, item);

  if (method === "thread/started") {
    state.threadId = params.thread?.id ?? params.threadId ?? state.threadId;
    return [event("run.live.started", { thread_id: state.threadId })];
  }
  if (method === "turn/started") {
    state.threadId = params.threadId ?? state.threadId;
    state.activeTurnId = params.turn?.id ?? params.turnId ?? state.activeTurnId;
    return [];
  }
  if (method === "turn/completed") {
    const status = params.turn?.status ?? params.status;
    const turnId = params.turn?.id ?? params.turnId ?? state.activeTurnId;
    if (turnId === state.activeTurnId) state.activeTurnId = null;
    return status === "interrupted"
      ? [event("run.live.interrupted", { thread_id: state.threadId, turn_id: turnId, status })]
      : [];
  }
  if (method === "thread/closed") {
    state.ended = true;
    return [event("run.live.ended", { thread_id: params.threadId ?? state.threadId })];
  }
  if (method === "item/agentMessage/delta") {
    const itemId = params.itemId;
    const delta = params.delta ?? "";
    state.agentText.set(itemId, `${state.agentText.get(itemId) ?? ""}${delta}`);
    return [event("run.live.agent_message", { ...ids, item_id: itemId, delta, final: false })];
  }
  if (method === "item/started" && item.type === "commandExecution") {
    state.commandOutput.set(item.id, "");
    return [
      event("run.live.command.started", {
        ...ids,
        command: item.command,
        cwd: item.cwd,
        status: item.status,
      }),
    ];
  }
  if (method === "item/completed" && item.type === "commandExecution") {
    const output = item.aggregatedOutput ?? state.commandOutput.get(item.id);
    state.commandOutput.delete(item.id);
    return [
      event("run.live.command.finished", {
        ...ids,
        command: item.command,
        cwd: item.cwd,
        output,
        exit_code: item.exitCode,
        duration_ms: item.durationMs,
        status: item.status,
      }),
    ];
  }
  if (method === "item/completed" && item.type === "agentMessage") {
    const seen = state.agentText.get(item.id) ?? "";
    const text = item.text ?? "";
    state.agentText.delete(item.id);
    return [
      event("run.live.agent_message", {
        ...ids,
        delta: text.startsWith(seen) ? text.slice(seen.length) : text,
        phase: item.phase,
        final: true,
      }),
    ];
  }
  if (method === "item/fileChange/patchUpdated" || method === "item/fileChange/outputDelta") {
    return [event("run.live.file_change", { ...ids, ...params })];
  }
  if (method === "item/completed" && item.type === "fileChange") {
    return [event("run.live.file_change", { ...ids, changes: item.changes, status: item.status, final: true })];
  }
  if (method === "item/commandExecution/outputDelta") {
    state.commandOutput.set(params.itemId, `${state.commandOutput.get(params.itemId) ?? ""}${params.delta ?? ""}`);
    return [];
  }
  if (method?.endsWith("/requestApproval")) {
    const approvalId = String(params.approvalId ?? params.itemId ?? message.id);
    const remotelyResolvable = APPROVAL_METHODS.has(method);
    if (remotelyResolvable) {
      state.approvals.set(approvalId, { requestId: message.id, method });
    }
    return [
      event("run.live.approval.requested", {
        ...ids,
        approval_id: approvalId,
        approval_type: method,
        remotely_resolvable: remotelyResolvable,
        command: params.command,
        cwd: params.cwd,
        reason: params.reason,
      }),
    ];
  }
  return [];
}

export class EventBatcher {
  constructor({ send, spool, windowMs = 1000, maxAttempts = 3, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
    this.send = send;
    this.spool = spool;
    this.windowMs = windowMs;
    this.maxAttempts = maxAttempts;
    this.sleep = sleep;
    this.buffer = [];
    this.timer = null;
    this.inFlight = null;
  }

  push(value) {
    this.buffer.push(value);
    if (this.buffer.length >= 100) void this.flush();
    else if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, this.windowMs);
    }
  }

  async flush() {
    if (this.inFlight) return this.inFlight;
    clearTimeout(this.timer);
    this.timer = null;
    const batch = this.buffer.splice(0, 100);
    if (!batch.length) return;

    this.inFlight = (async () => {
      let lastError;
      for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
        try {
          await this.send(batch);
          return;
        } catch (error) {
          lastError = error;
          if (attempt + 1 < this.maxAttempts) await this.sleep(250 * 2 ** attempt);
        }
      }
      await this.spool(batch, lastError);
    })().finally(() => {
      this.inFlight = null;
      if (this.buffer.length && !this.timer) {
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.flush();
        }, this.windowMs);
      }
    });
    return this.inFlight;
  }

  async drain() {
    clearTimeout(this.timer);
    this.timer = null;
    while (this.inFlight || this.buffer.length) {
      if (this.inFlight) await this.inFlight;
      else await this.flush();
    }
  }
}

export class JsonRpcPeer {
  constructor(child, onMessage) {
    this.child = child;
    this.onMessage = onMessage;
    this.nextId = 1;
    this.pending = new Map();
    this.lines = createInterface({ input: child.stdout });
    this.lines.on("line", (line) => this.handleLine(line));
    child.once("error", (error) => this.rejectPending(error));
    child.once("close", () => this.rejectPending(new Error("Codex App Server exited")));
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
      else pending.resolve(message.result);
      return;
    }
    this.onMessage(message);
  }

  write(message) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  }

  request(method, params = {}) {
    const id = this.nextId++;
    this.write({ id, method, params });
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  notify(method, params = {}) {
    this.write({ method, params });
  }

  respond(id, result) {
    this.write({ id, result });
  }

  rejectPending(error) {
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }
}

export async function handleDirective(directive, { rpc, state, log = console.error }) {
  const payload = directive.payload ?? {};
  if (directive.type === "stop") {
    if (!state.threadId || !state.activeTurnId) return { error: "no_active_turn" };
    await rpc.request("turn/interrupt", { threadId: state.threadId, turnId: state.activeTurnId });
    return { ok: true };
  }
  if (directive.type === "redirect") {
    const message = String(payload.message ?? "").trim();
    if (!message) return { error: "missing_message" };
    const input = [{ type: "text", text: message }];
    if (state.activeTurnId) {
      await rpc.request("turn/steer", {
        threadId: state.threadId,
        expectedTurnId: state.activeTurnId,
        input,
      });
      return { ok: true, turn_id: state.activeTurnId };
    }
    const result = await rpc.request("turn/start", { threadId: state.threadId, input });
    state.activeTurnId = result?.turn?.id ?? state.activeTurnId;
    return { ok: true, turn_id: state.activeTurnId };
  }
  if (directive.type === "lease_notice") {
    log(`Frege controller changed: ${JSON.stringify(payload)}`);
    return { ok: true };
  }
  if (directive.type === "resolve_approval") {
    const approvalId = String(payload.approval_id ?? "");
    const pending = state.approvals.get(approvalId);
    if (!pending) return { error: "unknown_approval" };
    if (payload.decision !== "approve" && payload.decision !== "deny") return { error: "invalid_decision" };
    rpc.respond(pending.requestId, { decision: payload.decision === "approve" ? "accept" : "decline" });
    state.approvals.delete(approvalId);
    return { ok: true };
  }
  return { error: "unknown_directive" };
}

async function readRuntimeConfig() {
  let stored = {};
  try {
    stored = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  } catch {}
  return {
    baseUrl: String(process.env.FREGE_BASE_URL || stored.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    apiKey: process.env.FREGE_API_KEY || stored.apiKey || "",
  };
}

function transient(error) {
  const code = error?.cause?.code ?? error?.code;
  return error?.transient || error?.name === "AbortError" || ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE"].includes(code);
}

export function createFregeClient({ baseUrl, apiKey, fetchImpl = fetch }) {
  if (!apiKey) throw new Error(`FREGE_API_KEY is not set and ${CONFIG_PATH} has no apiKey. Run frege connect first.`);
  return {
    async request(pathname, { method = "GET", body, attempts = 1 } = {}) {
      let lastError;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30_000);
        try {
          const response = await fetchImpl(`${baseUrl}${pathname}`, {
            method,
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: controller.signal,
          });
          const json = await response.json().catch(() => ({}));
          if (!response.ok) {
            const error = new Error(JSON.stringify({ status: response.status, error: json.error ?? "request_failed" }));
            error.transient = response.status >= 500;
            throw error;
          }
          return json;
        } catch (error) {
          lastError = error;
          if (!transient(error) || attempt + 1 >= attempts) throw error;
          await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
        } finally {
          clearTimeout(timer);
        }
      }
      throw lastError;
    },
  };
}

const wait = (ms, signal) => signal?.aborted ? Promise.resolve() : new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => {
    clearTimeout(timer);
    resolve();
  }, { once: true });
});

export async function pollDirectives({ api, sessionId, rpc, state, signal, log = console.error }) {
  const pendingAcks = new Map();
  let delayMs = 1500;
  while (!signal.aborted) {
    try {
      for (const [id, result] of pendingAcks) {
        await api.request(`/api/v1/sessions/${sessionId}/live/directives/${id}/ack`, {
          method: "POST",
          body: { result },
          attempts: 4,
        });
        pendingAcks.delete(id);
      }
      const response = await api.request(`/api/v1/sessions/${sessionId}/live/directives`);
      const directives = Array.isArray(response) ? response : response.directives ?? [];
      for (const directive of directives) {
        let result;
        try {
          result = await handleDirective(directive, { rpc, state, log });
        } catch (error) {
          result = { error: error instanceof Error ? error.message : String(error) };
        }
        pendingAcks.set(directive.id, result);
        await api.request(`/api/v1/sessions/${sessionId}/live/directives/${directive.id}/ack`, {
          method: "POST",
          body: { result },
          attempts: 4,
        });
        pendingAcks.delete(directive.id);
      }
      delayMs = 1500;
    } catch (error) {
      log(`Frege directive connection lost; retrying: ${error instanceof Error ? error.message : error}`);
      delayMs = Math.min(delayMs * 2, 30_000);
    }
    await wait(delayMs, signal);
  }
}

async function spoolEvents(spoolPath, batch) {
  await mkdir(path.dirname(spoolPath), { recursive: true });
  await appendFile(spoolPath, `${batch.map((entry) => JSON.stringify(entry)).join("\n")}\n`, { mode: 0o600 });
}

function showCodexEvent(message) {
  if (message.method === "item/agentMessage/delta") process.stdout.write(message.params?.delta ?? "");
  if (message.method === "item/started" && message.params?.item?.type === "commandExecution") {
    console.error(`\n[codex] ${message.params.item.command}`);
  }
  if (message.method?.endsWith("/requestApproval")) {
    console.error(`\n[codex] approval requested: ${message.params?.approvalId ?? message.params?.itemId ?? message.id}`);
  }
}

function consoleBaseUrl(baseUrl) {
  const url = new URL(baseUrl);
  if (url.hostname === "frege.dev") url.hostname = "brain.frege.dev";
  return url.toString().replace(/\/$/, "");
}

export async function runBridge(codexArgs = [], { spawnImpl = spawn } = {}) {
  if (process.env.FREGE_LIVE_RUN_ROOMS !== "true") throw new Error("frege run codex is experimental; set FREGE_LIVE_RUN_ROOMS=true");
  const config = await readRuntimeConfig();
  const api = createFregeClient(config);
  const created = await api.request("/api/v1/sessions", {
    method: "POST",
    attempts: 4,
    body: {
      external_id: `codex-live-${randomUUID()}`,
      client: "codex-app-server",
      title: "Live Codex run",
      metadata: { cwd: process.cwd(), bridge: "frege-run-bridge" },
    },
  });
  const sessionId = created.session?.id;
  if (!sessionId) throw new Error("Frege did not return a session id");
  console.log(`Watch: ${consoleBaseUrl(config.baseUrl)}/run-rooms/${sessionId}`);

  const spoolPath = path.join(homedir(), ".frege", "run-rooms", `${sessionId}.events.jsonl`);
  const batcher = new EventBatcher({
    send: (batch) => api.request(`/api/v1/sessions/${sessionId}/live/events`, { method: "POST", body: batch }),
    spool: async (batch) => {
      await spoolEvents(spoolPath, batch);
      console.error(`Frege remained unreachable; spooled ${batch.length} event(s) to ${spoolPath}`);
    },
  });
  const state = createBridgeState();
  const child = spawnImpl("codex", ["app-server", ...codexArgs, "--stdio"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.pipe(process.stderr);
  const rpc = new JsonRpcPeer(child, (message) => {
    showCodexEvent(message);
    for (const mapped of mapCodexEvent(message, state)) batcher.push(mapped);
  });
  const exited = new Promise((resolve) => {
    child.once("error", (error) => resolve({ code: 1, signal: null, error }));
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  const abort = new AbortController();
  const terminate = () => child.kill("SIGTERM");
  process.once("SIGINT", terminate);
  process.once("SIGTERM", terminate);

  let exit = { code: 1, signal: null };
  let failure;
  try {
    await rpc.request("initialize", { clientInfo: { name: "frege-run-bridge", version: "0.1.0" } });
    rpc.notify("initialized", {});
    const started = await rpc.request("thread/start", { cwd: process.cwd(), ephemeral: false });
    state.threadId = started.thread?.id ?? state.threadId;
    void pollDirectives({ api, sessionId, rpc, state, signal: abort.signal });
    exit = await exited;
    failure = exit.error;
  } catch (error) {
    failure = error;
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    exit = await exited;
  } finally {
    abort.abort();
    process.off("SIGINT", terminate);
    process.off("SIGTERM", terminate);
    if (!state.ended) {
      batcher.push(event("run.live.ended", {
        thread_id: state.threadId,
        exit_code: exit.code,
        signal: exit.signal,
      }));
    }
    await batcher.drain();
  }
  if (failure) throw failure;
  return exit.code === 0 ? 0 : exit.code ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  runBridge(args).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
