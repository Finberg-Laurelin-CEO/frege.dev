import { getSql } from "@/lib/db";
import type { HumanOrgContext } from "@/lib/core/org-guard";
import {
  activationViewFromEvidence,
  type ActivationEvidence,
  type ActivationView,
} from "@/lib/core/activation-view";

type ActivationEvidenceRow = Omit<ActivationEvidence, "email_verified_at">;

export async function activationViewForOrg(
  auth: HumanOrgContext,
  now: Date = new Date(),
): Promise<ActivationView> {
  const sql = getSql();
  const [row] = (await sql`
    select
      organizations.created_at as account_created_at,
      case
        when organizations.status = 'active'
          then coalesce(organizations.activated_at, org_billing.updated_at, organizations.created_at)
        else null
      end as billing_active_at,
      (
        select min(api_keys.created_at)
        from api_keys
        where api_keys.org_id = organizations.id
      ) as api_key_issued_at,
      (
        select min(observation.observed_at)
        from (
          select min(telemetry_events.created_at) as observed_at
          from telemetry_events
          where telemetry_events.org_id = organizations.id
            and telemetry_events.actor_type = 'api_key'
            and telemetry_events.outcome = 'success'
          union all
          select min(audit_events.created_at) as observed_at
          from audit_events
          where audit_events.org_id = organizations.id
            and audit_events.actor_key_id is not null
          union all
          select min(api_keys.last_used_at) as observed_at
          from api_keys
          where api_keys.org_id = organizations.id
            and api_keys.last_used_at is not null
        ) observation
      ) as client_call_observed_at,
      (
        select min(imported.created_at)
        from (
          select min(knowledge_documents.created_at) as created_at
          from knowledge_documents
          where knowledge_documents.org_id = organizations.id
          union all
          select min(brain_sources.created_at) as created_at
          from brain_sources
          where brain_sources.org_id = organizations.id
        ) imported
      ) as source_imported_at,
      (
        select min(context_builds.created_at)
        from context_builds
        where context_builds.org_id = organizations.id
          and (
            exists (
              select 1
              from context_build_documents
              where context_build_documents.context_build_id = context_builds.id
            )
            or exists (
              select 1
              from context_build_brain_pages
              where context_build_brain_pages.context_build_id = context_builds.id
            )
          )
      ) as cited_context_built_at,
      (
        select min(approved.resolved_at)
        from (
          select min(coalesce(memory_proposals.resolved_at, memory_proposals.created_at)) as resolved_at
          from memory_proposals
          where memory_proposals.org_id = organizations.id
            and memory_proposals.status = 'accepted'
          union all
          select min(coalesce(document_revision_proposals.resolved_at, document_revision_proposals.created_at)) as resolved_at
          from document_revision_proposals
          where document_revision_proposals.org_id = organizations.id
            and document_revision_proposals.status = 'accepted'
        ) approved
      ) as proposal_approved_at
    from organizations
    left join org_billing on org_billing.org_id = organizations.id
    where organizations.id = ${auth.organization.id}
    limit 1
  `) as ActivationEvidenceRow[];

  if (!row) throw new Error("activation_org_not_found");

  return activationViewFromEvidence(
    {
      ...row,
      email_verified_at: auth.user.email_verified_at,
    },
    now,
  );
}

export type { ActivationMilestone, ActivationView } from "@/lib/core/activation-view";
