# Context Gateway Contract

The context gateway returns a governed packet of documents, chunks, concepts, links, source IDs, trust-zone metadata, and denied counts. Every packet is scoped to the organization attached to the session or API key.

## Required Behavior

- Derive org identity from the actor, never from client input.
- Include only documents allowed by the actor role.
- Include denied counts without leaking restricted source titles.
- Preserve selected chunks and token estimates for the customer agent's context budget.
- Record telemetry for successful builds, empty builds, and denied context.

## Agent Protocol

Agents should call `frege_build_context` before answering from Frege memory. Agents should cite source slugs from the packet and should not read the database directly.
