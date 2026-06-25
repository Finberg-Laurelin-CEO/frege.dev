// Dev-only: ensure an 'admin' role + mint an API key for the demo org, using
// the same hashing as lib/prototype/keys.ts so the real auth path accepts it.
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";

const { Client } = pg;
const DB = "postgresql://postgres:dev@localhost:55440/frege";
const ORG_SLUG = "demo-org";
const SALT = process.env.FREGE_API_KEY_SALT ?? "dev-local-api-key-salt";

function hashApiKey(rawKey) {
  return createHash("sha256").update(`${rawKey}|${SALT}`).digest("hex");
}

async function colExists(c, table, col) {
  const { rows } = await c.query(
    `select 1 from information_schema.columns where table_name=$1 and column_name=$2`,
    [table, col],
  );
  return rows.length > 0;
}

async function main() {
  const c = new Client({ connectionString: DB });
  await c.connect();

  const { rows: orgRows } = await c.query(`select id from organizations where slug=$1`, [ORG_SLUG]);
  if (!orgRows[0]) throw new Error(`org ${ORG_SLUG} not found`);
  const orgId = orgRows[0].id;

  // Build an all-permissive admin role across whatever capability columns exist.
  const capCols = [
    "can_create_docs", "can_update_docs", "can_read_audit", "can_read_sessions",
    "can_write_sessions", "can_propose_memory", "can_review_memory_proposals",
    "can_manage_sources", "can_execute_agents",
  ];
  const present = [];
  for (const col of capCols) if (await colExists(c, "roles", col)) present.push(col);

  const cols = ["org_id", "slug", "name", "can_read_labels", ...present];
  const vals = [orgId, "admin", "Admin", "{public,internal,restricted}", ...present.map(() => true)];
  const placeholders = cols.map((_, i) => `$${i + 1}`);

  await c.query(
    `insert into roles (${cols.join(",")}) values (${placeholders.join(",")})
     on conflict (org_id, slug) do update set can_read_labels = excluded.can_read_labels`,
    vals,
  );

  const { rows: roleRows } = await c.query(`select id from roles where org_id=$1 and slug='admin'`, [orgId]);
  const roleId = roleRows[0].id;

  const { rows: userRows } = await c.query(
    `select user_id from organization_memberships where org_id=$1 and role='owner' limit 1`,
    [orgId],
  );
  const ownerId = userRows[0]?.user_id ?? null;

  const keyPrefix = randomBytes(6).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  const rawKey = `frg_live_${keyPrefix}_${secret}`;

  await c.query(`delete from api_keys where org_id=$1 and name='dev-graph-key'`, [orgId]);
  await c.query(
    `insert into api_keys (org_id, role_id, owner_user_id, name, key_prefix, key_hash)
     values ($1,$2,$3,'dev-graph-key',$4,$5)`,
    [orgId, roleId, ownerId, keyPrefix, hashApiKey(rawKey)],
  );

  await c.end();
  console.log("MINTED KEY");
  console.log(rawKey);
}

main().catch((e) => {
  console.error("mint failed:", e.message);
  process.exit(1);
});
