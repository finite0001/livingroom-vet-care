# Shared stock-writer boundary

Status: locally verified; exact-head CI and hosted rollout pending. [Local evidence](../launch-evidence/2026-10-14-stock-writer-local.json).

C1a adds canonical source provenance to existing physical inventory workflows. It does **not** activate a controlled-drug register, classify a medication, establish opening counts or approve Susan’s proposed rules. Controlled events/containers belong to C1b; review/witness/count/report workflows and actual commissioning remain C2/C3 in the [execution plan](../../plans/2026-10-14-inventory-register/phase-03-controlled-register.md).

## Complete entry coverage

All eight existing outer writers enter one shared transaction barrier before their previous operation, invoice, authorization, anesthesia or lot locks:

| Writer | New source evidence |
|---|---|
| `receive_inventory` | Original receipt/movement UUID |
| `adjust_inventory` | Original adjustment/movement UUID |
| `record_patient_treatment` | Exact physical treatment/movement; historical transcription has no debit |
| `record_native_dispense` | Exact original dispensing receipt and immutable per-lot allocations |
| `record_native_dispense_return` | v1 custody event and its stock links where applicable |
| `record_native_dispense_return_v2` | v2 custody/correction event and stock/compensation links where applicable |
| `record_anesthesia_drug_administration` | Outer anesthesia identity through the existing single nested treatment/debit/charge |
| `record_native_return_discrepancy` | Discrepancy/hold decisions and resolutions, including those without stock movement |

Future exclusive opening/freeze transitions must acquire that same barrier first. Shared entry preserves concurrent ordinary work; an exclusive transition drains admitted transactions. The ordinary writers retain their existing authorization rules with a fresh role check after the barrier. This package does not claim the stricter controlled-event live-session policy is already implemented.

The migration uses an explicit transaction and short table-lock/statement limits. It checks all eight canonical pre-migration definition hashes, preserves their original signatures/request fingerprints/receipts, then installs all entry hooks and source guards atomically. An unexpected existing definition aborts the migration. A request still executing an older function body must fail atomically at the new guard and recover/retry its original UUID. This is not a zero-interruption guarantee during installation.

## Private evidence and invariants

Five RLS tables have no raw PUBLIC/anonymous/authenticated/service-role access. Six owner-only helpers have fixed search paths; no new application RPC is exposed.

- `stock_writer_manifests` preserves immutable before/after definition hashes. Later changes to an entry-instrumented writer require a reviewed manifest revision; removing entry instrumentation still cannot authorize a new movement through the common guard.
- `stock_writer_admissions` holds one technical cache row per backend PID. Admission must match server start, actual transaction identity/start, statement start and actor. This row is replaceable technical state, not clinical history or an independent stock balance. Caller-supplied application settings cannot create admission; stale/restored rows cannot authorize another statement.
- `stock_movement_sources` links each new movement to its exact canonical root and actor. Deferred checks work in both directions. They verify treatment/allocation/return facts, exact signed quantity and original saved receipt membership. Extra movements or allocations cannot borrow an earlier transaction’s identity. Anesthesia retains its outer source without adding a second movement or charge.
- `stock_custody_sources` and `stock_discrepancy_sources` cover changes that have no available-stock delta. A movement-only guard would miss them.

New source records and manifests cannot be rewritten, deleted or truncated through these boundaries. Source evidence follows the existing immutable clinical/stock records. Old movements are not backfilled with fabricated transactions; recovering an old receipt creates no new physical effect or invented source. No conversion, dose calculation or additional billing runs in the source layer.

The database owner’s ability to replace code, disable triggers or restore privileged data remains outside application authorization. C3 still needs a complete reviewed coverage manifest for the eventual controlled policy/helpers/triggers/ACLs, actual physical reconciliation and operational acceptance. A successful database restore alone does not account for physical events that happened after a backup.

## Verification and rollout contract

Require the complete canonical SQL regression, genuine Auth/PostgREST and browser regressions for existing prescribing/dispensing/returns/billing, exact fractional treatment/anesthesia checks, all-eight observed barrier waits, drain/replay/role-loss tests and populated source restore. Upgrade rehearsal reconstructs all eight exact pre-migration definitions from their recorded hashes, creates an actual synthetic legacy receipt, applies the migration, verifies unchanged recovery without backfill and verifies a newly enforced source. Injecting drift into the last writer must roll back all earlier hooks and new tables.

The [rollback-only hosted probe](../../scripts/stock-writers/rollback-probe.sql) exercises positive receive/adjust/treatment/anesthesia paths and source/permission invariants entirely inside rollback. Stage-first installation also requires real Auth access/denial checks and exact prior/current definition comparison. Preserve existing stock, billing, communication, payment, generation and reconciliation baselines; use no primary staff session or real drug classification as a test fixture. No provider, Edge Function, secret or legacy-backend change is part of C1a.

The [inactive rules draft](../controlled-drug-rules-susan-review.md) distinguishes practice choices from actual physical witnessing and leaves housecall waste handling unresolved. Generic medication-return functionality does not establish controlled-drug collection authority. The future controlled workflow must enforce its separately reviewed permissions; C1a does not commission them.
