# Reviewed payment collection grants

Migration `20260913340000` adds capability-scoped collection authorization independently of Stripe Checkout session lifetime. It creates no provider configuration and sends no messages. Public/provider switches remain the responsibility of the Edge integration.

## Database contract

Authenticated staff RPCs:

- `prepare_payment_collection(p_request_id uuid,p_invoice_id uuid,p_client_id uuid,p_source_hash text,p_amount_cents bigint,p_expires_at timestamptz)` returns `{grant,capture,events,attempts,receipt:null}`. Exact retries recover original metadata before current-source eligibility. Only one preparing/captured draft per actor/invoice is allowed. Expiry must be in the next seven days; status expiry is thirty days later. Preparation never creates a checkout attempt or holds an invoice lock beyond its transaction.
- `recover_payment_collection(p_invoice_id uuid,p_request_id uuid default null)` and `list_payment_collections(p_invoice_id uuid,p_client_id uuid)` return actor-owned safe history, including revoked or source-changed grants. Grant amounts are strings. Capture metadata includes immutable origin, key version, canonical context and SHA-256 context hash, but these staff returns exclude token hashes.
- `attest_payment_collection(p_request_id uuid,p_reviewed_context_hash text,p_attest boolean)` requires exact capture review and current invoice source/amount. `revoke_payment_collection(p_request_id uuid,p_reason text)` prevents future collection and retains history. It does not expire an already disclosed Stripe session.

Service-only RPCs:

- `payment_collection_capture_context(p_request_id uuid,p_actor_id uuid,p_origin text,p_key_version text)` constructs the authoritative `capture.capability_context` string and `context_hash` before cryptographic capture. It validates the original active actor and configured origin. Frozen capture returns require the same origin/key version. Recover existing metadata before choosing a key after a lost response.
- `capture_payment_collection(p_request_id uuid,p_actor_id uuid,p_origin text,p_key_version text,p_collection_token_hash text,p_status_token_hash text)` freezes separate lowercase SHA-256 hashes. Usable HMAC tokens are constructed only in Edge memory. Distinct collection/status domain separation is an Edge requirement; token hashes must differ.
- `payment_collection_access_context(p_grant_id uuid)` supplies grant/capture metadata, including hashes, only to the trusted Edge service for cryptographic reconstruction and verification. Never forward this full result publicly.
- `inspect_payment_collection(p_grant_id uuid,p_collection_token_hash text,p_origin text,p_key_version text)` performs current review, revocation, deadline, actor and invoice checks and returns minimal scoped state. It performs no provider work. Call it again after network operations before releasing a Stripe URL.
- `activate_payment_collection(p_grant_id uuid,p_collection_token_hash text,p_origin text,p_key_version text,p_allow_create boolean default false)` locks grant and invoice. Existing unresolved attempts recover without replacement even when creation is paused. A new attempt requires explicit `true`, current exact invoice/source/amount and no conflicting financial work. Authoritative accepted expiry permits renewal; local timeouts do not. Returns `{state,status,attempt,grant_id}` for an actionable attempt, or `{state,status,attempt:null}` for settled/reconciliation outcomes. The attempt contains private provider parameters and must not be forwarded wholesale to a client.
- `read_payment_collection_status(p_grant_id uuid,p_status_token_hash text,p_origin text,p_key_version text)` requires a separately scoped capability and prior review. It remains readable after collection revocation/expiry until the status deadline. Output contains reviewed amount/currency/deadlines, confirmed payment/refund cents and coarse state; no invoice/client/actor identifiers or patient data. Partial refund differs from full refund.

## Versioned provider parameters

Existing attempts remain `return_context_version=1` with unchanged URLs and parameters. New grant-created attempts have version 2, `return_scope_id` equal to the grant UUID, and frozen `return_key_version`/`return_origin`. Success and cancellation templates are exactly:

```
https://thelivingroom.vet/payment/return/{grant_id}#{{payment_status}}
https://thelivingroom.vet/payment/cancel/{grant_id}#{{payment_status}}
```

The trusted Edge adapter replaces the placeholder in memory using the immutable status capability. The database never stores the usable token or materialized Stripe URL. New session expiry is the earlier of two hours and grant expiry, and creation requires at least 31 minutes remaining. Retry horizon remains 23 hours. Missing cryptographic keys must prevent new materialization while allowing separate provider reconciliation; SQL cannot establish key availability itself.

All new core tables are append-only, with direct access revoked from anon, authenticated and service roles. Staff access uses actor-bound RPCs. Invoice row locks serialize activation with accounting changes and provider evidence; no lock spans provider HTTP work. Delivery, attachment review, recipient consent and exact message attestation are deferred to the separate reviewed-delivery migration.

## Local verification

Commands against existing local foundation Docker PostgreSQL:

```
docker exec -i supabase_db_livingroom-vet-foundation psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < supabase/tests/payment_collection_access.test.sql
python3 supabase/tests/payment_collection_concurrency.py
```

The rollback SQL suite covers authorization, review, recovery, capability separation, versioned parameters, renewal, scoped cash/status, revocation, partial refund, deadline limits and active-originator checks. The concurrency runner uses eight actual simultaneous activation/renewal calls and observes PostgreSQL lock waiters in both credit/activation orderings and payment/activation races. It cleans only its random synthetic fixtures and owned sessions, preserving existing containers and database state. No provider calls, hosted changes, email or SMS occur. Provider acceptance and end-to-end client/delivery verification remain separate requirements.

CI runs the same concurrency suite with `--project-config supabase/config.toml`, deriving its isolated database container from the checked-out project ID. Local invocation without that option retains the existing foundation container and never starts or resets it.
