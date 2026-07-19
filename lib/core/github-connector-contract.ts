import { createHash } from "node:crypto";
import type { TrustZone } from "@/lib/core/types";

export const GITHUB_CONNECTOR_KIND = "github";
export const GITHUB_CONNECTOR_MAX_FILES = 500;
export const GITHUB_CONNECTOR_MAX_FILE_BYTES = 512 * 1024;

export type GitHubConnectorConfig = {
  include: string[];
  exclude: string[];
  trust_zone: TrustZone;
  max_files: number;
  max_file_bytes: number;
};

export type GitHubTreeEntry = {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
};

const DEFAULT_EXCLUDES = [
  ".git/**",
  "**/.git/**",
  ".env*",
  "**/.env*",
  "node_modules/**",
  "**/node_modules/**",
  "vendor/**",
  "**/vendor/**",
  "dist/**",
  "**/dist/**",
  "build/**",
  "**/build/**",
  "coverage/**",
  "**/coverage/**",
  "private/**",
  "**/private/**",
  "secrets/**",
  "**/secrets/**",
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx",
];

export const DEFAULT_GITHUB_CONNECTOR_CONFIG: GitHubConnectorConfig = {
  include: ["README.md", "docs/**/*.md", "docs/**/*.mdx"],
  exclude: DEFAULT_EXCLUDES,
  trust_zone: "red",
  max_files: 200,
  max_file_bytes: 256 * 1024,
};

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function normalizePattern(value: string): string {
  const normalized = value.trim().replace(/^\.\//, "").replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.length > 240 ||
    normalized.startsWith("/") ||
    normalized.startsWith("!") ||
    normalized.includes("../") ||
    normalized.includes("\0")
  ) {
    throw new Error("github_connector_pattern_invalid");
  }
  return normalized;
}

export function githubGlobToRegExp(glob: string): RegExp {
  const normalized = glob.replace(/^\.\//, "").replaceAll("\\", "/");
  let expression = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index]!;
    if (character !== "*") {
      expression += escapeRegex(character);
      continue;
    }
    if (normalized[index + 1] === "*") {
      const followedBySlash = normalized[index + 2] === "/";
      expression += followedBySlash ? "(?:.*/)?" : ".*";
      index += followedBySlash ? 2 : 1;
    } else {
      expression += "[^/]*";
    }
  }
  return new RegExp(`^${expression}$`, "i");
}

export function normalizeGitHubConnectorConfig(
  input: Partial<GitHubConnectorConfig>,
): GitHubConnectorConfig {
  if ((input.include?.length ?? 0) > 64 || (input.exclude?.length ?? 0) > 128) {
    throw new Error("github_connector_pattern_limit_exceeded");
  }
  const include = [...new Set((input.include ?? DEFAULT_GITHUB_CONNECTOR_CONFIG.include)
    .map(normalizePattern))];
  if (include.length === 0) throw new Error("github_connector_include_required");

  const exclude = [...new Set([
    ...DEFAULT_EXCLUDES,
    ...(input.exclude ?? []).map(normalizePattern),
  ])];
  const maxFiles = Math.min(Math.max(input.max_files ?? DEFAULT_GITHUB_CONNECTOR_CONFIG.max_files, 1), GITHUB_CONNECTOR_MAX_FILES);
  const maxFileBytes = Math.min(
    Math.max(input.max_file_bytes ?? DEFAULT_GITHUB_CONNECTOR_CONFIG.max_file_bytes, 1),
    GITHUB_CONNECTOR_MAX_FILE_BYTES,
  );
  return {
    include,
    exclude,
    trust_zone: input.trust_zone === "green" ? "green" : "red",
    max_files: maxFiles,
    max_file_bytes: maxFileBytes,
  };
}

export function isGitHubPathSelected(path: string, config: GitHubConnectorConfig): boolean {
  const normalized = path.replace(/^\.\//, "").replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("../")) return false;
  if (!config.include.some((pattern) => githubGlobToRegExp(pattern).test(normalized))) return false;
  return !config.exclude.some((pattern) => githubGlobToRegExp(pattern).test(normalized));
}

export function selectGitHubTreeEntries(
  entries: GitHubTreeEntry[],
  configInput: Partial<GitHubConnectorConfig>,
): GitHubTreeEntry[] {
  const config = normalizeGitHubConnectorConfig(configInput);
  const seen = new Set<string>();
  const selected: GitHubTreeEntry[] = [];
  const includePatterns = config.include.map(githubGlobToRegExp);
  const excludePatterns = config.exclude.map(githubGlobToRegExp);

  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  for (const entry of [...entries].sort((a, b) => compare(a.path, b.path) || compare(a.sha, b.sha))) {
    if (entry.type !== "blob") continue;
    if (entry.mode !== "100644" && entry.mode !== "100755") continue;
    if (seen.has(entry.path)) continue;
    // A recursive tree normally includes blob sizes. Missing or invalid size is
    // not permission to fetch an unbounded object: fail closed and skip it.
    if (!Number.isSafeInteger(entry.size) || (entry.size as number) < 0 || (entry.size as number) > config.max_file_bytes) continue;
    const normalizedPath = entry.path.replace(/^\.\//, "").replaceAll("\\", "/");
    if (!normalizedPath || normalizedPath.startsWith("/") || normalizedPath.includes("../")) continue;
    if (!includePatterns.some((pattern) => pattern.test(normalizedPath))) continue;
    if (excludePatterns.some((pattern) => pattern.test(normalizedPath))) continue;
    seen.add(entry.path);
    selected.push(entry);
    if (selected.length >= config.max_files) break;
  }
  return selected;
}

function identityDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function githubSourceSlug(owner: string, repository: string, repositoryId?: number): string {
  const safe = `${owner}-${repository}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  if (!safe) throw new Error("github_repository_identity_invalid");
  const identity = repositoryId === undefined ? `${owner}/${repository}`.toLowerCase() : String(repositoryId);
  return `github-${safe}-${identityDigest(identity)}`;
}

export function githubPageSlug(owner: string, repository: string, path: string, repositoryId?: number): string {
  const source = githubSourceSlug(owner, repository, repositoryId);
  const safePath = path
    .toLowerCase()
    .replace(/\.(?:md|mdx|txt)$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  if (!safePath) throw new Error("github_source_path_invalid");
  const externalIdentity = `${repositoryId ?? `${owner}/${repository}`}:${path}`;
  const digest = identityDigest(externalIdentity);
  // Keep the identity-bearing suffix intact. Truncating the completed slug can
  // discard the digest for long repository/path names and collapse distinct
  // GitHub paths onto the same brain-page slug.
  const pathBudget = Math.max(1, 180 - source.length - digest.length - 2);
  const boundedPath = safePath.slice(0, pathBudget).replace(/-+$/g, "");
  return `${source}-${boundedPath}-${digest}`;
}
