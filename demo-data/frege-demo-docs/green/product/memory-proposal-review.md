# Memory Proposal Review Guide

Agents should propose durable memory changes instead of editing canonical pages directly. A proposal is a review queue item that captures what the agent learned, where it came from, and what page it wants to create or update.

## Review Checklist

- Confirm the proposal cites a source page, session, or external artifact.
- Check whether the proposed trust zone is correct.
- Reject content that includes secrets, private customer details, or unsupported claims.
- Prefer small page updates over broad rewrites.
- If a proposal duplicates an existing page, merge the useful detail into the current page and reject the duplicate.

## Decision Outcomes

Accept proposals that improve current operating knowledge and are safe for the proposed trust zone. Reject proposals that speculate, leak restricted context into green-zone pages, or turn one-off task notes into permanent policy.

## Agent Feedback

When rejecting, leave a short reason the agent can learn from: missing citation, wrong trust zone, duplicate page, or not durable enough.
