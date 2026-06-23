# Support Tickets — Requirements Note

Status: **Not built.** Captured here so the main agent can design and implement it.
Authored as part of the Stripe integration work; tickets were intentionally deferred
so the billing/portal work could ship first.

## Why we need it

The admin panel (`app/platform/PlatformConsole.tsx`) currently manages orgs, users,
signup approvals, and usage. There is **no** way for staff to handle customer support
inside the product. "Tickets" appears only as marketing copy on the landing page
(`app/page.tsx`) — there is no data model, API, or UI behind it.

We want a customer support surface so that:

- Customers (org owners/admins) can raise issues without leaving the product.
- Platform staff can triage, respond to, and resolve those issues from the admin panel.
- Support context (org, plan, billing owner, renewal date, non-standard terms) is
  attached to each ticket. `lib/prototype/demo-data.ts` already states the desired
  hand-off info: "capture the promised plan, billing owner, renewal date, and any
  non-standard terms" — tickets should surface this automatically from `org_billing`.

## Open product decisions (need answers before building)

1. **Origin of tickets** — pick one (or more):
   - In-app form (authenticated org user submits from a "Support" page).
   - Email ingestion (support@frege.dev → tickets).
   - External tool sync (Zendesk / Intercom / Linear / Plain) via their API.
2. **Who can see/reply** — platform staff only, or also org admins on their own tickets?
3. **SLA / status model** — e.g. open → pending → resolved → closed. Priorities?
4. **Notifications** — email on reply? in-app only?

## Suggested minimal in-app design (if we build natively)

DB migration (next number after `db/011_billing_and_platform.sql`):

```sql
create table if not exists support_tickets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete set null,
  created_by uuid references users(id) on delete set null,
  subject text not null,
  status text not null default 'open'
    check (status in ('open','pending','resolved','closed')),
  priority text not null default 'normal'
    check (priority in ('low','normal','high','urgent')),
  assigned_to uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  author_id uuid references users(id) on delete set null,
  author_kind text not null check (author_kind in ('customer','staff')),
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists support_tickets_status_idx on support_tickets (status, updated_at desc);
create index if not exists support_ticket_messages_ticket_idx on support_ticket_messages (ticket_id, created_at);
```

API routes (mirror existing conventions in `app/api/v1/platform/*`):

- `GET  /api/v1/platform/tickets` — staff: list/filter by status.
- `GET  /api/v1/platform/tickets/[id]` — staff: ticket + messages + org/billing context.
- `POST /api/v1/platform/tickets/[id]/messages` — staff: reply.
- `PATCH /api/v1/platform/tickets/[id]` — staff: status/priority/assignment.
- `POST /api/v1/support/tickets` — authenticated customer: create ticket.
- `POST /api/v1/support/tickets/[id]/messages` — customer: reply on own ticket.

UI:

- New `tickets` tab in `PlatformConsole.tsx` (list + detail/reply pane).
- Customer-facing `app/support/` page for creating/viewing own tickets.

Auth: reuse `authenticatePlatformStaff` (staff side) and `authenticateAdminRequest`
(customer side). Follow the `assertSafeBrowserMutation` + `readJson` + `routeError`
+ `logTelemetryEvent` patterns used by the billing routes.

## Billing/Stripe touchpoints already in place (reuse for ticket context)

- `org_billing` table: plan, billing_interval, seats, subscription_status, stripe_customer_id.
- Platform billing portal action: `POST /api/v1/platform/orgs/[id]/billing-portal`
  (staff opens a customer's Stripe portal) — link this from a ticket's org context.
