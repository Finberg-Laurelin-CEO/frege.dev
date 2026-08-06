# Frege Support

Frege supports the hosted Frege service and the current published version of
`@frege-dev/cli`.

## Get help

- Use the [Frege support page](https://frege.dev/support) when signed in.
- For account, access, billing, or general product help, email
  [hello@frege.dev](mailto:hello@frege.dev).
- Report product bugs through the [public bug-report form](https://frege.dev/report-a-bug)
  or email [bugs@agents.frege.dev](mailto:bugs@agents.frege.dev).
- For a suspected vulnerability, follow [`SECURITY.md`](SECURITY.md) instead of
  filing a public issue.

Include the organization name, the affected feature, the time the problem
occurred, and the CLI version from `npm list -g @frege-dev/cli` when relevant.
Share request IDs and redacted error output if available.

Never send API keys, passwords, provider credentials, session cookies,
confidential customer content, or unredacted environment files. Frege support
will ask for a safer transfer method if sensitive diagnostic material is
necessary.

## Bug form delivery and privacy

The public form posts to a server route on frege.dev. The server validates the
report and sends it as a plain-text email to `bugs@agents.frege.dev` through
[AgentMail](https://agentmail.to), the email provider for the agents.frege.dev
domain. AgentMail processes the report content as a third party. The server
sends only the form fields. It does not attach IP addresses or browser
metadata to the email. Rate-limit counters store a salted hash of the client
IP, never the raw IP.

The AgentMail credential is the server-only environment variable
`AGENTMAIL_BUG_REPORT_API_KEY`. The key can only send mail to that inbox. It
cannot read mail. No mail credential belongs in browser code or in the
repository. If the variable is not set, the form returns a clear error and the
`mailto:` fallback stays available.

## Support boundaries

The public repository is source-visible for product transparency. It is not a
supported self-hosting distribution, and public visibility does not grant a
license to modify, redistribute, or operate the software.

Frege does not guarantee support response times through this repository or by
general email. Any response commitments in a written customer agreement take
precedence.
