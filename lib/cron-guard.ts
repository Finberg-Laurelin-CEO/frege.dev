// Cron execution guard.
//
// The same codebase is deployed to multiple Vercel projects (the public site and the
// internal admin console), all reading the same database. Vercel registers the crons
// from vercel.json on EVERY project, so without a guard the rollup/stats crons would
// run once per project and double-process shared data.
//
// Only the project with CRON_ENABLED="true" actually executes crons. Set it on the
// canonical (main site) project only.
export function cronsEnabled(): boolean {
  return process.env.CRON_ENABLED === "true";
}

export function cronDisabledResponse(): Response {
  return Response.json(
    { ok: true, skipped: "crons_disabled_on_this_project" },
    { status: 200 },
  );
}

// Vercel cron invocations carry `Authorization: Bearer ${CRON_SECRET}`. Reject
// everything else — including all requests when CRON_SECRET is unset.
export function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const authorization = req.headers.get("authorization");
  return Boolean(secret && authorization === `Bearer ${secret}`);
}
