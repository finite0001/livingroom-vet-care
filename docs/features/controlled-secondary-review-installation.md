# Private secondary-review installation contract

Canonical migration 206 installs the independently defined **private v2** review
foundation over the unchanged canonical-205 engine. It adds no application grants,
review eligibility, calendar, review operations, clinical permissions or register
activation. Self-contained local acceptance and independent evidence review passed;
release CI, matching preview and specific merge approval remain pending. This
document describes the source contract, not a hosted rollout. See the
[local acceptance receipt](../launch-evidence/2026-10-21-controlled-secondary-review-canonical-206.md).

## Deterministic package and independent expectations

The migration is
[`20261022010000_controlled_secondary_review_private.sql`](../../supabase/migrations/20261022010000_controlled_secondary_review_private.sql).
[`secondary_review_release.py`](../../tests/controlled-drugs/engine/candidate/secondary_review_release.py)
assembles the unchanged private v2 schema/protocol and independently frozen
descriptor into the standalone transaction-wrapped
[`controlled-secondary-review-private.sql`](../../tests/controlled-drugs/engine/release/controlled-secondary-review-private.sql).
[`secondary_review_cli_body.py`](../../tests/controlled-drugs/engine/candidate/secondary_review_cli_body.py)
removes only the exact outer `begin`/`commit` pair. Its body, the CLI artifact and
the canonical migration must be byte-identical. Supabase CLI owns the migration
transaction, including its ledger insert.

Admission takes the practice barrier exclusively before checking:

- The complete source-derived 205 ledger: exact version, name and ordered SQL
  statement array for every row. The retained 205 body still has its original
  94-entry statement expectation.
- The unchanged frozen-205 manifest literal, singleton revision 1, live metadata
  and all ten canonical writer definitions. A self-consistent new live reseal
  cannot substitute for the independent parent literal.
- Complete absence of the extension and conflicting facade objects before DDL.
  Partial installation is refused rather than repaired by adopting observed state.
- The exact private extension descriptor and effective privileges after DDL;
  descriptor alone is populated. Definitions, preparations, decisions and
  cancellations must remain empty.

The full ledger expectation comes from
[`secondary_review_ledger.py`](../../tests/controlled-drugs/engine/candidate/secondary_review_ledger.py),
which runs the pinned official Supabase CLI **2.118.0** migration parser/splitter
against the unchanged source files. Vendored bytes, upstream provenance, license
and TypeScript **5.8.3** transpiler hash are pinned. The 206 expectation contains
304 official parser entries: 303 executable statements and the final retained
comment. The separate lexical audit checks transaction safety; it does not define
the expected CLI ledger framing.

These expectations are source-derived artifacts. A separate actual-CLI reference
must match the full 205 expectation before the 206 proof runs. Observed database
catalogs and rows are used for before/after preservation comparisons, never to
replace either independent seal or derive an accepted ledger expectation.

The installer compares original selected-schema rows and raw metadata inside its
transaction. Only the declared facades and extension-owned RI-trigger additions
are outside that original-catalog comparison; the independent extension descriptor
checks their exact semantics, including both sides of foreign keys. The proof
harness additionally preserves the raw same-database catalog, types and exact
enumerated parent RI additions. This is not independent admissibility of every
object in an arbitrary PostgreSQL cluster.

## Complete directory admission and retained fixtures

[`canonical_review_prefix.py`](../../tests/controlled-drugs/engine/candidate/canonical_review_prefix.py)
requires the complete, ordered, unique 206-file migration directory, the exact old
205 files and the independently checked new release/body pins. Missing, extra,
reordered or modified inputs reject. A migration count or arbitrary list slice
does not authorize a prefix.

Historical engine tests can explicitly project the admitted 206 directory onto
the retained 205 files, then obtain the original 204 prefix. Their old
`canonical_binding` continues to bind migration **205**, not the last directory
entry. Owned temporary 205 fixture directories preserve their strict historical
negative tests and original 94-entry contract.

The two attachment clone runners select `--canonical-baseline 206` by default.
The retained scheduler proof explicitly selects `205`; helper defaults preserve
that older contract. Neither profile falls back to the other after an admission
failure. The 206 clone includes `controlled_review`, validates both independent
seals and the exact full ledger, and requires empty review operational tables.

## Offline checks

Run from the repository root. These checks do not connect to a database or write
hosted state:

```sh
python3 -B tests/controlled-drugs/engine/candidate/secondary_review_ledger.py --check
python3 -B tests/controlled-drugs/engine/candidate/secondary_review_release.py --check
python3 -B tests/controlled-drugs/engine/candidate/secondary_review_cli_body.py --check
python3 -B -m unittest discover -s supabase/tests -p test_controlled_secondary_review_release_harness.py
python3 -B -m unittest discover -s supabase/tests -p test_controlled_canonical_prefix_harness.py
python3 -B -m unittest discover -s supabase/tests -p test_owned_attachment_review_clone_harness.py
```

Optional independent source regeneration uses an existing pinned TypeScript file.
Check its presence first; the scripts verify its exact hash and refuse a different
transpiler. These `--check` commands compare without rewriting artifacts:

```sh
ls node_modules/typescript/lib/typescript.js
python3 -B tests/controlled-drugs/engine/candidate/secondary_review_ledger.py --check --typescript node_modules/typescript/lib/typescript.js
python3 -B tests/controlled-drugs/engine/candidate/secondary_review_cli_body.py --check --typescript node_modules/typescript/lib/typescript.js
```

The focused release harness skips its optional regeneration case when that
transpiler is absent; its ordinary frozen-artifact checks still run. Do not report
a skipped regeneration as completed. Candidate-writing flags are not repair
commands for a failed pin check.

## Runtime proof boundaries

The owned CLI runner's self-contained `--acceptance` mode first creates an isolated
actual-CLI 205 reference, verifies the independent full ledger/parent expectations
and removes that owned runtime. It rechecks the retained reference and frozen
source bytes before allowing either 206 matrix to start. The empty and populated
205 cases then use separate owned runtimes. All mandatory phases must complete;
partial outcomes cannot produce an acceptance receipt.

The exact CI invocation, after the frozen artifact checks above, is:

```sh
python3 -B tests/controlled-drugs/engine/candidate/run-secondary-review-cli-atomicity.py --run-synthetic-local --acceptance
```

This command starts disposable local infrastructure; it is not an offline check.
The source inventory must remain frozen throughout. Strict wall-clock caps are
600 seconds for reference and its verification/cleanup, 1,200 seconds for the
combined empty/populated matrix and normal cleanup, and 1,800 seconds overall.
Each owned runtime retains a 180-second emergency teardown reserve. That reserve
does not extend a successful phase: exceeding either phase cap or the combined
cap is a failure even if emergency cleanup later succeeds.

The matrix checks an injected failure late in the body, a failure in the actual
CLI ledger insert, clean commit and an already-applied no-op. Failure must preserve
the complete armed state; removing only the owned fault fixture must restore the
exact original baseline. The ledger stage also observes the exclusive practice
barrier held by the real CLI session. The empty case additionally requires both
attachment clone rehearsals and unchanged original source snapshots.

The matrix runs against empty 205 and genuine committed managed/native 205
history. This checks promotion without altering that history; it does **not**
claim a new populated review-206 dump/restore or the older 187/188 history matrix.
Separate `--reference` and `--measurement` diagnostic modes remain available;
measurement requires its matching retained reference. Both explicitly report
`acceptance: false`. Only a complete successful self-contained acceptance run can
report `acceptance: true`. The completed local receipt passed independent evidence
review in 385.189 seconds including normal cleanup. Exact-head CI, matching preview
and specific merge approval remain pending.
The workflow retains the separate historical 205, Gate A and populated review
protocol proofs rather than treating the new installation matrix as substitutes.

The attachment compatibility checks restore an **empty operational private206**
extension into owned clones. They validate both independent seals, all retained
rows/ledger, parent literal/writers and normalized Auth ownership/ACL evidence.
Cross-database OIDs are not expected to match; unchanged-source comparisons keep
the full raw same-database observations. A successful selected-schema clone does
not establish full-cluster disaster recovery, restored storage bytes, populated
review history recovery or reconciliation of physical events after backup.

No result here supplies a real site, roster, count, SOP or operating calendar.
Event coverage, policy/calendar, staff interfaces, physical evidence and full
commissioning remain unfinished in the
[completion plan](../../plans/20261021-controlled-register-completion/plan.md) and
[C2a design](../../plans/20261021-controlled-register-completion/phase-02a-event-policy-design.md).
Their later extensions require new independently reviewed definitions and proofs;
the frozen 205/206 artifacts and expectations remain unchanged.
