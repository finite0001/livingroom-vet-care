# Controlled-drug record-review foundations

This is Living Room Vet's read-only presentation and client protocol groundwork.
It is not mounted in Inventory and has no authenticated RPC adapter or signing
action. Existing medication-configuration drafts remain independent. No backend
installation, roster, calendar, policy or clinical commissioning is introduced.

## Exact transport boundary

Use `readExactReviewResponse` on raw authenticated HTTP responses, before any SDK
JSON decoder. It has one 30-second body-read budget, a fixed 2MiB accumulation
buffer, 64 nested containers, 100,000 values and 1,024 characters per number.
Those are client resource ceilings, not a promise that every historical source
fits. Exceeding a limit refuses display; no evidence is truncated or rounded.
Cancellation is initiated without waiting indefinitely for it; this does not
establish server rollback. Fetch/session/abort authorization remains adapter work.

The decoder rejects duplicate decoded keys, malformed UTF-8/JSON, NUL and unpaired
surrogates. Numeric evidence is an immutable `ExactJsonNumber` with its original
token. Display with `String(value)`; numeric coercion and JSON serialization throw.
Only explicitly bounded protocol integers may use `protocolInteger`. Queue and
cursor bigint values remain canonical decimal strings within signed-bigint bounds.
Do not rewrite or rehash authoritative packets using string-projected numbers.

## Request correlation and recovery

The v3 request has exactly actor, operation, event, policy, read-eligibility and
review-eligibility UUIDs, decision and reason. UUIDs are canonical lowercase nonzero
values; reasons retain their original Unicode text, with clean-text validation
and 1–4,000 Unicode code points. The transport digest is SHA-256 of the UTF-8 bytes
of `lrv-record-review-request-v3\n`, followed by those eight ordered fields, each
framed as ASCII byte-length, `:`, exact UTF-8 bytes. No normalization or trimming.
This correlates a request; it does not authenticate it or constitute a signature.

`browserReviewPointerStore()` requires a secure browser, Web Locks and storage.
Only `{version:3,actor_id,operation_id,transport_digest}` is persisted, separately
from medication-draft pointers. Reservations and cleanup use the same actor-scoped
exclusive lock, reread under it, and verify persistence. Release the lock before
HTTP. A losing tab recovers the winning pointer; it must not submit its proposed
operation. Never turn a missing operation, reload, expiry or timeout into cleanup.

`resolve(pointer,outcome)` verifies the minimal owned saved commitment or explicit
cancellation before removing the exact pointer under the lock. Saved recovery
needs no clinical packet. Prepared cancellation echoes the original digest;
unprepared cancellation has a null digest and closes the owned UUID permanently.
This depends on the server's actual cancellation protocol, still awaiting proof.
If cleanup fails after a confirmed outcome, retain that outcome visibly and offer
cleanup/recovery; never repeat execution to repair local storage.

## Queue integration contract

Validate every page with `verifyReviewQueuePage(originalRequest,rawDecodedBody)`.
Requests are one exact product/site/kind or the product-only exceptions view.
Cursors are actor/scope/authorization-version bound, bigint positions are exact,
and an empty page may still have continuation. No automatic page scan. The queue
renders review, deadline and signing states separately, preserves actual/recorded
times, and never infers a deadline or approval from browser time. Snapshot high
water is a navigation bound, not a claim that this page examined through it.

Before mounting: implement and prove authenticated raw HTTP transport, session
generation/cache isolation, complete packet/response/error schemas, explicit
prepare → display → later confirm, permission/revocation/expiry handling and real
two-user Auth acceptance. The canonical206 private interface is not the v3 UI API;
do not connect these modules to it or open its grants. Counts, physical witnesses,
transfers, disposal, reports and commissioning remain separate workflows.

## Verification

The prospective component checks remain separate from the mandatory complete
evidence admission. `component-hashes.ts` has six explicit component APIs and no
whole-packet hash API. Its formatter fixtures compare 120 component results with
PostgreSQL 17.11; comparison with the selected Supabase PostgreSQL 17.6 runtime
remains pending. These fixtures confer no database membership or Auth authority.

`exact-values.ts` compares stored numeric(14,3) quantities as integer thousandths
and source instants as integer microseconds. The prospective structure checker
uses those domains without rounding. `prospective-component-consistency.ts`
checks supplied row commitments, target/obligation commitments, duplicated
parent rows, original context/result/receipt relationships and literal adapter
dispatch. It remains incomplete: source-specific nested document grammars,
complete direct-graph relationships, historical/configuration selection and
independently accepted backend/transport authority are still required. Do not
wire any prospective checker as the production `ReviewEvidenceAdmission`.

- `npm run check`: includes 18 protocol/queue unit tests.
- `node node_modules/@playwright/test/cli.js test --config tests/controlled-drugs/record-review.playwright.ts`:
  two test-only browser cases for 375/1280px presentation, keyboard activation,
  ≥44px controls, explicit empty-page continuation and actual two-tab Web Locks.
- The normal `npm run test:e2e` includes these cases in CI.

The browser fixture uses no backend or Auth and cannot prove server idempotency,
authorization, packet integrity, loss-after-commit recovery or register readiness.
