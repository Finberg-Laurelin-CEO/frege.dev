import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

type Sql = NeonQueryFunction<false, false>;
type ParameterizedQuery = { query: string; params: unknown[] };
type QueryLike = {
  [Symbol.toStringTag]: "NeonQueryPromise";
  parameterizedQuery: ParameterizedQuery;
  opts?: unknown;
  then: Promise<unknown>["then"];
  catch: Promise<unknown>["catch"];
  finally: Promise<unknown>["finally"];
};

let sql: Sql | null = null;

function dbTimeoutMs(): number {
  const configured = Number(process.env.FREGE_DB_TIMEOUT_MS ?? 15000);
  return Number.isFinite(configured) && configured > 0 ? configured : 15000;
}

function dbTimeoutError(timeoutMs: number): Error {
  const err = new Error("db_timeout");
  err.name = "DbTimeoutError";
  (err as Error & { code: string; timeoutMs: number }).code = "db_timeout";
  (err as Error & { code: string; timeoutMs: number }).timeoutMs = timeoutMs;
  return err;
}

function withDbTimeout<T>(promise: PromiseLike<T>): Promise<T> {
  const timeoutMs = dbTimeoutMs();

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(dbTimeoutError(timeoutMs)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function makeQueryPromise<T>(
  parameterizedQuery: ParameterizedQuery,
  opts: unknown,
  execute: () => PromiseLike<T>,
): QueryLike {
  return {
    [Symbol.toStringTag]: "NeonQueryPromise",
    parameterizedQuery,
    opts,
    then: (onFulfilled, onRejected) => withDbTimeout(execute()).then(onFulfilled, onRejected),
    catch: (onRejected) => withDbTimeout(execute()).catch(onRejected),
    finally: (onFinally) => withDbTimeout(execute()).finally(onFinally),
  };
}

function parameterize(stringsOrText: TemplateStringsArray | string, values: unknown[]): { query: ParameterizedQuery; opts: unknown } {
  if (typeof stringsOrText === "string") {
    return {
      query: { query: stringsOrText, params: (values[0] as unknown[] | undefined) ?? [] },
      opts: values[1],
    };
  }

  let query = "";
  stringsOrText.forEach((part, i) => {
    query += part;
    if (i < values.length) query += `$${i + 1}`;
  });
  return { query: { query, params: values }, opts: undefined };
}

function createTimedQuery(queryPromise: unknown): QueryLike {
  const query = queryPromise as QueryLike;
  return {
    [Symbol.toStringTag]: "NeonQueryPromise",
    parameterizedQuery: query.parameterizedQuery,
    opts: query.opts,
    then: (onFulfilled, onRejected) => withDbTimeout(query).then(onFulfilled, onRejected),
    catch: (onRejected) => withDbTimeout(query).catch(onRejected),
    finally: (onFinally) => withDbTimeout(query).finally(onFinally),
  };
}

function wrapSql(baseSql: Sql): Sql {
  const timed = ((stringsOrText: TemplateStringsArray | string, ...values: unknown[]) =>
    createTimedQuery((baseSql as unknown as (...args: unknown[]) => unknown)(stringsOrText, ...values))) as unknown as Sql;

  timed.transaction = ((queriesOrFn: unknown, opts?: unknown) => {
    const transactionInput =
      typeof queriesOrFn === "function"
        ? (transactionSql: unknown) => {
            const timedTransactionSql = ((stringsOrText: TemplateStringsArray | string, ...values: unknown[]) =>
              createTimedQuery((transactionSql as (...args: unknown[]) => unknown)(stringsOrText, ...values))) as Sql;
            return (queriesOrFn as (sql: Sql) => unknown)(timedTransactionSql);
          }
        : queriesOrFn;

    return withDbTimeout((baseSql.transaction as unknown as (queries: unknown, opts?: unknown) => Promise<unknown>)(transactionInput, opts));
  }) as Sql["transaction"];

  return timed;
}

// Dev-only: when LOCAL_PG=1, talk to a plain Postgres via `pg` using a shim that
// mimics the neon() tagged-template interface. This branch is never taken in
// production (LOCAL_PG is unset on Vercel), so prod keeps using the neon driver.
function makeLocalPgSql(databaseUrl: string): Sql {
  // Lazy require so `pg` is only loaded in local dev, never bundled for prod.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pg = require("pg");
  const pool = new pg.Pool({ connectionString: databaseUrl });

  const runQuery = async (query: ParameterizedQuery, client = pool) => {
    const result = await client.query(query.query, query.params);
    return result.rows;
  };

  const tagged = ((stringsOrText: TemplateStringsArray | string, ...values: unknown[]) => {
    const { query, opts } = parameterize(stringsOrText, values);
    return makeQueryPromise(query, opts, () => runQuery(query));
  }) as unknown as Sql;

  tagged.transaction = (async (queriesOrFn: unknown) => {
    const transactionTagged = ((stringsOrText: TemplateStringsArray | string, ...values: unknown[]) => {
      const { query, opts } = parameterize(stringsOrText, values);
      return makeQueryPromise(query, opts, () => runQuery(query));
    }) as unknown as Sql;

    const queries =
      typeof queriesOrFn === "function" ? (queriesOrFn as (sql: Sql) => unknown)(transactionTagged) : queriesOrFn;
    if (!Array.isArray(queries)) throw new Error("transaction() expects an array of queries");

    const client = await pool.connect();
    try {
      await client.query("begin");
      const results = [];
      for (const query of queries as QueryLike[]) {
        if (query?.[Symbol.toStringTag] !== "NeonQueryPromise") {
          throw new Error("transaction() expects an array of queries");
        }
        results.push(await runQuery(query.parameterizedQuery, client));
      }
      await client.query("commit");
      return results;
    } catch (err) {
      await client.query("rollback").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }) as Sql["transaction"];

  return tagged as unknown as Sql;
}

export function getSql(): Sql {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set.");
  }

  if (process.env.LOCAL_PG === "1") {
    sql ??= wrapSql(makeLocalPgSql(databaseUrl));
    return sql;
  }

  sql ??= wrapSql(neon(databaseUrl));
  return sql;
}
