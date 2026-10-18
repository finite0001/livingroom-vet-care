# Controlled opening historical receipt compatibility

Base: `e34b967fb97f4fd248ec59918c42ef1c48d9b37e` (PR279), 204 migrations.
Scope: isolated candidate only; no hosted backend or clinical/register activation.

## Problem and design

Real canonical records created in an America/Denver SQL session reproduce `23514`
at original result-slot comparison. The candidate reconstructs timestamps under
UTC, while original JSON retains the writer's offset. Preserve every original
receipt/document/hash. Compare only reconstructed slot opened_at/closed_at and
linked refill-event created_at as finite typed instants with explicit offsets.
Both slot keys and the linked-refill timestamp key must exist; null is valid only
where independently reconstructed state expects it. All other keys/values,
requests, identities, quantities and retained source prefixes remain exact.

Reject a broad JSON normalization/repair approach: it would obscure unrelated
mutations. Existing receipt hashing must still reject even a same-instant encoded
value changed after the opening was bound. No new prior-history adoption or
provenance backfill. Retain trusted-189 and all ten canonical writers unchanged.

## Ownership and tasks

1. [x] Reproduce non-UTC failure in a separate owned runtime and verify cleanup;
   original protected opening-log SHA256
   `69b210d4dd4e48ddbd7a124a4be8bc50e790f2dcfd825ecd930af0329769d8e8`.
2. [x] Core: UI research owns modify
   `tests/controlled-drugs/engine/candidate/opening.sql`.
   Narrow typed comparison only; no canonical/schema/guard changes.
3. [x] Acceptance: worker research owns modify `opening-boundary-acceptance.sql`,
   `probe-opening.py`, and a new opening-history fixture in the same candidate
   directory. Run real UTC/Denver/Kathmandu legacy writers and cross-zone reads,
   both partial/completing fills and linked refill; preserve raw history on restore.
4. [x] Populate an actual second same-unit product with canonical native evidence;
   inject real foreign dispense/allocation/movement/source identities and assert
   the intended independent product/source refusal with exact rollback.
5. [x] Add changed-instant, missing/null/malformed/no-offset timestamp and non-time
   result negatives, plus an isolated retained receipt-hash mutation. Preserve
   prior 27/14 baseline counters separately from new unique cases and repeated runs.
6. [x] Independent read-only review by offline reviewer; root owns integration,
   README, plan, all runtime checks, sanitized evidence and verified cleanup.
7. [x] Complete owned candidate with166 canonical suites / 7,338 assertions and existing
   managed/Auth/restore probes; repository lint/typecheck/unit/build checks. Freeze
   executable sources during each proof, preserve failed attempts separately.
8. [ ] Explicitly stage/commit as David Edler, push once/open PR. After all four
   exact-head CI jobs pass, merge under existing owner authorization and verify
   Git-connected production frontend commit/aliases/desktop+mobile smoke. No
   backend engine installation belongs in this increment; release tracked on PR.

## Acceptance and boundaries

Report distinct case families separately from per-zone repetitions. Each marked
clone/restore pair must be removed; caller claims and historical sessions absent
checks, full scoped fingerprints, explicit invalid-COMMIT refusal and later
managed prefix preservation remain. Verify new source inventory and original
trusted pin; do not recapture or normalize bootstrap ACLs.

Current bounded capacity remains 200 product dispenses, 100 allocations/dispense,
1,000 events/dispense/history family, 1 MiB boundary; no evidence truncation. Genuine
pre-C1a upgrade/refusal at 187/188→204 remains separate; current-204 corruption
mutations do not establish older-native support. Wider exceptions, C1b assembly,
C2 workflows, C3 actual rules/counts/Susan approval and physical/Storage recovery
remain pending. No owner question blocks this synthetic engineering increment.

## Sources

- Canonical slot writer: `20260916072509_native_fulfillment.sql`:57-59,73-74,184-212.
- Existing strict parser: `20260916083056_native_dispense_corrections.sql`:34-39.
- [PostgreSQL17 datetime semantics](https://www.postgresql.org/docs/17/datatype-datetime.html).
- [Supabase changelog](https://supabase.com/changelog.md) checked; pinned local CLI
  2.118.0/Postgres17.6.1.171 remain unchanged for this bounded compatibility proof.

## Reviewed implementation

The core and matrix received independent static PASS before the full owned run.
Repository checks passed 1,687 unit tests, three TypeScript projects, build and
lint with zero errors/four existing warnings. Runtime acceptance and release
are recorded in [dated evidence](../../docs/launch-evidence/2026-10-18-controlled-opening-history.md); release is tracked on the PR.
