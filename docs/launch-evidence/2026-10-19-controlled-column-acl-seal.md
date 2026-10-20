# Controlled-stock column ACL sealing

The candidate now represents direct column grants in its scoped technical
manifest. Manifest version 2 adds `column_acl` to every existing covered column:
397 columns across 51 relations, with the same 171 functions and ten canonical
writer definitions. All 255 Python harness tests and the current focused owned
runtime rehearsal passed. Fresh full ordinary and genuine historical compatibility
also passed. Independent evidence review passed; exact-head five-job CI, PR and
Dave's specific merge/release approval remain pending.

This extends the [frozen private release assembly](2026-10-19-controlled-release-assembly.md).
That package checked column privacy during installation but explicitly did not
retain column ACLs in its ongoing manifest. The new snapshot makes a later direct
column grant visible to the existing manifest comparison. It adds no function,
canonical migration, policy, opening or activation route.

Each column's direct ACL is an array of grantee name, grantor name, privilege and
grantability records. PUBLIC uses its explicit label; role OIDs and raw ACL array
ordering are not retained in this representation. Entries sort by UTF-8 role and
privilege names using `COLLATE "C"`, then the grantability boolean. No direct
entries yield `[]`, including null or empty `attacl`. This does not invent owner
grants from implicit owner access or copy table-level ACL defaults into columns.
It does not omit a real direct grant or its grant option.

The expected metadata was derived independently from the released PR #286
artifact, rather than captured from the installation being checked. The old
released baseline had its exact 422 source bindings verified, its original
171-function/51-relation manifest and ten writer hashes matched the retained
release pin, and a separate direct-ACL supplement covered every column. All
397 covered columns had no direct column ACL entries. The original version-1 pin is retained
verbatim with SHA-256
`747813bb6dc4fa39213eb58eeb6515b0569ce0aac3eb171276e609e29f40c72d`.
The original trusted-189 reference and prior snapshot also remain unchanged.

A pure offline derivation permits only the reviewed snapshot SQL version/ACL
change, the snapshot function definition hash, the seal input hash and the new
column fields. It proves the old function rendering against the old independent
hash, applies the narrow change, then reverses every approved metadata delta and
requires exact equality with the old pin. It cannot adopt an unexpected old
column grant or recapture the new installed catalog as its expected result.
The new version-2 release pin has SHA-256
`4755a1f1c53008003a11e94ada3963ae416f6c81f163ec43ed2ffea21d6d2f78`;
the deterministic private artifact has SHA-256
`7165851ab481f2ee2ab41c7347a7db65213b5c647c101eaf4554a973d896c4a7`.
Both remain outside canonical migration promotion.

The owned runtime proof observed six actual post-install grant families before
requiring an exact ongoing manifest refusal:

| Case | Direct grant being observed |
| --- | --- |
| Authenticated column | SELECT on a private controlled-event column |
| PUBLIC column | The same column granted to PUBLIC |
| Service-role column | The same column granted to service_role |
| Original source column | SELECT on the covered stock-writer admission source column |
| Grant-option transition | Plain SELECT followed by SELECT WITH GRANT OPTION |
| Explicit owner column | A new explicit column grant despite legitimate implicit owner access |

For grantability, the complete live manifest changed only the one grantable
boolean between the plain and grant-option observations. Before each exact
SQLSTATE 23514 manifest refusal, the proof observed the direct ACL and actual
effective column access, confirmed table-level access separately, preserved the
saved manifest and reached an armed marker. Every case then proved exact rollback
of selected relation data, actual public catalog including raw column ACLs,
stored/live manifests, writer definitions and any present migration ledger.
No probe resealed its injected grant.

The same six families passed in two phases: immediately after private
installation and in an independently populated restored database. These are
twelve executions, not twelve unique grant families. Each phase covered 456 data
relation fingerprints, manifest version 2 and the same 171 functions/51 relations.
The installed runtime retained its exact 204-row canonical ledger. The selected
public/auth/storage/extensions restore excludes supabase_migrations, so its proof
explicitly reported ledger absence and zero ledger rows; it did not claim a
restored ledger comparison.

All 425 current source bindings matched. The owned runtime was removed, and
independent exact-label inspection found no containers or volumes. The private
focused result SHA-256 is
`fb48fd6fb956d37fc584b2e79d2c28de4b0aded5db4550e4052f578f73889655`.
Fresh historical compatibility passed the same version-2 artifact after the
unchanged canonical suffix upgraded genuine 187/188 histories through migration
204. All seven native cases/83 SQL checks and two generic opening cases/29 checks
passed, including their existing populated opening restores and three-timezone
validation. These generic restores are separate from the six-family ongoing ACL
probe repeated in the current populated managed restore. All 261 historical
source hashes matched. Both actual project labels independently had no containers
or volumes, and both cleanup receipts confirmed removal. The private historical
result SHA-256 is
`14e67acc76eb24bc907646354dd1f5144166268842d83cdd31f05ab9b88d85b2`.
Fresh full ordinary compatibility also passed with the same version-2 artifact:
fourteen installation refusals, both six-case ongoing ACL phases, all 166 canonical
SQL suites/7,338 assertions and every existing candidate probe. Its correction
workload took 373.059 seconds with eleven capacity observations, seven populated
restore validations and 33 committed producer batches: 1,001 canonical writes and
66 real boundary previews. Existing workload deadlines, writer reserves and batch
guards remained unchanged. The genuine Auth/PostgREST proof passed 133 combined
checks and eight observed lock queues; the count includes SQL setup/state/cleanup
checks and is not an HTTP request count. All 425 ordinary source hashes matched
and the entire map exactly equaled the targeted map. Independent exact-label
cleanup found no containers or volumes, with runtime removal confirmed. Its
private result SHA-256 is
`dcc6a8c7a50e1dc658e04370967a855f57c2a43956d43a81720cd2a6bd13311a`.
All three local runtime gates and 255 Python harness tests pass; final evidence
review passed; exact-head CI and the next PR's specific merge approval remain pending.

The scope is direct ACL metadata on the existing covered relations. It does not
pin role membership, schema privileges, default privileges, extensions or the
whole database/cluster catalog, and does not prevent the database owner from
replacing code. Logical selected-schema restore is separate from physical
post-backup stock reconciliation, cluster-role recovery, Storage binary recovery
and production capacity approval.

Canonical promotion remains a separate package. The private artifact has authored
transaction boundaries; the current psql rehearsals do not prove Supabase CLI
migration-ledger insertion atomicity. A future CLI-owned migration body and actual
ledger-insert failure test remain required before promotion. C1b production and
hosted installation, remaining hold/exception acceptance, C2 review/witness/
transfer/count/report workflows and C3 practice commissioning remain unfinished.
Susan's actual physical count, site/product/unit configuration, SOP, witness and
practice-rule approval remain pending. No hosted installation, provider request
or clinical/register activation is part of this work.
