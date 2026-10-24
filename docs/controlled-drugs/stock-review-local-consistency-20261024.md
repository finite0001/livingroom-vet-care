# Stock-container review consistency — local slice

This adds available local consistency checks for receiving and adjustments in
Living Room Vet. The staff workflow remains unmounted. There are no backend
installations, grants, hosted writes or clinical activation in this change.

## What the checker verifies

The explicit entrypoint is `verifyProspectiveStockMovement`. It requires the
prospective supplied-parent and component checks, then verifies the exact scalar
source graph: event, preparation, action, original stock policy and opening,
movement, lot, movement provenance, one source link, physical lines, cells,
containers and transitions. Extra unreachable nodes and missing referenced rows
refuse. All refs use the reviewed-target role in this slice.

Closed context and frozen schemas retain original values. The checker compares
the original catalog, selected policy permission, product/unit/site, source
bundle/effects and receipt, then reconciles each physical split and container
version. All nonzero splits have the canonical movement's sign and total exactly
to that movement. An opposing transfer cannot be hidden by netting quantities.
An adjustment may create a new cell in an existing empty stock container; empty
descriptors still require transitions and receipt entries. New receiving lots
bind the original actor and canonical transaction time, while an existing lot
may retain a different original creator/time.

Quantities use integer thousandths. Aggregate frozen balances use a separate
bounded parser: their range can exceed a single stored numeric(14,3) column.
The conservative aggregate text ceiling is 1,024 characters; larger evidence
refuses without rounding or truncation. Historical source instants compare at
microsecond precision. The existing JSONB byte counter also enforces original
context, argument, frozen object and per-container-frame size limits.

JSONB equality compares numeric value, so `1.0` and `1.000` may agree while keeping
different component hash preimages. Strings retain exact spelling, including
quantity strings except where the source contract explicitly calls for numeric
quantity comparison. No authoritative whole packet is reconstructed or hashed.

## Explicit boundary

This slice supports stock containers only. Native event kinds and prepared
container descriptors refuse. An empty prepared-container descriptor is valid in
general C0; this scoped refusal must not be described as a general C0 rule.

No local packet proves database-wide enumeration, full stock reconciliation,
registered site/location membership, historical/current role authorization,
native/opening history completeness or accepted backend/transport deployment.
Opening count evidence remains an opaque object and its native custody boundary
an opaque array; no native rows are invented from either. Those are separate
backend contracts. A complete admission implementation and accepted composition
root remain necessary before production mounting.

## Validation and retained fixture

The actual synthetic PostgreSQL 17.6 HTTP response is retained byte-exact as
`tests/controlled-drugs/record-review-stock-movement-reference.json`, SHA-256
`60bf756a1f311ea9dee213b253040adb3859af78564f25fac213a550b8eb32a9`.
It contains no tokens, passwords, real clinic identities or patient data. Its
source engineering prototype completed the known HTTP lifecycle but failed final
audit accounting. This artifact supports DTO/component parity, not complete
Auth/protocol/global/production acceptance.

The fixture passes the complete prepared-response envelope and scoped checker.
Tests also recompute commitments around deliberately inconsistent stock splits,
site/actor/hold/version/source graphs; recomputed hashes do not make those cases
valid. Additional constructed local cases exercise receiving, new cells, empty
descriptors and numeric aliases. Constructed cases are not additional Auth runs.

Independent review reported no scoped blocker: 67 focused tests and 1,264 separate
controls passed, including 1,200 numeric equality comparisons against Decimal.
Retained review digest:
`5db32f9c71cdcfcac29b092dfdbe5db6641d5790cd4da246fbece5aee3777558`.
