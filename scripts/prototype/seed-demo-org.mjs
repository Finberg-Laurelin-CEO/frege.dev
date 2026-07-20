// Seed deterministic demo data for the Frege product prototype.
//
// Run after applying db/002_prototype_core.sql:
//
//   node --env-file=.env.local scripts/migrate.mjs db/002_prototype_core.sql
//   node --env-file=.env.local scripts/prototype/seed-demo-org.mjs
//
// Optional args:
//   node --env-file=.env.local scripts/prototype/seed-demo-org.mjs <org-slug> <org-name>

import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Run `vercel env pull .env.local` first.");
  process.exit(1);
}

const orgSlug = process.argv[2] ?? "frege-demo";
const orgName = process.argv[3] ?? "Frege Demo";
const sql = neon(databaseUrl);

const roles = [
  {
    slug: "reader",
    name: "Reader",
    can_read_labels: ["public", "internal"],
    can_create_docs: false,
    can_update_docs: false,
    can_read_audit: false,
    can_read_sessions: false,
    can_write_sessions: true,
    can_propose_memory: false,
    can_review_memory_proposals: false,
    can_manage_sources: false,
    can_execute_agents: false,
  },
  {
    slug: "writer",
    name: "Writer",
    can_read_labels: ["public", "internal"],
    can_create_docs: true,
    can_update_docs: true,
    can_read_audit: false,
    can_read_sessions: true,
    can_write_sessions: true,
    can_propose_memory: true,
    can_review_memory_proposals: false,
    can_manage_sources: false,
    can_execute_agents: false,
  },
  {
    slug: "restricted-reader",
    name: "Restricted Reader",
    can_read_labels: ["public", "internal", "restricted"],
    can_create_docs: false,
    can_update_docs: false,
    can_read_audit: false,
    can_read_sessions: true,
    can_write_sessions: true,
    can_propose_memory: true,
    can_review_memory_proposals: false,
    can_manage_sources: false,
    can_execute_agents: false,
  },
  {
    slug: "admin",
    name: "Admin",
    can_read_labels: ["public", "internal", "restricted"],
    can_create_docs: true,
    can_update_docs: true,
    can_read_audit: true,
    can_read_sessions: true,
    can_write_sessions: true,
    can_propose_memory: true,
    can_review_memory_proposals: true,
    can_manage_sources: true,
    can_execute_agents: false,
  },
];

const documents = [
  {
    slug: "company-overview",
    path: "company/overview.md",
    title: "Company Overview",
    sensitivity: "public",
    status: "published",
    tags: ["company", "overview"],
    summary: "Demo overview for public company context.",
    body_md: `# Company Overview

Frege Demo is a fictional pilot workspace used to prove permission-aware agent memory.

Agents can read this document with any demo key. It contains no confidential data.
`,
  },
  {
    slug: "customer-refunds",
    path: "support/customer-refunds.md",
    title: "Customer Refund Policy",
    sensitivity: "internal",
    status: "published",
    tags: ["support", "refunds", "customers"],
    summary: "Internal refund-handling guidance for support agents.",
    body_md: `# Customer Refund Policy

Support can approve refunds under $250 when the customer was charged incorrectly or the product was unavailable for more than one business day.

Refunds over $250 require manager approval. Edge cases should be escalated to the support lead before promising anything to the customer.

Related context to load later: sales handoff notes and restricted pricing exception rules.
`,
  },
  {
    slug: "engineering-oncall",
    path: "engineering/oncall.md",
    title: "Engineering On-Call Runbook",
    sensitivity: "internal",
    status: "published",
    tags: ["engineering", "oncall", "incidents"],
    summary: "Internal on-call escalation flow for engineering agents.",
    body_md: `# Engineering On-Call Runbook

When an alert fires, acknowledge it, identify the affected system, and check recent deploys before changing production state.

If customer data may be affected, page the incident lead and move to the restricted incident escalation runbook.

Always write a short timeline before the incident is closed.
`,
  },
  {
    slug: "sales-handoff",
    path: "sales/handoff.md",
    title: "Sales Handoff Checklist",
    sensitivity: "internal",
    status: "published",
    tags: ["sales", "handoff", "customers"],
    summary: "Internal checklist for handing customers from sales to support.",
    body_md: `# Sales Handoff Checklist

Before a customer is handed to support, capture the promised plan, billing owner, renewal date, and any non-standard terms.

Do not promise pricing exceptions in the handoff notes. Use the restricted pricing exception policy for those cases.
`,
  },
  {
    slug: "pricing-exceptions",
    path: "sales/pricing-exceptions.md",
    title: "Pricing Exception Policy",
    sensitivity: "restricted",
    status: "published",
    tags: ["sales", "pricing", "restricted"],
    summary: "Restricted demo policy for pricing exceptions.",
    body_md: `# Pricing Exception Policy

This restricted demo document represents sensitive commercial guidance.

Only restricted-reader and admin roles should be able to discover or read it.

Agents with normal reader keys must not see this title, body, tags, snippets, or future semantic-map neighbors.
`,
  },
  {
    slug: "incident-escalation",
    path: "security/incident-escalation.md",
    title: "Incident Escalation Runbook",
    sensitivity: "restricted",
    status: "published",
    tags: ["security", "incidents", "restricted"],
    summary: "Restricted demo escalation process for sensitive incidents.",
    body_md: `# Incident Escalation Runbook

This restricted demo runbook represents sensitive incident response guidance.

If a customer-data incident is suspected, notify the incident lead, legal owner, and executive sponsor before sending external updates.

Only restricted-reader and admin roles should be able to discover or read this runbook.
`,
  },
];

async function main() {
  const [org] = await sql`
    insert into organizations (slug, name)
    values (${orgSlug}, ${orgName})
    on conflict (slug) do update set name = excluded.name
    returning id, slug, name
  `;

  if (!org) throw new Error("Failed to seed organization.");
  console.log(`org: ${org.slug} (${org.id})`);

  for (const role of roles) {
    const [row] = await sql`
      insert into roles (
        org_id, slug, name, can_read_labels,
        can_create_docs, can_update_docs, can_read_audit,
        can_read_sessions, can_write_sessions, can_propose_memory,
        can_review_memory_proposals, can_manage_sources, can_execute_agents
      ) values (
        ${org.id}, ${role.slug}, ${role.name}, ${role.can_read_labels},
        ${role.can_create_docs}, ${role.can_update_docs}, ${role.can_read_audit},
        ${role.can_read_sessions}, ${role.can_write_sessions}, ${role.can_propose_memory},
        ${role.can_review_memory_proposals}, ${role.can_manage_sources}, ${role.can_execute_agents}
      )
      on conflict (org_id, slug) do update set
        name = excluded.name,
        can_read_labels = excluded.can_read_labels,
        can_create_docs = excluded.can_create_docs,
        can_update_docs = excluded.can_update_docs,
        can_read_audit = excluded.can_read_audit,
        can_read_sessions = excluded.can_read_sessions,
        can_write_sessions = excluded.can_write_sessions,
        can_propose_memory = excluded.can_propose_memory,
        can_review_memory_proposals = excluded.can_review_memory_proposals,
        can_manage_sources = excluded.can_manage_sources,
        can_execute_agents = excluded.can_execute_agents
      returning id, slug
    `;
    console.log(`role: ${row.slug} (${row.id})`);
  }

  for (const doc of documents) {
    const [existingDocument] = await sql`
      select id
      from knowledge_documents
      where org_id = ${org.id}
        and (path = ${doc.path} or slug = ${doc.slug})
      order by (path = ${doc.path}) desc, updated_at desc
      limit 1
    `;

    const [documentRow] = existingDocument
      ? await sql`
          update knowledge_documents
          set
            slug = ${doc.slug},
            path = ${doc.path},
            title = ${doc.title},
            sensitivity = ${doc.sensitivity},
            trust_zone = ${doc.sensitivity === "restricted" ? "red" : "green"},
            status = ${doc.status},
            tags = ${doc.tags},
            updated_at = now()
          where id = ${existingDocument.id}
          returning id, slug
        `
      : await sql`
          insert into knowledge_documents (
            org_id, slug, path, title, sensitivity, trust_zone, status, tags, updated_at
          ) values (
            ${org.id}, ${doc.slug}, ${doc.path}, ${doc.title}, ${doc.sensitivity},
            ${doc.sensitivity === "restricted" ? "red" : "green"}, ${doc.status}, ${doc.tags}, now()
          )
          returning id, slug
        `;

    await sql`
      insert into knowledge_document_revisions (
        document_id, revision_number, body_md, summary
      ) values (
        ${documentRow.id}, 1, ${doc.body_md}, ${doc.summary}
      )
      on conflict (document_id, revision_number) do update set
        body_md = excluded.body_md,
        summary = excluded.summary
    `;

    console.log(`document: ${documentRow.slug} (${documentRow.id})`);
  }

  console.log("Seed complete.");
}

main().catch((err) => {
  console.error("Seed failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
