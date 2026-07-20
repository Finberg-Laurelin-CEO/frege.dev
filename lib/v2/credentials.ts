import { createHash, randomBytes } from "node:crypto";
import { getApiKeySalt, safelyCompareApiKeyHash } from "@/lib/core/keys";

const DELEGATED_CREDENTIAL_PATTERN = /^frg_v2_([a-f0-9]{12})_(.+)$/;

export type GeneratedDelegatedCredential = {
  rawCredential: string;
  keyPrefix: string;
  keyHash: string;
};

export function bearerCredential(req: Request): string | null {
  const authorization = req.headers.get("authorization");
  if (!authorization) return null;
  return /^Bearer\s+(.+)$/i.exec(authorization.trim())?.[1] ?? null;
}

export function parseDelegatedCredential(rawCredential: string): { rawCredential: string; keyPrefix: string } | null {
  const match = DELEGATED_CREDENTIAL_PATTERN.exec(rawCredential);
  if (!match) return null;
  return { rawCredential, keyPrefix: match[1]! };
}

export function hashDelegatedCredential(rawCredential: string, salt = getApiKeySalt()): string {
  return createHash("sha256")
    .update(`frege-v2-delegated-credential:${rawCredential}|${salt}`)
    .digest("hex");
}

export function generateDelegatedCredential(salt = getApiKeySalt()): GeneratedDelegatedCredential {
  const keyPrefix = randomBytes(6).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  const rawCredential = `frg_v2_${keyPrefix}_${secret}`;
  return {
    rawCredential,
    keyPrefix,
    keyHash: hashDelegatedCredential(rawCredential, salt),
  };
}

export function safelyCompareDelegatedCredential(candidateHash: string, storedHash: string): boolean {
  return safelyCompareApiKeyHash(candidateHash, storedHash);
}
