#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// agent-runtime.ts lands with branch A (harden-a-agent-worker). Unlike the billing core it
// is NOT dependency-injected: it calls getSql() from "@/lib/db" and imports value symbols
// from brain / context / model modules directly. To drive it with an in-memory sql fake we
// (1) resolve the "@/" path alias Node can't, and (2) swap those heavy value modules for
// virtual stubs. getSql() returns globalThis.__fakeSql so each test controls its own store.
// Until branch A merges, lib/core/agent-runtime.ts is absent; this validates at integration.
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const VIRTUAL = {
  "@/lib/db": "export function getSql(){ return globalThis.__fakeSql; }",
  "@/lib/core/brain": `
    export const redactSecrets = (value) => value ?? "";
    export const brainActorKeyId = (actor) => (actor?.actorType === "api_key" ? (actor.apiKeyAuth?.key?.id ?? null) : null);
    export const brainActorUserId = (actor) => (actor?.actorType === "user" ? (actor.userAuth?.user?.id ?? null) : null);
    export const startBrainSession = async () => ({ id: "sess-runtime" });
    export const appendSessionEvent = async () => ({});
  `,
  "@/lib/core/context-gateway": `
    export const buildContextPacket = async () => ({
      id: "ctx-runtime", denied_count: 0, documents: [], brain_pages: [], token_estimate: 0, trust_zone: "green",
    });
  `,
  "@/lib/core/model-gateway": "export const compileFregePrompt = (taskPrompt) => String(taskPrompt);",
  "@/lib/core/model-configs": `
    export const resolveModelConfig = async () => ({
      slug: "m1", provider: "anthropic", base_url: null, model_name: "claude", api_key: null, allowed_trust_zones: ["green"],
    });
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

const runtime = await import(pathToFileURL(path.join(rootDir, "lib/core/agent-runtime.ts")).href);

const FIXED_NOW = "2026-01-01T00:00:00.000Z";

function normalize(strings) {
  return strings.join(" ? ").toLowerCase().replace(/\s+/g, " ").trim();
}

// In-memory stand-in for the subset of agent_runs / agent_run_steps SQL the runtime issues.
function makeRuntimeSql() {
  const store = {
    agent: {
      id: "agent-1",
      org_id: "org-1",
      slug: "summarizer",
      name: "Summarizer",
      description: "",
      instructions_md: "Summarize the input.",
      model_config_id: "mc-1",
      model_config_slug: "m1",
      status: "active",
      trust_zone: "green",
      default_context_query: "",
      max_steps: 1,
      created_at: FIXED_NOW,
      updated_at: FIXED_NOW,
    },
    organization: { id: "org-1", slug: "acme", name: "Acme" },
    runs: new Map(),
    steps: [],
  };
  let seq = 0;

  function stepsFor(runId) {
    return store.steps.filter((step) => step.run_id === runId);
  }

  function loadRow(runId) {
    const run = store.runs.get(runId);
    if (!run) return null;
    return {
      ...run,
      org_slug: store.organization.slug,
      org_name: store.organization.name,
      role_id: null,
      role_slug: null,
      role_name: null,
      agent_slug: store.agent.slug,
      agent_name: store.agent.name,
      agent_instructions_md: store.agent.instructions_md,
      agent_default_context_query: store.agent.default_context_query,
      agent_max_steps: store.agent.max_steps,
      model_config_slug: store.agent.model_config_slug,
    };
  }

  function run(strings, values) {
    const text = normalize(strings);

    if (text.includes("from agent_definitions") && text.includes("agent_definitions.slug =")) {
      const [orgId, slug] = values;
      return orgId === store.agent.org_id && slug === store.agent.slug ? [{ ...store.agent }] : [];
    }

    if (text.startsWith("insert into agent_run_steps")) {
      const [orgId, runId, , stepType, bodyMd, payloadJson] = values;
      const stepIndex = stepsFor(runId).reduce((max, step) => Math.max(max, step.step_index + 1), 0);
      const step = {
        id: `step-${(seq += 1)}`,
        org_id: orgId,
        run_id: runId,
        step_index: stepIndex,
        step_type: stepType,
        body_md: bodyMd,
        payload: JSON.parse(payloadJson),
        created_at: FIXED_NOW,
      };
      store.steps.push(step);
      return [step];
    }

    if (text.startsWith("insert into agent_runs")) {
      const [orgId, agentId, modelConfigId, sessionId, reqUserId, reqKeyId, inputMd, contextQuery, trustZone, allowedLabels, actorSnapshotJson, maxSteps, metadataJson] = values;
      const id = `run-${(seq += 1)}`;
      const runRow = {
        id,
        org_id: orgId,
        agent_id: agentId,
        model_config_id: modelConfigId,
        session_id: sessionId,
        requested_by_user_id: reqUserId,
        requested_by_key_id: reqKeyId,
        status: "queued",
        input_md: inputMd,
        context_query: contextQuery,
        result_md: "",
        error: null,
        trust_zone: trustZone,
        context_build_id: null,
        allowed_labels: allowedLabels,
        actor_snapshot: JSON.parse(actorSnapshotJson),
        max_steps: maxSteps,
        lease_owner: null,
        lease_expires_at: null,
        attempt_count: 0,
        last_error: null,
        started_at: null,
        completed_at: null,
        metadata: JSON.parse(metadataJson),
        created_at: FIXED_NOW,
        updated_at: FIXED_NOW,
      };
      store.runs.set(id, runRow);
      return [{ ...runRow }];
    }

    if (text.includes("update agent_runs set") && text.includes("status = 'running'")) {
      const [limit, workerId] = values;
      const claimed = [];
      for (const runRow of store.runs.values()) {
        if (claimed.length >= limit) break;
        const leaseFree = runRow.lease_expires_at == null;
        if (runRow.status === "queued" && leaseFree) {
          runRow.status = "running";
          runRow.lease_owner = workerId;
          runRow.lease_expires_at = "2026-01-01T00:05:00.000Z";
          runRow.attempt_count += 1;
          runRow.started_at ??= FIXED_NOW;
          claimed.push({ ...runRow });
        }
      }
      return claimed;
    }

    if (text.includes("update agent_runs set") && text.includes("completed_at = now()")) {
      const status = values[0];
      const resultMd = values[1];
      const error = values[2];
      const runId = values[5];
      const workerId = values[6];
      const runRow = store.runs.get(runId);
      if (!runRow || runRow.lease_owner !== workerId) return [];
      runRow.status = status;
      runRow.result_md = resultMd;
      runRow.error = error;
      runRow.last_error = error;
      runRow.lease_owner = null;
      runRow.lease_expires_at = null;
      runRow.completed_at = FIXED_NOW;
      return [{ ...runRow }];
    }

    if (text.includes("set context_build_id")) {
      const [contextBuildId, runId] = values;
      const runRow = store.runs.get(runId);
      if (runRow) runRow.context_build_id = contextBuildId;
      return [];
    }

    if (text.startsWith("select") && text.includes("join organizations on organizations.id = agent_runs.org_id")) {
      const row = loadRow(values[0]);
      return row ? [row] : [];
    }

    throw new Error(`unexpected agent-runtime SQL: ${text}`);
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
    };
  }

  return { sql, store, stepsFor };
}

function makeUserActor() {
  const organization = { id: "org-1", slug: "acme", name: "Acme", status: "active" };
  const capabilities = {
    canCreateDocs: true,
    canUpdateDocs: true,
    canReadAudit: true,
    canManageOrg: true,
    canManageKeys: true,
    canManageModels: true,
    canReadSessions: true,
    canWriteSessions: true,
    canProposeMemory: true,
    canReviewMemoryProposals: true,
    canManageSources: true,
    canExecuteAgents: true,
  };
  return {
    actorType: "user",
    organization,
    userAuth: {
      user: { id: "user-1", email: "u@acme.dev", name: "U", status: "active", email_verified_at: "2026-01-01T00:00:00.000Z" },
      organization: { id: "org-1", slug: "acme", name: "Acme" },
      membership: { org_id: "org-1", org_slug: "acme", org_name: "Acme", org_status: "active", role: "admin", status: "active" },
      allowedLabels: ["public", "internal", "restricted"],
      capabilities: { ...capabilities, canManageMembers: true },
    },
    allowedLabels: ["public", "internal", "restricted"],
    capabilities,
  };
}

function setup() {
  const fake = makeRuntimeSql();
  globalThis.__fakeSql = fake.sql;
  return fake;
}

test("enqueue -> claim -> complete drives a run to succeeded with a full step ledger", async () => {
  const { store, stepsFor } = setup();
  const actor = makeUserActor();

  const queued = await runtime.enqueueAgentRun(actor, {
    agent_slug: "summarizer",
    input_md: "Summarize the quarterly report.",
    context_query: "quarterly report",
  });
  assert.equal(queued.status, "queued");
  assert.equal(store.runs.get(queued.id)?.status, "queued");

  const packets = await runtime.claimAgentRunsForRuntime({ workerId: "worker-1", limit: 10 });
  assert.equal(packets.length, 1);
  assert.equal(packets[0].run.id, queued.id);
  assert.equal(store.runs.get(queued.id)?.status, "running");
  assert.equal(store.runs.get(queued.id)?.lease_owner, "worker-1");
  assert.equal(store.runs.get(queued.id)?.attempt_count, 1);

  const completed = await runtime.completeAgentRunFromRuntime({
    runId: queued.id,
    workerId: "worker-1",
    status: "succeeded",
    resultMd: "Here is the summary.",
  });
  assert.equal(completed.status, "succeeded");
  assert.equal(store.runs.get(queued.id)?.lease_owner, null);

  const stepTypes = stepsFor(queued.id).map((step) => step.step_type);
  assert.deepEqual(stepTypes, ["queued", "context_build", "complete"]);
});

test("double-complete of a succeeded run is a no-op (no duplicate step)", async () => {
  const { store, stepsFor } = setup();
  const actor = makeUserActor();

  const queued = await runtime.enqueueAgentRun(actor, { agent_slug: "summarizer", input_md: "Do the thing." });
  await runtime.claimAgentRunsForRuntime({ workerId: "worker-1", limit: 10 });
  await runtime.completeAgentRunFromRuntime({ runId: queued.id, workerId: "worker-1", status: "succeeded", resultMd: "done" });
  const stepsAfterFirst = stepsFor(queued.id).length;

  const replay = await runtime.completeAgentRunFromRuntime({
    runId: queued.id,
    workerId: "worker-1",
    status: "succeeded",
    resultMd: "done again",
  });
  assert.equal(replay.status, "succeeded");
  assert.equal(replay.result_md, "done", "terminal run is returned as-is, not re-written");
  assert.equal(stepsFor(queued.id).length, stepsAfterFirst, "replay must not append another step");
});

test("completing with a mismatched lease owner throws and writes no step", async () => {
  const { store, stepsFor } = setup();
  const actor = makeUserActor();

  const queued = await runtime.enqueueAgentRun(actor, { agent_slug: "summarizer", input_md: "Lease guard." });
  await runtime.claimAgentRunsForRuntime({ workerId: "worker-1", limit: 10 });
  const stepsBefore = stepsFor(queued.id).length;

  await assert.rejects(
    () =>
      runtime.completeAgentRunFromRuntime({
        runId: queued.id,
        workerId: "worker-2",
        status: "succeeded",
        resultMd: "stolen",
      }),
    /agent_run_lease_mismatch/,
  );

  assert.equal(store.runs.get(queued.id)?.status, "running", "run stays running after a rejected complete");
  assert.equal(store.runs.get(queued.id)?.lease_owner, "worker-1");
  assert.equal(stepsFor(queued.id).length, stepsBefore, "mismatched complete must not append a step");
});
