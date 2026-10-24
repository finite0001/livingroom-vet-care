# Prospective record-review component checks

These additions compare supplied Living Room Vet evidence. They do not mount the
staff workflow, install backend objects or implement complete EvidenceAdmission.

## Implemented scope

- Six explicit component commitments: retained row, target, event excluding its
  record hash, preparation context, parent request and obligation excluding its
  binding hash. There is no public generic or whole-packet hash API.
- PostgreSQL JSONB text formatting: UTF-8 key byte ordering, spacing, escaping,
  exponent expansion, numeric scale and negative-zero handling. The codec bounds
  text, key buffers, recursion, values and arrays before hashing.
- Exact stored numeric(14,3) quantities as integer thousandths, a separate C0
  decimal-string grammar, and timestamp comparison at microsecond precision.
- Every supplied controlled parent's event/preparation/action relationships,
  literal writer dispatch, component commitments, product/opening/policy,
  original result/catalog snapshot, historical anchor and complete owned receipt.
  Each supplied parent keeps its selected source role. Non-main parents may have
  no secondary-review requirement. Preparation and execution sessions may differ;
  the action and event must share the executing session.

Complete direct-graph membership, nested source-specific native semantics,
historical configuration selection, genuine database membership and accepted
backend/transport authority remain separate requirements. The mandatory complete
validator has no fallback to these helpers. A consistent set of supplied hashes
does not prove that the supplied rows exist in the database.

## References and independent review

Twenty synthetic fixtures retain 120 component digests from a local PostgreSQL
17.11 formatter reference. They are deliberately invalid as clinical lifecycle
records. Selected PostgreSQL 17.6 source formatting rules were checked separately;
running the same formatter vectors on the selected Supabase 17.6 runtime remains
pending. The reference instance was stopped and cleaned up normally.

Independent review additionally checked 1,500 quantity cases, 1,500 timestamp
cases, 308 numeric component hashes and 20 context-text hashes. It found and
verified fixes for accessor-bearing targets, cumulative key-buffer allocation,
and missing preparation-to-event policy/opening bindings. A later review checked
18 independent controls across all supplied parents. No unresolved blocker was
reported within this explicitly limited scope.

Retained independent report digests:

- Codec/exact values: `e2d71162d3a336c6ff41ce417f5ae35f4bd329edae21508c68d3d7ce1714bf3e`.
- Supplied parents: `c472b55a59f6dd7be3d8bccf3c726197e0ef1eb0559a88ae8af7f94fff3cfceb`.

Reproducible repository tests are `record-review-component-hashes.test.ts`,
`record-review-exact-values.test.ts` and
`record-review-component-consistency.test.ts` under `tests/controlled-drugs/`.
These are local consistency tests, not Auth or deployment acceptance.
