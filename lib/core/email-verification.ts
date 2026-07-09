import { createHash, randomBytes } from "node:crypto";
import type { getSql as getDefaultSql } from "@/lib/db";
import { customerAppBaseUrl } from "@/lib/core/public-url";

type Sql = ReturnType<typeof getDefaultSql>;

const TOKEN_BYTES = 32;
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24;

export type EmailVerificationToken = {
  rawToken: string;
  tokenHash: string;
  expiresAt: string;
};

export type EmailVerificationResult =
  | { ok: true; userId: string; email: string; alreadyVerified: boolean }
  | { ok: false; reason: "invalid" | "used" | "expired" };

type TokenRow = {
  id: string;
  user_id: string;
  email: string;
  email_verified_at: Date | string | null;
  expires_at: Date | string;
  used_at: Date | string | null;
};

export function generateEmailVerificationToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashEmailVerificationToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function emailVerificationUrlForToken(rawToken: string): string {
  return `${customerAppBaseUrl()}/api/v1/auth/email/verification/confirm?token=${encodeURIComponent(rawToken)}`;
}

/**
 * Generate a verification token bundle without touching the database.
 * Callers that need the insert to be part of a larger atomic batch
 * (e.g. signup) build the row themselves from tokenHash/expiresAt.
 */
export function buildEmailVerificationToken(): EmailVerificationToken {
  const rawToken = generateEmailVerificationToken();
  return {
    rawToken,
    tokenHash: hashEmailVerificationToken(rawToken),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
  };
}

export async function issueEmailVerificationToken(sql: Sql, userId: string): Promise<EmailVerificationToken> {
  const token = buildEmailVerificationToken();

  await sql`
    insert into email_verification_tokens (user_id, token_hash, expires_at)
    values (${userId}, ${token.tokenHash}, ${token.expiresAt})
  `;

  return token;
}

export async function revokeOutstandingEmailVerificationTokens(sql: Sql, userId: string): Promise<void> {
  await sql`
    update email_verification_tokens
    set used_at = coalesce(used_at, now())
    where user_id = ${userId}
      and used_at is null
  `;
}

export async function verifyEmailVerificationToken(sql: Sql, rawToken: string): Promise<EmailVerificationResult> {
  const tokenHash = hashEmailVerificationToken(rawToken);
  const [token] = (await sql`
    select
      email_verification_tokens.id,
      email_verification_tokens.user_id,
      email_verification_tokens.expires_at,
      email_verification_tokens.used_at,
      users.email,
      users.email_verified_at
    from email_verification_tokens
    join users on users.id = email_verification_tokens.user_id
    where email_verification_tokens.token_hash = ${tokenHash}
    limit 1
  `) as TokenRow[];

  if (!token) return { ok: false, reason: "invalid" };
  if (token.used_at) return { ok: false, reason: "used" };
  if (new Date(token.expires_at).getTime() <= Date.now()) return { ok: false, reason: "expired" };

  const [used] = await sql`
    update email_verification_tokens
    set used_at = now()
    where id = ${token.id}
      and used_at is null
      and expires_at > now()
    returning user_id
  `;
  if (!used) return { ok: false, reason: "used" };

  const [user] = await sql`
    update users
    set email_verified_at = coalesce(email_verified_at, now())
    where id = ${token.user_id}
    returning id, email, email_verified_at
  `;

  return {
    ok: true,
    userId: String(user?.id ?? token.user_id),
    email: String(user?.email ?? token.email),
    alreadyVerified: Boolean(token.email_verified_at),
  };
}
