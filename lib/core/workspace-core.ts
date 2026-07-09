import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { getSql as getDefaultSql } from "@/lib/db";
import type { HermesWebhookResult } from "@/lib/hermes-webhook";
import { clientIp, hashIp } from "@/lib/core/client-ip";
import type { HotLeadSignupSummary } from "@/lib/core/lead-alert";
import { scoreLead, type LeadScore } from "@/lib/core/lead-score";
import { defaultAgentRoleStatements } from "@/lib/core/org-guard";
import { assertSafeBrowserMutation, readJson } from "@/lib/core/request-guards";
import {
  billingSelection,
  signupCreatedPayload,
  uniqueOrgSlug,
  type SignupWebhookRow,
} from "@/lib/core/signup-flow-core";
import { SELF_SERVE_PLAN_KEYS } from "@/lib/signup-schema";

// Workspace setup for social signups: a user who arrived through the Clerk
// bridge (Google/GitHub) exists with a verified email but no org. This flow
// provisions the same org bundle the password signup creates — org + default
// agent roles + owner membership + org_billing + a qualified signups row — in
// ONE atomic sql.transaction batch with pre-generated UUIDs, mirroring
// lib/core/signup-flow-core.ts (the neon HTTP driver runs the batch
// non-interactively, so no statement may read another's results).
//
// Written against injected deps so scripts/prototype/test-workspace.mjs can
// exercise every branch hermetically.

type Sql = ReturnType<typeof getDefaultSql>;

type RateLimitResult = {
  allowed: boolean;
  attempts: number;
  limit: number;
  retryAfterSeconds: number;
};

type WorkspaceTelemetryInput = {
  actor: { type: "system"; orgId?: string };
  req?: Request;
  action: string;
  resourceType?: string;
  resourceId?: string;
  outcome: "success" | "failure" | "denied";
  latencyMs?: number;
  metadata?: Record<string, unknown>;
};

// Structural subset of UserSessionContext (lib/core/session.ts) — the same
// authenticateUserRequest helper the /api/v1/auth/me route uses satisfies it.
export type WorkspaceSessionContext = {
  user: {
    id: string;
    email: string;
    name: string;
  };
  memberships: Array<{ org_id: string; status: string }>;
};

export type WorkspaceFlowDeps = {
  getSql: () => Sql;
  authenticateUser: (req: Request) => Promise<WorkspaceSessionContext | null>;
  checkRateLimit: (
    req: Request,
    input: {
      action: string;
      limit: number;
      windowSeconds: number;
      keyParts?: string[];
    },
  ) => Promise<RateLimitResult>;
  rateLimitedResponse: (limit: RateLimitResult) => Response;
  logTelemetryEvent: (event: WorkspaceTelemetryInput) => Promise<void>;
  postHermesEvent: (payload: unknown) => Promise<HermesWebhookResult>;
  recordSignupMonitorEvent: (eventType: "frege.signup.created", payload: unknown) => Promise<unknown>;
  maybeSendHotLeadAlert: (lead: LeadScore, signup: HotLeadSignupSummary) => Promise<unknown>;
};

const NEXT_PATH = "/console?view=account";
const NOT_PROVIDED = "Not provided";

const workspaceSchema = z.object({
  org_name: z.string().trim().min(1, "Workspace name is required.").max(200),
  plan: z.enum(SELF_SERVE_PLAN_KEYS).default("solo"),
  seats: z.coerce
    .number({ invalid_type_error: "Enter a seat count." })
    .int("Enter a whole number.")
    .min(1, "Use at least 1 seat.")
    .max(500, "Contact us for more than 500 seats.")
    .optional()
    .default(1),
});

type ExistingWorkspaceSignupRow = {
  signup_id: string;
};

export async function handleWorkspaceCreateRequest(req: Request, deps: WorkspaceFlowDeps): Promise<Response> {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  const startedAt = Date.now();
  try {
    // Session first: this endpoint only exists for signed-in users.
    const session = await deps.authenticateUser(req);
    if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

    const json = await readJson(req);
    if (!json.ok) return json.response;

    const parsed = workspaceSchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const limit = await deps.checkRateLimit(req, {
      action: "auth.workspace.create",
      limit: 10,
      windowSeconds: 60 * 60,
      keyParts: [session.user.id],
    });
    if (!limit.allowed) return deps.rateLimitedResponse(limit);

    // One workspace per self-serve user: an active membership means the
    // console (not this form) is the right place to be.
    if (session.memberships.some((membership) => membership.status === "active")) {
      return Response.json({ error: "workspace_exists" }, { status: 409 });
    }

    const sql = deps.getSql();
    const userId = session.user.id;
    const email = session.user.email;
    const orgName = parsed.data.org_name;
    const ip_hash = hashIp(clientIp(req), { requireSalt: true });
    const user_agent = req.headers.get("user-agent") ?? null;

    // The lead views must see social signups too, but this flow collects no
    // survey answers — score with the neutral/lowest enum values so lead
    // scoring stays honest (band lands cold unless the row already existed).
    const lead = scoreLead({
      work_email: email,
      company_size: "1-10",
      expected_users: 0,
      current_agent_tools: [],
      monthly_ai_spend: NOT_PROVIDED,
      willing_to_pay: NOT_PROVIDED,
      decision_timeline: NOT_PROVIDED,
      main_pain_point: NOT_PROVIDED,
    });

    // signups has a case-insensitive unique index on work_email; a row may
    // already exist from an earlier lead capture. Keep its survey answers —
    // only mark it qualified and owned.
    const [existingSignup] = (await sql`
      select id as signup_id
      from signups
      where lower(work_email) = lower(${email})
      limit 1
    `) as ExistingWorkspaceSignupRow[];

    // ── Atomic provisioning batch (pre-generated UUIDs, one transaction) ──
    const orgId = randomUUID();
    const slug = await uniqueOrgSlug(sql, orgName || email.split("@")[0] || "org");

    const statements = [];
    statements.push(sql`
      insert into organizations (id, slug, name, status)
      values (${orgId}, ${slug}, ${orgName}, 'inactive')
    `);
    statements.push(...defaultAgentRoleStatements(sql, orgId));
    const ownerRole = "owner";
    statements.push(sql`
      insert into organization_memberships (org_id, user_id, role, status)
      values (${orgId}, ${userId}, ${ownerRole}, 'active')
      on conflict (org_id, user_id) do update set
        role = excluded.role,
        status = 'active'
    `);

    const signupStatementIndex = statements.length;
    statements.push(
      existingSignup
        ? sql`
            update signups
            set
              status = 'qualified',
              qualified_at = coalesce(qualified_at, now()),
              owner_user_id = ${userId}
            where id = ${existingSignup.signup_id}
            returning
              id, created_at,
              name, work_email, company, role, company_size,
              expected_users, current_agent_tools, other_tool, monthly_ai_spend,
              willing_to_pay, decision_timeline, main_pain_point, other_comments
          `
        : sql`
            insert into signups (
              id, ip_hash, user_agent,
              name, work_email, company, role, company_size,
              expected_users, current_agent_tools, other_tool, monthly_ai_spend,
              willing_to_pay, decision_timeline, main_pain_point, other_comments,
              permission_to_contact,
              score, band,
              status, qualified_at, owner_user_id
            ) values (
              ${randomUUID()}, ${ip_hash}, ${user_agent},
              ${session.user.name}, ${email}, ${orgName}, ${NOT_PROVIDED}, ${"1-10"},
              ${0}, ${[]}, ${""}, ${NOT_PROVIDED},
              ${NOT_PROVIDED}, ${NOT_PROVIDED}, ${NOT_PROVIDED}, ${""},
              ${true},
              ${lead.score}, ${lead.band},
              'qualified', now(), ${userId}
            )
            returning
              id, created_at,
              name, work_email, company, role, company_size,
              expected_users, current_agent_tools, other_tool, monthly_ai_spend,
              willing_to_pay, decision_timeline, main_pain_point, other_comments
          `,
    );

    const selectedBilling = billingSelection(parsed.data.plan, parsed.data.seats);
    statements.push(sql`
      insert into org_billing (org_id, plan, billing_interval, seats, updated_at)
      values (${orgId}, ${selectedBilling.plan}, ${selectedBilling.interval}, ${selectedBilling.seats}, now())
      on conflict (org_id) do update set
        plan = excluded.plan,
        billing_interval = excluded.billing_interval,
        seats = excluded.seats,
        updated_at = now()
    `);

    const results = await sql.transaction(statements);
    const signup = (results[signupStatementIndex] as SignupWebhookRow[] | undefined)?.[0];

    // ── Side effects only after the batch commits (mirror signup-flow-core:
    // monitor record first, then the env-gated external webhook, then the
    // hot-lead alert; none of them throw). For a pre-existing signups row the
    // payload lead is recomputed from its original survey answers.
    if (signup) {
      const payloadLead = existingSignup
        ? scoreLead({
            work_email: signup.work_email,
            company_size: signup.company_size,
            expected_users: signup.expected_users,
            current_agent_tools: signup.current_agent_tools,
            monthly_ai_spend: signup.monthly_ai_spend,
            willing_to_pay: signup.willing_to_pay,
            decision_timeline: signup.decision_timeline,
            main_pain_point: signup.main_pain_point,
          })
        : lead;
      const monitorPayload = signupCreatedPayload(signup, payloadLead);
      await deps.recordSignupMonitorEvent("frege.signup.created", monitorPayload);
      const webhookResult = await deps.postHermesEvent(monitorPayload);
      if (!webhookResult.ok && !webhookResult.skipped) {
        console.error("hermes workspace signup webhook failed", {
          status: webhookResult.status,
          statusText: webhookResult.statusText,
          message: webhookResult.message,
        });
      }
      await deps.maybeSendHotLeadAlert(payloadLead, {
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

    await deps.logTelemetryEvent({
      actor: { type: "system", orgId },
      req,
      action: "auth.signup",
      resourceType: "organization",
      resourceId: orgId,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: {
        method: "social_workspace",
        org_slug: slug,
        signup_id: signup?.id ?? null,
        plan: parsed.data.plan,
        seats: selectedBilling.seats,
      },
    });

    return Response.json({ ok: true, next: NEXT_PATH }, { status: 200 });
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    // The batch is atomic, so a unique violation that escapes it can only be a
    // concurrent workspace creation for the same user/email.
    if (code === "23505") return Response.json({ error: "workspace_exists" }, { status: 409 });
    // Never log PII; log only the error shape.
    console.error("workspace create failed", { code, message: (err as Error)?.message });
    return Response.json({ error: "workspace_failed" }, { status: 500 });
  }
}
