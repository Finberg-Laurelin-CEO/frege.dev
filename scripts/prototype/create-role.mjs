// Create or update a Frege prototype role for an existing org.
//
// Required env:
//   DATABASE_URL
//
// Usage:
//   node --env-file=.env.local scripts/prototype/create-role.mjs <org-slug> <role-slug> <role-name> [labels] [can-create-docs] [can-update-docs] [can-read-audit] [can-read-sessions] [can-write-sessions] [can-propose-memory] [can-review-memory] [can-manage-sources] [can-execute-agents]
//
// labels is comma-separated: public,internal,restricted

import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Run `vercel env pull .env.local` first.");
  process.exit(1);
}

const orgSlug = process.argv[2];
const roleSlug = process.argv[3];
const roleName = process.argv[4];
const labels = (process.argv[5] ?? "public,internal")
  .split(",")
  .map((label) => label.trim())
  .filter(Boolean);
const canCreateDocs = process.argv[6] === "true";
const canUpdateDocs = process.argv[7] === "true";
const canReadAudit = process.argv[8] === "true";
const canReadSessions = process.argv[9] === "true";
const canWriteSessions = process.argv[10] !== "false";
const canProposeMemory = process.argv[11] === "true";
const canReviewMemory = process.argv[12] === "true";
const canManageSources = process.argv[13] === "true";
const canExecuteAgents = process.argv[14] === "true";

if (!orgSlug || !roleSlug || !roleName) {
  console.error(
    "Usage: node --env-file=.env.local scripts/prototype/create-role.mjs <org-slug> <role-slug> <role-name> [labels] [can-create-docs] [can-update-docs] [can-read-audit]",
  );
  process.exit(1);
}

const allowedLabels = new Set(["public", "internal", "restricted"]);
for (const label of labels) {
  if (!allowedLabels.has(label)) {
    console.error(`Invalid sensitivity label: ${label}`);
    process.exit(1);
  }
}

const sql = neon(databaseUrl);
const [org] = await sql`
  select id, slug
  from organizations
  where slug = ${orgSlug}
  limit 1
`;

if (!org) {
  console.error(`No org found for slug=${orgSlug}. Run create-org first.`);
  process.exit(1);
}

const [role] = await sql`
  insert into roles (
    org_id, slug, name, can_read_labels,
    can_create_docs, can_update_docs, can_read_audit,
    can_read_sessions, can_write_sessions, can_propose_memory,
    can_review_memory_proposals, can_manage_sources, can_execute_agents
  ) values (
    ${org.id}, ${roleSlug}, ${roleName}, ${labels},
    ${canCreateDocs}, ${canUpdateDocs}, ${canReadAudit},
    ${canReadSessions}, ${canWriteSessions}, ${canProposeMemory},
    ${canReviewMemory}, ${canManageSources}, ${canExecuteAgents}
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
  returning
    id,
    slug,
    name,
    can_read_labels,
    can_create_docs,
    can_update_docs,
    can_read_audit,
    can_read_sessions,
    can_write_sessions,
    can_propose_memory,
    can_review_memory_proposals,
    can_manage_sources,
    can_execute_agents
`;

console.log("Created/updated prototype role.");
console.log(`org: ${org.slug}`);
console.log(`role: ${role.slug} (${role.id})`);
console.log(`labels: ${role.can_read_labels.join(",")}`);
console.log(`can_create_docs: ${role.can_create_docs}`);
console.log(`can_update_docs: ${role.can_update_docs}`);
console.log(`can_read_audit: ${role.can_read_audit}`);
console.log(`can_read_sessions: ${role.can_read_sessions}`);
console.log(`can_write_sessions: ${role.can_write_sessions}`);
console.log(`can_propose_memory: ${role.can_propose_memory}`);
console.log(`can_review_memory_proposals: ${role.can_review_memory_proposals}`);
console.log(`can_manage_sources: ${role.can_manage_sources}`);
console.log(`can_execute_agents: ${role.can_execute_agents}`);
