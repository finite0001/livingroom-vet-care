# Supervised ezyVet migration reconciliation

Status: phase1 manifest and child-binding foundation implemented locally; later phases remain pending. Baseline `b585f47`; staging has99 canonical migrations and the local candidate has101. This plan addresses the orchestration/reconciliation requirement in [phase3](../20260913-ezyvet-clinical-import/phase-03-complete-migration.md). Individual import/review/release workflows are implemented; their success is not whole-migration acceptance.

## Required result

An active administrator defines an explicit source site, approved households/patients and resource coverage; resumes existing resource work; sees exact source versions and reviewed outcomes; resolves or explicitly records exclusions; and produces a frozen reconciliation report for supervised acceptance. Local clinical records, signatures, prescribing authority, stock, invoices and outgoing messages remain governed by their existing separate workflows.

## Implementation sequence

1. **Run identity and recovery — in progress.** Local migration `20260914130000` adds immutable manifest/scope records and owner-only create/read/keyset-list RPCs. Exact retries recover historical scope after parent-head changes. Populated local backup/restore preserves one manifest and three Animal/Consult/Prescription scopes alongside clinical and physical Storage evidence. Migration `20260914140000` adds immutable child bindings, explicit predecessor recovery and bounded owner history without changing child runs. The client API layer validates returned owner/scope identities and microsecond history cursors. Actual local Auth/PostgREST checks exercise recovery, authorization and lost replies; a separate digest of resolved scope receipts remains pending. Bind existing child runs without invoking providers or changing child ownership/leases. Prove actor/site/patient/resource validation, retries and post-wait role checks.
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

Finish the phase1 resolved-scope digest, then implement reconciliation projections against the current canonical branch. The manifest candidate is local only; do not infer a hosted deployment from passing local SQL checks. Before reserving another version, inspect local files and hosted ledger again. Update exact migration-count/hash fixtures deliberately; never relax their canonical-stack checks to accept arbitrary versions. No scope backfill from unreviewed historical runs.

Planning environment: optional codebase-summary/development-rules/code-standards/design-guidelines files and active-plan helper scripts are absent. Existing AGENTS.md, source contracts and current ledgers are authoritative. No new vendor API contract is asserted by this plan.

Local foundation acceptance: [SQL/concurrency and populated restore receipt](../../docs/evidence/canonical-migration-manifest-foundation-20260914.json). This is not hosted or provider commissioning.

Local child-binding acceptance: [nine resource families, concurrency and populated restore](../../docs/evidence/canonical-migration-child-bindings-20260914.json). Staging ledger was rechecked at99 migrations; both candidates remain local.

Client and runtime acceptance: [43 real Auth/PostgREST migration checks, 351 combined runtime checks and 552 unit tests](../../docs/evidence/canonical-migration-auth-runtime-20260914.json). The new API layer is ready for later interface composition; no migration UI is claimed.
