import { getFregeSignupStats } from "@/lib/frege-signup-stats";

export const runtime = "nodejs";

function isAuthorized(req: Request): boolean {
  const secret = process.env.FREGE_ADMIN_STATS_SECRET;
  const authorization = req.headers.get("authorization");

  return Boolean(secret && authorization === `Bearer ${secret}`);
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    return Response.json(await getFregeSignupStats(), { status: 200 });
  } catch (err: unknown) {
    console.error("frege signup stats failed", {
      message: (err as Error)?.message,
    });
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
