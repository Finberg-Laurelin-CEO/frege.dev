// Dev-only seed: one org (active) + one owner user with a known password.
// Uses plain `pg`. Password hashing mirrors lib/prototype/password.ts (scrypt).
import { randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";

const scrypt = promisify(scryptCb);
const { Client } = pg;
const DB = "postgresql://postgres:dev@localhost:55440/frege";

const EMAIL = "owner@demo.test";
const PASSWORD = "demo-password-123";
const ORG_SLUG = "demo-org";
const ORG_NAME = "Demo Org";

async function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const derived = await scrypt(password, salt, 64);
  return {
    passwordHash: derived.toString("hex"),
    passwordSalt: salt,
    passwordParams: { algorithm: "scrypt", key_length: 64 },
  };
}

async function main() {
  const c = new Client({ connectionString: DB });
  await c.connect();

  await c.query(`delete from organizations where slug = $1`, [ORG_SLUG]);
  await c.query(`delete from users where email = $1`, [EMAIL]);

  const { rows: orgRows } = await c.query(
    `insert into organizations (slug, name, status, activated_at)
     values ($1,$2,'active', now()) returning id`,
    [ORG_SLUG, ORG_NAME],
  );
  const orgId = orgRows[0].id;

  const { rows: userRows } = await c.query(
    `insert into users (email, name, status) values ($1,'Demo Owner','active') returning id`,
    [EMAIL],
  );
  const userId = userRows[0].id;

  const pw = await hashPassword(PASSWORD);
  await c.query(
    `insert into user_password_credentials (user_id, password_hash, password_salt, password_params, updated_at)
     values ($1,$2,$3,$4::jsonb, now())`,
    [userId, pw.passwordHash, pw.passwordSalt, JSON.stringify(pw.passwordParams)],
  );

  await c.query(
    `insert into organization_memberships (org_id, user_id, role, status)
     values ($1,$2,'owner','active')`,
    [orgId, userId],
  );

  // Billing row so /billing renders a real state.
  await c.query(
    `insert into org_billing (org_id, plan, billing_interval, seats, subscription_status, updated_at)
     values ($1,'solo','monthly',1,'active', now())
     on conflict (org_id) do nothing`,
    [orgId],
  );

  await c.end();
  console.log("SEEDED");
  console.log("  org:  ", ORG_SLUG, "(active)", orgId);
  console.log("  login email:   ", EMAIL);
  console.log("  login password:", PASSWORD);
}

main().catch((e) => {
  console.error("seed failed:", e.message);
  process.exit(1);
});
