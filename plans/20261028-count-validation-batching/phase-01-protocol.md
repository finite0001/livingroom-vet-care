# Pending product validation protocol

## Scope and alternatives

Keep all original write authorization, row/resource checks, deferred foreign keys,
saved closures, reciprocal membership checks and final complete product checks.
Change when the repeated complete product check runs. Do not change clinical
rules, public request/receipt formats, timers, retained-history limits or providers.

Rejected alternatives: raising the timeout; caching a completed validation in a
GUC, temporary object or stored flag; trusting a hash instead of exact data;
turning off constraints; dropping final graph checks based only on a writer's
intent. Further pure-grammar changes alone have not fixed measured execution.

## Database protocol

1. Create `controlled_count_v1.pending_products` with `transaction_id bigint` and
   `product_id uuid`, both non-null, a composite primary key and nonzero checks.
   It has no foreign keys into sealed parent objects, app grants, app policies,
   public API or clinical facts. Enable RLS with the existing owner-only pattern.
2. Preserve the original BEFORE write guard on all fourteen mutable count tables:
   operations, cycles, snapshots, statements, outcomes, cancellations, causes,
   open_causes, resolutions, reconciliation_preparations/approvals/executions/
   confirmations and reconciliation_execution_causes.
3. Add an immediate AFTER-row collector on those exact tables. Enqueue INSERTs
   and the existing permitted open_causes DELETE. Do not enqueue descriptor
   installation, policy publication or abandoned closures; those retain their
   original separate guards and full checks.
4. The collector obtains the actual protected operating context. Check backend,
   server start, transaction/statement identity and operating phase, and derive
   product from its validated count scope. The original BEFORE guard has already
   checked the current principal and exact row/action/product/site/operation and
   resource membership. Do not infer scope from a parent row that may not yet
   exist. No new permission to write clinical facts comes from this collector.
   Use the existing pure context_phase_mapping_values validator for both legal
   mappings, including post-parent reconciliation, then check actual boot/backend/
   transaction/statement identity and operating phase. Do not assume operation,
   writer or nonce still use the outer mapping after parent execution. Do not
   duplicate current_principal calls through current_count_context_header_required.
5. Insert the actual current transaction/product into pending_products using
   ON CONFLICT DO NOTHING. The table's insert guard independently binds both
   fields to that actual operating context. It refuses UPDATE and TRUNCATE.
6. Add a DEFERRABLE INITIALLY DEFERRED AFTER INSERT constraint trigger on the
   pending table. Its callback deletes the exact pending transaction/product.
   It cannot create a success flag or bypass the deletion guard.
7. A separate BEFORE DELETE guard verifies the held source frontier and current
   transaction, unconditionally calls the unchanged product_live_causes(product)
   full history/closure/membership validation, then returns OLD. No return or
   conditional bypass may precede that call. Failed validation aborts deletion
   and the original operation. Queue deletion must not enqueue itself.
8. A missing pending row in a later queued callback is safe only because every
   possible deletion was guarded by complete validation. A later original data
   write inserts new pending work and schedules another check. No committed
   pending row is a valid source/restore state.
9. Explicitly defer only the new queue constraint at every writing count entry
   before its first fact write. The current begin_count_context does not defer
   constraints. Add the queue to force_count_structural_checks before context
   deletion; keep the final ALL IMMEDIATE and all original force points.
   The actual reconciliation parent path has no intervening SET CONSTRAINTS.
   Re-enqueue support does not add arbitrary multi-API transaction support; old
   constraints retain their existing timing and may reject such a sequence.
10. Preserve count_graph_deferred's initial frontier, table/event gates, strict
    operation/product derivation and branch-specific snapshot/cause/reciprocal
    checks. Move only its repeated final whole-product validation to the new
    mandatory queue protocol. Its previous same-callback dominance argument is
    superseded by the collector/queue/deletion proof; do not claim it still applies.

## Proof obligations

- The original source BEFORE guard covers every one of the fourteen collected
  tables and every admitted mutation; it binds the row to the actual scope.
- No authorized callback changes that operating scope between the original row
  guard and its collector. The pending table and its five private helper functions
  have no application EXECUTE/DML grants. Source metadata binds every trigger.
- Every affected product has pending work before its row statement can succeed.
  Enqueueing is AFTER the original row, so immediate enforcement cannot pass on
  the pre-write state. Incomplete intermediate states may reject safely.
- Every way to remove pending work executes complete validation; UPDATE,
  TRUNCATE, rogue inserts, stale transaction IDs and ordinary-role deletes refuse.
- No context-authority decision is replaced. Operating-to-finishing source checks,
  fresh principal checks, context deletion guards and final constraints remain.
- Policy/configuration and abandoned-closure lanes are unchanged and deliberately
  independent of the live count context. Retry/recovery reads create no work.
- Lock the pending relation in the original initial shared and exclusive kernel
  plans. Extend 110/121 to 111/122 from source; never acquire it as a late upgrade.
- PostgreSQL constraint checks may run in either relative order. The complete
  check reads the final data, and later original row checks can still abort.

## Source implementation

Root owns the implementation and integration. Independent agents review source,
coverage, privilege reachability and actual evidence without modifying it.

- Create `scripts/narcotics-log/pending-validation.sql` for the private table,
  collectors, mutation/deletion guards and deferred callback.
- Create `scripts/narcotics-log/pending_validation.py` for exact source transforms
  of entry deferral, force points, count callback, both lock plans and their seals.
- Integrate the fragment after the existing source transformations in the offline
  compiler. Preserve and verify the exact seven-artifact predecessor inverse.
  Existing optimization proofs describe the predecessor; record the new composed
  proof rather than applying its obsolete final-callback claim to the new code.
- Regenerate independent reference DDL, table/function/trigger inventories,
  expected module properties, descriptor and source guards. Expect eighteen count
  relations and the exact source-counted new trigger/function set; retained
  physical boundary composites and witness classes remain unchanged.
- Update the installation/receiver observers and declared row effects for the
  new empty/transient relation. Preserve frozen portable business modules through
  explicit adapters where necessary; never silently ignore nonempty work.
- Regenerate only the unmerged successor SQL and its source/framing pins.
  Do not alter the original 205/206 migrations, 269-component sources, existing
  ledger rows, unrelated manifests, autogenerated database types or local secrets.
- Verify whether the source-framed 209 artifact changes; derive it independently
  and keep its actual CLI-created filename/receipt. Do not assume a commit deploys.

## Acceptance

- Exact declared footprint and source-only predecessor inversion; no unlisted
  old object/attribute/privilege changes. Measure file/channel caps unchanged.
- Actual installation: all source properties, original rows, sequences and Auth
  data preserved; pending table empty except within an uncommitted phase.
- Actual PostgreSQL protocol controls: one mandatory full check for repeated
  writes to one product before a flush; independent checks for two products;
  forced-immediate rejection; re-enqueue after an earlier successful flush;
  savepoint/transaction rollback; non-bypassable deletion; ordinary-role refusal.
  Isolated owner-data controls never count as positive Auth acceptance.
- Source-derived engineering fault control: a genuine Auth operation whose queue
  validation fails must leave no domain/context/pending changes. It cannot grant
  normal acceptance or change frozen parent descriptors.
- Normal real-Auth execution must fit the unchanged eight-second limit and finish
  discrepancy execution, post-count, confirmation and resolution.
- Populated source backup/restore/restart must preserve an empty pending table,
  original rows/permissions/Auth, epoch fences, signed-out acknowledgment refusal,
  independent replacement acknowledgment, and final release with old-session
  rejection. Preserve the 56 pure-boundary controls as a separate data check.
- All existing real writer, signing, witness, ordinary-role, lost-response,
  operational browser and private file/export profiles pass on the final source.
- All GitHub checks and the exact preview pass. Then request the one specific
  PR 314 merge/deploy approval required by AGENTS.md.

## Reviewed decisions

Independent source review confirmed both legal context mappings, unchanged live
principal checks in original row guards, and no intervening constraint-mode change
in the actual reconciliation parent path. Metadata review requires registering
new DDL in both actual and independent-reference inventories, keeping original
17-table/76-trigger assertions and adding final 18-table/94-trigger assertions.
Restore review requires explicit empty-work admission, never a post-restore drain.
Native rollback, timing and end-to-end acceptance remain pending. No clinic facts
or additional clinical signoff are needed for implementation.

## Immediate metadata dominance refinement

V46 fresh genuine execution, confirmation and resolution succeeded in the
engineering run; its final verifier exposed a separately corrected linked-scope
assumption. Restored execution still exceeded8seconds. A later Mac diagnostic
hit the same limit in an earlier209 stock write, so final timing also needs an
isolated runner. Independent review found one immediate redundant full-module
check in the management dispatcher. Its initial static acquisition invokes the
sealed recovery post-check on BOTH exits, and that post-check performs the full
metadata check whenever209 exists. Only unchanged frontier assertions intervene
before the dispatcher repeats it; there is no intervening domain or identity
read, write or wait. Retain the direct dispatcher check when209 is absent.
The already held90271190 admission lock excludes supported209 installation,
whose source prefix takes that lock exclusively before creating schemas. No
runtime validity flag, persistent certificate, session/epoch skip or deadline
change is introduced. Nested recovery post-checks stay unchanged. Native
performance and full final acceptance remain required.
