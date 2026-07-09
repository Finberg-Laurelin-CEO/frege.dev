#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";

// billing-webhook-core.ts lands with branch B (harden-b-reliability). It is import-clean
// (only `import type` specifiers) and fully dependency-injected, so it can be imported
// directly and driven with an in-memory `sql` fake — same DI style as test-auth-flow.mjs.
// Until branch B merges the file will not exist; this test then validates at integration.
import { handleBillingWebhook } from "../../lib/core/billing-webhook-core.ts";

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

function normalize(strings) {
  return strings
    .join(" ? ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Minimal in-memory Postgres stand-in that understands only the handful of statements
// billing-webhook-core issues. Tagged-template calls return a thenable so `await sql`...``
// works, and the same objects can be batched through `sql.transaction([...])`.
function makeBillingSql(seed = {}) {
  const store = {
    webhookEvents: new Map(),
    orgBilling: new Map(Object.entries(seed.orgBilling ?? {})),
    organizations: new Map(Object.entries(seed.organizations ?? {})),
  };
  const log = { activations: 0, suspensions: 0, queries: [] };

  function billingBySubscription(subId) {
    return [...store.orgBilling.values()].filter((row) => row.stripe_subscription_id === subId);
  }

  function run(strings, values) {
    const text = normalize(strings);
    log.queries.push(text);

    if (text.startsWith("insert into stripe_webhook_events")) {
      const [eventId, type, eventCreated, receivedAt] = values;
      if (store.webhookEvents.has(eventId)) return [];
      store.webhookEvents.set(eventId, {
        event_id: eventId,
        type,
        event_created: eventCreated,
        status: "processing",
        received_at: receivedAt,
      });
      return [{ event_id: eventId }];
    }

    if (text.startsWith("select status from stripe_webhook_events")) {
      const row = store.webhookEvents.get(values[0]);
      return row ? [{ status: row.status }] : [];
    }

    if (text.includes("update stripe_webhook_events set status = 'processed'")) {
      const row = store.webhookEvents.get(values.at(-1));
      if (row) row.status = "processed";
      return [];
    }

    if (text.includes("update stripe_webhook_events set status = 'failed'")) {
      const row = store.webhookEvents.get(values.at(-1));
      if (row) row.status = "failed";
      return [];
    }

    if (text.includes("update stripe_webhook_events set status = 'processing'")) {
      // Stale-processing reclaim: guarded on status AND received_at, returns the
      // reclaimed row so only one concurrent retry wins.
      if (text.includes("received_at <")) {
        const [receivedAt, eventId, staleBefore] = values;
        const row = store.webhookEvents.get(eventId);
        if (!row || row.status !== "processing" || !(row.received_at < staleBefore)) return [];
        row.received_at = receivedAt;
        return [{ event_id: eventId }];
      }
      const row = store.webhookEvents.get(values.at(-1));
      if (row) {
        row.status = "processing";
        row.received_at = values[0];
      }
      return [];
    }

    if (text.startsWith("select last_event_created from org_billing")) {
      const [row] = billingBySubscription(values[0]);
      return row ? [{ last_event_created: row.last_event_created ?? null }] : [];
    }

    if (text.startsWith("insert into org_billing")) {
      const [orgId, customerId, subscriptionId, status, , seats, created] = values;
      const existing = store.orgBilling.get(orgId);
      if (existing && existing.last_event_created != null && existing.last_event_created > created) {
        return [];
      }
      store.orgBilling.set(orgId, {
        org_id: orgId,
        stripe_customer_id: customerId ?? existing?.stripe_customer_id ?? null,
        stripe_subscription_id: subscriptionId ?? existing?.stripe_subscription_id ?? null,
        subscription_status: status,
        seats: seats ?? existing?.seats ?? 1,
        last_event_created: created,
      });
      log.activations += 1;
      return [{ org_id: orgId }];
    }

    if (text.startsWith("update organizations set status = 'active'")) {
      const orgId = values[0];
      const org = store.organizations.get(orgId) ?? { id: orgId };
      org.status = "active";
      store.organizations.set(orgId, org);
      return [];
    }

    if (text.startsWith("update org_billing set subscription_status")) {
      const [status, created, subId] = values;
      const rows = billingBySubscription(subId).filter(
        (row) => row.last_event_created == null || row.last_event_created <= created,
      );
      for (const row of rows) {
        row.subscription_status = status;
        row.last_event_created = created;
      }
      return rows.map((row) => ({ org_id: row.org_id }));
    }

    if (text.startsWith("update organizations set status = 'suspended'")) {
      const [subId, created] = values;
      for (const row of billingBySubscription(subId)) {
        if (row.last_event_created === created) {
          const org = store.organizations.get(row.org_id) ?? { id: row.org_id };
          org.status = "suspended";
          store.organizations.set(row.org_id, org);
          log.suspensions += 1;
        }
      }
      return [];
    }

    if (text.startsWith("update signups")) return [];

    throw new Error(`unexpected billing SQL: ${text}`);
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
  sql.transaction = async (queries) => {
    const results = [];
    for (const query of queries) results.push(await query);
    return results;
  };

  return { sql, store, log };
}

function makeDeps(sql) {
  return {
    getSql: () => sql,
    constructEvent: (rawBody) => JSON.parse(rawBody),
    retrieveSubscription: async () => ({}),
    now: () => FIXED_NOW,
  };
}

function webhookInput(event) {
  return { rawBody: JSON.stringify(event), signature: "sig_test", webhookSecret: "whsec_test" };
}

function subscriptionUpdatedEvent({ id, created, orgId, subId, status = "active" }) {
  return {
    id,
    type: "customer.subscription.updated",
    created,
    data: {
      object: {
        id: subId,
        status,
        metadata: { org_id: orgId },
        customer: `cus_${orgId}`,
        items: { data: [{ quantity: 1, current_period_end: 1_700_000_000 }] },
      },
    },
  };
}

function subscriptionDeletedEvent({ id, created, orgId, subId }) {
  return {
    id,
    type: "customer.subscription.deleted",
    created,
    data: {
      object: { id: subId, status: "canceled", metadata: { org_id: orgId }, customer: `cus_${orgId}` },
    },
  };
}

test("same event id delivered twice activates the org exactly once (dedupe)", async () => {
  const { sql, store, log } = makeBillingSql();
  const deps = makeDeps(sql);
  const event = subscriptionUpdatedEvent({ id: "evt_dupe", created: 1000, orgId: "org-1", subId: "sub-1" });

  const first = await handleBillingWebhook(webhookInput(event), deps);
  const firstBody = await first.json();
  assert.equal(first.status, 200);
  assert.equal(firstBody.received, true);
  assert.notEqual(firstBody.deduped, true);

  const second = await handleBillingWebhook(webhookInput(event), deps);
  const secondBody = await second.json();
  assert.equal(second.status, 200);
  assert.equal(secondBody.deduped, true);

  assert.equal(store.organizations.get("org-1")?.status, "active");
  assert.equal(log.activations, 1, "org_billing must be written exactly once across both deliveries");
});

test("out-of-order deleted then stale updated(active) leaves the org suspended", async () => {
  const { sql, store } = makeBillingSql({
    orgBilling: {
      "org-2": {
        org_id: "org-2",
        stripe_customer_id: "cus_org-2",
        stripe_subscription_id: "sub-2",
        subscription_status: "active",
        seats: 1,
        last_event_created: 50,
      },
    },
    organizations: { "org-2": { id: "org-2", status: "active" } },
  });
  const deps = makeDeps(sql);

  // Cancellation (created=200) arrives first and suspends the org.
  const deleted = subscriptionDeletedEvent({ id: "evt_del", created: 200, orgId: "org-2", subId: "sub-2" });
  const delRes = await handleBillingWebhook(webhookInput(deleted), deps);
  assert.equal(delRes.status, 200);
  assert.equal(store.organizations.get("org-2")?.status, "suspended");

  // A stale "active" update (created=100) is delivered late and must be ignored.
  const staleActive = subscriptionUpdatedEvent({ id: "evt_stale", created: 100, orgId: "org-2", subId: "sub-2" });
  const staleRes = await handleBillingWebhook(webhookInput(staleActive), deps);
  const staleBody = await staleRes.json();
  assert.equal(staleRes.status, 200);
  assert.equal(staleBody.skipped, true);
  assert.equal(staleBody.reason, "older_event");

  assert.equal(store.organizations.get("org-2")?.status, "suspended", "org must remain suspended");
  assert.equal(store.orgBilling.get("org-2")?.subscription_status, "canceled");
});

test("an event stuck in 'processing' for over 15 minutes is reclaimed and processed on retry", async () => {
  const { sql, store, log } = makeBillingSql();
  const deps = makeDeps(sql);
  const event = subscriptionUpdatedEvent({ id: "evt_stuck", created: 1000, orgId: "org-3", subId: "sub-3" });

  // A previous delivery's handler crashed before markWebhookFailed: the row is
  // stuck in 'processing' with a received_at 16 minutes in the past.
  store.webhookEvents.set("evt_stuck", {
    event_id: "evt_stuck",
    type: event.type,
    event_created: 1000,
    status: "processing",
    received_at: new Date(FIXED_NOW.getTime() - 16 * 60 * 1000).toISOString(),
  });

  const retry = await handleBillingWebhook(webhookInput(event), deps);
  const body = await retry.json();
  assert.equal(retry.status, 200);
  assert.equal(body.received, true);
  assert.notEqual(body.deduped, true);

  assert.equal(store.webhookEvents.get("evt_stuck")?.status, "processed");
  assert.equal(store.organizations.get("org-3")?.status, "active");
  assert.equal(log.activations, 1, "reclaimed event must be processed exactly once");
});

test("an event freshly in 'processing' still returns busy (no double-processing window)", async () => {
  const { sql, store, log } = makeBillingSql();
  const deps = makeDeps(sql);
  const event = subscriptionUpdatedEvent({ id: "evt_fresh", created: 1000, orgId: "org-4", subId: "sub-4" });

  // Another delivery of the same event started one minute ago and is still running.
  const freshReceivedAt = new Date(FIXED_NOW.getTime() - 60 * 1000).toISOString();
  store.webhookEvents.set("evt_fresh", {
    event_id: "evt_fresh",
    type: event.type,
    event_created: 1000,
    status: "processing",
    received_at: freshReceivedAt,
  });

  const retry = await handleBillingWebhook(webhookInput(event), deps);
  const body = await retry.json();
  assert.equal(retry.status, 500, "Stripe must see a retryable error while the event is in flight");
  assert.equal(body.error, "event_in_progress");

  assert.equal(store.webhookEvents.get("evt_fresh")?.status, "processing");
  assert.equal(store.webhookEvents.get("evt_fresh")?.received_at, freshReceivedAt, "busy must not refresh the claim");
  assert.equal(log.activations, 0, "busy retry must not touch org_billing");
});
