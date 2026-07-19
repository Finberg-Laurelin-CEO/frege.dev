# API V2 control-plane technical preview

Status: available as an additive technical preview. It does not change the availability or compatibility of `/api/v1`, and access to beta integrations remains explicitly allowlisted.

This slice introduces explicit principals, scoped delegated credentials, immutable policy versions, authorization receipts, and a unified provenance read model. The separately documented [governed GitHub connector beta](GITHUB_CONNECTOR_BETA.md) is the first integration built on these controls. This preview does not add tasks, approval workflows, or a multi-step runtime.

## Core resources

### Principal

A principal is an organization-scoped identity with one of three types:

- `human`: requires `subject_user_id` for an active member of the organization.
- `agent`: requires `subject_agent_id` for an agent definition in the organization.
- `service`: has no human or agent subject and represents a machine installation or backend service.

Human and agent subjects use a disable lifecycle rather than hard deletion so recorded decisions remain attributable. Principal slugs and subject links are unique within an organization.

### Policy version

A policy version is immutable and has:

- An organization, slug, and monotonically increasing version.
- A mandatory `default_decision` of `deny`.
- A strict array of allow or deny rules.
- A stable SHA-256 digest of the canonical rule document.

Rules may match principal types or IDs, actions, resource types, and opaque resource IDs. Rules cannot accept content, prompts, paths, titles, trust labels supplied by a caller, or arbitrary conditions. Explicit deny overrides allow regardless of rule order.

Every organization receives `baseline` version `1`, which contains no rules and therefore allows nothing.

### Delegated credential

A V2 credential is bound to exactly one organization, principal, and immutable policy version. Its non-empty action scopes form a hard ceiling on the policy. A request is allowed only when both the credential scope and an allow rule match.

Credential scopes may be exact actions such as `source.read` or namespace wildcards such as `connector.*`. A global `*` credential scope is rejected. Raw credentials use the `frg_v2_` prefix, are disclosed once, and are stored only as a domain-separated salted hash.

Publishing a new policy version does not silently rebind existing credentials. An administrator must issue a credential against the intended version and revoke the prior credential.

### Authorization receipt

Every authenticated policy decision records a receipt containing only:

- Principal, credential, and organization IDs.
- Action and an opaque resource type/ID reference.
- Allow or deny decision and stable reason code.
- Exact policy ID, slug, version, digest, and matching rule ID when present.
- Request and correlation IDs plus creation time.

The authorize request schema does not accept resource content or arbitrary attributes. A denial therefore cannot return restricted source content discovered by Frege. Invalid, revoked, or expired credentials fail authentication and do not receive policy details.

### Provenance event

V2 writes canonical events to `provenance_events`. `unified_provenance_events` presents those records together with content-free projections of the existing V1 telemetry and audit streams. Legacy metadata is intentionally excluded from the projection because it predates V2 disclosure rules and may overlap between streams.

## Policy rule contract

```json
{
  "id": "allow-github-sync",
  "effect": "allow",
  "principal_types": ["service"],
  "principal_ids": ["optional-principal-uuid"],
  "actions": ["connector.sync", "source.read"],
  "resource_types": ["connector_installation", "brain_source"],
  "resource_ids": ["optional-opaque-resource-id"]
}
```

`principal_types`, `principal_ids`, and `resource_ids` are optional. `actions` and `resource_types` are required and non-empty. `*` is supported in policy rules; a suffix wildcard such as `connector.*` respects namespace boundaries and does not match `connectorx.sync`.

The evaluation order is:

1. All organization IDs and the credential-to-principal binding must agree.
2. Organization, principal, credential, and concrete human/agent subject must be active.
3. The credential must be inside its `not_before` and `expires_at` window.
4. A credential action scope must match.
5. The policy must be default-deny, schema-valid, and match its stored digest.
6. Any matching deny rule wins.
7. Otherwise, a matching allow rule permits the action.
8. No matching allow rule is denied.

## HTTP endpoints

Administrative endpoints use the existing browser session and require an owner or administrator for the selected `org_slug`. Mutations additionally require an active organization, a verified user, and same-origin browser protection, except credential revocation: an authenticated owner or administrator may revoke a credential immediately even when normal activation gates are unavailable.

### Principals

`GET /api/v2/principals?org_slug=acme`

`POST /api/v2/principals`

```json
{
  "org_slug": "acme",
  "principal_type": "service",
  "slug": "github-sync",
  "name": "GitHub synchronization"
}
```

Human creation requires `subject_user_id`; agent creation requires `subject_agent_id`.

### Policy versions

`GET /api/v2/policies?org_slug=acme`

`POST /api/v2/policies`

```json
{
  "org_slug": "acme",
  "slug": "github-connector",
  "expected_current_version": 0,
  "rules": [
    {
      "id": "allow-github-sync",
      "effect": "allow",
      "principal_types": ["service"],
      "actions": ["connector.sync", "source.read"],
      "resource_types": ["connector_installation", "brain_source"]
    }
  ]
}
```

`expected_current_version` is optional optimistic concurrency. A mismatch returns `409 policy_version_conflict`.

### Delegated credentials

`GET /api/v2/credentials?org_slug=acme&principal_id=PRINCIPAL_UUID`

`POST /api/v2/credentials`

```json
{
  "org_slug": "acme",
  "principal_id": "00000000-0000-4000-8000-000000000001",
  "policy_version_id": "00000000-0000-4000-8000-000000000002",
  "name": "GitHub synchronization",
  "scopes": ["connector.sync", "source.read"],
  "expires_at": "2027-01-01T00:00:00.000Z"
}
```

The `201` response contains `raw_credential` exactly once. Listing never returns a hash or raw credential.

`DELETE /api/v2/credentials/CREDENTIAL_ID?org_slug=acme` revokes a credential. `PATCH` is an equivalent compatibility alias for revocation.

### Credential identity

`GET /api/v2/me` with `Authorization: Bearer V2_CREDENTIAL` returns the organization, explicit principal, scoped credential metadata, and pinned policy identity/digest. It does not return policy rules or credential hashes.

### Authorization

`POST /api/v2/authorize` with `Authorization: Bearer V2_CREDENTIAL`

```json
{
  "action": "source.read",
  "resource": {
    "type": "brain_source",
    "id": "source-17"
  },
  "correlation_id": "00000000-0000-4000-8000-000000000003"
}
```

Allow returns HTTP `200`; deny returns HTTP `403`. Both contain `authorization_receipt` and the response includes `X-Frege-Correlation-ID`. The endpoint evaluates an opaque organization-local reference; it does not fetch or return the resource.

### Evidence reads

- `GET /api/v2/authorization-receipts?org_slug=acme`
- `GET /api/v2/provenance-events?org_slug=acme`

Both are administrator-only, tenant-filtered, bounded to 200 results, and send `Cache-Control: no-store`. Receipt filters include decision, principal, correlation, and time. Provenance filters include source, action, outcome, correlation, and time.

## Server integration API

Stable primitives live in `lib/v2/control-plane.ts`:

- `ensureServicePrincipal({ orgId, slug, name, createdByPrincipalId? }, sqlOverride?)`
- `authenticateV2Credential(req, sqlOverride?)`
- `loadInternalV2CredentialAuth({ orgId, credentialId, principalId }, sqlOverride?)`
- `authorizeAndRecordV2Action({ auth, action, resource, requestId?, correlationId?, req? }, sqlOverride?)`
- `recordAuthorizationDecision(input, sqlOverride?)`
- `appendProvenanceEvent(input, sqlOverride?)`

Pure matching and digest helpers live in `lib/v2/policy-engine.ts`.

`loadInternalV2CredentialAuth` exists for server-managed credentials whose raw token was discarded. Its three selectors must come only from trusted, persisted, same-tenant foreign keys, never directly from request JSON, query parameters, or webhook payloads. The loader independently verifies organization/principal/credential status, subject liveness, validity window, default-deny policy shape, and policy digest before returning context.

Resource-owning integrations must load the resource from storage first and pass its stored `orgId` to `authorizeAndRecordV2Action`. Passing the caller's organization assertion defeats the tenant check and is unsupported.

## V1 compatibility

- No V1 table, route, role, API-key format, response, CLI command, or MCP contract is changed.
- V1 keys are not silently treated as V2 delegated credentials.
- Existing V1 telemetry and audit tables remain writable exactly as before.
- V2's unified read view projects safe legacy fields without mutating or deleting V1 records.
- No V1 retirement or deprecation is implied by this technical preview.
