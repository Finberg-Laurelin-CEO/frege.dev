export const PRINCIPAL_TYPES = ["human", "agent", "service"] as const;
export type PrincipalType = (typeof PRINCIPAL_TYPES)[number];

export const PRINCIPAL_STATUSES = ["active", "disabled"] as const;
export type PrincipalStatus = (typeof PRINCIPAL_STATUSES)[number];

export const AUTHORIZATION_DECISIONS = ["allow", "deny"] as const;
export type AuthorizationDecision = (typeof AUTHORIZATION_DECISIONS)[number];

export const AUTHORIZATION_REASON_CODES = [
  "allowed_by_policy",
  "explicit_deny",
  "default_deny",
  "tenant_mismatch",
  "principal_inactive",
  "credential_inactive",
  "credential_not_yet_valid",
  "credential_expired",
  "credential_scope_mismatch",
  "policy_invalid",
] as const;
export type AuthorizationReasonCode = (typeof AUTHORIZATION_REASON_CODES)[number];

export type ControlPrincipal = {
  id: string;
  org_id: string;
  principal_type: PrincipalType;
  slug: string;
  name: string;
  status: PrincipalStatus;
  subject_user_id: string | null;
  subject_agent_id: string | null;
  created_by_principal_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

/**
 * A rule is deliberately limited to stable identifiers. Resource content,
 * titles, paths, prompts, and arbitrary attributes are not part of the policy
 * wire contract, so a denied decision cannot echo restricted material.
 */
export type PolicyRule = {
  id: string;
  effect: AuthorizationDecision;
  actions: string[];
  resource_types: string[];
  principal_types?: PrincipalType[];
  principal_ids?: string[];
  resource_ids?: string[];
};

export type ControlPolicyVersion = {
  id: string;
  org_id: string;
  slug: string;
  version: number;
  default_decision: "deny";
  rules: PolicyRule[];
  rules_digest: string;
  created_by_principal_id: string | null;
  created_at: Date | string;
};

export type DelegatedCredential = {
  id: string;
  org_id: string;
  principal_id: string;
  delegated_by_principal_id: string;
  policy_version_id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  status: "active" | "revoked";
  not_before: Date | string;
  expires_at: Date | string | null;
  last_used_at: Date | string | null;
  revoked_at: Date | string | null;
  created_at: Date | string;
};

export type AuthorizationResourceRef = {
  type: string;
  id?: string;
};

export type AuthorizationReceipt = {
  id: string;
  org_id: string;
  principal: {
    id: string;
    type: PrincipalType;
  };
  delegated_credential_id: string;
  correlation_id: string;
  request_id: string;
  action: string;
  resource: AuthorizationResourceRef;
  decision: AuthorizationDecision;
  policy: {
    id: string;
    slug: string;
    version: number;
    rules_digest: string;
    matching_rule_id: string | null;
  };
  reason_code: AuthorizationReasonCode;
  created_at: Date | string;
};

export type ProvenanceEvent = {
  event_id: string;
  org_id: string;
  principal_id: string | null;
  principal_type: PrincipalType | null;
  delegated_credential_id: string | null;
  event_type: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  outcome: "success" | "failure" | "allow" | "deny";
  authorization_receipt_id: string | null;
  correlation_id: string | null;
  payload: Record<string, unknown>;
  created_at: Date | string;
  source: "v2" | "v1_telemetry" | "v1_audit";
};

export type V2CredentialAuthContext = {
  organization: {
    id: string;
    slug: string;
    name: string;
    status: string;
  };
  principal: ControlPrincipal;
  credential: DelegatedCredential;
  policy: ControlPolicyVersion & { valid: boolean };
};
