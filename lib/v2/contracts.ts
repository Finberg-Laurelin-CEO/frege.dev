import { z } from "zod";
import { PRINCIPAL_TYPES } from "@/lib/v2/types";

export const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)*$/;
export const POLICY_PATTERN = /^(?:\*|[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)*(?:\.\*)?)$/;
export const CREDENTIAL_SCOPE_PATTERN = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)*(?:\.\*)?$/;
export const RESOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
export const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

const orgSlug = z.string().trim().min(1).max(120).regex(SLUG_PATTERN);
const entitySlug = z.string().trim().min(1).max(120).regex(SLUG_PATTERN);
const exactIdentifier = z.string().trim().min(1).max(128).regex(IDENTIFIER_PATTERN);
const policyPattern = z.string().trim().min(1).max(128).regex(POLICY_PATTERN);
const credentialScope = z.string().trim().min(1).max(128).regex(CREDENTIAL_SCOPE_PATTERN);
const resourceId = z.string().trim().min(1).max(200).regex(RESOURCE_ID_PATTERN);

function uniqueStrings(values: string[]): boolean {
  return new Set(values).size === values.length;
}

export const policyRuleSchema = z
  .object({
    id: z.string().trim().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/),
    effect: z.enum(["allow", "deny"]),
    actions: z.array(policyPattern).min(1).max(64).refine(uniqueStrings, "duplicate action pattern"),
    resource_types: z.array(policyPattern).min(1).max(64).refine(uniqueStrings, "duplicate resource pattern"),
    principal_types: z.array(z.enum(PRINCIPAL_TYPES)).min(1).max(3).refine(uniqueStrings, "duplicate principal type").optional(),
    principal_ids: z.array(z.string().uuid()).min(1).max(128).refine(uniqueStrings, "duplicate principal id").optional(),
    resource_ids: z.array(resourceId).min(1).max(128).refine(uniqueStrings, "duplicate resource id").optional(),
  })
  .strict();

export const policyRulesSchema = z
  .array(policyRuleSchema)
  .max(256)
  .refine((rules) => uniqueStrings(rules.map((rule) => rule.id)), "duplicate rule id");

export const createPrincipalSchema = z
  .object({
    org_slug: orgSlug,
    principal_type: z.enum(PRINCIPAL_TYPES),
    slug: entitySlug,
    name: z.string().trim().min(1).max(160),
    subject_user_id: z.string().uuid().optional(),
    subject_agent_id: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.principal_type === "human" && !value.subject_user_id) {
      ctx.addIssue({ code: "custom", path: ["subject_user_id"], message: "required for a human principal" });
    }
    if (value.principal_type !== "human" && value.subject_user_id) {
      ctx.addIssue({ code: "custom", path: ["subject_user_id"], message: "only valid for a human principal" });
    }
    if (value.principal_type === "agent" && !value.subject_agent_id) {
      ctx.addIssue({ code: "custom", path: ["subject_agent_id"], message: "required for an agent principal" });
    }
    if (value.principal_type !== "agent" && value.subject_agent_id) {
      ctx.addIssue({ code: "custom", path: ["subject_agent_id"], message: "only valid for an agent principal" });
    }
  });

export const createCredentialSchema = z
  .object({
    org_slug: orgSlug,
    principal_id: z.string().uuid(),
    policy_version_id: z.string().uuid(),
    name: z.string().trim().min(1).max(160),
    scopes: z.array(credentialScope).min(1).max(64).refine(uniqueStrings, "duplicate scope"),
    not_before: z.string().datetime().optional(),
    expires_at: z.string().datetime().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.not_before && value.expires_at && Date.parse(value.expires_at) <= Date.parse(value.not_before)) {
      ctx.addIssue({ code: "custom", path: ["expires_at"], message: "must be after not_before" });
    }
  });

export const createPolicyVersionSchema = z
  .object({
    org_slug: orgSlug,
    slug: entitySlug,
    expected_current_version: z.number().int().min(0).optional(),
    rules: policyRulesSchema,
  })
  .strict();

export const authorizeRequestSchema = z
  .object({
    action: exactIdentifier,
    resource: z
      .object({
        type: exactIdentifier,
        id: resourceId.optional(),
      })
      .strict(),
    correlation_id: z.string().uuid().optional(),
  })
  .strict();

export type CreatePrincipalInput = z.infer<typeof createPrincipalSchema>;
export type CreateCredentialInput = z.infer<typeof createCredentialSchema>;
export type CreatePolicyVersionInput = z.infer<typeof createPolicyVersionSchema>;
export type AuthorizeRequestInput = z.infer<typeof authorizeRequestSchema>;
