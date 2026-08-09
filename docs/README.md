# Public Documentation

This directory contains documentation that is safe and useful in Frege's
source-visible repository.

- [`ARCHITECTURE.md`](ARCHITECTURE.md) describes the public system boundaries
  and data flow.
- [`FREGE_MCP_INSTALL.md`](FREGE_MCP_INSTALL.md) is the supported CLI and MCP
  installation guide.
- [`STATELESS_MCP.md`](STATELESS_MCP.md) documents the opt-in hosted MCP
  transport, read-only rollout, and security boundary.
- [`../packages/frege-cli/README.md`](../packages/frege-cli/README.md) documents
  the published CLI package.

The website documentation at <https://frege.dev/docs> remains the primary
customer entry point.

## Public-repository boundary

Do not commit fundraising or investor material, application scripts, internal
branch plans, operator worklogs, incident timelines, production account IDs,
customer-identifying incident details, private admin procedures, or environment
inventories.

When one of those documents is still useful locally, preserve it under
`plans/private-repo-containment/`. The entire `plans/` directory is ignored.
Never force-add files from it. Removing a formerly tracked document from the
current tree does not remove it from Git history, so particularly sensitive
historical material may still require a separate history-rewrite decision.

`frege.docs.yml` is an allowlist. Add only durable, public-safe documents to the
manifest; do not replace it with a recursive sync of this directory.

The Markdown under `demo-data/` is synthetic test and demonstration data, not
company or customer documentation. See [`../demo-data/README.md`](../demo-data/README.md).

## Secret-free verification

The repository checks intentionally run without production credentials:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:public-claims
pnpm test:public-repository
FREGE_PUBLIC_SITE_V2=true pnpm build
FREGE_PUBLIC_SITE_V2=false pnpm build
```

Environment-backed migrations, live smoke tests, billing operations, and other
mutating production checks are outside CI.
