// Client-safe bug-report schema and constants. The server-side delivery flow
// lives in lib/core/bug-report-flow.ts so no delivery code or credential
// handling is pulled into the browser bundle.
import { z } from "zod";

export const BUG_REPORT_EMAIL = "bugs@agents.frege.dev";
export const BUG_REPORT_MAX_BYTES = 24_000;

// C0 controls plus DEL, excluding tab and newline (kept in multiline fields
// after CRLF normalization). Raw CR never survives: multiline fields normalize
// it away and single-line fields reject it, so no field can smuggle CRLF into
// a mail header or upstream request.
const FORBIDDEN_MULTILINE_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const ANY_CONTROL = /[\u0000-\u001F\u007F]/;

const controlCharMessage = "Remove control characters from this field.";

function singleLine(min: number, max: number, minMessage: string, maxMessage?: string) {
  return z
    .string()
    .trim()
    .min(min, minMessage)
    .max(max, maxMessage)
    .refine((value) => !ANY_CONTROL.test(value), { message: controlCharMessage });
}

function multiline(min: number, max: number, minMessage: string) {
  return z
    .string()
    .max(max * 2)
    .transform((value) => value.replace(/\r\n?/g, "\n"))
    .pipe(
      z
        .string()
        .trim()
        .min(min, minMessage)
        .max(max)
        .refine((value) => !FORBIDDEN_MULTILINE_CONTROL.test(value), { message: controlCharMessage }),
    );
}

const optionalEmail = z
  .union([z.literal(""), z.string().trim().email("Enter a valid email address.").max(254)])
  .optional()
  .transform((value) => value || undefined);

const optionalPageUrl = z
  .union([
    z.literal(""),
    z
      .string()
      .trim()
      .max(2_048, "Page URL is too long.")
      .url("Enter a valid page URL.")
      // WHATWG URL parsing (which .url() uses) silently strips raw tab/CR/LF,
      // so also reject control characters in the raw string.
      .refine((value) => !ANY_CONTROL.test(value), { message: controlCharMessage })
      .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
        message: "Page URL must start with http:// or https://.",
      }),
  ])
  .optional()
  .transform((value) => value || undefined);

export const bugReportSchema = z
  .object({
    summary: singleLine(5, 160, "Add a short summary.", "Keep the summary under 160 characters."),
    details: multiline(10, 5_000, "Add enough detail to understand the bug."),
    reproduction_steps: multiline(5, 5_000, "Add the steps that reproduce the bug."),
    expected_behavior: multiline(5, 3_000, "Describe what you expected."),
    actual_behavior: multiline(5, 3_000, "Describe what actually happened."),
    contact_email: optionalEmail,
    page_url: optionalPageUrl,
    _gotcha: z.string().max(200).optional().default(""),
  })
  .strict();

export type BugReport = Omit<z.infer<typeof bugReportSchema>, "_gotcha">;
