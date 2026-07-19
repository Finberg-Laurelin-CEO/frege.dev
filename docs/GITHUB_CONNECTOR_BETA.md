# Governed GitHub connector

Status: private beta. The connector API is implemented under `/api/v2`; access
may be enabled only for invited organizations while the contract is refined.
Existing `/api/v1`, CLI, and MCP behavior is unchanged.

The GitHub connector imports selected Markdown from an installed GitHub App
into Frege's existing source, page, and immutable-revision model. Every sync is
performed by an explicit service principal, evaluated under a default-deny
policy, and tied to an authorization receipt and provenance event.

## Safety defaults

- The installation token is limited to one repository and `contents: read`.
- Installation tokens, one-time GitHub user tokens, and webhook bodies are
  never persisted.
- New sources default to the red trust zone.
- The default allowlist is `README.md`, `docs/**/*.md`, and `docs/**/*.mdx`.
- Environment files, private/secret directories, private-key formats,
  dependencies, build output, and oversized files are excluded.
- Recursive GitHub trees that report truncation are rejected. Deletions are
  applied only from a complete, authoritative snapshot.
- A high-confidence credential or private-key match fails the snapshot before
  fetched content is written.
- A sync is capped at 500 files, 512 KiB per file, and 8 MiB in total.

Repository identity comes from GitHub's numeric repository ID. File identity
is the exact repository path. Display names and generated slugs are not used as
external identity, so repository names cannot cross tenant boundaries or merge
two files that happen to share the same Git blob.

## GitHub App configuration

The hosted Frege environment requires these server-side values:

- `FREGE_GITHUB_APP_ID`
- `FREGE_GITHUB_APP_SLUG`
- `FREGE_GITHUB_APP_PRIVATE_KEY`
- `FREGE_GITHUB_APP_CLIENT_ID`
- `FREGE_GITHUB_APP_CLIENT_SECRET`
- `FREGE_GITHUB_WEBHOOK_SECRET`
- `FREGE_GITHUB_CONNECTOR_BETA_ORGS`
- `CRON_ENABLED=true`
- `CRON_SECRET`

`FREGE_GITHUB_CONNECTOR_BETA_ORGS` is a comma-separated list of invited Frege
organization slugs or UUIDs. It is fail-closed: leaving it unset enables no
customer organization, even when every GitHub App credential is configured.
The gate covers setup, registration, and manual sync. An existing tenant-bound
connector can still be inspected and revoked after an organization is removed
from the list.
The cron values are required for durable push and initial-sync recovery.

The GitHub App needs read-only repository contents permission. Configure its
setup URL as:

```text
https://frege.dev/api/v2/connectors/github/setup/callback
```

Configure its user-authorization callback URL as:

```text
https://frege.dev/api/v2/connectors/github/setup/verify
```

Configure its webhook URL as:

```text
https://frege.dev/api/v2/connectors/github/webhook
```

Subscribe to `push`, `installation`, `installation_repositories`, and
`repository` events. Frege verifies `X-Hub-Signature-256` before parsing a
delivery and deduplicates the GitHub delivery ID against the exact payload
digest.

## Connect a repository

Browser setup uses an authenticated owner/admin session, a verified email, an
active organization, same-origin mutation checks, and a random setup state.
Only a SHA-256 hash of that state is stored; it expires after ten minutes and
can be consumed once by the same user and organization. Frege then performs a
one-time GitHub user authorization and binds only repository IDs visible to
that user through the exact installation being connected. The one-time user
token is always discarded and is submitted for best-effort revocation after
that verification.

Start setup:

```http
POST /api/v2/connectors/github/setup
Content-Type: application/json

{
  "org_slug": "acme"
}
```

Open the returned `install_url`. After GitHub returns through the setup
callback, register one of the repositories selected for that installation:

```http
POST /api/v2/connectors/github/repositories
Content-Type: application/json

{
  "org_slug": "acme",
  "installation_id": 12345678,
  "repository_id": 87654321,
  "source_ref": "main",
  "config": {
    "include": ["README.md", "docs/**/*.md", "docs/**/*.mdx"],
    "exclude": ["docs/private/**"],
    "trust_zone": "red",
    "max_files": 200,
    "max_file_bytes": 262144
  }
}
```

Frege re-reads the installation and repository from GitHub; repository names
in browser or webhook input are never trusted as identity. Registration creates
a managed service principal, an immutable one-resource sync policy, and an
internal delegated credential whose raw value is immediately discarded. The
initial sync is queued after the response. A bounded cron recovery lane picks
up an active connector left pending by a crashed post-response invocation,
using one stable idempotency key per connector generation.

## Inspect, resync, and revoke

These owner/admin endpoints are tenant-filtered and return `Cache-Control:
no-store`:

```text
GET    /api/v2/connectors/github/repositories?org_slug=acme
GET    /api/v2/connectors/github/repositories/CONNECTOR_ID?org_slug=acme
POST   /api/v2/connectors/github/repositories/CONNECTOR_ID/sync?org_slug=acme
DELETE /api/v2/connectors/github/repositories/CONNECTOR_ID?org_slug=acme
```

The sync endpoint also accepts a V2 delegated credential. Its scopes and
pinned policy must both allow `connector.sync` on resource type
`github.repository` and the exact connector ID. A denial records and returns an
authorization receipt before any GitHub request or connector write occurs.

An `Idempotency-Key` header makes a manual sync retryable. The key is bound to
the normalized connector configuration; reusing it after changing selection or
trust-zone settings returns a conflict rather than replaying an older result.

## Revisions, deletion, and revocation

The connector stores the Git blob SHA as the external revision cursor and maps
it to the exact `brain_page_revision` created from that body. An unchanged
commit and configuration do not create duplicate revisions.

A path absent from a complete selected tree is marked deleted and its page is
archived; its revisions and provenance remain. An uninstall, repository
removal, deletion, archive, or transfer revokes the connector authority,
disables the source, and archives its pages. An unsuspended GitHub installation
does not silently restore that authority—an administrator must reconnect it.

## Beta limits

- Markdown and MDX files are supported; Git LFS objects, submodules, symlinks,
  and arbitrary source-code ingestion are not.
- A truncated recursive tree fails closed rather than traversing a very large
  repository in this beta.
- Push webhooks are accepted into a payload-free delivery ledger before the
  hosted post-response worker starts. A bounded cron reclaims received, failed,
  or expired push attempts, waits for governed sync leases and `retry_after`,
  and reuses the GitHub delivery ID as the sync idempotency key. Installation,
  repository-selection, and repository lifecycle events are completed before
  acknowledgement so GitHub receives a 5xx and redelivers after a transient
  failure.
- Push delivery recovery stops after five attempt-fenced claims. Operators can
  inspect the retained error code without any webhook body or provider token
  being stored.
- Google Drive remains planned and is not implied by this GitHub beta.

Authorization receipts can be inspected at
`GET /api/v2/authorization-receipts`; the unified event history is available at
`GET /api/v2/provenance-events`.
