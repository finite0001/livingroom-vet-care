# Unmounted staff record-review workflow

This prospective Living Room Vet slice adds an imperative lifecycle, raw HTTP
adapter and staff review sheet to the PR 294 foundations. It is not mounted,
configured with a real Auth source, granted an RPC, or connected to a live backend.
The earlier README describes the foundations before this slice.

`RecordReviewWorkflow` requires a lifecycle model and an accepted server-issued
detail selection. Staff explicitly prepare, inspect the returned packet, acknowledge
review, then later confirm. Cancel and recover are distinct actions. No effect,
page mount, subscription, retry, reload or recovery executes a signature. The
readable sheet uses the frozen performer name, catalog name, actual/recorded times,
each own event line’s exact signed quantity and its immutable cell→container stock
unit, recorded clinical dose/route separately, structured correction relationships,
and historical deadline selection. It neither totals quantities nor infers units,
physical observations or current labels. Complete retained evidence is secondary
and remains available without numeric rounding.

`createReviewLifecycle` stores only the original four-field actor-scoped recovery
pointer, before the first mutation. It freezes the request before awaits, guards
every asynchronous result with the actor/session generation, and releases Web
Locks before HTTP. A losing reservation recovers the winner. Unknown, not_found,
expired, blocked, stale and superseded keep the same UUID. Only verified owned
saved/cancelled closure permits cleanup; saved wins cancellation. A saved receipt
remains visible during failed cleanup. Cleanup is serialized locally and tolerates
another tab having already removed a pointer only after owned closure is proven.
New work requires explicit completion and cleanup. Session invalidation drops the
packet and draft display; the old actor’s unresolved durable pointer remains.

`createReviewRawRpc` accepts only a pinned standard project URL and public
`sb_publishable_` key, plus an injected current-session broker. It sends one
POST `{p_request: ...}` with the current user bearer token, without redirects,
credentials/caching or mutation retries. One original 30-second deadline covers
session acquisition, fetch and raw body decoding; a monotonic elapsed-time check
also catches delayed timer callbacks. The exact decoder runs before SDK JSON
parsing. Tokens and bodies never enter logs, storage, URLs or surfaced errors.
The existing Auth client may refresh its session; the broker must synchronously
advance/invalidate generation on actor/session changes and call `setIdentity`
before displaying a new actor’s data. A browser snapshot never grants server
authority or substitutes for backend identity checks.

`verifyPreparedReview` requires exact envelope/packet/target/adapter/authorization
keys, immutable request/digest/selection binding, distinct original actor, numeric
bigint and revision tokens, fixed meaning, 15-minute server interval and one-MiB
canonical packet cap. Decimal/exponent byte accounting follows PostgreSQL
`numeric.c` (`set_var_from_str`, `get_str_from_var`) without floating point or
exponent-sized allocation. It never rehashes/reconstructs the authoritative packet.
The complete source-specific `ReviewEvidenceAdmission.validate` is **mandatory**;
there is no default or production stub. Source-specific semantics, hashes,
canonical membership/order, immutable obligation and policy applicability must be
admitted before the result enables confirmation. Saved recovery needs only its
owned minimal receipt, not current signing permission or a clinical packet.

`prospective-packet-structure` and the 35 literal source shapes are supplementary
structural controls derived from the explicitly unadmitted backend draft
`wire-contract.json` (SHA in the source header). They check exact retained row/key
shapes, numeric types, source/reference order, own event/preparation bindings,
dedicated array membership, rule/historical/obligation DTOs and null-pair
consistency. They deliberately do **not** implement `ReviewEvidenceAdmission` and
must not be wired alone as a complete source validator or promoted to provenance
authority. Their fixture tests establish structural refusal only.

The test-only HTML fixture injects a plainly labeled synthetic in-memory
transport and fixture admission. It uses actual browser Web Locks/localStorage for
the four-field pointer. No real Auth, RPC grant, backend persistence, clinical
signature or staff acceptance is claimed by those tests.

Before mounting, finish the independent backend/reference-vector admission and
real two-user Auth acceptance, then integrate the accepted host shell’s leave/
navigation warning, dialog focus containment/return and permission-loss behavior.
The present sheet is an inline unmounted component, not a standalone navigation
guard or production dialog. Counts, physical witnesses, transfers, disposal and
register commissioning remain separate work.

Official references checked for this slice:

- [Supabase RPC](https://supabase.com/docs/reference/javascript/rpc)
- [Supabase current session](https://supabase.com/docs/reference/javascript/auth-getsession)
- [Supabase browser API keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [PostgreSQL 17 numeric source](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/utils/adt/numeric.c)

Focused checks:

```
node --experimental-strip-types --test tests/controlled-drugs/record-review-lifecycle.test.ts tests/controlled-drugs/record-review-prospective-structure.test.ts tests/controlled-drugs/record-review-raw-rpc.test.ts tests/controlled-drugs/record-review-summary.test.ts
node node_modules/@playwright/test/cli.js test --config tests/controlled-drugs/record-review-workflow.playwright.ts
```

Verification of this prospective slice: 26 new unit controls and six synthetic
browser cases pass. Full `npm run check` passed 1,740 tests (zero skipped), all
three TypeScript projects and the production build. The repository retains four
pre-existing Fast Refresh warnings and its existing bundle-size warning; the
new files have no focused lint warnings. Browser screenshots at 375/1280 pixels
were inspected. Final Auth, backend and host-shell acceptance remain separate.
