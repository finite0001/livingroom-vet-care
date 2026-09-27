# CloudTalk unified inbox

Owner decision (2026-09-27): all text messaging for The Living Room Vet runs through CloudTalk (practice number +1 720-764-6677). Twilio code stays in the repository but is not used. This change makes `/hub/chats` the single place staff see a household's texts, emails and calls.

## What happens to CloudTalk activity

`cloudtalk-webhook` verifies the signed event and calls `ingest_cloudtalk_event` (unchanged contract, plus `talking_seconds` from `call.ended.talking_time`). After the CloudTalk original is stored, database triggers from `20260928110000_cloudtalk_unified_inbox.sql` project it:

| CloudTalk original | Thread entry (`messages`) |
| --- | --- |
| `message.received` (SMS/MMS/WhatsApp) | `SMS`, sender `CLIENT`, labelled "Text via CloudTalk" |
| `message.sent` (from CloudTalk Phone) | `SMS`, sender `STAFF`, labelled "Sent from CloudTalk Phone"; shown as carrier submission only, never as delivered |
| `call.ended`, incoming | `CALL_INBOUND` "Incoming call · 2m 05s", or "Missed incoming call" when talk time is 0 |
| `call.ended`, outgoing | `CALL_OUTBOUND` "Outgoing call · …", or "Outgoing call, not answered" |
| `call.ended` with `is_voicemail` | `VOICEMAIL` "Voicemail · 58s" |
| internal/monitor legs, partial AI/recording rows, unowned numbers | not projected |

Every entry is keyed `provider = 'cloudtalk'`, `provider_message_id = 'message:<id>' | 'call:<call_uuid>'` (unique index), and recorded as an immutable `communication_inbound` row (`provider 'cloudtalk'`, no Resend/Twilio receipt, `direction` inbound/outbound). Webhook replays and re-deliveries under new event ids produce no duplicates.

Recording, transcript and AI summary arrive later; the thread reads them live from `cloudtalk_calls` under its existing RLS (active staff, trusted number). The Play recording / Read transcript buttons stay administrator-only and still go through `cloudtalk-call-media`, which enforces ADMIN server side. Nothing about media access was widened.

## Matching and review

Matching is the same rule as inbound email/SMS: the normalized E.164 external number must equal exactly one household's `primary_phone`. That household's single ACTIVE conversation is used (one is created if none exists). Otherwise the entry waits in **Inbox → Review unmatched incoming messages** (`/hub/inbox/review`) with reason "Unknown or shared sender", "Caller number withheld" or "Multiple possible conversation threads". Assigning it there creates the thread entry with the original CloudTalk time, direction and idempotency key. Staff-started CloudTalk Phone activity to an unknown number appears there as "Text sent from CloudTalk Phone" / "Outgoing call".

Inbound texts and calls mark the conversation unread; outbound CloudTalk Phone activity does not. Response-time metrics skip CloudTalk Phone replies because they have no app staff identity (`track_response_metric` now requires `sender_id`).

## Immutability, failures and privacy

- `cloudtalk_messages` and `cloudtalk_events` cannot be updated or deleted; `cloudtalk_calls` cannot be deleted or re-keyed (lifecycle merges continue). CloudTalk `communication_inbound` rows and their thread messages are immutable.
- If a projection cannot be written (for example a database error), the webhook still succeeds, the original is kept and `cloudtalk_projection_failures` records only the resource id and SQLSTATE. `/hub/call` shows the count; an administrator can press **Retry adding to inbox** (`retry_cloudtalk_projections`), which re-runs only the recorded failures, oldest first.
- No phone numbers or message bodies are logged by the projection; the webhook's existing log line (reason and field types only) is unchanged.
- The migration backfills everything recorded since CloudTalk went live on 2026-09-26.

## Private links in CloudTalk text (`20260928160000_cloudtalk_capability_redaction.sql`)

App SMS goes through CloudTalk, so CloudTalk's `message.sent` webhook repeats a reviewed document-link or payment-link text in full, including its bearer token (`https://<origin>/shared/<grant>#v1.…`, `/pay/<grant>#p1.…`, `/payment/return|cancel/<grant>#s1.…`, `/estimate/<grant>#e1.…`). Before this migration that token was stored in `cloudtalk_messages.body`, readable by every active staff session, and the projection refused it forever.

Now capabilities never reach storage:

1. `cloudtalk-webhook` redacts every string in the verified event (`_shared/private-capability-redaction.ts`) before calling `ingest_cloudtalk_event`.
2. `redact_cloudtalk_capabilities` triggers redact `cloudtalk_messages.body` on insert and `cloudtalk_calls.ai_summary` on insert and update, whatever the write path.
3. `reject_persisted_document_capability` now also guards both tables, so a token that escaped redaction fails closed rather than being stored.

Recognition is the guard's own token shape, `(v1|p1|s1)\.[A-Za-z0-9_-]{43}`, plus the estimate `e1.` shape. When the token is a URL fragment the whole URL goes, so the grant id is not kept either. Placeholders: `[secure document link]`, `[secure payment link]`, `[secure estimate link]`. A grant URL with no token grants nothing and is left alone. `public.redact_private_capabilities(text)` and the TypeScript module implement the same rule; change them together.

The echo of an app send is matched to its outbox (or `outbound_deliveries`) row after mapping the stored template (`{{document_link}}`, `{{payment_link}}`) to its placeholder (`cloudtalk_app_send_text`), so it is absorbed like any other app send. A link text typed in CloudTalk Phone, or one outside the send window, projects as a normal outbound entry showing the placeholder. It is never recorded as a failure.

**Existing rows.** CloudTalk originals stay immutable. `guard_cloudtalk_original` allows exactly one change to a stored message: replacing `body` with `redact_private_capabilities(body)`, every other column unchanged. That change can only remove a capability, and each one writes a row (source, field, time, database role, no content) to the append-only `cloudtalk_capability_redactions`. No guard is disabled, not even during the migration. The migration runs the owner-only `redact_stored_cloudtalk_capabilities()` once. It redacts stored bodies and AI summaries, audits each, and re-projects the affected texts, which clears the failures their tokens caused. It is idempotent and returns the number of rows it changed. `messages`, `communication_inbound` and `cloudtalk_projection_failures` need no redaction: the first two always refused tokens and the third stores no content. Any document or payment link texted before the migration was stored in plaintext, so treat those grants as exposed to staff readers and revoke or reissue them if that matters.

## `/hub/call`

Still gated by `VITE_CLOUDTALK_ENABLED` (embedded phone and activity pages). Each call and text there now links to "Open household thread" or "Needs household review". Thread entries render whenever data exists, regardless of the flag; the "Phone activity" link inside a call entry is only shown when the flag is on.

## Texts the app sends through CloudTalk

When the outbound workstream sends a reply, reminder or queued staff message through CloudTalk, the thread already holds that staff message (with its outbox delivery state), and CloudTalk also fires `message.sent` for it. CloudTalk returns no identifier the app can store at send time, so the projection absorbs an outbound echo when a `communication_outbox` or `outbound_deliveries` SMS with a thread message has the same normalized recipient and exact body and was attempted between 1 hour before and 10 minutes after the echo. At most one echo is absorbed per app send, so an identical text typed in CloudTalk Phone inside that window still appears. Absorbed echoes stay in `cloudtalk_messages` and are not failures. This is a heuristic: if CloudTalk rewrites the body (for example appends opt-out text), echoes will show as a second "Sent from CloudTalk Phone" entry; confirm during the live check.

Staff sessions keep their general `messages` insert policy but cannot insert or change a `provider = 'cloudtalk'` entry (trigger `guard_cloudtalk_thread_message`); only the projection and review assignment write them.

## Out of scope here

App-originated sends (reply composer, reminders, outbox dispatch) are owned by the outbound workstream (`supabase/functions/_shared/outbox-dispatch.ts`, `dispatch-outbound-deliveries`).

## Verification

- `supabase/tests/cloudtalk_unified_inbox.test.sql` (66 assertions): matching, review queue, replay idempotency, missed/answered/voicemail/internal/withheld calls, immutability, RLS reads, admin-only retry, projection-failure path, app-send echo absorption, forged-entry guard.
- `supabase/tests/cloudtalk_capability_redaction.test.sql` (43 assertions): recognition and placeholders, redaction on ingest, placeholder projection, app document-link echo absorbed (not a failure), AI summary redaction, the guards still blocking raw tokens, redaction-only mutation of originals, backfill with audit and idempotency.
- `tests/cloudtalk/capability-redaction.test.ts`: edge redaction rules, nested event data, and a signed `message.sent` document-link echo coming out of `verifyCloudTalkWebhook` redacted.
- `tests/cloudtalk/thread-entry.test.ts`, `tests/inbound-review/state.test.ts`: UI mapping and review labels.
- `e2e/communications-queue.spec.ts` "CloudTalk texts and calls render in the household thread without widening media access".

## Owner actions

1. Apply `20260928110000_cloudtalk_unified_inbox.sql` and `20260928160000_cloudtalk_capability_redaction.sql` to staging, then production (backfills run in the migrations), then redeploy `cloudtalk-webhook`.
2. With the live number: text the practice from a phone saved as a household's primary phone and confirm it lands in that thread; repeat from an unknown number and confirm it lands in review; place a missed call and a voicemail; send a text from CloudTalk Phone; send a reply from `/hub/chats` (once CloudTalk outbound is live) and confirm it appears once.
