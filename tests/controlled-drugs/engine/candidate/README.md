# Isolated controlled-stock execution candidate

This directory contains executable **owned-local test code**. The exact reviewed CLI body is also promoted as canonical migration `20261020151157_controlled_stock_private_engine.sql`; that repository promotion does not install it on a hosted backend. It implements the proposed C1b prepare/execute/read/cancel protocol and physical source/container posting so its invariants can be exercised before a production migration is prepared. It does not complete C1b release acceptance, C2 workflows or C3 commissioning. Susan’s rules remain draft and inactive.

```sh
python3 -B tests/controlled-drugs/engine/candidate/run-local.py --run-synthetic-local --include-sql-regression
```

Docker, Supabase CLI and free local ports 64620/64621/64622/64624 are required. The runner requires the exact 204-migration baseline, copies canonical migrations into a uniquely named owned project, verifies Docker project/workdir labels, and preserves all ten canonical writer definitions. It never reads a hosted project link or local `.env`. Automatic jobs are paused and drained only in this owned server using [pg_cron’s documented `cron.launch_active_jobs` setting](https://github.com/citusdata/pg_cron#extension-settings); schedule rows stay intact and every selected relation remains fingerprinted. Before installation, it checks the byte-pinned `trusted-prior-189.json` retained from the original canonical 189-migration replay. The first 189 current migration sources must match the original source digest, and the scoped catalog after all 204 migrations must still equal that independent reference. It never recaptures the current candidate as its expected prior. An exclusive practice barrier precedes the installation’s comparison. The prior snapshot pins 116 functions/30 relations and effective grants, RLS, columns, constraints, triggers and indexes. The untouched replay is compared first, so a CLI/Postgres bootstrap difference fails closed before drift injection and is reported as metadata paths rather than rollback damage. The passing October 18 proof uses Supabase CLI 2.118.0 and exactly matches the retained reference; CLI 2.115.0/Postgres 17.6.1.159 produces different explicit ACLs on three PUBLIC-executable helpers and is not silently accepted. Specifically, it omits explicit `anon`/`authenticated`/`service_role` EXECUTE entries on `has_role(uuid,user_role)` and `protect_profile_privileges()`, and the explicit `anon` entry on `is_active_staff(uuid)`; each still has PUBLIC EXECUTE. CI is aligned to the independently proved CLI 2.118.0 environment. No missing grants are added and no raw ACL differences are normalized away. Four deliberate definition/grant/RLS/trigger changes must each fail before engine DDL and roll back exactly. Never regenerate the reference from hosted drift. It installs the candidate only in this disposable stack, then removes its containers, volumes and private working files on completion or failure. Protected logs and sanitized source-bound results remain in the printed temporary evidence directory. `--include-sql-regression` runs the current 166 canonical SQL suites/7,338 assertions with the candidate installed.

The 21 private relation families have RLS and raw PUBLIC/anon/authenticated/service-role access revoked. Helpers and the four new entry points are initially revoked too. The genuine Auth probe temporarily grants only the four owned entry points to `authenticated` in this owned local runtime. No site/policy/opening/activation RPC is granted. Explicit synthetic sites, product classifications, permissions, units and opening counts are test inputs; neither these fixtures nor their `witness: none` permissions are practice rules.

The protocol reserves each operation UUID, freezes original canonical arguments separately from controlled context, serializes root/product/container work, and rechecks live staff/session authority after waits. It invokes the existing canonical writer once, reconciles every actual movement/native allocation, writes immutable events/lines/custody transitions, advances guarded positions/heads, saves the exact receipt, and clears executing authority before return. Receiving, available stock, prepared medication and return-held medication stay distinct. Return corrections retain actual opposite movements and original cell identities; pickup amendments do not replenish physical stock. Stored provenance can be validated without the original recorder’s live session. Saved receipts retain their original transitions after later head/catalog changes.

| Probe | Evidence |
| --- | --- |
| `probe-smoke.py` / `smoke.sql` | Fractional receive/adjust, stale reviews, changed payloads, permanent cancellation, foreign owner, shared/exclusive upgrade rejection, same-packet generic/raw context borrowing, exact recovery; all source relation fingerprints unchanged after rollback |
| `probe-native.py` / native fixtures | 24 managed actions across nine producers; receiving is tested separately. All six return actions, three correction kinds and four discrepancy actions; independent available/prepared/held and billing totals; one anesthesia treatment/debit/charge |
| `probe-opening.py` / `opening-boundary-acceptance.sql` / `opening-history.sql` | Separately counted populated opening-custody boundary acceptance; original native prefixes, exact cell reconciliation, refusal rollback fingerprints and marked clone/restore cleanup. Synthetic engineering evidence, not commissioning or genuine Auth/API coverage |
| `probe-capacity.py` / `opening-capacity*.sql` | Separate genuine 100-allocation and complete 200-dispense opening scenarios; genuine 201st-source refusal, separately labeled structural byte/head/count probes and corruption injection; committed canonical fixture rows exist only inside marked disposable clones |
| `run-native-history.py` / `native-history-*.sql` / `native_history_restore.py` | Genuine canonical 187/188 record creation followed by unchanged upgrades to 204; seven native projections plus two separate available-only opening cases, original-column preservation, rollback fingerprints and persisted unattached opening restore |
| `fault-probes.sql` | Failures after inventory, billing, controlled-line and action inserts; every relation fingerprint must match the pre-execution state after rollback |
| `integrity-probes.sql` | Missing/forged lines, foreign source, changed opening, skipped head, broken custody predecessor, rolled-back state head, changed unit, forged event hash/frame and forged new-container identity must fail independent validation |
| Populated managed restore | Eight owned-API rejections under repeatable-read/serializable isolation; four stale-context/recovery checks prove an old server/transaction row is not authority and a new owned action replaces/clears it once. Exact schema/data restore of all selected public/Auth/Storage/extensions relations, manifest equality, source/event/product validation without caller claims; both marked clone databases removed and original runtime unchanged |
| `probe-api.py` | Genuine Auth/PostgREST, raw/helper denials, DB roles overriding misleading Auth metadata, ownership/recovery/cancellation, actual root/product/final-container queues, authority revocation after observed blocking, atomic rollback and concurrent same-UUID exact single commit; an exclusive freeze drains an admitted managed writer, queues the next writer before native resources, and suspension preserves saved recovery while denying an ordinary fallback |

The initial trusted prior reference is checked before any persistent engine object is created; it is not recaptured during normal runs. Local post-install technical-manifest construction and temporary resealing support development fixtures and fault injection only. **Do not reuse those operations to accept hosted drift.** The isolated installer now implements the trusted prior comparison and atomic drift rejection. The dated October 15 receipt reports matching scoped metadata on both hosted backends then; the historical 203 forward-port and the current 204 compatibility run perform no hosted comparison. A production migration must reuse reviewed preconditions and still complete opening/old-source/hold/exception coverage, independent review, exact-head CI, and stage-first installation/rollback/advisor comparison before primary rollout. The new freeze/isolation/stale-context proofs do not commission a physical register. Clinical activation additionally requires the C2 workflows and Susan’s actual product/site/unit/count/SOP/current-authority acceptance in C3.

The restore proves recorded database history, not actual physical history after a backup or Storage binary disaster recovery. No live provider, payment, email, payroll or clinical activation is tested or authorized here.

The separate [migration-204 compatibility receipt](../../../../docs/launch-evidence/2026-10-18-controlled-candidate-204-compatibility.md) preserves the current 166-suite/7,338-assertion proof without relabeling the historical 203 evidence. Its raw `api_checks: 133` counts combined Auth/PostgREST response and SQL setup/state/cleanup assertions, not HTTP-only checks or requests.

## Frozen private installation artifact

`release_assembly.py` builds the separate offline
`engine/release/controlled-stock-private.sql` artifact. Its expected catalog comes
from the independently reviewed PR #285 proofs retained in the released #286
pin, with an independently replayed #286 column-ACL supplement and the reviewed
manifest-function delta for format version 2. It is not captured from the installation
being checked. The unchanged original trusted-189 reference remains the prior
catalog authority. The release pin binds all 204 migration files and 14 assembled
SQL sources, 171 scoped functions, 51 relations and ten canonical writer bodies.

```sh
python3 -B tests/controlled-drugs/engine/candidate/release_assembly.py --check
python3 -B tests/controlled-drugs/engine/candidate/run-local.py --run-synthetic-local --use-release-assembly --include-sql-regression --include-correction-capacity --include-correction-restore
python3 -B tests/controlled-drugs/engine/candidate/run-native-history.py --run-synthetic-local --use-release-assembly
```

The explicit opt-in uses only owned disposable stacks. It verifies committed
artifact bytes, checks the migration ledger and prior catalog before persistent
DDL, and rejects a partial engine. All hooks and revocations belong to one
transaction. The resulting catalog must equal the frozen literal before that
literal is inserted as the initial manifest. No expected-value recapture or
resealing operation is exposed by the artifact builder.

The atomic rehearsal checks prior and installed catalog drift, plus injected
failures after schema creation, after all hooks and before commit. Every refusal
must reach its identified stage and return the exact SQLSTATE/message, followed
by exact preservation of all selected relation data, prior metadata, ten writer
definitions, migration ledger and permanent engine-object absence. A successful
installation must retain private effective RPC/table privileges and RLS, one
literal manifest, unchanged original source data and no configuration, openings,
active state or controlled events. Existing compatibility and restore probes
then exercise the installed artifact separately from these installation checks.

This is scoped catalog verification, not a complete database or cluster pin.
Roles, schema privileges, default ACLs, extensions and unlisted canonical
dependencies remain outside the manifest. No canonical migration is added by
this packaging step. Canonical promotion, hosted stage-first installation and
advisors, C2 workflows and C3 reconciliation/commissioning remain separate work.
Do not copy this explicit `BEGIN`/`COMMIT` script blindly into a CLI migration:
the [pinned CLI executor](https://github.com/supabase/cli/blob/v2.118.0/apps/cli/src/command-internal/migration-apply.ts#L440-L469)
inserts its ledger row after authored statements. Promotion requires a
reviewed CLI-owned transaction and actual ledger-insert failure rollback tests;
the owned `psql` rehearsal does not establish that boundary.
Clinical/register activation remains pending Susan's approval.

## Opening custody contract

`opening.sql` defines the private projector
`controlled_stock_opening_native_entry(opening_id, dispense_id, return_version,
correction_version, discrepancy_version, pickup_id)` and the independent
`controlled_stock_validate_opening(opening_id)` validator. These are candidate
helpers, with the same default revocations and manifest coverage as the other
private engine routines.

The private construction helper
`controlled_stock_opening_native_entry_for_product(product_id, stock_unit,
dispense_id, return_version, correction_version, discrepancy_version, pickup_id)`
produces the same verified native entry before the immutable opening row exists.
The opening-aware wrapper and validator then bind it to the actual opening's
product, policy unit and exact source membership. This avoids updating an opening
or bypassing its immutable trigger merely to assemble a fixture.

Each `native_custody_boundary` entry has exactly `version: 1`, `dispense_id`,
`dispense_document_hash`, `dispense_operation_hash`, `return_head`, `correction_head`, `discrepancy_head`,
`pickup`, and `allocations`. Heads are `{event_id, version, record_hash}`; the empty
prefix is `{event_id: null, version: 0, record_hash: null}`. Pickup is null or
`{id, document_hash, operation_hash}`. Operation hashes cover the existing
`native_fulfillment_receipt` canonical JSON, including the original request,
result and operation timestamp, using UTC. They retain opening-time receipt
content; they are not signatures, raw network-byte hashes, or proof of truth
before the opening was constructed. Allocations sort by original allocation ID and contain
`allocation_id`, `lot_id`, `dispensed_quantity`, `prepared_quantity`, and `held`.
Held entries sort by original intake ID and contain `intake_id` and `quantity`,
including zero quantities needed to retain source membership. Quantity strings
use the existing native three-decimal formatter. A supplied entry must equal its
verified canonical projection, including keys, identities, heads and quantities.

The retained prefix belongs to the opening; later managed activity does not
replace it with today's replay. Source membership, rather than time or UUID
ordering, distinguishes opening evidence from later controlled event links.
Opening available/prepared/held quantities are checked independently; already
dispensed stock is not counted twice. The product validator checks an existing
opening even before the state head attaches it. Unsupported custody/discrepancy
routes remain unavailable. The proof reports its actual assertion counts and
limitations separately from the historical compatibility receipts.

Native dispense and pickup opening evidence also requires the existing C1a stock
provenance and its original immutable operation receipt. Older dispenses missing
movement provenance and older pickups missing pickup provenance are unsupported;
a synthetic missing-provenance mutation alone is not a historical-upgrade proof.
Retained canonical annotation heads have a different guard from managed source
admission: projecting an older annotation does not prove it can be posted as a new
managed action. Available-only old movements retain their exact opening snapshots.
Any supported exception route remains separate work.

The separate populated upgrade rehearsal uses the reviewed CLI 2.118.0.
It accepts the exact Postgres 17.6.1.171 reference from ECR or the CLI's official
GHCR fallback, and inspects the owned container's immutable image ID to require
the reviewed repository-qualified index or matching Linux platform manifest
digest. A matching tag alone is insufficient. The independently retained
trusted-189 catalog comparison remains unchanged; no bootstrap ACLs are normalized.
Its two eras use separate local port blocks: 64630/64631/64632/64634 for 187
and 64640/64641/64642/64644 for 188. These stay separate from the ordinary
runner's 6462x block so recently closed Auth/API sockets do not collide between
rehearsals; occupied ports still fail the startup guard.

```sh
python3 -B tests/controlled-drugs/engine/candidate/run-native-history.py --run-synthetic-local
```

It seeds through actual canonical APIs before provenance migrations exist, exports
fixture IDs privately, and applies every remaining migration unchanged. Original
native/inventory/billing/client/actor columns are fingerprinted across the upgrade;
all public/Auth/Storage/extensions rows are fingerprinted after installation and
after each observation. It never backfills provenance. The seven native projector
cases create no controlled configuration. Two additional cases use an independent
generic product received and fractionally adjusted through each era's original
RPCs, then construct a synthetic, frozen and unattached available-only opening.
Exact original movement snapshots and lot totals are validated, with focused
missing/changed snapshot and wrong-quantity refusals; the entire observation rolls
back. A marked disposable clone alone commits the valid unattached opening before
dump/restore and independent validation. Its installer shares the exact pinned
assembly used by the ordinary empty-Auth runner, whose precondition remains
unchanged. These selected-schema synthetic restores do not establish production
backup recovery, historical clinic-data correctness or physical counts.

The [dated native-upgrade receipt](../../../../docs/launch-evidence/2026-10-18-native-history-upgrade.md)
records the seven outcomes, preservation boundaries and ordinary compatibility
checks without treating entry projection as register commissioning. That receipt
describes the earlier seven-case source; the separate
[old-stock opening receipt](../../../../docs/launch-evidence/2026-10-18-old-stock-opening.md)
records the expanded rehearsal without rewriting its historical counts.

Candidate capacity is explicit: at most 200 product dispenses/boundary entries,
100 allocations per dispense, 1,000 events per dispense per native history family (including
later managed history), and a 1 MiB boundary. Exceeding these limits refuses; it
never truncates evidence. The capacity probe exercises real canonical writers
before a frozen, unattached opening, separated by actual transaction boundaries.
The 100-allocation and 200-dispense maxima use independent scenarios and do not
establish combined-maximum acceptance. The 201st canonical dispense is created
after rolling back configuration; a new
freeze must reject its shortened 200-entry boundary. Configuration rollback is
checked against exact committed-history fingerprints, and the source runtime
remains unchanged. Structural 1 MiB/head probes and deliberately corrupted
over-limit source rows are reported separately from genuine opening acceptance.
Genuine 1,000-event return and discrepancy chains, combined-maxima stress,
production workload capacity review and commissioning remain separate work.
No supported limit changes in this batch.

The optional correction-chain feasibility probe uses real canonical operational
annotations for one dispense and one allocation. It runs in its own UUID-marked
clone, commits at most 32 canonical writes per fresh backend, and records aggregate
64/128/256/512/1,000 checkpoints. A single 900-second budget covers setup,
ownership checks, fixture phases and final source/manifest verification. After an
explicit first calibration batch, each next batch uses the latest completed batch's
elapsed time, cubic work growth, a factor of two and a 120-second reserve. The
full-goal forecast remains a diagnostic with unknown completion, not an admission
condition. Append batches, bootstrap and correction 1,001 have a real deadline
120 seconds before the global deadline. Exact replay runs in the positive
validation phase under the global deadline. Each command recomputes remaining time
after ownership checks and rejects late results. Safety cleanup may finish later,
but exact cleanup remains mandatory before acceptance. A stopped attempt produces
diagnostic evidence and no acceptance proof.

```sh
python3 -B tests/controlled-drugs/engine/candidate/run-local.py --run-synthetic-local --include-sql-regression --include-correction-capacity
```

The passing [correction-capacity receipt](../../../../docs/launch-evidence/2026-10-19-controlled-opening-correction-capacity.md)
includes a fully validated frozen, unattached opening at
1,000 corrections, exact receipt replay, and refusal of opening evidence after a
genuine 1,001st canonical annotation. A fresh full ordinary run passed with this
optional local flag; CI enables it explicitly. It does not
prove 1,000-event return or discrepancy chains, simultaneous maxima, populated
restore at that depth, a production workload limit or approved practice rules.

Canonical receipt replay in a fresh transaction also appends its writer-admission
audit row. The probe verifies exactly that expected row with all original audit
rows retained, then compares complete before/after relation fingerprints against
the actual checkpoint and post-configuration rollback. Every relation remains in
the private snapshots; the audit append does not create another correction event,
receipt, stock movement or charge.

The separate `--include-correction-restore` local opt-in reuses this same
1,000-correction producer and runs before the genuine 1,001st write. It persists
the valid frozen, unattached opening in one marked clone and restores its selected
schemas into another. All relation fingerprints, canonical history and audit rows
must match; fresh validation uses UTC, Denver and Kathmandu without caller claims.
It shares the correction probe's original 900-second workload deadline and
120-second append reserve. A stopped or unsuccessfully cleaned attempt supplies
no restore acceptance. The targeted rehearsal and fresh full ordinary run passed;
CI now requests this restore explicitly alongside its existing capacity flag.
The [populated correction-history restore receipt](../../../../docs/launch-evidence/2026-10-19-controlled-correction-history-restore.md)
records all 456 selected relations, seven fresh validations and the unchanged
eleven capacity observations, including the actual 1,001st append. The full run
also passed 166 SQL suites/7,338 assertions and its separate genuine Auth/API gate.
Selected-schema logical restoration does not certify cluster-role, ownership,
default-privilege or Storage binary recovery, physical reconciliation or practice
approval. Clinical/register activation remains pending Susan's approval.

The synthetic operational-annotation producer takes a real preview at each
batch boundary, binds every actual canonical receipt to its stored operation and
event, and advances only the expected head between writes. The unchanged
canonical writer still verifies the complete history on every append. A final
real preview must match the derived context and hash before the batch commits.
The 33 committed batches contain 1,001 writes and 66 endpoint previews; this is
not a count of all preview calls in the workload. A separate three-write contract
refuses eight altered receipts and two stale canonical contexts with exact
`PT409`, then rolls back every selected relation and the technical manifest.
Those contract checks are separate from the eleven capacity observations and
seven restore validations. No deadline, reserve or batch limit is relaxed.

On a child-probe failure, the parent prints only a sanitized fixed-category
summary and bounded correction checkpoint timing. Raw errors, SQL, fixture IDs
and private fingerprints stay in protected logs. An unrecognized error remains
`unknown`; partial progress is never acceptance. Cleanup confirmation prints only
after exact owned container and volume absence checks. This reporting does not
change workload deadlines, writer reserves or product guards.

CI runs both complete rehearsals in a separate `controlled-stock` job on native
`ubuntu-24.04-arm`, covered by the existing reviewed Linux ARM64 Postgres pin.
This job starts only its owned disposable stacks; it does not share the database
job's long-lived foundation or earlier concurrency workloads. The four existing
jobs retain their original runner labels, including the native AMD64 renderer.
All five jobs must pass. Isolation follows observed next-batch reserve refusals
at 928 corrections on both x64 and ARM64; it supplies no acceptance by itself
and changes no workload, supported limit, deadline or reserve.

`scalar-helpers.sql` intentionally changes the implementation language/body of
`native_fulfillment_hash`, `native_fulfillment_decimal` and
`native_fulfillment_receipt` from SQL to PL/pgSQL. Their original expressions,
signatures, OIDs, owner, ACLs, volatility, null behavior, caller timezone behavior
and other catalog attributes remain unchanged. This bounds the dominant retained
SQL-function contexts observed during repeated opening checks; it does not alter
the opening validator or any of the ten canonical writer bodies. Both runners
capture actual original definitions against the unchanged trusted-189 reference
before installation, then compare 36 value/error cases with independent SQL
oracles and check 128 parent-primed hash calls for retained context growth. This
is a local candidate overlay, not a canonical migration or hosted installation.
The [capacity and scalar-memory receipt](../../../../docs/launch-evidence/2026-10-18-controlled-opening-capacity.md)
records the fresh full compatibility and historical proofs, separate maximum
scenarios and their limits.

Opening validation checks the retained boundary and exact later-source partition.
The existing deferred guards validate each new/root managed event, and the restore
probe separately audits every historical managed event. The opening helper does
not repeat that complete event audit for every deferred product check.

Only three independently reconstructed result fields compare as finite typed
instants: slot `opened_at`, slot `closed_at`, and the verified linked-refill event's
`created_at`. Their keys must exist, their strings require explicit offsets, and
null is allowed only where reconstructed state requires it. Every other result
field, including nested refill snapshots, remains exact. The original stored JSON
is never repaired or normalized; the retained operation-receipt hash still binds
its exact opening-time content, including timestamp spelling.

The opening-history fixture uses real canonical writers under UTC,
America/Denver and Asia/Kathmandu and validates from other caller timezones and
after populated restore. It separately tests genuine same-unit foreign-product
identities and historical-result mutations. Per-zone repeated baseline counts and
new distinct case families are reported separately; execution evidence is recorded
in the dated history-compatibility receipt. These cases do not establish genuine
pre-C1a native upgrade support, a general legacy repair route or commissioning.

The [dated history-compatibility receipt](../../../../docs/launch-evidence/2026-10-18-controlled-opening-history.md)
records the three-zone full run: 27 baseline refusal/14 positive families plus 33 new
refusal/seven positive families, separately counted from repeated executions.
All 399 bound source hashes matched; no canonical/hosted engine installation or
clinical/register activation occurred.


### Ongoing column ACL drift (manifest format version 2)

Manifest format version 2 includes explicit column grants for every column in
its existing 51 scoped relations. Each entry retains grantee, grantor, privilege
and grant option, sorted by role names with C collation. An absent direct column
ACL is an empty array; implicit owner access remains valid. Existing table and
function ACL coverage remains separate from these direct column grants.

The original released v1 expected pin is preserved verbatim in
`release-expected-204-v1.json`; the v2 pin is derived from that reviewed
reference plus an independently verified old-release column-ACL supplement and
the explicitly reviewed snapshot-function delta. The new installation is never
used to adopt its own expected baseline. Both pins are bound in rehearsal inputs.

The owned-local rehearsal adds real column grants after successful installation,
requires exact manifest refusal, and compares original data, catalog/column ACLs,
manifest, ledger and writer hashes after rollback. The managed populated restore
repeats these checks against its independently marked clone. That four-schema dump
does not restore the migration ledger; the clone checks and preserves its absence.
No synthetic grant is resealed. The focused, full ordinary and genuine historical
runs passed; the
[new evidence](../../../../docs/launch-evidence/2026-10-19-controlled-column-acl-seal.md)
records their source bindings, cleanup and scope. Released v1 evidence describes
the earlier coverage.

This extends detection of direct column ACL drift inside the existing catalog
scope. It does not prevent an owner from changing the database or cover role
membership, unlisted relations, schema/default ACLs or every dependency. Canonical
migration promotion requires the separate CLI transaction proof below and a
reviewed forward-port with distinct preinstallation and post-migration lanes.
Hosted installation and clinical/register activation remain pending.


### CLI-owned transaction and ledger atomicity

`release/controlled-stock-cli-body.sql` is derived from the unchanged private
release artifact by removing only its outer `begin;` and final `commit;` lines.
The reversible builder verifies all parent pins and preserves every interior byte.
This lets Supabase CLI 2.118.0 batch the engine installation and its genuine
migration-ledger insertion in one transaction. Check the frozen body offline:

```sh
python3 -B tests/controlled-drugs/engine/candidate/cli_migration_body.py --check
```

Run the separate owned-local proof with Docker and free ports
65020/65021/65022/65024:

```sh
python3 -B tests/controlled-drugs/engine/candidate/run-cli-atomicity.py --run-synthetic-local
```

The runner copies the original 204 migrations into a disposable project. A
migration 205 exists only there. Guarded late-body and actual ledger-insert
failures must each restore the full captured logical catalog, original data and
204 ledger rows. During both the ledger failure and clean installation, an
independent connection observes the actual CLI backend at ledger insertion,
still holding the exclusive engine barrier, and cannot acquire its shared lock.
The clean application uses the exact frozen body; its genuine ledger row must
match the independently reviewed CLI parser array of 94 entries (93 SQL
statements plus the retained final comment). A real retry must be an exact no-op.
No ledger history is repaired and no expected installation baseline is recaptured.

The [dated CLI evidence](../../../../docs/launch-evidence/2026-10-20-controlled-cli-atomicity.md)
records the actual local pass, source bindings, rollback and cleanup audits, and
an excluded earlier receipt-adapter failure. CI retains the full ordinary and
historical compatibility runs and adds this proof. Its actual runtime image is
recorded; this standalone driver does not enforce an independent image pin.

The original dated receipt describes a local transaction-boundary proof against
204 canonical migrations. The canonical promotion and full post-205 compatibility
lane are described separately below. Hosted installation, C2/C3 completion and clinical/register activation are
not established. Susan's clinical and register approval remains pending.


### Canonical migration 205 and independent preinstallation proof

The canonical migration contains the exact frozen CLI body `997769…252b3`, with
no SQL rewrite or expected-pin update. `canonical_prefix.py` accepts precisely
205 repository files: the independently pinned original 204 files plus this exact
filename and body. The core release assembly still accepts only its original
204-file input. The offline artifact checks validate the full repository before
selecting that original prefix.

CI now selects the canonical lane for the full ordinary and historical runs:

```sh
python3 -B tests/controlled-drugs/engine/candidate/run-local.py --run-synthetic-local --use-canonical-migration --include-sql-regression --include-correction-capacity --include-correction-restore
python3 -B tests/controlled-drugs/engine/candidate/run-native-history.py --run-synthetic-local --use-canonical-migration
```

Both runners capture the untouched 204 stage before installation; historical
runs first create genuine 187/188 seeds and upgrade them to 204. Prior metadata
and original SQL scalar implementations are captured before installation, and ordinary failure
rehearsals stay on that untouched baseline. The canonical file is then copied to
the owned project and applied by Supabase CLI 2.118.0. Canonical mode never runs
the private SQL installer a second time. The strict postinstall verifier compares
all original source data and complete 204 ledger rows, exact new filename/version/
name/94-entry array, ten writer definitions, the independent version-2 literal
manifest, and private zero-activation state. Scalar compatibility uses the actual
preinstallation originals. Historical replays retain their genuine 187/188 seeds.

Installed column-ACL probes require explicit verified-205 ledger context. A
populated selected-schema restore still has no migration ledger, and its separate
absence checks remain strict. Current disposable application runtimes deliberately
require 205 and the exact new migration version; historical preinstallation checks
remain at 204. The actual CLI atomicity runner uses this canonical filename for
clean application and retry, with negative variants confined to its owned copy.

The [canonical promotion evidence](../../../../docs/launch-evidence/2026-10-20-controlled-canonical-205.md)
records source-bound execution results and any pending checks. Repository promotion
and local compatibility do not establish hosted installation, physical stock
reconciliation, complete C1b acceptance, C2 workflows or C3 commissioning. Susan's
clinical/register approval remains pending.


The attachment metadata/original race fixtures now clone the independently
verified current schema and data, including its real 205 ledger and manifest.
They refuse conflicting fixture identities or attachment data, verify the clone
against the independent pin and source fingerprints, then check source
preservation and marked cleanup. They no longer drop the copied public schema or
manually replay canonical SQL without a ledger. This is a logical fixture clone;
publication/subscription and whole-cluster recovery remain outside its scope.

Current counted migration guards also contribute to their existing test receipts.
The exact reconciliation, controlled-draft and stock-writer receiver totals include
that extra assertion; unrelated inventory and operational-task totals are retained.
