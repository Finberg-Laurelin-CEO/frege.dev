import { z } from "zod";

/* ───────────────────────────────────────────────────────────────────────────
   Frege signup schema — single source of truth shared by the client form
   (app/signup/page.tsx) and the server route (app/api/signup/route.ts).

   The visible-field validators live in `signupFields`. `clientSchema` is what
   the form validates against; `signupSchema` adds the anti-spam fields
   (honeypot + client timestamp) that the server checks.
   ─────────────────────────────────────────────────────────────────────────── */

export const COMPANY_SIZES = [
  "1-10",
  "11-50",
  "51-200",
  "201-1000",
  "1000+",
] as const;

export const AGENT_TOOLS = [
  "Codex",
  "Claude Code",
  "Cursor",
  "OpenRouter",
  "Internal agent",
  "Hermes agent",
  "OpenClaw",
  "ChatGPT",
  "Perplexity",
  "Other MCP tools",
  "We are evaluating",
  "Other",
] as const;

export const MONTHLY_AI_SPEND = [
  "Under $500",
  "$500-$2,000",
  "$2,000-$10,000",
  "$10,000+",
  "Unknown",
] as const;

export const DECISION_TIMELINES = [
  "Now",
  "30 days",
  "90 days",
  "Researching",
] as const;

/** Willingness to pay — what they'd pay for Frege, per month, per org. */
export const WILLING_TO_PAY = [
  "Not sure yet",
  "Under $100 / mo",
  "$100-$500 / mo",
  "$500-$2,000 / mo",
  "$2,000-$10,000 / mo",
  "$10,000+ / mo",
] as const;

/** The visible, user-entered fields. */
export const signupFields = {
  name: z.string().trim().min(1, "Your name is required.").max(200),
  work_email: z
    .string()
    .trim()
    .min(1, "Work email is required.")
    .email("Enter a valid email address.")
    .max(320)
    .transform((s) => s.toLowerCase()),
  company: z.string().trim().min(1, "Company is required.").max(200),
  role: z.string().trim().min(1, "Your role is required.").max(200),
  company_size: z.enum(COMPANY_SIZES, {
    errorMap: () => ({ message: "Select a company size." }),
  }),
  expected_users: z.coerce
    .number({ invalid_type_error: "Enter a number." })
    .int("Enter a whole number.")
    .min(1, "Must be at least 1.")
    .max(100000, "That seems too large."),
  current_agent_tools: z
    .array(z.enum(AGENT_TOOLS))
    .min(1, "Select at least one tool."),
  // Free text shown when "Other" is checked. Required-if-Other is enforced on
  // the object schema below (a field validator can't see sibling fields).
  other_tool: z.string().trim().max(200).optional().default(""),
  monthly_ai_spend: z.enum(MONTHLY_AI_SPEND, {
    errorMap: () => ({ message: "Select a monthly spend range." }),
  }),
  willing_to_pay: z.enum(WILLING_TO_PAY, {
    errorMap: () => ({ message: "Select what you'd expect to pay." }),
  }),
  decision_timeline: z.enum(DECISION_TIMELINES, {
    errorMap: () => ({ message: "Select a decision timeline." }),
  }),
  main_pain_point: z
    .string()
    .trim()
    .min(10, "Tell us a little more (at least 10 characters).")
    .max(1000, "Keep it under 1000 characters."),
  other_comments: z.string().trim().max(2000).optional().default(""),
  permission_to_contact: z.literal(true, {
    errorMap: () => ({ message: "We need your permission to contact you." }),
  }),
};

/** If "Other" is among the selected tools, `other_tool` must be filled in. */
function requireOtherTool(
  val: { current_agent_tools: readonly string[]; other_tool?: string },
  ctx: z.RefinementCtx,
) {
  if (
    val.current_agent_tools.includes("Other") &&
    (!val.other_tool || val.other_tool.trim().length === 0)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["other_tool"],
      message: "Tell us which other tool.",
    });
  }
}

/** What the client form validates. */
export const clientSchema = z.object(signupFields).superRefine(requireOtherTool);

/** Full payload the server validates — adds anti-spam fields. */
export const signupSchema = z
  .object({
    ...signupFields,
    // Honeypot: hidden from real users; bots tend to fill every field. Accept any
    // string at the schema layer (so it always parses) — the route inspects it and
    // silently drops a non-empty value instead of returning a validation error.
    company_url: z.string().optional().default(""),
    // Client epoch ms captured on form mount; server enforces a min dwell time.
    started_at: z.coerce.number().int().nonnegative(),
  })
  .superRefine(requireOtherTool);

export type SignupInput = z.infer<typeof clientSchema>;
export type SignupPayload = z.infer<typeof signupSchema>;
