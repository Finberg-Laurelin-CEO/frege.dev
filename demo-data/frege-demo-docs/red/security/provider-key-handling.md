# Provider Key Handling

This page is red-zone security guidance for model provider credentials. Agents with green-only roles must not receive provider keys, raw environment values, or screenshots that expose secret material.

## Rules

- Store provider keys only in approved secret stores or production environment variables.
- Do not place provider keys in Frege pages, agent prompts, MCP config, or support tickets.
- Rotate provider keys after accidental exposure, owner changes, or model gateway migration.
- Redact keys in telemetry, memory proposals, context packets, and session events.
- Prefer per-environment keys over shared organization-wide credentials.

## Incident Response

If a provider key appears in a transcript or page, revoke the key, create a replacement, update the model config, and record the incident in the audit log. Do not ask an agent to summarize the leaked value.
