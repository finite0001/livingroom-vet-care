# Prove the CLI-owned controlled-stock migration transaction

Base: released PR #287, merge ef1921de3ccab88cd69956cfd8017e212b8a1a27.
Keep all 204 repository canonical migrations, existing engine SQL, private artifact
7165851a…c4a7 and all independent pins unchanged. A temporary migration 205 exists
only inside the owned disposable rehearsal project. Canonical forward-port and
hosted installation remain later work; clinical/register activation awaits Susan.

- [x] Derive a separate deterministic CLI body by removing only the released
  artifact's first BEGIN and final COMMIT. Require reversible byte identity,
  exact parent pins and top-level transaction/pipeline safety. Freeze body hash
  9977696d3d6271cbbfe1dee3767dd71b8512d55bcec0c0d65d108745726252b3.
- [x] Add a bounded owned-runtime runner using actual Supabase CLI 2.118.0
  `migration up --local`. Verify project/workdir labels before each operation,
  pause/drain automatic jobs only in that server, and bind every input/temporary
  migration variant. Never read hosted links or local secret configuration.
- [x] Prove late body failure after verified completed private installation,
  then real migration-ledger INSERT failure after installation and exclusive
  writer-barrier verification. Compare all four selected schema data, public and
  migration catalog, ten writers, exact original 204 ledger rows and engine
  absence after rollback. Compare instrumentation baseline, remove it narrowly,
  then require the original baseline again. Accept exact identified errors only.
- [x] Apply the exact unmodified CLI body successfully as temporary migration
  205. An external test-only ledger trigger blocks at a separate advisory gate
  after verifying installation; a second backend must observe the CLI waiting
  while its original exclusive engine barrier still blocks a shared acquisition.
  Release the owned gate, require success, preserve all original data/writers/
  204 ledger rows, verify exactly one genuine CLI ledger row and literal v2
  manifest/private privileges/zero activation. Repeat CLI apply as a no-op.
- [x] Add meaningful pure and proof-negative harness tests; independently review
  the builder, runtime ownership, errors, transaction evidence and expected pins
  before freezing source. Pass actual rehearsal with independent resource cleanup.
- [ ] Keep the existing ordinary and historical CI rehearsals; add offline body
  check and actual CLI atomicity rehearsal. Publish sanitized reviewed evidence,
  commit/open PR, and persist until all five exact-head checks and preview pass.
  Request Dave's specific merge approval for that new PR.

Ownership: next_gap_audit — body builder/artifact/harness; old_stock_research —
callback-only atomicity proof/instrumentation/harness; evidence_review — independent
critical review/provenance/evidence; root — owned runner/gate/CI/plan/final release.
No worker reverts another worker's edits. No expected metadata is recaptured.

This proves a local CLI transaction boundary, not a production migration rollout,
post-205 full compatibility lane, physical stock reconciliation, cluster/Storage
recovery, C2 workflows or C3 commissioning. Promotion must retain the independent
204 preinstallation lane alongside a distinct 205 post-migration lane.
