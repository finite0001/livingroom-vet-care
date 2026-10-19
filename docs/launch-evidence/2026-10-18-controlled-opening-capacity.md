# Candidate scalar memory fix and opening capacity acceptance

This batch tests the existing unpublished candidate limits after the
[older available-only stock rehearsal](2026-10-18-old-stock-opening.md).
It adds no canonical migration or hosted engine installation. It intentionally
changes three installed candidate scalar helpers from SQL to PL/pgSQL:
`native_fulfillment_hash`, `native_fulfillment_decimal` and
`native_fulfillment_receipt`. Their original expressions remain exact.
The opening validator, all ten canonical writer bodies, 204 migration files and
independent trusted-189 reference remain unchanged.

An earlier separate 200-dispense opening run exhausted its owned database's
memory; matching Docker and kernel ownership evidence confirms that OOM.
A bounded unchanged-source diagnostic localized retention to SQL-function
contexts: 1,545,522,072 context bytes against an adjacent 1,564,332,032-byte
backend RSS sample. SQL-function contexts accounted for 1,494,369,216 bytes;
seven native-hash contexts held 1,300,349,264 bytes. The exact allocating core
operation or installed extension hook was not identified.

The same full 200-dispense diagnostic, with all deferred constraints retained,
completed after the three scalar implementation changes. Maximum sampled
container memory was 458,856,857 bytes (about 438 MiB); backend RSS was
350,584,832 bytes. No cancellation, emergency stop or OOM occurred. Its independent
128-call, parent-primed hash regression observed zero additional native-hash
SQL-function context bytes. These are local diagnostics in the pinned environment,
not production workload measurements or capacity approval. Failed, canceled and
setup/parser-error attempts are retained privately and excluded from passing
coverage. The earlier combined-maxima failure's exact cause remains unproven.

Both compatibility runners capture the actual original SQL definitions against
the trusted reference before installing the candidate. After installation, they
permit only `prolang` and `prosrc` to change. All other `pg_proc` attributes,
including each function's OID within that installation, owner, ACL, invoker status,
argument names/types, null behavior, search path, cost and parallel classification,
match exactly. Name/schema-only copies of the captured originals provide
independent SQL oracles. Thirty-six value/error cases cover ten hash, fourteen
decimal and twelve receipt cases, including SQL null versus JSON null, numeric
scale/rounding/overflow/nonfinite outcomes, null composites, nested JSON and
ambient UTC/Denver/Kathmandu timestamp serialization. SQLSTATE and error messages,
JSON text and UTF-8 bytes match. Six language checks and the separate 128-call
memory regression also pass. These same 36/6/1 families run once in the ordinary
stack and once per historical era; repeated executions are not new case families.

| Genuine capacity scenario | Accepted assertions | Refusals | Reported observations |
| --- | ---: | ---: | ---: |
| One canonical dispense with 100 allocations | 6 | 2 | 8 |
| 200 single-allocation canonical dispenses, followed by the 201-source refusal | 6 | 9 | 15 |

The two positive openings run full opening/product validation and deferred
constraints in separate UUID-marked disposable databases. Each is explicitly
synthetic, frozen and unattached, with no active register or controlled events.
The prepared-container/cell arrangement is a technical fixture, not a practice
SOP. The scenarios do not establish simultaneous 200-dispense/100-allocation
maxima. The 23 named observations comprise twelve accepted assertions and eleven
refusals; exact preservation/cleanup checks are separate. An additional positive
configuration-rollback assertion executes outside those 23 reported observations.

The canonical 101-allocation **preview request** is refused. A separate privileged
101-allocation source corruption proves the opening count guard. The genuine
201st canonical dispense **succeeds**; subsequent opening validation refuses its
201-source product history despite a shortened 200-entry boundary. No history is
truncated to make it pass.

Structural boundary-count and byte probes remain separate from real acceptance.
Exactly 1 MiB of malformed structural JSON reaches the field guard; one extra byte
fails the size guard. This is not a valid maximum-size opening. A synthetic
1,000-entry head helper checks exact identity/hash; selector/head 1,001 refuse.
Three separate corrupt 1,001-event source families—corrections, returns and
discrepancies—refuse even with requested prefix zero. None is a genuine canonical
1,000-event lifecycle chain.

Configuration transactions roll back to exact committed canonical baselines in
`public`, `auth`, `storage` and `extensions`. The genuine canonical fixtures commit
only inside their marked clones and are removed with those clones. Source
fingerprints, the candidate manifest and all ten writer definitions remain exact.
The shared capacity probe budget is 900 seconds; elapsed times in machine evidence
are fixture observations, not a production benchmark.

The fresh ordinary run passes all 166 canonical SQL suites / 7,338 assertions,
four trusted drift refusals with exact rollback, smoke, managed-native,
opening-boundary, capacity and genuine Auth/PostgREST probes. Its 133 API checks
combine response and SQL setup/state/cleanup assertions; they are not an HTTP
request count. All eight expected lock queues were observed. All 412 bound source
hashes match, and owned container/volume absence was independently checked.
Private ordinary result SHA-256:
`81fcd5faf94126539650d4db5645303cbbd4cefebcd49fbd07888c277f60a606`.

The fresh historical rehearsal retains all seven native outcomes / 83 checks and
two generic openings / 29 checks, including six focused generic refusals. Original
187 history (63 selected relations / 50 rows) and 188 history (66 / 122) remain
exact. All 456 final relation fingerprints per era and populated selected-schema
restore checks pass. Historical sessions remain unchanged; separate validation
only deletes them inside a rolled-back transaction. No retrospective provenance
is manufactured. Both schedulers were paused, drained and restored; all marked databases and
runtimes were removed.
All 248 historical source hashes match, with independently verified container and
volume absence. Private historical result SHA-256:
`9282ec6aeaf1e785d94865bbc7b4c0c9d94c93b96e7ac72690d2a85585bc6f8c`.

The runs use Supabase CLI 2.118.0 and the reviewed GHCR Postgres 17.6.1.171
content pin. All 61 Python harness tests pass, including twenty scalar-contract
tests covering accepted and rejected harness contracts. Independent source and evidence reviews found no material
blockers. [Machine evidence](2026-10-18-controlled-opening-capacity.json) retains
sanitized results, definition hashes and historical source hashes. Exact-head CI
and release status are recorded in the PR and private receipt.

Genuine 1,000-event chains, simultaneous maxima, production workload approval,
exception routes, C1b production assembly, C2 workflows and C3 actual counts/rules
remain separate work. Selected-schema restore does not certify physical
post-backup reconciliation, cluster roles or Storage binaries. Clinical/register
activation remains pending Susan's approval.
