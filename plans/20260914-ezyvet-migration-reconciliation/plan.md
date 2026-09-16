# Supervised ezyVet migration reconciliation

Status: phase1 recovery and the per-resource evidence workspace are deployed; phase2 whole-migration reconciliation remains in progress. Staging and primary have111 canonical migrations, with prescription-item evidence published at `f6e1db7`. See [rollout evidence](../../docs/prescription-item-rollout-20260915.md). Earlier local-only/99–110 migration statements below are historical checkpoints. This plan still requires identity/weight adapters, global outcomes, resolutions, frozen reports and supervised acceptance.

## Required result

An active administrator defines an explicit source site, approved households/patients and resource coverage; resumes existing resource work; sees exact source versions and reviewed outcomes; resolves or explicitly records exclusions; and produces a frozen reconciliation report for supervised acceptance. Local clinical records, signatures, prescribing authority, stock, invoices and outgoing messages remain governed by their existing separate workflows.

## Implementation sequence

1. **Run identity and recovery — implemented locally.** Local migration `20260914130000` adds immutable manifest/scope records and owner-only create/read/keyset-list RPCs. Exact retries recover historical scope after parent-head changes. Populated local backup/restore preserves one manifest and three Animal/Consult/Prescription scopes alongside clinical and physical Storage evidence. Migration `20260914140000` adds immutable child bindings, explicit predecessor recovery and bounded owner history without changing child runs. The client API layer validates returned owner/scope identities and microsecond history cursors. Actual local Auth/PostgREST checks exercise recovery, authorization and lost replies; migration `20260914150000` adds a versioned digest of the immutable resolved scope. The digest is derived by a fixed v1 algorithm during recovery rather than stored in a mutable cache. Hosted and operator acceptance remain pending. Bind existing child runs without invoking providers or changing child ownership/leases. Prove actor/site/patient/resource validation, retries and post-wait role checks.
2. **Reconciliation projection — in progress.** The local per-binding scan projection counts observations, distinct identities and distinct snapshots from each canonical ledger, and separates traversal, page limits, parent/household currentness and durable transactional attempt history with an explicit tracking origin. It explicitly leaves provider totals, clinical outcomes and complete-coverage acceptance unknown/unverified. Migration `20260914160000` records baseline/claim/failure/staging events atomically for canonical import runs, including work before binding, and exposes bounded owner-only event history. Existing runs receive a migration baseline with earlier history explicitly unavailable. The bounded item API now exposes mapping-source currentness and exact observation identities across all nine resources. Owned attachment capture evidence now matches exact source versions and distinguishes pending/captured requests, approval versions and canceled decisions. Approved history, vaccination and prescription-header receipt adapters now distinguish exact source context, later corrections and currentness. Other clinical adapters and global reconciliation totals remain pending. Add append-only nonclinical resolution records and frozen report requests.
3. **Operator UI and orchestration — in progress locally.** A read-only workspace is appended below the existing ezyVet tools. It discovers and reopens saved manifests/scopes/bindings, shows source progress and bounded item evidence, and links saved patient/household records. Actor and selection keys isolate late responses. Scope creation and existing-run binding are now composed with exact-request recovery and shared draft protection. Explicit saved-binding resume now reuses the existing importer with fresh recovery, cooldown/lease checks and per-request review. Resolutions and report review still need interface composition. Preserve existing controls and draft guards. Open/resume the exact bound resource workflow using its existing API; support server recovery after browser state loss. No new background scanner.
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

Extend phase2 with exact review/capture receipt adapters over the bounded source-item view, followed by operational resolutions and frozen reports. The core source-gate authorization gap was reproduced and corrected locally by migration `20260914170000`, together with terminal recovery checks in all six patient-scoped claim functions. Migration `20260914180000` extends the local candidate to staging replay/final returns and failure updates; observed contention verifies role revocation and transaction rollback. Broader reconciliation and operator acceptance remain separate from this authorization correction. The manifest candidate is local only; do not infer a hosted deployment from passing local SQL checks. Before reserving another version, inspect local files and hosted ledger again. Update exact migration-count/hash fixtures deliberately; never relax their canonical-stack checks to accept arbitrary versions. No scope backfill from unreviewed historical runs.

Planning environment: optional codebase-summary/development-rules/code-standards/design-guidelines files and active-plan helper scripts are absent. Existing AGENTS.md, source contracts and current ledgers are authoritative. No new vendor API contract is asserted by this plan.

Local foundation acceptance: [SQL/concurrency and populated restore receipt](../../docs/evidence/canonical-migration-manifest-foundation-20260914.json). This is not hosted or provider commissioning.

Local child-binding acceptance: [nine resource families, concurrency and populated restore](../../docs/evidence/canonical-migration-child-bindings-20260914.json). Staging ledger was rechecked at99 migrations; both candidates remain local.

Client and runtime acceptance: [43 real Auth/PostgREST migration checks, 351 combined runtime checks and 552 unit tests](../../docs/evidence/canonical-migration-auth-runtime-20260914.json). The new API layer is ready for later interface composition; no migration UI is claimed.

Resolved-scope digest and initial scan projection: [SQL/concurrency, real HTTP and recovery-after-restore evidence](../../docs/evidence/canonical-migration-scan-progress-20260914.json). This does not establish whole-migration acceptance.

Transactional attempt history: [SQL/concurrency, 369 runtime checks and populated baseline/restore evidence](../../docs/evidence/canonical-migration-attempt-history-20260914.json). This remains local and is not migration cutover acceptance.

Import claim wait authorization: [reproduction, seven-function correction and serial SQL/HTTP/restore evidence](../../docs/evidence/canonical-import-claim-wait-authorization-20260914.json). No hosted deployment occurred.

Import staging/failure wait authorization: [observed contention, transactional rollback and SQL/HTTP/restore evidence](../../docs/evidence/canonical-import-stage-failure-wait-authorization-20260914.json). The 105-migration candidate remains local; hosted staging remains at 99 migrations.

Bounded source items: [nine populated adapters, 378 runtime checks and restored item evidence](../../docs/evidence/canonical-migration-source-items-20260914.json). Clinical outcome adapters and frozen reports remain pending; no hosted deployment occurred.

Read-only operator workspace: [browser, source and viewport evidence](../../docs/evidence/canonical-migration-workspace-20260914.json). Appended below existing tools; no database or hosted changes. This does not complete creation, binding, resume or report-review workflows.

Owned attachment capture receipts: [SQL/contention, actual HTTP, browser and populated restore evidence](../../docs/evidence/canonical-migration-capture-evidence-20260914.json). Both duplicate observations recover prepared/reserved/ready requests, two approval versions and a separate canceled decision. No hosted rollout or fresh byte verification is claimed by the projection.

Scope creation and binding UI: [566 unit tests, 33 browser checks, 80 real Auth/PostgREST checks and viewport evidence](../../docs/evidence/canonical-migration-scope-binding-ui-20260914.json). No new migration, hosted rollout or provider call. Full staff acceptance and explicit resource resume remain pending.

Explicit saved-binding resume: [unit/body/concurrency checks, 39 browser cases across combined and viewport runs, and 86 real Auth/PostgREST checks](../../docs/evidence/canonical-migration-explicit-resume-20260914.json). Live provider and hosted staff acceptance remain pending.

History review receipts: migration `20260914210000` adds a bounded, administrator-owned observation lookup over approved patient history. It distinguishes exact observed versions from later source versions, retains superseded approvals and reports extraction receipts/local version drift without returning clinical prose or private request payloads. Discrepancy decisions, distinct diagnosis totals, other resource adapters and acceptance remain separate. The candidate has108 migrations; no hosted rollout is implied. Validation is recorded in [history evidence](../../docs/evidence/canonical-migration-history-evidence-20260914.json).

Vaccination review receipts: migration `20260914220000` adds a bounded administrator-owned lookup over DVM-approved outside vaccination versions. Exact matching includes the vaccination observation and the saved consultation snapshot/head. The view retains corrections and unknown/uninterpreted statuses, without implying native administration, vaccine certificates, adopted due plans or delivery. [Validation evidence](../../docs/evidence/canonical-migration-vaccination-evidence-20260914.json) records local verification; matching hosted rollout and populated restore remain separate. The history regression fixture now selects the current source explicitly instead of relying on creation-time ties.

Prescription-header evidence: the local adapter preserves approval/correction versions, source currentness, partial review and bounded reference counts. Exact relationship means the observed header snapshot, payload hash and head version only; it does not certify individual item coverage. Item-level, identity and weight adapters, global totals, operational resolutions and frozen acceptance remain pending. Evidence: [prescription header checks](../../docs/evidence/canonical-migration-prescription-evidence-20260914.json). No hosted rollout is implied.

Prescription-item evidence: migration `20260916000000` and its strict API/panel distinguish exact item versions, parent versions and run/page observations, selected/omitted outcomes, source changes, superseded approvals and repeated observations. Both hosted backends and the live Lovable release are verified in the rollout evidence above. It does not imply local prescribing or complete migration coverage.

Identity approval evidence candidate: migration `20260916010000` reads the exact owned contact/animal observation and its manifest-selected approved mapping. Legacy observations have no retained head version, so even equal snapshots report unknown observed-version fidelity. Approved-source currentness, local edits and household reassignment are distinct facts. SQL/real API/browser and112-migration populated restore checks pass locally; CI and rollout remain pending. Weight evidence, global reconciliation, operational resolutions and frozen reports are still required.
