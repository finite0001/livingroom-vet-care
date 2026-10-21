# Independent secondary-review foundation

Base: released PR #289, merge `73b500f7052a9cbd753951216370e1414781f337`.
Status: Gate A, full targeted synthetic acceptance and all three affected
compatibility reruns passed independent review. Final PR CI/preview remain pending.

Implementation uses a dedicated worktree. Work moved from the design worktree after a concurrent session changed the probe
during a source-frozen bootstrap measurement. That attempt failed its source check
and is excluded from acceptance; its inputs, raw evidence and independent cleanup
receipt are retained privately. Both original worktrees and their evidence are
preserved without reverting the other session's changes.

Provide a private retrospective decision for an already committed controlled event.
The existing `secondary_review_required` flag records a requirement, not a signature.
Preserve canonical 205, its independent pins, ten writers and all stock behavior.
No hosted installation, clinical activation or practice defaults are included.

Detailed contract and acceptance: [implementation plan](phase-01-foundation.md).
Existing requirements: [C2/C3](../2026-10-14-inventory-register/phase-03-controlled-register.md).

- [x] Identify the missing immutable decision and separate review from witnessing.
- [x] Compare integrated engine revision and separately sealed extension designs.
- [x] Specify bounded synthetic eligibility, decision, recovery and queue semantics.
- [x] Independently review this plan and resolve technical findings.
- [x] Prove separate-schema metadata admission and independent expected definition.
- [x] Implement private immutable review protocol and derived bounded reads.
- [x] Pass targeted real Auth, observed waits, source preservation and restore.
- [x] Freeze source inputs and pass affected ordinary, historical and CLI proofs.
- [x] Publish sanitized local scope and evidence with exact provenance and limits.
- [ ] Complete all five exact-head CI jobs and READY preview on the new PR.
- [ ] Request specific PR merge approval after completed CI/preview.

Use a separate sealed `controlled_review` schema, with an exact enumerated public
facade outside the parent seal selector. This is explicit separate coverage, not
uncovered naming: all facade/schema objects must be extension-sealed on every entry.
If actual installation changes the frozen parent metadata or requires resealing,
stop this approach and review an integrated engine extension separately.

Scope ends at a synthetic-only API foundation. UI/browser clinical acceptance,
physical witnesses, transfer/count/report workflows, physical-after-backup recovery,
whole-cluster/Storage restoration and C1b/C2/C3 completion remain separate.
Susan's actual roles, timing, products/units, counts and SOP remain pending.

The dated [evidence](../../docs/launch-evidence/2026-10-21-controlled-secondary-review.md)
records local outcomes. Final exact-head CI and preview receipts belong to the PR;
no merge is authorized by this plan.
