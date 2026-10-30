# Hosted migration receipt compatibility

PR 314 was merged on October 30, 2026 as
`ba21a90d95b83e39a607cffecaecbdb7d0816eca`. The frontend deployed successfully.
Its narcotics access boundary prevents entry when backend admission is unavailable.

The approved database rollout installed original migration 205. Migration 206
rolled back at its historical receipt check; migrations 207–209 did not run.
The recorded statements matched the source-admitted baseline. The mismatch came
from additional platform columns: `created_by text`, `idempotency_key text` and
`rollback text[]`. Comparing `to_jsonb(m)` to an original three-field literal
includes those extra columns. The previous authored-single-statement alternative
handled that layout, but its canonical CLI statement-vector branch did not.

The compatibility correction adds a finite source-derived canonical receipt
predicate alongside each existing whole-row check. It checks version, name,
statement count, exact PostgreSQL JSON-array byte length and SHA-256. Audit
metadata remains untouched. Original 204 files retain their reviewed authored
transport alternatives. Engine 205 admits only its exact original CLI vector.
The new 206 receipt is independently framed for the subsequent 207 checks.

The exact inverse still recovers every original 206/207 gate and its quoted SQL.
The original frozen engine, secondary-review and common-source artifacts remain
unchanged. No business function, staff permission, deadline or signing rule is
modified. Migration 208 and 209 SQL bytes remain unchanged.

The owned rehearsal constructs mixed canonical/authored receipts and all six
columns at the original INSERT, retaining nonempty synthetic audit values.
Seven isolated PostgreSQL controls exercise canonical acceptance, changed audit
values, and rejection of changed version, name, statement bytes, order or count.
These controls claim no application Auth acceptance and write no domain data.
The full installation then checks preservation of the original rows and source
module definitions. No stored migration row is rewritten.

Resume the release from the actual recorded prefix, using the reviewed release
directory and official CLI. Do not rerun 205, repair history, remove audit
columns, or apply unreviewed SQL. Recheck the complete ledger, source module
properties, original records and grants before enabling narcotics workflows.
