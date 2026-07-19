#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";

const { activationViewFromEvidence, ACTIVATION_TARGET_MINUTES } = await import(
  pathToFileURL(path.join(process.cwd(), "lib/core/activation-view.ts")).href
);

const START = "2026-07-19T12:00:00.000Z";

function at(minutes) {
  return new Date(new Date(START).getTime() + minutes * 60_000).toISOString();
}

function evidence(overrides = {}) {
  return {
    account_created_at: START,
    email_verified_at: null,
    billing_active_at: null,
    api_key_issued_at: null,
    client_call_observed_at: null,
    source_imported_at: null,
    cited_context_built_at: null,
    proposal_approved_at: null,
    ...overrides,
  };
}

test("activation view exposes the ordered eight-step first-run path", () => {
  const view = activationViewFromEvidence(evidence(), new Date(at(3)));

  assert.equal(ACTIVATION_TARGET_MINUTES, 15);
  assert.equal(view.state, "in_progress");
  assert.equal(view.complete_count, 1);
  assert.equal(view.completed_in_target_count, 1);
  assert.equal(view.total_count, 8);
  assert.equal(view.next_milestone_id, "email_verified");
  assert.equal(view.window.open, true);
  assert.equal(view.window.remaining_minutes, 12);
  assert.deepEqual(
    view.milestones.map((milestone) => milestone.id),
    [
      "account_created",
      "email_verified",
      "billing_active",
      "api_key_issued",
      "client_call_observed",
      "source_imported",
      "cited_context_built",
      "proposal_approved",
    ],
  );
});

test("completion timestamps are normalized and scored against the 15-minute boundary", () => {
  const view = activationViewFromEvidence(
    evidence({
      email_verified_at: at(2),
      billing_active_at: at(4.5),
      api_key_issued_at: at(6),
      client_call_observed_at: at(8),
      source_imported_at: at(10),
      cited_context_built_at: at(15),
      proposal_approved_at: at(16),
    }),
    new Date(at(20)),
  );

  assert.equal(view.state, "complete");
  assert.equal(view.complete_count, 8);
  assert.equal(view.completed_in_target_count, 7);
  assert.equal(view.next_milestone_id, null);
  assert.equal(view.activated_at, at(16));
  assert.equal(view.window.open, false);
  assert.equal(view.milestones.find((milestone) => milestone.id === "billing_active")?.minutes_from_account, 4.5);
  assert.equal(view.milestones.find((milestone) => milestone.id === "cited_context_built")?.within_first_15_minutes, true);
  assert.equal(view.milestones.find((milestone) => milestone.id === "proposal_approved")?.within_first_15_minutes, false);
});

test("unfinished activation continues after the target instead of being marked failed", () => {
  const view = activationViewFromEvidence(
    evidence({ email_verified_at: at(4), billing_active_at: at(8) }),
    new Date(at(90)),
  );

  assert.equal(view.state, "continuing");
  assert.equal(view.window.open, false);
  assert.equal(view.window.remaining_minutes, 0);
  assert.equal(view.next_milestone_id, "api_key_issued");
});

test("invalid or missing evidence is never treated as completion", () => {
  const view = activationViewFromEvidence(
    evidence({ email_verified_at: "not-a-date", account_created_at: null }),
    new Date(at(2)),
  );

  assert.equal(view.complete_count, 0);
  assert.equal(view.completed_in_target_count, 0);
  assert.equal(view.window.started_at, null);
  assert.equal(view.window.ends_at, null);
  assert.equal(view.window.open, false);
  assert.equal(view.state, "continuing");
});
