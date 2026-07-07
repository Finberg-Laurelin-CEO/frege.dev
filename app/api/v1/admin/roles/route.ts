import { z } from "zod";
import { getSql } from "@/lib/db";
import { authenticateAdminRequest } from "@/lib/prototype/admin-auth";
import { assertActiveHumanOrg } from "@/lib/prototype/org-guard";
import { assertSafeBrowserMutation, readJson, routeError } from "@/lib/prototype/request-guards";
import { logTelemetryEvent } from "@/lib/prototype/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const roleSchema = z.object({
  org_slug: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/),
  name: z.string().trim().min(1).max(120),
  can_read_labels: z.array(z.enum(["public", "internal", "restricted"])).min(1),
  can_create_docs: z.boolean().default(false),
  can_update_docs: z.boolean().default(false),
  can_read_audit: z.boolean().default(false),
  can_read_sessions: z.boolean().default(false),
  can_write_sessions: z.boolean().default(true),
  can_propose_memory: z.boolean().default(false),
  can_review_memory_proposals: z.boolean().default(false),
  can_manage_sources: z.boolean().default(false),
  can_execute_agents: z.boolean().default(false),
});

export async function GET(req: Request) {
  try {
    const authResult = await authenticateAdminRequest(req);
    if (!authResult.ok) return authResult.response;
    const auth = authResult.auth;
    const sql = getSql();
    const roles = await sql`
      select
        id,
        slug,
        name,
        can_read_labels,
        can_create_docs,
        can_update_docs,
        can_read_audit,
        can_read_sessions,
        can_write_sessions,
        can_propose_memory,
        can_review_memory_proposals,
        can_manage_sources,
        can_execute_agents,
        created_at
      from roles
      where org_id = ${auth.organization.id}
      order by slug asc
    `;

    return Response.json({ roles }, { status: 200 });
  } catch (err) {
    return routeError("admin roles list failed", err);
  }
}

export async function POST(req: Request) {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  const startedAt = Date.now();
  try {
    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = roleSchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const authResult = await authenticateAdminRequest(req, parsed.data.org_slug);
    if (!authResult.ok) return authResult.response;
    const auth = authResult.auth;
    const inactive = assertActiveHumanOrg(auth);
    if (inactive) return inactive;

    const sql = getSql();
    const [role] = await sql`
      insert into roles (
        org_id, slug, name, can_read_labels,
        can_create_docs, can_update_docs, can_read_audit,
        can_read_sessions, can_write_sessions, can_propose_memory,
        can_review_memory_proposals, can_manage_sources, can_execute_agents
      ) values (
        ${auth.organization.id},
        ${parsed.data.slug},
        ${parsed.data.name},
        ${parsed.data.can_read_labels},
        ${parsed.data.can_create_docs},
        ${parsed.data.can_update_docs},
        ${parsed.data.can_read_audit},
        ${parsed.data.can_read_sessions},
        ${parsed.data.can_write_sessions},
        ${parsed.data.can_propose_memory},
        ${parsed.data.can_review_memory_proposals},
        ${parsed.data.can_manage_sources},
        ${parsed.data.can_execute_agents}
      )
      on conflict (org_id, slug) do update set
        name = excluded.name,
        can_read_labels = excluded.can_read_labels,
        can_create_docs = excluded.can_create_docs,
        can_update_docs = excluded.can_update_docs,
        can_read_audit = excluded.can_read_audit,
        can_read_sessions = excluded.can_read_sessions,
        can_write_sessions = excluded.can_write_sessions,
        can_propose_memory = excluded.can_propose_memory,
        can_review_memory_proposals = excluded.can_review_memory_proposals,
        can_manage_sources = excluded.can_manage_sources,
        can_execute_agents = excluded.can_execute_agents
      returning
        id,
        slug,
        name,
        can_read_labels,
        can_create_docs,
        can_update_docs,
        can_read_audit,
        can_read_sessions,
        can_write_sessions,
        can_propose_memory,
        can_review_memory_proposals,
        can_manage_sources,
        can_execute_agents
    `;

    await logTelemetryEvent({
      actor: { type: "user", auth },
      req,
      action: "admin.roles.upsert",
      resourceType: "role",
      resourceId: role.id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { role_slug: role.slug },
    });

    return Response.json({ role }, { status: 200 });
  } catch (err) {
    return routeError("admin role upsert failed", err);
  }
}
