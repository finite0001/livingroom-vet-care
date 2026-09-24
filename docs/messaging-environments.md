# Outbound messaging environments

Current sending uses reviewed durable queue intents and the `dispatch-outbox` worker. `send-email` and `send-sms` are retired HTTP410 endpoints; do not use them for commissioning. `send-provider-email` is not commissioned. Missing credentials or settings cannot create a successful delivery. Browser settings cannot override server policy. See [the outbox contract](communications-outbox.md) and [managed worker authentication](service-worker-authentication.md).

## Server configuration

Set these as Supabase Edge Function secrets per project, never Vite variables or committed environment files.

| Variable | Values / meaning |
| --- | --- |
| `APP_ENV` | Exactly `development`, `staging`, or `production`; required. |
| `OUTBOUND_DELIVERY_MODE` | `disabled`, `test`, or `live`. Missing means disabled. Unknown values reject requests. |
| `OUTBOUND_TEST_EMAILS` | Comma-separated exact bare mailboxes for email test sends. No wildcards or domain rules. |
| `OUTBOUND_TEST_PHONES` | Comma-separated phone numbers with explicit `+` country codes for SMS test sends. |
| `RESEND_API_KEY` | Resend credential used only by server-side dispatch and receiving. |
| `RESEND_FROM` | Bare email or `Practice Name <email>` on a sending domain verified in Resend. |
| `RESEND_REPLY_TO` | Required bare practice mailbox receiving client/provider replies. |
| `TWILIO_ACCOUNT_SID` | Twilio account SID beginning with `AC` and 32 hexadecimal characters. |
| `TWILIO_AUTH_TOKEN` | Twilio credential. |
| `TWILIO_FROM_NUMBER` | Twilio sending number with explicit country code. |

Keep development disabled normally. To run a controlled delivery test, configure `APP_ENV=staging` (or development), `OUTBOUND_DELIVERY_MODE=test`, the channel allowlist, and sandbox/test-account provider credentials. Test mode can actually send to allowlisted recipients; it is not a provider emulator. An absent, empty, or partially malformed channel allowlist blocks every send on that channel. The other channel's allowlist never grants permission.

Only `APP_ENV=production` can use `OUTBOUND_DELIVERY_MODE=live`. Production can also remain disabled or use test mode during commissioning. The dedicated project was configured with `APP_ENV=staging` and `OUTBOUND_DELIVERY_MODE=disabled`; reviewed queue/worker handlers and the retired direct-send endpoints were deployed. No real messages were sent. See [commissioning status](foundation-progress-2026-09-12.md).

Email addresses are normalized for case and surrounding spaces. Plus aliases remain distinct. SMS normalization removes presentation punctuation only; it does not infer a country code. Stored client numbers and consent records must therefore use explicit international numbers. A matching number with absent, conflicting, or negative SMS consent blocks sending.

Test mode never reroutes a client message to an allowlisted inbox or phone. Create an appropriate synthetic client/provider record with the approved test recipient instead. Client sends must still match the conversation's client, and provider sends use the active provider contact's stored email. Existing provider attachment ownership checks remain in place.

## Reply routing

Configure an owned domain and a working practice mailbox before enabling email. Verify DNS/sending-domain ownership in Resend, and test that replies reach the practice's intended inbox. `RESEND_REPLY_TO` is validated syntactically and added to every email, including provider emails with attachments. The function cannot prove mailbox ownership, inbox readiness, or delivery through syntax validation; those require operational verification. It is deliberately required in test mode as well so tests exercise the real reply route. No Gmail dependency is introduced.

## Durable result and retry contract

- Queue confirmation means the request and corresponding conversation message are saved, not sent.
- `accepted` requires a validated provider receipt ID; it is distinct from `delivered`.
- Verified provider events establish delivery/failure and bounce/complaint suppression. A later complaint remains visible even if a prior delivery receipt exists.
- An ambiguous enqueue retains its original UUID and payload for recovery. An ambiguous provider outcome is retained as uncertain; do not create a new request to bypass it.
- Resend's bounded idempotency retry and Twilio's evidence-required uncertainty handling are described in [the outbox contract](communications-outbox.md). Ordinary staff cannot invent provider receipts or delivery evidence.

The worker records an attempt before transport and finalizes only under its lease. A database failure after transport cannot be interpreted as non-acceptance. Raw provider errors and credentials are excluded from user-visible outcomes.

## Current implementation and commissioning boundary

Durable queueing, signed callbacks, inbound processing, consent/suppression, inbox review, clinical/invoice attachments and reminder bridges are implemented. Public document/payment capabilities have separate configuration and default-off gates. Their exact review paths must be used; the generic text composer cannot authorize arbitrary private attachments.

Provider accounts/credentials, application receiving routes, production Auth SMTP, scheduling and real controlled round trips remain uncommissioned. Sending DNS is verified, and Fastmail root-domain human mail has separate evidence; client reply ingestion through the application remains a distinct commissioning gate. See [domain setup](email-domain-setup.md), [mail commissioning](mail-commissioning-plan.md), [inbound processing](inbound-communications.md), [reminder dispatch](reminder-dispatch.md), [record release email](release-email-delivery.md), [invoice email](invoice-email-delivery.md) and [payment delivery](features/staff-payment-delivery-ui.md). A passing local test does not enable any provider flag or authorize a send.

## Verification

`node --test tests/delivery/*.test.ts` covers disabled and malformed configuration, exact channel allowlists, recipient/header injection, explicit international phone normalization, reply configuration, consent, role-query errors, writes blocked before sending, provider acceptance/rejection, transport uncertainty, and audit/update failures. Handler tests execute transpiled function code with isolated database/provider doubles; they never contact Supabase, Resend, or Twilio. They do not substitute for deployment smoke tests with synthetic records.
