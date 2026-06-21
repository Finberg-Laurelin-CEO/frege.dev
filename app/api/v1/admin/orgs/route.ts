import { z } from "zod";
import { getSql } from "@/lib/db";
import { ensureDefaultAgentRoles, slugifyOrg } from "@/lib/prototype/org-guard";
import { assertSafeOrigin, readJson, routeError } from "@/lib/prototype/request-guards";
import { authenticateUserRequest, userUnauthorized } from "@/lib/prototype/session";
import { logTelemetryEvent } from "@/lib/prototype/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createOrgSchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().min(1).max(80).optional(),
});

export async function GET(req: Request) {
  const session = await authenticateUserRequest(req);
  if (!session) return userUnauthorized();
  return Response.json({ organizations: session.memberships }, { status: 200 });
}

export async function POST(req: Request) {
  const originError = assertSafeOrigin(req);
  if (originError) return originError;

  const startedAt = Date.now();
  try {
    const session = await authenticateUserRequest(req);
    if (!session) return userUnauthorized();

    const json = await readJson(req);
    if (!json.ok) return json.response;

    const parsed = createOrgSchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const sql = getSql();
    const slug = slugifyOrg(parsed.data.slug ?? parsed.data.name);
    const [org] = await sql`
      insert into organizations (slug, name)
      values (${slug}, ${parsed.data.name})
      returning id, slug, name
    `;
    await sql`
      insert into organization_memberships (org_id, user_id, role)
      values (${org.id}, ${session.user.id}, 'owner')
    `;
    await ensureDefaultAgentRoles(org.id);

    await logTelemetryEvent({
      actor: { type: "system", orgId: org.id },
      req,
      action: "admin.orgs.create",
      resourceType: "organization",
      resourceId: org.id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { org_slug: org.slug },
    });

    return Response.json({ organization: org }, { status: 201 });
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "23505") return Response.json({ error: "conflict" }, { status: 409 });
    return routeError("admin org create failed", err);
  }
}
