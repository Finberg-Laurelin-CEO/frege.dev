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

const DNS_TIMEOUT_MS = 2500;

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

/** Resolve MX records with a hard timeout. Returns true if any MX is published. */
async function hasMxRecord(domain: string): Promise<boolean> {
  const lookup = (async () => {
    try {
      const records = await dns.resolveMx(domain);
      if (records.length > 0) return true;
      // RFC 5321 §5.1: if no MX, the A record acts as an implicit MX. Accept that too.
      const a = await dns.resolve4(domain).catch(() => [] as string[]);
      return a.length > 0;
    } catch {
      return false;
    }
  })();

  // Fail-open on timeout: don't block real users on a flaky resolver.
  const timeout = new Promise<true>((resolve) =>
    setTimeout(() => resolve(true), DNS_TIMEOUT_MS),
  );
  return Promise.race([lookup, timeout]);
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
  const hasMx = await hasMxRecord(domain);
  if (!hasMx) {
    return {
      ok: false,
      reason: "no_mx",
      message: "That email domain doesn't accept mail. Check the spelling?",
    };
  }
  return { ok: true };
}
