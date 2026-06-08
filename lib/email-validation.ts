// Server-only email validation. Imports node:dns, so never import from client.
//
// Two checks beyond Zod's syntax validation:
//   1. Disposable / throwaway email domain blocklist (10minutemail, mailinator, …).
//   2. MX record lookup — the domain must publish at least one MX host so mail
//      could plausibly be delivered. Catches typos like "gmial.com" and made-up
//      domains. We treat DNS errors (ENOTFOUND / ENODATA / SERVFAIL) as "no MX".
//
// Both checks are best-effort: we never block on transient DNS issues; on lookup
// timeout we *accept* the address (fail-open) rather than reject a real user.

import { promises as dns } from "node:dns";

// Vercel's serverless DNS resolver is slower than a local Mac, especially on
// cold start. 5s is still well below any reasonable user-perceived limit for a
// form submission, and ensures that legitimate domains resolve before we
// fail-open.
const DNS_TIMEOUT_MS = 5000;

/** Common disposable / throwaway / temp-mail domains. Lowercased. */
const DISPOSABLE_DOMAINS = new Set<string>([
  "10minutemail.com",
  "10minutemail.net",
  "20minutemail.com",
  "anonbox.net",
  "burnermail.io",
  "dispostable.com",
  "fakeinbox.com",
  "getairmail.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "harakirimail.com",
  "incognitomail.com",
  "mailinator.com",
  "mailinator.net",
  "mailnesia.com",
  "maildrop.cc",
  "mintemail.com",
  "mohmal.com",
  "moakt.com",
  "mytemp.email",
  "mytrashmail.com",
  "nada.email",
  "rcpt.at",
  "sharklasers.com",
  "spam4.me",
  "spambog.com",
  "spambox.us",
  "spamgourmet.com",
  "tempinbox.com",
  "tempmail.com",
  "tempmail.net",
  "tempmail.plus",
  "tempmailaddress.com",
  "temp-mail.org",
  "temp-mail.io",
  "throwawaymail.com",
  "trashmail.com",
  "trashmail.net",
  "yopmail.com",
  "yopmail.net",
]);

export type EmailValidationResult =
  | { ok: true }
  | { ok: false; reason: "disposable" | "no_mx"; message: string };

/** Extract the lowercased domain from an email address. */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).toLowerCase();
}

export function isDisposableDomain(domain: string): boolean {
  return DISPOSABLE_DOMAINS.has(domain);
}

type MxResult =
  | { ok: true; source: "mx" | "a" }
  | { ok: false; source: "nxdomain" | "no_records" }
  | { ok: true; source: "timeout" }; // fail-open

/**
 * Resolve MX records (or A as RFC-5321 implicit MX fallback) with a hard
 * timeout. The `source` field is preserved so callers can log/audit *why* a
 * domain was accepted — in particular distinguishing real MX from a DNS
 * timeout fail-open.
 */
async function checkMxRecord(domain: string): Promise<MxResult> {
  const lookup: Promise<MxResult> = (async () => {
    try {
      const records = await dns.resolveMx(domain);
      if (records.length > 0) return { ok: true, source: "mx" };
    } catch (err) {
      const code = (err as { code?: string })?.code;
      // ENOTFOUND = NXDOMAIN; ENODATA = no records of this type. For both we
      // fall through to the A-record check, since some domains publish A but
      // not MX (RFC 5321 §5.1).
      if (code && code !== "ENOTFOUND" && code !== "ENODATA") {
        // Unexpected DNS error (SERVFAIL etc.) — propagate up as timeout/open.
        throw err;
      }
    }
    try {
      const a = await dns.resolve4(domain);
      if (a.length > 0) return { ok: true, source: "a" };
      return { ok: false, source: "no_records" };
    } catch {
      return { ok: false, source: "nxdomain" };
    }
  })();

  // Fail-open on timeout: don't block real users on a flaky resolver.
  const timeout = new Promise<MxResult>((resolve) =>
    setTimeout(() => resolve({ ok: true, source: "timeout" }), DNS_TIMEOUT_MS),
  );
  return Promise.race([lookup, timeout]).catch(
    (): MxResult => ({ ok: true, source: "timeout" }),
  );
}

/**
 * Validate that an email's domain is real-mail-capable. Assumes the address
 * already passed Zod's syntax check.
 */
export async function validateEmailDomain(
  email: string,
): Promise<EmailValidationResult> {
  const domain = emailDomain(email);
  if (!domain) {
    return { ok: false, reason: "no_mx", message: "Enter a valid email address." };
  }
  if (isDisposableDomain(domain)) {
    return {
      ok: false,
      reason: "disposable",
      message: "Please use a work email address (not a disposable inbox).",
    };
  }
  const mx = await checkMxRecord(domain);
  // Structured log so the source of an accept/reject decision is auditable
  // (especially "timeout" fail-opens that let typos through under DNS stress).
  console.log(
    `[email-validation] domain=${domain} ok=${mx.ok} source=${mx.source}`,
  );
  if (!mx.ok) {
    return {
      ok: false,
      reason: "no_mx",
      message: "That email domain doesn't accept mail. Check the spelling?",
    };
  }
  return { ok: true };
}
