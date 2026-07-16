# Security Policy

Frege takes reports about the hosted service and the current published Frege
CLI seriously.

## Supported versions

Security fixes are applied to the hosted Frege service and, when applicable,
the latest version of `@frege-dev/cli`. Older CLI releases, repository
checkouts, and modified or self-hosted deployments are not supported versions.

## Report a vulnerability privately

Do not open a public issue or discussion for a suspected vulnerability.

Email [security@frege.dev](mailto:security@frege.dev) with the subject
`Security report`. Include only what is needed to investigate:

- The affected URL, component, or CLI version.
- The security impact you believe is possible.
- Reproduction steps or a minimal proof of concept.
- Relevant request IDs, timestamps, and redacted logs.
- A safe way to contact you for follow-up.

Do not include live API keys, passwords, provider credentials, session cookies,
customer content, or other people's personal data. If investigation requires
sensitive material, ask Frege to arrange an appropriate transfer method first.

Frege will make a reasonable effort to acknowledge the report, investigate it,
and coordinate remediation and disclosure. This policy does not create a bug
bounty, response-time guarantee, or authorization to access data or systems
beyond accounts and data you are permitted to test.

## Operational incidents

For an account compromise, exposed credential, or active service incident,
revoke affected keys where possible and contact
[security@frege.dev](mailto:security@frege.dev) immediately. Include the organization
name and approximate time of the incident, but do not send the exposed secret.
