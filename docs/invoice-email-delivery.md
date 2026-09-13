# Reviewed invoice email delivery

Staff can prepare one durable invoice email intent, review its exact frozen message and HTML attachment, then explicitly queue it. Preparation never sends or queues. Payment collection is separate: this attachment is an invoice, not a receipt, outstanding-balance statement, or checkout link.

Only issued invoices qualify. The source hash includes exact decimal-string amounts, lines, credits, current household identity/version and normalized primary email; it excludes the volatile `rendered_at` field. The first preparation freezes that timestamp with the document. Credit creation need not increment invoice.version: its content still changes the hash. Current invoice and household rows are locked while capturing, queuing and checking delivery eligibility. Void, credit, contact, identity, suppression and inactive-actor changes fail closed. Existing committed queue retries return their original receipt without creating another message.

## Staff contract

- `read_invoice_email_preview(p_invoice_id,p_client_id)` returns `{document,source_hash,client_id,recipient}`.
- `prepare_invoice_email(p_request_id,p_invoice_id,p_client_id,p_conversation_id,p_recipient,p_subject,p_body,p_invoice_hash)` creates or recovers the actor-owned exact request. Preserve UUID and arguments through ambiguous responses.
- Authenticated Edge `prepare-invoice-email` accepts those same eight arguments, checks the user, prepares the intent and captures the rendered attachment once. It returns recovery state, never queues. Error responses include `error`, `code`, and `retry_requires_recovery:true`.
- `recover_invoice_email(p_invoice_id,p_request_id default null)` returns `{request,payload_hash,manifest,report_html,purged_at,receipt}`. An explicit request ID also recovers an abandoned request. Recovery remains available after source ineligibility so staff can inspect history and abandon unqueued work.
- `enqueue_invoice_email(p_request_id,p_reviewed_payload_hash,p_attest)` requires review of the exact attachment and message and returns the existing/new outbox row.
- `abandon_invoice_email(p_request_id)` abandons only the actor's unqueued intent. `read_invoice_email_attachment(p_request_id,p_index)` returns authorized frozen original attachment bytes.

The conversation must belong to the current household. Email authorization uses its current primary email and existing suppression policy; this feature does not invent a new opt-in field. Request tables, provider payloads, and internal document/context functions have no direct staff, anonymous or service-role grants. Audit metadata excludes the invoice snapshot, subject, body and provider bytes.

## Frozen transport and rollout

The service captures the complete Resend JSON request, including sender, reply-to, recipient, subject, body and a single `invoice-<id>.html` attachment with `text/html` MIME type. SHA-256 and size are computed from actual UTF-8 bytes. The application caps the **entire serialized request** at 32 MiB, including base64 and metadata. The existing 23-hour provider idempotency guard, lease checks, sender verification and ambiguous-send reconciliation remain in force. Raw attachment IDs cannot enter this path. HTML is never renamed PDF.

Apply migration `20260913270000_invoice_email.sql` **before** deploying the updated dispatcher and preparer, then ship the coordinated frontend. A new dispatcher against an old database fails closed because `read_frozen_email_payload` is missing. An old dispatcher against the new database cannot send an invoice as plain text: the new start guard requires the frozen invoice payload hash. Existing ordinary messages and clinical record-release email retain their guards and compatibility. Clinical release acceptance is not reused or weakened for invoices.

`prepare-invoice-email/deno.json` pins its Zod import, with a function-specific frozen lockfile. Verify the function with its explicit config in a functions-only directory, without the project's package.json/node_modules, as well as the repository-wide frozen checks. No deployment or live sends were performed for this increment.

## Retention and verification

An operator can schedule service-role `purge_expired_frozen_email_payloads(100)`, which purges up to 100 eligible payloads per artifact family. Bytes are eligible after 90 days only for abandoned preparations or accepted/delivered sends with provider receipt evidence. Pending, failed/uncertain delivery and unresolved reconciliation retain bytes. Hashes, manifest, immutable invoice snapshot and audit evidence remain. This is a documented operator job, not an automatically configured cloud schedule.

SQL tests cover permissions, durable retries, exact snapshots, source changes, frozen-payload proofs, old-dispatcher denial and retention. Unit tests cover exact BigInt money, escaping, no internal notes, deterministic HTML and payloads, full-request limits, preparation recovery and exact dispatch payload reuse. Frontend recovery/attestation is implemented in the separately stacked UI change.

Provider references: [Resend attachments](https://resend.com/docs/dashboard/emails/attachments), [idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys), [send-email API](https://resend.com/docs/api-reference/emails/send-email), and [Supabase function dependencies](https://supabase.com/docs/guides/functions/dependencies).

Run `python3 scripts/verify-invoice-edge-isolation.py` for the isolated dependency check and bundle; the Edge CI job runs it automatically. The full SQL regression run passed 33 files / 1,132 assertions; application checks passed 160 unit tests, lint, TypeScript and production build. Three legacy clinical fixtures now derive clinical dates explicitly in America/Denver so UTC midnight does not create future local clinical dates.
