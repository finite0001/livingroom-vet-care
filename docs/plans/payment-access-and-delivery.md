# Reviewed invoice payment links and scoped client status

Status: next implementation contract, not delivered functionality. Integrate on `codex/payment-access`, which combines payment PR57 and document SMS PR56 without rewriting either published branch. Preserve existing v1 checkout attempts and their exact provider parameters.

## Intended client experience

Staff review an issued invoice's exact outstanding amount, recipient and full email/text before sending a Living Room Vet payment link. Default collection authorization lasts seven days (maximum seven days for this increment), independently of Stripe's shorter hosted-session lifetime. The client opens an isolated private page, sees only the reviewed amount and deadline, and explicitly chooses Continue to secure payment. No provider request is created by opening the page or by a mail scanner.

The client may return to the practice's scoped status page or reopen the message to see confirmed ledger status. Browser redirects, query parameters and cancellation navigation are never evidence of payment. Do not expose a client name, invoice UUID, services, diagnosis or other patient data through payment status.

A pre-created two-hour Checkout URL is insufficient for ordinary emailed invoices. Create a fixed provider session only after explicit client activation. A single reviewed collection authorization can reuse its unresolved attempt; after authoritative provider expiry it can create another attempt only while the original grant remains eligible and the exact invoice/source/amount is unchanged. Never rotate an idempotency key because a request timed out. If a previous attempt remains uncertain, reconcile it before any replacement.

## Immutable grant and attempt boundaries

Create a distinct payment collection grant, not a document grant. It freezes original staff actor, invoice/client, amount/currency, financial source hash, collection expiry, status expiry, approved origin, key version and separate collection/status token hashes. Use domain-separated HMAC capabilities; usable tokens and Stripe URLs never enter application storage, audit, query cache or browser storage. Status access expires thirty days after collection expiry and is narrower than the collection capability.

Preparation/capture/review follow the existing document-link pattern: exact request UUID recovery, service-only capability capture, explicit staff attestation before public activation and delivery. One unresolved captured/reviewable draft per actor/source; committed delivery receipts recover before current eligibility checks. Staff review can be recovered and revoked after source changes, actor identity remains enforced, and historical grants remain discoverable through safe metadata.

Do not lock an invoice merely because an unsent or unopened seven-day link exists. At every collection activation, lock grant and invoice, require an active originating actor, reviewed unrevoked unexpired grant, original invoice/source and exact outstanding amount, and reject unresolved collection/refund/reconciliation elsewhere. Changes to invoice credits or cash invalidate collection authorization instead of silently changing the amount. A paid invoice yields confirmed status and cannot create another session.

The activation RPC creates the provider attempt UUID and frozen creation/expiry/retry parameters atomically, using the same invoice lock and invariants as staff checkout preparation. Concurrent clicks reuse that attempt. Associate attempts immutably with the grant. A replacement is allowed only after accepted provider expiry (or a separately verified no-session reconciliation outcome), never from a local deadline alone.

New grant-generated attempts use a versioned v2 return context. Store only canonical success/cancel templates containing the grant ID and a status-capability placeholder, with immutable key/origin/context version. Materialize the exact return token in Edge memory before provider creation. Stripe will necessarily store the materialized return URL in its own session; application storage must not. Never retrofit v1 attempts or change parameters under an old idempotency key. Missing old keys blocks creation/materialization, while existing-session retrieval/expiry and provider reconciliation remain possible.

## Public and staff contracts

- Staff prepare/recover/capture/attest/revoke/history APIs expose safe metadata plus transient materialized payment message only after verified actor authorization. Supabase writes preserve the original authenticated staff actor.
- Public inspect validates the collection capability and returns reviewed amount/currency, deadline and coarse confirmed state without provider creation.
- Public activate validates the same capability, creates/reuses one durable attempt, reconciles known provider state, creates only eligible prepared attempts, persists evidence, then rechecks grant eligibility before releasing a transient Stripe URL. Revocation/source change during the network call must suppress the URL; it must not erase the unresolved provider attempt.
- Public status validates a separate status capability and returns confirmed cash/state scoped only to that grant and its attempts. It remains readable after collection revocation/expiry until its own deadline, subject to key availability. Pending webhooks display confirmation pending. Status reads never create a payment.
- Revocation prevents future activation/delivery and hides any new URL; it does not claim that a Stripe session already handed out was canceled. Staff must expire/reconcile any existing open session; UI exposes that distinction.

## Reviewed email and SMS

Messages contain an LRV collection capability URL, never a persisted raw Stripe URL. Freeze sender/channel/conversation/recipient, subject, exact message template containing one `{{payment_link}}`, amount/source and collection deadline. Explicit staff review binds the exact materialized-message hash. Outbox stores only template and hashes; the worker materializes in memory and the final attempt guard rechecks proof, actor, source, contact/consent, grant state and deadline. Preserve existing invoice-email/document-SMS guards and ambiguous provider recovery.

Offer reviewed invoice attachment for email using the existing frozen invoice renderer/capture checks; attachment/source review must remain bound to the same invoice and amount snapshot. Do not put a payment token into an immutable stored HTML/PDF. Extend canonical incoming-token redaction only after signature verification and reject capabilities at persistence boundaries. Do not claim arbitrary encoded attachments are scrubbed.

## Validation and rollout

Use default-off public collection/status flags and existing independent provider/collection/refund/receipt/worker switches. Isolate `/pay/` and scoped payment return/cancel routes before importing staff Auth or marketing resources; strip fragments immediately, use no-store/no-referrer, explicit action, bounded responses and memory cleanup.

Required evidence: actual database concurrency for repeated activation and credit/payment races; exact return-key/version recovery; lost provider response without replacement; expired session renewal only after authoritative evidence; revoked/source-changed grant during provider work; explicit review and same-request delivery recovery; quoted capability redaction; public cross-grant denial and forged paid flags; browser draft/URL privacy; actual local HTTP/storage/worker wiring; real Stripe sandbox payment/refund/webhook acceptance and configured provider email/SMS acceptance. Local mocks cannot establish provider readiness.

References checked September 12, 2026: [Checkout creation](https://docs.stripe.com/api/checkout/sessions/create) permits a fixed expiry between thirty minutes and twenty-four hours; [idempotency](https://docs.stripe.com/api/idempotent_requests) requires identical parameters and a bounded retry horizon. The longer-lived LRV authorization is an application workflow, not a claim that a Stripe session lasts seven days.
