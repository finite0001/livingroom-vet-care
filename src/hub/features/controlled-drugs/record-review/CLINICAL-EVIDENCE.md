# Clinical component and available-stock evidence

This local prospective checker extends the existing receive/adjust graph checks
to the two canonical clinical writers. It does not grant access, install backend
functions, enable signing or establish full database membership/authorization.

The treatment and anesthesia JSON fixtures are verbatim detail responses 26 and
29 from the closed clinical V7 engineering run on PostgreSQL 17.6. The complete
local run passed genuine password sessions, both canonical writers, independent
review/recovery, exact metadata, audit and permanent-row accounting, with normal
owned cleanup. Every identity and clinical fact in these fixtures is synthetic.
The fixtures contain no passwords or access tokens.

| Fixture | SHA-256 |
| --- | --- |
| `tests/controlled-drugs/record-review-treatment-reference.json` | `9086650ad5aca4a589c0207a12c9866d52613ec186292fa47239f2fafc3ac91a` |
| `tests/controlled-drugs/record-review-anesthesia-reference.json` | `d878d7d16b2c1b3bdf828f886229135cfe12361e525aebcbaff8abb1a57c65c1` |

The fixed backend manifest was
`8bda27cd5f9466c455ec2a4776dd60e3e719bd6027a7bf1ab87f9a6cff00a774`;
its captured-source profile was
`509e5cc0832eb12e31893210ae1f705f05c57769f0d44feaabb183b7e9b29c63`.
Independent review of the actual run was
`0bfaab37cf6513c0953ce1df3051bda0bf0d6fb3e2be8d914b5b0b5638d244a3`.
These hashes identify retained local evidence, not a reproducible proof capsule
included in this change or production certification.

The effective canonical writer bodies are the original migration functions
`record_patient_treatment` and `record_anesthesia_drug_administration`. Selected
`controlled_stock_expected` and preparation functions preserve a clinical
quantity's original numeric scale; context split strings remain independently
validated by `controlled_stock_decimal`. The alert snapshot derives from
`20260913260000_treatment_alert_review.sql`'s
`read_patient_treatment_alerts`, effective body SHA-256
`1bddc91dc6df121b2a99cdce805267fe607b1356f4e43705366688f38c7a1bd2`.
The additional snapshot component API reuses the private PostgreSQL JSONB text
codec, with a one-MiB component ceiling and exact snapshot keys. It does not hash
whole packets.

Adverse tests recompute all supplied component commitments after each mutation.
They test semantic cross-bindings rather than relying on an old hash to detect
changed data. Synthetic positive variations establish only the declared client
grammar; they are not additional observed database executions.

Remaining separate obligations include full backend and transport admission,
historical/current policy selection, every native source family, nullable
read-only packets, authenticated clinical browser execution and physical
commissioning. The staff workspace remains unmounted by this change.
