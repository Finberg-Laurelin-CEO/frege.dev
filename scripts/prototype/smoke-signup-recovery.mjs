#!/usr/bin/env node
// Static smoke checks for the public self-serve signup and invite recovery flows.

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

// The signup API is a thin route wrapper around the DI-testable core in
// lib/core/signup-flow-core.ts; smoke-check the combined source.
const signupRoute = read("app/api/signup/route.ts") + read("lib/core/signup-flow-core.ts");
const signupPage = read("app/signup/page.tsx");
const resendRoute = read("app/api/signup/recovery/resend/route.ts");

includesAll(
  signupRoute,
  [
    "createUserSession",
    "sendSignupWelcomeEmail",
    "sendEmailVerificationEmail",
    "buildEmailVerificationToken",
    "hashPassword",
    "defaultAgentRoleStatements",
    "sql.transaction",
    "auth.signup.email",
    "auth.signup.ip",
    "account_exists",
    "/console?view=account",
    "next_path",
    "i.status as invite_status",
  ],
  "signup API",
);

includesAll(
  signupPage,
  [
    "This email already has a Frege account. Sign in to continue.",
    "Create an org, choose a plan, verify your email, and open your account page.",
    "Your setup email includes a verification link",
    "create account and open account",
    "Team annual",
    "Resend setup email",
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
assert(!signupRoute.includes("MIN_DWELL_MS"), "signup API still silently drops fast human submissions");
assert(!signupPage.includes("we'll follow up after review"), "signup UI still contains gated-review copy");
assert(!signupRoute.includes("createCheckoutSession"), "signup API must not create Stripe checkout");
assert(!signupRoute.includes("checkout_url"), "signup API must not return checkout_url");
assert(!signupPage.includes("continue to Stripe"), "signup UI must not promise immediate Stripe checkout");
assert(!resendRoute.includes("invite_token"), "public resend route must not expose raw invite tokens");
assert(!resendRoute.includes("invite_link"), "public resend route must not expose invite links");

console.log("self-serve signup smoke ok");
