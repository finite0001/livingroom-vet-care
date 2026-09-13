# Staff payment message delivery review

The invoice workspace has a Payment message delivery panel for email and SMS. It selects the current actor’s reviewed payment-access grant, current primary contact and household conversation. Exactly one `{{payment_link}}` placeholder is required. The complete nine-argument request is frozen under a stable UUID before preparation, including explicit null attachment arguments when no invoice is attached.

`prepare-payment-delivery` preparation/recovery returns safe request, capture digests and queue receipts. Only its explicit `review` action returns the transient materialized message and optional HTML invoice attachment. The browser verifies the actual message digest and reconstructs the exact email JSON or SMS form payload to verify the captured payload digest. Attachment verification includes its actual base64 bytes, filename and UTF-8 contents. This is followed by explicit staff attestation and `enqueue_payment_delivery` with the reviewed message/payload hashes.

Queueing is separate from delivery and payment. A saved outbox receipt is recovered before requesting any materialized preview; receipt recovery stays usable after signing-key, grant or consent changes. A lost preparation acknowledgement preserves the original UUID and all nine arguments, while a lost queue acknowledgement recovers the same receipt. Consent, current contact, invoice source, grant state and provider eligibility remain authoritative server checks immediately before queueing. Refusal retains the original request and never invents a replacement or paid flag.

Materialized messages, URLs and attachment previews remain in component memory only. They do not enter query caches, browser persistence, history or logs. Closing the preview, pagehide and actor/invoice changes invalidate it; late responses cannot restore a retired preview. The attachment renders in a noninteractive sandboxed iframe with a restrictive CSP and no-referrer policy. Preview text is plain text, not a navigable link.

Only the validated placeholder template, other original nonsecret request arguments, and a selected request UUID for exact receipt recovery enter session storage under the existing actor-scoped payment prefix. Actual capability strings are rejected before persistence. Authentication cleanup removes pending identifiers and handoff markers on signout/account change. Dirty, uncertain and busy work participates in the invoice navigation guard and competing payment/email/SMS edit guards.

## Optional existing invoice attachment

A ready invoice email may be handed off using **Continue with payment link** after the staff member reviews its exact frozen attachment and message. Its frozen body must already contain exactly one payment-link placeholder. The original email queue is disabled for such placeholder templates, preventing an unresolved placeholder from being sent as a standalone invoice email.

Handoff preserves the exact invoice-email request ID, payload hash, recipient, subject, body template and conversation. It relinquishes the original composer’s dirty lock and disables its original controls until **Resume standalone invoice email**. An actor-scoped ID marker preserves this ownership through reload, avoiding a deadlock with a pending payment delivery. The payment panel does not edit handed-off attachment context and still requires its own final actual-byte review. It does not generate a replacement attachment implicitly.

## History and validation

`list_payment_deliveries` supplies actor/invoice-scoped safe history, including stale/revoked grants and queued receipts. The latest 100 are displayed with a truncation notice; an outstanding request is recoverable directly by its saved UUID. History never invokes the materialized review endpoint automatically.

Focused tests cover nine-argument retention after lost preparation and reload, email/SMS payload integrity, exact UTF-8 attachment bytes, private preview clearing, lost queue acknowledgement, receipt-first recovery after consent changes, stale consent between review and queue, and attachment handoff ownership. Browser tests mock backend contracts and perform no actual provider sends. Runtime and migration verification are maintained in their respective backend increments.
