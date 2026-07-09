#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// billing-view-core.ts is pure but lives behind the TypeScript `@/*` path alias
// convention used across lib/core. Register the same in-process resolve hook as
// the other core tests so the real module can be imported and exercised.
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function resolveAlias(specifier) {
  const base = path.join(rootDir, specifier.slice(2));
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return `${base}.ts`;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return { url: pathToFileURL(resolveAlias(specifier)).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { resolveBillingPanelView, billingSummaryFromRow, toIsoString } = await import(
  pathToFileURL(path.join(rootDir, "lib/core/billing-view-core.ts")).href
);

function viewInput(overrides = {}) {
  return {
    emailVerified: true,
    orgStatus: "pending",
    subscriptionStatus: null,
    hasLiveSubscription: false,
    hasStripeCustomer: false,
    ...overrides,
  };
}

// ── resolveBillingPanelView: which panel an org sees ──

test("active org with no subscription record gets the active view, not the plan picker (founder repro)", () => {
  const view = resolveBillingPanelView(viewInput({ orgStatus: "active" }));
  assert.deepEqual(view, { kind: "active", stripeManaged: false });
});

test("active org with a Stripe customer and subscription is active and Stripe-managed", () => {
  const view = resolveBillingPanelView(
    viewInput({ orgStatus: "active", subscriptionStatus: "active", hasStripeCustomer: true }),
  );
  assert.deepEqual(view, { kind: "active", stripeManaged: true });
});

test("a live Stripe subscription alone marks the org active and Stripe-managed", () => {
  const view = resolveBillingPanelView(
    viewInput({ subscriptionStatus: "trialing", hasLiveSubscription: true }),
  );
  assert.deepEqual(view, { kind: "active", stripeManaged: true });
});

test("dev-seed shape (subscription_status set, no Stripe customer) is active but staff-managed", () => {
  const view = resolveBillingPanelView(viewInput({ orgStatus: "active", subscriptionStatus: "active" }));
  assert.deepEqual(view, { kind: "active", stripeManaged: false });
});

for (const status of ["past_due", "canceled", "incomplete"]) {
  test(`a ${status} subscription keeps the dashboard (Stripe portal is the recovery surface)`, () => {
    const view = resolveBillingPanelView(
      viewInput({ orgStatus: "suspended", subscriptionStatus: status, hasStripeCustomer: true }),
    );
    assert.deepEqual(view, { kind: "active", stripeManaged: true });
  });
}

test("never-billed org with a verified email gets the checkout view", () => {
  const view = resolveBillingPanelView(viewInput());
  assert.equal(view.kind, "checkout");
  assert.equal(view.status.label, "ready for billing");
  assert.match(view.status.detail, /checkout with Stripe/);
});

test("never-billed org with an unverified email is told to verify first", () => {
  const view = resolveBillingPanelView(viewInput({ emailVerified: false }));
  assert.equal(view.kind, "checkout");
  assert.equal(view.status.label, "email pending");
  assert.match(view.status.detail, /Verify your email/);
});

test("missing org status (summary not loaded yet) falls back to the checkout view", () => {
  const view = resolveBillingPanelView(viewInput({ orgStatus: undefined }));
  assert.equal(view.kind, "checkout");
});

// ── billingSummaryFromRow: the summary route's billing payload ──

test("billingSummaryFromRow returns null when the org has no billing row", () => {
  assert.equal(billingSummaryFromRow(undefined), null);
  assert.equal(billingSummaryFromRow(null), null);
});

test("billingSummaryFromRow exposes has_stripe_customer and ISO dates", () => {
  const payload = billingSummaryFromRow({
    plan: "team",
    billing_interval: "annual",
    seats: 5,
    subscription_status: "active",
    current_period_end: new Date("2026-08-01T00:00:00.000Z"),
    updated_at: "2026-07-01T12:00:00.000Z",
    stripe_customer_id: "cus_123",
  });
  assert.deepEqual(payload, {
    plan: "team",
    billing_interval: "annual",
    seats: 5,
    subscription_status: "active",
    current_period_end: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-07-01T12:00:00.000Z",
    has_stripe_customer: true,
  });
});

test("billingSummaryFromRow reports has_stripe_customer false for staff-activated orgs", () => {
  const payload = billingSummaryFromRow({
    plan: "solo",
    billing_interval: "monthly",
    seats: 1,
    subscription_status: null,
    current_period_end: null,
    updated_at: null,
    stripe_customer_id: null,
  });
  assert.equal(payload.has_stripe_customer, false);
  assert.equal(payload.subscription_status, null);
  assert.equal(payload.current_period_end, null);
});

test("toIsoString normalizes dates and passes through unparseable strings", () => {
  assert.equal(toIsoString(null), null);
  assert.equal(toIsoString(undefined), null);
  assert.equal(toIsoString(new Date("2026-07-09T00:00:00.000Z")), "2026-07-09T00:00:00.000Z");
  assert.equal(toIsoString("2026-07-09"), new Date("2026-07-09").toISOString());
  assert.equal(toIsoString("not-a-date"), "not-a-date");
});
