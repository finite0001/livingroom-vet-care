# PostgREST-retryable SQLSTATEs (40001 / 40P01) — never raise them for permanent conditions

## Incident (2026-09-28)

Production (`mgadheotkdnrsatfivjy`) went down: ~4.16M Postgres errors in 24h, CPU at 100%, and
`pg_stat_statements` showed ~100M calls from `service_role` to
`public.record_outbound_delivery_callback`, all failing with
`Outbound delivery is not callback-eligible`. Edge Function logs showed only 54 invocations, and
neither caller (`resend-delivery-webhook`, `twilio-message-status-callback`) loops.

The trigger was Resend webhooks being **account-wide**: the Resend account also sends for other
businesses (greentree.vet, ondara.pet, campsequoialake.com, ...), so their delivery receipts reached
`resend-delivery-webhook`. The outbox did not know them (23503), the legacy fallback called
`record_outbound_delivery_callback`, and that function raised `errcode = '40001'`
(`serialization_failure`) for a condition that can never succeed on retry.

## Mechanism

PostgREST executes every request inside `Hasql.Transaction.Sessions.transaction`, and
hasql-transaction's `inRetryingTransaction` re-runs the **whole transaction, with no retry limit
and no backoff**, whenever the server reports SQLSTATE `40001` (and, from hasql-transaction 1.1,
`40P01` `deadlock_detected`):

```haskell
-- hasql-transaction 1.1.0.1, library/Hasql/Transaction/Private/Sessions.hs
inRetryingTransaction level mode session preparable =
  fix $ \retry -> do
    attemptRes <- tryTransaction level mode session preparable
    case attemptRes of
      Just a -> return a
      Nothing -> retry
...
handleTransactionError error onTransactionError = case error of
  QueryError _ _ (ResultError (ServerError code _ _ _ _)) -> case code of
    "40001" -> onTransactionError
    "40P01" -> onTransactionError
    _ -> throwError error
```

- hasql-transaction source (tags `1.0.1.4`, `1.1.0.1`):
  <https://github.com/nikita-volkov/hasql-transaction/blob/1.1.0.1/library/Hasql/Transaction/Private/Sessions.hs>
  (`1.0.1.4` retries on `40001` only; `1.1+` on `40001` and `40P01`).
- PostgREST v12.2.3 `src/PostgREST/Query.hs` and v14.18 `src/PostgREST/MainTx.hs` call
  `SQL.transaction` / `SQL.unpreparedTransaction` from `Hasql.Transaction.Sessions`
  (cabal: `hasql-transaction >= 1.0.1 && < 1.2`).
- Upstream report: PostgREST issue #3673, "Surprising infinite retrying of SQL statement on a
  replica causes replication lag" <https://github.com/PostgREST/postgrest/issues/3673>.
  Fixed only in **PostgREST v16.0** (2026-08-07, CHANGELOG: "Fix automatic transaction retries on
  `40001 (serialization_failure)` errors ... #3673"); v16 calls `SQL.transactionNoRetry`.
  The local CLI stack already runs v16.3, so local tests cannot reproduce the loop; hosted
  projects on PostgREST < 16 can.

So a deterministic `raise ... using errcode = '40001'` inside any RPC turns one HTTP request into
an infinite loop *inside the database connection*: the Edge Function makes one call that never
returns, while Postgres executes the function millions of times.

## Rule

- **Never** raise `40001` or `40P01` (by code or by condition name) from application SQL.
  Those codes are reserved for genuine, engine-reported transient conflicts.
- "State changed; reload/review before saving", "stale version/hash", "not eligible",
  "lease unavailable" and similar conditions use **`PT409`**.
  - `PTxyz` is PostgREST's custom-status convention: the HTTP status is `xyz` (409 Conflict) and
    the JSON body keeps `code: "PT409"`, `message`, `details`, `hint`. Verified locally:
    `HTTP/1.1 409` with `{"code":"PT409","details":null,"hint":null,"message":"..."}`.
  - It is not retried by PostgREST, hasql-transaction, supabase-js or the Edge Functions.
- Other SQLSTATEs keep their existing meaning (`23514` invalid, `42501` not permitted, `23503`
  uncorrelated, `23505` identifier reuse, ...).
- A provider callback for something that is not ours is **not an error at all**: return a
  no-op result and acknowledge it (`record_outbound_delivery_callback` returns a NULL row).

## Error-code mapping (migration `20260928190000_no_retryable_sqlstate_for_permanent_conditions.sql`)

| Before | After | Where |
| --- | --- | --- |
| `raise ... using errcode = '40001'` | `using errcode = 'PT409'` | 147 public functions (every current definition that raised it) |
| `exception when sqlstate '40001'` | `when sqlstate 'PT409'` | `release_read_internal`, `queue_due_reminders`, `get_ezyvet_prescription_review_candidate` (they catch the inner functions' raises) |
| `record_outbound_delivery_callback`: `'Outbound delivery is not callback-eligible'` / `40001` | `return null` (acknowledged no-op) | unknown provider id or conflicting terminal status |
| Frontend / Edge detectors `code === "40001"` | `code === "PT409"` | `src/hub/**`, `supabase/functions/_shared/*`, `ezyvet-import/handler.ts` — same UX (conflict banner, "reload", 409) |

151 functions are redefined in total (147 raisers + 3 catchers + `record_outbound_delivery_callback`).
The migration was generated from `pg_get_functiondef` of each function after all earlier
migrations, replacing only the SQLSTATE literal, and ends with a deploy-time guard that aborts if
any public function still contains `40001`/`40P01`.

## Guards

- `supabase/tests/no_retryable_sqlstates.test.sql` (pgTAP, `supabase test db` in CI) fails if any
  function in `public` has `40001` or `40P01` in `pg_proc.prosrc`, or raises
  `serialization_failure`/`deadlock_detected` by name, and asserts an unknown provider receipt is
  a no-op.
- `tests/inbound/resend-delivery.test.ts`: a foreign-domain receipt is acknowledged with zero RPC
  calls; an own-domain unknown receipt is acknowledged without retry.

## Resend webhook scope

`resend-delivery-webhook` verifies the Svix signature, then acknowledges (204) every receipt whose
`data.from` domain is not the `RESEND_FROM` domain (or the `RESEND_AUTH_FROM_ADDRESS` domain when
set) **before any database call**; nothing about such emails (subject, recipient, id) is stored
or logged. If `RESEND_FROM` is missing or unparseable the endpoint returns 503 without touching
the database.

Own-domain receipts that neither the outbox nor the legacy table knows are acknowledged, not
retried. Trade-off: a receipt that arrives before the send worker records the provider message id
is no longer retried by Resend; the outbox's own attempt result remains authoritative.
