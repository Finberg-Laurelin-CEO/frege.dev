# YC Application Video — "One Question, Fully Governed" (~60s)

Status: script approved 2026-07-09 (approach A + self-serve flash). Companion docs:
`LOOM_INVESTOR_DEMO_SCRIPT.md` (the longer 10-step Loom), `DEMO_OPERATOR_CHECKLIST.md`
(recording-day preflight — run it fully before this video too).

## The one takeaway

**Agents share one brain; humans govern it.** Every second shows product. The two
moments no markdown-folder workflow can imitate — the DENIED read and the
human-approved memory update — get the most screen time, inside one continuous,
visibly real scenario (our org, our repo's actual docs).

## Constraints

- ~60 seconds. Narration budget ≈ 130 words (spoken at a calm ~140 wpm).
- Voice-over screen capture. No slides, no b-roll, no music. Founder voice,
  plain delivery — YC's guidance is "show the product working, immediately."
- Screen: 1920×1080, terminal font ≥ 16pt, browser at 110–125% zoom. Hide
  bookmarks bar, notifications off (macOS Focus), clean desktop.
- Layout: single window at a time (full-screen terminal ↔ full-screen console).
  No split screen — text must stay readable on a partner's laptop.

## Shot list & narration

Total narration: 123 words. Times are targets; record segments separately and
stitch (see Recording plan) — do not chase one perfect take.

| # | Time | Screen | Action | Narration (verbatim) |
|---|------|--------|--------|----------------------|
| 1 | 0:00–0:08 | Terminal: Claude Code session, Frege MCP connected | Type the question: *"How should an agent install Frege MCP?"* and hit enter | "Every AI agent on our team shares one brain — governed. This is Frege. Watch our coding agent answer from it." |
| 2 | 0:08–0:20 | Terminal | Agent calls `frege_build_context`; scoped packet returns; agent answers **citing doc slugs** (visible in output) | "It asks Frege for context — and gets a scoped packet with citations. Not a folder of markdown files. These are our real docs, synced from our repo." |
| 3 | 0:20–0:32 | Terminal → Console (Access & trust zones) | Agent requests `security-provider-key-handling` → **denied/not-found**; cut to console access matrix showing the writer key's zones | "Now it asks for our provider-key runbook. Denied — that's red-zone, and this key doesn't hold it. Every read is scoped, and every read is attributable." |
| 4 | 0:32–0:46 | Terminal → Console (Knowledge → proposals) | Agent submits `frege_write_page_proposal` (a learned install-troubleshooting note); cut to console: pending proposal → click **Approve** → revision history updates | "When the agent learns something, it can't silently edit the brain. It proposes. I approve — and the memory updates, with full history." |
| 5 | 0:46–0:53 | Console (Activity/audit feed) | Scroll the feed showing today's rows: context build → denied read → proposal → approval, each attributed to the key/user | "One audit trail: read, denied, proposed, approved." |
| 6 | 0:53–0:58 | Browser: frege.dev/signup → console Billing (active org: invoices + "Manage subscription") | Two quick cuts, ~2.5s each | "Teams onboard themselves — sign up, pay with Stripe, connect their agents." |
| 7 | 0:58–1:00 | End card: landing-page hero (ASCII FREGE + tagline) | Static | "Frege — agent memory, governed." |

## Staging (deltas on top of DEMO_OPERATOR_CHECKLIST.md)

1. **Red-zone content live**: the two restricted docs from `frege.docs.yml`
   (`security-provider-key-handling`, `security-red-zone-handling`) synced with the
   **admin** key beforehand. Without them, beat 3 has nothing to deny.
2. **Green-only writer key** in the recording shell (`FREGE_API_KEY="$FREGE_WRITER_KEY"`):
   the admin demo key holds the restricted label, so the denial will NOT fire with it.
   Off-camera sanity check both: context question answers with citations; red doc read
   is denied.
3. **Pre-warm everything off-camera** right before recording: run the context question
   once (no cold-start lag on camera), have the console signed in as joe@frege.dev on
   brain.frege.dev, proposals view open in a second tab, billing view of the active
   demo org in a third.
4. **Pre-draft the proposal content** the agent will submit in beat 4 so the on-camera
   run is fast and the diff is small and legible.
5. **Billing beat**: use an org whose billing view shows the new active state (invoices
   table + Manage subscription) — any Stripe-activated org; verify the view renders
   before recording.
6. Key hygiene: if any raw key appears on screen in a take, rotate it before the video
   ships (checklist rule).

## Recording plan

- Record beats 1–2, 3, 4, 5, 6 as **separate clips**; stitch with hard cuts. Retake a
  beat, not the video. Aim for ≤ 3 takes per beat.
- Record narration **live with each clip** (not dubbed after) — it reads more real,
  and YC prefers real over polished.
- Trim dead time inside clips (agent thinking) with simple jump cuts; never speed up
  footage (looks fake).
- Watch the final cut once at laptop size with the sound off: if the DENIED moment and
  the Approve click aren't obvious without narration, re-frame those shots (zoom in).

## Deliberately left out (spine discipline)

Support tickets, lead scoring/monitoring, Clerk social sign-in and email sign-in links,
platform/staff console, agent runtime internals, architecture page. They exist and are
live — they're for the longer Loom and the interview, not these 60 seconds. The only
business-loop content is beat 6's five-second flash.

## Fallbacks

- Agent flaky on camera → beat 2 can use `frege context "…"` CLI output directly
  (same packet, same citations) and keep the Claude Code framing in narration.
- Proposal approve UI slow → pre-load the proposals view; the click and the revision
  bump are the only two things that must be seen.
- If total runtime lands over 60s, cut from beat 2 (citations can carry in 8s) and
  beat 5 (audit can be 4s) before touching beats 3–4 — the denial and approval ARE
  the video.
