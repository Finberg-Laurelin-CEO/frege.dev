import { getFregeSignupStats, type FregeSignupStats } from "@/lib/frege-signup-stats";
import { postHermesEvent } from "@/lib/hermes-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const authorization = req.headers.get("authorization");

  return Boolean(secret && authorization === `Bearer ${secret}`);
}

async function postHermesStats(stats: FregeSignupStats) {
  return postHermesEvent({
    event: "frege.signup.stats.snapshot",
    created_at: new Date().toISOString(),
    stats,
  });
}

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const stats = await getFregeSignupStats();
    const hermes = await postHermesStats(stats);

    if (!hermes.ok) {
      console.error("hermes signup stats cron failed", hermes);
      return Response.json(
        { ok: false, error: hermes.skipped ? "hermes_webhook_not_configured" : "hermes_webhook_failed" },
        { status: hermes.skipped ? 500 : 502 },
      );
    }

    return Response.json(
      {
        ok: true,
        total_signups: stats.total_signups,
        signups_last_8h: stats.signups_last_8h,
        signups_last_24h: stats.signups_last_24h,
        latest_signup_at: stats.latest_signup_at,
      },
      { status: 200 },
    );
  } catch (err: unknown) {
    console.error("frege signup stats cron failed", {
      message: (err as Error)?.message,
    });
    return Response.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
