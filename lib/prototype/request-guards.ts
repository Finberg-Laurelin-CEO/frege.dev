import { readSessionToken } from "@/lib/prototype/session";

export function assertSafeOrigin(req: Request): Response | null {
  const origin = req.headers.get("origin");
  if (!origin) return null;

  const host = req.headers.get("host");
  if (!host) return Response.json({ error: "missing_host" }, { status: 400 });

  try {
    const originUrl = new URL(origin);
    if (originUrl.host === host) return null;
  } catch {
    return Response.json({ error: "invalid_origin" }, { status: 400 });
  }

  return Response.json({ error: "forbidden_origin" }, { status: 403 });
}

export function assertSafeBrowserMutation(req: Request): Response | null {
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return Response.json({ error: "forbidden_origin" }, { status: 403 });

  const hasSessionCookie = Boolean(readSessionToken(req));
  const method = req.method.toUpperCase();
  if (hasSessionCookie && ["POST", "PATCH", "PUT", "DELETE"].includes(method) && !req.headers.get("origin")) {
    return Response.json({ error: "missing_origin" }, { status: 403 });
  }

  return assertSafeOrigin(req);
}

export async function readJson(req: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, value: await req.json() };
  } catch {
    return { ok: false, response: Response.json({ error: "invalid_json" }, { status: 400 }) };
  }
}

export function routeError(label: string, err: unknown): Response {
  console.error(label, {
    message: (err as Error)?.message,
  });
  const debug =
    process.env.FREGE_DEBUG_ERRORS === "true"
      ? { error: "internal", debug: (err as Error)?.message ?? String(err) }
      : { error: "internal" };
  return Response.json(debug, { status: 500 });
}
