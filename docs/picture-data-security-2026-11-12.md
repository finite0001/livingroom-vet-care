# Database and private-file review — November 12, 2026

Reviewed fresh main `bdc40db68b7747d5fcb65e4b23f992a45e8b4eb2`, with 213 migrations. Scope: screenshot categories 3 (Supabase Storage), 6 (open database/privileges), 11 (data races) and 15 (path traversal). No hosted database, provider, real patient data or production configuration was accessed. The review preserves clinical history, existing imports, private files, disabled provider/clinical gates and the production promotion hold.

## Confirmed correction: permanent conflicts reported as retryable failures

Migration `20261110203352_appointment_links_restock_alerts.sql` introduced three deterministic stale-version branches using SQLSTATE `40001`: two in `set_treatment_appointment` and one in `save_inventory_restock_setting`. None can succeed by retrying the unchanged request. The existing [SQLSTATE incident rule](postgrest-retryable-sqlstates.md) requires `PT409` for these conditions.

The unchanged repository's minimal appointment/restock PostgreSQL harness reproduced all three `40001` branches. A separate local PostgREST **16.3** gateway returned **HTTP 500 / `40001`** for each. This proves an error-classification/reliability defect, not an authorization bypass. The older unbounded gateway retry behavior is documented incident history; the current hosted gateway version and current hosted retry behavior were not inspected or reproduced.

Additive migration `20261112210000_nonretryable_visit_restock_conflicts.sql` replaces only those three literals with `PT409`. It preserves both function signatures, complete predicates, row locks, actor checks, idempotent replay, owners and execution ACLs. The local gateway then returned **HTTP 409 / `PT409`** for all three unchanged stale requests. A regression compares the live before/after function definitions and ACLs to verify that only the error literals changed.

## Reviewed controls and limits

- New Auth identities are inactive and receive no role (`20260919120000_new_auth_users_inactive.sql`). `has_role` requires an active profile; `is_active_staff` requires both active profile and an admitted staff role. Self-profile updates cannot change role or active status. Current explicit staff-RPC grants and the retained staff-access tests cover anonymous/inactive/ordinary-staff denial paths. The shared-memory note about automatic active STAFF signup is historical and does not describe current source.
- The former authenticated-only Storage policies were replaced by active-staff checks. Patient-document operations use reserved actor/patient/document paths, owner checks and row locks. Ready document history is immutable; there is no overwrite policy. Photo byte verification also freezes the object before finalization, checks its identity/digest and uses an optimistic-version action under locks.
- Conversation uploads use owned reservations, bounded size/MIME/signature verification and service-only verification writes. Inbound-original retrieval verifies the authorized saved association and bytes, then reauthorizes before returning them. It does not disclose a signed Storage URL. Cleanup validates an exact three-UUID/original path, object identity and confirmed absence, and retains its separate disabled destructive gate.
- Diagnostic-PDF retrieval binds staff authorization, patient, job, immutable digest and exact bucket/path, then confirms a receipt before returning verified bytes. Record-release document links retain reviewed snapshots, capability verification, limits and private artifact validation.
- Recent appointment links lock the treatment and selected appointment, enforce actor/patient ownership and expected versions, and retain append-only link history. Restock settings lock the catalog product and distinguish exact replay from stale conflicting edits. The correction changes their error classification, not these serialization decisions.

No additional exploitable storage/path/role bypass was demonstrated in the reviewed paths. This is **not** a complete live catalog or hosted configuration certification. The specialized current-source/ledger contracts were inspected; the complete 214-migration native/Auth/restore workflow matrix was not run locally. Historical-206 CI passing cannot establish that acceptance. No ongoing ezyVet integration, opening clinical stock, real provider delivery, destructive retention or production publication was enabled.

## Validation and source admission

- 58 existing offline private-file/attachment/photo/document-link tests passed, with no skips.
- 12 inventory/current-migration guard tests passed.
- 144 source-control tests passed across the complete run and a targeted rerun after correcting the new browser-derivation pointer. Exact historical-prefix admission, new official framing, the complete browser inverse, scoped ESLint and `git diff --check` also passed.
- The disposable PostgreSQL appointment/restock harness passed its ownership, replay, relinking, audit, stock and staff-boundary assertions, plus exact function/ACL preservation and three real HTTP conflict checks.
- Migration 214 uses the same pinned official CLI statement framing and finite successor contract as the existing tails. It gets a new `nonretryable-conflicts-migration214.json`; prior migration files, migration manifests, source closures and original browser/protocol bindings are retained unchanged.
- Current acceptance uses a new `picture-security-candidate-source.json` and derived `picture-security-browser-source-proof.json`. The former must be captured **once after all integrated code is final**. Source admission is not runtime acceptance. Existing CI still runs its full current candidate workflow matrix with unchanged deadlines, ledger, preservation, Auth and cleanup checks.

Run targeted verification from the repository root with Node 22.12+ and the npm dependencies installed as a real directory (the parser deliberately rejects symlinked source):

```sh
python3 -B tests/inventory/appointment-restock-local.py
node scripts/narcotics-log/frame-nonretryable-conflicts.mjs --check
python3 -I -B scripts/narcotics-log/beta_browser_source.py --check-source
python3 -B -m unittest discover -s scripts/narcotics-log -p 'test_*.py'
node --experimental-strip-types --test tests/restore/current-migration-guards.test.ts tests/inventory/appointment-restock.test.ts
```

After integration, capture the new source closure without replacing any prior receipt:

```sh
node scripts/narcotics-log/frame-cli.mjs --write-candidate
node scripts/narcotics-log/frame-hosted-history.mjs --write-candidate
python3 -I -B scripts/narcotics-log/beta_rehearsal.py --capture-source
python3 -I -B scripts/narcotics-log/beta_rehearsal.py --check-source
```

The closure must be regenerated under a new filename if source subsequently changes; the capture command intentionally refuses to overwrite a differing candidate. Complete the required current-candidate native CI and reviewed staging acceptance before deployment. Follow the [deployment runbook](deployment-runbook.md) and [narcotics release sequence](controlled-drugs/narcotics-release-sequence-20261028.md); do not substitute a generic migration push or rewrite historical receipts.
