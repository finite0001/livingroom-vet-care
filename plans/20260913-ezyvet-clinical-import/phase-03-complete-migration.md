# Phase3 — Remaining clinical resources and complete migration

Priority: required for full requested ezyVet migration. Status: unimplemented; resource-specific design and account evidence required. Phases1/2 cannot substitute for this scope.

Next bounded implementation: [Phase 3a — consult-scoped vaccination intake](phase-03a-vaccination-intake.md).

## Vaccinations and due dates

Resolve every vaccination through its same-site consult and approved patient mapping; validate product references against a reviewed catalog mapping. Retain original source values plus explicit reviewed administration and due dates. Preserve unknown lot, manufacturer, route, dose and issuer details rather than fabricating certificate eligibility. Reuse historical treatment semantics only after its required fields can be legitimately supplied. An import must never decrement stock, bill the client or assert a vaccine was administered locally. A source next-date is historical evidence; adoption into the active reminder plan requires an explicit clinician decision. Reconciliation must identify missing consults/products, duplicate administrations and conflicting dates. Certificate issuance remains the separately reviewed native workflow.

## Prescription history

Implement the documented prescription and prescription-item read contracts, approved patient/consult joins and explicit product mapping. Keep outside prescriber reference, prescribed date, instructions and quantity/remaining data as historical source values. Add a historical prescription representation rather than misusing refill requests or administration records. An import cannot grant a refill, authorize a new prescription, infer dose units, dispense inventory or create charges. Preserve discontinued/unknown statuses with reviewed interpretation. Any conversion to an active local prescription requires a distinct native prescribing workflow with the correct clinician authority; that is separate from historical import.

## Source attachments

Verify the official download endpoint, auth, redirects, maximum size and content/MIME behavior against authorized sample data. Bind each attachment to a reviewed same-patient parent (animal, consult or another explicitly supported type), source host/site/ID and observed version. Never fetch arbitrary source URLs or forward credentials across redirects. Stream within bounds, validate supported content, preserve exact original bytes in private Storage and record immutable SHA256 and source association. Reuse document access controls and reviewed source byte capture where the source contract truly matches; do not relabel an API attachment as a staff-obtained manual export. Partial uploads, lost responses and changed source bytes need durable recovery and cleanup. Verify disclosure/source binding in record releases and both delivery paths.

## Migration orchestration and reconciliation

Create an operator-owned migration run covering approved households/patients and explicit resource scopes. Retain durable per-resource checkpoints, observed pages, source versions, failures, skipped/unresolved items and reviewed resolutions. Respect shared provider cooldowns and bounded retry policy; do not spawn competing scans. Resume idempotently without overwriting local edits or treating absent pages as deletions. Report observed, staged, approved, linked, rejected, unresolved and failed counts separately, with drill-down records and exact source identity.

A page-complete scan is not a consistent source export. Establish an issued-site supported export/incremental strategy and cutover window; reconcile changing source records, duplicates, references and original-file hashes. Pilot synthetic then authorized trial data, followed by a supervised practice subset. Confirm backups/restore, source freeze or overlap handling, operator ownership and rollback/recovery before the full migration. Existing Lovable-to-dedicated-backend migration is a separate environment cutover and must not be conflated with ezyVet patient migration.

## Files and design deliverables

Base: `/Users/davidedler/livingroom-vet-ezyvet-clinical-plan`.

- Extend `supabase/functions/ezyvet-import/` only after each resource's read contract is frozen; add resource-specific tests under `tests/ezyvet/`.
- Create additive migrations, narrow RPCs and SQL/contention tests for vaccine/prescription promotion, API attachment receipts and migration-run reconciliation.
- Extend `src/hub/features/imports/` with resource review and migration dashboard; integrate historical views into the appropriate patient chart sections.
- Reuse `src/hub/features/treatments/`, document storage and care reminders through their existing validators. Do not couple historical imports to stock/billing or automatic sending.
- Update source-aware release projection/renderers with immutable compatibility tests as required, and extend `docs/clinical-review/` with synthetic representative cases.
- Root records the approved provider contract, actual sample evidence and sanitized migration reconciliation in a runbook. No credentials or patient samples in Git.

## Completion evidence

- [ ] Each supported resource has current primary-source documentation, authorized practice sample validation and explicit field/status/date/relationship mappings.
- [ ] Wrong-patient joins, missing references, malformed units/dates, inactive source and duplicate/correction scenarios are tested through actual local workflows and supervised source samples.
- [ ] Historical data produces no accidental native signature, prescribing authority, stock movement, invoice or outgoing message.
- [ ] All original files match their verified source bytes and remain private through restore and export.
- [ ] Repeated scans, interrupted imports, source changes and local edits preserve idempotency and produce complete discrepancy/reconciliation queues.
- [ ] Dr. Susan Edler approves clinical interpretation and disclosure; the owner approves the reconciliation and cutover scope.
- [ ] Actual authorized ezyVet migration acceptance passes with documented resource coverage and unresolved-item accounting. Complete migration is not claimed while any required resource or reconciliation evidence is missing.

## Open dependencies

Read-only API availability is the owner-approved implementation premise. Dr. Susan Edler is clarifying the existing entitlement with her representative; no ezyVet write-back is in scope. Live authentication and supported attachment/export contracts; actual site data and source date semantics; catalog/prescriber mappings; clinician approval; supervised cutover window. Continue independently implementable work while these remain pending, but keep commissioning disabled.
