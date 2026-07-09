import { createHash, timingSafeEqual } from "node:crypto";

// Constant-time token comparison. Hashing both sides first fixes the buffer
// length, so timingSafeEqual is usable regardless of candidate length and the
// comparison leaks neither prefix matches nor the token's length.
function tokenMatches(candidate: string, expected: string): boolean {
  const candidateDigest = createHash("sha256").update(candidate).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}

export function authenticateRuntimeRequest(req: Request): Response | null {
  const expected = process.env.FREGE_RUNTIME_TOKEN;
  if (!expected) return Response.json({ error: "runtime_disabled" }, { status: 403 });

  const authorization = req.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization.trim())?.[1];
  const headerToken = req.headers.get("x-frege-runtime-token");
  const actual = bearer ?? headerToken;

  if (!actual || !tokenMatches(actual, expected)) {
    return Response.json({ error: "runtime_unauthorized" }, { status: 401 });
  }
  return null;
}
