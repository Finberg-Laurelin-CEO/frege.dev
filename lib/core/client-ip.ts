// Shared client-IP extraction and IP hashing.
//
// Consolidates the copies that previously lived in app/api/signup/route.ts,
// lib/core/telemetry.ts, and lib/core/rate-limit.ts. Note that rate limiting
// keeps its own hashing scheme (static salt, no day rotation) in
// lib/core/rate-limit.ts because its hashes are persisted as bucket keys.

import { createHash } from "node:crypto";
import { requiredEnv } from "@/lib/core/env-check";

/**
 * Best-effort client IP from proxy headers.
 * Returns "system" when there is no request (e.g. background/system telemetry)
 * and "unknown" when the request carries no forwarding headers.
 */
export function clientIp(req?: Request): string {
  if (!req) return "system";
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export type HashIpOptions = {
  /**
   * When true (the default), a missing IP_HASH_SALT in production throws instead
   * of silently hashing with the dev fallback salt. Whether that throw fails the
   * request is up to the caller: the signup route lets it propagate (strict),
   * while telemetry wraps its whole write in a try/catch and only logs (lenient).
   */
  requireSalt?: boolean;
};

/** Hash the client IP with a day-rotating salt so we never store a raw IP. */
export function hashIp(ip: string, options: HashIpOptions = {}): string {
  const day = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
  const salt = process.env.IP_HASH_SALT;
  if (!salt && (options.requireSalt ?? true) && process.env.NODE_ENV === "production") {
    requiredEnv("IP_HASH_SALT", "salt for hashing client IPs");
  }
  return createHash("sha256").update(`${ip}|${day}|${salt ?? "frege-dev-salt"}`).digest("hex");
}
