import { getFregeSignupStats, type FregeSignupStats } from "@/lib/frege-signup-stats";
import { postHermesEvent } from "@/lib/hermes-webhook";
import { cronDisabledResponse, cronsEnabled, isCronAuthorized } from "@/lib/cron-guard";
import { recordCronRun } from "@/lib/core/cron-run";
import { recordSignupMonitorEvent } from "@/lib/core/signup-monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function recordAndPostHermesStats(stats: FregeSignupStats) {
  const payload = {
    event: "frege.signup.stats.snapshot",
    created_at: new Date().toISOString(),
    stats,
  };
  // Frege-native monitor record (never throws); the external webhook only
  // fires when FREGE_EXTERNAL_MONITOR_ENABLED=true.
  await recordSignupMonitorEvent("frege.signup.stats.snapshot", payload);
  return postHermesEvent(payload);
}

class CronResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!cronsEnabled()) {
    return cronDisabledResponse();
  }

  try {
    const result = await recordCronRun("frege-signup-stats", async () => {
      const stats = await getFregeSignupStats();
      const hermes = await recordAndPostHermesStats(stats);

      if (!hermes.ok) {
        if (hermes.skipped) {
          return {
            detail: {
              total_signups: stats.total_signups,
              signups_last_8h: stats.signups_last_8h,
              signups_last_24h: stats.signups_last_24h,
              hermes: "skipped",
            },
            response: Response.json(
              {
                ok: true,
                hermes: "skipped",
                total_signups: stats.total_signups,
                signups_last_8h: stats.signups_last_8h,
                signups_last_24h: stats.signups_last_24h,
                latest_signup_at: stats.latest_signup_at,
              },
              { status: 200 },
            ),
          };
        }

        console.error("hermes signup stats cron failed", hermes);
        throw new CronResponseError("hermes_webhook_failed", 502);
      }

      return {
        detail: {
          total_signups: stats.total_signups,
          signups_last_8h: stats.signups_last_8h,
          signups_last_24h: stats.signups_last_24h,
        },
        response: Response.json(
          {
            ok: true,
            total_signups: stats.total_signups,
            signups_last_8h: stats.signups_last_8h,
            signups_last_24h: stats.signups_last_24h,
            latest_signup_at: stats.latest_signup_at,
          },
          { status: 200 },
        ),
      };
    });

    return result.response;
  } catch (err: unknown) {
    if (err instanceof CronResponseError) {
      return Response.json({ ok: false, error: err.message }, { status: err.status });
    }

    console.error("frege signup stats cron failed", {
      message: (err as Error)?.message,
    });
    return Response.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
