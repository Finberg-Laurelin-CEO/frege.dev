#!/usr/bin/env node
// Static smoke checks for the public duplicate-signup recovery flow.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function includesAll(text, needles, label) {
  for (const needle of needles) {
    assert(text.includes(needle), `${label} missing ${needle}`);
  }
}

const signupRoute = read("app/api/signup/route.ts");
const signupPage = read("app/signup/page.tsx");
const resendRoute = read("app/api/signup/recovery/resend/route.ts");

includesAll(
  signupRoute,
  [
    "duplicateSignupResponse",
    "signupRecoveryFromRow",
    "s.created_at",
    "u.last_login_at",
    "i.status as invite_status",
    "duplicate_signup",
  ],
  "signup API",
);

includesAll(
  signupPage,
  [
    "This email already has an account. Sign in to continue.",
    "Resend setup email",
    "We already have a request for this email. We'll follow up after review.",
    "formatRequestDate",
  ],
  "signup UI",
);

includesAll(
  resendRoute,
  [
    "signup.recovery.resend.email",
    "signup.recovery.resend.ip",
    "i.status = 'pending'",
    "reissueInviteAndSendEmail",
    "GENERIC_SUCCESS",
  ],
  "public resend route",
);

assert(!signupPage.includes("submitted today"), "signup UI still contains inaccurate submitted-today copy");
assert(!resendRoute.includes("invite_token"), "public resend route must not expose raw invite tokens");
assert(!resendRoute.includes("invite_link"), "public resend route must not expose invite links");

console.log("signup recovery smoke ok");
