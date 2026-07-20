import { createHash } from "node:crypto";
import type {
  AuthorizationDecision,
  AuthorizationReasonCode,
  AuthorizationResourceRef,
  ControlPolicyVersion,
  ControlPrincipal,
  DelegatedCredential,
  PolicyRule,
} from "@/lib/v2/types";

export type AuthorizationEvaluationInput = {
  orgId: string;
  principal: Pick<ControlPrincipal, "id" | "org_id" | "principal_type" | "status">;
  credential: Pick<
    DelegatedCredential,
    "id" | "org_id" | "principal_id" | "status" | "scopes" | "not_before" | "expires_at"
  >;
  policy: Pick<
    ControlPolicyVersion,
    "id" | "org_id" | "slug" | "version" | "default_decision" | "rules" | "rules_digest"
  > & { valid?: boolean };
  action: string;
  resource: AuthorizationResourceRef & { orgId: string };
  now?: Date;
};

export type AuthorizationEvaluation = {
  decision: AuthorizationDecision;
  reasonCode: AuthorizationReasonCode;
  matchingRuleId: string | null;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

/** A stable digest identifies the exact immutable rule document used. */
export function digestPolicyRules(rules: PolicyRule[]): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(rules))).digest("hex");
}

/** Namespace wildcards are boundary-aware: `memory.*` matches `memory.read`, not `memoryx.read`. */
export function policyPatternMatches(pattern: string, value: string): boolean {
  if (pattern === "*") return true;
  if (!pattern.endsWith(".*")) return pattern === value;
  const namespace = pattern.slice(0, -2);
  return value.startsWith(`${namespace}.`);
}

function anyPatternMatches(patterns: string[], value: string): boolean {
  return patterns.some((pattern) => policyPatternMatches(pattern, value));
}

function ruleMatches(rule: PolicyRule, input: AuthorizationEvaluationInput): boolean {
  if (rule.principal_types && !rule.principal_types.includes(input.principal.principal_type)) return false;
  if (rule.principal_ids && !rule.principal_ids.includes(input.principal.id)) return false;
  if (!anyPatternMatches(rule.actions, input.action)) return false;
  if (!anyPatternMatches(rule.resource_types, input.resource.type)) return false;
  if (rule.resource_ids && (!input.resource.id || !rule.resource_ids.includes(input.resource.id))) return false;
  return true;
}

function deny(reasonCode: Exclude<AuthorizationReasonCode, "allowed_by_policy">, matchingRuleId: string | null = null) {
  return { decision: "deny", reasonCode, matchingRuleId } as const;
}

function validTime(value: Date | string): number | null {
  const milliseconds = new Date(value).getTime();
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

/**
 * Pure, default-deny authorization. Every identity and resource tenant must
 * agree, credential scopes are a hard ceiling, and explicit deny overrides an
 * allow regardless of rule order.
 */
export function evaluateAuthorization(input: AuthorizationEvaluationInput): AuthorizationEvaluation {
  if (
    input.principal.org_id !== input.orgId ||
    input.credential.org_id !== input.orgId ||
    input.policy.org_id !== input.orgId ||
    input.resource.orgId !== input.orgId ||
    input.credential.principal_id !== input.principal.id
  ) {
    return deny("tenant_mismatch");
  }

  if (input.principal.status !== "active") return deny("principal_inactive");
  if (input.credential.status !== "active") return deny("credential_inactive");

  const now = (input.now ?? new Date()).getTime();
  const notBefore = validTime(input.credential.not_before);
  if (notBefore === null || now < notBefore) return deny("credential_not_yet_valid");

  if (input.credential.expires_at) {
    const expiresAt = validTime(input.credential.expires_at);
    if (expiresAt === null || now >= expiresAt) return deny("credential_expired");
  }

  if (!anyPatternMatches(input.credential.scopes, input.action)) {
    return deny("credential_scope_mismatch");
  }

  if (input.policy.valid === false || input.policy.default_decision !== "deny") {
    return deny("policy_invalid");
  }

  const matchingRules = input.policy.rules.filter((rule) => ruleMatches(rule, input));
  const explicitDeny = matchingRules.find((rule) => rule.effect === "deny");
  if (explicitDeny) return deny("explicit_deny", explicitDeny.id);

  const explicitAllow = matchingRules.find((rule) => rule.effect === "allow");
  if (explicitAllow) {
    return {
      decision: "allow",
      reasonCode: "allowed_by_policy",
      matchingRuleId: explicitAllow.id,
    };
  }

  return deny("default_deny");
}
