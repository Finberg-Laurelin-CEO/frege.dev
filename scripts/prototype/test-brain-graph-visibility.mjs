#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const VIRTUAL_DB = `
  export function getSql() {
    return globalThis.__fregeBrainGraphVisibilitySql;
  }
`;

function resolveAlias(specifier) {
  const base = path.join(rootDir, specifier.slice(2));
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return `${base}.ts`;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/db") return { url: "virtual:brain-graph-db", shortCircuit: true };
    if (specifier.startsWith("@/")) {
      return { url: pathToFileURL(resolveAlias(specifier)).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "virtual:brain-graph-db") {
      return { format: "module", source: VIRTUAL_DB, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { getNeighbors, getPageLinks, listVault } = await import("../../lib/core/brain-graph.ts");

function normalize(strings) {
  return strings.join(" ? ").replace(/\s+/g, " ").trim();
}

function fakeSql(responses) {
  const calls = [];
  const sql = (strings, ...values) => {
    calls.push({ text: normalize(strings), values });
    if (responses.length === 0) throw new Error("unexpected brain-graph SQL");
    return Promise.resolve(responses.shift());
  };
  globalThis.__fregeBrainGraphVisibilitySql = sql;
  return calls;
}

const greenReader = { orgId: "org-green", trustZones: ["green"] };

function visibleLink(overrides = {}) {
  return {
    source_slug: "green-source",
    target_slug: "green-target",
    target_title: "Green Target",
    link_type: "reference",
    confidence: 1,
    evidence: "visible evidence",
    resolved: true,
    ...overrides,
  };
}

test("page links only return visible resolved targets and genuinely dangling links", async () => {
  const calls = fakeSql([
    [{ id: "green-page-id", slug: "green-source", title: "Green Source" }],
    [
      visibleLink(),
      visibleLink({
        target_slug: "missing-target",
        target_title: null,
        evidence: "dangling evidence",
        resolved: false,
      }),
    ],
    [visibleLink({ source_slug: "green-backlink", target_slug: "green-source" })],
  ]);

  const result = await getPageLinks(greenReader, "green-source");
  assert.deepEqual(result.outgoing.map((edge) => edge.target_slug), ["green-target"]);
  assert.deepEqual(result.unresolved.map((edge) => edge.target_slug), ["missing-target"]);
  assert.deepEqual(result.backlinks.map((edge) => edge.source_slug), ["green-backlink"]);

  const outgoing = calls[1].text;
  assert.match(outgoing, /join brain_pages tp/);
  assert.doesNotMatch(outgoing, /left join brain_pages tp/);
  assert.match(outgoing, /tp\.org_id =/);
  assert.match(outgoing, /tp\.status = 'published'/);
  assert.match(outgoing, /tp\.trust_zone = any/);
  assert.match(outgoing, /union all/);
  assert.match(outgoing, /bl\.target_page_id is null/);

  const backlinks = calls[2].text;
  assert.match(backlinks, /sp\.org_id =/);
  assert.match(backlinks, /sp\.status = 'published'/);
  assert.match(backlinks, /sp\.trust_zone = any/);
});

test("vault counts exclude resolved hidden endpoints while retaining true dangling links", async () => {
  const calls = fakeSql([[
    {
      slug: "green-source",
      title: "Green Source",
      status: "published",
      updated_at: new Date("2026-08-09T00:00:00Z"),
      outgoing_count: 2,
      backlink_count: 1,
    },
  ]]);

  const entries = await listVault(greenReader, 10);
  assert.equal(entries[0].outgoing_count, 2);
  const query = calls[0].text;
  assert.match(query, /bl\.target_page_id is null or exists/);
  assert.match(query, /target\.org_id =/);
  assert.match(query, /target\.status = 'published'/);
  assert.match(query, /target\.trust_zone = any/);
  assert.match(query, /source\.org_id =/);
  assert.match(query, /source\.status = 'published'/);
  assert.match(query, /source\.trust_zone = any/);
});

test("graph traversal and induced counts constrain both endpoints to the reader", async () => {
  const calls = fakeSql([
    [{ id: "green-page-id", slug: "green-source", title: "Green Source" }],
    [{ source_slug: "green-source", target_slug: "green-target" }],
    [],
    [
      { slug: "green-source", title: "Green Source", link_count: 1 },
      { slug: "green-target", title: "Green Target", link_count: 1 },
    ],
    [{ source: "green-source", target: "green-target", link_type: "reference" }],
  ]);

  const graph = await getNeighbors(greenReader, "green-source", 2, 10);
  assert.deepEqual(graph.nodes.map((node) => node.slug).sort(), ["green-source", "green-target"]);

  for (const traversal of [calls[1].text, calls[2].text]) {
    assert.match(traversal, /sp\.org_id =/);
    assert.match(traversal, /sp\.status = 'published'/);
    assert.match(traversal, /sp\.trust_zone = any/);
    assert.match(traversal, /tp\.org_id =/);
    assert.match(traversal, /tp\.status = 'published'/);
    assert.match(traversal, /tp\.trust_zone = any/);
  }

  const counts = calls[3].text;
  assert.match(counts, /target\.org_id =/);
  assert.match(counts, /target\.trust_zone = any/);
  assert.match(counts, /source\.org_id =/);
  assert.match(counts, /source\.trust_zone = any/);

  const edges = calls[4].text;
  assert.match(edges, /sp\.org_id =/);
  assert.match(edges, /tp\.org_id =/);
  assert.match(edges, /sp\.status = 'published'/);
  assert.match(edges, /tp\.status = 'published'/);
});
