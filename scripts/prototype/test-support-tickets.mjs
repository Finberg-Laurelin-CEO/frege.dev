#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// support-tickets.ts imports shared modules through the TypeScript "@/" path
// alias, which plain `node --test` cannot resolve. Register the same resolve
// hook as test-auth-flow.mjs mapping "@/<x>" -> <repoRoot>/<x>. request-guards
// pulls in "@/lib/core/session" (only for assertSafeBrowserMutation, unused
// here); stub it so the test stays hermetic and never loads the DB driver.
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const VIRTUAL = {
  "@/lib/core/session": "export const readSessionToken = () => null;",
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

const {
  handleCustomerTicketCreateRequest,
  handleCustomerTicketDetailRequest,
  handleCustomerTicketReplyRequest,
  handleCustomerTicketsListRequest,
  handleStaffTicketPatchRequest,
  handleStaffTicketReplyRequest,
  handleStaffTicketsListRequest,
} = await import("../../lib/core/support-tickets.ts");

const STAFF = { user: { id: "staff-1", email: "staff@frege.dev" } };
const ORG_A = {
  user: { id: "user-a", email: "ada@acme.com", name: "Ada Lovelace" },
  organization: { id: "org-a", slug: "acme", name: "Acme" },
};
const ORG_B = {
  user: { id: "user-b", email: "bob@globex.com", name: "Bob" },
  organization: { id: "org-b", slug: "globex", name: "Globex" },
};

function getRequest(path) {
  return new Request(`https://frege.dev${path}`);
}

function jsonRequest(path, body, method = "POST") {
  return new Request(`https://frege.dev${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function queryText(strings) {
  return strings.join(" ").replace(/\s+/g, " ").trim();
}

function makeDeps(sql, overrides = {}) {
  const telemetry = [];
  const audits = [];
  const createdEmails = [];
  const replyEmails = [];
  const deps = {
    getSql: () => sql,
    logTelemetryEvent: async (event) => {
      telemetry.push(event);
    },
    routeError: (label, err) => {
      throw new Error(`${label}: ${err?.message ?? err}`);
    },
    recordPlatformAudit: async (input) => {
      audits.push(input);
    },
    notifications: {
      staffNotifyEmail: () => "support@frege.dev",
      sendTicketCreatedEmail: async (input) => {
        createdEmails.push(input);
      },
      sendStaffReplyEmail: async (input) => {
        replyEmails.push(input);
      },
      ...(overrides.notifications ?? {}),
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "notifications")),
  };
  return { deps, telemetry, audits, createdEmails, replyEmails };
}

function makeSql(routes) {
  const calls = [];
  const sql = async (strings, ...values) => {
    const text = queryText(strings);
    calls.push({ text, values });
    for (const route of routes) {
      if (route.match(text)) return route.rows(values, text);
    }
    throw new Error(`unexpected SQL: ${text}`);
  };
  return { sql, calls };
}

// --- Visibility --------------------------------------------------------------

test("staff list sees tickets across all orgs with status counts", async () => {
  const rows = [
    { id: "t-1", org_id: "org-a", org_slug: "acme", subject: "A", status: "open" },
    { id: "t-2", org_id: "org-b", org_slug: "globex", subject: "B", status: "pending" },
  ];
  const { sql, calls } = makeSql([
    { match: (t) => t.includes("group by status"), rows: () => [{ status: "open", count: 1 }, { status: "pending", count: 1 }] },
    { match: (t) => t.includes("from support_tickets t"), rows: () => rows },
  ]);
  const { deps } = makeDeps(sql);

  const response = await handleStaffTicketsListRequest(getRequest("/api/v1/platform/tickets"), STAFF, deps);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.tickets.length, 2);
  assert.deepEqual(body.counts, { open: 1, pending: 1, resolved: 0, closed: 0 });
  // Staff visibility: the list query is not scoped to any org.
  const listCall = calls.find((c) => c.text.includes("order by t.updated_at desc"));
  assert.equal(listCall.text.includes("t.org_id = "), false);
  // No filters -> empty-string params so the SQL predicates pass everything.
  assert.deepEqual(listCall.values.slice(0, 2), ["", ""]);
});

test("staff list forwards status/priority filters and maps assignee=me", async () => {
  const { sql, calls } = makeSql([
    { match: (t) => t.includes("group by status"), rows: () => [] },
    { match: (t) => t.includes("from support_tickets t"), rows: () => [] },
  ]);
  const { deps } = makeDeps(sql);

  const response = await handleStaffTicketsListRequest(
    getRequest("/api/v1/platform/tickets?status=open&priority=urgent&assignee=me"),
    STAFF,
    deps,
  );

  assert.equal(response.status, 200);
  const listCall = calls.find((c) => c.text.includes("order by t.updated_at desc"));
  assert.equal(listCall.values.includes("open"), true);
  assert.equal(listCall.values.includes("urgent"), true);
  assert.equal(listCall.values.includes(STAFF.user.id), true);
});

test("customer list is scoped to the caller's own org", async () => {
  const { sql, calls } = makeSql([
    { match: (t) => t.includes("from support_tickets t"), rows: () => [] },
  ]);
  const { deps } = makeDeps(sql);

  const response = await handleCustomerTicketsListRequest(getRequest("/api/v1/support/tickets"), ORG_A, deps);

  assert.equal(response.status, 200);
  assert.equal(calls[0].text.includes("t.org_id ="), true);
  assert.deepEqual(calls[0].values, ["org-a"]);
});

test("cross-org ticket detail reads as 404, not 403", async () => {
  // The ticket exists but belongs to org-a; org-b's admin asks for it. The
  // org_id predicate makes it indistinguishable from a missing ticket.
  const { sql, calls } = makeSql([
    {
      match: (t) => t.includes("from support_tickets t"),
      rows: (values) => (values.includes("org-a") ? [{ id: "t-1" }] : []),
    },
    { match: (t) => t.includes("from support_ticket_messages m"), rows: () => [] },
  ]);
  const { deps } = makeDeps(sql);

  const denied = await handleCustomerTicketDetailRequest(getRequest("/api/v1/support/tickets/t-1"), ORG_B, "t-1", deps);
  assert.equal(denied.status, 404);
  assert.deepEqual(await denied.json(), { error: "not_found" });
  assert.equal(calls.length, 1); // messages never queried

  const allowed = await handleCustomerTicketDetailRequest(getRequest("/api/v1/support/tickets/t-1"), ORG_A, "t-1", deps);
  assert.equal(allowed.status, 200);
});

test("customer reply on another org's ticket is 404 and writes nothing", async () => {
  const { sql, calls } = makeSql([
    { match: (t) => t.includes("select t.id, t.status"), rows: () => [] },
  ]);
  const { deps, telemetry } = makeDeps(sql);

  const response = await handleCustomerTicketReplyRequest(
    jsonRequest("/api/v1/support/tickets/t-1/messages", { body: "hello?" }),
    ORG_B,
    "t-1",
    deps,
  );

  assert.equal(response.status, 404);
  assert.equal(calls.length, 1);
  assert.equal(telemetry.length, 0);
});

// --- Creation + staff notification -------------------------------------------

function makeCreateSql() {
  return makeSql([
    {
      match: (t) => t.includes("insert into support_tickets"),
      rows: () => [{ id: "t-new", org_id: "org-a", subject: "Sync is stuck", status: "open", priority: "normal" }],
    },
    {
      match: (t) => t.includes("insert into support_ticket_messages"),
      rows: () => [{ id: "m-new", ticket_id: "t-new", author_kind: "customer", body: "It hangs." }],
    },
  ]);
}

test("ticket creation stores subject + first message and notifies staff", async () => {
  const { sql, calls } = makeCreateSql();
  const { deps, telemetry, createdEmails } = makeDeps(sql);

  const response = await handleCustomerTicketCreateRequest(
    jsonRequest("/api/v1/support/tickets", { subject: "Sync is stuck", body: "It hangs." }),
    ORG_A,
    deps,
  );
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.ticket.id, "t-new");
  assert.equal(body.message.author_kind, "customer");

  const ticketInsert = calls.find((c) => c.text.includes("insert into support_tickets"));
  assert.deepEqual(ticketInsert.values, ["org-a", "user-a", "Sync is stuck"]);
  const messageInsert = calls.find((c) => c.text.includes("insert into support_ticket_messages"));
  assert.equal(messageInsert.text.includes("'customer'"), true);

  assert.equal(createdEmails.length, 1);
  assert.equal(createdEmails[0].to, "support@frege.dev");
  assert.equal(createdEmails[0].orgSlug, "acme");
  assert.equal(createdEmails[0].requesterEmail, "ada@acme.com");
  assert.equal(createdEmails[0].ticketId, "t-new");

  assert.equal(telemetry.at(-1)?.action, "support.tickets.create");
  assert.equal(telemetry.at(-1)?.metadata?.email_sent, true);
});

test("ticket creation skips the staff email when no notify address is configured", async () => {
  const { sql } = makeCreateSql();
  const { deps, telemetry, createdEmails } = makeDeps(sql, {
    notifications: { staffNotifyEmail: () => null },
  });

  const response = await handleCustomerTicketCreateRequest(
    jsonRequest("/api/v1/support/tickets", { subject: "Sync is stuck", body: "It hangs." }),
    ORG_A,
    deps,
  );

  assert.equal(response.status, 201);
  assert.equal(createdEmails.length, 0);
  assert.equal(telemetry.at(-1)?.metadata?.email_sent, false);
});

test("a failing staff notification never fails ticket creation", async () => {
  const { sql } = makeCreateSql();
  const { deps, telemetry } = makeDeps(sql, {
    notifications: {
      sendTicketCreatedEmail: async () => {
        throw new Error("resend down");
      },
    },
  });

  const response = await handleCustomerTicketCreateRequest(
    jsonRequest("/api/v1/support/tickets", { subject: "Sync is stuck", body: "It hangs." }),
    ORG_A,
    deps,
  );

  assert.equal(response.status, 201);
  assert.equal(telemetry.at(-1)?.metadata?.email_sent, false);
});

test("ticket creation validates subject and body", async () => {
  const { sql, calls } = makeCreateSql();
  const { deps } = makeDeps(sql);

  const response = await handleCustomerTicketCreateRequest(
    jsonRequest("/api/v1/support/tickets", { subject: "", body: "" }),
    ORG_A,
    deps,
  );

  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

// --- Staff reply: SLA stamping + customer notification -----------------------

function makeStaffReplySql({ ticket } = {}) {
  return makeSql([
    {
      match: (t) => t.includes("creator.email as creator_email"),
      rows: () => (ticket ? [ticket] : []),
    },
    {
      match: (t) => t.includes("insert into support_ticket_messages"),
      rows: () => [{ id: "m-2", ticket_id: "t-1", author_kind: "staff", body: "On it." }],
    },
    {
      match: (t) => t.includes("update support_tickets"),
      rows: () => [{ id: "t-1", status: "pending", first_response_at: "2026-07-09T00:00:00Z", resolved_at: null }],
    },
  ]);
}

const REPLY_TICKET = {
  id: "t-1",
  org_id: "org-a",
  subject: "Sync is stuck",
  status: "open",
  creator_email: "ada@acme.com",
  creator_name: "Ada Lovelace",
};

test("staff reply stamps first_response_at, flips open->pending, and emails the creator", async () => {
  const { sql, calls } = makeStaffReplySql({ ticket: REPLY_TICKET });
  const { deps, telemetry, audits, replyEmails } = makeDeps(sql);

  const response = await handleStaffTicketReplyRequest(
    jsonRequest("/api/v1/platform/tickets/t-1/messages", { body: "On it." }),
    STAFF,
    "t-1",
    deps,
  );
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.message.author_kind, "staff");
  assert.equal(body.ticket.status, "pending");

  const update = calls.find((c) => c.text.includes("update support_tickets"));
  assert.equal(update.text.includes("first_response_at = coalesce(first_response_at, now())"), true);
  assert.equal(update.text.includes("when status = 'open' then 'pending'"), true);

  assert.equal(replyEmails.length, 1);
  assert.equal(replyEmails[0].to, "ada@acme.com");
  assert.equal(replyEmails[0].subject, "Sync is stuck");

  assert.equal(telemetry.at(-1)?.action, "platform.tickets.reply");
  assert.equal(telemetry.at(-1)?.metadata?.email_sent, true);
  assert.equal(audits.at(-1)?.action, "ticket.reply");
});

test("staff reply on an unknown ticket is 404 and sends no email", async () => {
  const { sql } = makeStaffReplySql({ ticket: null });
  const { deps, replyEmails } = makeDeps(sql);

  const response = await handleStaffTicketReplyRequest(
    jsonRequest("/api/v1/platform/tickets/t-404/messages", { body: "Hello?" }),
    STAFF,
    "t-404",
    deps,
  );

  assert.equal(response.status, 404);
  assert.equal(replyEmails.length, 0);
});

test("a failing customer email never fails a staff reply", async () => {
  const { sql } = makeStaffReplySql({ ticket: REPLY_TICKET });
  const { deps, telemetry } = makeDeps(sql, {
    notifications: {
      sendStaffReplyEmail: async () => {
        throw new Error("resend down");
      },
    },
  });

  const response = await handleStaffTicketReplyRequest(
    jsonRequest("/api/v1/platform/tickets/t-1/messages", { body: "On it." }),
    STAFF,
    "t-1",
    deps,
  );

  assert.equal(response.status, 201);
  assert.equal(telemetry.at(-1)?.metadata?.email_sent, false);
});

// --- Staff patch: status transitions + resolved_at ---------------------------

function makePatchSql(row) {
  return makeSql([
    { match: (t) => t.includes("update support_tickets"), rows: () => (row ? [row] : []) },
  ]);
}

test("patching to resolved stamps resolved_at and reopening clears it", async () => {
  const { sql, calls } = makePatchSql({ id: "t-1", org_id: "org-a", status: "resolved", priority: "normal", resolved_at: "2026-07-09T00:00:00Z" });
  const { deps, audits } = makeDeps(sql);

  const response = await handleStaffTicketPatchRequest(
    jsonRequest("/api/v1/platform/tickets/t-1", { status: "resolved" }, "PATCH"),
    STAFF,
    "t-1",
    deps,
  );

  assert.equal(response.status, 200);
  const update = calls[0];
  // resolved/closed stamps (keeping an existing stamp), open/pending clears.
  assert.equal(update.text.includes("in ('resolved', 'closed') then coalesce(resolved_at, now())"), true);
  assert.equal(update.text.includes("in ('open', 'pending') then null"), true);
  assert.equal(update.values.includes("resolved"), true);
  assert.equal(audits.at(-1)?.action, "ticket.update");

  const reopen = await handleStaffTicketPatchRequest(
    jsonRequest("/api/v1/platform/tickets/t-1", { status: "open" }, "PATCH"),
    STAFF,
    "t-1",
    deps,
  );
  assert.equal(reopen.status, 200);
  assert.equal(calls.at(-1).values.includes("open"), true);
});

test("patch assigns and unassigns staff", async () => {
  const assigneeId = "123e4567-e89b-42d3-a456-426614174000";
  const { sql, calls } = makePatchSql({ id: "t-1", org_id: "org-a", status: "open", priority: "normal", assigned_to: assigneeId });
  const { deps } = makeDeps(sql);

  const assign = await handleStaffTicketPatchRequest(
    jsonRequest("/api/v1/platform/tickets/t-1", { assigned_to: assigneeId }, "PATCH"),
    STAFF,
    "t-1",
    deps,
  );
  assert.equal(assign.status, 200);
  // values: [status, priority, assignedProvided, assignedTo, status, status, id]
  assert.deepEqual(calls[0].values, [null, null, true, assigneeId, null, null, "t-1"]);

  const unassign = await handleStaffTicketPatchRequest(
    jsonRequest("/api/v1/platform/tickets/t-1", { assigned_to: null }, "PATCH"),
    STAFF,
    "t-1",
    deps,
  );
  assert.equal(unassign.status, 200);
  assert.deepEqual(calls[1].values, [null, null, true, null, null, null, "t-1"]);
});

test("patch validation rejects empty patches, bad statuses, and non-uuid assignees", async () => {
  const { sql, calls } = makePatchSql({ id: "t-1" });
  const { deps } = makeDeps(sql);

  for (const payload of [{}, { status: "escalated" }, { assigned_to: "not-a-uuid" }]) {
    const response = await handleStaffTicketPatchRequest(
      jsonRequest("/api/v1/platform/tickets/t-1", payload, "PATCH"),
      STAFF,
      "t-1",
      deps,
    );
    assert.equal(response.status, 400);
  }
  assert.equal(calls.length, 0);
});

test("patching an unknown ticket is 404", async () => {
  const { sql } = makePatchSql(null);
  const { deps } = makeDeps(sql);

  const response = await handleStaffTicketPatchRequest(
    jsonRequest("/api/v1/platform/tickets/t-404", { status: "closed" }, "PATCH"),
    STAFF,
    "t-404",
    deps,
  );
  assert.equal(response.status, 404);
});

// --- Customer reply: pending -> open, closed rejected -------------------------

function makeCustomerReplySql(existing) {
  return makeSql([
    { match: (t) => t.includes("select t.id, t.status"), rows: () => (existing ? [existing] : []) },
    {
      match: (t) => t.includes("insert into support_ticket_messages"),
      rows: () => [{ id: "m-3", ticket_id: "t-1", author_kind: "customer", body: "Still broken." }],
    },
    {
      match: (t) => t.includes("update support_tickets"),
      rows: () => [{ id: "t-1", status: "open" }],
    },
  ]);
}

test("customer reply flips pending back to open", async () => {
  const { sql, calls } = makeCustomerReplySql({ id: "t-1", status: "pending" });
  const { deps, telemetry } = makeDeps(sql);

  const response = await handleCustomerTicketReplyRequest(
    jsonRequest("/api/v1/support/tickets/t-1/messages", { body: "Still broken." }),
    ORG_A,
    "t-1",
    deps,
  );
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.ticket.status, "open");
  const update = calls.find((c) => c.text.includes("update support_tickets"));
  assert.equal(update.text.includes("when status = 'pending' then 'open'"), true);
  assert.equal(telemetry.at(-1)?.action, "support.tickets.reply");
});

test("customer reply on a closed ticket is rejected", async () => {
  const { sql, calls } = makeCustomerReplySql({ id: "t-1", status: "closed" });
  const { deps } = makeDeps(sql);

  const response = await handleCustomerTicketReplyRequest(
    jsonRequest("/api/v1/support/tickets/t-1/messages", { body: "Reopen please" }),
    ORG_A,
    "t-1",
    deps,
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "ticket_closed" });
  assert.equal(calls.length, 1); // nothing written
});

test("customer reply validates the message body", async () => {
  const { sql, calls } = makeCustomerReplySql({ id: "t-1", status: "open" });
  const { deps } = makeDeps(sql);

  const response = await handleCustomerTicketReplyRequest(
    jsonRequest("/api/v1/support/tickets/t-1/messages", { body: "   " }),
    ORG_A,
    "t-1",
    deps,
  );

  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});
