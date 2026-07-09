import { randomBytes } from "node:crypto";
import { getSql } from "@/lib/db";
import { postHermesEvent } from "@/lib/hermes-webhook";
import { clientIp, hashIp } from "@/lib/core/client-ip";
import {
  emailVerificationUrlForToken,
  issueEmailVerificationToken,
} from "@/lib/core/email-verification";
import { sendEmailVerificationEmail, sendSignupWelcomeEmail } from "@/lib/core/email";
import { maybeSendHotLeadAlert } from "@/lib/core/lead-alert";
import { scoreLead, type LeadScore } from "@/lib/core/lead-score";
import { recordSignupMonitorEvent } from "@/lib/core/signup-monitor";
import { ensureDefaultAgentRoles, normalizeEmail, slugifyOrg } from "@/lib/core/org-guard";
import { hashPassword } from "@/lib/core/password";
import { customerAppBaseUrl } from "@/lib/core/public-url";
import { checkRateLimit, rateLimitedResponse } from "@/lib/core/rate-limit";
import { assertSafeOrigin } from "@/lib/core/request-guards";
import { createUserSession } from "@/lib/core/session";
import { logTelemetryEvent } from "@/lib/core/telemetry";
import { signupSchema } from "@/lib/signup-schema";

export const runtime = "nodejs";

const NEXT_PATH = "/console?view=account";

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

type ExistingSignupRow = {
  signup_id: string;
  invite_id: string | null;
  invite_status: string | null;
  invite_role: "owner" | "admin" | "member" | "viewer" | null;
  org_id: string | null;
  org_slug: string | null;
  org_name: string | null;
  org_status: "inactive" | "active" | "suspended" | null;
};

function toIsoString(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString();
}

function signupCreatedPayload(signup: SignupWebhookRow, lead: LeadScore) {
  const created_at = toIsoString(signup.created_at);
  return {
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
      score: lead.score,
      band: lead.band,
    },
  };
}

async function sendHermesSignupWebhook(payload: ReturnType<typeof signupCreatedPayload>): Promise<void> {
  const result = await postHermesEvent(payload);
  if (result.ok || result.skipped) return;

  console.error("hermes signup webhook failed", {
    status: result.status,
    statusText: result.statusText,
    message: result.message,
  });
}

async function uniqueOrgSlug(sql: ReturnType<typeof getSql>, base: string): Promise<string> {
  const root = slugifyOrg(base);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? root : `${root}-${attempt + 1}`;
    const [existing] = await sql`select 1 from organizations where slug = ${candidate} limit 1`;
    if (!existing) return candidate;
  }
  return `${root}-${randomBytes(3).toString("hex")}`;
}

function accountExistsResponse(): Response {
  return Response.json(
    {
      error: "account_exists",
      recovery: { action: "sign_in", requested_at: null },
    },
    { status: 409 },
  );
}

function accountResumeUrl(): string {
  return `${customerAppBaseUrl()}${NEXT_PATH}`;
}

function billingSelection(planKey: string, seats: number): { plan: "solo" | "team"; interval: "monthly" | "annual"; seats: number } {
  if (planKey === "team-annual") return { plan: "team", interval: "annual", seats: Math.max(1, seats) };
  if (planKey === "team-monthly") return { plan: "team", interval: "monthly", seats: Math.max(1, seats) };
  return { plan: "solo", interval: "monthly", seats: 1 };
}

export async function POST(req: Request) {
  const originError = assertSafeOrigin(req);
  if (originError) return originError;

  const startedAt = Date.now();
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
    return Response.json({ id: null, next_path: "/thanks" }, { status: 200 });
  }

  const email = normalizeEmail(data.work_email);
  // Strict: a missing IP_HASH_SALT in production fails the request.
  const ip_hash = hashIp(clientIp(req), { requireSalt: true });
  const user_agent = req.headers.get("user-agent") ?? null;

  // Lead scoring is pure and deterministic; computed once here and persisted
  // with the row (score + band columns, db/026).
  const lead = scoreLead({
    work_email: email,
    company_size: data.company_size,
    expected_users: data.expected_users,
    current_agent_tools: data.current_agent_tools,
    monthly_ai_spend: data.monthly_ai_spend,
    willing_to_pay: data.willing_to_pay,
    decision_timeline: data.decision_timeline,
    main_pain_point: data.main_pain_point,
  });

  try {
    const sql = getSql();

    const emailLimit = await checkRateLimit(req, {
      action: "auth.signup.email",
      limit: 5,
      windowSeconds: 60 * 60,
      keyParts: [email],
    });
    if (!emailLimit.allowed) return rateLimitedResponse(emailLimit);

    const ipLimit = await checkRateLimit(req, {
      action: "auth.signup.ip",
      limit: 20,
      windowSeconds: 60 * 60,
    });
    if (!ipLimit.allowed) return rateLimitedResponse(ipLimit);

    const [existingUser] = await sql`
      select id
      from users
      where email = ${email}
      limit 1
    `;
    if (existingUser) return accountExistsResponse();

    const [existingSignup] = await sql`
      select
        s.id as signup_id,
        s.invite_id,
        i.status as invite_status,
        i.role as invite_role,
        o.id as org_id,
        o.slug as org_slug,
        o.name as org_name,
        o.status as org_status
      from signups s
      left join organization_invites i on i.id = s.invite_id
      left join organizations o on o.id = i.org_id
      where lower(s.work_email) = lower(${email})
      limit 1
    ` as ExistingSignupRow[];

    let org:
      | { id: string; slug: string; name: string; status: "inactive" | "active" | "suspended" }
      | undefined;
    if (existingSignup?.org_id && existingSignup.org_slug && existingSignup.org_name && existingSignup.org_status) {
      org = {
        id: existingSignup.org_id,
        slug: existingSignup.org_slug,
        name: existingSignup.org_name,
        status: existingSignup.org_status,
      };
    } else {
      const slug = await uniqueOrgSlug(sql, data.company || data.name || email.split("@")[0] || "org");
      const [createdOrg] = await sql`
        insert into organizations (slug, name, status)
        values (${slug}, ${data.company || data.name}, 'inactive')
        returning id, slug, name, status
      `;
      org = createdOrg as typeof org;
    }
    if (!org) throw new Error("org_create_failed");

    await ensureDefaultAgentRoles(org.id);

    const password = await hashPassword(data.password);
    const [user] = await sql`
      insert into users (email, name, status, last_login_at)
      values (${email}, ${data.name.trim()}, 'active', now())
      returning id, email, name
    `;
    await sql`
      insert into user_password_credentials (user_id, password_hash, password_salt, password_params)
      values (${user.id}, ${password.passwordHash}, ${password.passwordSalt}, ${JSON.stringify(password.passwordParams)}::jsonb)
    `;
    await sql`
      insert into organization_memberships (org_id, user_id, role, status)
      values (${org.id}, ${user.id}, ${existingSignup?.invite_role ?? "owner"}, 'active')
      on conflict (org_id, user_id) do update set
        role = excluded.role,
        status = 'active'
    `;

    if (existingSignup?.invite_id && existingSignup.invite_status === "pending") {
      await sql`
        update organization_invites
        set status = 'accepted', accepted_at = now()
        where id = ${existingSignup.invite_id}
      `;
    }

    const signupRows = existingSignup
      ? await sql`
          update signups
          set
            ip_hash = ${ip_hash},
            user_agent = ${user_agent},
            name = ${data.name},
            work_email = ${email},
            company = ${data.company},
            role = ${data.role},
            company_size = ${data.company_size},
            expected_users = ${data.expected_users},
            current_agent_tools = ${data.current_agent_tools},
            other_tool = ${data.other_tool},
            monthly_ai_spend = ${data.monthly_ai_spend},
            willing_to_pay = ${data.willing_to_pay},
            decision_timeline = ${data.decision_timeline},
            main_pain_point = ${data.main_pain_point},
            other_comments = ${data.other_comments},
            permission_to_contact = ${data.permission_to_contact},
            score = ${lead.score},
            band = ${lead.band},
            status = 'qualified',
            qualified_at = coalesce(qualified_at, now()),
            owner_user_id = ${user.id},
            invited_at = case when invite_id is not null then coalesce(invited_at, now()) else invited_at end
          where id = ${existingSignup.signup_id}
          returning
            id, created_at,
            name, work_email, company, role, company_size,
            expected_users, current_agent_tools, other_tool, monthly_ai_spend,
            willing_to_pay, decision_timeline, main_pain_point, other_comments
        `
      : await sql`
          insert into signups (
            ip_hash, user_agent,
            name, work_email, company, role, company_size,
            expected_users, current_agent_tools, other_tool, monthly_ai_spend,
            willing_to_pay, decision_timeline, main_pain_point, other_comments,
            permission_to_contact,
            score, band,
            status, qualified_at, owner_user_id
          ) values (
            ${ip_hash}, ${user_agent},
            ${data.name}, ${email}, ${data.company}, ${data.role}, ${data.company_size},
            ${data.expected_users}, ${data.current_agent_tools}, ${data.other_tool}, ${data.monthly_ai_spend},
            ${data.willing_to_pay}, ${data.decision_timeline}, ${data.main_pain_point}, ${data.other_comments},
            ${data.permission_to_contact},
            ${lead.score}, ${lead.band},
            'qualified', now(), ${user.id}
          )
          returning
            id, created_at,
            name, work_email, company, role, company_size,
            expected_users, current_agent_tools, other_tool, monthly_ai_spend,
            willing_to_pay, decision_timeline, main_pain_point, other_comments
        `;

    const signup = signupRows[0] as SignupWebhookRow | undefined;
    if (signup) {
      const monitorPayload = signupCreatedPayload(signup, lead);
      // In-app monitor record first (Frege-native monitoring), then the
      // env-gated external webhook, then the hot-lead alert. None of these
      // throw, so signup success never depends on them.
      await recordSignupMonitorEvent("frege.signup.created", monitorPayload);
      await sendHermesSignupWebhook(monitorPayload);
      await maybeSendHotLeadAlert(lead, {
        name: signup.name,
        work_email: signup.work_email,
        company: signup.company,
        role: signup.role,
        company_size: signup.company_size,
        expected_users: signup.expected_users,
        current_agent_tools: signup.current_agent_tools,
        monthly_ai_spend: signup.monthly_ai_spend,
        willing_to_pay: signup.willing_to_pay,
        decision_timeline: signup.decision_timeline,
        main_pain_point: signup.main_pain_point,
      });
    }

    const selectedBilling = billingSelection(data.plan, data.seats);
    await sql`
      insert into org_billing (org_id, plan, billing_interval, seats, updated_at)
      values (${org.id}, ${selectedBilling.plan}, ${selectedBilling.interval}, ${selectedBilling.seats}, now())
      on conflict (org_id) do update set
        plan = excluded.plan,
        billing_interval = excluded.billing_interval,
        seats = excluded.seats,
        updated_at = now()
    `;

    const verificationToken = await issueEmailVerificationToken(sql, user.id);
    const verificationUrl = emailVerificationUrlForToken(verificationToken.rawToken);

    let welcomeEmailSent = false;
    let verificationEmailSent = false;
    try {
      const emailResult = await sendSignupWelcomeEmail({
        to: email,
        name: data.name,
        orgName: org.name,
        accountUrl: accountResumeUrl(),
      });
      welcomeEmailSent = emailResult.sent;
    } catch (err) {
      console.error("signup welcome email failed", {
        code: (err as { code?: string })?.code,
        message: (err as Error)?.message,
      });
    }
    try {
      const emailResult = await sendEmailVerificationEmail({
        to: email,
        name: data.name,
        verificationUrl,
      });
      verificationEmailSent = emailResult.sent;
    } catch (err) {
      console.error("signup verification email failed", {
        code: (err as { code?: string })?.code,
        message: (err as Error)?.message,
      });
    }

    const session = await createUserSession(user.id, req.headers.get("host"));
    await logTelemetryEvent({
      actor: { type: "system", orgId: org.id },
      req,
      action: "auth.signup",
      resourceType: "organization",
      resourceId: org.id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: {
        org_slug: org.slug,
        signup_id: signup?.id ?? null,
        reused_invite: Boolean(existingSignup?.invite_id),
        welcome_email_sent: welcomeEmailSent,
        verification_email_sent: verificationEmailSent,
        plan: data.plan,
        seats: selectedBilling.seats,
      },
    });

    return Response.json(
      {
        id: signup?.id,
        user: { id: user.id, email: user.email, name: user.name },
        organization: org,
        email_sent: welcomeEmailSent || verificationEmailSent,
        next_path: NEXT_PATH,
      },
      { status: 201, headers: { "Set-Cookie": session.cookie } },
    );
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "23505") return accountExistsResponse();
    // Never log PII (name/email/company); log only the error shape.
    console.error("signup failed", { code, message: (err as Error)?.message });
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
