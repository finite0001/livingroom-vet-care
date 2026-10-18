# Controlled opening custody validation

Base: `04afcf1b621f72a564af1dcd5165bfb10e121e78`, 204 canonical migrations.
Scope: isolated candidate only. No canonical migration, hosted mutation, practice
configuration, clinical permission, commissioning or activation.

## Problem and result

`native_custody_boundary` currently has only an array-type check. The product
validator returns before checking an opening when the current state has not yet
attached it. Add independent opening validation that binds original native
allocations and retained source prefixes to opening cells. Validate persisted
openings before that early return. Preserve all existing posting/recovery guards.

## Design

- A private canonical projector verifies the original dispense, exact allocation
  identities, bounded return/correction/discrepancy prefixes and any original
  pickup receipt. The stored versioned entry must equal its canonical projection;
  extra fields, malformed identifiers, quantities and stale/forged heads refuse.
- Retain canonical UTC operation-receipt hashes as well as document hashes.
  These witness opening-time receipt content, not signatures or pre-opening truth.
- Prefix membership is explicit. Never infer cutover from timestamps or UUID order.
  Later native evidence must belong to its exact controlled event; it must not
  change the retained opening projection. Verify old evidence after recorder
  sessions retire.
- Every relevant original allocation and source belongs once to the opening or a
  later managed source link. Split cells may represent an allocation across actual
  containers, but their prepared and per-intake held totals must reconcile in both
  directions. Available stock must not include quantities already dispensed.
- Retain zero-balance history where needed for membership. Original pickup means
  no onsite prepared quantity. Client/unknown return custody and unresolved
  discrepancies remain unavailable; this increment adds no exception route.
- New helpers remain private under the candidate's existing revoke/manifest seal.
  No changes to schema, ten producer bodies, trusted-189 reference, UI, policy or
  event effects/posting semantics are planned.
- Native custody requires original operation receipts and current C1a provenance.
  Older native records without provenance refuse explicitly. Their genuine upgrade
  matrix remains separate; available-only old movements retain exact snapshots.

## Ownership and implementation

1. [x] Contract: freeze the projector signature and exact entry keys after native
   source inspection; record them in the candidate README.
2. [x] Validator: new `candidate/opening.sql`; minimal call from
   `candidate/constraints.sql` before the unattached-opening return.
3. [x] Acceptance: new `candidate/opening-boundary-acceptance.sql` and
   `candidate/probe-opening.py`, with populated legacy custody, refusal rollback
   fingerprints, later managed source preservation and marked populated restore.
4. [x] Integration: assemble `opening.sql` before constraints; invoke a separately
   named opening probe in `candidate/run-local.py`; preserve existing counters.
5. [x] Independent review, complete owned candidate/ordinary SQL regression,
   repository checks, source-bound receipt and verified cleanup.
6. [ ] Commit and open one PR; after exact-head CI, merge under existing owner
   authorization and verify the resulting production frontend deployment. This
   candidate-only release does not install a backend engine.

## Meaningful acceptance

Positive cases: empty opening without old custody; multiple lots and containers;
prepared plus clinic-retained held custody; completed/corrected zero histories;
original pickup without onsite prepared stock; unchanged opening after legitimate
later managed activity; validation without the historical recorder session.

Refusals: missing/duplicate/foreign allocations or sources, false hashes or heads,
wrong quantities/intakes, omitted cells or boundary entries, overlap between opening
and managed sources, unsupported custody, unresolved discrepancies, malformed
unattached openings and native evidence changed after cutover. Each failed write
must leave complete scoped table fingerprints unchanged. Restore proof must retain
the opening and source evidence and verify marker-owned database/runtime cleanup.

## Remaining work

This does not complete the genuine pre-C1a upgrade matrix, wider C1b exception
acceptance, canonical engine assembly, C2 review/witness/count/transfer/reporting,
or C3 physical commissioning/recovery. Susan's existing SOP review remains pending;
no repeated owner question blocks this synthetic engineering increment.

## Local acceptance outcome

The corrected owned rehearsal passed 166 canonical suites / 7,338 assertions,
existing managed/Auth probes, and the new 27-refusal/14-positive opening probe.
Later managed pickup/annotation and populated restore with historical sessions
absent passed separately. All 398 source hashes matched and cleanup was verified.
Repository checks passed 1,687 unit tests, all three TypeScript projects and build.
The first alias-collision failure and cleanup remain preserved separately.
See [source-bound evidence](../../docs/launch-evidence/2026-10-18-controlled-opening-boundary.md).
Release step 6 remains tracked on the resulting PR, including exact-head CI and
frontend deployment; no backend engine installation belongs to this increment.
