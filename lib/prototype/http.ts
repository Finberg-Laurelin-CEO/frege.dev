// Shared fetch-with-timeout + bounded-retry helper. Lifts the AbortController
// pattern from lib/hermes-webhook.ts so every outbound call (model providers,
// etc.) has a ceiling instead of hanging the serverless function.
//
// Retries only on transient failures — an aborted request (timeout), a network
// error, HTTP 429, or HTTP >= 500 — with jittered exponential backoff. A timeout
// surfaces as FetchTimeoutError so callers can map it to a domain error (e.g.
// `model_timeout`). A non-retryable response (including a final-attempt 5xx) is
// returned to the caller to inspect.

export type FetchWithTimeoutOptions = {
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
};

export class FetchTimeoutError extends Error {
  constructor(message = "fetch_timeout") {
    super(message);
    this.name = "FetchTimeoutError";
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  { timeoutMs = 60_000, retries = 0, backoffMs = 500 }: FetchWithTimeoutOptions = {},
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      // Retry transient statuses only when attempts remain; otherwise hand the
      // response back for the caller to deal with.
      if (isRetryableStatus(res.status) && attempt < retries) {
        lastError = new Error(`http_${res.status}`);
      } else {
        return res;
      }
    } catch (err) {
      lastError = controller.signal.aborted ? new FetchTimeoutError() : err;
      if (attempt >= retries) break;
    } finally {
      clearTimeout(timer);
    }

    // Backoff with jitter before the next attempt.
    const jitter = Math.floor(Math.random() * (backoffMs / 2));
    await sleep(backoffMs * 2 ** attempt + jitter);
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "fetch_failed"));
}
