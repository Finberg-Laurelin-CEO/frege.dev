import { getSql } from "@/lib/db";
import { authenticateAdminRequest } from "@/lib/prototype/admin-auth";
import { routeError } from "@/lib/prototype/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const authResult = await authenticateAdminRequest(req);
    if (!authResult.ok) return authResult.response;
    const auth = authResult.auth;
    const sql = getSql();
    const [sources, pages, sessions, proposals] = await Promise.all([
      sql`
        select id, slug, name, kind, status, trust_zone, updated_at
        from brain_sources
        where org_id = ${auth.organization.id}
        order by updated_at desc, slug asc
        limit 50
      `,
      sql`
        select
          brain_pages.id,
          brain_pages.slug,
          brain_pages.title,
          brain_sources.slug as source_slug,
          brain_pages.status,
          brain_pages.trust_zone,
          brain_pages.updated_at,
          latest.revision_number,
          latest.summary
        from brain_pages
        join lateral (
          select revision_number, summary
          from brain_page_revisions
          where page_id = brain_pages.id
          order by revision_number desc
          limit 1
        ) latest on true
        left join brain_sources on brain_sources.id = brain_pages.source_id
        where brain_pages.org_id = ${auth.organization.id}
        order by brain_pages.updated_at desc, brain_pages.slug asc
        limit 50
      `,
      sql`
        select
          brain_sessions.id,
          brain_sessions.external_id,
          brain_sessions.client,
          brain_sessions.title,
          brain_sessions.goal,
          brain_sessions.status,
          brain_sessions.trust_zone,
          users.email as owner_user_email,
          api_keys.key_prefix as actor_key_prefix,
          brain_sessions.started_at,
          brain_sessions.last_event_at,
          (
            select count(*)::int
            from brain_session_events
            where brain_session_events.session_id = brain_sessions.id
          ) as event_count
        from brain_sessions
        left join users on users.id = brain_sessions.owner_user_id
        left join api_keys on api_keys.id = brain_sessions.actor_key_id
        where brain_sessions.org_id = ${auth.organization.id}
        order by coalesce(brain_sessions.last_event_at, brain_sessions.started_at) desc
        limit 50
      `,
      sql`
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
        order by created_at desc
        limit 50
      `,
    ]);

    return Response.json({ sources, pages, sessions, proposals }, { status: 200 });
  } catch (err) {
    return routeError("admin brain snapshot failed", err);
  }
}
