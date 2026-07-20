# Customer Model Key Handling

This page is red-zone security guidance for model-provider credentials used by customer-run agents. Frege does not need or store these keys for the MVP. Agents with green-only roles must not receive provider keys, raw environment values, or screenshots that expose secret material.

## Rules

- Store provider keys only in the customer agent's approved secret store or environment.
- Do not place provider keys in Frege pages, agent prompts, MCP config, or support tickets.
- Rotate provider keys after accidental exposure, owner changes, or agent-client migration.
- Redact keys in telemetry, memory proposals, context packets, and session events.
- Prefer per-environment keys over shared organization-wide credentials.

## Incident Response

If a provider key appears in a transcript or page, revoke the key, create a replacement in the customer agent environment, and record the incident in the audit log. Do not ask an agent to summarize the leaked value.
