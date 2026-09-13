# Public payment access endpoints

`payment-collection` accepts bounded POST JSON `{grant_id,token,action:"inspect"|"activate"}` using the collection `p1` capability. `payment-status` accepts `{grant_id,token}` using the separate `s1` capability. Both reject extra body keys, query parameters and other origins, omit staff authentication, and return no-store/no-referrer responses. Gateway JWT verification is disabled only because authorization is performed through the role-scoped capability.

Both endpoints reconstruct the immutable HMAC context, compare the presented token to the derived token, and validate both durable token hashes before SQL access. Missing/removed keys or changed contexts fail closed. Status and inspect never call Stripe. Responses project only reviewed amount/currency/deadlines, confirmed paid/refunded cents and coarse state. Collection responses add `collection_available`; only a successful activation may add `checkout_url` with `state:"checkout_ready"`.

Activation explicitly passes `STRIPE_COLLECTIONS_ENABLED` to the database creation gate. Existing sessions may be recovered while creation is paused. Version 2 return templates are materialized only in memory; provider responses are normalized and durably recorded before a mandatory post-network grant check. Revocation, source changes and database failures suppress the URL. Invalid provider evidence receives a durable reconciliation observation. Unknown provider or database acknowledgements return 202 confirmation pending, preserve the original attempt and do not expose internal IDs or URLs. An accepted expired session may be renewed once during the same explicit activation; transport uncertainty never creates a replacement.

A valid collection token whose collection access was revoked, expired or invalidated may retrieve its independently scoped, reviewed status when status access remains enabled. This fallback never makes collection available. Database transport failures are 503, not business denials. The status endpoint performs no provider calls.

## Configuration

All switches require the exact string `true` and default off:

- `PAYMENT_COLLECTION_ENABLED`
- `PAYMENT_STATUS_ENABLED`
- `STRIPE_PAYMENTS_ENABLED`
- `STRIPE_COLLECTIONS_ENABLED`

Capability configuration uses `PAYMENT_ACCESS_ORIGIN`, `PAYMENT_ACCESS_ACTIVE_KEY_VERSION` and `PAYMENT_ACCESS_KEYS` (server-only base64 key map). The existing Stripe account/mode/key/return-origin configuration remains required for provider operations. No secrets or switches are commissioned by these files.

## Verification

Eleven focused Node tests exercise real HMAC operations with dependency-controlled database/provider boundaries: role separation, wrong context/hash, inspection/status isolation, strict requests, immutable return materialization, acknowledgement loss, durable quarantine, post-network revocation, database outages, paused recovery, accepted-expiry renewal and safe projections. Frozen Deno checks and focused ESLint pass. These are not real Stripe acceptance tests; actual local HTTP/database roundtrips and provider commissioning remain separate validation steps.
