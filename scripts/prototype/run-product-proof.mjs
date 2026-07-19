#!/usr/bin/env node

import process from "node:process";

const DEFAULT_BASE_URL = "http://localhost:3000";
const DEFAULT_ORG = "frege-proof-engineering";

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}

const baseUrl = argValue("--base-url", process.env.FREGE_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
const expectedOrg = argValue("--expected-org", process.env.FREGE_PROOF_ORG ?? DEFAULT_ORG);
const allowProduction = process.argv.includes("--allow-production");
const createProposal = process.argv.includes("--create-proposal");
const apiKey = process.env.FREGE_PROOF_KEY;

if (!apiKey) {
  console.error("FREGE_PROOF_KEY is required. Use a dedicated green-zone writer key for a sanitized demo org.");
  process.exit(1);
}

const hostname = new URL(baseUrl).hostname;
if ((hostname === "frege.dev" || hostname.endsWith(".frege.dev")) && !allowProduction) {
  console.error("Refusing to target production without --allow-production.");
  process.exit(1);
}

if (!expectedOrg.startsWith("frege-proof-") && !process.argv.includes("--allow-non-demo-org")) {
  console.error("Refusing a non-demo organization. Use a frege-proof-* org or pass --allow-non-demo-org deliberately.");
  process.exit(1);
}

async function request(route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${route} failed (${response.status}): ${json.error ?? "unknown_error"}`);
  }
  return json;
}

function publicCitation(document) {
  return {
    slug: document.slug,
    revision: document.revision_number,
    trust_zone: document.trust_zone,
  };
}

async function main() {
  const status = await request("/api/v1/brain/status");
  const actualOrg = status.status?.organization?.slug;
  if (actualOrg !== expectedOrg) {
    throw new Error(`demo_org_mismatch: expected ${expectedOrg}, received ${actualOrg ?? "unknown"}`);
  }

  const allowed = await request("/api/v1/context/build", {
    method: "POST",
    body: JSON.stringify({ query: "Atlas checkout release readiness", limit: 8 }),
  });
  if (!allowed.context?.documents?.length) throw new Error("proof_context_empty");
  if (allowed.context.documents.some((document) => document.trust_zone === "red")) {
    throw new Error("restricted_document_leaked_into_green_context");
  }

  const denied = await request("/api/v1/context/build", {
    method: "POST",
    body: JSON.stringify({ query: "production credentials and incident access", limit: 8 }),
  });
  if ((denied.context?.denied_count ?? 0) < 1) throw new Error("proof_denial_not_observed");
  if (denied.context.documents?.some((document) => document.trust_zone === "red")) {
    throw new Error("restricted_document_leaked_into_denied_context");
  }

  let proposal = null;
  if (createProposal) {
    const suffix = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
    const result = await request("/api/v1/brain/proposals", {
      method: "POST",
      body: JSON.stringify({
        proposal_type: "page_create",
        slug: `atlas-release-proof-${suffix}`,
        title: "Atlas release proof",
        summary: "Sanitized proposal created by the public engineering-team product proof.",
        body_md:
          "# Atlas release proof\n\nThe rollback owner was verified before release. This fictional note contains no customer or production data.",
        trust_zone: "green",
        metadata: { demo: true, proof_id: "engineering-release-context" },
      }),
    });
    proposal = {
      id: result.proposal?.id,
      status: result.proposal?.status,
      slug: result.proposal?.slug,
    };
  }

  const transcript = {
    proof_id: "engineering-release-context",
    organization: actualOrg,
    actor: {
      type: status.status?.actor_type,
      role: status.status?.key?.role_slug ?? "scoped",
      allowed_trust_zones: status.status?.allowed_trust_zones ?? [],
    },
    context: {
      id: allowed.context.id,
      citations: allowed.context.documents.map(publicCitation),
      denied_count: denied.context.denied_count,
      restricted_content_returned: false,
    },
    proposal,
    next: proposal
      ? "Open the control plane, inspect the proposal evidence, and accept or reject it as a human reviewer."
      : "Re-run with --create-proposal to add the human-review beat in a disposable demo organization.",
  };

  process.stdout.write(`${JSON.stringify(transcript, null, 2)}\n`);
}

main().catch((error) => {
  console.error(`product proof failed: ${error.message}`);
  process.exit(1);
});
