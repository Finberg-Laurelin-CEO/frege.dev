export type SignupRecoveryAction = "sign_in" | "resend_invite_available" | "already_requested";

export type SignupRecoveryRow = {
  created_at?: Date | string | null;
  user_status?: string | null;
  last_login_at?: Date | string | null;
  invite_status?: string | null;
};

export type SignupRecovery = {
  action: SignupRecoveryAction;
  requested_at: string | null;
};

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString();
}

export function signupRecoveryFromRow(row: SignupRecoveryRow | undefined): SignupRecovery {
  const requested_at = toIsoString(row?.created_at);
  if (row?.user_status === "active" && row.last_login_at) {
    return { action: "sign_in", requested_at };
  }
  if (row?.invite_status === "pending") {
    return { action: "resend_invite_available", requested_at };
  }
  return { action: "already_requested", requested_at };
}
