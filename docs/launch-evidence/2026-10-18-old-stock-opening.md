# Genuine older available-only opening acceptance

The expanded rehearsal closes the generic-stock opening gap left by
[PR #281's seven native projections](2026-10-18-native-history-upgrade.md).
It creates a separate product through the actual catalog, receipt and adjustment
RPCs at canonical checkpoints 187 and 188, then applies every remaining migration
unchanged through 204. A receipt of 3.000 and adjustment of −0.500 leave exactly
2.500 tablets. No historical rows or provenance are fabricated.

| Checkpoint | Original relations / rows preserved | Generic movement provenance | SQL checks, including three refusals |
| --- | --- | --- | --- |
| 187 | 63 / 50 | 0, unchanged | 14 |
| 188 | 66 / 122 | 2 genuine rows, unchanged | 15 |

The two generic cases are counted separately from the unchanged seven native
outcomes and their 83 checks. The additional original rows belong to the new
generic product, lot, two movements and, for 188, their two original provenance
rows; they do not revise the earlier receipt's counts. Total 188 movement
provenance is now 16; pickup/correction provenance remains zero in both eras.

Each positive case constructs an explicitly synthetic, frozen and unattached
opening with an empty native boundary, both exact signed movement snapshots,
one stock container, one available cell and its matching 2.500 position. Opening,
product and deferred constraints validate. Missing movement membership, a changed
saved snapshot and a 2.499 available quantity each fail at the expected independent
guard, with exact relation and technical-manifest rollback. The outer observation
also rolls back; all 456 selected final relations match afterward. The source
runtime's 25 controlled-data relations remain empty.

For each era, one UUID-marked disposable database receives the populated upgraded
source and commits only the valid synthetic opening prefix. A second marked
database restores that populated opening from a dump of `public`, `auth`,
`storage` and `extensions`. All 456 relation fingerprints match. Canonical source
rows and historical sessions remain exact; only one synthetic opening session is
added in the clone. Each clone has one frozen state, one unattached opening,
zero active states and zero controlled events.

Independent opening/product validation succeeds with empty caller claims in UTC,
America/Denver and Asia/Kathmandu. A separate restored validation deletes historical
sessions inside a rolled-back transaction; the populated fingerprints match again.
Candidate manifests and all ten canonical writer definitions remain exact. The
dump uses the existing scoped-restore adaptations for extension schema creation
and default privileges; it does not certify cluster roles, bootstrap ownership,
default ACL recovery, the migration ledger or Storage binaries.

The historical proof uses Supabase CLI 2.118.0 and the reviewed GHCR
Postgres 17.6.1.171 content pin. The original trusted-189 catalog pin remains
unchanged. All 242 source inputs match after completion. Both schedulers were
paused, drained and restored; all four marked clone databases and both owned
runtimes were removed. Container/volume absence was independently checked again.
Private result SHA-256:
`05828bcf7970d1f34997a1ee5457697b5ebe2c99d3c021ddc7d418e21ff62099`.

Repository checks pass: 1,687 tests, three TypeScript projects and build, with
four existing lint warnings. All 29 Python harness methods pass, including six
new cleanup guards for wrong markers, wrong container ownership, unsafe or unknown
targets, invalid markers and failed deletion. Independent source review found no
material blockers.

The fresh full ordinary candidate run also passed: 166 canonical SQL suites /
7,338 assertions, four trusted drift refusals with exact rollback, smoke, native
managed, opening-boundary and genuine Auth/PostgREST probes. All 406 source hashes
match. Its 133 API checks include response and SQL setup/state/cleanup assertions;
they are not an HTTP request count. All eight expected lock queues were observed,
and owned containers/volumes were removed and independently checked absent.
Ordinary result SHA-256:
`57434febcddfe60e19c61f7e22f9dca2369015fe7ffd4dee2de4097da7147698`.
[Machine evidence](2026-10-18-old-stock-opening.json) retains the sanitized results
and historical source hashes. Exact-head CI and release are recorded in the PR
and private receipt.

This is synthetic SQL acceptance of existing candidate behavior. It adds no
canonical migration, application flow, new clinical policy or hosted engine.
Capacity review, exception routes, C1b production assembly, C2 workflows and C3
actual counts/rules remain separate. Clinical/register activation remains pending
Susan's approval. Selected-schema restore is not physical post-backup
reconciliation or certification of historical clinic data.
