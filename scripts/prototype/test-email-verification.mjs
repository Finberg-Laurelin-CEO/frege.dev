#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function resolveAlias(specifier) {
  const base = path.join(rootDir, specifier.slice(2));
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return `${base}.ts`;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return { url: pathToFileURL(resolveAlias(specifier)).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const {
  hashEmailVerificationToken,
  issueEmailVerificationToken,
  verifyEmailVerificationToken,
} = await import(pathToFileURL(path.join(rootDir, "lib/core/email-verification.ts")).href);

function queryText(strings) {
  return strings.join(" ").replace(/\s+/g, " ").trim();
}

function makeSql() {
  const store = {
    users: new Map([
      ["user-1", { id: "user-1", email: "ada@example.com", email_verified_at: null }],
      ["user-old", { id: "user-old", email: "old@example.com", email_verified_at: "2026-01-01T00:00:00.000Z" }],
    ]),
    tokens: new Map(),
  };

  const sql = async (strings, ...values) => {
    const text = queryText(strings);

    if (text.startsWith("insert into email_verification_tokens")) {
      const [userId, tokenHash, expiresAt] = values;
      const id = `token-${store.tokens.size + 1}`;
      store.tokens.set(tokenHash, { id, user_id: userId, token_hash: tokenHash, expires_at: expiresAt, used_at: null });
      return [];
    }

    if (text.startsWith("select email_verification_tokens.id")) {
      const token = store.tokens.get(values[0]);
      if (!token) return [];
      const user = store.users.get(token.user_id);
      return [{ ...token, email: user.email, email_verified_at: user.email_verified_at }];
    }

    if (text.startsWith("update email_verification_tokens set used_at")) {
      const token = [...store.tokens.values()].find((candidate) => candidate.id === values[0]);
      if (!token || token.used_at || new Date(token.expires_at).getTime() <= Date.now()) return [];
      token.used_at = new Date().toISOString();
      return [{ user_id: token.user_id }];
    }

    if (text.startsWith("update users set email_verified_at")) {
      const user = store.users.get(values[0]);
      if (!user) return [];
      user.email_verified_at ??= new Date().toISOString();
      return [{ id: user.id, email: user.email, email_verified_at: user.email_verified_at }];
    }

    throw new Error(`unexpected SQL: ${text}`);
  };

  return { sql, store };
}

test("issuing a verification token stores only the hash", async () => {
  const { sql, store } = makeSql();
  const token = await issueEmailVerificationToken(sql, "user-1");

  assert.equal(typeof token.rawToken, "string");
  assert.equal(store.tokens.has(token.rawToken), false);
  assert.equal(store.tokens.has(token.tokenHash), true);
  assert.equal(hashEmailVerificationToken(token.rawToken), token.tokenHash);
});

test("valid verification token marks token used and user verified", async () => {
  const { sql, store } = makeSql();
  const token = await issueEmailVerificationToken(sql, "user-1");
  const result = await verifyEmailVerificationToken(sql, token.rawToken);

  assert.deepEqual(result.ok, true);
  assert.ok(store.users.get("user-1").email_verified_at);
  assert.ok(store.tokens.get(token.tokenHash).used_at);
});

test("used verification token fails cleanly", async () => {
  const { sql } = makeSql();
  const token = await issueEmailVerificationToken(sql, "user-1");
  assert.equal((await verifyEmailVerificationToken(sql, token.rawToken)).ok, true);

  const second = await verifyEmailVerificationToken(sql, token.rawToken);
  assert.deepEqual(second, { ok: false, reason: "used" });
});

test("expired and invalid verification tokens fail cleanly", async () => {
  const { sql, store } = makeSql();
  const raw = "expired-token";
  store.tokens.set(hashEmailVerificationToken(raw), {
    id: "token-expired",
    user_id: "user-1",
    token_hash: hashEmailVerificationToken(raw),
    expires_at: "2020-01-01T00:00:00.000Z",
    used_at: null,
  });

  assert.deepEqual(await verifyEmailVerificationToken(sql, raw), { ok: false, reason: "expired" });
  assert.deepEqual(await verifyEmailVerificationToken(sql, "missing-token"), { ok: false, reason: "invalid" });
});
