# Independent review of the prospective staff workflow

Scope: the new unmounted `record-review` lifecycle, raw RPC transport, packet
validation, readable evidence sheet and their tests. The original PR294 decoder,
pointer and queue foundations remain separate. No production route or Auth
integration is implied by this review.

## Findings corrected before publication

- [WARNING] `prepared-packet.ts` — counting the original numeric token could
  undercount PostgreSQL's expanded canonical decimal representation. The revised
  counter uses bounded BigInt length arithmetic, including scale, exponent and
  signed-zero cases; it does not convert clinical values to Number or allocate
  exponent-sized strings. Oversized canonical packets are refused.
- [WARNING] `RecordReviewWorkflow.tsx` — a delayed rejected cleanup could publish
  an alert after an actor/model change. Alert publication now checks model,
  identity revision and component lifetime. The paused-cleanup browser case
  verifies that obsolete callbacks do not add an alert.
- [WARNING] `RecordReviewWorkflow.tsx` — raw JSON alone was insufficient for staff
  review. A readable summary now uses only retained performer/product/time,
  exact per-line stock changes and recorded units, separate dose/route, correction
  relationships and historical deadline evidence. Complete raw evidence remains
  available. Missing data gets an explicit label; quantities are not summed and
  stock amounts are not interpreted as clinical doses.
- [WARNING] `RecordReviewWorkflow.tsx` — the fixed review meaning could scroll
  away from the later confirmation. The exact meaning is now repeated beside
  that button and covered by a browser assertion.
- [WARNING] `prospective-packet-structure.ts` — a valid opening-package pickup
  can retain the original dispense UUID without a managed family row. The exact
  frozen A2 own-transition provenance, missing-family reason and null binding
  now permit that explicit exception; close but invalid variants still reject.
- [WARNING] `prospective-packet-structure.ts` — derived historical timestamps
  need exact UTC6-Z spelling, while retained source timestamps keep their older
  date range, offset and precision. Separate schemas and controls now enforce
  both contracts without normalizing historical evidence.
- [WARNING] `prospective-packet-structure.ts` — permitting old selection anchors
  must not also permit calendar-derived deadlines outside2026–2101. Both due-time
  projections now reuse the bounded protocol schema, with otherwise valid
  configured-deadline controls for both invalid sides of the interval.

## Current result and limits

No blocking defect found in the reviewed unmounted slice. The model persists
the exact four-field pointer before preparing, separates review from explicit
confirmation, retains uncertain operations and validates owned closure before
cleanup. Session changes invalidate in-memory clinical state. Saved recovery
does not depend on retrieving a clinical packet or retaining signing permission.
Supplementary prospective DTO shape checks do not grant evidence admission.

Verification: full project check passed 1,743 tests with zero skipped,
typechecks and build; 29 new focused controls and six synthetic browser cases
passed. The reviewer inspected the code and retained 375/1280-pixel screenshots.
These tests do not establish genuine v3 Auth, server persistence or signing.

The mandatory complete evidence validator, proven v3 backend, real two-user Auth
and accepted host dialog/navigation/unload behavior remain mounting gates.
Keep the component unmounted until those are satisfied. No new permissions,
backend grants, generated types, production configuration or route changed.

Current source review: 0 critical, 0 unresolved warnings, 0 suggestions in the
unmounted implementation scope. The integration gates above remain unfinished.
