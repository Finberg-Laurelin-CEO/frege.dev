# Governed GitHub connector design note

Status: deferred. The GitHub connector is not deployed, supported, or offered
as part of the current Frege MVP. The source-visible repository contains
experimental API and sync code, but production has no connector allowlist and
no scheduled connector worker.

The intended future boundary is repository-scoped, read-only Markdown sync into
Frege's existing source, page, and immutable-revision model. Any pilot must be
explicitly invited and must pass a separate production-readiness review before
credentials or recovery infrastructure are enabled.

That review must verify at least:

- tenant-bound installation, repository, source, and credential identity;
- default-deny service-principal authorization and attributable receipts;
- short-lived repository-restricted GitHub tokens that are never persisted or
  logged;
- exact path identity, stable revision mapping, and idempotent writes;
- complete-snapshot checks before any deletion is applied;
- secret-content quarantine, bounded file and run sizes, and UTF-8 validation;
- replay-safe webhook delivery handling and crash-safe recovery;
- archive-on-removal behavior that retains revisions and provenance; and
- cross-organization, duplicate-delivery, partial-sync, and credential-leakage
  tests.

Until those gates are complete and an actual pilot needs the integration,
customers should add approved Markdown through the supported CLI document-sync
workflow described in [FREGE_MCP_INSTALL.md](FREGE_MCP_INSTALL.md).
