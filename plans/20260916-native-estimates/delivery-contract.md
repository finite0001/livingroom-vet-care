# Reviewed estimate delivery contract

Status: design for implementation; no delivery endpoint, provider acceptance or hosted activation claimed.

## Inspected foundations and dependency

Publication source9ebfdd8 retains exact HTML bytes and staff publication history. Client capability semantics are specified in decision-contract.md and decision-browser-contract.md. Delivery depends on that separate capability: a staff-only publication artifact cannot be made public by reusing the staff download endpoint.

The coordinated integration candidate additionally contains conversation email preparation. Reuse the durable outbox/lease/attempt machinery, not arbitrary provider calls. Inspected entry points: `prepare_payment_delivery`, `capture_payment_delivery`, `enqueue_payment_delivery`, `payment_delivery_context`, `conversation_email_delivery_context`, `read_frozen_email_payload`, and `start_communication_attempt`. The last two are replaced across historical migrations; implement against the combined tree and preserve every existing family branch.

## Staff workflow and immutable scope

1. Select the exact current published estimate for the household/patient, then create a separately revocable decision grant. The grant is not permission to pay, consent to treatment or enter a general portal.
2. Explicitly choose email or SMS and one reviewed recipient. Validate current household ownership, conversation scope and SMS consent using existing outbox rules. A changed contact does not silently change the recipient of an already prepared message.
3. Prepare a stable delivery request ID that binds publication ID, preparation ID, document digest, grant ID, expiry, household, conversation, channel, recipient, subject and message template. Only the server-derived authenticated staff actor owns this preparation.
4. Capture immutable sender configuration and message/payload hashes. Render the token-bearing link from a dedicated versioned capability key only in trusted runtime memory. Persist template/context/digests, never a usable bearer token or materialized URL. Email may include the exact retained publication bytes, with an explicit attachment review; it must never regenerate from current patient/catalog data.
5. Staff review the recipient, document, expiry, wording and sender. Queue only when reviewed hashes and artifact identity still match. An exact retry recovers the same outbox row; changed request identity is rejected.
6. Show queued/sent/failed/uncertain separately. Provider uncertainty follows existing explicit reconciliation, never an automatic new send. Resending is a new reviewed delivery request with its own identity and does not alter the published document or decision.

## Final attempt boundary

Before provider invocation, derive a dedicated estimate-delivery context from the exact leased outbox row. Re-materialize and verify the captured message/payload hashes and sender configuration. Pass typed proof fields into `start_communication_attempt`; SQL must recheck the lease, household, channel/recipient, reviewed capture, active grant and current actionable publication after any waits. Preserve existing payment, document-link, conversation attachment, consent and provider gates. Do not trust metadata alone to authorize a specialized delivery.

Withdrawal, supersession, grant revocation or expiry before the final attempt prevents a new provider attempt. If a provider call was already started, preserve its uncertain/completed history: revocation cannot recall a message. The public endpoint still enforces current access. A decision already committed remains recorded even after its delivery grant is revoked. A reminder to decide must not dispatch after a decision is recorded; sending a decision receipt would be a distinct future message kind.

Use the common estimate root gate for publication/decision state; choose and document consistent root/grant/delivery/outbox lock order before SQL implementation. Observe both commit and rollback races against revocation, decision and supersession. Never hold a database transaction open across a provider request.

## Implementation ownership and files

Relative to the coordinated repository root:

- New timestamped migration: closed prepare/capture/review/enqueue/recover/close RPCs, private ledger, RLS, audit, immutable receipts, derived send context and final attempt guard extension.
- New `_shared/estimate-delivery.ts` and HTTP/runtime entry points: strict schemas, bounded bodies, domain-separated token materialization, actual retained attachment bytes and exact proof validation.
- Modify `_shared/outbox-dispatch.ts` and its dependency interface/env declaration to handle estimate delivery without disabling existing families. Public and delivery gates default off independently.
- New staff estimate delivery workspace and hook: explicit recipient/document review, unknown-request recovery, actor/household boundaries and dirty navigation. Mount from published history; no implicit send when publishing.
- SQL, adapter, actual Auth/HTTP, contention and browser suites; extend selected populated restore to grants/delivery/receipts and preserve original artifact bytes.

## Acceptance required

- Wrong household, actor, publication, artifact, grant, sender, recipient, channel, lease or reviewed digest rejected; expanded/malformed requests rejected without logging secrets.
- Lost prepare/capture/enqueue/close replies recover original requests; no duplicate outbox rows or unresolved state cleared on malformed response.
- Real observed races for decision, supersession, withdrawal, revocation, expiry and concurrent queue/attempt, including post-wait authorization.
- Tests prove payment links, selected record links, ordinary email/SMS and conversation attachments still pass their final attempt checks.
- Public access and synthetic dispatch use local fixtures only. No real client messages, provider charges or credential changes during acceptance.
- Provider delivery commissioning, staff wording approval and Dr. Edler review remain launch gates. Full commercial readiness also includes all remaining standalone requirements.

## Engineering choice and open decisions

Prefer a dedicated estimate delivery family modeled on payment delivery rather than inserting a token URL into a generic conversation body: the latter would persist a bearer capability and bypass publication/grant lifecycle checks. Keep Fastmail plus the single Resend transport already approved. Business wording/validity requires owner review before production use, but does not block implementation of these boundaries.
