# Positioning & Differentiation Feedback — 2026-06-22

## Source feedback (verbatim intent)
A reviewer looking at frege.dev for the first time said:

> "This website tries to tell me what it is. My first thought is that there are
> already memory systems built into various agent systems, and a lot of times you
> can just roll your own in CLAUDE.md by telling it what files to use to keep track
> of context. So to feel like this is a differentiated product that either improves
> quality or saves time, I would really need to see a video of it in action, and it
> would need to make me think: *wow, I want that*. It's also really unclear who the
> ICP is."

## What this tells us (the three real problems)

1. **No proof of value.** The site asserts capabilities but never *shows* the product
   doing something a person couldn't trivially do themselves. No video, no demo, no
   before/after.

2. **No differentiation vs. the free default.** The obvious competitor isn't another
   vendor — it's "just use CLAUDE.md / built-in agent memory for free." The site never
   names or beats that alternative.

3. **No ICP.** It's unclear who this is for (solo dev? platform team? regulated
   enterprise? AI agent startup?). Without an ICP, the value prop can't land because
   the reader can't self-identify.

## Why the current site triggers this reaction
- Hero leads with *what it is* ("The company brain for AI agents") not *who it's for*
  or *what painful thing it removes*.
- The body is a capability list (governed memory, MCP-native, context packets, trust
  zones, runtime routing, observability) — features, not outcomes.
- Nothing demonstrates the product. First-time readers can't see it work.
- No comparison to the "roll your own in CLAUDE.md" baseline.

## The core differentiation argument (what we should actually claim)
CLAUDE.md / built-in memory works fine for one person on one repo. It breaks down when:
- **Multiple agents/people** need the *same* knowledge and it drifts out of sync.
- **Not everyone should see everything** (trust zones, role-scoped access, audit).
- **Agents shouldn't silently rewrite canonical knowledge** (reviewable proposals).
- **You need to know what the agent read/was denied** (observability, audit, cost).

So Frege is not "memory" — it's **governed, shared, auditable** memory for teams running
multiple agents. That's the wedge. The site must make this contrast explicit, and it
must be true for a clearly named ICP.

## Plan (priority order)

### P0 — Name the ICP and rewrite the hero around a painful outcome
- Pick ONE primary ICP for the pilot. Candidate: *teams running AI agents against
  shared company knowledge who need access control + auditability* (platform/AI teams
  at 20–200 person companies). Validate against who we actually want in the pilot.
- Rewrite hero: lead with the ICP + the pain removed, not "what it is."
- Replace the capability dump with 3 outcome statements.

### P0 — Show it working (the "wow, I want that" moment)
- Record a 60–90s demo video: an agent asks for something, Frege returns scoped, cited
  context, a restricted source is denied, and a discovery becomes a reviewable proposal.
- Embed it above the fold. This is the single highest-leverage change.
- Interim if video isn't ready: an animated/stepped terminal transcript of the same flow.

### P0 — Add an explicit "vs. CLAUDE.md / built-in memory" section
- Honest comparison table: solo CLAUDE.md vs Frege across shared knowledge, access
  control, audit, reviewable writes, multi-agent, drift.
- Be fair: say when CLAUDE.md is the right choice. Credibility sells the wedge.

### P1 — Quantify quality/time savings
- Add a concrete before/after or a measurable claim we can stand behind (e.g. "agents
  stop reading the wrong doc," "no more pasting the same context into every session").
- Source real numbers from pilot usage once we have it.

### P1 — Publish the architecture page on the site
- `docs/HOSTED_BRAIN_ARCHITECTURE.md` exists but isn't on the public site. A linked
  architecture/explainer page supports buyers who need to trust the model.

### P2 — ICP-specific proof
- One short use-case page for the chosen ICP with a realistic scenario.

## Open questions for the founder
- Who is the ONE pilot ICP we optimize the homepage for?
- Can we produce a demo video this week, or do we ship the animated transcript first?
- What is the one measurable outcome we're confident claiming today?

## Status
Captured as feedback + plan. No site copy changed yet — pending ICP decision, because
the hero rewrite and the comparison section both depend on which ICP we commit to.

## DEFERRED — revisit before any homepage rewrite
These are intentionally parked. Do NOT rewrite hero/comparison copy until answered:
- [ ] Which ONE pilot ICP do we optimize the homepage for?
- [ ] Demo video this week, or ship animated terminal transcript first?
- [ ] What single measurable outcome are we confident claiming today?

Owner: founder. Surfaced again at next positioning session.
