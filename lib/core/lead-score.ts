/* ───────────────────────────────────────────────────────────────────────────
   Pure lead scoring for Frege signups. Deterministic, no I/O — safe to call
   from the signup route, backfill scripts, and unit tests.

   Weights implement the "Lead Scoring" section of plans/signup-data-pathways.md
   exactly (the plan is in repo history: commit 086f703 "Plan signup data
   pathways"; it is not on main yet), mapped onto the live enum values in
   lib/signup-schema.ts — the plan was drafted against an earlier field
   vocabulary:

     Plan bucket                       Live value(s)                     Points
     timeline: now                     "Now"                             +25
     timeline: this quarter            "30 days"                         +15
     timeline: this half               "90 days"                         +5
     timeline: later                   "Researching" / "Not provided"     0
     expected users 1-9                1-9                               +5
     expected users 10-49              10-49                             +15
     expected users 50-499             50-499                            +25
     expected users 500+               500+                              +20
     monthly spend $1-500              "Under $500"                      +5
     monthly spend $500-5k             "$500-$2,000", "$2,000-$10,000"   +15
     monthly spend $5k+                "$10,000+"                        +25
     agent stack count 1 / 2 / 3+      +5 / +10 / +15  ("We are evaluating" is not a tool)
     pain point keyword                access|permission|audit|context|agent  +10
     freemail address                  gmail/yahoo/outlook/hotmail/icloud     -10

   Bands (plan): cold 0-39, warm 40-69, hot 70-100.

   docs/HERMES.md "Alerting Guidance" high-signal rules must always land in the
   hot band, so any matching rule lifts the score to at least HOT_MIN:
     - willing_to_pay is "$500-$2,000 / mo" or higher
     - expected_users >= 50
     - company_size "201-1000" or "1000+"
     - decision_timeline "Now"
     - current_agent_tools includes "Internal agent"
   ─────────────────────────────────────────────────────────────────────────── */

export type LeadBand = "cold" | "warm" | "hot";

export type LeadSignupFields = {
  work_email: string;
  company_size: string;
  expected_users: number;
  current_agent_tools: readonly string[];
  monthly_ai_spend: string;
  willing_to_pay: string;
  decision_timeline: string;
  main_pain_point: string;
};

export type LeadScore = {
  score: number;
  band: LeadBand;
  /** Matched docs/HERMES.md high-signal rules ("notify Joe" reasons). */
  highSignals: string[];
};

export const WARM_MIN = 40;
export const HOT_MIN = 70;

const TIMELINE_POINTS: Record<string, number> = {
  Now: 25,
  "30 days": 15,
  "90 days": 5,
};

const SPEND_POINTS: Record<string, number> = {
  "Under $500": 5,
  "$500-$2,000": 15,
  "$2,000-$10,000": 15,
  "$10,000+": 25,
};

const FREEMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
]);

const PAIN_POINT_KEYWORDS = /(access|permission|audit|context|agent)/i;

/** willing_to_pay tiers at or above "$500-$2,000 / mo" (HERMES.md high signal). */
const HIGH_SIGNAL_WILLING_TO_PAY = new Set([
  "$500-$2,000 / mo",
  "$2,000-$10,000 / mo",
  "$10,000+ / mo",
]);

const HIGH_SIGNAL_COMPANY_SIZES = new Set(["201-1000", "1000+"]);

function expectedUsersPoints(expectedUsers: number): number {
  if (expectedUsers >= 500) return 20;
  if (expectedUsers >= 50) return 25;
  if (expectedUsers >= 10) return 15;
  if (expectedUsers >= 1) return 5;
  return 0;
}

function agentStackPoints(tools: readonly string[]): number {
  const stack = tools.filter((tool) => tool !== "We are evaluating").length;
  if (stack >= 3) return 15;
  if (stack === 2) return 10;
  if (stack === 1) return 5;
  return 0;
}

function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).trim().toLowerCase();
}

/** docs/HERMES.md high-signal rules; each match alone forces the hot band. */
export function highSignalReasons(input: LeadSignupFields): string[] {
  const reasons: string[] = [];
  if (HIGH_SIGNAL_WILLING_TO_PAY.has(input.willing_to_pay)) {
    reasons.push(`willing_to_pay ${input.willing_to_pay}`);
  }
  if (input.expected_users >= 50) {
    reasons.push(`expected_users ${input.expected_users}`);
  }
  if (HIGH_SIGNAL_COMPANY_SIZES.has(input.company_size)) {
    reasons.push(`company_size ${input.company_size}`);
  }
  if (input.decision_timeline === "Now") {
    reasons.push("decision_timeline Now");
  }
  if (input.current_agent_tools.includes("Internal agent")) {
    reasons.push("current_agent_tools includes Internal agent");
  }
  return reasons;
}

export function bandForScore(score: number): LeadBand {
  if (score >= HOT_MIN) return "hot";
  if (score >= WARM_MIN) return "warm";
  return "cold";
}

export function scoreLead(input: LeadSignupFields): LeadScore {
  let score = 0;
  score += TIMELINE_POINTS[input.decision_timeline] ?? 0;
  score += expectedUsersPoints(input.expected_users);
  score += SPEND_POINTS[input.monthly_ai_spend] ?? 0;
  score += agentStackPoints(input.current_agent_tools);
  if (PAIN_POINT_KEYWORDS.test(input.main_pain_point)) score += 10;
  if (FREEMAIL_DOMAINS.has(emailDomain(input.work_email))) score -= 10;

  score = Math.max(0, Math.min(100, score));

  const highSignals = highSignalReasons(input);
  if (highSignals.length > 0) score = Math.max(score, HOT_MIN);

  return { score, band: bandForScore(score), highSignals };
}
