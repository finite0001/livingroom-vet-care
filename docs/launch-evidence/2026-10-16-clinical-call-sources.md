# Clinical call sources — Phase 3A engineering evidence

Date: 2026-10-16. Update 2026-10-17: local engineering and staging verification passed; PR 271 passed exact-head CI, received specific owner approval, merged and completed its [primary rollout](2026-10-17-clinical-call-sources-primary-rollout.md). Real call processing remains off and uncommissioned. The [sanitized evidence manifest](2026-10-16-clinical-call-sources.json) preserves each original run's receipt hash and exact input inventory. Source base: `c9edcaa3de19a150d8e77bca14475e924cf6e547`; these proofs bind the subsequent package by file hash, before its documentation commit.

## Delivered boundary

An active administrator with a live Auth session can explicitly select a completed, trusted, transcript-ready household call, one saved patient and one unsigned encounter. The server captures and retains a complete observed transcript, original speaker labels and relative seconds, canonical call event times, exact household association, per-segment evidence and both pagination passes. The patient workspace previews all retained segments, supports lost-response recovery and protects unsaved work at desktop and 390px widths. Private action storage in the browser contains IDs and other nonclinical recovery metadata, never transcript text.

This is **capture and evidence review only**. It does not generate a call summary, create SOAP proposals, write or sign a chart, infer the patient or speaker's clinical role, send messages, create tasks or transcribe audio. The [3B implementation plan](../../plans/20261016-vetrec-authenticated/phase-03b-call-summary-implementation.md) defines the separate OpenAI generation and explicit clinical review increment. The [dental plan](../../plans/20261016-vetrec-authenticated/phase-04-dental-dictation-implementation.md) also remains planned work.

The independent source policy starts **draft** and `CLINICAL_CALL_CAPTURE_ENABLED` defaults **off**. Synthetic local approval is not Susan's approval. Real provider commissioning, approved call processing/retention and explicit activation remain outstanding.

## Final verification

| Proof | Actual result | Boundary |
| --- | --- | --- |
| Final v4 call-source SQL | 1 file / 61 assertions passed | Current final SQL, including banned-user and null-lease refusal |
| Final v4 real Auth/PostgREST/handler HTTP | 75 assertions passed; 2 actual observed lock waits | Finish after ADMIN revocation and retained-source read after session revocation are refused after blocking waits |
| Final v4 actual patient workspace | 41 browser assertions, 3 STAFF boundary assertions, 3 dropped committed responses | Real local Auth/RPC/HTTP; desktop 1280px and Chromium mobile width 390px; not real iPhone/Safari hardware acceptance |
| Final v4 populated call restore | 5 assertions passed | Exact four private tables, hashes, immutable triggers, routine owners/effective ACLs and authenticated retained-source read |
| Current canonical compatibility with unpublished controlled engine | 164 SQL files / 7,172 assertions passed | All 201 canonical migrations, including final 61 call-source checks |
| Same compatibility runtime | 124 real Auth API checks, 5 observed queues; 453 relation fingerprints restored | All ten canonical writer definitions unchanged; candidate remains local/unpublished |
| Scoped checks | 14 Node tests including 6 UI model checks; ESLint, app TypeScript, frozen Deno/functions isolation and 12 offline restore inventory tests passed | Parent's full `npm run check` passed 1,599 tests before the final SQL/harness hardening; exact-head CI still required |

Final call receipt: `tmp/clinical-calls-final-v4-local-proof.json`, SHA256 `3c7c6961c8b40367ed41cc81b9a4e9881d9fa9703142f590975878ebdb4c799b`. All **224** bound inputs matched again after completion. Final compatibility receipt is preserved privately at `tmp/clinical-calls-candidate201-result.json`, SHA256 `618bbad82d66ab628fa9465756ab9cde45024f3acc8f9c50518767261232707a`; all **223** bound inputs matched after completion. Both owned runtimes, containers and volumes were removed.

The final call proof made **12 stub provider requests and zero real provider requests**. The compatibility runtime made zero provider requests. Neither local proof retrieved hosted keys or changed a hosted database/function. The final call source manifest SHA256 is `0af8afc5c06e600734895655be5ef2a35407f561662edd21d1ff6af4ffb12331` for its fictional source. This is distinct from the receipt hash and the document replay hash.

The source manifest covers SQL-canonical `{context,document}`. Context is taken only from the server's admitted call/household binding, including original nullable call start, call end and last event time, separately from capture times. Exact page `normalized_json` bytes retain independently verifiable SHA256 evidence; SQL reparses every page and compares its entire projection against the retained segment slice. Unicode text, fractional/exponent timestamps and UTF16 offsets are exercised through the real local HTTP-to-SQL path.

## Prior attempts remain preserved

The intermediate v3 full call run passed **164 files / 7,165 assertions**, 73 API assertions, 41 browser assertions, 3 STAFF assertions, 5 restore assertions and one observed lock wait. Its original receipt and input hashes are retained independently; it predates the final banned-user/null-lease checks and additional source-read race and is not represented as final evidence. The final canonical compatibility run above covers all 7,172 current assertions.

Earlier failures remain private under `tmp/clinical-calls-preserved-failures/`, with original log hashes in the sanitized manifest:

- An initial source-history SQL alias was ambiguous. The implementation now uses an explicit retained-source alias.
- A diagnostic concurrency attempt did not observe the actual finish wait and correctly failed; the final proof observes both required waits.
- The first full final attempt had an incomplete fictional signed encounter. The existing clinical completeness constraint correctly refused blank assessment/plan. Only the fixture was corrected.
- The next attempt compared raw ACL catalog representation: explicit owner-only versus restored NULL default owner-only. The proof now compares sorted **effective** grants, including grantor, grantee, privilege and grantability. No permission was widened.

An earlier diagnostic run also refused final attestation because inputs changed during execution. Its partial browser/roundtrip artifacts remain private; only frozen runs are acceptance evidence.

## Provider and security limits

The [official CloudTalk contract research](../../plans/20261016-vetrec-authenticated/research/cloudtalk-transcript-contract.md) supports the REST projection and offset/limit enumeration. Capture requires two complete matching observed enumerations with bounded pages, bytes and time. The evidence is labeled `observed_two_pass`: no atomic provider revision, ETag, permanent remote immutability or future transcript consistency is invented. Strict adapter fields and conservative limits may reject a provider response; real account entitlement and authorized samples still need commissioning.

Every policy/capture/source path requires current ADMIN authority and a live unbanned session. Worker finish rechecks the initiating actor/session, source assignment, unsigned destination, policy and valid lease after waits. Retained reads and history also require current household/conversation/message association, current trusted canonical call and exact provider call identity. Source history is metadata-only and explicitly indicates a bounded latest-100 window. Full source content is loaded separately. Capturing lease expiry/null lease becomes a sanitized terminal uncertain receipt without automatic refetch.

## Rollout status

Staging backend verification passed on `kothoqicubowyhwfsrte`: **201 migrations**, latest `20261017042642`. All original 391 public tables, 1,301 routine definitions/permissions, table metadata, existing audio policy and scheduler prefixes were preserved. The four new private tables and 21 new function source bodies/access rules were verified. No scheduler append was introduced.

Staging `clinical-call-capture` is **ACTIVE v1**, with JWT verification enabled. Downloaded entrypoint, handler and model bytes match the final proof hashes. All other Edge Functions and secret metadata remain unchanged. The capture flag is **absent/default off** and call policy **v1 draft**. Anonymous HTTP returned **401**; an authenticated closed-gate 503 request was **not tested or claimed**. No real provider request or hosted clinical chart write occurred. Exact sanitized database and Edge receipts, including original receipt hashes, are in the JSON manifest.

Primary was at **199 migrations** when these staging checks completed. The subsequent [PR 271 primary rollout](2026-10-17-clinical-call-sources-primary-rollout.md) is now verified at **201 migrations**, following PR 270 and exact-head CI/specific merge approval. Git merge, database migration, Edge deployment, frontend release and processing activation remain separate events. Susan's clinical/policy review and authorized provider commissioning remain outstanding; these engineering receipts do not approve clinical use.

## PR271 CI fixture collision correction — 2026-10-17

The initial database CI passed all164 SQL suites/7,172 assertions, then stopped because the older inbound-race test randomly selected an already occupied synthetic phone. The log did not record that exact number; preceding Whogot/photo tests are known to retain households in the same fixture range. The selector now checks at most32 candidates read-only, while preserving the final occupied-phone refusal. It neither deletes earlier fixtures nor weakens the race assertion.

Eight offline harness regressions pass. An owned201-migration reproduction ran the actual Whogot/photo predecessors, forced occupied `+13035559201`, selected unused `+13035559202`, and completed the original race with one retained unmatched review item and zero duplicate messages. Every preceding client row was preserved; only the proof's own new client was removed. All205 proof inputs matched, and the owned runtime/containers/volumes were removed. Original CI and temporary-wrapper failure logs remain private. Zero hosted writes/provider requests; application, migration, capture and compatibility proof bytes remain unchanged. Exact-head CI must pass after this correction before merge.
