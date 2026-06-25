import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

type Sql = NeonQueryFunction<false, false>;

let sql: Sql | null = null;

// Dev-only: when LOCAL_PG=1, talk to a plain Postgres via `pg` using a shim that
// mimics the neon() tagged-template interface. This branch is never taken in
// production (LOCAL_PG is unset on Vercel), so prod keeps using the neon driver.
function makeLocalPgSql(databaseUrl: string): Sql {
  // Lazy require so `pg` is only loaded in local dev, never bundled for prod.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pg = require("pg");
  const pool = new pg.Pool({ connectionString: databaseUrl });

  const tagged = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = "";
    strings.forEach((part, i) => {
      text += part;
      if (i < values.length) text += `$${i + 1}`;
    });
    const result = await pool.query(text, values as unknown[]);
    return result.rows;
  };

  return tagged as unknown as Sql;
}

export function getSql(): Sql {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set.");
  }

  if (process.env.LOCAL_PG === "1") {
    sql ??= makeLocalPgSql(databaseUrl);
    return sql;
  }

  sql ??= neon(databaseUrl);
  return sql;
}
