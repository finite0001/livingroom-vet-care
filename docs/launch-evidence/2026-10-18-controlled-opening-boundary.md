# Controlled opening custody boundary acceptance

The isolated controlled-stock candidate now validates persisted openings before
attachment and independently reconciles original movement snapshots, native
allocation identities, retained source prefixes, and available/prepared/held
cells. It preserves the exact historical boundary after later managed activity.
This release adds no canonical migration or production engine installation.

The complete owned local run on source base
`04afcf1b621f72a564af1dcd5165bfb10e121e78` used Supabase CLI 2.118.0 and
Postgres 17.6.1.171. All 398 final bound source hashes still matched after completion.
The original trusted-189 reference was not regenerated: its scoped metadata still
matched after 204 migrations; all four injected drift cases rolled back, and all
ten canonical producer bodies remained unchanged.

| Evidence | Observed result |
| --- | --- |
| Repository checks | 1,687 unit tests, three TypeScript projects, build; zero lint errors, four existing warnings |
| Canonical SQL with candidate installed | 166 suites / 7,338 assertions |
| Existing managed probe | 24 actions across nine producers, four injected late failures, 11 corruption refusals |
| New populated opening probe | 27 refusal cases / 14 independently expected positive SQL assertions |
| Real pre-opening native history | Three dispenses, one pickup, six return events, one annotation, two discrepancy events |
| Explicit transaction commit refusal | Invalid unattached available cell reached COMMIT and failed with SQLSTATE 23514; fingerprints unchanged |
| Later managed activity | One pickup and one annotation; four SQL assertions; original pickup-null and correction-version-1 prefixes preserved |
| Populated opening restore | 456 exact relation fingerprints; validators passed without caller claims and with actual historical sessions deleted inside a rolled-back restore transaction |
| Separate genuine Auth/PostgREST probe | 133 combined response and SQL assertions; eight observed lock queues |
| Cleanup | Both marked clone databases removed; owned runtime, containers, volumes and working directory removed |

Hand-expected opening available quantities were 8.125 and 82.125, prepared 17,
and held 0.750. Four zero held entries were retained. One allocation’s 2.500 prepared balance was
split 1.250/1.250 across two opening containers without inventing a new allocation.
Every rejected write preserved scoped relation fingerprints and the manifest.
The SQL-only opening probe does not claim genuine Auth/API coverage. The separate
`api_checks: 133` counter combines Auth/PostgREST response and SQL
setup/state/cleanup assertions; it is not an HTTP request count.

The first rehearsal passed canonical SQL, smoke and managed checks but stopped on
a local-variable/SQL-alias collision (`42702`) before completing opening acceptance.
Its protected log and successful cleanup remain recorded separately. The corrected
run renamed that alias and removed a redundant full historical-event audit from
each deferred opening check. Existing deferred new/root guards and the restore
probe's explicit audit of every historical event remain. No expected baseline,
producer bodies or test counts were weakened to obtain the passing run.

A subsequent review corrected an overstated SQL test comment; a further complete
rehearsal of that final source passed. The preceding successful receipt remains
separate in the machine evidence.

Receipt hashes retain canonical opening-time request/result content in UTC. They
are not signatures or proof that data was true before the opening was constructed.
The existing request target binding, not an isolated hash comparison, rejects the
equivalent-decimal mutation. The cases named `foreign_boundary_dispense` and `foreign_allocation_identity` use
nonexistent IDs; populated foreign-product fixtures remain separate.

Capacity is bounded: 200 total product dispenses/boundary entries, 100 allocations
per dispense, 1,000 events per dispense per history family (including later history), and a
1 MiB boundary. Exceeding a limit refuses rather than truncating. Native custody
requires current C1a provenance and original operation receipts; genuine pre-C1a
native upgrade acceptance remains outstanding. Available-only old movements retain
exact snapshots. Positive receipt fixtures use UTC; historical ordinary SQL
receipts from other time zones need separate compatibility acceptance.

Hosted writes and provider requests were zero. Practice rules remain draft and
inactive. This does not complete wider C1b historical/exception acceptance or
production assembly, C2 review/witness/count/transfer/reporting, C3 physical
commissioning and Susan's approval, physical post-backup reconciliation, or Storage
binary recovery. Exact-head CI and production frontend release are tracked on the
PR; this evidence does not claim they occurred before the PR existed.

Successful private result SHA-256:
`db0596bb03be88b68a14c7a993042ee0ec5bf3f89c678daa85dd6f32c3876148`.
Protected runner log SHA-256:
`6b50b7b512957d01e4c48c7634899e900115ce4240bf5622dbf64927b3d1f83b`.
[Machine evidence](2026-10-18-controlled-opening-boundary.json) retains the full
source inventory, separate probe counters, earlier failure and cleanup checks.
