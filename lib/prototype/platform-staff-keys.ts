import { getSql } from "@/lib/db";
import { hashApiKey, parseStaffApiKey, safelyCompareApiKeyHash } from "@/lib/prototype/keys";
import type { UserSessionContext } from "@/lib/prototype/session";

type StaffKeyRow = {
  key_id: string;
  key_hash: string;
  status: string;
  expires_at: string | null;
  owner_user_id: string;
  owner_email: string;
  owner_name: string;
  owner_status: string;
  is_platform_staff: boolean;
};

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() <= Date.now();
}

// Authenticate a platform-staff API key from the Authorization header.
// Returns a staff identity only when the key is active, unexpired, and its
// owner is still an active platform-staff user. Returns null otherwise so the
// caller can fall through to session-based auth.
export async function authenticatePlatformStaffKey(req: Request): Promise<UserSessionContext | null> {
  const authorization = req.headers.get("authorization");
  if (!authorization) return null;
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization.trim())?.[1];
  if (!bearer) return null;

  const parsed = parseStaffApiKey(bearer);
  if (!parsed) return null;

  const sql = getSql();
  const rows = await sql`
    select
      k.id as key_id,
      k.key_hash,
      k.status,
      k.expires_at,
      u.id as owner_user_id,
      u.email as owner_email,
      u.name as owner_name,
      u.status as owner_status,
      u.is_platform_staff
    from platform_staff_api_keys k
    join users u on u.id = k.owner_user_id
    where k.key_prefix = ${parsed.keyPrefix}
    limit 1
  `;

  const row = rows[0] as StaffKeyRow | undefined;
  if (!row) return null;
  if (row.status !== "active") return null;
  if (isExpired(row.expires_at)) return null;
  if (row.owner_status !== "active") return null;
  if (row.is_platform_staff !== true) return null;

  const candidateHash = hashApiKey(parsed.rawKey);
  if (!safelyCompareApiKeyHash(candidateHash, row.key_hash)) return null;

  await sql`update platform_staff_api_keys set last_used_at = now() where id = ${row.key_id}`;

  return {
    user: {
      id: row.owner_user_id,
      email: row.owner_email,
      name: row.owner_name,
      status: row.owner_status,
    },
    session: { id: "staff_key", expires_at: new Date(Date.now() + 60 * 60 * 1000) },
    memberships: [],
  };
}
