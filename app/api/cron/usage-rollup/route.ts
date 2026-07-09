import { rollupUsage } from "@/lib/core/usage";
import { cronDisabledResponse, cronsEnabled, isCronAuthorized } from "@/lib/cron-guard";
import { recordCronRun } from "@/lib/core/cron-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!cronsEnabled()) {
    return cronDisabledResponse();
  }

  try {
    const result = await recordCronRun("usage-rollup", async () => {
      const rollup = await rollupUsage(14);
      return {
        detail: { rolled_rows: rollup.rows },
        response: Response.json({ ok: true, rolled_rows: rollup.rows }, { status: 200 }),
      };
    });
    return result.response;
  } catch (err: unknown) {
    console.error("usage rollup cron failed", { message: (err as Error)?.message });
    return Response.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
