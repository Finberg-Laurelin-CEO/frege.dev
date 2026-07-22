import { z } from "zod";
import { authenticateAdminRequest } from "@/lib/core/admin-auth";
import { assertActiveHumanOrg } from "@/lib/core/org-guard";
import { assertSafeBrowserMutation, readJson, routeError } from "@/lib/core/request-guards";
import { SKILLS_COMPILER_ENABLED } from "@/lib/core/skills";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const date = z.string().trim().min(1).refine((value) => !Number.isNaN(Date.parse(value)), "invalid_date");
const materialSchema = z.object({
  source_type: z.literal("markdown_upload"),
  content_md: z.string().trim().min(1).max(1_000_000),
  provenance: z.object({
    source_description: z.string().trim().min(1).max(500),
    author: z.string().trim().min(1).max(200),
    date,
  }),
  occurred_at: z.string().datetime({ offset: true }).optional(),
});

export async function POST(req: Request) {
  if (!SKILLS_COMPILER_ENABLED()) return Response.json({ error: "not_found" }, { status: 404 });
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  try {
    const authResult = await authenticateAdminRequest(req);
    if (!authResult.ok) return authResult.response;
    const inactive = assertActiveHumanOrg(authResult.auth);
    if (inactive) return inactive;
    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = materialSchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const sql = getSql();
    const [material] = await sql`
      insert into raw_materials (
        org_id,
        source_type,
        content_md,
        provenance,
        occurred_at,
        created_by
      ) values (
        ${authResult.auth.organization.id},
        ${parsed.data.source_type},
        ${parsed.data.content_md},
        ${JSON.stringify(parsed.data.provenance)}::jsonb,
        ${parsed.data.occurred_at ?? null},
        ${authResult.auth.user.id}
      )
      returning id, source_type, created_at
    `;

    return Response.json({ material }, { status: 201 });
  } catch (err) {
    return routeError("material upload failed", err);
  }
}
