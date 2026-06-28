import { z } from "zod";
import { getSql } from "@/lib/db";
import { generateFreeActivationCode, hashFreeActivationCode } from "@/lib/prototype/free-codes";
import { authenticatePlatformStaff } from "@/lib/prototype/platform-auth";
import { recordPlatformAudit } from "@/lib/prototype/platform-audit";
import { assertSafeBrowserMutation, readJson, routeError } from "@/lib/prototype/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  label: z.string().trim().max(160).optional(),
  plan: z.enum(["solo", "team"]).default("team"),
  billing_interval: z.enum(["monthly", "annual", "permanent"]).default("permanent"),
  seats: z.number().int().min(1).max(500).default(1),
  metadata: z.record(z.unknown()).default({}),
});

export async function GET(req: Request) {
  try {
    const staff = await authenticatePlatformStaff(req);
    if (!staff.ok) return staff.response;

    const sql = getSql();
    const codes = await sql`
      select
        c.id,
        c.label,
        c.status,
        c.plan,
        c.billing_interval,
        c.seats,
        c.metadata,
        c.created_by_email,
        c.created_at,
        c.revoked_by_email,
        c.revoked_at,
        c.redeemed_by_email,
        c.redeemed_at,
        c.redeemed_org_id,
        o.slug as redeemed_org_slug,
        o.name as redeemed_org_name
      from free_activation_codes c
      left join organizations o on o.id = c.redeemed_org_id
      order by c.created_at desc
      limit 200
    `;

    return Response.json({ free_codes: codes }, { status: 200 });
  } catch (err) {
    return routeError("platform free codes list failed", err);
  }
}

export async function POST(req: Request) {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  try {
    const staff = await authenticatePlatformStaff(req);
    if (!staff.ok) return staff.response;

    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = createSchema.safeParse(json.value);
    if (!parsed.success) return Response.json({ error: "validation" }, { status: 400 });

    const rawCode = generateFreeActivationCode();
    const codeHash = hashFreeActivationCode(rawCode);
    const sql = getSql();
    const [code] = await sql`
      insert into free_activation_codes (
        code_hash,
        label,
        plan,
        billing_interval,
        seats,
        metadata,
        created_by_user_id,
        created_by_email
      ) values (
        ${codeHash},
        ${parsed.data.label || null},
        ${parsed.data.plan},
        ${parsed.data.billing_interval},
        ${parsed.data.seats},
        ${JSON.stringify(parsed.data.metadata)}::jsonb,
        ${staff.auth.user.id},
        ${staff.auth.user.email}
      )
      returning
        id,
        label,
        status,
        plan,
        billing_interval,
        seats,
        metadata,
        created_by_email,
        created_at
    `;

    await recordPlatformAudit(staff.auth, {
      action: "free_code.create",
      targetType: "free_activation_code",
      targetId: code.id,
      metadata: {
        label: code.label,
        plan: code.plan,
        billing_interval: code.billing_interval,
        seats: code.seats,
      },
    });

    return Response.json({ free_code: code, raw_code: rawCode }, { status: 201 });
  } catch (err) {
    return routeError("platform free code create failed", err);
  }
}
