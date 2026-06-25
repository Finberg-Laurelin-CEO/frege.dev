// Dev-only: seed an interlinked brain vault for the demo org so the graph view
// and agent traversal tools have realistic shapes (hub, bridge, cluster,
// isolated node, unresolved link). Mirrors refreshBrainPageLinks: parses
// [[wikilinks]] / frege://page links from each body and writes brain_links.
import pg from "pg";

const { Client } = pg;
const DB = "postgresql://postgres:dev@localhost:55440/frege";
const ORG_SLUG = "demo-org";

function slugify(value) {
  return (
    value.trim().toLowerCase().replace(/\.md$/i, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "page"
  );
}

function parseLinks(body) {
  const links = new Map();
  const wiki = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  const md = /\[[^\]]+\]\((?:frege:\/\/page\/)?([a-zA-Z0-9][a-zA-Z0-9/_ .-]*)\)/g;
  for (const m of body.matchAll(wiki)) {
    const s = slugify(m[1] ?? "");
    if (s) links.set(s, m[0]);
  }
  for (const m of body.matchAll(md)) {
    const raw = String(m[1] ?? "").replace(/\.md$/i, "");
    const s = slugify(raw.split("/").filter(Boolean).at(-1) ?? raw);
    if (s) links.set(s, m[0]);
  }
  return [...links.entries()].map(([slug, evidence]) => ({ slug, evidence }));
}

// title -> markdown body. Links use [[Title]] wikilink form.
const PAGES = {
  "Agent Runtime":
    "The [[Agent Runtime]] executes hosted agents. It builds context via the [[Context Protocol]], records steps in the [[Session Ledger]], and enforces [[Trust Zones]]. See also [[Model Gateway]].",
  "Context Protocol":
    "The [[Context Protocol]] governs how the [[Agent Runtime]] assembles a context packet. It pulls from the [[Knowledge Brain]] and respects [[Trust Zones]]. Billing limits are described in [[Billing Overview]].",
  "Session Ledger":
    "Every run appends events to the [[Session Ledger]]. The [[Agent Runtime]] writes here. Secrets are redacted before storage.",
  "Trust Zones":
    "[[Trust Zones]] (green/red) gate what the [[Agent Runtime]] and [[Context Protocol]] can read. Red is restricted.",
  "Model Gateway":
    "The [[Model Gateway]] routes model calls for the [[Agent Runtime]]. Provider keys are encrypted. Depends on [[Provider Credentials]].",
  "Knowledge Brain":
    "The [[Knowledge Brain]] stores markdown pages with auto-extracted links. The [[Context Protocol]] reads from it.",
  "Billing Overview":
    "[[Billing Overview]] covers plans and activation. Inactive orgs cannot run the [[Agent Runtime]]. See [[Stripe Webhooks]].",
  "Stripe Webhooks":
    "[[Stripe Webhooks]] flip an org to active on checkout. Related to [[Billing Overview]] and [[Pricing Tiers]].",
  // Pricing Tiers is referenced but NOT created => unresolved link / ghost node.
  "Onboarding Notes":
    "Standalone scratch page with no links. Intentionally isolated to test the graph's isolated-node rendering.",
};

async function main() {
  const c = new Client({ connectionString: DB });
  await c.connect();

  const { rows: orgRows } = await c.query(`select id from organizations where slug=$1`, [ORG_SLUG]);
  if (!orgRows[0]) throw new Error(`org ${ORG_SLUG} not found — run _dev_seed.mjs first`);
  const orgId = orgRows[0].id;

  // Clean prior brain seed for idempotency.
  await c.query(`delete from brain_pages where org_id=$1`, [orgId]);

  const slugByTitle = {};
  // 1) Insert pages + first revision.
  for (const [title, body] of Object.entries(PAGES)) {
    const slug = slugify(title);
    slugByTitle[title] = slug;
    const { rows } = await c.query(
      `insert into brain_pages (org_id, slug, title, status, trust_zone)
       values ($1,$2,$3,'published','green') returning id`,
      [orgId, slug, title],
    );
    const pageId = rows[0].id;
    await c.query(
      `insert into brain_page_revisions (org_id, page_id, revision_number, body_md, summary)
       values ($1,$2,1,$3,$4)`,
      [orgId, pageId, body, body.slice(0, 80)],
    );
  }

  // 2) Wire links exactly like refreshBrainPageLinks.
  let linkCount = 0;
  let unresolvedCount = 0;
  for (const [title, body] of Object.entries(PAGES)) {
    const slug = slugByTitle[title];
    const { rows: srcRows } = await c.query(`select id from brain_pages where org_id=$1 and slug=$2`, [orgId, slug]);
    const sourceId = srcRows[0].id;
    for (const link of parseLinks(body)) {
      if (link.slug === slug) continue; // skip self-links (page links to its own title)
      const { rows: tgtRows } = await c.query(`select id from brain_pages where org_id=$1 and slug=$2`, [orgId, link.slug]);
      const targetId = tgtRows[0]?.id ?? null;
      if (!targetId) unresolvedCount++;
      await c.query(
        `insert into brain_links (org_id, source_page_id, target_page_id, target_slug, link_type, confidence, evidence)
         values ($1,$2,$3,$4,'references',1,$5)
         on conflict (org_id, source_page_id, target_slug, link_type) do nothing`,
        [orgId, sourceId, targetId, link.slug, link.evidence],
      );
      linkCount++;
    }
  }

  await c.end();
  console.log("SEEDED BRAIN");
  console.log(`  pages: ${Object.keys(PAGES).length}`);
  console.log(`  links: ${linkCount} (unresolved: ${unresolvedCount})`);
  console.log("  hub: agent-runtime | bridge: context-protocol | isolated: onboarding-notes | unresolved: pricing-tiers");
}

main().catch((e) => {
  console.error("brain seed failed:", e.message);
  process.exit(1);
});
