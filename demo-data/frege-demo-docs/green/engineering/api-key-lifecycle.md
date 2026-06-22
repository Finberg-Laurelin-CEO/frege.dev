# API Key Lifecycle

Frege API keys are scoped credentials for agents and automation. Every key belongs to one organization, one role, and one human owner. This lets audit logs explain both what an agent did and who was responsible for the credential.

## Create

Create keys from the admin console after the role exists. Use narrow labels for the first key, then widen only when the agent proves it needs more context. Name keys after the agent and environment, such as `codex-prod-support` or `claude-design-review`.

## Store

Store the raw key in the agent host's secret store or connect it with `frege connect`. Do not paste the key into docs, issues, pull requests, or MCP JSON unless there is no local command runner.

## Rotate

Rotate a key when an owner changes teams, a role changes materially, a machine is rebuilt, or a transcript exposed the raw key. Create the replacement key first, update the agent host, run `frege doctor`, then revoke the old key.

## Revoke

Revoke keys immediately when they are no longer used. Revocation should be visible in audit events and the key should stop passing `frege_brain_status`.
