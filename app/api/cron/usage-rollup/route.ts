import { rollupUsage } from "@/lib/prototype/usage";
import { cronDisabledResponse, cronsEnabled } from "@/lib/cron-guard";

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
    const result = await rollupUsage(14);
    return Response.json({ ok: true, rolled_rows: result.rows }, { status: 200 });
  } catch (err: unknown) {
    console.error("usage rollup cron failed", { message: (err as Error)?.message });
    return Response.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
