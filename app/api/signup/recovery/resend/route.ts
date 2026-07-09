import { z } from "zod";
import { getSql } from "@/lib/db";
import { reissueInviteAndSendEmail } from "@/lib/core/invites";
import { normalizeEmail } from "@/lib/core/org-guard";
import { checkRateLimit, rateLimitedResponse } from "@/lib/core/rate-limit";
import { assertSafeOrigin, readJson, routeError } from "@/lib/core/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const resendSchema = z.object({
  email: z.string().email().max(320),
});

type ResendableInviteRow = {
  invite_id: string;
  email: string;
  org_name: string;
};

const GENERIC_SUCCESS = { ok: true };

export async function POST(req: Request) {
  const originError = assertSafeOrigin(req);
  if (originError) return originError;

  try {
    const json = await readJson(req);
    if (!json.ok) return json.response;

    const parsed = resendSchema.safeParse(json.value);
    if (!parsed.success) return Response.json({ error: "validation" }, { status: 400 });

    const email = normalizeEmail(parsed.data.email);
    const emailLimit = await checkRateLimit(req, {
      action: "signup.recovery.resend.email",
      limit: 3,
      windowSeconds: 60 * 60,
      keyParts: [email],
    });
    if (!emailLimit.allowed) return rateLimitedResponse(emailLimit);

    const ipLimit = await checkRateLimit(req, {
      action: "signup.recovery.resend.ip",
      limit: 10,
      windowSeconds: 60 * 60,
    });
    if (!ipLimit.allowed) return rateLimitedResponse(ipLimit);

    const sql = getSql();
    const [row] = await sql`
      select
        i.id as invite_id,
        i.email,
        o.name as org_name
      from signups s
      join organization_invites i on i.id = s.invite_id
      join organizations o on o.id = i.org_id
      left join users u
        on lower(u.email) = lower(s.work_email)
        and u.status = 'active'
      where lower(s.work_email) = lower(${email})
        and i.status = 'pending'
        and (u.id is null or u.last_login_at is null)
      limit 1
    ` as ResendableInviteRow[];

    if (row) {
      await reissueInviteAndSendEmail(sql, {
        inviteId: row.invite_id,
        email: row.email,
        orgName: row.org_name,
      });
    }

    return Response.json(GENERIC_SUCCESS, { status: 200 });
  } catch (err) {
    return routeError("signup recovery resend failed", err);
  }
}
