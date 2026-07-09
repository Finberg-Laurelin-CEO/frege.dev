import { z } from "zod";
import { getSql } from "@/lib/db";
import { authenticateAdminRequest } from "@/lib/core/admin-auth";
import { generateApiKey } from "@/lib/core/keys";
import { assertActiveHumanOrg, assertVerifiedHumanUser } from "@/lib/core/org-guard";
import { assertSafeBrowserMutation, readJson, routeError } from "@/lib/core/request-guards";
import { logTelemetryEvent } from "@/lib/core/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createApiKeySchema = z.object({
  org_slug: z.string().min(1),
  role_slug: z.string().min(1),
  owner_user_id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(160),
  expires_at: z.string().datetime().optional(),
});

export async function GET(req: Request) {
  const startedAt = Date.now();
  try {
    const authResult = await authenticateAdminRequest(req);
    if (!authResult.ok) return authResult.response;
    const auth = authResult.auth;

    const sql = getSql();
    const apiKeys = await sql`
      select
        api_keys.id,
        api_keys.name,
        api_keys.key_prefix,
        api_keys.status,
        api_keys.created_at,
        api_keys.last_used_at,
        api_keys.expires_at,
        api_keys.owner_user_id,
        owner.email as owner_user_email,
        owner.name as owner_user_name,
        roles.id as role_id,
        roles.slug as role_slug,
        roles.name as role_name
      from api_keys
      join roles on roles.id = api_keys.role_id and roles.org_id = api_keys.org_id
      left join users owner on owner.id = api_keys.owner_user_id
      where api_keys.org_id = ${auth.organization.id}
      order by api_keys.created_at desc
      limit 100
    `;

    await logTelemetryEvent({
      actor: { type: "user", auth },
      req,
      action: "admin.api_keys.list",
      resourceType: "api_key",
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { result_count: apiKeys.length },
    });

    return Response.json({ api_keys: apiKeys }, { status: 200 });
  } catch (err) {
    return routeError("admin api key list failed", err);
  }
}

export async function POST(req: Request) {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  const startedAt = Date.now();
  try {
    const json = await readJson(req);
    if (!json.ok) return json.response;

    const parsed = createApiKeySchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const authResult = await authenticateAdminRequest(req, parsed.data.org_slug);
    if (!authResult.ok) return authResult.response;
    const auth = authResult.auth;
    const unverified = assertVerifiedHumanUser(auth);
    if (unverified) return unverified;
    const inactive = assertActiveHumanOrg(auth);
    if (inactive) return inactive;

    const sql = getSql();
    const ownerUserId = parsed.data.owner_user_id ?? auth.user.id;
    const [owner] = await sql`
      select users.id, users.email, users.name
      from organization_memberships
      join users on users.id = organization_memberships.user_id
      where organization_memberships.org_id = ${auth.organization.id}
        and organization_memberships.user_id = ${ownerUserId}
        and organization_memberships.status = 'active'
      limit 1
    `;
    if (!owner) return Response.json({ error: "owner_user_not_found" }, { status: 404 });

    const [role] = await sql`
      select id, slug, name
      from roles
      where org_id = ${auth.organization.id}
        and slug = ${parsed.data.role_slug}
      limit 1
    `;
    if (!role) return Response.json({ error: "role_not_found" }, { status: 404 });

    const generated = generateApiKey();
    const [apiKey] = await sql`
      insert into api_keys (org_id, role_id, owner_user_id, name, key_prefix, key_hash, expires_at)
      values (
        ${auth.organization.id},
        ${role.id},
        ${owner.id},
        ${parsed.data.name},
        ${generated.keyPrefix},
        ${generated.keyHash},
        ${parsed.data.expires_at ?? null}
      )
      returning id, name, key_prefix, status, created_at, last_used_at, expires_at
    `;

    await logTelemetryEvent({
      actor: { type: "user", auth },
      req,
      action: "admin.api_keys.create",
      resourceType: "api_key",
      resourceId: apiKey.id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: {
        key_prefix: apiKey.key_prefix,
        role_slug: role.slug,
        owner_user_id: owner.id,
        owner_user_email: owner.email,
        expires_at: apiKey.expires_at,
      },
    });

    return Response.json(
      {
        api_key: {
          ...apiKey,
          role: {
            id: role.id,
            slug: role.slug,
            name: role.name,
          },
          owner_user: {
            id: owner.id,
            email: owner.email,
            name: owner.name,
          },
        },
        raw_key: generated.rawKey,
      },
      { status: 201 },
    );
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "23505") return Response.json({ error: "conflict" }, { status: 409 });
    if ((err as Error)?.message === "FREGE_API_KEY_SALT is not set.") {
      return Response.json({ error: "api_key_salt_missing" }, { status: 500 });
    }
    return routeError("admin api key create failed", err);
  }
}
