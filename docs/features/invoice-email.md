# Reviewed invoice email

The household invoice panel can prepare an **issued invoice** for staff-reviewed email. This workflow does not create a payment link, collect a payment, reconcile a balance or claim a queued message was delivered.

1. Open an issued invoice and choose an existing household conversation, or create/use its active conversation.
2. Review the current household email address and enter the subject and message. There is no arbitrary recipient field.
3. Prepare the email. The server captures the invoice, credits and household identity and renders one frozen HTML invoice attachment.
4. Review the actual frozen attachment, file details, recipient and message. Attest to that review before queueing the exact captured payload into the durable outbox.
5. Inspect the saved queue receipt. Delivery remains unconfirmed until the provider reports it; provider commissioning and dispatch gates remain separate.

The existing print/PDF preview remains available. The email attachment is HTML, not an automatically generated PDF. No Stripe link is inserted.

## Recovery and draft protection

Preparing retains one UUID and exact arguments before making the request. A lost response can be recovered or retried with that same intent; queueing is never automatic during recovery or reload. Fields remain locked after intent creation until explicit recovery or abandonment. A definitive rejection with confirmed absence of a server request restores the editable draft. Abandonment applies only to unqueued requests; a queued message cannot be recalled through this composer.

The original subject/body/recipient and request identifiers are temporarily stored in browser **sessionStorage**, scoped to staff actor, invoice and household, so an uncertain request before server capture can survive a same-staff tab reload. No HTML or attachment bytes are stored there. Entries are removed after queue confirmation, abandonment, signout, failed/inactive staff verification, or an authenticated identity change. Storage unavailable errors prevent intent creation without breaking authentication. Server recovery remains actor-authorized.

Email edits and unresolved operations participate in the existing household billing navigation guard. Invoice switching, new invoices and local credit/void mutations are disabled while an email draft is active. Cancelling navigation preserves the draft; confirmed navigation discards unsaved text, while a retained submitted intent can be recovered. A failed refresh preserves the open editor and shows an explicit error, disabling further invoice/email submission until a successful retry. The composer remains mounted if an external change voids the invoice, preserving draft protection and access to historical receipts. New preparation and queueing are disabled for void invoices.

Credit changes do not necessarily change the invoice revision. Eligibility compares the full current invoice/credit/household content hash with the frozen snapshot. A changed invoice requires abandonment and a freshly reviewed capture; the server also rechecks at capture, enqueue and delivery preflight. Historical receipts remain inspectable even after current eligibility changes.

## Validation

Synthetic browser cases exercise frozen review, pre-capture and post-capture lost responses, queue response loss, reload recovery, definitive rejection, current-credit changes, fresh households, mobile/SPA draft protection, externally voided invoices and auth cleanup. Parser tests reject cross-actor, cross-household, cross-invoice and incomplete frozen receipts. These tests do not contact a provider or establish live delivery.
