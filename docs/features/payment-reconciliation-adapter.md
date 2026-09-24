# Administrator payment reconciliation proof adapter

`verify-payment-reconciliation` retrieves fresh evidence for an already attributed Stripe checkout session or refund. It never creates or expires a session, creates a refund, or clears a blocker. The separate administrator SQL completion action requires explicit review of the immutable captured proof hash and original case snapshot.

The function defaults off. Configure `STRIPE_RECONCILIATION_ENABLED=true`, canonical HTTPS `APP_URL`, and the existing pinned Stripe configuration. Fresh retrieval also requires `STRIPE_PAYMENTS_ENABLED=true`; captured case recovery works while provider retrieval is paused. Supabase JWT verification remains enabled, and every staff operation executes its SQL RPC with the caller's JWT. Only active administrators can preview, prepare, recover, discover, or complete cases.

## HTTP contract

POST JSON only, maximum 16 KiB, no query parameters. Responses use `Cache-Control: no-store, private`. A supplied browser Origin must equal `APP_URL`.

- `action: "preview"`: `p_invoice_id`, `p_family` (`checkout` or `refund`), `p_request_id`, `p_provider_object_id`. Returns invoice/family/request/object IDs, string `amount_cents`, `currency`, `account_id`, boolean `livemode`, exact `blocker_refs`, and `snapshot_hash`.
- `action: "prepare"`: the same fields plus stable `p_case_id`, original `p_blocker_refs`, and `p_expected_case_hash`. Executes exact actor-bound preparation before any retrieval. Returns `{case,capture,resolution}` with normalized proof only.
- `action: "recover"`: `p_case_id` only. Returns the same envelope, or null for an unknown case; never retrieves provider data.

A 202 response contains `{error,case_id,retry_requires_recovery:true}`. Preserve the original case ID and all original arguments. An uncertain preparation acknowledgment does not become an inferred success. Only an acknowledged exact SQL preparation can recover a subsequent lost capture acknowledgment. Changed arguments receive 409; unavailable authorization receives 404 after authentication; infrastructure failures remain unavailable/unconfirmed. Provider failures never become fabricated absence evidence.

Captured proof includes exact family/request/object/account/mode/amount/currency, server observation time, normalized status, and the appropriate payment/source identifiers. Raw provider objects, customer fields, URLs, and credentials are neither returned nor captured. The existing pinned provider adapter performs account/mode verification and GET retrieval; SQL capture independently validates the known object, fresh timestamp, blocker snapshot, and terminal-state compatibility.

## Invoice discovery

Migration 3800 adds authenticated `list_payment_reconciliation_workspace(p_invoice_id)`:

```ts
interface Workspace {
  invoice_id: string;
  targets: Array<{
    family: "checkout" | "refund";
    request_id: string;
    provider_object_id: string;
    amount_cents: string;
    currency: "usd";
    state: string;
    reviewable: boolean;
  }>;
  cases: Array<{ case: unknown; capture: unknown | null; resolution: unknown | null }>;
  has_more_cases: boolean;
}
```

Targets come only from already attributed durable provider evidence. Unsupported conflicts remain visible with `reviewable:false`. History returns the signed-in administrator's newest 100 cases for that invoice; direct case recovery remains available for a saved older ID. No free-text provider ID is needed. Service role and anonymous execution are denied. This discovery operation performs no writes.

## Verification

- Ten focused handler tests cover checkout/refund normalization, replay, lost acknowledgments, role rejection, changed context, provider mismatch/outage, and safe projections.
- Migration 3800 has 16 rollback-only local SQL assertions covering invoice scope, known objects, unsupported conflicts, administrator ownership, and role boundaries.
- `deno check --frozen tests/payment-reconciliation/local-server.ts` then `node --experimental-strip-types tests/payment-reconciliation/local-roundtrip.ts` runs 18 checks through real localhost HTTP, Auth, PostgREST, and SQL. `PAYMENT_TEST_PROJECT` optionally names an existing local Supabase configuration. The runner only reads Supabase status and cleans its own synthetic fixtures; it never starts, resets, or stops Supabase.

The HTTP test injects synthetic checkout retrieval and restricts Deno networking to localhost. It proves real proof capture, exact retry, actor completion, recovery without further retrieval, and unchanged cash for an open session. It does **not** prove live Stripe retrieval or acceptance; no Stripe credentials or provider requests are used.

## Combined delivery and reconciliation verification

The integrated branch includes reviewed delivery3700 and administrator discovery3800, proof adapter and staff reconciliation UI. Full lint/typecheck/build and304 unit tests pass. Browser verification covers21 client collection/status, staff grant and administrator reconciliation scenarios, plus the six existing Checkout/refund scenarios in a separate combined run. The actual18-check localhost Auth/PostgREST reconciliation roundtrip passes on the integrated schema, and CI now runs that same harness. Payment delivery's21 PostgreSQL concurrency checks are also wired into CI.

Resolved observations are excluded from current target reason text; they remain available in historical payment data. Proof retrieval remains default-off and no provider credentials, hosted schema or sending configuration were changed. Staff payment delivery preparation/composer integration and actual provider acceptance remain outstanding.
