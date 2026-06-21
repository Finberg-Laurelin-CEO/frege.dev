import type { DocumentLinkType, SensitivityLabel } from "@/lib/prototype/types";

export type DemoRole = {
  slug: "reader" | "writer" | "admin";
  name: string;
  keyPrefix: string;
  allowedLabels: SensitivityLabel[];
  capabilities: {
    canCreateDocs: boolean;
    canUpdateDocs: boolean;
    canReadAudit: boolean;
  };
};

export type DemoDocument = {
  id: string;
  slug: string;
  path: string;
  title: string;
  sensitivity: SensitivityLabel;
  status: "published";
  tags: string[];
  summary: string;
  bodyMd: string;
  revisionNumber: number;
  updatedAt: string;
};

export type DemoConcept = {
  id: string;
  slug: string;
  name: string;
  description: string;
  documentSlugs: string[];
  confidence: number;
};

export type DemoDocumentLink = {
  id: string;
  sourceSlug: string;
  targetSlug: string;
  linkType: DocumentLinkType;
  confidence: number;
  evidence: string;
};

export type DemoChunk = {
  id: string;
  documentSlug: string;
  chunkIndex: number;
  bodyMd: string;
  tokenCount: number;
};

export type DemoAuditEvent = {
  id: string;
  action: string;
  resourceType: string;
  resourceSlug: string;
  actor: string;
  metadata: Record<string, string | number>;
  createdAt: string;
};

export const DEMO_ROLES: DemoRole[] = [
  {
    slug: "reader",
    name: "Reader key",
    keyPrefix: "frg_reader",
    allowedLabels: ["public", "internal"],
    capabilities: {
      canCreateDocs: false,
      canUpdateDocs: false,
      canReadAudit: false,
    },
  },
  {
    slug: "writer",
    name: "Writer key",
    keyPrefix: "frg_writer",
    allowedLabels: ["public", "internal"],
    capabilities: {
      canCreateDocs: true,
      canUpdateDocs: true,
      canReadAudit: false,
    },
  },
  {
    slug: "admin",
    name: "Admin key",
    keyPrefix: "frg_admin",
    allowedLabels: ["public", "internal", "restricted"],
    capabilities: {
      canCreateDocs: true,
      canUpdateDocs: true,
      canReadAudit: true,
    },
  },
];

export const DEMO_DOCUMENTS: DemoDocument[] = [
  {
    id: "doc_company_overview",
    slug: "company-overview",
    path: "company/overview.md",
    title: "Company Overview",
    sensitivity: "public",
    status: "published",
    tags: ["company", "overview"],
    summary: "Public company context for every approved agent workspace.",
    revisionNumber: 1,
    updatedAt: "2026-06-18T19:05:00Z",
    bodyMd: `# Company Overview

Frege Demo is a fictional pilot workspace used to prove permission-aware agent memory.

Agents can read this document with any demo key. It contains no confidential data.`,
  },
  {
    id: "doc_customer_refunds",
    slug: "customer-refunds",
    path: "support/customer-refunds.md",
    title: "Customer Refund Policy",
    sensitivity: "internal",
    status: "published",
    tags: ["support", "refunds", "customers"],
    summary: "Internal refund-handling guidance for support agents.",
    revisionNumber: 3,
    updatedAt: "2026-06-18T19:10:00Z",
    bodyMd: `# Customer Refund Policy

Support can approve refunds under $250 when the customer was charged incorrectly or the product was unavailable for more than one business day.

Refunds over $250 require manager approval. Edge cases should be escalated to the support lead before promising anything to the customer.

Related context to load later: sales handoff notes and restricted pricing exception rules.`,
  },
  {
    id: "doc_engineering_oncall",
    slug: "engineering-oncall",
    path: "engineering/oncall.md",
    title: "Engineering On-Call Runbook",
    sensitivity: "internal",
    status: "published",
    tags: ["engineering", "oncall", "incidents"],
    summary: "Internal on-call escalation flow for engineering agents.",
    revisionNumber: 2,
    updatedAt: "2026-06-18T19:14:00Z",
    bodyMd: `# Engineering On-Call Runbook

When an alert fires, acknowledge it, identify the affected system, and check recent deploys before changing production state.

If customer data may be affected, page the incident lead and move to the restricted incident escalation runbook.

Always write a short timeline before the incident is closed.`,
  },
  {
    id: "doc_sales_handoff",
    slug: "sales-handoff",
    path: "sales/handoff.md",
    title: "Sales Handoff Checklist",
    sensitivity: "internal",
    status: "published",
    tags: ["sales", "handoff", "customers"],
    summary: "Checklist for handing customers from sales to support.",
    revisionNumber: 1,
    updatedAt: "2026-06-18T19:18:00Z",
    bodyMd: `# Sales Handoff Checklist

Before a customer is handed to support, capture the promised plan, billing owner, renewal date, and any non-standard terms.

Do not promise pricing exceptions in the handoff notes. Use the restricted pricing exception policy for those cases.`,
  },
  {
    id: "doc_pricing_exceptions",
    slug: "pricing-exceptions",
    path: "sales/pricing-exceptions.md",
    title: "Pricing Exception Policy",
    sensitivity: "restricted",
    status: "published",
    tags: ["sales", "pricing", "restricted"],
    summary: "Restricted policy for pricing exceptions.",
    revisionNumber: 1,
    updatedAt: "2026-06-18T19:21:00Z",
    bodyMd: `# Pricing Exception Policy

This restricted demo document represents sensitive commercial guidance.

Only restricted-reader and admin roles should be able to discover or read it.

Agents with normal reader keys must not see this title, body, tags, snippets, or semantic-map neighbors.`,
  },
  {
    id: "doc_incident_escalation",
    slug: "incident-escalation",
    path: "security/incident-escalation.md",
    title: "Incident Escalation Runbook",
    sensitivity: "restricted",
    status: "published",
    tags: ["security", "incidents", "restricted"],
    summary: "Restricted escalation process for sensitive incidents.",
    revisionNumber: 1,
    updatedAt: "2026-06-18T19:24:00Z",
    bodyMd: `# Incident Escalation Runbook

This restricted demo runbook represents sensitive incident response guidance.

If a customer-data incident is suspected, notify the incident lead, legal owner, and executive sponsor before sending external updates.

Only restricted-reader and admin roles should be able to discover or read this runbook.`,
  },
];

export const DEMO_DOCUMENT_LINKS: DemoDocumentLink[] = [
  {
    id: "link_refunds_handoff",
    sourceSlug: "customer-refunds",
    targetSlug: "sales-handoff",
    linkType: "related",
    confidence: 0.92,
    evidence: "Support decisions depend on sales promises and handoff notes.",
  },
  {
    id: "link_refunds_pricing",
    sourceSlug: "customer-refunds",
    targetSlug: "pricing-exceptions",
    linkType: "depends_on",
    confidence: 0.89,
    evidence: "Refund edge cases can touch restricted pricing exception rules.",
  },
  {
    id: "link_oncall_incident",
    sourceSlug: "engineering-oncall",
    targetSlug: "incident-escalation",
    linkType: "depends_on",
    confidence: 0.95,
    evidence: "Customer-data incidents escalate from on-call into the restricted runbook.",
  },
  {
    id: "link_company_oncall",
    sourceSlug: "company-overview",
    targetSlug: "engineering-oncall",
    linkType: "references",
    confidence: 0.72,
    evidence: "The public overview points engineers toward operational runbooks.",
  },
];

export const DEMO_CONCEPTS: DemoConcept[] = [
  {
    id: "concept_refunds",
    slug: "customer-refunds",
    name: "Customer refunds",
    description: "Refund thresholds, manager approvals, and support escalation.",
    documentSlugs: ["customer-refunds", "sales-handoff", "pricing-exceptions"],
    confidence: 0.94,
  },
  {
    id: "concept_customer_handoff",
    slug: "customer-handoff",
    name: "Customer handoff",
    description: "Promises and operating context passed from sales to support.",
    documentSlugs: ["sales-handoff", "customer-refunds"],
    confidence: 0.87,
  },
  {
    id: "concept_incident_response",
    slug: "incident-response",
    name: "Incident response",
    description: "On-call checks, escalation paths, and incident timelines.",
    documentSlugs: ["engineering-oncall", "incident-escalation"],
    confidence: 0.91,
  },
  {
    id: "concept_access_control",
    slug: "access-control",
    name: "Access control",
    description: "Document sensitivity labels and role-scoped reads.",
    documentSlugs: ["company-overview", "pricing-exceptions", "incident-escalation"],
    confidence: 0.82,
  },
];

export const DEMO_CHUNKS: DemoChunk[] = [
  {
    id: "chunk_refunds_1",
    documentSlug: "customer-refunds",
    chunkIndex: 1,
    tokenCount: 43,
    bodyMd:
      "Support can approve refunds under $250 when the customer was charged incorrectly or the product was unavailable for more than one business day.",
  },
  {
    id: "chunk_refunds_2",
    documentSlug: "customer-refunds",
    chunkIndex: 2,
    tokenCount: 39,
    bodyMd:
      "Refunds over $250 require manager approval. Edge cases should be escalated to the support lead before promising anything to the customer.",
  },
  {
    id: "chunk_oncall_1",
    documentSlug: "engineering-oncall",
    chunkIndex: 1,
    tokenCount: 39,
    bodyMd:
      "When an alert fires, acknowledge it, identify the affected system, and check recent deploys before changing production state.",
  },
  {
    id: "chunk_handoff_1",
    documentSlug: "sales-handoff",
    chunkIndex: 1,
    tokenCount: 38,
    bodyMd:
      "Before a customer is handed to support, capture the promised plan, billing owner, renewal date, and any non-standard terms.",
  },
  {
    id: "chunk_pricing_1",
    documentSlug: "pricing-exceptions",
    chunkIndex: 1,
    tokenCount: 31,
    bodyMd:
      "This restricted demo document represents sensitive commercial guidance. Only admin keys should expose it in this console.",
  },
  {
    id: "chunk_incident_1",
    documentSlug: "incident-escalation",
    chunkIndex: 1,
    tokenCount: 35,
    bodyMd:
      "If a customer-data incident is suspected, notify the incident lead, legal owner, and executive sponsor before sending external updates.",
  },
];

export const DEMO_AUDIT_EVENTS: DemoAuditEvent[] = [
  {
    id: "audit_001",
    action: "documents.search",
    resourceType: "query",
    resourceSlug: "refund",
    actor: "frg_reader",
    createdAt: "2026-06-18T19:31:00Z",
    metadata: { visible_results: 2, hidden_results: 1 },
  },
  {
    id: "audit_002",
    action: "documents.read",
    resourceType: "knowledge_document",
    resourceSlug: "customer-refunds",
    actor: "frg_reader",
    createdAt: "2026-06-18T19:32:00Z",
    metadata: { sensitivity: "internal", revision_number: 3 },
  },
  {
    id: "audit_003",
    action: "map.context",
    resourceType: "knowledge_document",
    resourceSlug: "customer-refunds",
    actor: "frg_writer",
    createdAt: "2026-06-18T19:34:00Z",
    metadata: { link_count: 1, concept_count: 2, hidden_links: 1 },
  },
  {
    id: "audit_004",
    action: "documents.proposal.created",
    resourceType: "document_revision_proposal",
    resourceSlug: "sales-handoff",
    actor: "frg_writer",
    createdAt: "2026-06-18T19:36:00Z",
    metadata: { base_revision_number: 1, status: "pending" },
  },
  {
    id: "audit_005",
    action: "audit_events.list",
    resourceType: "audit_events",
    resourceSlug: "latest",
    actor: "frg_admin",
    createdAt: "2026-06-18T19:38:00Z",
    metadata: { limit: 25, filter: "none" },
  },
];
