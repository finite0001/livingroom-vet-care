# ezyVet clinical migration into Living Room Vet

Status: phase1 implemented with local verification and green PR106 CI; phase2 is implemented with local verification and pending PR CI, and phase3/commissioning remain unfinished. Planning baseline: PR104, `c85b5f0`, migrations through4800. Phase2 implementation base: PR106, `e80cf62`, migrations through4900. Living Room Vet remains primary; ezyVet is a read-only import source. This plan preserves the full clinical migration scope and sequences implementation without treating manual originals or raw staging as a completed migration.

## Required outcome

An authorized operator imports the selected patient's clinical history, reviews source identity and discrepancies, and creates usable local history without overwriting local work or inventing diagnoses, signatures, vaccine details or prescription authority. Important reactions reach the existing clinical alert workflow. Source originals and all unresolved/rejected items remain discoverable. A supervised reconciliation proves what was and was not migrated.

## Evidence

- [Current official contract audit](research/source-contracts.md).
- [Existing staged adapter](../../docs/ezyvet-staged-import.md), [reviewed identity promotion](../../docs/ezyvet-reviewed-promotion.md), [weight import](../../docs/ezyvet-reviewed-weights.md), [manual originals](../../docs/plans/ezyvet-historical-records.md).
- At the planning baseline, the adapter staged consult/history/vaccination generically, and history incorrectly inherited the generic50-record request limit. PR106 now enforces patient-scoped consult/history runs and the documented history limit10. Staging still does not establish clinical semantics or complete migration; vaccination remains subsequent work.
- Native SOAP signing attributes the local signer and current time. External history cannot be passed through that operation as if originally signed here.

## Phases and implementation order

1. [Patient-scoped clinical API ingestion](phase-01-patient-scoped-ingestion.md) — implemented with local evidence and green PR106 CI. Correct history bounds; tie consult/history runs and every stored page to an approved patient mapping, preserve leases/recovery, and expose the bounded workflow in the administrator page.
2. [Reviewed history and actionable diagnoses/reactions](phase-02-reviewed-chart-history.md) — implemented and locally verified; PR CI pending. Immutable imported-history representation plus explicit locally authored create/link decisions for native problems, source discrepancy handling, clinical alerts and frozen-release provenance.
3. [Vaccinations, prescriptions, attachments and migration reconciliation](phase-03-complete-migration.md) — required subsequent work. Do not omit these resources from completion because phase1/2 passes.

Use separate owned worktrees for database, adapter/runtime and UI once a phase contract is frozen. Root integrates, runs combined checks and stacks draft PRs. Do not merge main, commission provider reads, change hosted schemas or create clinician approval during local implementation.

## Completion requirements

- [ ] Patient/source/site identity is enforced in the adapter and SQL, including every continuation and every promoted relationship.
- [ ] Imported history remains readable with original source fields and separate local review attribution; unsupported history categories and dates are not guessed.
- [ ] Reviewed diagnoses and important reactions create/link exactly once and become visible in booking/treatment alerts, while preserving local edits.
- [ ] Vaccine history and due information have explicit reviewed product/patient/date mappings; imports never decrement stock or create charges.
- [ ] Prescription history preserves outside prescriber and instructions without creating a new local prescription authorization or refill approval.
- [ ] Source attachments are retrieved through an approved transport contract, privately stored and bound to reviewed source bytes.
- [ ] Repeated scans, corrections, inactive records and missing observations generate reconciliation work rather than silent overwrite or deletion.
- [ ] Frozen record exports disclose imported provenance and remain compatible with all previously issued snapshots.
- [ ] Real authorized ezyVet sample/contract checks, supervised migration reconciliation and Dr. Susan Edler's clinical acceptance pass before commissioning.

## Open external evidence

Practice ezyVet API entitlement/account status and authorized sample data remain unanswered. Public documentation supports implementation of explicit read contracts, but does not establish actual site access, history-category semantics, completeness, source signature authenticity or timezone interpretation. Keep these gates open; do not request credentials in chat. Antech and the undecided anesthesia system remain independent launch workstreams.
