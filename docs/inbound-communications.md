# Signed inbound communications and inbox read model

This increment supplies provider-signed webhook handlers, durable event processing, conservative household/thread matching, STOP/START ordering and per-staff inbox reads. It does not deploy webhooks, send messages, modify DNS, automatically download attachments, or switch the existing inbox UI to the new RPCs.

## Endpoint commissioning

- `resend-webhook`: POST JSON; configure `RESEND_WEBHOOK_SECRET` and comma-separated `RESEND_INBOUND_ADDRESSES`. Register `email.received`, `email.sent`, `email.delivered`, `email.bounced`, `email.complained`, `email.failed` events as supported by the selected Resend account.
- `twilio-webhook`: POST form data; configure the exact externally registered `TWILIO_WEBHOOK_URL`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`. The same URL can receive incoming SMS and status callbacks. Enable Advanced Opt-Out to obtain provider `OptOutType` metadata.
- `process-inbound`: POST with the exact Supabase service-role credential; configure provider read credentials (`RESEND_API_KEY`, Twilio account/token). Each invocation handles one durable event. Schedule repeated invocations after controlled commissioning.

Only the two provider-signed webhook functions have `verify_jwt=false` in repository configuration, because providers do not send Supabase user tokens. Each still requires valid provider proof before its first database operation. Processing and database receipt/processing RPCs are service-only. No handler logs raw payloads or credentials.

Resend validation uses official Svix 2.5.0, preserving raw body bytes and enforcing its signed timestamp freshness. Twilio validation uses official Twilio 6.1.1, the exact configured external URL and every form field; forwarded-host headers are not trusted. Duplicate form keys and unexpected path/query values are rejected. Both endpoints cap streamed payloads at 64 KiB, independently of Content-Length.

Twilio's standard form signature does not supply a signed timestamp. The system therefore does not invent timestamp freshness validation: durable message/event ID deduplication prevents known replays, and provider-fetched message creation time orders consent changes. See [Twilio signature security](https://www.twilio.com/docs/usage/webhooks/webhooks-security) and [Resend webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests).

## Durable receipt and processing

`receive_communication_event` persists verified metadata under unique `(provider,event_id)`. Reused IDs with changed metadata hashes fail. Incoming message body retrieval occurs only after this transaction. A database failure produces a non-2xx response so the provider retries.

Status callbacks referencing an as-yet unknown provider receipt ID return 503 rather than being acknowledged and discarded. This handles the race where a callback arrives before `dispatch-outbox` persists provider acceptance. Provider retries then correlate to the immutable outbox row. No callback is assigned to a household by guessing its address.

The processor claims two-minute leases. Expired leases are reclaimable because provider GETs and downstream inserts are idempotent. Fetch or persistence errors leave durable work for retry with exponential backoff; ten failed attempts or invalid/oversized content require review. Review events remain retained. Staff/operator retry controls for this queue remain a UI/operations commissioning gate.

Provider reads use fixed HTTPS API URLs constructed from validated resource IDs, reject redirects, time out after 30 seconds, and cap streamed provider responses at 1 MB. The fetched sender/recipient/resource must match signed metadata. Twilio resource account/direction/body must also match. A mismatch becomes review, not an inbox message.

Resend plain text, original HTML, RFC Message-ID/references and attachment descriptors are retained. HTML-only emails receive an explicit plain-text placeholder. **The future UI must never render `html_body` without a dedicated sanitization workflow.** Attachment URLs, raw-message download URLs and media URLs are never fetched or promoted to patient files. Descriptors are informational until staff-authorized review/import exists. See [Resend Receiving API](https://resend.com/docs/api-reference/emails/retrieve-received-email).

## Household and thread matching

`communication_inbound` is the durable original. Unique provider/resource IDs prevent duplicated messages even when different webhook receipt IDs describe the same message.

A normalized sender matching exactly one household can link automatically. Shared or unknown addresses remain in review with no fabricated household or patient. RFC references to an already-known inbound message can select its existing household conversation. Otherwise exactly one active household conversation is reused; no active conversation creates a new one; several active conversations require staff review. Outgoing RFC Message-ID capture/first-reply threading still needs controlled provider round-trip verification. No pet is inferred from a shared household address.

For manual review, call:

```text
assign_inbound_communication(
  p_actor_id, p_id, p_expected_version,
  p_client_id, p_conversation_id, p_reason
)
```

Only active staff can assign. The conversation must belong to the selected household, a reason is required, stale versions fail, and assignment is retained in `communication_inbound_assignments`. Once linked, the corresponding conversation message is immutable apart from triage metadata. Original body and assignment evidence cannot silently diverge.

## Suppression and status

A durably received, signed STOP immediately blocks outbox dispatch while its provider timestamp is fetched. The shared suppression helper treats pending/claimed/review STOP events as suppressed. This is effective before the webhook response acknowledges receipt.

The processor applies STOP/START by normalized sender phone and provider creation time, checking both provider history and the newest manual/legacy consent timestamp. Older deliveries cannot reverse newer consent, and ties favor STOP. A newer verified START removes only client opt-out suppressions (`provider_sms_stop` and `staff_sms_opt_out`) and updates consent only for a unique household; unrelated staff blocks, bounce and complaint exclusions remain. Unknown senders remain suppressed/reviewable. Provider-managed opt-out responses are not duplicated by this application; Twilio receives empty TwiML. See [Twilio Advanced Opt-Out](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out).

Staff consent changes must use the authenticated RPC below. Direct `sms_consent` insert/update/delete privileges are revoked for browser and service roles, so the legacy `useUpdateConsent` direct-table hook must migrate before release.

```text
record_sms_consent(
  p_actor_id, p_client_id, p_phone, p_opted_in,
  p_method, p_details, p_expected_updated_at = null
) -> sms_consent
```

Use the session actor, the household’s current phone, a method of `VERBAL`, `WRITTEN` or `WEB_FORM`, and 5–1000 characters of supporting detail. Pass the latest `updated_at` across that household’s consent rows for the normalized phone, or null only when no row exists. Stale writes fail with SQLSTATE `40001`. The server normalizes the phone, owns consent timestamps, and serializes changes with provider processing. It updates legacy formatting variants together. Shared numbers cannot receive a manual opt-in. A staff-recorded opt-out immediately suppresses pending dispatch; manual opt-in removes only `staff_sms_opt_out`, preserving provider STOP and unrelated exclusions. Consent audit attribution uses the authenticated actor.

`sent`/`queued`/`sending` never imply delivery. `delivered` invokes the outbox delivery receipt RPC. Failed/undelivered events retain their receipt; bounced/complained email additionally suppresses the immutable intended recipient. A historical delivery receipt remains recorded, while `delivery_failure_kind` exposes subsequent bounce/complaint evidence. Complaint evidence cannot be downgraded to a bounce. The UI must display this failure indicator alongside historical delivery state.

## Inbox UI contract

`list_communication_inbox(p_search='',p_before_at=null,p_before_id=null,p_limit=50)` returns:

```text
conversation_id, client_id, client_name, updated_at,
latest_message_id, latest_content, latest_type, unread_count
```

Search covers household name and message content. Pages are limited to 1–100 entries and sorted by `(updated_at,conversation_id)` descending. Supply both cursor fields from the final displayed row for the next page. Refresh the first page on new activity/reconnection. The new query does not use legacy shared `conversations.is_read` for unread counts.

`mark_conversation_read(p_actor_id,p_conversation_id,p_message_id)` marks only the exact rendered message and earlier messages for that staff member. The message must belong to that conversation. Cursors only move forward; another staff member's unread count is unchanged. A message arriving after the rendered cursor remains unread. Use the authenticated session actor, never a user-selected staff ID.

Review UI can query `communication_inbound` where `message_id is null`, ordered by `(received_at,id)` with a bounded page. Provider-fetch review work is in `communication_provider_events` with `state='review'`. The UI should distinguish unmatched household review from provider content/retry review, and should not call either delivered.

## Remaining live verification

Register provider webhook URLs and secrets through trusted configuration, verify exact Twilio external URL through the real proxy, configure provider retry monitoring/worker scheduling, and run owner-authorized external email/SMS round trips. Add safe HTML review, authorized attachment ingestion and inbox UI migration. Existing Gmail-backed or legacy direct-send code is not switched by this increment.
