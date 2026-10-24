# Staff queue read adapters — 2026-10-24

The unmounted read transport and queue controller prepare the staff queue for genuine backend reads without granting a summary authority to sign. Production mounting still needs the accepted backend/source/Auth integration and the separate detail/evidence/selection adapter.

## Read transport

`read-rpc.ts` permits only `get_controlled_record_review_event_v3` and `list_controlled_record_reviews_v3`. It uses the configured HTTPS Supabase project and public publishable key, current staff bearer and a single original 30-second deadline. Request schemas, exact bigint cursor strings and the lossless response decoder run before any detail/page admission. It has no cache, redirect, logging, implicit retry or lifecycle mutation method.

Current actor/session/generation checks run after every asynchronous boundary, including the outer promise race. Malformed input accessors and arbitrary broker/server errors produce fixed safe messages. Its raw return value still needs exact detail/page and source-evidence admission.

## Queue controller

`queue-reader.ts` performs no read on construction, subscription or identity installation. Explicit first-page refresh requires a null cursor; explicit Next uses only the verified page's continuation. Duplicate clicks during loading do not launch another request. Prior rows are removed before reauthorization.

The controller rechecks its captured epoch and live Auth broker before committing a page. Identity changes/clear discard earlier requests; late responses and errors cannot overwrite a newer generation. Snapshot access masks a noncurrent identity using one stable signed-out snapshot, without rendering-side publication. Navigation evicts a stale identity even on a final page with no continuation. Parsing is followed by another epoch check before publishing loading state, so a reentrant input cannot overwrite a newer identity.

The owning Auth integration must advance generation and synchronously notify/setIdentity on every invalidation. It must not revive an invalidated generation. A controller cannot revoke data already returned to another consumer or detect an external change without a notification or entrypoint. Queue state is frozen, observer failures are isolated, and no recovery pointer, preparation selection or signature is created. Opening a row must separately fetch and admit detail before forming server-issued selection.

Validation: all 1,832 local tests, three TypeScript configurations and build pass; four existing lint warnings remain. The transport has 11 author and 26 independent inert controls. The controller has 13 author and 20 independent inert controls. Source review reports: `54d09c5711b517c926db3f15eafac3ecb48a6dd391f77cd048f0e73ceedaa600` and `55839e2db59ca7b1a97fa879498350d04cf3f252365a2b4932f77972e3976df7`.

## Additional local verification

The sanitized JSON companion preserves two completed controls. A genuine local preparation waited a source-measured 900.0046 monotonic seconds with its original 15-minute TTL. Execute and recovery returned the exact expired operation/digest/times and created no decision; a separate valid operation then saved. The 996.6213-second outer run completed with 34 HTTP requests, preserved all old rows, exact declared additions and Auth/audit effects, stock 19 and normal service cleanup. Independent artifact inspection confirmed consistency; outer exit 0 was observed by root, and timing was not independently reconstructed. Broader Auth/protocol/native/global/restore/browser acceptance and clinical activation remain false.

A separate cached PostgreSQL 17.6 container matched all 20 unchanged formatter cases: 120 component hashes and 20 exact context strings. It exposed no ports, used network none and a private Unix socket, rolled back its temporary SQL objects and shut down/removed normally. Original Homebrew-17.11 vector metadata remains unchanged. This establishes formatter compatibility for those synthetic component fixtures.

Raw credentials, tokens, Auth responses and packet bodies remain in protected local evidence. Reproducing these controls uses the separately retained source-bound runners; this companion contains aggregate outcomes and artifact hashes. Hosted writes were zero.
