import { createHash, randomBytes } from "node:crypto";
import type { SendResult } from "@/lib/core/email";
import { sendInviteEmail } from "@/lib/core/email";
import { customerBaseUrl } from "@/lib/core/public-url";
import type { getSql } from "@/lib/db";

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 14;

export function hashInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function generateInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

export function inviteLinkForToken(rawToken: string): string {
  return `${customerBaseUrl()}/invite?token=${rawToken}`;
}

export async function reissueInviteAndSendEmail(
  sql: ReturnType<typeof getSql>,
  input: { inviteId: string; email: string; orgName: string },
): Promise<{ rawToken: string; inviteLink: string; emailResult: SendResult }> {
  const rawToken = generateInviteToken();
  await sql`
    update organization_invites
    set
      invite_token_hash = ${hashInviteToken(rawToken)},
      status = 'pending',
      expires_at = ${new Date(Date.now() + INVITE_TTL_MS).toISOString()}
    where id = ${input.inviteId}
  `;

  const inviteLink = inviteLinkForToken(rawToken);
  const emailResult = await sendInviteEmail({
    to: input.email,
    inviteUrl: inviteLink,
    orgName: input.orgName,
  });

  return { rawToken, inviteLink, emailResult };
}
