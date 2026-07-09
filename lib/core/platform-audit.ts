import { getSql } from "@/lib/db";
import type { PlatformStaffContext } from "@/lib/core/platform-auth";

export type PlatformAuditInput = {
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
};

// Record a platform staff action. Best-effort: never throw into the request
// path — a failed audit write must not block the operation it describes, but it
// is logged so gaps are visible.
export async function recordPlatformAudit(
  actor: PlatformStaffContext,
  input: PlatformAuditInput,
): Promise<void> {
  try {
    const sql = getSql();
    await sql`
      insert into platform_audit_events (
        actor_user_id, actor_email, action, target_type, target_id, metadata
      ) values (
        ${actor.user.id},
        ${actor.user.email},
        ${input.action},
        ${input.targetType ?? null},
        ${input.targetId ?? null},
        ${JSON.stringify(input.metadata ?? {})}::jsonb
      )
    `;
  } catch (err) {
    console.error("platform audit write failed", input.action, err);
  }
}
