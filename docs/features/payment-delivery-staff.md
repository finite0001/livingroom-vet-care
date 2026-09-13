# Staff preparation of payment messages

`prepare-payment-delivery` captures reproducible message and transport hashes for an existing reviewed payment collection grant. It provides a transient review of the exact message and optional previously prepared invoice attachment. The function never enqueues, dispatches, or sends a message.

The runtime defaults off (`PAYMENT_DELIVERY_STAFF_ENABLED`). Staff recovery remains available when preparation is paused and requires neither capability keys nor sender configuration. `APP_URL` defines the allowed browser origin. Public capability materialization requires the existing payment-access origin/key configuration plus `PAYMENT_COLLECTION_ENABLED` and `PAYMENT_STATUS_ENABLED`. Email sender configuration uses `RESEND_FROM` and `RESEND_REPLY_TO`; SMS uses `TWILIO_FROM_NUMBER` and `TWILIO_ACCOUNT_SID`. Sender and capability configuration are read lazily. No provider transport credentials are used by this endpoint.

POST JSON has an incremental 450,000-byte limit. All responses use `Cache-Control: no-store`. JWT verification is enabled; database staff operations execute under the authenticated actor's JWT.

- `action: "prepare"` requires exactly `p_request_id`, `p_grant_id`, `p_conversation_id`, `p_channel`, `p_recipient`, `p_subject`, `p_body_template`, `p_invoice_email_request_id`, `p_invoice_payload_hash`. Optional attachment fields are explicitly null when absent. SQL is authoritative for exact immutable intent equality.
- `action: "recover"` requires only `p_request_id` and returns `{delivery}` containing safe request, capture, and receipt metadata, or null. It never materializes a usable payment link.
- `action: "review"` requires only `p_request_id`. An unqueued captured delivery returns `{delivery,preview:{message,recipient,subject,sender,attachment}}`. Attachment is null or the original verified invoice HTML attachment with base64 content. A queued receipt returns `{delivery}` without regenerating a link.

Review materializes the existing capability from frozen canonical context, verifies stored token hashes, and compares both current message and payload digests to the captured digests. Changed sender configuration fails review. Revocation, stale invoice source, wrong recipient, and lost consent remain enforced by the service context SQL checks. Usable links and transient previews must never enter browser persistence, logs, or message tables.

A 202 result is unconfirmed and retains the same `request_id`; recover that ID before retrying. A rejected or unacknowledged preparation cannot become success through an inferred recovery. Lost capture acknowledgments recover through the separate metadata-only action. A successful capture response must be confirmed by a non-null durable capture. SQL conflicts return 409; unavailable authorization returns 404 after authentication.

After the staff member reviews the actual rendered message and attachment, the UI may separately call actor-scoped `enqueue_payment_delivery` with both exact reviewed hashes and explicit attestation. This endpoint does not perform that action.

## Local verification

Nine focused handler tests cover email/SMS preparation, transient review, sender changes, actor ownership, strict input, incremental body limits, paused recovery, and lost acknowledgments.

Run `deno check --frozen tests/payment-access/delivery-local-server.ts` then `node --experimental-strip-types tests/payment-access/delivery-local-roundtrip.ts` for 16 actual localhost HTTP/Auth/PostgREST checks. `PAYMENT_TEST_PROJECT` optionally selects an existing local Supabase configuration. The production runtime runs with localhost-only networking and no transport keys. Checks include known reviewed grant capture, exact SQL retry, changed-intent rejection, no capability persistence, no queue creation, and revocation followed by metadata recovery. Only this run's synthetic fixtures are cleaned; Supabase is never reset, started, or stopped.

These tests do not exercise dispatch, provider acceptance, or real email/SMS delivery. Those are separate integration boundaries.

## Actual queue and worker roundtrip

The local delivery runner now passes44 checks through production staff HTTP handlers, Auth, PostgREST and `dispatchOne` with actual SQL claim/start/finish operations. Provider transport is injected and synthetic. The runner refuses to start if pending or claimed unrelated outbox work exists and cleans only its random fixture identities. It never starts, resets or stops Supabase.

Evidence includes exact captured transport digest, explicit queue replay returning one receipt, email body equality with staff review, a real invoice renderer attachment preserved byte-for-byte, SMS consent, accepted-versus-delivered status, uncertain outcome without automatic retry, revocation before worker transport, and absence of usable capabilities in stored outbox rows. Configure only the existing local project through `PAYMENT_TEST_PROJECT`; run `deno check --frozen tests/payment-access/delivery-local-server.ts` then `node --experimental-strip-types tests/payment-access/delivery-local-roundtrip.ts`. CI executes this same test. No actual Resend/Twilio requests or messages occur.
