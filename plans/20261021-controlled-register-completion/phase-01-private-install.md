# Phase 1 — canonical private secondary-review installation

Status: implementation, independent source review, self-contained local CLI acceptance
and independent evidence/cleanup audit complete. Exact-head CI, matching preview and
specific merge approval remain pending. Priority: high. This promotes the already reviewed private v2
foundation; it does not promote its synthetic Auth profile or complete C2/C3.

## Context and invariant

[Foundation](../20261021-controlled-secondary-review/phase-01-foundation.md),
[merged local evidence](../../docs/launch-evidence/2026-10-21-controlled-secondary-review.md),
[completion sequence](plan.md). Parent canonical205 has its own frozen literal and
94-statement CLI ledger binding. The new extension must retain these exact values.
Completed local acceptance scope and remaining release gates are recorded in the
[canonical206 evidence](../../docs/launch-evidence/2026-10-21-controlled-secondary-review-canonical-206.md)
and [installation contract](../../docs/features/controlled-secondary-review-installation.md).

## Design

Create a deterministic versioned private release artifact and CLI migration206 from
only the approved v2 private wrapper, independently pinned source bodies and finite
metadata descriptor. Recompute the pure descriptor and require exact pinned equality;
no catalog-derived expectation and no reseal. Independent reference realization is
cross-check evidence, not the source of expectations. Preserve old candidate and
Gate A artifacts byte-for-byte.

New exact full-directory admission accepts precisely 206 ordered files: frozen204
map, unchanged205 body, and independently pinned206 body/name. Return explicitly
validated205/204 prefixes for older strict builders. Do not pass arbitrary slices or
permit count ranges. Old canonical_binding must refer to exact205 rather than the
last migration. Strict205-only artifacts retain their original proof contracts.

The CLI206 body begins with the owned exclusive practice barrier and contains no
transaction control: the real CLI must own the body plus ledger insert transaction.
Freeze a new complete expected205 ledger map derived from every pinned SQL body
using the pinned CLI splitter, then independently cross-check against actual CLI
reference replay. Preflight validates every expected205 version/name/statement row, parent
singleton revision/literal/live seal, writer hashes, independently expected parent catalog and absence
of every extension schema/facade/type collision. Preserve all existing data.

Install the exact private DDL and literal descriptor. Verify both seals, extension
catalog/raw ACLs and effective privileges, exact empty extension operational tables,
no eligibility definitions, no app grants, and unchanged parent history/ledger/writers.
Other source catalog/data observations are transient preservation baselines, not
independent whole-cluster admission expectations; never adopt them as either seal.
Raw parent comparison permits only the independently enumerated extension foreign-key
triggers and facades; original entries remain exact. No empty-engine assumption may
be used for populated upgrades.

## Files and ownership

Paths below are relative to this plan's repository root; no private machine paths
are committed. Schema owner creates candidate/secondary_review_release.py,
candidate/secondary_review_cli_body.py, candidate/canonical_review_prefix.py,
release/controlled-secondary-review-private.sql,
release/controlled-secondary-review-cli-body.sql and the one fixed canonical206
migration under supabase/migrations (final version recorded before artifact freezing).
All candidate/release paths are under tests/controlled-drugs/engine/.

Root integrates narrowly reviewed admission adapters/CI and documentation. Probe
owner later creates candidate/secondary_review_cli_atomicity.py,
candidate/canonical_post206.py, a bounded runner and focused tests; exact ownership
must be confirmed before edits. No deletes and no changes to existing frozen SQL/pins.

## Meaningful proof matrix

- Reject missing/extra/reordered/duplicate/altered migrations and descriptor input
  drift. Verify byte-equal deterministic output and independently pinned CLI split.
- Actual CLI205→206, both ordinary and populated205 parent with genuinely committed
  managed physical events and native history. This does not repeat or claim a
  pre-engine187/188 upgrade; that retained historical runner is verified separately.
- Inject late-body failure and, separately, unchanged-body ledger BEFORE INSERT
  failure after installed checks and the same backend's exclusive barrier.
- Observe backend PID/start and blocker, prove shared writer exclusion through the
  ledger insertion, then full rollback against the exact armed snapshot.
- Remove only owned fault fixture; compare exact original baseline. Snapshot includes
  full extension catalogs/data, original public/Auth/Storage rows and migration ledger.
- Clean install206, exact ledger version/name/statement array and no-op retry.
- No source data loss, altered Auth ownership/ACL, unreviewed raw parent changes,
  modified205 row, permission leaks or changed prior literals.
- Retained foundation synthetic Auth acceptance uses an explicit validated205 runtime;
  never grant/reseal a canonical private206 installation to impersonate that fixture.
- Existing ordinary/history/205 atomicity proofs keep their frozen contracts.
- Both the measured and final acceptance CLI matrices include two selected-schema attachment clone restores
  of **empty operational private206**, with exact independent seals/ledger and
  original-source preservation. Those frozen helpers check their clone internally;
  the outer runner retains child commands/stdout/stderr and full original-source
  before/after snapshots, not separately archived child clone snapshots/dump bytes.
  Final self-contained acceptance passed both checks. This is not populated
  private206 review-history restore, full-cluster/storage-byte recovery or physical
  events after backup. Those broader recovery gates remain future work; prior
  candidate Auth restore does not silently satisfy them.
- Freeze all input sources before bounded runs; retain raw private evidence and exact
  input maps. Independent reviewer verifies results and complete owned cleanup.

## Acceptance and risks

- [x] Independent design review clear.
- [x] Exact deterministic artifact/body/ledger pins reviewed and frozen.
- [x] Final self-contained local runtime acceptance and independent actual CLI
      rollback/barrier/empty-private206 clone/cleanup audit passed (385.189 seconds).
- [ ] All affected compatibility tests passed with no weakened expectations.
- [x] Sanitized local evidence and independent source/runtime evidence review clear.
- [ ] Final staged-change review clear.
- [ ] Exact-head all-five CI and READY preview completed.
- [ ] Dave's specific merge approval obtained.

Primary risks: accidentally accepting arbitrary prefixes; live resealing; omitting
extension state from rollback snapshots; synthetic app grants in private release;
using empty-engine checks for real histories; CLI transaction ending before ledger
insert; background jobs changing proof sources. Every risk has an explicit rejection
or isolation check above. No hosted install/clinical activation belongs to this PR.
