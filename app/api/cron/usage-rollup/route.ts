import { rollupUsage } from "@/lib/prototype/usage";
import { cronDisabledResponse, cronsEnabled } from "@/lib/cron-guard";
import { recordCronRun } from "@/lib/prototype/cron-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const authorization = req.headers.get("authorization");
  return Boolean(secret && authorization === `Bearer ${secret}`);
}

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
