# Outbound messaging environments

The existing `send-email`, `send-sms`, and `send-provider-email` Edge Functions now fail closed. Missing credentials or settings do not create a pretend successful delivery. These controls apply on the server after active-staff authorization and recipient binding, and before message writes or provider requests. Browser settings cannot override them.

## Server configuration

Set these as Supabase Edge Function secrets per project, never Vite variables or committed environment files.

| Variable | Values / meaning |
| --- | --- |
| `APP_ENV` | Exactly `development`, `staging`, or `production`; required. |
| `OUTBOUND_DELIVERY_MODE` | `disabled`, `test`, or `live`. Missing means disabled. Unknown values reject requests. |
| `OUTBOUND_TEST_EMAILS` | Comma-separated exact bare mailboxes for email test sends. No wildcards or domain rules. |
| `OUTBOUND_TEST_PHONES` | Comma-separated phone numbers with explicit `+` country codes for SMS test sends. |
| `RESEND_API_KEY` | Resend credential, required for either email function. |
| `RESEND_FROM` | Bare email or `Practice Name <email>` on a sending domain verified in Resend. |
| `RESEND_REPLY_TO` | Required bare practice mailbox receiving client/provider replies. |
| `TWILIO_ACCOUNT_SID` | Twilio account SID beginning with `AC` and 32 hexadecimal characters. |
| `TWILIO_AUTH_TOKEN` | Twilio credential. |
| `TWILIO_FROM_NUMBER` | Twilio sending number with explicit country code. |

Keep development disabled normally. To run a controlled delivery test, configure `APP_ENV=staging` (or development), `OUTBOUND_DELIVERY_MODE=test`, the channel allowlist, and sandbox/test-account provider credentials. Test mode can actually send to allowlisted recipients; it is not a provider emulator. An absent, empty, or partially malformed channel allowlist blocks every send on that channel. The other channel's allowlist never grants permission.

Only `APP_ENV=production` can use `OUTBOUND_DELIVERY_MODE=live`. Production can also remain disabled or use test mode during commissioning. The dedicated project was subsequently configured with `APP_ENV=staging` and `OUTBOUND_DELIVERY_MODE=disabled`; `send-email` and `send-sms` were deployed. No real messages were sent. See [commissioning status](foundation-progress-2026-09-12.md).

Email addresses are normalized for case and surrounding spaces. Plus aliases remain distinct. SMS normalization removes presentation punctuation only; it does not infer a country code. Stored client numbers and consent records must therefore use explicit international numbers. A matching number with absent, conflicting, or negative SMS consent blocks sending.

Test mode never reroutes a client message to an allowlisted inbox or phone. Create an appropriate synthetic client/provider record with the approved test recipient instead. Client sends must still match the conversation's client, and provider sends use the active provider contact's stored email. Existing provider attachment ownership checks remain in place.

## Reply routing

Configure an owned domain and a working practice mailbox before enabling email. Verify DNS/sending-domain ownership in Resend, and test that replies reach the practice's intended inbox. `RESEND_REPLY_TO` is validated syntactically and added to every email, including provider emails with attachments. The function cannot prove mailbox ownership, inbox readiness, or delivery through syntax validation; those require operational verification. It is deliberately required in test mode as well so tests exercise the real reply route. No Gmail dependency is introduced.

## Result contract

- `accepted: true` means the provider returned a successful HTTP response. It does not mean the recipient received the message.
- `delivered` always remains `false` until a future verified delivery-callback implementation establishes delivery. Existing attempt/delivery rows retain that value with a precise `status_note`.
- `success` reflects provider acceptance, not merely recording a database row.
- `acceptance_unknown: true` marks a transport failure where the provider may already have received the request.
- `retry_safe: false` prevents clients from interpreting an error as permission to automatically retry. This release has no idempotency mechanism.
- Policy failures return an error status before message insertion. Provider rejections are handled responses with `success: false`, `accepted: false`, and a note.
- Audit insertion failure returns HTTP 500 with the actual `accepted` value and a warning to inspect provider activity before retrying. Do not resend merely because the audit write failed.

Provider response bodies and raw exceptions are neither returned nor logged. Audit errors record only generic transport outcomes or provider HTTP status codes, avoiding provider payloads that may contain message content or personal data. Existing recipient and message audit fields remain access-controlled practice records.

## Current limitations

There is no durable outbox, transactional send, idempotency key, delivery callback, webhook verification, inbound email/SMS processing, retry worker, bounce/suppression processing, or scheduling in this change. An existing message insert may succeed before its conversation update fails; that message must not be treated as sent. A provider request may succeed before the audit write fails. Reconcile those cases manually against provider activity before any retry. Old records previously marked delivered by provider HTTP success are not rewritten.

Before live use, complete the planned outbox and callback work, test reply routing and provider configuration, and confirm operational SMS consent/opt-out handling. Public contact-form submissions are separate database records and do not use these outbound functions.

## Verification

`node --test tests/delivery/*.test.ts` covers disabled and malformed configuration, exact channel allowlists, recipient/header injection, explicit international phone normalization, reply configuration, consent, role-query errors, writes blocked before sending, provider acceptance/rejection, transport uncertainty, and audit/update failures. Handler tests execute transpiled function code with isolated database/provider doubles; they never contact Supabase, Resend, or Twilio. They do not substitute for deployment smoke tests with synthetic records.
