# Hermes Monitoring Policy - Frege Signups

Last updated: 2026-06-08.

Frege signup monitoring uses app-side signals, not direct database access.

## Signals

- Immediate signup event: `frege.signup.created`
- Scheduled stats event from Vercel Cron: `frege.signup.stats.snapshot`
- Protected stats endpoint: `GET https://frege.dev/api/admin/frege-signup-stats`

## Signup Event

```json
{
  "event": "frege.signup.created",
  "created_at": "2026-06-08T00:00:00.000Z",
  "signup": {
    "id": "uuid",
    "name": "Jane Smith",
    "work_email": "jane@example.com",
    "company": "Example Co",
    "role": "CTO",
    "company_size": "51-200",
    "expected_users": 25,
    "current_agent_tools": ["Codex", "Claude Code"],
    "other_tool": "",
    "monthly_ai_spend": "$2,000-$10,000",
    "willing_to_pay": "$500-$2,000 / mo",
    "decision_timeline": "30 days",
    "main_pain_point": "We need agents to use current internal context safely.",
    "other_comments": ""
  }
}
```

## Stats Event

```json
{
  "event": "frege.signup.stats.snapshot",
  "created_at": "2026-06-08T00:00:00.000Z",
  "stats": {
    "total_signups": 0,
    "signups_last_8h": 0,
    "signups_last_24h": 0,
    "latest_signup_at": null,
    "latest_signups": []
  }
}
```

## Alerting Guidance

Treat every signup row as a plausible human lead. Frege already applies the
form validation, honeypot, dwell-time, and database dedupe checks before a row
exists.

Notify Joe immediately when a signup has at least one high-signal field:

- `willing_to_pay` is `$500-$2,000 / mo` or higher.
- `expected_users` is at least 50.
- `company_size` is `201-1000` or `1000+`.
- `decision_timeline` is `Now`.
- `current_agent_tools` includes `Internal agent`.
- The company or pain point appears strategically important.

Use stats snapshots and the protected stats endpoint to detect missed webhook
delivery, volume spikes, and daily rollups.
