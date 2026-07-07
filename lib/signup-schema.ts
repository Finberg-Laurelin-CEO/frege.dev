import { z } from "zod";

const NOT_PROVIDED = "Not provided";

function optionalText(defaultValue = NOT_PROVIDED, maxLength = 200) {
  return z.preprocess(
    (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
    z.string().trim().max(maxLength).optional().default(defaultValue),
  );
}

/* ───────────────────────────────────────────────────────────────────────────
   Frege signup schema — single source of truth shared by the client form
   (app/signup/page.tsx) and the server route (app/api/signup/route.ts).

   The stored-field validators live in `signupFields`. `clientSchema` is what
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

/** Stored signup fields. Some qualification fields default to "Not provided" for the short signup form. */
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
  role: optionalText(),
  company_size: z.enum(COMPANY_SIZES, {
    errorMap: () => ({ message: "Select an org size." }),
  }),
  expected_users: z.coerce
    .number({ invalid_type_error: "Enter a number." })
    .int("Enter a whole number.")
    .min(0, "Must be at least 0.")
    .max(100000, "That seems too large.")
    .optional()
    .default(0),
  current_agent_tools: z.array(z.enum(AGENT_TOOLS)).optional().default([]),
  // Free text shown when "Other" is checked. Required-if-Other is enforced on
  // the object schema below (a field validator can't see sibling fields).
  other_tool: z.string().trim().max(200).optional().default(""),
  monthly_ai_spend: z
    .union([z.enum(MONTHLY_AI_SPEND), z.literal(NOT_PROVIDED)])
    .optional()
    .default(NOT_PROVIDED),
  willing_to_pay: z
    .union([z.enum(WILLING_TO_PAY), z.literal(NOT_PROVIDED)])
    .optional()
    .default(NOT_PROVIDED),
  decision_timeline: z
    .union([z.enum(DECISION_TIMELINES), z.literal(NOT_PROVIDED)])
    .optional()
    .default(NOT_PROVIDED),
  main_pain_point: optionalText("Pilot access request", 1000),
  other_comments: optionalText("", 2000),
  permission_to_contact: z.literal(true, {
    errorMap: () => ({ message: "We need your permission to contact you." }),
  }),
};

export const accountFields = {
  password: z.string().min(12, "Use at least 12 characters.").max(256),
  confirm_password: z.string().min(1, "Confirm your password.").max(256),
};

export const clientFields = {
  ...signupFields,
  ...accountFields,
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

function requireMatchingPasswords(
  val: { password?: string; confirm_password?: string },
  ctx: z.RefinementCtx,
) {
  if (val.password && val.confirm_password && val.password !== val.confirm_password) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["confirm_password"],
      message: "Passwords must match.",
    });
  }
}

/** What the client form validates. */
export const clientSchema = z
  .object(clientFields)
  .superRefine(requireOtherTool)
  .superRefine(requireMatchingPasswords);

/** Full payload the server validates — adds anti-spam fields. */
export const signupSchema = z
  .object({
    ...clientFields,
    // Honeypot: hidden from real users; bots tend to fill every field. Accept any
    // string at the schema layer (so it always parses) — the route inspects it and
    // silently drops a non-empty value instead of returning a validation error.
    company_url: z.string().optional().default(""),
    // Client epoch ms captured on form mount; retained for telemetry/abuse analysis.
    started_at: z.coerce.number().int().nonnegative(),
  })
  .superRefine(requireOtherTool)
  .superRefine(requireMatchingPasswords);

export type SignupInput = z.infer<typeof clientSchema>;
export type SignupPayload = z.infer<typeof signupSchema>;
