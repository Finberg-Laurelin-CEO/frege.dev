import {
  createHmac,
  createSign,
  timingSafeEqual,
} from "node:crypto";

export const GITHUB_API_VERSION = "2026-03-10";
export const GITHUB_API_BASE_URL = "https://api.github.com";

type FetchLike = typeof fetch;

type InstallationTokenResponse = {
  token: string;
  expires_at: string;
  permissions?: Record<string, string>;
  repositories?: Array<{ id: number; name: string; full_name: string }>;
};

export type GitHubAppClientOptions = {
  appId: string;
  privateKey: string;
  fetchImpl?: FetchLike;
  apiBaseUrl?: string;
  userAgent?: string;
  now?: () => number;
  requestTimeoutMs?: number;
  maxAttempts?: number;
  sleep?: (milliseconds: number) => Promise<void>;
};

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

export function normalizeGitHubPrivateKey(value: string): string {
  return value.includes("\\n") ? value.replaceAll("\\n", "\n") : value;
}

export function createGitHubAppJwt(input: {
  appId: string;
  privateKey: string;
  nowSeconds?: number;
}): string {
  if (!input.appId.trim()) throw new Error("github_app_id_required");
  if (!input.privateKey.trim()) throw new Error("github_app_private_key_required");

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iat: now - 60,
    exp: now + 9 * 60,
    iss: input.appId,
  }));
  const signingInput = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(normalizeGitHubPrivateKey(input.privateKey)).toString("base64url");
  return `${signingInput}.${signature}`;
}

export function verifyGitHubWebhookSignature(input: {
  body: string | Buffer;
  signature: string | null;
  secret: string;
}): boolean {
  if (!input.secret || !input.signature?.startsWith("sha256=")) return false;
  const receivedHex = input.signature.slice("sha256=".length);
  if (!/^[a-f0-9]{64}$/i.test(receivedHex)) return false;

  const expected = Buffer.from(
    createHmac("sha256", input.secret).update(input.body).digest("hex"),
    "utf8",
  );
  const received = Buffer.from(receivedHex.toLowerCase(), "utf8");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export class GitHubApiError extends Error {
  readonly status: number;
  readonly requestId: string | null;
  readonly retryAfter: string | null;
  readonly rateLimitRemaining: string | null;
  readonly rateLimitReset: string | null;

  constructor(message: string, response: Response) {
    super(message);
    this.name = "GitHubApiError";
    this.status = response.status;
    this.requestId = response.headers.get("x-github-request-id");
    this.rateLimitRemaining = response.headers.get("x-ratelimit-remaining");
    this.rateLimitReset = response.headers.get("x-ratelimit-reset");
    this.retryAfter = response.headers.get("retry-after") ?? (
      this.rateLimitRemaining === "0" && this.rateLimitReset
        ? new Date(Number(this.rateLimitReset) * 1000).toUTCString()
        : null
    );
  }
}

export class GitHubAppClient {
  private readonly appId: string;
  private readonly privateKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly apiBaseUrl: string;
  private readonly userAgent: string;
  private readonly now: () => number;
  private readonly requestTimeoutMs: number;
  private readonly maxAttempts: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(options: GitHubAppClientOptions) {
    this.appId = options.appId;
    this.privateKey = options.privateKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.apiBaseUrl = (options.apiBaseUrl ?? GITHUB_API_BASE_URL).replace(/\/$/, "");
    this.userAgent = options.userAgent ?? "frege-github-connector";
    this.now = options.now ?? Date.now;
    this.requestTimeoutMs = Math.min(Math.max(options.requestTimeoutMs ?? 15_000, 1_000), 60_000);
    this.maxAttempts = Math.min(Math.max(options.maxAttempts ?? 3, 1), 4);
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  private headers(token: string, extra?: HeadersInit): Headers {
    const headers = new Headers(extra);
    headers.set("accept", "application/vnd.github+json");
    headers.set("authorization", `Bearer ${token}`);
    headers.set("user-agent", this.userAgent);
    headers.set("x-github-api-version", GITHUB_API_VERSION);
    return headers;
  }

  private retryDelay(response: Response | null, attempt: number): number {
    const retryAfter = response?.headers.get("retry-after");
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1000, 0), 10_000);
      const at = Date.parse(retryAfter);
      if (Number.isFinite(at)) return Math.min(Math.max(at - this.now(), 0), 10_000);
    }
    return Math.min(250 * (2 ** (attempt - 1)), 2_000);
  }

  private async fetchWithPolicy(url: string, init: RequestInit, retryable: boolean): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const upstreamSignal = init.signal;
      const abortFromUpstream = () => controller.abort(upstreamSignal?.reason);
      if (upstreamSignal?.aborted) abortFromUpstream();
      else upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });
      const timer = setTimeout(() => controller.abort(new Error("github_request_timeout")), this.requestTimeoutMs);
      let response: Response | null = null;
      try {
        response = await this.fetchImpl(url, { ...init, signal: controller.signal });
        const rateLimited403 = response.status === 403 && (
          response.headers.has("retry-after") || response.headers.get("x-ratelimit-remaining") === "0"
        );
        const shouldRetry = retryable && (rateLimited403 || [429, 502, 503, 504].includes(response.status));
        if (!shouldRetry || attempt === this.maxAttempts) return response;
      } catch (error) {
        lastError = error;
        if (!retryable || attempt === this.maxAttempts || upstreamSignal?.aborted) throw error;
      } finally {
        clearTimeout(timer);
        upstreamSignal?.removeEventListener("abort", abortFromUpstream);
      }
      await this.sleep(this.retryDelay(response, attempt));
    }
    throw lastError instanceof Error ? lastError : new Error("github_request_failed");
  }

  async createInstallationToken(input: {
    installationId: number;
    repositoryIds?: number[];
    permissions?: Record<string, "read" | "write">;
  }): Promise<InstallationTokenResponse> {
    if (!Number.isSafeInteger(input.installationId) || input.installationId <= 0) {
      throw new Error("github_installation_id_invalid");
    }
    const repositoryIds = [...new Set(input.repositoryIds ?? [])];
    if (repositoryIds.length > 500) throw new Error("github_repository_limit_exceeded");
    if (repositoryIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      throw new Error("github_repository_id_invalid");
    }

    const jwt = createGitHubAppJwt({
      appId: this.appId,
      privateKey: this.privateKey,
      nowSeconds: Math.floor(this.now() / 1000),
    });
    const response = await this.fetchWithPolicy(
      `${this.apiBaseUrl}/app/installations/${input.installationId}/access_tokens`,
      {
        method: "POST",
        headers: this.headers(jwt, { "content-type": "application/json" }),
        body: JSON.stringify({
          ...(repositoryIds.length ? { repository_ids: repositoryIds } : {}),
          ...(input.permissions ? { permissions: input.permissions } : {}),
        }),
      },
      true,
    );

    if (!response.ok) {
      throw new GitHubApiError(`github_installation_token_failed:${response.status}`, response);
    }
    const body = await response.json() as InstallationTokenResponse;
    if (!body.token || !body.expires_at) throw new Error("github_installation_token_invalid");
    const expiresAt = Date.parse(body.expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt <= this.now() + 30_000) {
      throw new Error("github_installation_token_expiry_invalid");
    }
    if (repositoryIds.length > 0 && body.repositories) {
      const returnedIds = new Set(body.repositories.map((repository) => repository.id));
      if (repositoryIds.some((id) => !returnedIds.has(id))) {
        throw new Error("github_installation_token_scope_mismatch");
      }
    }
    return body;
  }

  async requestAsApp(path: string, init: RequestInit = {}): Promise<Response> {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const jwt = createGitHubAppJwt({
      appId: this.appId,
      privateKey: this.privateKey,
      nowSeconds: Math.floor(this.now() / 1000),
    });
    const method = (init.method ?? "GET").toUpperCase();
    return this.fetchWithPolicy(
      `${this.apiBaseUrl}${normalizedPath}`,
      { ...init, headers: this.headers(jwt, init.headers) },
      method === "GET" || method === "HEAD",
    );
  }

  async request(
    installationToken: string,
    path: string,
    init: RequestInit = {},
    etag?: string | null,
  ): Promise<Response> {
    if (!installationToken) throw new Error("github_installation_token_required");
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const headers = this.headers(installationToken, init.headers);
    if (etag) headers.set("if-none-match", etag);
    const method = (init.method ?? "GET").toUpperCase();
    return this.fetchWithPolicy(
      `${this.apiBaseUrl}${normalizedPath}`,
      { ...init, headers },
      method === "GET" || method === "HEAD",
    );
  }
}
