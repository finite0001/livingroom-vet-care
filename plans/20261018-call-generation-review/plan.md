# Guarded call generation and private clinical review

Status: implemented and locally verified, new PR pending review; PR 273 merged at `2df9a1c84f1fd9c8df4e374ffcfe6f5e7e306f73`. See [verification evidence](../../docs/launch-evidence/2026-10-18-clinical-call-generation.md). This increment implements Phase 3B.2, not clinical activation or paid fidelity evaluation.

## Outcome

An active ADMIN explicitly selects a retained complete household call for its saved patient and unsigned encounter, chooses a pinned approved template, and requests one OpenAI attempt. The private result retains every claim's exact segment evidence, original speaker label, patient attribution and uncertainty. The clinician edits and selects SOAP sections, inspects a before/after comparison, and explicitly accepts or rejects. Only selected edited SOAP wording enters the ordinary chart. Signing remains separate.

## Design

1. Add one migration without modifying the 16 legacy guards or their API contracts. Reuse immutable call bindings and existing note attempts/generations/proposals/reviews. Add a private append-only policy/review action journal with permanent cancellation tombstones and immutable receipts.
2. Add dedicated versioned call reservation, read, workspace, claim, cancellation, service dispatch/finish/failure, policy and review RPCs. No browser transcript, source hash, model output or provenance is trusted. Resolve all evidence from retained server rows. A source-specific workspace filters association before pagination and returns metadata only.
3. Historical access checks the current reader's live ADMIN session, source association and canonical binding. It does not require a historical operator session or old policy approval. Active generation requires the recorded operator session; acceptance of a completed draft requires the current reviewer's live ADMIN session rather than the historical generator's session. This avoids permanently stranding retained drafts after sign-out. New generation and acceptance separately validate the exact current general note, capture and call generation policies, template, destination version, patient lifecycle and frozen call assignment/version/time context.
4. Lock order: actor → job/advisory → attempt → general note policy → capture policy → call generation policy → template → encounter → patient → inbound → provider → conversation → message. Policy mutation stops at its action and policy lock. Historical paths must not acquire source locks and then enter the live guard. Repeat actor/session checks after waits. Acceptance uses the live guard before historical/source reads.
5. Validate the segment-backed result independently in PostgreSQL, including UTF-16 excerpt boundaries, exact keys/order/statuses, hashes, selected-patient scope and all claim/support/byte limits. Store the full private payload and manifest. Assemble only selected-patient proposed text; never append raw quotes, source identifiers or other-pet claims to accepted chart text.
6. Add a dedicated worker using the existing pure provider contract and OpenAI server secret. Require both note and call-generation gates. Build/budget requests before dispatch, send at most once per attempt, bound streamed response bytes, sanitize diagnostics and retry only the identical database finish after a lost acknowledgement. No automatic provider retry.
7. Add private, lazy ADMIN UI to the existing call panel. Use strict shared schemas, ephemeral clinical state, synchronous operation locks, stale-response guards and IDs-only persisted pending identities. Unresolved operations protect navigation. Recover success before requiring current write eligibility, then fetch the latest encounter before adoption so an old receipt cannot replace a newer edit.

## File ownership and execution

Root owns the additive migration and integration. The worker implementation owns new call-processing shared schemas/handler/entrypoint, frozen locks and its tests. The UI implementation owns call-drafts UI/API and the narrow encounter-adoption callback. The database verification implementation owns synthetic SQL/harness, restore and migration-count inventory. All use the isolated `feat/clinical-call-generation-20261018` worktree and preserve concurrent edits.

## Verification and release boundary

- SQL: strict payload parity, authorization/source/policy/template/destination guards, idempotent reserve/attempt/review, cancellation, lost acknowledgements, exact-once selected chart write and private-versus-ordinary read separation.
- Real owned local Auth/PostgREST and actual handler with a synthetic provider; ordinary tests make zero real or paid requests. Observe lock barriers for revocation/source and encounter races. Restore populated private histories and effective grants.
- Actual Patient 360 at desktop and 390px: private source selection, generation, evidence, selected edits, acceptance/rejection/recovery, navigation guard and STAFF/role-loss boundary. A mobile Chromium check is not iPhone/Safari acceptance.
- Run repository checks, strict TypeScript, all frozen Edge checks and database suites. Record actual limitations rather than treating static helpers as end-to-end proof.
- Open the completed next PR. No merge of that PR is authorized by the PR 273 approval. No real call generation, policy approval, provider spend, signing, delivery or primary migration is part of this increment. Susan's approval and separate commissioning remain outstanding.
