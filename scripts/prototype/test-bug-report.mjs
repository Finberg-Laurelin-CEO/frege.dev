#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";

const { BUG_REPORT_MAX_BYTES, bugReportSchema, handleBugReportRequest } = await import(
  "../../lib/bug-report.ts"
);

function validReport(overrides = {}) {
  return {
    summary: "Console fails to load",
    details: "The console remains blank after the initial navigation.",
    reproduction_steps: "Open the console and select an organization.",
    expected_behavior: "The console loads the organization.",
    actual_behavior: "The page remains blank.",
    contact_email: "reporter@example.com",
    page_url: "https://frege.dev/console",
    _gotcha: "",
    ...overrides,
  };
}

function request(body, headers = {}) {
  return new Request("https://frege.dev/api/bug-report", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("bug report validation trims fields and restricts page URLs", () => {
  const parsed = bugReportSchema.parse(validReport({ summary: "  Blank console  ", contact_email: "", page_url: "" }));
  assert.equal(parsed.summary, "Blank console");
  assert.equal(parsed.contact_email, undefined);
  assert.equal(parsed.page_url, undefined);
  assert.equal(
    bugReportSchema.safeParse(validReport({ contact_email: undefined, page_url: undefined })).success,
    true,
  );
  assert.equal(bugReportSchema.safeParse(validReport({ page_url: "file:///tmp/report" })).success, false);
  assert.equal(bugReportSchema.safeParse(validReport({ details: "short" })).success, false);
});

test("valid reports are forwarded to the configured Formspree form", async () => {
  let forwarded;
  const response = await handleBugReportRequest(request(validReport()), {
    formId: "abc123",
    fetch: async (url, init) => {
      forwarded = { url, init };
      return new Response(null, { status: 200 });
    },
  });

  assert.equal(response.status, 200);
  assert.equal(forwarded.url, "https://formspree.io/f/abc123");
  const payload = JSON.parse(forwarded.init.body);
  assert.equal(payload.summary, "Console fails to load");
  assert.equal(payload.email, "reporter@example.com");
  assert.equal(payload.source, "frege.dev/report-a-bug");
  assert.equal("_gotcha" in payload, false);
});

test("honeypot submissions succeed without contacting Formspree", async () => {
  let fetchCalls = 0;
  const response = await handleBugReportRequest(request(validReport({ _gotcha: "https://spam.test" })), {
    formId: "abc123",
    fetch: async () => {
      fetchCalls += 1;
      return new Response(null, { status: 200 });
    },
  });

  assert.equal(response.status, 200);
  assert.equal(fetchCalls, 0);
});

test("invalid, oversized, unconfigured, and failed deliveries are bounded", async () => {
  const unusedFetch = async () => new Response(null, { status: 200 });
  assert.equal((await handleBugReportRequest(request({}), { formId: "abc123", fetch: unusedFetch })).status, 400);
  assert.equal(
    (await handleBugReportRequest(request("x", { "Content-Length": String(BUG_REPORT_MAX_BYTES + 1) }), {
      formId: "abc123",
      fetch: unusedFetch,
    })).status,
    413,
  );
  assert.equal((await handleBugReportRequest(request(validReport()), { fetch: unusedFetch })).status, 503);
  assert.equal(
    (await handleBugReportRequest(request(validReport()), {
      formId: "abc123",
      fetch: async () => new Response(null, { status: 422 }),
    })).status,
    502,
  );
});
