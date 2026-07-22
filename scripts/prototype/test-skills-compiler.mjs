#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const VIRTUAL = {
  "@/lib/db": "export function getSql(){ return globalThis.__fakeSql; }",
  "@/lib/core/admin-auth": "export async function authenticateAdminRequest(){ return globalThis.__adminAuthResult; }",
  "@/lib/core/actor-auth": "export async function authenticateFregeActor(){ return globalThis.__actorAuthResult; }",
  "@/lib/core/model-gateway": "export async function invokeModel(input){ return globalThis.__invokeModel(input); }",
  "@/lib/core/brain": `
    export async function createMemoryProposal(actor, input){ return globalThis.__createMemoryProposal(actor, input); }
    export async function getBrainSession(actor, id){ return globalThis.__getBrainSession(actor, id); }
    export function slugifyBrain(value){ return value.trim().toLowerCase().replace(/\\.md$/i, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "page"; }
  `,
  "@/lib/core/org-guard": "export function assertActiveHumanOrg(){ return null; }",
  "@/lib/core/request-guards": `
    export function assertSafeBrowserMutation(){ return null; }
    export async function readJson(req){ try { return { ok: true, value: await req.json() }; } catch { return { ok: false, response: Response.json({ error: "invalid_json" }, { status: 400 }) }; } }
    export function routeError(){ return Response.json({ error: "internal" }, { status: 500 }); }
  `,
  "@/lib/core/telemetry": "export async function logTelemetryEvent(input){ globalThis.__telemetryEvents.push(input); }",
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

const skills = await import(pathToFileURL(path.join(rootDir, "lib/core/skills.ts")).href);
const compileRoute = await import(pathToFileURL(path.join(rootDir, "app/api/v1/skills/compile/route.ts")).href);
const materialsRoute = await import(pathToFileURL(path.join(rootDir, "app/api/v1/materials/route.ts")).href);
const rollbackRoute = await import(pathToFileURL(path.join(rootDir, "app/api/v1/skills/[slug]/rollback/route.ts")).href);
const brain = await import(`${pathToFileURL(path.join(rootDir, "lib/core/brain.ts")).href}?actual=1`);

const ORG_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000002";
const MATERIAL_ID = "30000000-0000-4000-8000-000000000003";
const EVENT_ID = "40000000-0000-4000-8000-000000000004";
const SKILL_ID = "50000000-0000-4000-8000-000000000005";
const PROPOSAL_ID = "60000000-0000-4000-8000-000000000006";
const FIXED_NOW = "2026-07-22T00:00:00.000Z";

function normalize(strings) {
  return strings.join(" ? ").toLowerCase().replace(/\s+/g, " ").trim();
}

function makeAdmin() {
  return {
    user: { id: USER_ID, email: "admin@example.com", name: "Admin", status: "active", email_verified_at: FIXED_NOW },
    organization: { id: ORG_ID, slug: "acme", name: "Acme" },
    membership: { org_id: ORG_ID, org_slug: "acme", org_name: "Acme", org_status: "active", role: "admin", status: "active" },
    allowedLabels: ["public", "internal", "restricted"],
    capabilities: {
      canManageOrg: true,
      canManageMembers: true,
      canManageKeys: true,
      canManageModels: true,
      canReadAudit: true,
      canReadSessions: true,
      canWriteSessions: true,
      canProposeMemory: true,
      canReviewMemoryProposals: true,
      canManageSources: true,
      canExecuteAgents: true,
    },
  };
}

function sqlPromise(run) {
  return function sql(strings, ...values) {
    return Promise.resolve().then(() => run(normalize(strings), values));
  };
}

function makeCompileSql() {
  const state = {
    materials: new Map([[MATERIAL_ID, {
      id: MATERIAL_ID,
      source_type: "markdown_upload",
      content_md: "Deploy with the release script, then verify health.",
      provenance: { source_description: "Release notes", author: "Ops", date: "2026-07-22" },
      occurred_at: FIXED_NOW,
    }]]),
    eventIds: new Set([EVENT_ID]),
    approvedSkills: [],
    staleUpdates: [],
    compileResults: [],
    forceCitationMissing: false,
  };

  const sql = sqlPromise((text, values) => {
    if (text.includes("from raw_materials") && text.includes("org_id") && text.includes("content_md")) {
      const row = state.materials.get(values[0]);
      return row && values[1] === ORG_ID ? [{ ...row }] : [];
    }
    if (text.startsWith("select id from raw_materials")) {
      return !state.forceCitationMissing && state.materials.has(values[0]) ? [{ id: values[0] }] : [];
    }
    if (text.startsWith("select id from brain_session_events")) {
      return state.eventIds.has(values[0]) ? [{ id: values[0] }] : [];
    }
    if (text.startsWith("select id from brain_pages") && !text.includes("join lateral")) return [];
    if (text.includes("from brain_pages") && text.includes("join lateral")) return state.approvedSkills.map((skill) => ({ ...skill }));
    if (text.includes("from org_model_configs")) return [{ slug: "compiler" }];
    if (text.startsWith("update brain_pages set stale_flagged_at")) {
      state.staleUpdates.push({ reason: values[0], id: values[1], orgId: values[2] });
      return [];
    }
    if (text.startsWith("update raw_materials set compiled_at")) {
      state.compileResults.push({ result: values[0], id: values[1] });
      return [];
    }
    if (text.includes("union all select id from raw_materials")) return [];
    throw new Error(`unexpected compiler SQL: ${text}`);
  });

  return { sql, state };
}

function request(body) {
  return new Request("http://localhost/api/v1/skills/compile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function compilerOutput(overrides = {}) {
  return {
    repeatable: true,
    reason: "",
    skill: {
      slug: "release-check",
      title: "Release check",
      description: "Deploy and verify the service.",
      scope: ["ops"],
      confidence: 0.9,
      body_md: "## Scope\n\nProduction releases.[^1]\n\n## Instructions\n\nRun the release script, then verify health.[^1]",
      citations: [{ ref: `material:${MATERIAL_ID}`, label: "Release notes" }],
    },
    contradictions: [],
    ...overrides,
  };
}

function setupCompile() {
  const fake = makeCompileSql();
  globalThis.__fakeSql = fake.sql;
  globalThis.__adminAuthResult = { ok: true, auth: makeAdmin() };
  globalThis.__telemetryEvents = [];
  globalThis.__getBrainSession = async () => null;
  globalThis.__createdProposals = [];
  globalThis.__createMemoryProposal = async (_actor, input) => {
    globalThis.__createdProposals.push(input);
    return { id: PROPOSAL_ID };
  };
  return fake;
}

test("citation validation resolves session events/materials and reports bad refs", async () => {
  const { sql } = setupCompile();
  assert.deepEqual(await skills.validateCitations([
    { ref: `session-event:${EVENT_ID}` },
    { ref: `material:${MATERIAL_ID}` },
  ], sql), { ok: true, unresolved: [] });
  assert.deepEqual(await skills.validateCitations([{ ref: "material:not-a-uuid" }], sql), {
    ok: false,
    unresolved: ["material:not-a-uuid"],
  });
});

test("compile maps model output to proposal_filed, nothing_found, and failed", async () => {
  process.env.FREGE_SKILLS_COMPILER = "true";
  const filed = setupCompile();
  globalThis.__invokeModel = async () => ({ content: JSON.stringify(compilerOutput()) });
  let response = await compileRoute.POST(request({ material_id: MATERIAL_ID }));
  assert.deepEqual(await response.json(), { result: "proposal_filed", proposal_id: PROPOSAL_ID });
  assert.equal(globalThis.__createdProposals[0].proposal_type, "skill_create");
  assert.match(globalThis.__createdProposals[0].body_md, /\[\^1\]: Release notes/);
  assert.equal(filed.state.compileResults.at(-1).result, "proposal_filed");

  const nothing = setupCompile();
  globalThis.__invokeModel = async () => ({ content: JSON.stringify(compilerOutput({
    repeatable: false,
    reason: "Only a one-off status update",
    skill: null,
  })) });
  response = await compileRoute.POST(request({ material_id: MATERIAL_ID }));
  assert.deepEqual(await response.json(), { result: "nothing_found", reason: "Only a one-off status update" });
  assert.equal(nothing.state.compileResults.at(-1).result, "nothing_found");

  const failed = setupCompile();
  failed.state.forceCitationMissing = true;
  globalThis.__invokeModel = async () => ({ content: JSON.stringify(compilerOutput()) });
  response = await compileRoute.POST(request({ material_id: MATERIAL_ID }));
  assert.deepEqual(await response.json(), {
    result: "failed",
    reason: `unresolvable_citations:material:${MATERIAL_ID}`,
  });
  assert.equal(failed.state.compileResults.at(-1).result, "failed");
  assert.equal(globalThis.__createdProposals.length, 0);
});

test("compile flags an approved skill stale when the single model pass says yes", async () => {
  process.env.FREGE_SKILLS_COMPILER = "true";
  const fake = setupCompile();
  fake.state.approvedSkills.push({
    id: SKILL_ID,
    slug: "old-release",
    title: "Old release",
    body_md: "Old instructions",
    frontmatter: {},
  });
  globalThis.__invokeModel = async () => ({ content: JSON.stringify(compilerOutput({
    repeatable: false,
    reason: "No new skill",
    skill: null,
    contradictions: [{ skill_slug: "old-release", contradicts: true, reason: "The release command changed" }],
  })) });

  const response = await compileRoute.POST(request({ material_id: MATERIAL_ID }));
  assert.equal((await response.json()).result, "nothing_found");
  assert.deepEqual(fake.state.staleUpdates, [{
    reason: "The release command changed",
    id: SKILL_ID,
    orgId: ORG_ID,
  }]);
});

function skillProposal(overrides = {}) {
  return {
    id: PROPOSAL_ID,
    org_id: ORG_ID,
    proposal_type: "skill_create",
    target_page_id: null,
    slug: "release-check",
    title: "Release check",
    body_md: "# Release check\n\nDo the thing.[^1]",
    summary: "Release safely",
    trust_zone: "green",
    source_ids: [],
    session_id: null,
    evidence_event_ids: [],
    status: "pending",
    created_by_user_id: USER_ID,
    created_by_key_id: null,
    reviewer_user_id: null,
    resolved_at: null,
    metadata: {
      citations: [{ ref: `material:${MATERIAL_ID}` }],
      confidence: 0.9,
      source_refs: [`material:${MATERIAL_ID}`],
      compiled_body_md: "# Release check\n\nDo the thing.[^1]",
    },
    created_at: FIXED_NOW,
    ...overrides,
  };
}

function makeProposalSql(proposals, { existingSkill = false } = {}) {
  const state = {
    proposals: new Map(proposals.map((proposal) => [proposal.id, proposal])),
    pageInserts: [],
    revisionInserts: [],
  };
  const sql = sqlPromise((text, values) => {
    if (text.startsWith("update memory_proposals set status = ?") && text.includes("status = 'pending'")) {
      const [status, reviewerId, proposalId, orgId] = values;
      const proposal = state.proposals.get(proposalId);
      if (!proposal || proposal.org_id !== orgId || proposal.status !== "pending") return [];
      proposal.status = status;
      proposal.reviewer_user_id = reviewerId;
      proposal.resolved_at = FIXED_NOW;
      return [{ ...proposal }];
    }
    if (text.startsWith("update memory_proposals set status = 'pending'")) return [];
    if (text.startsWith("select id, artifact_type from brain_pages")) return existingSkill ? [{ id: SKILL_ID, artifact_type: "skill" }] : [];
    if (text.startsWith("update brain_pages set title =")) return [];
    if (text.startsWith("insert into brain_pages")) {
      state.pageInserts.push(values);
      return [{ id: SKILL_ID }];
    }
    if (text.startsWith("insert into brain_page_revisions")) {
      state.revisionInserts.push(values);
      return [{ id: "70000000-0000-4000-8000-000000000007", revision_number: 1 }];
    }
    if (text.includes("from memory_proposals")) {
      const proposal = state.proposals.get(values[0]);
      return proposal && proposal.org_id === values[1] ? [{ ...proposal }] : [];
    }
    throw new Error(`unexpected proposal SQL: ${text}`);
  });
  return { sql, state };
}

test("skill proposal accept creates a skill page; reject emits skill.corrected", async () => {
  globalThis.__telemetryEvents = [];
  const accepted = makeProposalSql([skillProposal()]);
  globalThis.__fakeSql = accepted.sql;
  const result = await brain.resolveMemoryProposal(makeAdmin(), { proposalId: PROPOSAL_ID, action: "accept" });
  assert.equal(result.proposal.status, "accepted");
  assert.equal(result.accepted_resource.page_id, SKILL_ID);
  assert.equal(accepted.state.pageInserts.length, 1);
  assert.equal(accepted.state.revisionInserts.length, 1);

  const rejectedId = "80000000-0000-4000-8000-000000000008";
  const rejected = makeProposalSql([skillProposal({
    id: rejectedId,
    metadata: { review_reason: "Procedure is too broad" },
  })]);
  globalThis.__fakeSql = rejected.sql;
  await brain.resolveMemoryProposal(makeAdmin(), { proposalId: rejectedId, action: "reject" });
  const corrected = globalThis.__telemetryEvents.at(-1);
  assert.equal(corrected.action, "skill.corrected");
  assert.equal(corrected.metadata.action, "reject");
  assert.equal(corrected.metadata.reason, "Procedure is too broad");
  assert.equal(corrected.metadata.proposal.id, rejectedId);
});

test("rollback files a governed proposal and acceptance emits rollback telemetry", async () => {
  process.env.FREGE_SKILLS_COMPILER = "true";
  globalThis.__actorAuthResult = {
    ok: true,
    actor: {
      actorType: "user",
      userAuth: makeAdmin(),
      organization: { id: ORG_ID, slug: "acme", name: "Acme", status: "active" },
      allowedLabels: ["public", "internal", "restricted"],
      capabilities: makeAdmin().capabilities,
    },
  };
  globalThis.__createdProposals = [];
  globalThis.__createMemoryProposal = async (_actor, input) => {
    globalThis.__createdProposals.push(input);
    return { id: PROPOSAL_ID };
  };
  globalThis.__fakeSql = sqlPromise((text) => {
    if (text.includes("current_revision.revision_number as from_revision")) {
      return [{
        id: SKILL_ID,
        slug: "release-check",
        title: "Release check",
        source_id: null,
        trust_zone: "green",
        frontmatter: { confidence: 0.9 },
        from_revision: 2,
        to_revision: 1,
        body_md: "# Release check v1",
        summary: "Original release check",
      }];
    }
    throw new Error(`unexpected rollback SQL: ${text}`);
  });

  const response = await rollbackRoute.POST(new Request("http://localhost/api/v1/skills/release-check/rollback?org_slug=acme", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ revision_number: 1 }),
  }), { params: Promise.resolve({ slug: "release-check" }) });
  assert.equal(response.status, 201);
  assert.equal(globalThis.__createdProposals[0].proposal_type, "skill_update");
  assert.deepEqual(globalThis.__createdProposals[0].metadata, {
    confidence: 0.9,
    correction_action: "rollback",
    from_revision: 2,
    to_revision: 1,
  });

  globalThis.__telemetryEvents = [];
  const accepted = makeProposalSql([skillProposal({
    proposal_type: "skill_update",
    body_md: "# Release check v1",
    metadata: { correction_action: "rollback", from_revision: 2, to_revision: 1 },
  })], { existingSkill: true });
  globalThis.__fakeSql = accepted.sql;
  await brain.resolveMemoryProposal(makeAdmin(), { proposalId: PROPOSAL_ID, action: "accept" });
  assert.deepEqual(globalThis.__telemetryEvents.at(-1).metadata, {
    action: "rollback",
    from_revision: 2,
    to_revision: 1,
  });
});

test("feature flag off makes both compiler routes invisible", async () => {
  delete process.env.FREGE_SKILLS_COMPILER;
  const compile = await compileRoute.POST(request({ material_id: MATERIAL_ID }));
  const material = await materialsRoute.POST(new Request("http://localhost/api/v1/materials", { method: "POST" }));
  const rollback = await rollbackRoute.POST(new Request("http://localhost/api/v1/skills/release-check/rollback", { method: "POST" }), { params: Promise.resolve({ slug: "release-check" }) });
  assert.equal(compile.status, 404);
  assert.equal(material.status, 404);
  assert.equal(rollback.status, 404);
});
