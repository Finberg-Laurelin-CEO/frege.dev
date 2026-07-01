import type Stripe from "stripe";
import type { getSql as getDefaultSql } from "@/lib/db";

type Sql = ReturnType<typeof getDefaultSql>;

export type BillingWebhookDeps = {
  getSql: () => Sql;
  constructEvent: (rawBody: string, signature: string, webhookSecret: string) => Stripe.Event;
  retrieveSubscription: (subscriptionId: string) => Promise<Stripe.Subscription>;
  listCheckoutSessionsBySubscription?: (subscriptionId: string) => Promise<Stripe.Checkout.Session[]>;
  now: () => Date;
};

export type BillingWebhookInput = {
  rawBody: string;
  signature: string;
  webhookSecret: string;
};

type WebhookDispatchResult = {
  skipped?: boolean;
  reason?: string;
};

type SubscriptionWrite = {
  customerId?: string | null;
  subscriptionId?: string | null;
  status?: string | null;
  currentPeriodEnd?: number | null;
  seats?: number | null;
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isoNow(deps: BillingWebhookDeps): string {
  return deps.now().toISOString();
}

function eventCreated(event: Stripe.Event): number {
  return Number(event.created ?? 0);
}

function subscriptionPeriodEnd(sub: Stripe.Subscription): number | null {
  return (
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    (sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined)?.current_period_end ??
    null
  );
}

function subscriptionSeats(sub: Stripe.Subscription): number | null {
  return sub.items?.data?.[0]?.quantity ?? null;
}

async function beginWebhookEvent(sql: Sql, deps: BillingWebhookDeps, event: Stripe.Event): Promise<"process" | "deduped" | "busy"> {
  const inserted = await sql`
    insert into stripe_webhook_events (event_id, type, event_created, status, received_at)
    values (${event.id}, ${event.type}, ${eventCreated(event)}, 'processing', ${isoNow(deps)})
    on conflict (event_id) do nothing
    returning event_id
  `;

  if (inserted.length > 0) return "process";

  const [existing] = await sql`
    select status
    from stripe_webhook_events
    where event_id = ${event.id}
  `;
  const status = existing?.status ? String(existing.status) : null;

  if (status === "processed") return "deduped";
  if (status === "failed") {
    await sql`
      update stripe_webhook_events
      set status = 'processing',
          received_at = ${isoNow(deps)},
          processed_at = null,
          error = null
      where event_id = ${event.id}
    `;
    return "process";
  }

  return "busy";
}

async function markWebhookProcessed(sql: Sql, deps: BillingWebhookDeps, eventId: string) {
  await sql`
    update stripe_webhook_events
    set status = 'processed',
        processed_at = ${isoNow(deps)},
        error = null
    where event_id = ${eventId}
  `;
}

async function markWebhookFailed(sql: Sql, deps: BillingWebhookDeps, eventId: string, err: unknown) {
  await sql`
    update stripe_webhook_events
    set status = 'failed',
        processed_at = null,
        error = ${errorMessage(err)}
    where event_id = ${eventId}
  `;
}

async function subscriptionEventIsOlder(sql: Sql, subscriptionId: string | null, created: number): Promise<boolean> {
  if (!subscriptionId) return false;

  const [billing] = await sql`
    select last_event_created
    from org_billing
    where stripe_subscription_id = ${subscriptionId}
    order by updated_at desc
    limit 1
  `;
  const lastEventCreated = billing?.last_event_created;
  if (lastEventCreated === null || lastEventCreated === undefined) return false;

  return created < Number(lastEventCreated);
}

async function activateOrg(sql: Sql, orgId: string, sub: SubscriptionWrite, created: number) {
  const subscriptionId = sub.subscriptionId ?? null;

  await sql.transaction([
    sql`
      insert into org_billing (
        org_id,
        stripe_customer_id,
        stripe_subscription_id,
        subscription_status,
        current_period_end,
        seats,
        last_event_created,
        updated_at
      )
      values (
        ${orgId},
        ${sub.customerId ?? null},
        ${subscriptionId},
        ${sub.status ?? null},
        ${sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd * 1000).toISOString() : null},
        ${sub.seats ?? 1},
        ${created},
        now()
      )
      on conflict (org_id) do update set
        stripe_customer_id = coalesce(excluded.stripe_customer_id, org_billing.stripe_customer_id),
        stripe_subscription_id = coalesce(excluded.stripe_subscription_id, org_billing.stripe_subscription_id),
        subscription_status = excluded.subscription_status,
        current_period_end = coalesce(excluded.current_period_end, org_billing.current_period_end),
        seats = coalesce(${sub.seats ?? null}, org_billing.seats),
        last_event_created = excluded.last_event_created,
        updated_at = now()
      where org_billing.last_event_created is null
         or org_billing.last_event_created <= excluded.last_event_created
      returning org_id
    `,
    sql`
      update organizations
      set status = 'active', activated_at = coalesce(activated_at, now())
      where id = ${orgId}
        and exists (
          select 1
          from org_billing
          where org_id = ${orgId}
            and last_event_created = ${created}
            and (${subscriptionId}::text is null or stripe_subscription_id = ${subscriptionId})
        )
    `,
    sql`
      update signups s
      set paid_at = coalesce(s.paid_at, now())
      from organization_invites i
      where s.invite_id = i.id
        and i.org_id = ${orgId}
        and s.paid_at is null
        and exists (
          select 1
          from org_billing
          where org_id = ${orgId}
            and last_event_created = ${created}
            and (${subscriptionId}::text is null or stripe_subscription_id = ${subscriptionId})
        )
    `,
  ]);
}

async function suspendOrgBySubscription(sql: Sql, subscriptionId: string, status: string, created: number) {
  await sql.transaction([
    sql`
      update org_billing
      set subscription_status = ${status},
          last_event_created = ${created},
          updated_at = now()
      where stripe_subscription_id = ${subscriptionId}
        and (last_event_created is null or last_event_created <= ${created})
      returning org_id
    `,
    sql`
      update organizations
      set status = 'suspended', suspended_at = now()
      where id in (
        select org_id
        from org_billing
        where stripe_subscription_id = ${subscriptionId}
          and last_event_created = ${created}
      )
    `,
  ]);
}

async function orgIdForSubscription(deps: BillingWebhookDeps, sql: Sql, sub: Stripe.Subscription): Promise<string | null> {
  const metadataOrgId = sub.metadata?.org_id;
  if (metadataOrgId) return metadataOrgId;

  if (deps.listCheckoutSessionsBySubscription) {
    const sessions = await deps.listCheckoutSessionsBySubscription(sub.id);
    const session = sessions[0];
    if (session?.metadata?.org_id) return session.metadata.org_id;
    if (session?.client_reference_id) return session.client_reference_id;
  }

  const [billing] = await sql`
    select org_id
    from org_billing
    where stripe_subscription_id = ${sub.id}
       or stripe_customer_id = ${typeof sub.customer === "string" ? sub.customer : null}
    order by updated_at desc
    limit 1
  `;
  return billing?.org_id ? String(billing.org_id) : null;
}

async function activateOrgFromSubscription(sql: Sql, orgId: string, sub: Stripe.Subscription, created: number) {
  await activateOrg(
    sql,
    orgId,
    {
      customerId: typeof sub.customer === "string" ? sub.customer : null,
      subscriptionId: sub.id,
      status: sub.status,
      currentPeriodEnd: subscriptionPeriodEnd(sub),
      seats: subscriptionSeats(sub),
    },
    created,
  );
}

async function dispatchWebhookEvent(deps: BillingWebhookDeps, sql: Sql, event: Stripe.Event): Promise<WebhookDispatchResult> {
  const created = eventCreated(event);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const orgId = session.metadata?.org_id ?? session.client_reference_id ?? null;
    if (!orgId) return {};

    const subscription =
      typeof session.subscription === "string" ? await deps.retrieveSubscription(session.subscription) : null;
    const subscriptionId = subscription?.id ?? (typeof session.subscription === "string" ? session.subscription : null);
    if (await subscriptionEventIsOlder(sql, subscriptionId, created)) {
      return { skipped: true, reason: "older_event" };
    }

    await activateOrg(
      sql,
      orgId,
      {
        customerId:
          (subscription && typeof subscription.customer === "string" ? subscription.customer : null) ??
          (typeof session.customer === "string" ? session.customer : null),
        subscriptionId,
        status: subscription?.status ?? "active",
        currentPeriodEnd: subscription ? subscriptionPeriodEnd(subscription) : null,
        seats: subscription ? subscriptionSeats(subscription) : null,
      },
      created,
    );
  } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.created") {
    const sub = event.data.object as Stripe.Subscription;
    if (await subscriptionEventIsOlder(sql, sub.id, created)) {
      return { skipped: true, reason: "older_event" };
    }

    const orgId = await orgIdForSubscription(deps, sql, sub);
    const active = sub.status === "active" || sub.status === "trialing";
    if (orgId && active) {
      await activateOrgFromSubscription(sql, orgId, sub, created);
    } else if (!active) {
      await suspendOrgBySubscription(sql, sub.id, sub.status, created);
    }
  } else if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    if (await subscriptionEventIsOlder(sql, sub.id, created)) {
      return { skipped: true, reason: "older_event" };
    }
    await suspendOrgBySubscription(sql, sub.id, "canceled", created);
  }

  return {};
}

export async function handleBillingWebhook(input: BillingWebhookInput, deps: BillingWebhookDeps): Promise<Response> {
  let event: Stripe.Event;
  try {
    event = deps.constructEvent(input.rawBody, input.signature, input.webhookSecret);
  } catch {
    return Response.json({ error: "invalid_signature" }, { status: 400 });
  }

  const sql = deps.getSql();
  const eventState = await beginWebhookEvent(sql, deps, event);
  if (eventState === "deduped") {
    return Response.json({ received: true, deduped: true }, { status: 200 });
  }
  if (eventState === "busy") {
    return Response.json({ error: "event_in_progress" }, { status: 500 });
  }

  try {
    const result = await dispatchWebhookEvent(deps, sql, event);
    await markWebhookProcessed(sql, deps, event.id);
    return Response.json({ received: true, ...result }, { status: 200 });
  } catch (err) {
    await markWebhookFailed(sql, deps, event.id, err).catch(() => undefined);
    console.error("stripe webhook handler failed", { type: event.type, message: errorMessage(err) });
    return Response.json({ error: "handler_failed" }, { status: 500 });
  }
}
