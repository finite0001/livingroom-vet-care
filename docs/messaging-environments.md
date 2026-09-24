# Outbound messaging environments

The existing `send-email`, `send-sms`, and `send-provider-email` Edge Functions now fail closed. Missing credentials or settings do not create a pretend successful delivery. These controls apply on the server after active-staff authorization and recipient binding. Browser settings cannot override them. Client conversation sends (`send-email` and `send-sms`) now queue durable outbound delivery work instead of calling providers directly; provider acceptance is established later by the dispatcher and callbacks.

## Server configuration

Set these as Supabase Edge Function secrets per project, never Vite variables or committed environment files.

| Variable | Values / meaning |
| --- | --- |
| `APP_ENV` | Exactly `development`, `staging`, or `production`; required. |
| `OUTBOUND_DELIVERY_MODE` | `disabled`, `test`, or `live`. Missing means disabled. Unknown values reject requests. |
| `OUTBOUND_DISPATCHER_TOKEN` | Required by the `dispatch-outbound-deliveries` worker endpoint. Use a long random server-side token and send it only from the scheduler/worker caller. |
| `OUTBOUND_TEST_EMAILS` | Comma-separated exact bare mailboxes for email test sends. No wildcards or domain rules. |
| `OUTBOUND_TEST_PHONES` | Comma-separated phone numbers with explicit `+` country codes for SMS test sends. |
| `RESEND_API_KEY` | Resend credential, required for either email function. |
| `RESEND_FROM` | Bare email or `Practice Name <email>` on a sending domain verified in Resend. |
| `RESEND_REPLY_TO` | Required bare practice mailbox receiving client/provider replies. |
| `RESEND_WEBHOOK_SECRET` | Svix signing secret for the configured Resend delivery webhook endpoint. |
| `TWILIO_ACCOUNT_SID` | Twilio account SID beginning with `AC` and 32 hexadecimal characters. |
| `TWILIO_AUTH_TOKEN` | Twilio credential. |
| `TWILIO_FROM_NUMBER` | Twilio sending number with explicit country code. |
| `TWILIO_STATUS_CALLBACK_URL` | Exact public callback URL configured in Twilio for message status callbacks. |
| `TWILIO_INBOUND_WEBHOOK_URL` | Exact public inbound SMS URL configured in Twilio for incoming message webhooks. |

Keep development disabled normally. To run a controlled delivery test, configure `APP_ENV=staging` (or development), `OUTBOUND_DELIVERY_MODE=test`, the channel allowlist, and sandbox/test-account provider credentials. Test mode can actually send to allowlisted recipients; it is not a provider emulator. An absent, empty, or partially malformed channel allowlist blocks every send on that channel. The other channel's allowlist never grants permission.

Only `APP_ENV=production` can use `OUTBOUND_DELIVERY_MODE=live`. Production can also remain disabled or use test mode during commissioning. The dedicated project was subsequently configured with `APP_ENV=staging` and `OUTBOUND_DELIVERY_MODE=disabled`; `send-email` and `send-sms` were deployed. No real messages were sent. See [commissioning status](foundation-progress-2026-09-12.md).

Email addresses are normalized for case and surrounding spaces. Plus aliases remain distinct. SMS normalization removes presentation punctuation only; it does not infer a country code. Stored client numbers and consent records must therefore use explicit international numbers. A matching number with absent, conflicting, or negative SMS consent blocks sending.

Test mode never reroutes a client message to an allowlisted inbox or phone. Create an appropriate synthetic client/provider record with the approved test recipient instead. Client sends must still match the conversation's client, and provider sends use the active provider contact's stored email. Existing provider attachment ownership checks remain in place.

## Outbox dispatcher

The `dispatch-outbound-deliveries` Supabase Edge Function is a token-protected worker endpoint, not a staff-facing browser endpoint. A scheduler or operator must provide the configured `OUTBOUND_DISPATCHER_TOKEN`; unauthenticated requests, missing tokens, and mismatched tokens fail before any queue claim or provider call.

When enabled, the dispatcher claims due `public.outbound_deliveries` rows through `public.claim_due_outbound_deliveries(...)`, sends email through Resend or SMS through Twilio according to each row's channel and payload, and settles every claimed row through `public.record_outbound_delivery_result(...)`. It reuses the delivery-policy safeguards above: disabled mode blocks all sends before a queue claim, test mode sends only to exact allowlisted recipients for the channel, live mode is production-only, malformed recipients fail closed, and SMS consent/opt-out rules remain mandatory.

Provider HTTP acceptance is still not final delivery. Staff-facing client sends return `queued: true` only after the database has atomically inserted the visible staff message and the `outbound_deliveries` row. The local provider callback handlers can settle terminal delivery status after deployment and registration, but bounce/suppression workflows are still separate. Until those callbacks are commissioned, the dispatcher records provider acceptance, rejection, transport uncertainty, retry safety, and provider metadata without treating provider HTTP acceptance as recipient delivery.

Staff can inspect outbound delivery rows in the Hub. Guarded staff RPCs allow retrying `FAILED`/`UNKNOWN` deliveries and canceling still-`QUEUED` deliveries with an `updated_at` stale-row guard; browser staff still cannot update the outbox table directly. Retry clears stale provider identifiers and grants one additional worker attempt, while canceling records `CANCELED` before any worker claim. Actively leased, accepted, delivered, and already canceled rows are not manually mutated from the Hub.

## Provider callback settlement

The database now exposes `public.record_outbound_delivery_callback(...)` for service-role-only callback settlement after provider acceptance. It matches the delivery by provider plus provider message ID, records `DELIVERED`, `FAILED`, or `UNKNOWN`, keeps duplicate same-status callbacks idempotent, rejects conflicting terminal-state overwrites, and synchronizes linked appointment reminders.

HTTP handlers now exist for Resend delivery webhooks and Twilio message status callbacks, and the 2026-09-23 hosted function inventory shows the reviewed handlers deployed to the dedicated Supabase project with expected JWT settings. They verify provider signatures before calling `record_outbound_delivery_callback(...)`, map terminal provider events to delivery states, ignore non-terminal provider events, and avoid returning raw provider/database errors. They are still not registered in provider dashboards or replay-tested against provider dashboards, so they are not commissioned for live delivery.

## Inbound SMS processing

The repository and hosted function inventory now include `twilio-inbound-sms` plus the service-role-only `public.record_inbound_sms(...)` RPC. The handler verifies `X-Twilio-Signature` with the configured Twilio auth token and exact inbound webhook URL, parses Twilio form fields, and records an empty TwiML response after successful ingestion. The RPC normalizes explicit international phone numbers only, matches an existing client by phone or creates a staff-visible placeholder client, inserts a `CLIENT` SMS message with Twilio idempotency metadata, marks the conversation unread, and updates SMS consent for STOP/START/HELP semantics.

This is implementation and deployment evidence, not provider commissioning. Before live use, configure `TWILIO_INBOUND_WEBHOOK_URL` to the exact public function URL, point the Twilio number's incoming-message webhook at that URL, verify duplicate `MessageSid` behavior, and run synthetic HELP/STOP/START/reply round trips from an approved test number. Voice calls, voicemail/recording callbacks, inbound email parsing, bounce/suppression workflows, and per-user inbox read state remain outside this increment.

## Reply routing

Configure an owned domain and a working practice mailbox before enabling email. Verify DNS/sending-domain ownership in Resend, and test that replies reach the practice's intended inbox. `RESEND_REPLY_TO` is validated syntactically and added to every email, including provider emails with attachments. The function cannot prove mailbox ownership, inbox readiness, or delivery through syntax validation; those require operational verification. It is deliberately required in test mode as well so tests exercise the real reply route. No Gmail dependency is introduced.

## Result contract

- `accepted: true` means the provider returned a successful HTTP response. It does not mean the recipient received the message.
- `queued: true` means a staff client-message request has a committed `messages` row and a queued `outbound_deliveries` row; no provider request has been made yet.
- `delivered` remains `false` until verified provider callback settlement establishes delivery in the durable outbox. Existing attempt/delivery rows retain their historical values with a precise `status_note`.
- `success` reflects either durable queueing for staff client sends or provider acceptance for legacy/provider-document sends, depending on the endpoint.
- `acceptance_unknown: true` marks a transport failure where the provider may already have received the request.
- `retry_safe: false` prevents clients from interpreting an error as permission to automatically retry when provider acceptance could be ambiguous. Staff-send queue failures return `retry_safe: true` because no provider request was made.
- Policy failures return an error status before message insertion. Provider rejections are handled responses with `success: false`, `accepted: false`, and a note.
- Queue insertion failure returns HTTP 500 with `accepted: false`, `queued: false`, and a private-error-safe message. Audit insertion failure on legacy/provider-document sends returns HTTP 500 with the actual `accepted` value and a warning to inspect provider activity before retrying. Do not resend merely because the audit write failed.

Provider response bodies and raw exceptions are neither returned nor logged. Queue/audit errors record only generic transport outcomes or provider HTTP status codes, avoiding provider payloads that may contain message content or personal data. Existing recipient and message audit fields remain access-controlled practice records.

## Current limitations

The repository now has the database lifecycle for a durable outbox: `public.outbound_deliveries`, appointment-reminder enqueueing, service-role-only staff message enqueueing, service-role-only worker claim/result/callback RPCs, guarded active-staff retry/cancel RPCs, row-level staff read visibility, lease-owner checks, retry scheduling, terminal provider status timestamps, pgTAP coverage, and the local `dispatch-outbound-deliveries` Edge Function bridge. It also has local inbound SMS ingestion and STOP/START consent handling. The existing `send-email` and `send-sms` Edge Functions now enqueue client conversation sends through `public.enqueue_staff_outbound_message(...)`; `send-provider-email` still calls Resend synchronously because authorized document/package delivery needs a separate outbox design.

There is still no scheduled dispatcher, provider-registered callback endpoint, provider-registered inbound SMS endpoint, inbound email processing, bounce/suppression workflow, voicemail/voice webhook, provider-document outbox, or production scheduling. A provider-document request may succeed before the legacy audit write fails. Reconcile those cases manually against provider activity before any retry. Old records previously marked delivered by provider HTTP success are not rewritten.

Before live use, complete dispatcher deployment/scheduling, provider webhook registration and replay tests, inbound SMS round trips, reply routing tests, provider configuration, and operational SMS consent/opt-out acceptance. Public contact-form submissions are separate database records and do not use these outbound functions.

## Verification

`node --test tests/delivery/*.test.ts` covers disabled and malformed configuration, exact channel allowlists, recipient/header injection, explicit international phone normalization, reply configuration, consent, role-query errors, writes blocked before sending, staff-send queueing without provider calls, provider acceptance/rejection for the legacy provider-document path, transport uncertainty, webhook signature verification, terminal/ignored callback mapping, inbound SMS signature verification/RPC handoff, and audit/update failures. Handler tests execute transpiled function code with isolated database/provider doubles; they never contact Supabase, Resend, or Twilio. They do not substitute for deployment smoke tests with synthetic records.
