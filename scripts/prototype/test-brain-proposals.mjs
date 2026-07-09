#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// resolveMemoryProposal lives in lib/core/brain.ts, which is not dependency-injected:
// it calls getSql() from "@/lib/db" directly. Its only other value imports
// (brain-links, types) are import-free pure modules, so — same trick as
// test-agent-runtime.mjs — we resolve the "@/" alias for Node and swap "@/lib/db"
// for a virtual stub whose getSql() returns globalThis.__fakeSql.
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const VIRTUAL = {
  "@/lib/db": "export function getSql(){ return globalThis.__fakeSql; }",
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

const brain = await import(pathToFileURL(path.join(rootDir, "lib/core/brain.ts")).href);

const FIXED_NOW = "2026-01-01T00:00:00.000Z";

function normalize(strings) {
  return strings.join(" ? ").toLowerCase().replace(/\s+/g, " ").trim();
}

// In-memory stand-in for the memory_proposals / brain_sources SQL that
// resolveMemoryProposal (source_create path) issues.
function makeProposalSql(seedProposals = []) {
  const store = {
    proposals: new Map(seedProposals.map((proposal) => [proposal.id, proposal])),
    sources: [],
  };
  const log = { sourceInserts: 0 };

  function run(strings, values) {
    const text = normalize(strings);

    // Claim: update ... where id/org and status = 'pending' returning *
    if (text.startsWith("update memory_proposals set status = ?") && text.includes("status = 'pending'")) {
      const [status, reviewerId, proposalId, orgId] = values;
      const proposal = store.proposals.get(proposalId);
      if (!proposal || proposal.org_id !== orgId || proposal.status !== "pending") return [];
      proposal.status = status;
      proposal.reviewer_user_id = reviewerId;
      proposal.resolved_at = FIXED_NOW;
      return [{ ...proposal }];
    }

    // Revert after failed side effects: set status = 'pending' where id/org.
    if (text.startsWith("update memory_proposals set status = 'pending'")) {
      const [proposalId, orgId] = values;
      const proposal = store.proposals.get(proposalId);
      if (proposal && proposal.org_id === orgId) {
        proposal.status = "pending";
        proposal.reviewer_user_id = null;
        proposal.resolved_at = null;
      }
      return [];
    }

    if (text.startsWith("select") && text.includes("from memory_proposals")) {
      const [proposalId, orgId] = values;
      const proposal = store.proposals.get(proposalId);
      return proposal && proposal.org_id === orgId ? [{ ...proposal }] : [];
    }

    if (text.startsWith("insert into brain_sources")) {
      const [orgId, slug, name] = values;
      log.sourceInserts += 1;
      const source = { id: `src-${log.sourceInserts}`, org_id: orgId, slug, name };
      store.sources.push(source);
      return [{ id: source.id, slug: source.slug, name: source.name }];
    }

    throw new Error(`unexpected brain-proposal SQL: ${text}`);
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

  return { sql, store, log };
}

function makeReviewer() {
  return {
    user: { id: "user-rev", email: "rev@acme.dev", name: "Reviewer", status: "active", email_verified_at: FIXED_NOW },
    organization: { id: "org-1", slug: "acme", name: "Acme", status: "active" },
    membership: { org_id: "org-1", org_slug: "acme", org_name: "Acme", org_status: "active", role: "admin", status: "active" },
    allowedLabels: ["public", "internal", "restricted"],
    capabilities: { canReviewMemoryProposals: true },
  };
}

function sourceProposal(overrides = {}) {
  return {
    id: "prop-1",
    org_id: "org-1",
    proposal_type: "source_create",
    target_page_id: null,
    slug: "meeting-notes",
    title: "Meeting notes",
    body_md: "Body",
    summary: "Summary",
    trust_zone: "green",
    status: "pending",
    session_id: null,
    source_ids: [],
    metadata: {},
    created_by_user_id: "user-author",
    created_by_key_id: null,
    reviewer_user_id: null,
    resolved_at: null,
    created_at: FIXED_NOW,
    ...overrides,
  };
}

function setup(seedProposals) {
  const fake = makeProposalSql(seedProposals);
  globalThis.__fakeSql = fake.sql;
  return fake;
}

test("accepting a pending source proposal claims it and applies side effects once", async () => {
  const { store, log } = setup([sourceProposal()]);

  const result = await brain.resolveMemoryProposal(makeReviewer(), { proposalId: "prop-1", action: "accept" });
  assert.equal(result.proposal.status, "accepted");
  assert.equal(result.proposal.reviewer_user_id, "user-rev");
  assert.equal(result.accepted_resource?.slug, "meeting-notes");
  assert.equal(result.proposal.body_md, undefined, "response proposal must not leak body_md");
  assert.equal(store.proposals.get("prop-1")?.status, "accepted");
  assert.equal(log.sourceInserts, 1);
});

test("second accept of the same proposal returns the resolved outcome without re-applying side effects", async () => {
  const { log } = setup([sourceProposal()]);
  const reviewer = makeReviewer();

  await brain.resolveMemoryProposal(reviewer, { proposalId: "prop-1", action: "accept" });
  // A concurrent double-accept loses the pending-claim UPDATE and must not
  // insert the source a second time.
  const replay = await brain.resolveMemoryProposal(reviewer, { proposalId: "prop-1", action: "accept" });

  assert.equal(replay.proposal.status, "accepted");
  assert.equal(replay.accepted_resource, null, "loser of the claim race applies no side effects");
  assert.equal(log.sourceInserts, 1, "brain_sources must be written exactly once across both accepts");
});

test("accept after reject returns the rejected outcome and applies no side effects", async () => {
  const { log } = setup([sourceProposal()]);
  const reviewer = makeReviewer();

  const rejected = await brain.resolveMemoryProposal(reviewer, { proposalId: "prop-1", action: "reject" });
  assert.equal(rejected.proposal.status, "rejected");
  assert.equal(log.sourceInserts, 0);

  const lateAccept = await brain.resolveMemoryProposal(reviewer, { proposalId: "prop-1", action: "accept" });
  assert.equal(lateAccept.proposal.status, "rejected", "already-resolved outcome is returned as-is");
  assert.equal(lateAccept.accepted_resource, null);
  assert.equal(log.sourceInserts, 0, "late accept must not apply side effects");
});

test("failed accept side effects release the claim so the proposal can be retried", async () => {
  // source_create with no slug: acceptSourceProposal throws proposal_slug_required
  // after the claim has already flipped the row.
  const { store, log } = setup([sourceProposal({ slug: null })]);

  await assert.rejects(
    () => brain.resolveMemoryProposal(makeReviewer(), { proposalId: "prop-1", action: "accept" }),
    /proposal_slug_required/,
  );

  const proposal = store.proposals.get("prop-1");
  assert.equal(proposal?.status, "pending", "claim must be released after failed side effects");
  assert.equal(proposal?.reviewer_user_id, null);
  assert.equal(log.sourceInserts, 0);
});

test("resolving an unknown proposal id throws memory_proposal_not_found", async () => {
  setup([]);
  await assert.rejects(
    () => brain.resolveMemoryProposal(makeReviewer(), { proposalId: "prop-missing", action: "accept" }),
    /memory_proposal_not_found/,
  );
});

test("a reviewer without canReviewMemoryProposals is rejected before any query", async () => {
  const { log } = setup([sourceProposal()]);
  const reviewer = makeReviewer();
  reviewer.capabilities = { canReviewMemoryProposals: false };

  await assert.rejects(
    () => brain.resolveMemoryProposal(reviewer, { proposalId: "prop-1", action: "accept" }),
    /memory_review_forbidden/,
  );
  assert.equal(log.sourceInserts, 0);
});
