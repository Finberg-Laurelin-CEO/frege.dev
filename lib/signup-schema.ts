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
  "ChatGPT",
  "Perplexity",
  "Other MCP tools",
  "We are evaluating",
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
  monthly_ai_spend: z.enum(MONTHLY_AI_SPEND, {
    errorMap: () => ({ message: "Select a monthly spend range." }),
  }),
  decision_timeline: z.enum(DECISION_TIMELINES, {
    errorMap: () => ({ message: "Select a decision timeline." }),
  }),
  main_pain_point: z
    .string()
    .trim()
    .min(10, "Tell us a little more (at least 10 characters).")
    .max(1000, "Keep it under 1000 characters."),
  permission_to_contact: z.literal(true, {
    errorMap: () => ({ message: "We need your permission to contact you." }),
  }),
};

/** What the client form validates. */
export const clientSchema = z.object(signupFields);

/** Full payload the server validates — adds anti-spam fields. */
export const signupSchema = z.object({
  ...signupFields,
  // Honeypot: hidden from real users; bots tend to fill every field. Accept any
  // string at the schema layer (so it always parses) — the route inspects it and
  // silently drops a non-empty value instead of returning a validation error.
  company_url: z.string().optional().default(""),
  // Client epoch ms captured on form mount; server enforces a min dwell time.
  started_at: z.coerce.number().int().nonnegative(),
});

export type SignupInput = z.infer<typeof clientSchema>;
export type SignupPayload = z.infer<typeof signupSchema>;
