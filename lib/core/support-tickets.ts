import { z } from "zod";
import { readJson } from "@/lib/core/request-guards";

// Support ticket route cores with injected dependencies, mirroring
// auth-flow-core.ts: the API routes authenticate (platform staff or org
// admin), wire real deps (db/telemetry/email/audit), and delegate here so
// visibility rules, status transitions, SLA stamping, and notification
// triggering are unit-testable without a database or Resend.

export type SupportTicketsSql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>;

type SupportTelemetryInput = {
  actor: { type: "system"; orgId?: string };
  req?: Request;
  action: string;
  resourceType?: string;
  resourceId?: string;
  outcome: "success" | "failure" | "denied";
  latencyMs?: number;
  metadata?: Record<string, unknown>;
};

export type SupportStaffActor = {
  user: { id: string; email: string };
};

export type SupportCustomerActor = {
  user: { id: string; email: string; name: string };
  organization: { id: string; slug: string; name: string };
};

export type SupportTicketNotifications = {
  // Where new-ticket notifications go (FREGE_SUPPORT_NOTIFY_EMAIL). Null or
  // empty means notifications are not configured and sends are skipped.
  staffNotifyEmail: () => string | null;
  sendTicketCreatedEmail: (input: {
    to: string;
    ticketId: string;
    subject: string;
    body: string;
    orgName: string;
    orgSlug: string;
    requesterEmail: string;
  }) => Promise<unknown>;
  sendStaffReplyEmail: (input: {
    to: string;
    name: string;
    ticketId: string;
    subject: string;
    body: string;
  }) => Promise<unknown>;
};

export type SupportTicketDeps = {
  getSql: () => SupportTicketsSql;
  logTelemetryEvent: (event: SupportTelemetryInput) => Promise<void>;
  routeError: (label: string, err: unknown) => Response;
  notifications: SupportTicketNotifications;
};

export type StaffSupportTicketDeps = SupportTicketDeps & {
  recordPlatformAudit: (input: {
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
  }) => Promise<void>;
};

export const TICKET_STATUSES = ["open", "pending", "resolved", "closed"] as const;
export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

const createTicketSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10000),
});

const messageSchema = z.object({
  body: z.string().trim().min(1).max(10000),
});

const staffPatchSchema = z
  .object({
    status: z.enum(TICKET_STATUSES).optional(),
    priority: z.enum(TICKET_PRIORITIES).optional(),
    assigned_to: z.string().uuid().nullable().optional(),
  })
  .refine(
    (value) => value.status !== undefined || value.priority !== undefined || value.assigned_to !== undefined,
    { message: "empty_patch" },
  );

function notFound(): Response {
  return Response.json({ error: "not_found" }, { status: 404 });
}

// --- Staff routes -----------------------------------------------------------

export async function handleStaffTicketsListRequest(
  req: Request,
  staff: SupportStaffActor,
  deps: StaffSupportTicketDeps,
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get("status")?.trim() ?? "";
    const priority = url.searchParams.get("priority")?.trim() ?? "";
    let assignee = url.searchParams.get("assignee")?.trim() ?? "";
    if (assignee === "me") assignee = staff.user.id;

    const sql = deps.getSql();
    const tickets = await sql`
      select
        t.id, t.org_id, t.subject, t.status, t.priority, t.assigned_to,
        t.first_response_at, t.resolved_at, t.created_at, t.updated_at,
        o.slug as org_slug, o.name as org_name,
        b.plan, b.seats, b.subscription_status,
        creator.email as created_by_email,
        assignee.email as assigned_to_email,
        (select count(*)::int from support_ticket_messages m where m.ticket_id = t.id) as message_count
      from support_tickets t
      left join organizations o on o.id = t.org_id
      left join org_billing b on b.org_id = t.org_id
      left join users creator on creator.id = t.created_by
      left join users assignee on assignee.id = t.assigned_to
      where (${status} = '' or t.status = ${status})
        and (${priority} = '' or t.priority = ${priority})
        and (${assignee} = '' or (case when ${assignee} = 'unassigned' then t.assigned_to is null else t.assigned_to::text = ${assignee} end))
      order by t.updated_at desc
      limit 200
    `;

    const countRows = await sql`
      select status, count(*)::int as count
      from support_tickets
      group by status
    `;
    const counts: Record<string, number> = { open: 0, pending: 0, resolved: 0, closed: 0 };
    for (const row of countRows) {
      counts[String(row.status)] = Number(row.count ?? 0);
    }

    return Response.json({ tickets, counts }, { status: 200 });
  } catch (err) {
    return deps.routeError("platform tickets list failed", err);
  }
}

export async function handleStaffTicketDetailRequest(
  req: Request,
  ticketId: string,
  deps: StaffSupportTicketDeps,
): Promise<Response> {
  try {
    const sql = deps.getSql();
    const [ticket] = await sql`
      select
        t.id, t.org_id, t.subject, t.status, t.priority, t.assigned_to,
        t.first_response_at, t.resolved_at, t.created_at, t.updated_at,
        o.slug as org_slug, o.name as org_name, o.status as org_status,
        b.plan, b.billing_interval, b.seats, b.subscription_status, b.current_period_end,
        creator.email as created_by_email, creator.name as created_by_name,
        assignee.email as assigned_to_email
      from support_tickets t
      left join organizations o on o.id = t.org_id
      left join org_billing b on b.org_id = t.org_id
      left join users creator on creator.id = t.created_by
      left join users assignee on assignee.id = t.assigned_to
      where t.id = ${ticketId}
      limit 1
    `;
    if (!ticket) return notFound();

    const messages = await sql`
      select
        m.id, m.author_id, m.author_kind, m.body, m.created_at,
        u.email as author_email, u.name as author_name
      from support_ticket_messages m
      left join users u on u.id = m.author_id
      where m.ticket_id = ${ticketId}
      order by m.created_at asc
    `;

    return Response.json({ ticket, messages }, { status: 200 });
  } catch (err) {
    return deps.routeError("platform ticket detail failed", err);
  }
}

export async function handleStaffTicketReplyRequest(
  req: Request,
  staff: SupportStaffActor,
  ticketId: string,
  deps: StaffSupportTicketDeps,
): Promise<Response> {
  const startedAt = Date.now();
  try {
    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = messageSchema.safeParse(json.value);
    if (!parsed.success) return Response.json({ error: "validation" }, { status: 400 });

    const sql = deps.getSql();
    const [ticket] = await sql`
      select
        t.id, t.org_id, t.subject, t.status,
        creator.email as creator_email, creator.name as creator_name
      from support_tickets t
      left join users creator on creator.id = t.created_by
      where t.id = ${ticketId}
      limit 1
    `;
    if (!ticket) return notFound();

    const [message] = await sql`
      insert into support_ticket_messages (ticket_id, author_id, author_kind, body)
      values (${ticketId}, ${staff.user.id}, 'staff', ${parsed.data.body})
      returning id, ticket_id, author_id, author_kind, body, created_at
    `;

    // First staff reply stamps the SLA clock; an open ticket becomes pending
    // (waiting on the customer).
    const [updated] = await sql`
      update support_tickets
      set
        first_response_at = coalesce(first_response_at, now()),
        status = case when status = 'open' then 'pending' else status end,
        updated_at = now()
      where id = ${ticketId}
      returning id, status, priority, first_response_at, resolved_at, updated_at
    `;

    // Notify the ticket creator. Best-effort: a failed email must never fail
    // the reply itself (same contract as signup's email sends).
    let emailSent = false;
    const creatorEmail = typeof ticket.creator_email === "string" ? ticket.creator_email : null;
    if (creatorEmail) {
      try {
        await deps.notifications.sendStaffReplyEmail({
          to: creatorEmail,
          name: typeof ticket.creator_name === "string" ? ticket.creator_name : "",
          ticketId,
          subject: String(ticket.subject ?? ""),
          body: parsed.data.body,
        });
        emailSent = true;
      } catch (err) {
        console.error("support ticket reply email failed", {
          message: (err as Error)?.message,
        });
      }
    }

    await deps.logTelemetryEvent({
      actor: { type: "system", orgId: (ticket.org_id as string | null) ?? undefined },
      req,
      action: "platform.tickets.reply",
      resourceType: "support_ticket",
      resourceId: ticketId,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { by_user: staff.user.email, email_sent: emailSent },
    });
    await deps.recordPlatformAudit({
      action: "ticket.reply",
      targetType: "support_ticket",
      targetId: ticketId,
      metadata: { subject: ticket.subject, email_sent: emailSent },
    });

    return Response.json({ message, ticket: updated }, { status: 201 });
  } catch (err) {
    return deps.routeError("platform ticket reply failed", err);
  }
}

export async function handleStaffTicketPatchRequest(
  req: Request,
  staff: SupportStaffActor,
  ticketId: string,
  deps: StaffSupportTicketDeps,
): Promise<Response> {
  const startedAt = Date.now();
  try {
    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = staffPatchSchema.safeParse(json.value);
    if (!parsed.success) return Response.json({ error: "validation" }, { status: 400 });

    const status = parsed.data.status ?? null;
    const priority = parsed.data.priority ?? null;
    const assignedProvided = parsed.data.assigned_to !== undefined;
    const assignedTo = parsed.data.assigned_to ?? null;

    // resolved/closed stamps resolved_at (keeping the original stamp on
    // repeated updates); reopening to open/pending clears it.
    const sql = deps.getSql();
    const [ticket] = await sql`
      update support_tickets
      set
        status = coalesce(${status}::text, status),
        priority = coalesce(${priority}::text, priority),
        assigned_to = case when ${assignedProvided}::boolean then ${assignedTo}::uuid else assigned_to end,
        resolved_at = case
          when ${status}::text in ('resolved', 'closed') then coalesce(resolved_at, now())
          when ${status}::text in ('open', 'pending') then null
          else resolved_at
        end,
        updated_at = now()
      where id = ${ticketId}
      returning id, org_id, subject, status, priority, assigned_to,
        first_response_at, resolved_at, created_at, updated_at
    `;
    if (!ticket) return notFound();

    await deps.logTelemetryEvent({
      actor: { type: "system", orgId: (ticket.org_id as string | null) ?? undefined },
      req,
      action: "platform.tickets.update",
      resourceType: "support_ticket",
      resourceId: ticketId,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: {
        by_user: staff.user.email,
        status: ticket.status,
        priority: ticket.priority,
        assigned_to: ticket.assigned_to,
      },
    });
    await deps.recordPlatformAudit({
      action: "ticket.update",
      targetType: "support_ticket",
      targetId: ticketId,
      metadata: { status: ticket.status, priority: ticket.priority, assigned_to: ticket.assigned_to },
    });

    return Response.json({ ticket }, { status: 200 });
  } catch (err) {
    return deps.routeError("platform ticket update failed", err);
  }
}

// --- Customer routes --------------------------------------------------------

export async function handleCustomerTicketCreateRequest(
  req: Request,
  auth: SupportCustomerActor,
  deps: SupportTicketDeps,
): Promise<Response> {
  const startedAt = Date.now();
  try {
    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = createTicketSchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const sql = deps.getSql();
    const [ticket] = await sql`
      insert into support_tickets (org_id, created_by, subject)
      values (${auth.organization.id}, ${auth.user.id}, ${parsed.data.subject})
      returning id, org_id, subject, status, priority, assigned_to,
        first_response_at, resolved_at, created_at, updated_at
    `;
    const [message] = await sql`
      insert into support_ticket_messages (ticket_id, author_id, author_kind, body)
      values (${ticket.id}, ${auth.user.id}, 'customer', ${parsed.data.body})
      returning id, ticket_id, author_id, author_kind, body, created_at
    `;

    // Notify staff about the new ticket. Env-gated: no FREGE_SUPPORT_NOTIFY_EMAIL
    // means skip; a send failure must never fail ticket creation.
    let emailSent = false;
    const notifyTo = deps.notifications.staffNotifyEmail();
    if (notifyTo) {
      try {
        await deps.notifications.sendTicketCreatedEmail({
          to: notifyTo,
          ticketId: String(ticket.id),
          subject: parsed.data.subject,
          body: parsed.data.body,
          orgName: auth.organization.name,
          orgSlug: auth.organization.slug,
          requesterEmail: auth.user.email,
        });
        emailSent = true;
      } catch (err) {
        console.error("support ticket created email failed", {
          message: (err as Error)?.message,
        });
      }
    }

    await deps.logTelemetryEvent({
      actor: { type: "system", orgId: auth.organization.id },
      req,
      action: "support.tickets.create",
      resourceType: "support_ticket",
      resourceId: String(ticket.id),
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { by_user: auth.user.email, subject: parsed.data.subject, email_sent: emailSent },
    });

    return Response.json({ ticket, message }, { status: 201 });
  } catch (err) {
    return deps.routeError("support ticket create failed", err);
  }
}

export async function handleCustomerTicketsListRequest(
  req: Request,
  auth: SupportCustomerActor,
  deps: SupportTicketDeps,
): Promise<Response> {
  try {
    const sql = deps.getSql();
    const tickets = await sql`
      select
        t.id, t.subject, t.status, t.priority,
        t.first_response_at, t.resolved_at, t.created_at, t.updated_at,
        (select count(*)::int from support_ticket_messages m where m.ticket_id = t.id) as message_count
      from support_tickets t
      where t.org_id = ${auth.organization.id}
      order by t.updated_at desc
      limit 200
    `;
    return Response.json({ tickets }, { status: 200 });
  } catch (err) {
    return deps.routeError("support tickets list failed", err);
  }
}

export async function handleCustomerTicketDetailRequest(
  req: Request,
  auth: SupportCustomerActor,
  ticketId: string,
  deps: SupportTicketDeps,
): Promise<Response> {
  try {
    // Own-org guard is the org_id predicate: a ticket from another org is
    // indistinguishable from a missing one (404, matching platform routes).
    const sql = deps.getSql();
    const [ticket] = await sql`
      select
        t.id, t.subject, t.status, t.priority,
        t.first_response_at, t.resolved_at, t.created_at, t.updated_at
      from support_tickets t
      where t.id = ${ticketId} and t.org_id = ${auth.organization.id}
      limit 1
    `;
    if (!ticket) return notFound();

    const messages = await sql`
      select
        m.id, m.author_kind, m.body, m.created_at,
        u.email as author_email, u.name as author_name
      from support_ticket_messages m
      left join users u on u.id = m.author_id
      where m.ticket_id = ${ticketId}
      order by m.created_at asc
    `;

    return Response.json({ ticket, messages }, { status: 200 });
  } catch (err) {
    return deps.routeError("support ticket detail failed", err);
  }
}

export async function handleCustomerTicketReplyRequest(
  req: Request,
  auth: SupportCustomerActor,
  ticketId: string,
  deps: SupportTicketDeps,
): Promise<Response> {
  const startedAt = Date.now();
  try {
    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = messageSchema.safeParse(json.value);
    if (!parsed.success) return Response.json({ error: "validation" }, { status: 400 });

    const sql = deps.getSql();
    const [existing] = await sql`
      select t.id, t.status
      from support_tickets t
      where t.id = ${ticketId} and t.org_id = ${auth.organization.id}
      limit 1
    `;
    if (!existing) return notFound();
    if (existing.status === "closed") {
      return Response.json({ error: "ticket_closed" }, { status: 409 });
    }

    const [message] = await sql`
      insert into support_ticket_messages (ticket_id, author_id, author_kind, body)
      values (${ticketId}, ${auth.user.id}, 'customer', ${parsed.data.body})
      returning id, ticket_id, author_id, author_kind, body, created_at
    `;

    // A customer reply on a pending ticket puts it back in staff's court.
    const [updated] = await sql`
      update support_tickets
      set
        status = case when status = 'pending' then 'open' else status end,
        updated_at = now()
      where id = ${ticketId}
      returning id, status, priority, first_response_at, resolved_at, updated_at
    `;

    await deps.logTelemetryEvent({
      actor: { type: "system", orgId: auth.organization.id },
      req,
      action: "support.tickets.reply",
      resourceType: "support_ticket",
      resourceId: ticketId,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { by_user: auth.user.email },
    });

    return Response.json({ message, ticket: updated }, { status: 201 });
  } catch (err) {
    return deps.routeError("support ticket reply failed", err);
  }
}
