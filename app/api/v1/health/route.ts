import { getSql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requiredProductionEnv = ["DATABASE_URL", "FREGE_SECRET_KEY", "FREGE_API_KEY_SALT", "IP_HASH_SALT"] as const;

export async function GET() {
  const missingEnv = requiredProductionEnv.filter((name) => !process.env[name]);

  try {
    const sql = getSql();
    await sql`select 1`;

    const checks = await Promise.all(
      ["users", "organizations", "api_keys", "brain_pages"].map(async (table) => {
        const rows = await sql`
          select to_regclass(${`public.${table}`}) is not null as present
        `;
        return [table, Boolean((rows[0] as { present: boolean } | undefined)?.present)] as const;
      }),
    );
    const tables = Object.fromEntries(checks);
    const missingTables = Object.entries(tables).filter(([, present]) => !present).map(([table]) => table);
    const ok = missingEnv.length === 0 && missingTables.length === 0;

    return Response.json(
      {
        ok,
        service: "frege-api",
        database: "ok",
        tables,
        missing_env: missingEnv,
        missing_tables: missingTables,
      },
      { status: ok ? 200 : 503 },
    );
  } catch (err) {
    return Response.json(
      {
        ok: false,
        service: "frege-api",
        database: "error",
        missing_env: missingEnv,
        error: (err as Error)?.message ?? "health_check_failed",
      },
      { status: 503 },
    );
  }
}
