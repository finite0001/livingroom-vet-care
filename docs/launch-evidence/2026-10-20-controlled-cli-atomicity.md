# Controlled-stock CLI migration atomicity

The new offline builder derives a CLI-owned migration body from the released
private artifact without changing its interior SQL. All 287 Python harness tests
pass. The final actual owned CLI rehearsal passed both guarded rollback cases,
independent transaction-barrier observations, a clean temporary migration 205
and an exact no-op retry. All 265 initial source bindings exactly matched the
result map and current files. Independent cleanup confirmed no owned containers
or volumes. Exact-head CI, PR review and Dave's specific merge/release approval
remain pending.

The first runtime attempt is excluded from acceptance. It reached the intended
late-body SQLSTATE P0001, but the strict adapter rejected the CLI JSON error
envelope before completing the full rollback comparison. Its complete private
evidence and cleanup receipt were retained. The adapter now handles that explicit
JSON receipt format while preserving exact state/message matching; the body, SQL
guards and pins are unchanged. This does not turn the first attempt into a
rollback pass.

The released [column ACL seal](2026-10-19-controlled-column-acl-seal.md) is the
baseline. Its private artifact SHA-256 remains
`7165851ab481f2ee2ab41c7347a7db65213b5c647c101eaf4554a973d896c4a7`,
and its independent version-2 expected pin remains
`4755a1f1c53008003a11e94ada3963ae416f6c81f163ec43ed2ffea21d6d2f78`.
The existing 171-function/51-relation manifest, 397 covered columns and ten writer
definitions are unchanged. The repository still contains 204 canonical
migrations. The new body is a release artifact outside that directory; a
rehearsal may create migration 205 only inside its owned disposable project.

This distinction matters because the pinned Supabase CLI 2.118.0 executes files
with authored transaction controls through its sequential path and inserts the
migration ledger row afterward. A file that commits itself can therefore finish
its engine changes before that ledger insertion. With no authored transaction
controls or pipeline-incompatible commands, the CLI batches the migration body
and ledger insertion together. These are execution-path facts from the
[pinned migration implementation](https://github.com/supabase/cli/blob/v2.118.0/apps/cli/src/command-internal/migration-apply.ts#L440-L548),
separately exercised by the actual failure rehearsal below.

The builder first verifies the unchanged release assembly, independent pin,
canonical prefix and input hashes. It removes exactly the seven-byte opening
`begin;` line and eight-byte final `commit;` line. Restoring those two byte strings
must reproduce the original artifact exactly. Every interior byte, including
function bodies, the exclusive transaction advisory barrier, 204-ledger preflight,
literal metadata comparison and private-access checks, remains present. The
1,173,738-byte body has SHA-256
`9977696d3d6271cbbfe1dee3767dd71b8512d55bcec0c0d65d108745726252b3`.
The builder's `--check` performs no database or hosted operations.

An independent offline execution of the actual pinned
[CLI statement parser](https://github.com/supabase/cli/blob/v2.118.0/apps/cli/src/command-internal/sql-split.ts#L239-L286)
produced exactly the same statement array as the builder's reviewed lexical
framing for this immutable body. There are 93 SQL statements and 94 retained
parser entries: the trailing `CONTROLLED_RELEASE_BEFORE_COMMIT` comment is itself
retained as the final entry. The parser preserves comments and trims boundary
semicolons and whitespace, so the ledger array is not the raw body byte string.
Its canonical JSON array SHA-256 is
`626e9374546764d9a4070f3a0332bd0c7f606812ffe7355abdaea35088b89e7c`
using UTF-8 `json.dumps(sort_keys=True, separators=(',', ':'))` with default ASCII
escaping. The comparison proves this fixed body only; it makes no general parser
equivalence claim and introduces no Node dependency into the builder or CI check.

The offline tests reject altered parent SQL or pins, missing or changed outer
boundaries, reordered or dropped interior bytes, checked-in body tampering,
transaction controls, pipeline-incompatible commands, nontransactional directives
and malformed quoting. They preserve transaction-looking words inside quoted
function bodies and comments. Wrong statement order, changed body statements or
a missing retained comment cannot match the independently pinned ledger array.
These checks do not themselves prove runtime rollback.

The final runtime used Supabase CLI 2.118.0 against a fresh owned 204 replay.
The late-body and actual ledger-insert cases each returned their unique intended
SQLSTATE P0001 only after SQL verified the installed literal engine state and
transaction barrier. Each then proved exact rollback of all 435 original data
relation fingerprints, the captured public and migration catalogs, complete
204-row ledger and ten canonical writer definitions. The ledger test's fixture
was removed and the untouched original baseline compared again. The raw CLI JSON
receipts, executable snapshots and complete observations remain protected.

During both ledger-failure and clean-install cases, an independent gate observed
the actual CLI backend waiting at ledger insertion while retaining the engine's
exclusive transaction advisory lock. A second backend could not acquire the
shared barrier. The observer correlated the live backend identity, backend start,
query start and its gate blocker again before release. All six observer flags
passed in both cases, including clean gate release and observer closure.

The clean actual CLI application retained precisely the independently reviewed
94-entry array in its new migration row, preserved all original 204 rows and
source data, and installed exactly 21 engine relation families. The unchanged
version-2 literal manifest matched its independent pin; all private-access and
zero-configuration/activation checks passed. The fixture catalog was removed.
A second real CLI application was an exact database no-op. Migration 205 existed
only in the owned temporary project, and all repository canonical migrations
remain unchanged at 204.

The private result SHA-256 is
`1bab9656ab66152499a1faace9f517d97254487a6f5ca23fe7bf46c0773500ae`.
The complete archive preserved the preboot source map, all four exact migration
inputs and CLI logs, private observer records and the full baseline. All 265
bindings matched before and after execution. The runtime removal receipt and
independent exact-label inspection both confirmed no containers or volumes.
PostgreSQL 17.6 and its actual image ID, reference and available digests were
captured after ownership verification; these observations are not an independent
expected image pin.

The released PR #287 ordinary compatibility proof with 425 source bindings
remains historical baseline evidence. It is not relabeled as a current-source
pass for these new files. Full ordinary and historical compatibility were not
rerun locally in this batch because the engine SQL, private artifact and expected
pin are unchanged. CI retains both fresh compatibility commands alongside the
new actual CLI lane; their current exact-head results remain pending.

Canonical forward promotion, hosted installation and production C1b admission
remain separate work. This proof does not cover role/schema/default-privilege or
whole-cluster recovery, physical stock reconciliation, C2 review/witness/
transfer/count/report workflows or C3 practice commissioning. Susan's physical
count, SOP, product/unit configuration and practice-rule approval remain pending.
No clinical/register activation, provider request or hosted write is authorized
by this rehearsal.
