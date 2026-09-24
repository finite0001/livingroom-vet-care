# Signed inbound email: actual local workflow

The production signature helper originally assumed Svix2.5.0 `Webhook.verify` returned a parsed event. The installed library source declares an undefined return and performs verification only. A real signed HTTP request therefore raised a TypeError before database receipt persistence. Earlier signature tests asserted the event ID and rejection paths but did not assert the parsed event; handler tests supplied a parsed-event double.

The helper now verifies the original body first, then parses that same body as a JSON object. Signature failures remain401; signed malformed/non-object JSON returns400. It does not trust a verifier's return value. Regression tests use the installed official library and assert the actual parsed event as well as modified-body, expired-signature and JSON rejection.

## Evidence

`node --experimental-strip-types tests/inbound/local-roundtrip.ts` passed25 checks using the production `receiveResend` and `processOneInbound` functions, a localhost HTTP bridge, official Svix signatures and actual Supabase Auth/PostgREST/database operations:

- Forged signatures create no receipt. Valid signed events persist; exact replay deduplicates and changed metadata cannot reuse the same event ID.
- Failed provider retrieval preserves retryable work without a partial inbox message. A later successful read links a unique known sender to its household and stores exactly one message.
- Staff authentication reads the actual inbox and advances the explicit read cursor. Replaying a processed webhook neither retrieves content again nor duplicates its message.
- An unknown sender remains in review with no guessed household. Explicit staff assignment records its reason and creates the message in the selected household conversation.
- Attachment metadata is retained without fetching provider attachment URLs. Fixture Auth and application records are cleaned.

The18 focused inbound unit tests, focused lint and frozen Deno check of `resend-webhook` passed. CI now runs the actual workflow after the other local harnesses.

## Boundaries and execution

Run with the existing local Supabase environment, or set `PAYMENT_TEST_PROJECT` to its configuration directory. The runner uses the existing status-only temporary-config fallback; it never starts, stops or resets an existing project. It refuses to run when unrelated pending/claimed inbound work exists because the production processor claims the next available job. Coordinate this brief database window with other tests. Credentials remain in memory and synthetic fixtures use random identities.

The HTTP bridge invokes the production handler but is not the Deno deployment entrypoint or Supabase gateway. Provider GET responses are injected synthetic data; no Resend request or external message occurs. This establishes local integration and fixes a verified runtime defect. It does not prove Resend domain receiving, actual webhook registration, worker scheduling, provider account compatibility, attachment-byte ingestion, hosted delivery or end-to-end client acceptance. The deployed hosted handler still requires the corrected source in the coordinated release.
