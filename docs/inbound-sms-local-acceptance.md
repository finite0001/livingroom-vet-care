# Signed SMS consent and inbox workflow — local evidence

`node --experimental-strip-types tests/inbound/sms-local-roundtrip.ts` passed28 checks through localhost HTTP, official Twilio signature validation, production `receiveTwilio`/`processOneInbound`, real Supabase Auth/PostgREST and the actual consent/inbox database functions. Provider GETs return injected synthetic data; no Twilio request, SMS or provider account mutation occurs.

The checks establish:

- Invalid signatures and a different webhook path create no durable receipt.
- A signed STOP suppresses outbound eligibility immediately after receipt storage, before content retrieval. Failed retrieval leaves retryable work and preserves suppression.
- Processing the matching signed/provider resource persists opt-out and the actual inbox message. An older START arriving afterward cannot reverse that opt-out.
- A newer verified START updates the unique synthetic household's consent and removes the provider opt-out exclusion. No unrelated suppression is created in this fixture; broader suppression precedence remains covered by existing SQL tests.
- Replaying all processed receipts creates no duplicate original/message and cannot reapply the old STOP over the later START. Staff reads the actual inbox with three unique unread messages.
- Only the run's random Auth/application records are removed, including discovered conversation/message and provider-event IDs so child histories are not orphaned. Cleanup checks no matching fixture rows remain.

Use the existing local Supabase configuration or `PAYMENT_TEST_PROJECT`; the status-only temporary-config fallback matches the email harness. The test refuses to run with unrelated pending/claimed inbound work, since the production processor claims the next job. Coordinate the short database window with other local tests. It never starts, stops or resets a project; credentials remain in memory. The synthetic callback secret/account and phone exist only in the fixture and are never configured with Twilio.

The localhost HTTP bridge invokes production handlers but does not prove Supabase gateway or deployed Twilio entrypoint behavior. The provider creation times are controlled fixture values, not actual carrier evidence. This does not establish phone provisioning, messaging registration, real opt-out responses, callback routing, delivery, worker scheduling, or hosted staff acceptance. No external send is authorized by a passing test. CI runs this alongside the signed email workflow.
