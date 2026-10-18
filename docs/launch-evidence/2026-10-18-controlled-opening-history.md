# Controlled opening historical receipt compatibility

The isolated controlled-stock candidate now accepts equivalent timestamp offsets
for three independently reconstructed result fields: slot `opened_at`, slot
`closed_at`, and a verified linked-refill event's `created_at`. All surrounding
keys/values, nested refill snapshots, identities, quantities and original receipts
remain exact. Explicit finite offsets and timestamp-key presence are required;
null remains valid only where the reconstructed state expects it. No stored JSON
is normalized or rewritten, and the retained operation-receipt hash still binds
its original content.

A prior focused reproduction changed only the first pre-opening canonical writer
transaction from UTC to America/Denver. It passed smoke/managed checks then failed
with SQLSTATE 23514 at the exact slot/refill comparison. Its protected log and cleanup remain
separate from the successful full run; it did not run ordinary SQL regression or
reach the Auth probe.

The complete corrected run used source base
`e34b967fb97f4fd248ec59918c42ef1c48d9b37e`, Supabase CLI 2.118.0 and Postgres
17.6.1.171. All 399 bound source hashes matched afterward. The original trusted-189
pin and all 204 canonical migrations were unchanged; all four injected drift cases
rolled back and all ten canonical writer definitions remained unchanged.

| Evidence | Observed result |
| --- | --- |
| Repository | 1,687 unit tests, three TypeScript projects, build; zero lint errors/four existing warnings |
| Canonical SQL with candidate installed | 166 suites / 7,338 assertions |
| Writer timezone scenarios | UTC, America/Denver, Asia/Kathmandu; real first/intermediate partial fills, completing fill and linked-refill result |
| Caller timezone validation | All three zones before and after populated restore; raw relation fingerprints unchanged after each read |
| Existing opening case families | 27 refusals / 14 independent positive SQL assertions per scenario: 81/42 executions |
| New historical case families | 33 refusals / seven positive SQL assertions per scenario: 99/21 executions |
| Later managed activity | Two unique canonical actions (pickup, annotation), six executions across scenarios; four prefix assertions each |
| Restore | Three populated/three restored marked databases;456 exact relation fingerprints per scenario; historical sessions actually absent during a rolled-back validation transaction |
| Separate managed/Auth proof | 24 existing native actions, four late faults, 11 corruption refusals; 133 combined Auth/PostgREST response and SQL assertions/eight observed lock queues |
| Cleanup | All six marked clone databases and owned containers, volumes and working directory removed |

The 33 new refusal families comprise five actual foreign-product cases, 16 slot
result cases, two partial-fill null/key cases, nine linked-refill cases, and one
same-instant offset rewrite. The second product has the same stock unit and a
real signed prescription, lot, canonical dispense, allocation, movement and source
provenance. Its own projector validates before foreign identities are injected
into the primary opening. Each new refusal must first perform its mutation, then
fail SQLSTATE 23514 with the intended invariant message and preserve every scoped relation
fingerprint and manifest after rollback.

The same-instant Honolulu-offset mutation passes the narrow typed slot comparison
but fails the retained opening receipt binding. This independently tests that
witness; the older equivalent-decimal case still tests exact original request
binding and is not relabeled. The older random/nonexistent-ID cases remain
separate from the five new populated-product cases.

Original native/source fingerprints match before controlled construction and
after construction/refusal probes. Later managed actions legitimately append new
history; populated restore fingerprints compare that recorded state exactly.
Each scenario retains the explicit invalid unattached-COMMIT rejection and tests
historical-prefix preservation after managed activity. Read validation clears
caller claims; a separate restore transaction deletes actual historical sessions,
validates, and rolls back to exactly the prior fingerprints.

Repeated scenarios are execution counts, not new unique cases. The new opening
matrix is SQL-only. The separate `api_checks: 133` counter combines genuine
Auth/PostgREST response and SQL setup/state/cleanup assertions; it is not an HTTP
request count. Restore proves recorded database state, not actual physical
post-backup stock or Storage binary disaster recovery.

This is candidate-only evidence: no hosted writes, provider requests, canonical
migration, production engine installation or clinical/register activation. Native
custody without current C1a provenance remains unsupported; genuine 187/188→204
upgrade/refusal acceptance remains separate. Existing capacity bounds and wider
exceptions/C1b assembly/C2 workflows/C3 actual counts, rules and Susan's approval
remain pending. Exact-head CI and frontend deployment are tracked on the PR.

Successful private result SHA-256:
`b1c1ebd7a3e35ef5cc4ae0770d9337558a6b5dbcc5ebfcbe3cea2b2764728ae4`.
Protected runner log SHA-256:
`2e30ac028c3fc70a531c5436d7afc1dd27eb55865e8ced6d0f1089afd1df15bd`.
[Machine evidence](2026-10-18-controlled-opening-history.json) retains the complete
source inventory, distinct and repeated counters, earlier reproduction and cleanup.
