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
- If a projection cannot be written (for example text that trips the document-capability guard), the webhook still succeeds, the original is kept and `cloudtalk_projection_failures` records only the resource id and SQLSTATE. `/hub/call` shows the count; an administrator can press **Retry adding to inbox** (`retry_cloudtalk_projections`).
- No phone numbers or message bodies are logged by the projection; the webhook's existing log line (reason and field types only) is unchanged.
- The migration backfills everything recorded since CloudTalk went live on 2026-09-26.

## `/hub/call`

Still gated by `VITE_CLOUDTALK_ENABLED` (embedded phone and activity pages). Each call and text there now links to "Open household thread" or "Needs household review". Thread entries render whenever data exists, regardless of the flag; the "Phone activity" link inside a call entry is only shown when the flag is on.

## Out of scope here

App-originated sends (reply composer, reminders, outbox dispatch) are owned by the outbound workstream (`supabase/functions/_shared/outbox-dispatch.ts`, `dispatch-outbound-deliveries`).

## Verification

- `supabase/tests/cloudtalk_unified_inbox.test.sql` (54 assertions): matching, review queue, replay idempotency, missed/answered/voicemail/internal/withheld calls, immutability, RLS reads, admin-only retry, projection-failure path.
- `tests/cloudtalk/thread-entry.test.ts`, `tests/inbound-review/state.test.ts`: UI mapping and review labels.
- `e2e/communications-queue.spec.ts` "CloudTalk texts and calls render in the household thread without widening media access".

## Owner actions

1. Apply `20260928110000_cloudtalk_unified_inbox.sql` to staging, then production (backfill runs in the migration). No Edge Function redeploy is required.
2. With the live number: text the practice from a phone saved as a household's primary phone and confirm it lands in that thread; repeat from an unknown number and confirm it lands in review; place a missed call and a voicemail; send a text from CloudTalk Phone.
