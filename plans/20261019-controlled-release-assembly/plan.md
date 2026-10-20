# Frozen, inactive controlled-stock installation artifact

Base: released PR #285, merge `e4ecccc5e44b7d7a301d89ba4157aa5e86a75f36`.
This advances C1b release packaging. It does not complete C1b commissioning,
C2 workflows, C3 physical reconciliation, or Susan's practice approval.

The development installer currently captures its initial technical baseline from
the runtime it just installed. Preserve that local development path. Add a separate
deterministic package whose expected catalog is frozen independently from the
already reviewed #285 proof and cannot be adopted or resealed during installation.
Keep this artifact outside canonical migrations until its promotion is reviewed.

- [x] Freeze `candidate/release-expected-204.json`: exact 204 source prefix,
  assembled SQL inputs, unchanged trusted-189 reference, and independently
  reviewed expected post-install catalog. Document exact coverage and provenance;
  exclude runtime IDs, OIDs, private paths and row fingerprints from public data.
- [x] Add `candidate/release_assembly.py` and meaningful mutation tests. Require
  exact pinned inputs and emit byte-identical
  `engine/release/controlled-stock-private.sql`; `--check` detects stale output.
- [x] Keep the exclusive writer barrier first. Before persistent DDL, require
  exact migration ledger, trusted prior definitions/ACLs and no partial engine.
  Revoke new entry RPCs, helpers and raw tables. Install all ten hooks atomically.
  Compare actual post-install catalog with the frozen expected literal before
  inserting that literal baseline and committing. No runtime resealing API.
- [x] Add `candidate/release_rehearsal.py` and strict proof tests. Refuse body,
  grant, RLS, trigger, ledger and partial-engine drift. Inject identified failures
  after schema, after hooks and before commit; require exact full selected-schema
  data, prior catalog, ten-writer, ledger and permanent-object rollback each time.
  Also mutate the installed helper, ACL, RLS and trigger catalog before the final
  comparison and require exact refusal against the frozen expected manifest.
- [x] Integrate an explicit owned-local artifact opt-in in `run-local.py` and
  historical replay. Each SQL execution uses a fresh owned backend. Verify clean
  installation against the frozen pin, private privileges, all-ten coverage and
  zero configuration, opening, active-state and event rows before other probes.
- [x] Independently review assembly, pin coverage and failure contracts before
  a source-frozen local rehearsal. Preserve all original pins and engine bodies.
- [x] Pass all 224 harness tests and the final focused installation rehearsal:
  14 exact refusals, 435 original relation fingerprints, 21 new engine families,
  one frozen literal manifest, zero configuration/events, all 422 source hashes
  matched and independently confirmed owned-resource absence. An earlier nine-case
  pass is retained as superseded pre-refinement evidence, not current acceptance.
- [x] Run focused harnesses, targeted installation/rollback rehearsal, fresh full
  ordinary SQL/Auth/restore compatibility and genuine historical compatibility
  using the artifact. Keep all existing workload budgets, reserves and ownership
  guards. Bind every proof to exact source hashes and require cleanup before PASS.
- [x] Publish reviewed sanitized evidence, README and scope limits. Preserve
  failed attempts privately and exclude partial progress from acceptance.
- [ ] Commit/push a reviewed PR and persist until all five exact-head CI jobs
  pass. Request Dave's specific merge go for that new PR; no implicit merge.

Ownership: assembly module/artifact/tests — next_gap_audit; independent expected
pin/provenance — evidence_review; rollback helper/tests — old_stock_research;
runner integration, plan, final evidence and release coordination — root.
All paths above are relative to `tests/controlled-drugs/engine/` except the Python harness
tests in `supabase/tests/` and this plan.

Canonical migration promotion is a subsequent explicit package step, not hidden
in this test-only batch. Hosted installation, production stock changes, active
policies, public RPC grants and clinical/register activation remain absent.
The pinned CLI records a migration after executing its authored statements; an
embedded artifact `COMMIT` can therefore precede ledger insertion. Promotion must
derive a reviewed CLI-transaction-owned body and prove actual migration-ledger
failure rollback. These `psql` rehearsals do not prove CLI ledger atomicity.
Susan's physical count, SOP, witness eligibility and practice rules remain pending.
Column ACLs are checked explicitly at installation; the existing ongoing manifest
does not retain them. This package does not extend that runtime sealing coverage.
Genuine 1,000-return/discrepancy chains and feasible mixed capacity scenarios remain
separate unproved capacity work; full Cartesian maxima exceed the existing byte cap.
