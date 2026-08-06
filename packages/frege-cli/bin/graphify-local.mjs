import { spawn } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

const FORK_URL = "https://github.com/Finberg-Laurelin-CEO/graphify-frege";
const FORK_COMMIT = "ca4785446bd17c38edac11aafebe962230fdee49";
const INSTALL_HINT = `Install the compatible fork: uv tool install --force git+${FORK_URL}.git@${FORK_COMMIT}`;
const SCHEMA = "frege.graphify.code-graph";
const VERSION = 1;
const MIN_GRAPHIFY_VERSION = [0, 9, 34];
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
const MAX_GRAPH_BYTES = 64 * 1024 * 1024;
const MAX_NODES = 50_000;
const MAX_EDGES = 200_000;
const MAX_QUERY_CHARS = 2_000;
const MAX_QUERY_BUDGET = 4_000;
const MAX_PROCESS_OUTPUT = 64 * 1024;
// The Graphify child receives only what an installed local executable needs:
// executable resolution, home/temp directories, platform essentials on
// Windows, locale, and the Graphify settings this adapter itself owns. It
// never receives FREGE_API_KEY, database URLs, or other application secrets.
const CHILD_ENV_KEYS = [
  "PATH", "PATHEXT",
  "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
  "TMPDIR", "TEMP", "TMP",
  "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC",
  "LANG", "LC_ALL", "LC_CTYPE", "LC_MESSAGES", "TZ",
  "GRAPHIFY_OUT", "GRAPHIFY_NO_TIPS",
];

function childEnvironment(env, testOnlyChildEnv) {
  const child = {};
  for (const key of CHILD_ENV_KEYS) {
    if (env[key] !== undefined) child[key] = env[key];
  }
  return { ...child, ...testOnlyChildEnv };
}

export const graphifyMcpTools = [
  {
    name: "frege_code_graph_query",
    description: "Query the opt-in local Graphify code graph. No request is sent to Frege.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", maxLength: MAX_QUERY_CHARS },
        budget: { type: "number", minimum: 1, maximum: MAX_QUERY_BUDGET },
      },
      required: ["query"],
    },
  },
  {
    name: "frege_code_context",
    description: "Combine local Graphify output with hosted Frege context. Only the query and limit are sent to Frege; the local graph and result stay local.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", maxLength: MAX_QUERY_CHARS },
        limit: { type: "number", minimum: 1, maximum: 25 },
        budget: { type: "number", minimum: 1, maximum: MAX_QUERY_BUDGET },
      },
      required: ["query"],
    },
  },
];

export function graphifyEnabled(env = process.env) {
  return env.FREGE_CODE_GRAPH === "true";
}

function projectPaths(cwd, env) {
  const root = path.resolve(cwd);
  const out = path.resolve(root, env.GRAPHIFY_OUT || "graphify-out");
  assertInside(root, out, "GRAPHIFY_OUT");
  return {
    root,
    out,
    graph: path.join(out, "graph.json"),
    artifact: path.join(out, "frege-code-graph.v1.json"),
  };
}

function assertInside(root, candidate, label) {
  const relative = path.relative(root, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside the current project.`);
  }
}

async function assertRealPathInside(root, candidate, label) {
  try {
    const [realRoot, realCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
    assertInside(realRoot, realCandidate, label);
  } catch (err) {
    if (err?.code === "ENOENT") throw err;
    if (err instanceof Error && err.message === `${label} must stay inside the current project.`) throw err;
    throw new Error(`${label} could not be resolved safely.`);
  }
}

async function assertProspectivePathInside(root, candidate, label) {
  const realRoot = await realpath(root);
  let probe = candidate;
  while (true) {
    try {
      assertInside(realRoot, await realpath(probe), label);
      return;
    } catch (err) {
      if (err?.code !== "ENOENT") {
        if (err instanceof Error && err.message === `${label} must stay inside the current project.`) throw err;
        throw new Error(`${label} could not be resolved safely.`);
      }
      if (probe === root) throw new Error(`${label} could not be resolved safely.`);
      probe = path.dirname(probe);
    }
  }
}

function positiveInteger(value, fallback, maximum, label) {
  const number = value === undefined ? fallback : typeof value === "boolean" ? NaN : Number(value);
  if (!Number.isInteger(number) || number < 1 || number > maximum) {
    throw new Error(`${label} must be an integer from 1 to ${maximum}.`);
  }
  return number;
}

function queryText(value) {
  const query = String(value ?? "").trim();
  if (!query || query.length > MAX_QUERY_CHARS || /[\0\r\n]/.test(query)) {
    throw new Error(`query must be a single line from 1 to ${MAX_QUERY_CHARS} characters.`);
  }
  return query;
}

export function runGraphify(argv, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const binary = env.FREGE_GRAPHIFY_BIN || "graphify";
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxOutputBytes = options.maxOutputBytes ?? MAX_PROCESS_OUTPUT;

  return new Promise((resolve, reject) => {
    let stdout = "";
    let outputBytes = 0;
    let settled = false;
    const child = spawn(binary, argv, {
      cwd,
      env: childEnvironment(env, options.testOnlyChildEnv),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(value);
    };
    const record = (chunk, keep) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        child.kill("SIGKILL");
        finish(new Error("Graphify output exceeded the safe local limit."));
        return;
      }
      if (keep) stdout += chunk.toString("utf8");
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("Graphify timed out. Narrow the project or query and try again."));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => record(chunk, true));
    child.stderr.on("data", (chunk) => record(chunk, false));
    child.once("error", (err) => {
      if (err?.code === "ENOENT") finish(new Error(`Graphify executable was not found. ${INSTALL_HINT}`));
      else finish(new Error("Graphify could not be started. Check FREGE_GRAPHIFY_BIN and file permissions."));
    });
    child.once("close", (code) => {
      if (code !== 0) {
        finish(new Error("Graphify failed safely. Run `frege code doctor` for compatibility and path checks."));
        return;
      }
      const output = stdout.replace(/\r\n/g, "\n").trim();
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(output)) {
        finish(new Error("Graphify returned unsafe control characters."));
        return;
      }
      finish(null, output);
    });
  });
}

async function graphifyVersion(options) {
  const output = await runGraphify(["--version"], { ...options, timeoutMs: 5_000, maxOutputBytes: 1_024 });
  const match = /^graphify\s+(\d+)\.(\d+)\.(\d+)(?:\b|[-+])/.exec(output);
  if (!match) throw new Error(`Graphify returned an unsupported version response. ${INSTALL_HINT}`);
  const version = match.slice(1).map(Number);
  const firstDifference = version.findIndex((part, index) => part !== MIN_GRAPHIFY_VERSION[index]);
  if (firstDifference >= 0 && version[firstDifference] < MIN_GRAPHIFY_VERSION[firstDifference]) {
    throw new Error(`Graphify 0.9.34 or newer is required. ${INSTALL_HINT}`);
  }
  return version.join(".");
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} does not match the Graphify v1 schema.`);
  }
}

// Mirrors the fork exporter's privacy predicate so the validator stays an
// independent second gate: any scheme:// URL, curated non-hierarchical URI
// schemes (a curated list, not a generic "word:" rule, so prose labels like
// "Args: ..." survive), and host paths — absolute POSIX/Windows, UNC,
// drive-relative, ~user/ — whether whole-value or embedded as a token.
const URL_SCHEME = /[A-Za-z][A-Za-z0-9+.-]*:\/\//;
const URI_SCHEMES = /(?:^|[\s"'()[\]{}<>,;=])(?:mailto|data|file|urn|tel|sms|callto|javascript|vbscript|blob|magnet|otpauth|ssh|scp|sftp|smb|nfs|ldap|ldaps|jdbc|odbc|redis|amqp|mongodb|postgres|postgresql|mysql|mssql|s3|gs|ftp|ftps|news|nntp|irc|vnc|rdp):\S/i;
const TOKEN_SEPARATORS = /[\s"'()[\]{}<>,;=]+/;
const BARE_SEPARATOR_TOKENS = new Set(["/", "//", "\\", "\\\\"]);

function hostPathToken(token) {
  // "c:" at index 1 (drive-relative or absolute), leading slash/backslash
  // (absolute or UNC), or "~<user>/" — but not "~Finalizer" or "std::name".
  return /^(?:[a-z]:|[\\/]|~[^\\/]*[\\/])/i.test(token);
}

function privacyUnsafe(value) {
  if (URL_SCHEME.test(value) || URI_SCHEMES.test(value)) return true;
  return value
    .split(TOKEN_SEPARATORS)
    .some((token) => token && !BARE_SEPARATOR_TOKENS.has(token) && hostPathToken(token));
}

function safeString(value, label, maximum = 1_024) {
  if (
    typeof value !== "string" || !value || value.length > maximum ||
    /[\x00-\x1f\x7f]/.test(value) || value !== value.trim()
  ) {
    throw new Error(`${label} must be a bounded single-line string without surrounding whitespace.`);
  }
  if (privacyUnsafe(value)) {
    throw new Error(`${label} must not contain an absolute host path or URI.`);
  }
  return value;
}

function relativePosixPath(value, label) {
  const clean = safeString(value, label);
  const parts = clean.split("/");
  if (
    clean.includes("\\") || clean.includes("://") || clean.startsWith("~") ||
    parts.some((part) => !part.trim() || part !== part.trim() || part === "." || part === "..")
  ) {
    throw new Error(`${label} must be a normalized relative POSIX path.`);
  }
  return clean;
}

function lineNumber(value, label) {
  if (value !== null && (!Number.isInteger(value) || value < 1 || value > 2_147_483_647)) {
    throw new Error(`${label} must be null or a positive integer.`);
  }
}

export function validateGraphifyArtifact(value) {
  exactKeys(value, ["schema", "version", "directed", "nodes", "edges"], "artifact");
  if (value.schema !== SCHEMA || value.version !== VERSION || value.directed !== true) {
    throw new Error("Graphify artifact schema/version is incompatible; run `frege code index`.");
  }
  if (!Array.isArray(value.nodes) || value.nodes.length > MAX_NODES) throw new Error(`Graphify artifact exceeds ${MAX_NODES} nodes.`);
  if (!Array.isArray(value.edges) || value.edges.length > MAX_EDGES) throw new Error(`Graphify artifact exceeds ${MAX_EDGES} edges.`);

  const ids = new Set();
  for (const [index, node] of value.nodes.entries()) {
    exactKeys(node, ["id", "label", "path", "line"], `nodes[${index}]`);
    const id = safeString(node.id, `nodes[${index}].id`, 512);
    if (ids.has(id)) throw new Error("Graphify artifact node ids must be unique.");
    ids.add(id);
    safeString(node.label, `nodes[${index}].label`, 512);
    relativePosixPath(node.path, `nodes[${index}].path`);
    lineNumber(node.line, `nodes[${index}].line`);
  }
  for (const [index, edge] of value.edges.entries()) {
    exactKeys(edge, ["source", "target", "relation", "confidence", "path", "line"], `edges[${index}]`);
    const source = safeString(edge.source, `edges[${index}].source`, 512);
    const target = safeString(edge.target, `edges[${index}].target`, 512);
    if (!ids.has(source) || !ids.has(target)) throw new Error("Graphify artifact edges must reference existing nodes.");
    safeString(edge.relation, `edges[${index}].relation`, 128);
    safeString(edge.confidence, `edges[${index}].confidence`, 128);
    relativePosixPath(edge.path, `edges[${index}].path`);
    lineNumber(edge.line, `edges[${index}].line`);
  }
  return { schema: value.schema, version: value.version, nodes: value.nodes.length, edges: value.edges.length };
}

async function validateProject(paths) {
  await Promise.all([
    assertRealPathInside(paths.root, paths.graph, "graph.json"),
    assertRealPathInside(paths.root, paths.artifact, "Frege export"),
  ]).catch((err) => {
    if (err?.code === "ENOENT") throw new Error("Local Graphify files are missing. Run `frege code index .` first.");
    throw err;
  });
  const [graphInfo, artifactInfo] = await Promise.all([stat(paths.graph), stat(paths.artifact)]);
  if (!graphInfo.isFile() || graphInfo.size > MAX_GRAPH_BYTES) throw new Error("Graphify graph.json is missing or exceeds the safe local size limit.");
  if (!artifactInfo.isFile() || artifactInfo.size > MAX_ARTIFACT_BYTES) throw new Error("Graphify v1 export is missing or exceeds the safe local size limit.");
  let artifact;
  try {
    artifact = JSON.parse(await readFile(paths.artifact, "utf8"));
  } catch {
    throw new Error("Graphify v1 export is malformed; run `frege code index` again.");
  }
  return validateGraphifyArtifact(artifact);
}

export async function graphifyDoctor(options = {}) {
  const env = options.env ?? process.env;
  if (!graphifyEnabled(env)) throw new Error("Local Graphify is not enabled. Set FREGE_CODE_GRAPH=true explicitly.");
  const paths = projectPaths(options.cwd ?? process.cwd(), env);
  const [version, artifact] = await Promise.all([graphifyVersion({ ...options, env }), validateProject(paths)]);
  return { ok: true, graphify: version, ...artifact, artifactPath: path.relative(paths.root, paths.artifact) };
}

export async function graphifyIndex(target = ".", options = {}) {
  const env = options.env ?? process.env;
  if (!graphifyEnabled(env)) throw new Error("Local Graphify is not enabled. Set FREGE_CODE_GRAPH=true explicitly.");
  const paths = projectPaths(options.cwd ?? process.cwd(), env);
  const root = path.resolve(paths.root, target);
  assertInside(paths.root, root, "index path");
  await assertRealPathInside(paths.root, root, "index path");
  await assertProspectivePathInside(paths.root, paths.out, "GRAPHIFY_OUT");
  const version = await graphifyVersion({ ...options, env });

  const graphExists = await stat(paths.graph).then((info) => info.isFile(), () => false);
  const graphifyEnv = { ...env, GRAPHIFY_OUT: paths.out, GRAPHIFY_NO_TIPS: "1" };
  const command = graphExists ? ["update", root] : ["extract", root, "--code-only", "--out", paths.out];
  await runGraphify(command, {
    cwd: paths.root, env: graphifyEnv, timeoutMs: 120_000, testOnlyChildEnv: options.testOnlyChildEnv,
  });
  try {
    await runGraphify(["export", "frege", "--graph", paths.graph, "--output", paths.artifact], {
      cwd: paths.root,
      env: graphifyEnv,
      timeoutMs: 30_000,
      testOnlyChildEnv: options.testOnlyChildEnv,
    });
  } catch {
    throw new Error(`The installed Graphify build lacks the Frege v1 export contract. ${INSTALL_HINT}`);
  }
  return {
    action: graphExists ? "updated" : "indexed", ok: true, graphify: version,
    ...(await validateProject(paths)), artifactPath: path.relative(paths.root, paths.artifact),
  };
}

export async function graphifyQuery(query, options = {}) {
  const env = options.env ?? process.env;
  const paths = projectPaths(options.cwd ?? process.cwd(), env);
  const cleanQuery = queryText(query);
  const budget = positiveInteger(options.budget, 2_000, MAX_QUERY_BUDGET, "budget");
  await graphifyDoctor({ ...options, env });
  const output = await runGraphify(["query", cleanQuery, "--budget", String(budget), "--graph", paths.graph], {
    cwd: paths.root,
    env: { ...env, GRAPHIFY_OUT: paths.out },
    timeoutMs: 15_000,
    testOnlyChildEnv: options.testOnlyChildEnv,
  });
  if (!output) throw new Error("Graphify returned no local query result.");
  return output;
}

// MCP clients are not obliged to enforce the advertised JSON Schema, so tool
// arguments are re-validated here at runtime. The CLI keeps parsing numeric
// flags from argv strings through positiveInteger instead.
function toolArguments(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("tool arguments must be an object.");
  }
  if (typeof input.query !== "string") throw new Error("query must be a string.");
  for (const key of ["budget", "limit"]) {
    if (input[key] !== undefined && typeof input[key] !== "number") {
      throw new Error(`${key} must be a number when provided.`);
    }
  }
  return input;
}

export async function callGraphifyTool(name, rawInput, options) {
  if (name !== "frege_code_graph_query" && name !== "frege_code_context") {
    throw new Error(`unknown_tool:${name}`);
  }
  const input = toolArguments(rawInput);
  if (name === "frege_code_graph_query") return graphifyQuery(input.query, { ...options, budget: input.budget });

  const query = queryText(input.query);
  const limit = positiveInteger(input.limit, 8, 25, "limit");
  const [hosted, local] = await Promise.allSettled([
    options.hostedContext({ query, limit }),
    graphifyQuery(query, { ...options, budget: input.budget }),
  ]);
  const hostedText = hosted.status === "fulfilled"
    ? JSON.stringify(hosted.value, null, 2)
    : "Hosted context unavailable; check the Frege connection.";
  const localText = local.status === "fulfilled"
    ? local.value
    : `Local code graph unavailable: ${local.reason instanceof Error ? local.reason.message : "unknown local error"}`;
  return `## Hosted context\n${hostedText}\n\n## Local code graph\n${localText}`;
}

export async function runGraphifyCli(args, options = {}) {
  const subcommand = args._[1];
  if (subcommand === "doctor") return JSON.stringify(await graphifyDoctor(options), null, 2);
  if (subcommand === "index") return JSON.stringify(await graphifyIndex(args._[2] || ".", options), null, 2);
  if (subcommand === "query") {
    const query = args._.slice(2).join(" ") || args.query || args.q;
    return graphifyQuery(query, { ...options, budget: args.budget });
  }
  throw new Error("Unknown code command. Use: frege code doctor|index [PATH]|query \"QUESTION\" [--budget N]");
}
