# Payment collection and status capabilities

Status: cryptographic materialization and versioned provider-return support, not the complete public/delivery workflow. Requires collection-grant migration3400. Public endpoints, email/SMS delivery, real provider acceptance and launch commissioning remain separate work.

`payment-access-capability.ts` validates the authoritative frozen database capability context and its SHA-256 before signing. The context binds the grant, original staff actor, invoice/client, exact amount/currency/source, collection/status deadlines, origin and key version. HMAC domain separation produces `p1` collection and `s1` status capabilities. Only their hashes are captured in the application database; returned tokens and URLs are transient.

Key configuration is server-only: `PAYMENT_ACCESS_ORIGIN`, `PAYMENT_ACCESS_ACTIVE_KEY_VERSION`, `PAYMENT_ACCESS_KEYS` (JSON map of version to canonical base64 32–64-byte keys). Origins must be exact HTTPS origins. The key map must be wholly valid and retain the historical key to reconstruct a prior grant. Changing the active key alone does not change an existing grant's exact token. Removing its historical key or changing origin fails closed. Public collection/status switches will remain separately default-off.

New grant-generated Checkout attempts use return context version2 and immutable scope/key/origin fields. SQL stores canonical return/cancel templates containing `{{payment_status}}`. The shared runtime reconstructs the exact status token immediately before Stripe creation, validating that all financial/identity fields match the captured grant. The provider adapter permits scoped status returns only for explicit version2 and requires matching status tokens on return/cancel URLs. Version1 attempts retain their original exact neutral URLs and retry parameters.

Stripe necessarily stores its materialized return URL as part of the provider session. Application persistence must never store that URL/token. Existing-session retrieval and expiry do not require recreating a missing historical return capability.

Validation: the capability and provider tests cover independent roles, changes to every bound identity/financial field, capture-hash mismatch, key rotation/removal, exact version2 retries, immutable version1 behavior and cross-scope return rejection. The combined branch passes238 unit tests, lint/typecheck/build, and the Checkout entry point passes frozen Deno type checking. Actual database/HTTP capability round trips remain to be demonstrated with the forthcoming public handlers.
