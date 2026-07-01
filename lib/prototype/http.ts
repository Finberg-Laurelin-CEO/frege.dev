// Shared fetch helper with a hard timeout and optional bounded retries.
//
// The platform fetch() has no built-in timeout, so a hung upstream (a black-hole
// model URL, a stalled provider) would keep a serverless invocation alive until the
// function itself is killed. fetchWithTimeout wraps fetch() in an AbortController so
// the request fails deterministically after timeoutMs, and callers can map that to a
// domain error (e.g. "model_timeout").
//
// The helper manages the abort signal itself; a signal passed in init is overridden.

export type FetchWithTimeoutOptions = {
  // Abort the request after this many milliseconds. Defaults to 30s.
  timeoutMs?: number;
  // Number of additional attempts after the first (0 = a single attempt).
  retries?: number;
  // Base backoff between attempts; grows exponentially (backoffMs * 2**attempt).
  backoffMs?: number;
};

// Thrown when a request is aborted because it exceeded timeoutMs. Distinguishable
// from other network errors so callers can surface a timeout-specific error.
export class FetchTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`fetch_timeout_after_${timeoutMs}ms`);
    this.name = "FetchTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export function isFetchTimeoutError(err: unknown): err is FetchTimeoutError {
  return err instanceof FetchTimeoutError || (err instanceof Error && err.name === "FetchTimeoutError");
}

const DEFAULT_TIMEOUT_MS = 30000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithTimeout(
  input: string | URL,
  init?: RequestInit,
  options: FetchWithTimeoutOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const retries = Math.max(0, options.retries ?? 0);
  const backoffMs = options.backoffMs ?? 250;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } catch (err) {
      lastError = timedOut ? new FetchTimeoutError(timeoutMs) : err;
    } finally {
      clearTimeout(timer);
    }

    if (attempt < retries) {
      await delay(backoffMs * 2 ** attempt);
    }
  }

  throw lastError;
}
