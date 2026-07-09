import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { requiredEnv } from "@/lib/core/env-check";

const RAW_KEY_PATTERN = /^frg_live_([a-f0-9]{12})_(.+)$/;
const STAFF_KEY_PATTERN = /^frg_admin_([a-f0-9]{12})_(.+)$/;

export type GeneratedApiKey = {
  rawKey: string;
  keyPrefix: string;
  keyHash: string;
};

export type ParsedApiKey = {
  rawKey: string;
  keyPrefix: string;
};

export function getApiKeySalt(): string {
  return requiredEnv("FREGE_API_KEY_SALT", "salt for hashing API keys");
}

export function parseApiKey(rawKey: string): ParsedApiKey | null {
  const match = RAW_KEY_PATTERN.exec(rawKey);
  if (!match) return null;

  return {
    rawKey,
    keyPrefix: match[1]!,
  };
}

export function hashApiKey(rawKey: string, salt = getApiKeySalt()): string {
  return createHash("sha256").update(`${rawKey}|${salt}`).digest("hex");
}

export function safelyCompareApiKeyHash(candidateHash: string, storedHash: string): boolean {
  const candidate = Buffer.from(candidateHash, "hex");
  const stored = Buffer.from(storedHash, "hex");

  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

export function generateApiKey(salt = getApiKeySalt()): GeneratedApiKey {
  const keyPrefix = randomBytes(6).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  const rawKey = `frg_live_${keyPrefix}_${secret}`;

  return {
    rawKey,
    keyPrefix,
    keyHash: hashApiKey(rawKey, salt),
  };
}

export function parseStaffApiKey(rawKey: string): ParsedApiKey | null {
  const match = STAFF_KEY_PATTERN.exec(rawKey);
  if (!match) return null;

  return {
    rawKey,
    keyPrefix: match[1]!,
  };
}

export function generateStaffApiKey(salt = getApiKeySalt()): GeneratedApiKey {
  const keyPrefix = randomBytes(6).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  const rawKey = `frg_admin_${keyPrefix}_${secret}`;

  return {
    rawKey,
    keyPrefix,
    keyHash: hashApiKey(rawKey, salt),
  };
}
