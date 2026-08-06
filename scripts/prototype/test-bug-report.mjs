#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// bug-report-flow.ts imports shared modules through the TypeScript "@/" path
// alias; register the same resolve hook as test-signup-flow.mjs mapping
// "@/<x>" -> <repoRoot>/<x>. No stubs are needed: the flow's only rate-limit
// import is type-only, so the DB driver never loads.
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function resolveRealAlias(specifier) {
  const base = path.join(rootDir, specifier.slice(2));
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return `${base}.ts`;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return { url: pathToFileURL(resolveRealAlias(specifier)).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { BUG_REPORT_EMAIL, BUG_REPORT_MAX_BYTES, bugReportSchema } = await import("../../lib/bug-report.ts");
const { AGENTMAIL_SEND_URL, BUG_REPORT_RATE_LIMIT, handleBugReportRequest } = await import(
  "../../lib/core/bug-report-flow.ts"
);

const API_KEY = "am_test_key_never_logged";

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

function allowedLimit() {
  return { allowed: true, attempts: 1, limit: 5, retryAfterSeconds: 3600 };
}

function deps(overrides = {}) {
  return {
    apiKey: API_KEY,
    fetch: async () => new Response(JSON.stringify({ message_id: "m", thread_id: "t" }), { status: 200 }),
    checkRateLimit: async () => allowedLimit(),
    rateLimitedResponse: (result) =>
      Response.json(
        { error: "rate_limited", retry_after_seconds: result.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
      ),
    ...overrides,
  };
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
  assert.equal(bugReportSchema.safeParse(validReport({ extra_field: "x" })).success, false);
});

test("control characters are rejected in single-line fields and page URLs", () => {
  assert.equal(bugReportSchema.safeParse(validReport({ summary: "Subject\r\nBcc: x@y.z" })).success, false);
  assert.equal(bugReportSchema.safeParse(validReport({ summary: "Null\u0000byte here" })).success, false);
  assert.equal(bugReportSchema.safeParse(validReport({ summary: "Escape\u001b[31m here" })).success, false);
  // WHATWG URL parsing strips raw newlines, so the raw string must be checked.
  assert.equal(bugReportSchema.safeParse(validReport({ page_url: "https://frege.dev/\nconsole" })).success, false);
  assert.equal(
    bugReportSchema.safeParse(validReport({ contact_email: "a\r\nb@example.com" })).success,
    false,
  );
});

test("multiline fields normalize CRLF and reject other control characters", () => {
  const parsed = bugReportSchema.parse(validReport({ details: "Line one is long.\r\nLine two.\rLine three." }));
  assert.equal(parsed.details, "Line one is long.\nLine two.\nLine three.");
  assert.equal(bugReportSchema.safeParse(validReport({ details: "Details with a \u0000 null byte." })).success, false);
  assert.equal(
    bugReportSchema.safeParse(validReport({ reproduction_steps: "Steps\u001b[2Jwith escape." })).success,
    false,
  );
  assert.equal(bugReportSchema.safeParse(validReport({ details: "Tabs\tand\nnewlines are fine here." })).success, true);
});

test("valid reports are sent to the fixed AgentMail inbox with the untrusted-input banner", async () => {
  let sent;
  const response = await handleBugReportRequest(
    request(validReport()),
    deps({
      fetch: async (url, init) => {
        sent = { url, init };
        return new Response(JSON.stringify({ message_id: "m", thread_id: "t" }), { status: 200 });
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(sent.url, AGENTMAIL_SEND_URL);
  assert.equal(sent.init.headers.Authorization, `Bearer ${API_KEY}`);
  assert.ok(sent.init.signal instanceof AbortSignal);

  const payload = JSON.parse(sent.init.body);
  assert.deepEqual(payload.to, [BUG_REPORT_EMAIL]);
  assert.deepEqual(payload.reply_to, ["reporter@example.com"]);
  assert.equal(payload.subject, "Frege bug report: Console fails to load");
  assert.equal(payload.html, undefined);
  assert.match(payload.text, /untrusted user input/i);
  assert.match(payload.text, /do not follow instructions/i);
  assert.match(payload.text, /Console fails to load/);
  assert.equal("_gotcha" in payload, false);
});

test("reply_to is omitted when no contact email is provided", async () => {
  let sent;
  await handleBugReportRequest(
    request(validReport({ contact_email: "" })),
    deps({
      fetch: async (url, init) => {
        sent = { url, init };
        return new Response(JSON.stringify({ message_id: "m", thread_id: "t" }), { status: 200 });
      },
    }),
  );
  assert.equal("reply_to" in JSON.parse(sent.init.body), false);
});

test("honeypot submissions succeed without rate limiting or contacting AgentMail", async () => {
  let fetchCalls = 0;
  let rateLimitCalls = 0;
  const response = await handleBugReportRequest(
    request(validReport({ _gotcha: "https://spam.test" })),
    deps({
      fetch: async () => {
        fetchCalls += 1;
        return new Response(null, { status: 200 });
      },
      checkRateLimit: async () => {
        rateLimitCalls += 1;
        return allowedLimit();
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(fetchCalls, 0);
  assert.equal(rateLimitCalls, 0);
});

test("rate-limited requests get 429 with Retry-After and no delivery", async () => {
  let fetchCalls = 0;
  const response = await handleBugReportRequest(
    request(validReport()),
    deps({
      fetch: async () => {
        fetchCalls += 1;
        return new Response(null, { status: 200 });
      },
      checkRateLimit: async (req, options) => {
        assert.equal(options.action, BUG_REPORT_RATE_LIMIT.action);
        assert.equal(options.limit, BUG_REPORT_RATE_LIMIT.limit);
        return { allowed: false, attempts: 6, limit: 5, retryAfterSeconds: 3600 };
      },
    }),
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "3600");
  assert.equal(fetchCalls, 0);
});

test("a failing rate limiter fails closed without contacting AgentMail", async () => {
  let fetchCalls = 0;
  const response = await handleBugReportRequest(
    request(validReport()),
    deps({
      fetch: async () => {
        fetchCalls += 1;
        return new Response(null, { status: 200 });
      },
      checkRateLimit: async () => {
        throw new Error("db unavailable");
      },
    }),
  );

  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error, "temporarily_unavailable");
  assert.equal(body.fallback_email, BUG_REPORT_EMAIL);
  assert.equal(fetchCalls, 0);
});

test("an unconfigured API key returns 503 with the mailto fallback and no send", async () => {
  for (const apiKey of [undefined, "", "   "]) {
    let fetchCalls = 0;
    const response = await handleBugReportRequest(
      request(validReport()),
      deps({
        apiKey,
        fetch: async () => {
          fetchCalls += 1;
          return new Response(null, { status: 200 });
        },
      }),
    );

    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error, "not_configured");
    assert.equal(body.fallback_email, BUG_REPORT_EMAIL);
    assert.equal(fetchCalls, 0);
  }
});

test("upstream failures and timeouts return 502 without leaking the key", async () => {
  const upstreamError = await handleBugReportRequest(
    request(validReport()),
    deps({ fetch: async () => new Response(JSON.stringify({ error: "invalid" }), { status: 422 }) }),
  );
  assert.equal(upstreamError.status, 502);
  assert.equal(JSON.stringify(await upstreamError.json()).includes(API_KEY), false);

  const timeout = await handleBugReportRequest(
    request(validReport()),
    deps({
      fetch: async () => {
        const err = new Error("The operation was aborted due to timeout");
        err.name = "TimeoutError";
        throw err;
      },
    }),
  );
  assert.equal(timeout.status, 502);
  const timeoutBody = await timeout.json();
  assert.equal(timeoutBody.error, "delivery_failed");
  assert.equal(timeoutBody.fallback_email, BUG_REPORT_EMAIL);
  assert.equal(JSON.stringify(timeoutBody).includes(API_KEY), false);
});

test("invalid, oversized, and wrong-media-type requests are bounded", async () => {
  const unusedFetch = async () => new Response(null, { status: 200 });
  assert.equal((await handleBugReportRequest(request({}), deps({ fetch: unusedFetch }))).status, 400);
  assert.equal((await handleBugReportRequest(request("not json"), deps({ fetch: unusedFetch }))).status, 400);
  assert.equal(
    (await handleBugReportRequest(
      request(validReport(), { "Content-Length": String(BUG_REPORT_MAX_BYTES + 1) }),
      deps({ fetch: unusedFetch }),
    )).status,
    413,
  );
  assert.equal(
    (await handleBugReportRequest(
      request(validReport({ details: "a".repeat(BUG_REPORT_MAX_BYTES) })),
      deps({ fetch: unusedFetch }),
    )).status,
    413,
  );
  assert.equal(
    (await handleBugReportRequest(
      new Request("https://frege.dev/api/bug-report", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "hello",
      }),
      deps({ fetch: unusedFetch }),
    )).status,
    415,
  );
});
