import { createHash } from "node:crypto";
import { clientIp } from "@/lib/core/client-ip";
import { getSql } from "@/lib/db";

export type RateLimitResult = {
  allowed: boolean;
  attempts: number;
  limit: number;
  retryAfterSeconds: number;
};

type RateLimitOptions = {
  action: string;
  limit: number;
  windowSeconds: number;
  keyParts?: Array<string | null | undefined>;
  includeClientIp?: boolean;
};

// Rate limiting deliberately does NOT reuse hashIp from lib/core/client-ip:
// its hashes are persisted as auth_rate_limits.bucket_key, so they need a static
// salt (no day rotation) to stay stable within a window, and they cover non-IP
// key parts (e.g. emails) too. Do not change the format without a bucket reset.
function secretSalt(): string {
  if (process.env.IP_HASH_SALT) return process.env.IP_HASH_SALT;
  if (process.env.NODE_ENV === "production") throw new Error("IP_HASH_SALT is not set.");
  return "frege-dev-rate-limit-salt";
}

function hashPart(value: string): string {
  return createHash("sha256").update(`${value}|${secretSalt()}`).digest("hex");
}

function bucketKey(req: Request, options: RateLimitOptions): string {
  const parts = [
    ...(options.includeClientIp === false ? [] : [clientIp(req)]),
    ...(options.keyParts ?? []).filter(Boolean) as string[],
  ];
  if (parts.length === 0) throw new Error("Rate limit bucket requires an IP or key part.");
  const hashed = parts.map(hashPart).join(":");
  return `${options.action}:${hashed}`;
}

export async function checkRateLimit(req: Request, options: RateLimitOptions): Promise<RateLimitResult> {
  const sql = getSql();
  const [row] = await sql`
    insert into auth_rate_limits (bucket_key, action, attempts, window_start, updated_at)
    values (${bucketKey(req, options)}, ${options.action}, 1, now(), now())
    on conflict (bucket_key) do update set
      attempts = case
        when auth_rate_limits.window_start < now() - make_interval(secs => ${options.windowSeconds}) then 1
        else auth_rate_limits.attempts + 1
      end,
      window_start = case
        when auth_rate_limits.window_start < now() - make_interval(secs => ${options.windowSeconds}) then now()
        else auth_rate_limits.window_start
      end,
      updated_at = now()
    returning attempts, window_start
  `;

  const attempts = Number((row as { attempts: number | string }).attempts);
  return {
    allowed: attempts <= options.limit,
    attempts,
    limit: options.limit,
    retryAfterSeconds: options.windowSeconds,
  };
}

export function rateLimitedResponse(result: RateLimitResult): Response {
  return Response.json(
    { error: "rate_limited", retry_after_seconds: result.retryAfterSeconds },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
  );
}
