# CloudTalk integration activation — September 26, 2026

## What this package implements

- A persistent staff CloudTalk phone at `/hub/call`, with a separate-tab option on narrow screens and a ringing indicator when the embedded phone sends its event.
- Signed CloudTalk account webhooks for completed calls, ready recordings, ready transcripts, AI analysis, and inbound/outbound SMS, MMS, or WhatsApp activity. Events are idempotent and scoped to configured practice numbers. Inbound SMS STOP records an opt-out and cancels queued sends.
- Staff call/message history and voicemail markers. An AI summary is displayed as unverified assistance. Administrators can fetch recording audio or transcript pages on demand through an authenticated Edge Function. API credentials never enter the browser or database.

CloudTalk can produce recordings without a transcript. In that case the audio player has no captions; the transcript action is shown only after CloudTalk reports `transcript.ready`.

The existing staff SMS and reminder queues still use their Twilio provider contract and remain behind the existing disabled live-send gate. CloudTalk's documented SMS API does not guarantee a provider message ID in its success response, and its `message.sent` webhook is carrier submission without delivered/failed status. Do not switch those queues to CloudTalk or claim handset delivery from these events without a controlled provider round trip and a reviewed correlation design. CloudTalk Phone itself can send one-to-one texts after messaging is activated on the account and number; those texts appear in CloudTalk activity, not the native conversation thread. Public phone display stays unset until the selected number is verified.

## Account inputs needed

1. In **CloudTalk → Account → Settings → API Keys**, create a dedicated key for this integration. In each Supabase project, save its Access Key ID and Secret as `CLOUDTALK_API_KEY_ID` and `CLOUDTALK_API_KEY_SECRET` under **Edge Functions → Secrets**. Do not place either in Vercel or any `VITE_` variable. Separate staging credentials are preferred if CloudTalk offers a test account; never copy production customer events to staging by default.
2. Provide the practice number in E.164 format (`+1...`) and verify in CloudTalk that it can receive calls and is activated for SMS. Save it as `CLOUDTALK_ALLOWED_NUMBERS` in the relevant Supabase project. Multiple owned numbers may be comma separated after each is reviewed.
3. After deploying `cloudtalk-webhook`, create an endpoint in **CloudTalk → Account → Webhooks** with URL `https://mgadheotkdnrsatfivjy.supabase.co/functions/v1/cloudtalk-webhook` for production. Select only `call.ended`, `call.recording_ready`, `transcript.ready`, `cidata.ready`, `message.sent`, and `message.received`. Reveal that endpoint's signing secret and save it to production Supabase as `CLOUDTALK_WEBHOOK_SECRET`. `CLOUDTALK_COMPANY_ID` is optional and can be set from a signed test event's `company_id` for another account check. Send a CloudTalk test event and inspect its delivery log for HTTP 200. Do not leave a staging endpoint subscribed to live customer traffic; use its own signing secret for isolated tests and disable it afterward.
4. In CloudTalk, assign the number to the intended agents, give each agent their CloudTalk Phone login, and configure business hours, routing, voicemail, and caller greeting. Enable call recording and Conversation Intelligence only with the practice's approved announcement, visibility, and retention settings. CloudTalk's `recording_ready`, `transcript.ready`, and `cidata.ready` events appear only when the corresponding account features produce them.

## Ordered activation and proof

1. Review and merge this source package only after frontend, Edge, and database CI pass for the same SHA.
2. Apply `20260926090000_cloudtalk_activity.sql` to staging; deploy `cloudtalk-webhook` and `cloudtalk-call-media` from that SHA. Verify their JWT flags (`false` for signed webhook, `true` for staff media). Repeat for production after staging proof.
3. Configure the CloudTalk secrets above. Before using customer data, send signed CloudTalk test events and confirm one call appears once, an out-of-order AI event joins its call, a replay creates no duplicate, a wrong signature is rejected, and an unowned number is ignored.
4. With a practice-owned test recipient and an authorized staff agent, complete inbound and outbound call round trips, voicemail, recording, and transcript/AI production. Confirm only administrators can fetch media. Exercise an SMS send/reply in CloudTalk Phone; verify its activity without claiming recipient delivery. Test opt-out only with a controlled number and confirm suppression in the app.
5. Publish the verified practice number through `src/config/practice.ts` only after call routing and SMS capability work. Keep `OUTBOUND_DELIVERY_MODE` and payment gates at their existing safe settings until their separate provider acceptance is complete.

## Local evidence

- `npm run typecheck`, `npm run lint`, `npm test` (1,090 tests), `npm run build`, and `deno check` for both functions passed during implementation.
- The migration applied to the local Supabase database. Rolled-back SQL probes confirmed AI-before-call merge, event replay idempotency, and SMS STOP suppression.
- Hosted CloudTalk configuration, real media retrieval, the selected number, and provider round trips still require account inputs and live acceptance. A passing local check is not a production activation receipt.

CloudTalk references: [webhook setup and event contract](https://developers.cloudtalk.io/guides/webhooks/overview), [signature scheme](https://developers.cloudtalk.io/guides/webhooks/verify-signatures), [message event limits](https://developers.cloudtalk.io/guides/webhooks/events/messages), [AI event contract](https://developers.cloudtalk.io/guides/webhooks/events/conversation-intelligence), [phone embedding](https://help.cloudtalk.io/en/articles/11791061-embedding-cloudtalk-phone-in-a-web-application).
