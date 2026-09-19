# Reviewed pre-provider retry acceptance

This increment uses the existing dispatcher and migration 4500's reviewed retry RPCs. No new provider handler or transport was added.

The dispatcher safety review confirmed:

- Disabled dispatch performs no claim. Configuration/allowlist/materialization failures release only an unstarted claim; a failed release propagates instead of reporting a successful state change.
- `start_communication_attempt` is outside the provider transport try/catch. Losing its acknowledgment does not call the provider or release a now-audited attempt as an unstarted configuration failure.
- The existing source-specific SQL wrappers still precede provider transport. Payload reconstruction uses original outbox fields and independently verified frozen payloads; sender changes fail before transport.
- Attempted, uncertain and accepted work cannot be treated as proven provider non-acceptance. Migration 4500's reviewed path rejects these cases and revokes the old unversioned staff retry function.

## Actual local acceptance runner

```sh
node --experimental-strip-types tests/outbox-retry/local-roundtrip.ts
```

Set `PAYMENT_TEST_PROJECT=/absolute/local/project` for a local project's existing Supabase config (CI uses its workspace). With no override, the runner discovers the already-running foundation stack using an owned temporary status-only config when necessary. It never starts, stops or resets a stack. Migrations through 4500 are required.

The runner uses real local Auth and PostgREST calls, the production `dispatchOne` function, and synthetic household/message fixtures. It refuses unrelated pending/claimed outbox rows before dispatching. It deliberately discards the actual committed retry response, induces another real pre-provider configuration failure, and proves that recovery/replay returns the original receipt without retrying the newer failure. It verifies the exact safe browser envelopes, receipt history, stale/changed intent rejection, current recipient guard, legacy RPC revocation, and unchanged original message/attachment IDs/sender metadata. It also discards a committed actual start-attempt response to prove zero provider transport calls, then uses explicitly synthetic SQL outcome evidence to verify attempted/uncertain denials.

This test uses an ordinary email with no attachments to isolate the acknowledgment boundary. Companion SQL fixtures cover source-specific invalidation and frozen clinical/document/payment payload guards; this test does not claim provider acceptance, clinical review or attachment-delivery acceptance. All provider evidence is synthetic and the injected transport must remain unused. Owned fixture rows, committed children and Auth identities are cleaned and checked. Keys remain in memory; fixture errors disclose only generic HTTP status/SQLSTATE.

Validation: 30 actual Auth/PostgREST checks passed with both the default status-only config fallback and an explicit `PAYMENT_TEST_PROJECT` config. Nineteen existing outbox dispatcher/endpoint tests passed unchanged. ESLint and diff checks passed. No production runtime changes were necessary.
