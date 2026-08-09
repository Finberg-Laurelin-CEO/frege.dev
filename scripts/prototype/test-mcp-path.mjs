#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";

const { isMcpCredentialPath, rawPathnameFromUrl } = await import("../../lib/core/mcp-path.ts");

test("MCP credential paths include encoded, cased, and normalized lookalikes", () => {
  const protectedPaths = [
    "/mcp",
    "/mcp/",
    "/mcp%2F",
    "/mcp%2f",
    "/MCP",
    "/mCp-tools",
    "/mcp//",
    "//mcp",
    "/%2fmcp",
    "/%252fmcp",
    "/%6dcp",
    "/%256dcp",
    "/foo/../mcp",
    "/foo/%2e%2e/mcp",
    "/foo%2F..%2Fmcp",
    "/mcp\\child",
    "/mcp%5cchild",
    "/mcp?ignored=true",
  ];
  for (const pathname of protectedPaths) {
    assert.equal(isMcpCredentialPath(pathname), true, pathname);
  }
});

test("unrelated application and marketing paths are not classified as MCP", () => {
  for (const pathname of ["/", "/pricing", "/foo/mcp", "/amcp", "/mc", "/_next/static/mcp.js"]) {
    assert.equal(isMcpCredentialPath(pathname), false, pathname);
  }
});

test("raw pathname extraction preserves encoded separators before query parsing", () => {
  assert.equal(rawPathnameFromUrl("https://brain.frege.dev/mcp%2F?key=ignored"), "/mcp%2F");
  assert.equal(rawPathnameFromUrl("https://[::1]:3000/mcp//"), "/mcp//");
  assert.equal(rawPathnameFromUrl("https://frege.dev"), "/");
  assert.equal(rawPathnameFromUrl("/mcp%2f?x=1"), "/mcp%2f");
});
