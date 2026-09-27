# CloudTalk outbound SMS — September 28, 2026

Owner decision, September 27, 2026: all text messaging runs through CloudTalk (practice number `+1 720-764-6677`, A2P 10DLC registration submitted through CloudTalk). Twilio code stays in the repository and remains selectable, but it is not used. This replaces the "do not switch those queues to CloudTalk" guidance in the [September 26 activation note](2026-09-26-cloudtalk-activation.md).

Nothing in this package sends a message by itself. `OUTBOUND_DELIVERY_MODE` stays at its current setting (disabled in production) until the owner runs the controlled test below.

## What changed

- **One SMS provider switch in each layer.**
  - Database: `communication_sms_provider_setting` (one row, `cloudtalk` after migration `20260928100000_cloudtalk_outbound_sms.sql`). Every outbox enqueue path (conversation composer, appointment/vaccine/lab reminders, document secure links, payment links) inserts SMS rows as `twilio`. A `before insert` trigger replaces that value with the setting. No API role can change the setting; changing it is an owner SQL action.
  - Edge: `SMS_PROVIDER`, either `cloudtalk` or `twilio`. **Unset means `cloudtalk`.** Any other value, including blank or different capitalization, makes `dispatch-outbox` and `dispatch-outbound-deliveries` return HTTP 503 before claiming work.
  - The two layers must agree. A row queued for one provider is never sent through the other. The worker releases it as `sms_provider_mismatch`, and the final database check refuses it too. There is no fallback between providers.
- **CloudTalk adapter** (`supabase/functions/_shared/cloudtalk-sms.ts`).
  - Request: `POST https://my.cloudtalk.io/api/sms/send.json`, sending JSON `{recipient, message, sender}`.
  - Headers: HTTP Basic `CLOUDTALK_API_KEY_ID:CLOUDTALK_API_KEY_SECRET` and an explicit `User-Agent`. Redirects are refused, and the request times out after 30 seconds.
- **Sender restriction.** The sender is `CLOUDTALK_SMS_SENDER`. When that is unset, it is the single number in `CLOUDTALK_ALLOWED_NUMBERS`. Either way it must be an exact E.164 member of `CLOUDTALK_ALLOWED_NUMBERS`, or nothing is sent.
  - The sender is frozen on the row as `{from, provider: "cloudtalk"}` before the first request, and a retry cannot change it.
  - Recipients use the existing strict E.164 normalization, with no inferred country code.
  - Messages are limited to 1,600 characters (the outbox limit). CloudTalk documents no maximum length.
- **Consent and opt-out.**
  - `dispatch-outbox` keeps its existing final check (`communication_is_suppressed`) immediately before the provider request. It blocks on:
    - staff suppression
    - a CloudTalk `STOP` (the webhook writes `communication_suppressions` and withdraws `sms_consent`)
    - a pending Twilio `STOP`
    - missing or withdrawn consent
    - a changed household phone number
  - `dispatch-outbound-deliveries` previously checked consent only when a row was queued. It now calls the new `outbound_delivery_sms_permitted(delivery, lease_owner)` for the leased row before any SMS provider request. This applies the same rules to CloudTalk and Twilio, so the check is stricter than before.
- **Outcome mapping.** CloudTalk has no idempotency key, so an ambiguous result is never retried automatically.

  | CloudTalk response | `dispatch-outbox` (communication_outbox) | `dispatch-outbound-deliveries` |
  | --- | --- | --- |
  | 200 with `responseData.success` true | `accepted` | `ACCEPTED` |
  | 200 with `success: false` (`SMS send failed`, `Not allowed country.`, `Unknown number`, `Bad number configuration`) | `failed` with `cloudtalk_<reason>` | `FAILED` |
  | 200 with `success: false` and `Limit exceeded`, or HTTP 429 | `failed` (staff review) | `QUEUED` retry in 10 minutes while attempts remain, then `FAILED` |
  | 400, 401, 403 (insufficient funds or edge block), 404, 406 | `failed` with `cloudtalk_http_<code>` | `FAILED` |
  | 408, 409, 5xx, unreadable 200, timeout or connection loss | `uncertain` (reconcile in CloudTalk before any resend) | `UNKNOWN` (no automatic retry; the Twilio path still retries 5xx) |
- **Message identifier.** CloudTalk's documented success response contains no message ID. The outbox needs a unique acceptance reference, so an accepted row records:
  - `cloudtalk:<id>` if CloudTalk ever returns an `id`
  - otherwise `local-accepted:<outbox or delivery id>`

  This is a local reference, not a CloudTalk ID. Carrier submission appears separately as a `message.sent` webhook in `cloudtalk_messages`. Automatic correlation between the two is not built (see Open items).
- **Payment-link SMS.**
  - Preparation (`prepare-payment-delivery`) freezes the sender that `SMS_PROVIDER` selects.
  - `capture_payment_delivery` accepts only the sender shape of the current database setting.
  - The reviewed payload hash covers the exact CloudTalk JSON request body.
- **Retained Twilio.**
  - All Twilio code, secrets and webhooks are unchanged and are used only with `SMS_PROVIDER=twilio` plus a database setting of `twilio`.
  - The five existing pgTAP files that exercise the Twilio contract now pin the setting to `twilio` at their start.
- **Staff UI.** The outbox retry review accepts `cloudtalk` as a provider. Payment-delivery review accepts the CloudTalk sender shape.

## API facts and sources (verified 2026-09-27)

| Fact | Source |
| --- | --- |
| `POST /sms/send.json` on server `https://my.cloudtalk.io/api`. Required fields are `recipient`, `message` and `sender`, all E.164. Optional fields are `country_code` and MMS/WhatsApp fields, which are not used. | [Send SMS reference](https://developers.cloudtalk.io/api-reference/sms/send-sms), [OpenAPI spec](https://developers.cloudtalk.io/api-reference/openapi.json) |
| The success envelope is `{"responseData":{"success":bool,"data":{recipient,message,sender,country_code}}}`. HTTP 200 may carry `success: false` with the error text in `data`. | same |
| Documented errors are 400 Bad request, 401 Unauthorized, 403 Insufficient Funds and 500. | same, plus [error codes](https://developers.cloudtalk.io/guides/error-codes) |
| Authentication is HTTP Basic with the Access Key ID and Secret. | [Authentication](https://developers.cloudtalk.io/guides/authentication) |
| The rate limit is 60 requests per minute per company, shared by every key (including the call-media function). Throttled requests get HTTP 429 with `X-CloudTalkAPI-ResetTime`. | [Rate limiting](https://developers.cloudtalk.io/guides/rate-limiting) |
| The edge rejects requests without a `User-Agent` with an HTML 403. | [Quickstart](https://developers.cloudtalk.io/guides/quickstart) |
| `message.sent` means carrier submission, not handset delivery. | [Message events](https://developers.cloudtalk.io/guides/webhooks/events/messages) |

**Not verifiable from the docs.** Each item is handled conservatively in `classifyCloudTalkSmsResponse`:
- whether `success` is a JSON boolean (the schema) or the string `"true"` (the example shows `"true|false"`); both are accepted
- whether any success response ever includes a message `id`
- the exact spelling of every `success: false` string; unknown strings map to `cloudtalk_rejected`, which is permanent
- the maximum message length and CloudTalk's segmenting behavior
- whether CloudTalk itself blocks sends to numbers that texted STOP; the app blocks them regardless

## Owner steps

1. **Merge and apply** after CI passes for the same SHA:
   - Apply `20260928100000_cloudtalk_outbound_sms.sql` to staging (`kothoqicubowyhwfsrte`), then production (`mgadheotkdnrsatfivjy`).
   - Probe the result: `select provider from communication_sms_provider_setting` should return `cloudtalk`.
2. **Set Edge secrets** in each project under **Edge Functions → Secrets**:
   - `CLOUDTALK_API_KEY_ID` and `CLOUDTALK_API_KEY_SECRET` (already set for the webhook and call media).
   - `CLOUDTALK_ALLOWED_NUMBERS=+17207646677` (already set).
   - `SMS_PROVIDER=cloudtalk`. Optional, since unset means CloudTalk, but setting it makes the choice explicit.
   - `CLOUDTALK_SMS_SENDER=+17207646677`. Optional while only one number is allowed.
   - Leave the Twilio secrets in place or remove them; neither affects CloudTalk.
3. **Redeploy** from the merged SHA:
   - `dispatch-outbox`: `verify_jwt=false`, service-worker authentication.
   - `dispatch-outbound-deliveries`: `verify_jwt=false`, token protected.
   - `prepare-payment-delivery`: `verify_jwt=true`.

   No other function changed.
4. **Wait for A2P 10DLC approval** in CloudTalk, and confirm in CloudTalk that `+1 720-764-6677` is SMS-enabled. Do not send before approval: unregistered traffic is filtered by carriers.
5. **Run a controlled one-message test** to the owner's own phone:
   1. In staging, keep `OUTBOUND_DELIVERY_MODE=disabled`. Create a test household whose primary phone is the owner's mobile, and record SMS consent for that number.
   2. Set `OUTBOUND_TEST_PHONES=<owner mobile in E.164>`, then set `OUTBOUND_DELIVERY_MODE=test`. Test mode refuses every other recipient.
   3. From the conversation composer, queue one short SMS. Invoke `dispatch-outbox` once with the service worker credential. Do not enable the scheduler.
   4. Expect the row to be `accepted` with `provider=cloudtalk`, `provider_config={"from":"+17207646677","provider":"cloudtalk"}` and `provider_message_id=local-accepted:<id>`. Confirm that the phone received the text, that CloudTalk activity shows it, and that a `message.sent` webhook row appears in `cloudtalk_messages`.
   5. Reply `STOP` from the phone. Confirm that `communication_suppressions` gains the number and that a second queued SMS ends `failed` without a CloudTalk request.
   6. Set `OUTBOUND_DELIVERY_MODE=disabled` again. Record the result in a new `docs/launch-evidence` note before any production change.
6. **Go live later, as a separate decision.** Production live SMS still requires `APP_ENV=production`, `OUTBOUND_DELIVERY_MODE=live`, scheduler commissioning, and the existing payment and document-link gates.

To return to Twilio, update `communication_sms_provider_setting` to `twilio` and set `SMS_PROVIDER=twilio`. Both are required. Rows already queued for CloudTalk will fail as `sms_provider_mismatch` and must be re-reviewed.

## Open items

- **No automatic correlation** between `local-accepted:` rows and CloudTalk `message.sent` events. A reviewed design could match on sender, recipient, body hash and a time window.
- **No handset-delivery status.** CloudTalk documents no delivered or failed callback for API sends, so rows stay `accepted` and never become `delivered`.
- **Twilio-shaped local round-trip script.** `tests/payment-access/delivery-local-roundtrip.ts` is a manual script that exercises Twilio sender shapes. Against a database with this migration, it needs the setting pinned to `twilio`.

## Local evidence

- Unit tests (`tests/cloudtalk-sms/dispatch.test.ts`, 15 tests) stub `fetch`. They cover:
  - provider selection
  - sender restriction
  - response mapping
  - one exact request with no Twilio call
  - 4xx permanent, 5xx and timeouts uncertain
  - opt-out blocking
  - unknown `SMS_PROVIDER` failing before any claim
  - provider mismatch
  - missing credentials
  - the `outbound_deliveries` path: consent RPC, throttle retry, `UNKNOWN` on ambiguity, and explicit Twilio only when selected
- The payment payload test adds a CloudTalk frozen JSON case.
- pgTAP `supabase/tests/cloudtalk_outbound_sms.test.sql` (25 assertions) was run against the local database inside a rolled-back transaction. It covers:
  - the default setting and its privileges
  - provider assignment on enqueue
  - exact CloudTalk sender metadata
  - acceptance reference
  - provider-switch mismatch
  - CloudTalk `STOP` blocking a claimed row and cancelling a pending one
  - the leased-row consent check on `outbound_deliveries`
