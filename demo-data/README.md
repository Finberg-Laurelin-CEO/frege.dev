# Synthetic Demo Data

Everything under `demo-data/frege-demo-docs/` is fictional fixture content used
to exercise document ingestion, search, sensitivity labels, and trust-zone
denials.

- `green/` contains public or internal-style examples available to ordinary
  demo roles.
- `red/` contains restricted-style examples used to verify access denial.

These files are not production runbooks, customer records, pricing promises, or
security policy. Do not add real customer names, credentials, live incident
details, internal account identifiers, or private company documents here.

The public docs manifest does not sync these fixtures. Tests and local demo
seeding may load them explicitly when needed.
