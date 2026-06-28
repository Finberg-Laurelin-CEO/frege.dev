import { createHash } from "node:crypto";
import { getSql } from "@/lib/db";
import { postHermesEvent } from "@/lib/hermes-webhook";
import { signupSchema } from "@/lib/signup-schema";
import { signupRecoveryFromRow } from "@/lib/signup-recovery";

export const runtime = "nodejs";

const MIN_DWELL_MS = 3000;

type SignupWebhookRow = {
  id: string;
  created_at: Date | string;
  name: string;
  work_email: string;
  company: string;
  role: string;
  company_size: string;
  expected_users: number;
  current_agent_tools: string[];
  other_tool: string;
  monthly_ai_spend: string;
  willing_to_pay: string;
  decision_timeline: string;
  main_pain_point: string;
  other_comments: string;
};

type DuplicateSignupRow = {
  created_at: Date | string;
  user_status: string | null;
  last_login_at: Date | string | null;
  invite_status: string | null;
};

function toIsoString(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString();
}

async function sendHermesSignupWebhook(signup: SignupWebhookRow): Promise<void> {
  const created_at = toIsoString(signup.created_at);
  const payload = {
    event: "frege.signup.created",
    created_at,
    signup: {
      id: signup.id,
      name: signup.name,
      work_email: signup.work_email,
      company: signup.company,
      role: signup.role,
      company_size: signup.company_size,
      expected_users: signup.expected_users,
      current_agent_tools: signup.current_agent_tools,
      other_tool: signup.other_tool,
      monthly_ai_spend: signup.monthly_ai_spend,
      willing_to_pay: signup.willing_to_pay,
      decision_timeline: signup.decision_timeline,
      main_pain_point: signup.main_pain_point,
      other_comments: signup.other_comments,
    },
  };

  const result = await postHermesEvent(payload);
  if (result.ok || result.skipped) return;

  console.error("hermes signup webhook failed", {
    status: result.status,
    statusText: result.statusText,
    message: result.message,
  });
}

async function duplicateSignupResponse(email: string): Promise<Response> {
  const sql = getSql();
  const [row] = await sql`
    select
      s.created_at,
      u.status as user_status,
      u.last_login_at,
      i.status as invite_status
    from signups s
    left join users u
      on lower(u.email) = lower(s.work_email)
      and u.status = 'active'
    left join organization_invites i on i.id = s.invite_id
    where lower(s.work_email) = lower(${email})
    limit 1
  ` as DuplicateSignupRow[];

  return Response.json(
    {
      error: "duplicate_signup",
      recovery: signupRecoveryFromRow(row),
    },
    { status: 409 },
  );
}

/** Hash the client IP with a day-rotating salt so we never store a raw IP. */
function hashIp(ip: string): string {
  const day = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
  const salt = process.env.IP_HASH_SALT;
  if (!salt && process.env.NODE_ENV === "production") {
    throw new Error("IP_HASH_SALT is not set");
  }
  return createHash("sha256").update(`${ip}|${day}|${salt ?? "frege-dev-salt"}`).digest("hex");
}

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "validation", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // ── Spam controls: respond 200 with a null id so bots can't probe. ──
  // Honeypot: a real user never fills the hidden company_url field.
  if (data.company_url && data.company_url.length > 0) {
    return Response.json({ id: null }, { status: 200 });
  }
  // Timing: submissions faster than the dwell threshold are almost always bots.
  if (Date.now() - data.started_at < MIN_DWELL_MS) {
    return Response.json({ id: null }, { status: 200 });
  }

  const ip_hash = hashIp(clientIp(req));
  const user_agent = req.headers.get("user-agent") ?? null;

  try {
    const sql = getSql();
    const rows = await sql`
      insert into signups (
        ip_hash, user_agent,
        name, work_email, company, role, company_size,
        expected_users, current_agent_tools, other_tool, monthly_ai_spend,
        willing_to_pay, decision_timeline, main_pain_point, other_comments,
        permission_to_contact
      ) values (
        ${ip_hash}, ${user_agent},
        ${data.name}, ${data.work_email}, ${data.company}, ${data.role}, ${data.company_size},
        ${data.expected_users}, ${data.current_agent_tools}, ${data.other_tool}, ${data.monthly_ai_spend},
        ${data.willing_to_pay}, ${data.decision_timeline}, ${data.main_pain_point}, ${data.other_comments},
        ${data.permission_to_contact}
      )
      returning
        id, created_at,
        name, work_email, company, role, company_size,
        expected_users, current_agent_tools, other_tool, monthly_ai_spend,
        willing_to_pay, decision_timeline, main_pain_point, other_comments
    `;
    const signup = rows[0] as SignupWebhookRow | undefined;
    if (signup) {
      await sendHermesSignupWebhook(signup);
    }
    const id = signup?.id;
    return Response.json({ id }, { status: 200 });
  } catch (err: unknown) {
    // Unique violation on lower(work_email) → duplicate.
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      return duplicateSignupResponse(data.work_email);
    }
    // Never log PII (name/email/company); log only the error shape.
    console.error("signup insert failed", { code, message: (err as Error)?.message });
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
