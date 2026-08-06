import { z } from "zod";

export const BUG_REPORT_EMAIL = "bugs@agents.frege.dev";
export const BUG_REPORT_MAX_BYTES = 24_000;

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
      .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
        message: "Page URL must start with http:// or https://.",
      }),
  ])
  .optional()
  .transform((value) => value || undefined);

export const bugReportSchema = z
  .object({
    summary: z.string().trim().min(5, "Add a short summary.").max(160, "Keep the summary under 160 characters."),
    details: z.string().trim().min(10, "Add enough detail to understand the bug.").max(5_000),
    reproduction_steps: z.string().trim().min(5, "Add the steps that reproduce the bug.").max(5_000),
    expected_behavior: z.string().trim().min(5, "Describe what you expected.").max(3_000),
    actual_behavior: z.string().trim().min(5, "Describe what actually happened.").max(3_000),
    contact_email: optionalEmail,
    page_url: optionalPageUrl,
    _gotcha: z.string().max(200).optional().default(""),
  })
  .strict();

type BugReportDeps = {
  formId?: string;
  fetch: typeof fetch;
};

function errorResponse(error: string, status: number): Response {
  return Response.json({ error, fallback_email: BUG_REPORT_EMAIL }, { status });
}

export async function handleBugReportRequest(req: Request, deps: BugReportDeps): Promise<Response> {
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return errorResponse("unsupported_media_type", 415);
  }

  const declaredBytes = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > BUG_REPORT_MAX_BYTES) {
    return errorResponse("payload_too_large", 413);
  }

  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return errorResponse("invalid_body", 400);
  }
  if (new TextEncoder().encode(rawBody).byteLength > BUG_REPORT_MAX_BYTES) {
    return errorResponse("payload_too_large", 413);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return errorResponse("invalid_json", 400);
  }

  const parsed = bugReportSchema.safeParse(body);
  if (!parsed.success) return errorResponse("validation", 400);

  // Bots get a normal-looking success so the honeypot does not teach them how
  // to bypass it, while no third-party request or email is generated.
  if (parsed.data._gotcha) return Response.json({ ok: true });

  const formId = deps.formId?.trim();
  if (!formId || !/^[a-zA-Z0-9]+$/.test(formId)) {
    return errorResponse("not_configured", 503);
  }

  const { _gotcha, ...report } = parsed.data;
  try {
    const response = await deps.fetch(`https://formspree.io/f/${formId}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...report,
        email: report.contact_email,
        _subject: `Frege bug report: ${report.summary}`,
        source: "frege.dev/report-a-bug",
      }),
    });
    if (!response.ok) return errorResponse("delivery_failed", 502);
  } catch {
    return errorResponse("delivery_failed", 502);
  }

  return Response.json({ ok: true });
}
