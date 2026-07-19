#!/usr/bin/env node
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";

const DEFAULT_BASE_URL = "http://localhost:3000";
const CONFIG_DIR = path.join(homedir(), ".frege", "mcp");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const DEBUG_LOG_PATH = process.env.FREGE_MCP_DEBUG_LOG;
let outputFraming = process.env.FREGE_MCP_TRANSPORT === "jsonl" ? "jsonl" : "content-length";

const tools = [
  {
    name: "frege_status",
    description: "Check the Frege actor and org attached to this API key.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "frege_brain_status",
    description: "Check hosted Frege brain counts, capabilities, and trust-zone access for this actor.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "frege_list_sources",
    description: "List hosted brain sources visible to this Frege actor.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", minimum: 1, maximum: 100 } },
    },
  },
  {
    name: "frege_search_pages",
    description: "Search hosted markdown brain pages visible to this Frege actor.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: "frege_get_page",
    description: "Read a hosted markdown brain page by slug.",
    inputSchema: {
      type: "object",
      properties: { slug: { type: "string" } },
      required: ["slug"],
    },
  },
  {
    name: "frege_list_vault",
    description:
      "List hosted brain pages visible to this actor as a flat vault, each with outgoing/backlink counts. Use to get an overview of what knowledge exists before traversing.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", minimum: 1, maximum: 500 } },
    },
  },
  {
    name: "frege_page_links",
    description:
      "Get the outgoing links, incoming backlinks, and unresolved (dangling) links for one brain page. Use to see how a specific page relates to the rest of the vault.",
    inputSchema: {
      type: "object",
      properties: { slug: { type: "string" } },
      required: ["slug"],
    },
  },
  {
    name: "frege_traverse",
    description:
      "Traverse the brain graph. With a slug, returns the neighborhood subgraph (nodes + edges) up to `depth` hops from that page. Without a slug, returns the whole vault graph. Use to understand clusters and how concepts connect.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        depth: { type: "number", minimum: 1, maximum: 3 },
        limit: { type: "number", minimum: 1, maximum: 1000 },
      },
    },
  },
  {
    name: "frege_find_connections",
    description:
      "Find the shortest path of links between two brain pages (undirected). Answers 'how is X related to Y' — something vector search cannot. Returns the path of pages and the hop count, or connected:false if none within max_hops.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
        max_hops: { type: "number", minimum: 1, maximum: 6 },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "frege_add_source_proposal",
    description: "Propose a new hosted brain source. Proposals require admin acceptance before becoming canonical.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        name: { type: "string" },
        trust_zone: { type: "string", enum: ["green", "red"] },
        session_id: { type: "string" },
        metadata: { type: "object" },
      },
      required: ["slug", "name"],
    },
  },
  {
    name: "frege_write_page_proposal",
    description: "Propose a hosted brain page create/update with markdown body and optional session evidence.",
    inputSchema: {
      type: "object",
      properties: {
        proposal_type: { type: "string", enum: ["page_create", "page_update"] },
        slug: { type: "string" },
        title: { type: "string" },
        body_md: { type: "string" },
        summary: { type: "string" },
        trust_zone: { type: "string", enum: ["green", "red"] },
        session_id: { type: "string" },
        source_ids: { type: "array", items: { type: "string" } },
        evidence_event_ids: { type: "array", items: { type: "string" } },
        metadata: { type: "object" },
      },
      required: ["body_md"],
    },
  },
  {
    name: "frege_start_session",
    description: "Start or attach to a Frege org-visible agent task session.",
    inputSchema: {
      type: "object",
      properties: {
        external_id: { type: "string" },
        client: { type: "string" },
        title: { type: "string" },
        goal: { type: "string" },
        trust_zone: { type: "string", enum: ["green", "red"] },
        metadata: { type: "object" },
      },
    },
  },
  {
    name: "frege_list_agents",
    description: "List Frege-hosted agents visible to this actor.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "frege_run_agent",
    description: "Queue a Frege-hosted agent run. The Frege Agent Runtime executes it asynchronously.",
    inputSchema: {
      type: "object",
      properties: {
        agent_slug: { type: "string" },
        input_md: { type: "string" },
        context_query: { type: "string" },
        session_id: { type: "string" },
        trust_zone: { type: "string", enum: ["green", "red"] },
        max_steps: { type: "number", minimum: 1, maximum: 10 },
        metadata: { type: "object" },
      },
      required: ["agent_slug", "input_md"],
    },
  },
  {
    name: "frege_get_agent_run",
    description: "Read a Frege-hosted agent run and step ledger.",
    inputSchema: {
      type: "object",
      properties: { run_id: { type: "string" } },
      required: ["run_id"],
    },
  },
  {
    name: "frege_append_session_event",
    description: "Append a redacted raw task event to a Frege agent session ledger.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        event_type: {
          type: "string",
          enum: [
            "user_message",
            "assistant_message",
            "tool_call",
            "tool_result",
            "context_build",
            "model_invoke",
            "memory_signal",
            "note",
          ],
        },
        body_md: { type: "string" },
        payload: { type: "object" },
        trust_zone: { type: "string", enum: ["green", "red"] },
        source_ids: { type: "array", items: { type: "string" } },
      },
      required: ["session_id", "event_type"],
    },
  },
  {
    name: "frege_get_session",
    description: "Read a Frege agent task session and visible events.",
    inputSchema: {
      type: "object",
      properties: { session_id: { type: "string" } },
      required: ["session_id"],
    },
  },
  {
    name: "frege_search_sessions",
    description: "Search org-visible Frege agent sessions if this actor role permits ledger reads.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: "frege_list_documents",
    description: "List documents visible to the Frege API key.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", minimum: 1, maximum: 50 } },
    },
  },
  {
    name: "frege_search_documents",
    description: "Search documents visible to the Frege API key.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 25 },
      },
      required: ["query"],
    },
  },
  {
    name: "frege_read_document",
    description: "Read a visible document by slug.",
    inputSchema: {
      type: "object",
      properties: { slug: { type: "string" } },
      required: ["slug"],
    },
  },
  {
    name: "frege_build_context",
    description: "Build a governed Frege context packet.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        slug: { type: "string" },
        session_id: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 25 },
      },
    },
  },
  {
    name: "frege_propose_memory_from_session",
    description: "Create a memory proposal backed by session evidence.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        proposal_type: { type: "string", enum: ["page_create", "page_update"] },
        slug: { type: "string" },
        title: { type: "string" },
        body_md: { type: "string" },
        summary: { type: "string" },
        trust_zone: { type: "string", enum: ["green", "red"] },
        source_ids: { type: "array", items: { type: "string" } },
        evidence_event_ids: { type: "array", items: { type: "string" } },
      },
      required: ["session_id", "body_md"],
    },
  },
  {
    name: "frege_create_document",
    description: "Create a document through Frege permissions and audit.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        path: { type: "string" },
        title: { type: "string" },
        sensitivity: { type: "string", enum: ["public", "internal", "restricted"] },
        status: { type: "string", enum: ["draft", "published", "archived"] },
        tags: { type: "array", items: { type: "string" } },
        body_md: { type: "string" },
        summary: { type: "string" },
      },
      required: ["path", "title", "sensitivity", "body_md"],
    },
  },
  {
    name: "frege_propose_revision",
    description: "Propose a document revision through Frege permissions and audit.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        proposed_body_md: { type: "string" },
        summary: { type: "string" },
      },
      required: ["slug", "proposed_body_md"],
    },
  },
  {
    name: "frege_audit_events",
    description: "List audit events visible to the Frege API key.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string" },
        resource_type: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 100 },
      },
    },
  },
  {
    name: "frege_invoke_model",
    description: "Invoke a configured model through Frege context and trust-zone gates.",
    inputSchema: {
      type: "object",
      properties: {
        model_config_slug: { type: "string" },
        prompt: { type: "string" },
        context_build_id: { type: "string" },
        session_id: { type: "string" },
        query: { type: "string" },
        slug: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 25 },
        max_tokens: { type: "number", minimum: 1, maximum: 4096 },
      },
      required: ["model_config_slug", "prompt"],
    },
  },
];

function parseArgs(argv) {
  const args = { _: [] };
  const setArg = (key, value) => {
    if (args[key] === undefined) {
      args[key] = value;
    } else if (Array.isArray(args[key])) {
      args[key].push(value);
    } else {
      args[key] = [args[key], value];
    }
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      args._.push(item);
      continue;
    }

    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      setArg(key, true);
      continue;
    }

    setArg(key, next);
    index += 1;
  }
  return args;
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

async function readConfig() {
  try {
    return JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

async function writeConfig(config) {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: constants.S_IRUSR | constants.S_IWUSR });
}

async function runtimeConfig() {
  const stored = await readConfig();
  return {
    baseUrl: normalizeBaseUrl(process.env.FREGE_BASE_URL || stored.baseUrl),
    apiKey: process.env.FREGE_API_KEY || stored.apiKey || "",
  };
}

function isTransientNetworkError(err) {
  const code = err?.cause?.code ?? err?.code ?? "";
  return (
    err?.name === "AbortError" ||
    ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT"].includes(code)
  );
}

async function frege(pathname, options = {}) {
  const { baseUrl, apiKey } = options.config ?? (await runtimeConfig());
  if (!apiKey) {
    throw new Error(`FREGE_API_KEY is not set and ${CONFIG_PATH} has no apiKey. Run frege connect first.`);
  }

  const url = `${baseUrl}${pathname}`;
  const maxAttempts = 3;
  let lastErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(url, {
        method: options.method ?? "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(JSON.stringify({ status: response.status, error: json.error ?? "request_failed" }));
      }
      return json;
    } catch (err) {
      lastErr = err;
      // Only retry transient connection failures (e.g. dev server recompiling,
      // stale keep-alive socket). HTTP error responses are not retried.
      if (attempt < maxAttempts && isTransientNetworkError(err)) {
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
        continue;
      }
      if (isTransientNetworkError(err)) {
        const code = err?.cause?.code ?? err?.code ?? err?.name ?? "network_error";
        throw new Error(`Cannot connect to Frege API at ${baseUrl} (${code}) after ${maxAttempts} attempts. Is the server running?`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastErr;
}

function queryString(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const output = search.toString();
  return output ? `?${output}` : "";
}

function asArray(value) {
  if (value === undefined || value === null || value === false) return [];
  if (Array.isArray(value)) return value.flatMap(asArray);
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstValue(value, fallback = undefined) {
  if (Array.isArray(value)) return value.at(-1) ?? fallback;
  return value ?? fallback;
}

function normalizeRelPath(value) {
  return String(value).replace(/\\/g, "/").replace(/^\.\//, "");
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegExp(pattern) {
  const glob = normalizeRelPath(pattern);
  let regex = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    const next = glob[index + 1];
    const afterNext = glob[index + 2];

    if (char === "*" && next === "*" && afterNext === "/") {
      regex += "(?:.*/)?";
      index += 2;
      continue;
    }
    if (char === "*" && next === "*") {
      regex += ".*";
      index += 1;
      continue;
    }
    if (char === "*") {
      regex += "[^/]*";
      continue;
    }
    if (char === "?") {
      regex += "[^/]";
      continue;
    }
    regex += escapeRegex(char);
  }
  return new RegExp(`^${regex}$`);
}

function matchesAny(relPath, patterns) {
  const normalized = normalizeRelPath(relPath);
  return patterns.some((pattern) => globToRegExp(pattern).test(normalized));
}

function slugify(value) {
  const slug = String(value)
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "document";
}

function normalizeTag(value) {
  return slugify(value).slice(0, 48);
}

function uniqueTags(values) {
  return [...new Set(values.map(normalizeTag).filter(Boolean))];
}

function titleFromMarkdown(body, fallback) {
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || fallback;
}

function summaryFromMarkdown(body) {
  return body
    .replace(/^#+\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function documentSlugFromInput(input) {
  if (input.slug) return input.slug;
  const filename = String(input.path || "")
    .split("/")
    .filter(Boolean)
    .at(-1);
  return slugify(filename ?? input.title);
}

async function walkFiles(root) {
  const output = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".next") continue;
    if (entry.isDirectory()) {
      output.push(...(await walkFiles(entryPath)));
    } else if (entry.isFile()) {
      output.push(entryPath);
    }
  }
  return output;
}

async function collectDocumentFiles(targetPath, options = {}) {
  const baseDir = path.resolve(options.base ?? process.cwd());
  const absoluteTarget = path.resolve(baseDir, targetPath);
  const info = await stat(absoluteTarget);

  if (info.isFile()) {
    return [absoluteTarget];
  }
  if (!info.isDirectory()) {
    throw new Error(`Not a file or directory: ${targetPath}`);
  }

  const include = options.include?.length ? options.include : ["**/*.md"];
  const exclude = options.exclude ?? [];
  const files = await walkFiles(absoluteTarget);
  return files.filter((file) => {
    const relToTarget = normalizeRelPath(path.relative(absoluteTarget, file));
    const relToBase = normalizeRelPath(path.relative(baseDir, file));
    return (
      (matchesAny(relToTarget, include) || matchesAny(relToBase, include)) &&
      !matchesAny(relToTarget, exclude) &&
      !matchesAny(relToBase, exclude)
    );
  });
}

async function documentInputFromFile(file, options = {}) {
  const baseDir = path.resolve(options.base ?? process.cwd());
  const relPath = normalizeRelPath(path.relative(baseDir, file));
  const body = await readFile(file, "utf8");
  const fallbackTitle = path.basename(file).replace(/\.md$/i, "").replace(/[-_]+/g, " ");
  const title = options.title ?? titleFromMarkdown(body, fallbackTitle);
  const input = {
    slug: options.slug,
    path: options.path ?? relPath,
    title,
    sensitivity: options.sensitivity ?? "internal",
    status: options.status ?? "published",
    tags: uniqueTags(options.tags ?? []),
    summary: options.summary ?? summaryFromMarkdown(body),
    body_md: body,
  };
  if (!input.slug) delete input.slug;
  return input;
}

function httpStatusFromError(err) {
  try {
    const parsed = JSON.parse(err?.message ?? "{}");
    return Number(parsed.status) || null;
  } catch {
    return null;
  }
}

async function writeDocument(input, options = {}) {
  if (options.dryRun) {
    return { action: "planned", document: { slug: documentSlugFromInput(input), ...input } };
  }

  try {
    const created = await frege("/api/v1/documents", { method: "POST", body: input });
    return { action: "created", document: created.document };
  } catch (err) {
    if (options.createOnly || httpStatusFromError(err) !== 409) throw err;
  }

  const slug = documentSlugFromInput(input);
  const updated = await frege(`/api/v1/documents/${encodeURIComponent(slug)}`, {
    method: "PUT",
    body: {
      title: input.title,
      sensitivity: input.sensitivity,
      status: input.status,
      tags: input.tags,
      summary: input.summary,
      body_md: input.body_md,
    },
  });
  return { action: "updated", document: updated.document };
}

function formatDocumentWrite(result) {
  const doc = result.document ?? {};
  const revision = doc.revision_number ? ` rev ${doc.revision_number}` : "";
  return `${result.action}: ${doc.slug ?? "-"} (${doc.path ?? "-"})${revision}`;
}

function parseScalar(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  return trimmed.replace(/^["']|["']$/g, "");
}

function parseSimpleManifest(text, filename) {
  if (/\.json$/i.test(filename)) return JSON.parse(text);

  const manifest = { defaults: {}, documents: [] };
  let section = null;
  let currentDocument = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const withoutComment = rawLine.replace(/\s+#.*$/, "");
    if (!withoutComment.trim()) continue;

    const topLevel = withoutComment.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (topLevel) {
      const [, key, value] = topLevel;
      if (key === "defaults" || key === "documents") {
        section = key;
        currentDocument = null;
        continue;
      }
      manifest[key] = parseScalar(value);
      section = null;
      currentDocument = null;
      continue;
    }

    if (section === "defaults") {
      const field = withoutComment.match(/^\s+([a-zA-Z0-9_-]+):\s*(.*)$/);
      if (field) manifest.defaults[field[1]] = parseScalar(field[2]);
      continue;
    }

    if (section === "documents") {
      const item = withoutComment.match(/^\s*-\s+([a-zA-Z0-9_-]+):\s*(.*)$/);
      if (item) {
        currentDocument = { [item[1]]: parseScalar(item[2]) };
        manifest.documents.push(currentDocument);
        continue;
      }
      const field = withoutComment.match(/^\s+([a-zA-Z0-9_-]+):\s*(.*)$/);
      if (field && currentDocument) currentDocument[field[1]] = parseScalar(field[2]);
    }
  }

  return manifest;
}

async function callTool(name, input = {}) {
  if (name === "frege_status") return frege("/api/v1/me");
  if (name === "frege_brain_status") return frege("/api/v1/brain/status");
  if (name === "frege_list_sources") return frege(`/api/v1/brain/sources${queryString({ limit: input.limit })}`);
  if (name === "frege_search_pages") {
    return frege(`/api/v1/brain/pages/search${queryString({ q: input.query, limit: input.limit })}`);
  }
  if (name === "frege_get_page") return frege(`/api/v1/brain/pages/${encodeURIComponent(input.slug)}`);
  if (name === "frege_list_vault") return frege(`/api/v1/brain/vault${queryString({ limit: input.limit })}`);
  if (name === "frege_page_links") {
    return frege(`/api/v1/brain/pages/${encodeURIComponent(input.slug)}/links`);
  }
  if (name === "frege_traverse") {
    return frege(`/api/v1/brain/graph${queryString({ slug: input.slug, depth: input.depth, limit: input.limit })}`);
  }
  if (name === "frege_find_connections") {
    return frege(`/api/v1/brain/connections${queryString({ from: input.from, to: input.to, max_hops: input.max_hops })}`);
  }
  if (name === "frege_add_source_proposal") {
    return frege("/api/v1/brain/sources", {
      method: "POST",
      body: {
        slug: input.slug,
        name: input.name,
        trust_zone: input.trust_zone ?? "green",
        session_id: input.session_id,
        metadata: input.metadata ?? {},
      },
    });
  }
  if (name === "frege_write_page_proposal") {
    return frege("/api/v1/brain/proposals", {
      method: "POST",
      body: {
        proposal_type: input.proposal_type ?? "page_create",
        slug: input.slug,
        title: input.title,
        body_md: input.body_md,
        summary: input.summary,
        trust_zone: input.trust_zone ?? "green",
        source_ids: input.source_ids ?? [],
        session_id: input.session_id,
        evidence_event_ids: input.evidence_event_ids ?? [],
        metadata: input.metadata ?? {},
      },
    });
  }
  if (name === "frege_start_session") {
    return frege("/api/v1/sessions", {
      method: "POST",
      body: {
        external_id: input.external_id,
        client: input.client ?? "unknown",
        title: input.title,
        goal: input.goal,
        trust_zone: input.trust_zone ?? "green",
        metadata: input.metadata ?? {},
      },
    });
  }
  if (name === "frege_list_agents") return frege("/api/v1/agents");
  if (name === "frege_run_agent") {
    return frege("/api/v1/agents", {
      method: "POST",
      body: {
        agent_slug: input.agent_slug,
        input_md: input.input_md,
        context_query: input.context_query,
        session_id: input.session_id,
        trust_zone: input.trust_zone,
        max_steps: input.max_steps,
        metadata: input.metadata ?? {},
      },
    });
  }
  if (name === "frege_get_agent_run") {
    return frege(`/api/v1/agent-runs/${encodeURIComponent(input.run_id)}`);
  }
  if (name === "frege_append_session_event") {
    return frege(`/api/v1/sessions/${encodeURIComponent(input.session_id)}/events`, {
      method: "POST",
      body: {
        event_type: input.event_type,
        body_md: input.body_md ?? "",
        payload: input.payload ?? {},
        trust_zone: input.trust_zone ?? "green",
        source_ids: input.source_ids ?? [],
      },
    });
  }
  if (name === "frege_get_session") {
    return frege(`/api/v1/sessions/${encodeURIComponent(input.session_id)}`);
  }
  if (name === "frege_search_sessions") {
    return frege(`/api/v1/sessions${queryString({ q: input.query, limit: input.limit })}`);
  }
  if (name === "frege_list_documents") return frege(`/api/v1/documents${queryString({ limit: input.limit })}`);
  if (name === "frege_search_documents") {
    return frege(`/api/v1/documents/search${queryString({ q: input.query, limit: input.limit })}`);
  }
  if (name === "frege_read_document") return frege(`/api/v1/documents/${encodeURIComponent(input.slug)}`);
  if (name === "frege_build_context") {
    return frege("/api/v1/context/build", {
      method: "POST",
      body: { query: input.query ?? "", slug: input.slug, session_id: input.session_id, limit: input.limit ?? 8 },
    });
  }
  if (name === "frege_propose_memory_from_session") {
    return frege("/api/v1/brain/proposals", {
      method: "POST",
      body: {
        proposal_type: input.proposal_type ?? "page_create",
        slug: input.slug,
        title: input.title,
        body_md: input.body_md,
        summary: input.summary,
        trust_zone: input.trust_zone ?? "green",
        source_ids: input.source_ids ?? [],
        session_id: input.session_id,
        evidence_event_ids: input.evidence_event_ids ?? [],
      },
    });
  }
  if (name === "frege_create_document") {
    return frege("/api/v1/documents", {
      method: "POST",
      body: {
        slug: input.slug,
        path: input.path,
        title: input.title,
        sensitivity: input.sensitivity,
        status: input.status ?? "published",
        tags: input.tags ?? [],
        summary: input.summary,
        body_md: input.body_md,
      },
    });
  }
  if (name === "frege_propose_revision") {
    return frege(`/api/v1/documents/${encodeURIComponent(input.slug)}/proposals`, {
      method: "POST",
      body: { proposed_body_md: input.proposed_body_md, summary: input.summary },
    });
  }
  if (name === "frege_audit_events") {
    return frege(`/api/v1/audit-events${queryString({
      action: input.action,
      resource_type: input.resource_type,
      limit: input.limit,
    })}`);
  }
  if (name === "frege_invoke_model") {
    return frege("/api/v1/model/invoke", {
      method: "POST",
      body: {
        model_config_slug: input.model_config_slug,
        prompt: input.prompt,
        context_build_id: input.context_build_id,
        session_id: input.session_id,
        query: input.query,
        slug: input.slug,
        limit: input.limit ?? 8,
        max_tokens: input.max_tokens ?? 800,
      },
    });
  }
  throw new Error(`unknown_tool:${name}`);
}

function send(message) {
  debug(`send:${message.method ?? "response"}:${message.id ?? "notification"}`);
  const payload = JSON.stringify(message);
  if (outputFraming === "jsonl") {
    process.stdout.write(`${payload}\n`);
    return;
  }
  process.stdout.write(`Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`);
}

function debug(message) {
  if (!DEBUG_LOG_PATH) return;
  appendFileSync(DEBUG_LOG_PATH, `${new Date().toISOString()} ${message}\n`);
}

function result(id, value) {
  send({ jsonrpc: "2.0", id, result: value });
}

function error(id, err) {
  send({
    jsonrpc: "2.0",
    id,
    error: {
      code: -32000,
      message: err instanceof Error ? err.message : String(err),
    },
  });
}

async function handle(message) {
  debug(`recv:${message.method ?? "unknown"}:${message.id ?? "notification"}`);
  if (message.method === "initialize") {
    result(message.id, {
      protocolVersion: message.params?.protocolVersion ?? "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "frege-mcp", version: "0.1.1" },
    });
    return;
  }

  if (message.method === "notifications/initialized") return;

  if (message.method === "tools/list") {
    result(message.id, { tools });
    return;
  }

  if (message.method === "tools/call") {
    try {
      const output = await callTool(message.params?.name, message.params?.arguments ?? {});
      result(message.id, {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      });
    } catch (err) {
      error(message.id, err);
    }
    return;
  }

  if (message.id !== undefined) error(message.id, new Error(`unknown_method:${message.method}`));
}

function serve() {
  let buffer = Buffer.alloc(0);
  let loggedUnparsedInput = false;
  debug("serve:start");

  process.stdin.on("data", (chunk) => {
    debug(`stdin:${chunk.length}`);
    buffer = Buffer.concat([buffer, chunk]);

    while (true) {
      let headerEnd = buffer.indexOf("\r\n\r\n");
      let separatorLength = 4;
      if (headerEnd === -1) {
        headerEnd = buffer.indexOf("\n\n");
        separatorLength = 2;
      }
      if (headerEnd === -1) {
        const lineEnd = buffer.indexOf("\n");
        if (lineEnd === -1) return;

        const line = buffer.slice(0, lineEnd).toString("utf8").trim();
        buffer = buffer.slice(lineEnd + 1);
        if (!line) continue;
        if (!line.startsWith("{")) {
          debug(`unrecognized_line:${line.slice(0, 120)}`);
          continue;
        }

        try {
          outputFraming = "jsonl";
          void handle(JSON.parse(line));
        } catch (err) {
          debug(`jsonl_parse_error:${err instanceof Error ? err.message : String(err)}`);
          console.error("Frege MCP parse error", err);
        }
        continue;
      }

      const header = buffer.slice(0, headerEnd).toString("utf8");
      const lengthMatch = /^Content-Length:\s*(\d+)/im.exec(header);
      if (!lengthMatch) {
        debug(`bad_header:${header.replace(/\s+/g, " ").slice(0, 120)}`);
        buffer = Buffer.alloc(0);
        return;
      }

      const length = Number(lengthMatch[1]);
      const messageStart = headerEnd + separatorLength;
      const messageEnd = messageStart + length;
      if (buffer.length < messageEnd) return;

      const payload = buffer.slice(messageStart, messageEnd).toString("utf8");
      buffer = buffer.slice(messageEnd);

      try {
        void handle(JSON.parse(payload));
      } catch (err) {
        debug(`parse_error:${err instanceof Error ? err.message : String(err)}`);
        console.error("Frege MCP parse error", err);
      }
    }
  });

  process.stdin.on("end", () => {
    if (buffer.length > 0 && !loggedUnparsedInput) {
      loggedUnparsedInput = true;
      debug(`leftover:${buffer.length}:${JSON.stringify(buffer.toString("utf8").slice(0, 500))}`);
    }
    debug("stdin:end");
  });
  process.on("exit", (code) => debug(`process:exit:${code}`));
}

const MCP_CLIENTS = [
  { id: "claude", bin: "claude", label: "Claude Code" },
  { id: "codex", bin: "codex", label: "Codex" },
];

function hasCommand(bin) {
  const probe = process.platform === "win32" ? "where" : "command";
  const probeArgs = process.platform === "win32" ? [bin] : ["-v", bin];
  const result = spawnSync(probe, probeArgs, { stdio: "ignore", shell: process.platform === "win32" });
  return result.status === 0;
}

function registerMcpClient(client) {
  // Idempotent: remove any prior registration, then add. Ignore remove failures.
  spawnSync(client.bin, ["mcp", "remove", "frege"], { stdio: "ignore" });
  const result = spawnSync(client.bin, ["mcp", "add", "frege", "--", "frege", "mcp", "serve"], {
    stdio: "inherit",
  });
  return result.status === 0;
}

async function verifyConnection(config) {
  try {
    const me = await frege("/api/v1/me", config ? { config } : {});
    if (me.organization?.status !== "active") {
      return {
        ok: false,
        error: JSON.stringify({
          status: 403,
          error: "org_inactive",
          org_status: me.organization?.status ?? "unknown",
        }),
      };
    }
    return { ok: true, me };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function connect(args) {
  const baseUrl = normalizeBaseUrl(args["base-url"] || args._[1] || DEFAULT_BASE_URL);
  const apiKey = args.token || args["api-key"] || process.env.FREGE_API_KEY;
  if (!apiKey) {
    throw new Error("Missing token. Use: frege connect https://frege.dev --token VALID_FRG_LIVE_KEY");
  }

  const verification = await verifyConnection({ baseUrl, apiKey });
  if (!verification.ok) {
    console.log("Frege connection failed. Config was not saved and MCP was not registered.");
    console.log(`  ${verification.error}`);
    console.log("Use a valid Frege API key for an active org, then run frege connect again.");
    process.exitCode = 1;
    return;
  }

  await writeConfig({
    baseUrl,
    apiKey,
    connectedAt: new Date().toISOString(),
  });
  console.log(`Frege config saved to ${CONFIG_PATH}`);

  const { me } = verification;
  console.log(
    `Connected: org ${me.organization?.slug ?? "unknown"} (${me.organization?.status ?? "unknown"}), role ${me.role?.slug ?? "unknown"}, key ${me.key?.prefix ?? "unknown"}`,
  );

  if (args["no-register"]) {
    console.log("");
    console.log("Skipped MCP client registration (--no-register).");
    console.log("Register manually with: frege agent install claude|codex");
    return;
  }

  const detected = MCP_CLIENTS.filter((client) => hasCommand(client.bin));
  if (detected.length === 0) {
    console.log("");
    console.log("No MCP client CLI detected (claude, codex).");
    console.log("After installing one, run: frege agent install claude  (or codex)");
    return;
  }

  console.log("");
  for (const client of detected) {
    process.stdout.write(`Registering Frege with ${client.label}... `);
    const ok = registerMcpClient(client);
    console.log(ok ? "done" : "failed (register manually: frege agent install " + client.id + ")");
  }

  console.log("");
  console.log("You're set. Restart your MCP client if it was already running.");
  console.log("The agent now has Frege tools for org memory and never touches the database directly.");
}

async function doctor() {
  const { baseUrl, apiKey } = await runtimeConfig();
  console.log(`baseUrl: ${baseUrl}`);
  console.log(`apiKey: ${apiKey ? "set" : "missing"}`);
  const me = await frege("/api/v1/me");
  console.log(`org: ${me.organization?.slug ?? "unknown"}`);
  console.log(`orgStatus: ${me.organization?.status ?? "unknown"}`);
  console.log(`role: ${me.role?.slug ?? "unknown"}`);
  console.log(`key: ${me.key?.prefix ?? "unknown"}`);
  if (me.organization?.status !== "active") {
    console.log("Frege MCP requires an active org. Complete billing/activation or use a key from an active org.");
    process.exitCode = 1;
  }
}

async function status() {
  const me = await frege("/api/v1/me");
  console.log(JSON.stringify(me, null, 2));
}

async function listDocuments(args) {
  const docs = await frege(`/api/v1/documents${queryString({ limit: args.limit })}`);
  console.log(JSON.stringify(docs, null, 2));
}

async function readDocumentCli(args) {
  const slug = args._[2] || args.slug || "";
  if (!slug) throw new Error("Missing slug. Use: frege docs read SLUG");
  const doc = await frege(`/api/v1/documents/${encodeURIComponent(slug)}`);
  if (args.body) {
    console.log(doc.document?.body_md ?? "");
    return;
  }
  console.log(JSON.stringify(doc, null, 2));
}

async function searchDocuments(args) {
  const query = args._.slice(1).join(" ") || args.query || args.q;
  if (!query) throw new Error('Missing query. Use: frege search "refund policy"');
  const docs = await frege(`/api/v1/documents/search${queryString({ q: query, limit: args.limit })}`);
  console.log(JSON.stringify(docs, null, 2));
}

async function searchDocumentsFromDocsCommand(args) {
  const query = args._.slice(2).join(" ") || args.query || args.q;
  if (!query) throw new Error('Missing query. Use: frege docs search "refund policy"');
  const docs = await frege(`/api/v1/documents/search${queryString({ q: query, limit: args.limit })}`);
  console.log(JSON.stringify(docs, null, 2));
}

async function buildContextCli(args) {
  const query = args._.slice(1).join(" ") || args.query || "";
  const packet = await frege("/api/v1/context/build", {
    method: "POST",
    body: {
      query,
      slug: args.slug,
      limit: args.limit ? Number(args.limit) : 8,
    },
  });
  console.log(JSON.stringify(packet, null, 2));
}

async function pushDocumentsCli(args) {
  const target = args._[2];
  if (!target) throw new Error("Missing path. Use: frege docs push FILE_OR_DIRECTORY");

  const base = firstValue(args.base, process.cwd());
  const files = await collectDocumentFiles(target, {
    base,
    include: asArray(args.include),
    exclude: asArray(args.exclude),
  });
  if (files.length === 0) {
    console.log("No matching markdown files.");
    return;
  }

  const common = {
    base,
    sensitivity: firstValue(args.sensitivity, "internal"),
    status: firstValue(args.status, "published"),
    tags: asArray(args.tag).concat(asArray(args.tags)),
    summary: firstValue(args.summary),
  };
  const dryRun = Boolean(args["dry-run"]);
  const results = [];

  for (const file of files) {
    const perFile = files.length === 1
      ? {
          title: firstValue(args.title),
          slug: firstValue(args.slug),
          path: firstValue(args.path),
        }
      : {};
    const input = await documentInputFromFile(file, { ...common, ...perFile });
    const result = await writeDocument(input, {
      dryRun,
      createOnly: Boolean(args["create-only"]),
    });
    results.push(result);
    console.log(formatDocumentWrite(result));
  }

  if (args.json) console.log(JSON.stringify({ documents: results }, null, 2));
}

async function syncDocumentsCli(args) {
  const manifestPath = args._[2] || "frege.docs.yml";
  const manifestFile = path.resolve(process.cwd(), manifestPath);
  const manifest = parseSimpleManifest(await readFile(manifestFile, "utf8"), manifestFile);
  const base = path.resolve(path.dirname(manifestFile), manifest.base ?? ".");
  const defaults = manifest.defaults ?? {};
  const documents = Array.isArray(manifest.documents) ? manifest.documents : [];
  if (documents.length === 0) throw new Error(`No documents in ${manifestPath}`);

  const dryRun = Boolean(args["dry-run"]);
  const results = [];
  for (const entry of documents) {
    if (!entry.path) throw new Error(`Document entry is missing path in ${manifestPath}`);
    const files = await collectDocumentFiles(entry.path, {
      base,
      include: asArray(entry.include ?? defaults.include),
      exclude: asArray(entry.exclude ?? defaults.exclude),
    });
    for (const file of files) {
      const input = await documentInputFromFile(file, {
        base,
        sensitivity: entry.sensitivity ?? defaults.sensitivity ?? "internal",
        status: entry.status ?? defaults.status ?? "published",
        tags: asArray(defaults.tags).concat(asArray(entry.tags)),
        title: entry.title,
        slug: entry.slug,
        summary: entry.summary,
      });
      const result = await writeDocument(input, {
        dryRun,
        createOnly: Boolean(args["create-only"] || entry.create_only),
      });
      results.push(result);
      console.log(formatDocumentWrite(result));
    }
  }

  if (args.json) console.log(JSON.stringify({ documents: results }, null, 2));
}

async function installAgent(args) {
  const agent = args._[2] || args.agent || "";
  const client = MCP_CLIENTS.find((entry) => entry.id === agent);
  if (!client) {
    throw new Error("Missing or unknown agent. Use: frege agent install claude|codex");
  }
  if (!hasCommand(client.bin)) {
    throw new Error(`${client.label} CLI ('${client.bin}') not found on PATH. Install it first.`);
  }

  process.stdout.write(`Registering Frege with ${client.label}... `);
  const ok = registerMcpClient(client);
  if (!ok) {
    console.log("failed");
    throw new Error(`Could not register with ${client.label}. Run manually: ${client.bin} mcp add frege -- frege mcp serve`);
  }
  console.log("done");
  console.log("Restart your MCP client if it was already running.");
}

function printHelp() {
  console.log(`frege

Usage:
  frege connect BASE_URL --token VALID_FRG_LIVE_KEY   connect + verify + auto-register MCP clients
  frege connect ... --no-register                   connect without registering MCP clients
  frege doctor                                       check stored config and connectivity
  frege status
  frege docs list
  frege docs read SLUG [--body]
  frege docs search "query"
  frege docs push FILE_OR_DIRECTORY --sensitivity internal --tag product
  frege docs push docs --include "**/*.md" --exclude "**/private/**" --dry-run
  frege docs sync frege.docs.yml [--dry-run]
  frege search "query"
  frege context "query"
  frege mcp serve
  frege agent install claude|codex                   register Frege with an MCP client

Compatibility:
  frege-mcp serve
  frege-mcp doctor
  frege-mcp connect BASE_URL --token VALID_FRG_LIVE_KEY

Env:
  FREGE_BASE_URL   overrides stored baseUrl
  FREGE_API_KEY    overrides stored apiKey

Local config:
  ${CONFIG_PATH}
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h || args._[0] === "help" || args._[0] === "--help" || args._[0] === "-h") {
    printHelp();
    return;
  }
  const command = args._[0] ?? "serve";
  const subcommand = args._[1];
  if (command === "mcp" && subcommand === "serve") {
    serve();
    return;
  }
  if (command === "serve") {
    serve();
    return;
  }
  if (command === "connect") {
    await connect(args);
    return;
  }
  if (command === "doctor") {
    await doctor();
    return;
  }
  if (command === "status") {
    await status();
    return;
  }
  if (command === "docs" || command === "documents") {
    if (!subcommand || subcommand === "list") {
      await listDocuments(args);
      return;
    }
    if (subcommand === "read") {
      await readDocumentCli(args);
      return;
    }
    if (subcommand === "search") {
      await searchDocumentsFromDocsCommand(args);
      return;
    }
    if (subcommand === "push") {
      await pushDocumentsCli(args);
      return;
    }
    if (subcommand === "sync") {
      await syncDocumentsCli(args);
      return;
    }
    throw new Error(`Unknown docs command: ${subcommand}`);
  }
  if (command === "search") {
    await searchDocuments(args);
    return;
  }
  if (command === "context") {
    await buildContextCli(args);
    return;
  }
  if (command === "agent" && subcommand === "install") {
    await installAgent(args);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
