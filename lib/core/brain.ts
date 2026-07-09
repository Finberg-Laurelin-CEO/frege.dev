import { getSql } from "@/lib/db";
import type { FregeActorContext } from "@/lib/core/actor-auth";
import { parseBrainLinks, slugifyBrain } from "@/lib/core/brain-links";
import type { HumanOrgContext } from "@/lib/core/org-guard";
import type {
  BrainSessionEventType,
  MemoryProposalStatus,
  MemoryProposalType,
  TrustZone,
} from "@/lib/core/types";

const MAX_LEDGER_BODY_CHARS = 100_000;

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/frg_live_[a-f0-9]{12}_[A-Za-z0-9_-]+/g, "[redacted_frege_api_key]"],
  [/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]"],
  [/(authorization\s*[:=]\s*)([^\s]+)/gi, "$1[redacted]"],
  [/(api[_-]?key\s*[:=]\s*)([^\s]+)/gi, "$1[redacted]"],
  [/(password\s*[:=]\s*)([^\s]+)/gi, "$1[redacted]"],
  [/(provider[_-]?secret\s*[:=]\s*)([^\s]+)/gi, "$1[redacted]"],
  [/(secret\s*[:=]\s*)([^\s]+)/gi, "$1[redacted]"],
  [/(session[_-]?cookie\s*[:=]\s*)([^\s]+)/gi, "$1[redacted]"],
];

export type BrainSource = {
  id: string;
  slug: string;
  name: string;
  kind: string;
  status: string;
  trust_zone: TrustZone;
  metadata: Record<string, unknown>;
  created_at: Date | string;
  updated_at: Date | string;
};

export type BrainPageSearchResult = {
  id: string;
  slug: string;
  title: string;
  source_slug: string | null;
  status: string;
  trust_zone: TrustZone;
  tags: string[];
  summary: string;
  revision_id: string;
  revision_number: number;
  updated_at: Date | string;
  snippet: string;
};

export type BrainPage = BrainPageSearchResult & {
  body_md: string;
  frontmatter: Record<string, unknown>;
  links: Array<{
    id: string;
    target_slug: string;
    link_type: string;
    confidence: number;
    evidence: string;
  }>;
};

export type BrainSession = {
  id: string;
  org_id: string;
  owner_user_id: string | null;
  actor_key_id: string | null;
  external_id: string | null;
  client: string;
  title: string;
  goal: string;
  status: string;
  trust_zone: TrustZone;
  metadata: Record<string, unknown>;
  started_at: Date | string;
  last_event_at: Date | string | null;
  ended_at: Date | string | null;
};

export type BrainSessionEvent = {
  id: string;
  session_id: string;
  actor_type: "user" | "api_key" | "system";
  actor_user_id: string | null;
  actor_key_id: string | null;
  event_type: BrainSessionEventType;
  body_md: string;
  payload: Record<string, unknown>;
  trust_zone: TrustZone;
  source_ids: string[];
  request_id: string | null;
  created_at: Date | string;
};

export type MemoryProposal = {
  id: string;
  proposal_type: MemoryProposalType;
  slug: string | null;
  title: string;
  summary: string;
  trust_zone: TrustZone;
  status: MemoryProposalStatus;
  session_id: string | null;
  created_by_user_id: string | null;
  created_by_key_id: string | null;
  reviewer_user_id: string | null;
  resolved_at: Date | string | null;
  created_at: Date | string;
};

export type StartSessionInput = {
  external_id?: string;
  client?: string;
  title?: string;
  goal?: string;
  trust_zone?: TrustZone;
  metadata?: Record<string, unknown>;
};

export type AppendSessionEventInput = {
  session_id: string;
  event_type: BrainSessionEventType;
  body_md?: string;
  payload?: Record<string, unknown>;
  trust_zone?: TrustZone;
  source_ids?: string[];
  request_id?: string;
};

export type MemoryProposalInput = {
  proposal_type: MemoryProposalType;
  slug?: string;
  title?: string;
  body_md?: string;
  summary?: string;
  trust_zone?: TrustZone;
  source_ids?: string[];
  session_id?: string;
  evidence_event_ids?: string[];
  metadata?: Record<string, unknown>;
};

function actorUserId(actor: FregeActorContext): string | null {
  if (actor.actorType === "api_key") return actor.apiKeyAuth.key.owner_user_id;
  return actor.userAuth.user.id;
}

function actorKeyId(actor: FregeActorContext): string | null {
  return actor.actorType === "api_key" ? actor.apiKeyAuth.key.id : null;
}

function capability(actor: FregeActorContext, key: keyof FregeActorContext["capabilities"]): boolean {
  return Boolean(actor.capabilities[key]);
}

function trustZonesForActor(actor: FregeActorContext): TrustZone[] {
  return actor.allowedLabels.includes("restricted") ? ["green", "red"] : ["green"];
}

function canUseTrustZone(actor: FregeActorContext, trustZone: TrustZone): boolean {
  return trustZone === "green" || trustZonesForActor(actor).includes("red");
}

function assertCanUseTrustZone(actor: FregeActorContext, trustZone: TrustZone): void {
  if (!canUseTrustZone(actor, trustZone)) throw new Error("trust_zone_forbidden");
}

function assertCanReadSessions(actor: FregeActorContext): void {
  if (!capability(actor, "canReadSessions")) throw new Error("session_read_forbidden");
}

function assertCanWriteSessions(actor: FregeActorContext): void {
  if (!capability(actor, "canWriteSessions")) throw new Error("session_write_forbidden");
}

function assertCanProposeMemory(actor: FregeActorContext): void {
  if (!capability(actor, "canProposeMemory")) throw new Error("memory_proposal_forbidden");
}

export { slugifyBrain };

export function redactSecrets(value: string): string {
  let output = value.slice(0, MAX_LEDGER_BODY_CHARS);
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

export function redactSecretValue(value: unknown): unknown {
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redactSecretValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => {
        if (/password|authorization|cookie|secret|token|api[_-]?key/i.test(key)) {
          return [key, "[redacted]"];
        }
        return [key, redactSecretValue(item)];
      }),
    );
  }
  return value;
}

function makeSnippet(body: string, query: string): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (!query) return normalized.slice(0, 240);

  const index = normalized.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return normalized.slice(0, 240);

  const start = Math.max(0, index - 80);
  const end = Math.min(normalized.length, index + query.length + 160);
  return `${start > 0 ? "..." : ""}${normalized.slice(start, end)}${end < normalized.length ? "..." : ""}`;
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

async function refreshBrainPageLinks(input: {
  orgId: string;
  pageId: string;
  bodyMd: string;
  userId: string | null;
  keyId: string | null;
}): Promise<void> {
  const sql = getSql();
  const links = parseBrainLinks(input.bodyMd);
  await sql`
    delete from brain_links
    where org_id = ${input.orgId}
      and source_page_id = ${input.pageId}
  `;

  for (const link of links) {
    const [target] = await sql`
      select id
      from brain_pages
      where org_id = ${input.orgId}
        and slug = ${link.slug}
      limit 1
    `;

    await sql`
      insert into brain_links (
        org_id,
        source_page_id,
        target_page_id,
        target_slug,
        link_type,
        confidence,
        evidence,
        created_by_user_id,
        created_by_key_id
      ) values (
        ${input.orgId},
        ${input.pageId},
        ${(target as { id?: string } | undefined)?.id ?? null},
        ${link.slug},
        'references',
        1,
        ${link.evidence},
        ${input.userId},
        ${input.keyId}
      )
      on conflict (org_id, source_page_id, target_slug, link_type) do update set
        target_page_id = excluded.target_page_id,
        evidence = excluded.evidence,
        created_at = now()
    `;
  }
}

export async function brainStatus(actor: FregeActorContext) {
  const sql = getSql();
  const [row] = await sql`
    select
      (select count(*)::int from brain_sources where org_id = ${actor.organization.id} and status = 'active') as sources,
      (select count(*)::int from brain_pages where org_id = ${actor.organization.id} and status = 'published') as pages,
      (select count(*)::int from brain_sessions where org_id = ${actor.organization.id}) as sessions,
      (select count(*)::int from memory_proposals where org_id = ${actor.organization.id} and status = 'pending') as pending_proposals
  `;

  return {
    organization: actor.organization,
    actor_type: actor.actorType,
    key: actor.actorType === "api_key" ? actor.apiKeyAuth.key : null,
    allowed_trust_zones: trustZonesForActor(actor),
    capabilities: actor.capabilities,
    counts: row ?? { sources: 0, pages: 0, sessions: 0, pending_proposals: 0 },
  };
}

export async function listBrainSources(actor: FregeActorContext, limit = 50): Promise<BrainSource[]> {
  const sql = getSql();
  return (await sql`
    select id, slug, name, kind, status, trust_zone, metadata, created_at, updated_at
    from brain_sources
    where org_id = ${actor.organization.id}
      and status = 'active'
      and trust_zone = any(${trustZonesForActor(actor)}::text[])
    order by updated_at desc, slug asc
    limit ${limit}
  `) as BrainSource[];
}

export async function searchBrainPages(
  actor: FregeActorContext,
  input: { query?: string; limit: number },
): Promise<BrainPageSearchResult[]> {
  const sql = getSql();
  const query = input.query?.trim() ?? "";
  const pattern = `%${query}%`;
  const rows = (await sql`
    select
      brain_pages.id,
      brain_pages.slug,
      brain_pages.title,
      brain_sources.slug as source_slug,
      brain_pages.status,
      brain_pages.trust_zone,
      brain_pages.tags,
      brain_pages.updated_at,
      latest.id as revision_id,
      latest.revision_number,
      latest.summary,
      latest.body_md
    from brain_pages
    join lateral (
      select id, revision_number, summary, body_md
      from brain_page_revisions
      where page_id = brain_pages.id
      order by revision_number desc
      limit 1
    ) latest on true
    left join brain_sources on brain_sources.id = brain_pages.source_id
    where brain_pages.org_id = ${actor.organization.id}
      and brain_pages.status = 'published'
      and brain_pages.trust_zone = any(${trustZonesForActor(actor)}::text[])
      and (
        ${query ? pattern : null}::text is null
        or brain_pages.title ilike ${query ? pattern : null}
        or brain_pages.slug ilike ${query ? pattern : null}
        or latest.summary ilike ${query ? pattern : null}
        or latest.body_md ilike ${query ? pattern : null}
        or exists (
          select 1 from unnest(brain_pages.tags) as tag(value)
          where tag.value ilike ${query ? pattern : null}
        )
      )
    order by brain_pages.updated_at desc, brain_pages.slug asc
    limit ${input.limit}
  `) as Array<BrainPageSearchResult & { body_md: string }>;

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    source_slug: row.source_slug,
    status: row.status,
    trust_zone: row.trust_zone,
    tags: row.tags,
    summary: row.summary,
    revision_id: row.revision_id,
    revision_number: row.revision_number,
    updated_at: row.updated_at,
    snippet: makeSnippet(row.body_md, query),
  }));
}

export async function getBrainPage(actor: FregeActorContext, slug: string): Promise<BrainPage | null> {
  const sql = getSql();
  const rows = (await sql`
    select
      brain_pages.id,
      brain_pages.slug,
      brain_pages.title,
      brain_sources.slug as source_slug,
      brain_pages.status,
      brain_pages.trust_zone,
      brain_pages.tags,
      brain_pages.frontmatter,
      brain_pages.updated_at,
      latest.id as revision_id,
      latest.revision_number,
      latest.summary,
      latest.body_md
    from brain_pages
    join lateral (
      select id, revision_number, summary, body_md
      from brain_page_revisions
      where page_id = brain_pages.id
      order by revision_number desc
      limit 1
    ) latest on true
    left join brain_sources on brain_sources.id = brain_pages.source_id
    where brain_pages.org_id = ${actor.organization.id}
      and brain_pages.slug = ${slug}
      and brain_pages.status = 'published'
      and brain_pages.trust_zone = any(${trustZonesForActor(actor)}::text[])
    limit 1
  `) as Array<Omit<BrainPage, "links" | "snippet">>;

  const row = rows[0];
  if (!row) return null;

  const links = await sql`
    select id, target_slug, link_type, confidence, evidence
    from brain_links
    where org_id = ${actor.organization.id}
      and source_page_id = ${row.id}
    order by target_slug asc
  `;

  return {
    ...row,
    snippet: makeSnippet(row.body_md, ""),
    links: links as BrainPage["links"],
  };
}

export async function startBrainSession(actor: FregeActorContext, input: StartSessionInput): Promise<BrainSession> {
  assertCanWriteSessions(actor);
  const trustZone = input.trust_zone ?? "green";
  assertCanUseTrustZone(actor, trustZone);

  const sql = getSql();
  if (input.external_id) {
    const [existing] = await sql`
      select *
      from brain_sessions
      where org_id = ${actor.organization.id}
        and external_id = ${input.external_id}
      limit 1
    `;
    if (existing) return existing as BrainSession;
  }

  const [session] = await sql`
    insert into brain_sessions (
      org_id,
      owner_user_id,
      actor_key_id,
      external_id,
      client,
      title,
      goal,
      trust_zone,
      metadata
    ) values (
      ${actor.organization.id},
      ${actorUserId(actor)},
      ${actorKeyId(actor)},
      ${input.external_id ?? null},
      ${input.client ?? "unknown"},
      ${input.title?.trim() || "Agent session"},
      ${input.goal?.trim() ?? ""},
      ${trustZone},
      ${JSON.stringify(redactSecretValue(input.metadata ?? {}))}::jsonb
    )
    returning *
  `;

  return session as BrainSession;
}

export async function appendSessionEvent(
  actor: FregeActorContext,
  input: AppendSessionEventInput,
): Promise<BrainSessionEvent> {
  assertCanWriteSessions(actor);
  const trustZone = input.trust_zone ?? "green";
  assertCanUseTrustZone(actor, trustZone);

  const sql = getSql();
  const [session] = await sql`
    select id, trust_zone
    from brain_sessions
    where id = ${input.session_id}
      and org_id = ${actor.organization.id}
    limit 1
  `;
  if (!session) throw new Error("session_not_found");

  const [event] = await sql`
    insert into brain_session_events (
      org_id,
      session_id,
      actor_type,
      actor_user_id,
      actor_key_id,
      event_type,
      body_md,
      payload,
      trust_zone,
      source_ids,
      request_id
    ) values (
      ${actor.organization.id},
      ${input.session_id},
      ${actor.actorType},
      ${actorUserId(actor)},
      ${actorKeyId(actor)},
      ${input.event_type},
      ${redactSecrets(input.body_md ?? "")},
      ${JSON.stringify(redactSecretValue(input.payload ?? {}))}::jsonb,
      ${trustZone},
      ${input.source_ids ?? []}::uuid[],
      ${input.request_id ?? null}
    )
    returning *
  `;

  await sql`
    update brain_sessions
    set
      last_event_at = now(),
      trust_zone = case when ${trustZone} = 'red' then 'red' else trust_zone end
    where id = ${input.session_id}
      and org_id = ${actor.organization.id}
  `;

  return event as BrainSessionEvent;
}

export async function getBrainSession(
  actor: FregeActorContext,
  sessionId: string,
): Promise<{ session: BrainSession; events: BrainSessionEvent[]; denied_count: number } | null> {
  assertCanReadSessions(actor);
  const sql = getSql();
  const [session] = await sql`
    select *
    from brain_sessions
    where id = ${sessionId}
      and org_id = ${actor.organization.id}
    limit 1
  `;
  if (!session) return null;
  const typedSession = session as BrainSession;
  if (!canUseTrustZone(actor, typedSession.trust_zone)) return null;

  const events = (await sql`
    select *
    from brain_session_events
    where session_id = ${sessionId}
      and org_id = ${actor.organization.id}
      and trust_zone = any(${trustZonesForActor(actor)}::text[])
    order by created_at asc
  `) as BrainSessionEvent[];
  const [denied] = await sql`
    select count(*)::int as count
    from brain_session_events
    where session_id = ${sessionId}
      and org_id = ${actor.organization.id}
      and not (trust_zone = any(${trustZonesForActor(actor)}::text[]))
  `;

  return {
    session: typedSession,
    events,
    denied_count: Number((denied as { count?: number } | undefined)?.count ?? 0),
  };
}

export async function searchBrainSessions(
  actor: FregeActorContext,
  input: { query?: string; limit: number },
): Promise<Array<BrainSession & { event_count: number; snippet: string }>> {
  assertCanReadSessions(actor);
  const sql = getSql();
  const query = input.query?.trim() ?? "";
  const pattern = `%${query}%`;
  const rows = (await sql`
    select
      brain_sessions.*,
      count(brain_session_events.id)::int as event_count,
      coalesce(max(brain_session_events.body_md), '') as event_body
    from brain_sessions
    left join brain_session_events
      on brain_session_events.session_id = brain_sessions.id
      and brain_session_events.trust_zone = any(${trustZonesForActor(actor)}::text[])
    where brain_sessions.org_id = ${actor.organization.id}
      and brain_sessions.trust_zone = any(${trustZonesForActor(actor)}::text[])
      and (
        ${query ? pattern : null}::text is null
        or brain_sessions.title ilike ${query ? pattern : null}
        or brain_sessions.goal ilike ${query ? pattern : null}
        or exists (
          select 1
          from brain_session_events events
          where events.session_id = brain_sessions.id
            and events.trust_zone = any(${trustZonesForActor(actor)}::text[])
            and events.body_md ilike ${query ? pattern : null}
        )
      )
    group by brain_sessions.id
    order by coalesce(brain_sessions.last_event_at, brain_sessions.started_at) desc
    limit ${input.limit}
  `) as Array<BrainSession & { event_count: number; event_body: string }>;

  return rows.map((row) => ({
    ...row,
    snippet: makeSnippet(row.event_body || row.goal || row.title, query),
  }));
}

export async function createMemoryProposal(
  actor: FregeActorContext,
  input: MemoryProposalInput,
): Promise<MemoryProposal> {
  assertCanProposeMemory(actor);
  const trustZone = input.trust_zone ?? "green";
  assertCanUseTrustZone(actor, trustZone);

  const sql = getSql();
  let targetPageId: string | null = null;
  let slug = input.slug ? slugifyBrain(input.slug) : null;
  const bodyMd = redactSecrets(input.body_md ?? "");
  const title = input.title?.trim() || slug || "Untitled memory";

  if (input.proposal_type === "page_update") {
    if (!slug) throw new Error("proposal_slug_required");
    const [page] = await sql`
      select id, trust_zone
      from brain_pages
      where org_id = ${actor.organization.id}
        and slug = ${slug}
      limit 1
    `;
    if (!page) throw new Error("brain_page_not_found");
    targetPageId = (page as { id: string }).id;
    assertCanUseTrustZone(actor, (page as { trust_zone: TrustZone }).trust_zone);
  }

  if (input.proposal_type === "page_create" && !slug) {
    slug = slugifyBrain(title);
  }

  const [proposal] = await sql`
    insert into memory_proposals (
      org_id,
      proposal_type,
      target_page_id,
      slug,
      title,
      body_md,
      summary,
      trust_zone,
      source_ids,
      session_id,
      evidence_event_ids,
      created_by_user_id,
      created_by_key_id,
      metadata
    ) values (
      ${actor.organization.id},
      ${input.proposal_type},
      ${targetPageId},
      ${slug},
      ${title},
      ${bodyMd},
      ${redactSecrets(input.summary ?? "")},
      ${trustZone},
      ${input.source_ids ?? []}::uuid[],
      ${input.session_id ?? null},
      ${input.evidence_event_ids ?? []}::uuid[],
      ${actorUserId(actor)},
      ${actorKeyId(actor)},
      ${JSON.stringify(redactSecretValue(input.metadata ?? {}))}::jsonb
    )
    returning
      id,
      proposal_type,
      slug,
      title,
      summary,
      trust_zone,
      status,
      session_id,
      created_by_user_id,
      created_by_key_id,
      reviewer_user_id,
      resolved_at,
      created_at
  `;

  if (input.session_id) {
    await appendSessionEvent(actor, {
      session_id: input.session_id,
      event_type: "memory_signal",
      body_md: `Memory proposal created: ${proposal.id}`,
      payload: {
        proposal_id: proposal.id,
        proposal_type: proposal.proposal_type,
        slug: proposal.slug,
      },
      trust_zone: trustZone,
      source_ids: input.source_ids,
    });
  }

  return proposal as MemoryProposal;
}

export async function listMemoryProposalsForAdmin(
  auth: HumanOrgContext,
  input: { status?: MemoryProposalStatus; limit: number },
): Promise<MemoryProposal[]> {
  const sql = getSql();
  return (await sql`
    select
      id,
      proposal_type,
      slug,
      title,
      summary,
      trust_zone,
      status,
      session_id,
      created_by_user_id,
      created_by_key_id,
      reviewer_user_id,
      resolved_at,
      created_at
    from memory_proposals
    where org_id = ${auth.organization.id}
      and (${input.status ?? null}::text is null or status = ${input.status ?? null})
    order by created_at desc
    limit ${input.limit}
  `) as MemoryProposal[];
}

async function acceptSourceProposal(auth: HumanOrgContext, proposal: { id: string; slug: string | null; title: string; trust_zone: TrustZone; metadata: Record<string, unknown> }) {
  if (!proposal.slug) throw new Error("proposal_slug_required");
  const sql = getSql();
  const [source] = await sql`
    insert into brain_sources (
      org_id,
      slug,
      name,
      kind,
      trust_zone,
      metadata,
      created_by_user_id,
      approved_by_user_id
    ) values (
      ${auth.organization.id},
      ${proposal.slug},
      ${proposal.title || proposal.slug},
      'markdown',
      ${proposal.trust_zone},
      ${JSON.stringify(proposal.metadata ?? {})}::jsonb,
      ${auth.user.id},
      ${auth.user.id}
    )
    on conflict (org_id, slug) do update set
      name = excluded.name,
      trust_zone = excluded.trust_zone,
      metadata = excluded.metadata,
      status = 'active',
      approved_by_user_id = excluded.approved_by_user_id,
      updated_at = now()
    returning id, slug, name
  `;
  return source;
}

async function acceptPageProposal(
  auth: HumanOrgContext,
  proposal: {
    id: string;
    proposal_type: MemoryProposalType;
    target_page_id: string | null;
    slug: string | null;
    title: string;
    body_md: string;
    summary: string;
    trust_zone: TrustZone;
    source_ids: string[];
    metadata: Record<string, unknown>;
  },
) {
  if (!proposal.slug && proposal.proposal_type === "page_create") throw new Error("proposal_slug_required");
  const sql = getSql();
  const sourceId = proposal.source_ids[0] ?? null;
  let pageId = proposal.target_page_id;

  if (!pageId) {
    const [page] = await sql`
      insert into brain_pages (
        org_id,
        source_id,
        slug,
        title,
        trust_zone,
        tags,
        frontmatter,
        created_by_user_id
      ) values (
        ${auth.organization.id},
        ${sourceId},
        ${proposal.slug},
        ${proposal.title || proposal.slug},
        ${proposal.trust_zone},
        ${Array.isArray(proposal.metadata?.tags) ? proposal.metadata.tags : []}::text[],
        ${JSON.stringify(proposal.metadata ?? {})}::jsonb,
        ${auth.user.id}
      )
      on conflict (org_id, slug) do update set
        title = excluded.title,
        trust_zone = excluded.trust_zone,
        frontmatter = excluded.frontmatter,
        updated_at = now()
      returning id
    `;
    pageId = (page as { id: string }).id;
  } else {
    await sql`
      update brain_pages
      set
        title = coalesce(nullif(${proposal.title}, ''), title),
        trust_zone = ${proposal.trust_zone},
        frontmatter = ${JSON.stringify(proposal.metadata ?? {})}::jsonb,
        status = 'published',
        updated_at = now()
      where id = ${pageId}
        and org_id = ${auth.organization.id}
    `;
  }

  const [revision] = await sql`
    insert into brain_page_revisions (
      org_id,
      page_id,
      revision_number,
      body_md,
      summary,
      proposal_id,
      created_by_user_id
    ) values (
      ${auth.organization.id},
      ${pageId},
      coalesce((
        select max(revision_number) + 1
        from brain_page_revisions
        where page_id = ${pageId}
      ), 1),
      ${proposal.body_md},
      ${proposal.summary},
      ${proposal.id},
      ${auth.user.id}
    )
    returning id, revision_number
  `;

  await refreshBrainPageLinks({
    orgId: auth.organization.id,
    pageId: pageId!,
    bodyMd: proposal.body_md,
    userId: auth.user.id,
    keyId: null,
  });

  return { page_id: pageId, revision };
}

async function acceptLinkProposal(
  auth: HumanOrgContext,
  proposal: { slug: string | null; body_md: string },
) {
  if (!proposal.slug) throw new Error("proposal_slug_required");
  const sql = getSql();
  const [page] = await sql`
    select id
    from brain_pages
    where org_id = ${auth.organization.id}
      and slug = ${proposal.slug}
    limit 1
  `;
  if (!page) throw new Error("brain_page_not_found");
  const pageId = (page as { id: string }).id;

  await refreshBrainPageLinks({
    orgId: auth.organization.id,
    pageId,
    bodyMd: proposal.body_md,
    userId: auth.user.id,
    keyId: null,
  });

  return { page_id: pageId };
}

export async function resolveMemoryProposal(
  auth: HumanOrgContext,
  input: { proposalId: string; action: "accept" | "reject" },
) {
  if (!auth.capabilities.canReviewMemoryProposals) throw new Error("memory_review_forbidden");
  const sql = getSql();
  const [proposal] = await sql`
    select *
    from memory_proposals
    where id = ${input.proposalId}
      and org_id = ${auth.organization.id}
    limit 1
  `;
  if (!proposal) throw new Error("memory_proposal_not_found");
  if ((proposal as { status: string }).status !== "pending") throw new Error("memory_proposal_resolved");

  let acceptedResource: unknown = null;
  if (input.action === "accept") {
    const typed = proposal as {
      id: string;
      proposal_type: MemoryProposalType;
      target_page_id: string | null;
      slug: string | null;
      title: string;
      body_md: string;
      summary: string;
      trust_zone: TrustZone;
      source_ids: string[];
      metadata: Record<string, unknown>;
    };
    if (typed.proposal_type === "source_create") {
      acceptedResource = await acceptSourceProposal(auth, typed);
    } else if (typed.proposal_type === "page_create" || typed.proposal_type === "page_update") {
      acceptedResource = await acceptPageProposal(auth, typed);
    } else if (typed.proposal_type === "link_update") {
      acceptedResource = await acceptLinkProposal(auth, typed);
    }
  }

  const [resolved] = await sql`
    update memory_proposals
    set
      status = ${input.action === "accept" ? "accepted" : "rejected"},
      reviewer_user_id = ${auth.user.id},
      resolved_at = now()
    where id = ${input.proposalId}
      and org_id = ${auth.organization.id}
    returning
      id,
      proposal_type,
      slug,
      title,
      summary,
      trust_zone,
      status,
      session_id,
      created_by_user_id,
      created_by_key_id,
      reviewer_user_id,
      resolved_at,
      created_at
  `;

  return { proposal: resolved as MemoryProposal, accepted_resource: acceptedResource };
}

export { actorKeyId as brainActorKeyId, actorUserId as brainActorUserId, estimateTokens as estimateBrainTokens };
