export function authenticateRuntimeRequest(req: Request): Response | null {
  const expected = process.env.FREGE_RUNTIME_TOKEN;
  if (!expected) return Response.json({ error: "runtime_disabled" }, { status: 403 });

  const authorization = req.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization.trim())?.[1];
  const headerToken = req.headers.get("x-frege-runtime-token");
  const actual = bearer ?? headerToken;

  if (actual !== expected) return Response.json({ error: "runtime_unauthorized" }, { status: 401 });
  return null;
}
