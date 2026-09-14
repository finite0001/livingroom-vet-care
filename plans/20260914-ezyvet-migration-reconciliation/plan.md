# Supervised ezyVet migration reconciliation

Status: planned; not implemented or commissioned. Baseline `b585f47`; staging has99 canonical migrations. This completes the orchestration/reconciliation requirement in [phase3](../20260913-ezyvet-clinical-import/phase-03-complete-migration.md). Individual import/review/release workflows are implemented; their success is not whole-migration acceptance.

## Required result

An active administrator defines an explicit source site, approved households/patients and resource coverage; resumes existing resource work; sees exact source versions and reviewed outcomes; resolves or explicitly records exclusions; and produces a frozen reconciliation report for supervised acceptance. Local clinical records, signatures, prescribing authority, stock, invoices and outgoing messages remain governed by their existing separate workflows.

## Implementation sequence

1. **Run identity and recovery — pending.** Add immutable run/scope/binding records and narrow owner RPCs. Bind existing child runs without invoking providers or changing child ownership/leases. Prove actor/site/patient/resource validation, retries and post-wait role checks.
2. **Reconciliation projection — pending.** Inventory source occurrences and distinct versions from existing ledgers, join exact review/capture references, and expose bounded drill-down with explicit coverage gaps and stale evidence. Add append-only nonclinical resolution records and frozen report requests.
3. **Operator UI and orchestration — pending.** Add a migration workspace within the existing ezyVet tool. Preserve existing controls and draft guards. Open/resume the exact bound resource workflow using its existing API; support server recovery after browser state loss. No new background scanner.
4. **Acceptance and rollout — pending.** Exercise interrupted multi-resource runs, concurrent ownership/source changes, corrections and omitted pages; include populated backup/restore. Then deploy a matching staging database/functions/frontend increment and perform signed-in supervised acceptance with approved samples.

Existing schema/status/currentness evidence: [ledger map](ledger-map.md).

Detailed data/API/security/count contracts and executable acceptance cases: [implementation contract](implementation-contract.md).

## Decisions

- Reuse per-resource run/page/review/capture ledgers. A second import engine would duplicate leases and potentially scan the same source concurrently.
- Persist scope and bindings; derive live child status. A client-only dashboard cannot recover ownership or prove the reviewed manifest after browser data is lost.
- Freeze reports independently of live source status. Preserve prior evidence while exposing later changes; never silently rewrite an accepted report.
- A provider `review_ready` status means page traversal ended. It does not certify source consistency, full resource coverage or clinical approval.
- Rejected/skipped items require exact identity and reason. They remain visible and are never relabeled imported.

## Completion gates

- [ ] Every manifest scope has exact source origin/site, parent/mapping identity and declared required/explicitly excluded disposition.
- [ ] Child bindings recover by server identity and use existing single-resource leases/cooldowns.
- [ ] Counts and drill-down reconcile without conflating occurrences, distinct versions and local records.
- [ ] Interrupted scans, changed heads, local edits and corrections remain actionable; absence is not deletion.
- [ ] Reviewed frozen report binds exact manifest, child coverage and decision versions; fresh acceptance rejects stale evidence.
- [ ] Desktop/mobile workflows retain existing routes, controls and draft protection.
- [ ] SQL/concurrency/local Auth+Storage/browser/populated-restore checks cover the same new migration stack.
- [ ] Authorized practice samples, source/export strategy, Dr. Susan Edler review and owner cutover acceptance are recorded separately.

## External dependencies

Supported Consult/Contact attachment contracts and practice entitlement; source timezone/status/category semantics; catalog/prescriber mappings; source freeze/overlap strategy; supervised subset and cutover window. These block source commissioning, not the independent ledger/recovery implementation. Fastmail/Auth SMTP, Stripe, Antech/anesthesia, inventory balances, monitoring, branding and public cutover remain separate commercial requirements.

## Next concrete increment

Implement phase1 against the current canonical branch with the next verified unused additive migration version. Before reserving a version, inspect local files and hosted ledger again. Update exact migration-count/hash fixtures deliberately; never relax their canonical-stack checks to accept arbitrary versions. No scope backfill from unreviewed historical runs.

Planning environment: optional codebase-summary/development-rules/code-standards/design-guidelines files and active-plan helper scripts are absent. Existing AGENTS.md, source contracts and current ledgers are authoritative. No new vendor API contract is asserted by this plan.
