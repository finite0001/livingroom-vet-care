# Phase 3: patient-linked call sources and reviewed drafts

Status: **3A implemented and frozen local engineering proof passed; staging backend verified with policy draft and gate off. 3B remains planned.** See [exact implementation evidence](../../docs/launch-evidence/2026-10-16-clinical-call-sources.md) and the [separate 3B implementation plan](phase-03b-call-summary-implementation.md). No real provider request, clinical chart write, role expansion or practice policy activation was performed. This file is not a substitute for release evidence.

Read with [parent plan](plan.md), [Phases 3–5 scope](phase-03-05-calls-dental-and-parity.md), [template implementation](phase-01-templates-and-text.md), and [authenticated observations](research/authenticated-workflows.md). Existing CloudTalk code is evidence of the current application contract, not independent verification of the provider's current response schema.

Official public-document research is now recorded in [CloudTalk transcript contract](research/cloudtalk-transcript-contract.md): complete offset/limit enumeration and the fuller segment/caller schema are documented; no atomic revision-pinned snapshot guarantee was established. This verifies the public contract only, not account execution or clinical readiness.

## Outcome and delivery boundary

An authorized administrator chooses a call already assigned to a household conversation, explicitly chooses one saved patient and unsigned encounter, reviews a complete frozen transcript with speaker/time provenance, and requests a source-cited clinical draft. Only reviewed sections enter the existing unsigned encounter. Recording, transcript, proposal and accepted chart sections remain distinguishable. No automatic patient selection, signature, outbound call, message, task or chart update.

Deliver in two increments:

1. **3A — source capture:** administrator-only immutable transcript capture, explicit household/patient/encounter binding, complete evidence preview and recovery. No OpenAI request or clinical write. This is useful reviewable infrastructure, not a completed AI call-summary feature.
2. **3B — generation and review:** a genuine call source kind, separately approved processing scope, existing template/attempt/parser machinery and explicit unsigned chart acceptance, with source-specific access checks throughout.

Keep real call processing inactive until Susan approves the call-source processing/retention scope. A typed-note or clinician-recording approval must not silently authorize a household call. Current ADMIN-only media access remains the default; broader staff access is a separate policy change, not an implementation assumption.

## Verified current code

| Concern | Current native contract | Consequence |
| --- | --- | --- |
| Call identity | `cloudtalk_calls.call_uuid` primary key; `call_id` is provider numeric identity | Retain both; browser-supplied phone numbers cannot authorize evidence |
| Availability | `ended_at`, `trusted_number`, `transcript_ready`, `recording_ready`, `last_event_at` | Require completed trusted transcript-ready call; absence means unavailable, not empty clinical evidence |
| Call SELECT | Active-staff RLS plus `trusted_number` | Call metadata visibility does not confer transcript access |
| Household assignment | `communication_inbound.provider='cloudtalk'`, `resource_id='call:' || call_uuid`; row includes `client_id`, `conversation_id`, `message_id`, `version` | Capture exact assigned evidence; unmatched calls use existing review first |
| Thread | `messages.provider='cloudtalk'`, `provider_message_id=resource_id`, matching conversation | Revalidate actual immutable provider projection and household, not a guessed link |
| Manual assignment | `assign_inbound_communication` requires current staff actor, expected row version, matching client/conversation and reason; assignment history retained | Reuse this workflow; do not add a competing patient-matching system |
| Patient mapping | `pets.client_id` and `clinical_encounters.pet_id` | Explicit pet must belong to the assigned client and encounter |
| Destination | Existing note guard requires matching expected encounter version, draft status and active/nondeceased patient | No call-generated care for archived/deceased patients or signed destinations |
| Operator/session | `clinical_dictation_actor` validates actual staff and `next_visit_review_session`; worker checks original session through `clinical_audio_worker_actor` | Retain importing actor/session separately from assigned doctor; recheck after waits |
| Media endpoint | `cloudtalk-call-media` calls `getUser`, requires ADMIN role, queries call through authenticated RLS, fetches one provider page | Reuse authorization intent, but current endpoint is not complete clinical source capture |
| Browser transcript | `CallMediaControls` loads one page and replaces prior page; assumed `data.language`, `data.segments[{start,caller,text}]`, `pagination{offset,total}` | Do not generate from the displayed page or assume it is the whole call |
| Note sources | SQL/Zod allow only `typed` or `audio_transcript`; server resolves audio source by owned job identity | Call transcript cannot safely masquerade as either source kind |
| Reviewed chart path | Note finish creates `clinical_dictation_proposals`; explicit review calls existing encounter save with expected version | Reuse chart semantics, not a new direct update path |

Principal inspected sources: `20260926090000_cloudtalk_activity.sql`, `20260928110000_cloudtalk_unified_inbox.sql`, `20260928160000_cloudtalk_capability_redaction.sql`, `20261016040402_clinical_dictation_review.sql`, `20261016143618_clinical_audio_soap.sql`, and `20261016224741_clinical_note_templates.sql`. Recheck later migrations before implementation; do not edit historical migrations.

## Access contract: prevent indirect transcript disclosure

Current note/dictation reads return complete source text to any active staff member. Merely extending the note source enum would bypass ADMIN-only media access through:

- `read_clinical_notes`: job list includes `source_text`.
- `read_clinical_note_job`: complete job source.
- `read_clinical_note_provenance`: generated payload with literal source quotes and call metadata if extended.
- `read_clinical_dictation`: complete proposal `transcript`, sections and review.
- Generation, action recovery and rejection/acceptance paths that return one of those objects or retain actor-owned request payloads.
- Browser query caches, any proposed call list/detail API, exports, and generic provenance UI.

Use source-specific SQL authorization; hiding buttons is insufficient. For call-derived objects, current ADMIN plus active live session is required to capture, read source/proposal/quotes, generate, review, recover and cancel. Filter call items before pagination/counting in general lists so staff are not shown inaccessible payloads or misleading page state. Direct-ID reads must refuse rather than return raw content. Guard after policy/destination/source locks as well as at entry. Service-only completion checks the recorded original actor/session/role and exact admitted source identity; a supplied actor UUID alone is not authority.

The reviewed sections deliberately accepted into the ordinary patient chart follow the existing chart access rules. This must not expose the original full call, other pets' conversation, source quotes or rejected proposal to all chart readers. Keep retained call evidence and unaccepted proposals ADMIN-only. Clinical-policy review must acknowledge this distinction.

Preferred 3A design uses private call tables/RPCs so unfinished source integration cannot leak via generic note reads. For 3B, extend shared note persistence only with all source-specific filters/guards in the same release. A completely separate call generation/review persistence lane is an alternative if shared access cannot be proved; reuse pure validators and existing unsigned save semantics rather than duplicating an entire scribe system.

## Immutable source and action design

The following records the original design. Implemented 3A persistence is `clinical_call_sources`, `clinical_call_capture_actions`, `clinical_call_policies` and `clinical_call_policy_actions` in migration `20261017042642_clinical_call_sources.sql`; bounded segment/page evidence is inside each immutable document. The evidence receipt and shared Zod model define the delivered API, rather than every proposed name below:

- `clinical_call_sources`: immutable source ID, provider, call UUID/provider ID, originating actor/session, captured household association, patient/encounter/version, source-policy version, transcript schema/projection version, language, capture start/end, canonical document and SHA256.
- `clinical_call_source_segments` or bounded segments inside the immutable document: ordinal, original provider segment identity if supplied, original speaker label, original start/end if supplied, exact text, segment hash and normalized projection offsets. Do not manufacture end times, speaker identities or provider IDs.
- `clinical_call_capture_attempts/events`: immutable request identity, exact nonclinical intent, lease, state, sanitized error category, dispatch/completion and cancellation/terminal receipts.
- Optional private page evidence rows: offset/limit/total, retrieval instant, HTTP/provider revision metadata actually supplied and hash of the permitted response. Retain only the transcript response fields needed under the approved retention policy; never persist credentials or arbitrary response headers.

All new tables: RLS enabled, no direct public/anon/authenticated/service-role grants, narrowly scoped security-definer routines, fixed search paths, immutable history and bounded JSON validation using repository patterns. Authenticate writes against `session.user.id`; SQL verifies actual JWT actor, not browser assertions.

Capture state flow:

1. Administrator selects a completed call from its assigned household; confirms patient, unsigned encounter, expected version and authorization attestation.
2. Authenticated reserve RPC journals a unique action ID and exact intent, locks its scope, verifies current ADMIN/session and all household/destination joins, and pins source policy plus relevant call/association fingerprints. Reuse exact ID for recovery; different input under one ID is rejected.
3. Server-only capture worker claims the admitted action once. Revalidate its originating session/role, source assignment and policy before external access. No client-supplied transcript, summary, arbitrary URL, provider ID override or bearer credential is accepted as clinical evidence.
4. Fetch all bounded transcript pages from the fixed provider host. Record source-completeness evidence below. Incomplete capture cannot become a usable source.
5. Finish RPC verifies action/lease, exact policy/association/destination and actor/session/ADMIN again, computes/validates canonical hashes, and stores one immutable complete source plus terminal receipt atomically. A revoked action may retain sanitized outcome metadata only, according to approved retention; it must not publish raw evidence to a revoked reader.
6. Lost finish response recovers the same source identity. Repeating capture does not create a second source under the same action. Cancelled reservation/attempt tombstones prevent a delayed request from reviving work.

Use a consistent documented lock order across source/destination/policy operations. Establish concurrency tests with observed barriers rather than sleeps. Do not hold a database transaction open while fetching external pages.

## Complete pagination and source consistency

Current provider URL in the application is `https://api.cloudtalk.io/v1/ai/calls/{call_id}/transcription?limit=100&offset={offset}`. The [official endpoint](https://help.cloudtalk.io/api-reference/conversation-intelligence/transcription), [pagination guide](https://help.cloudtalk.io/guides/pagination#conversation-intelligence-pagination) and [OpenAPI schema](https://help.cloudtalk.io/api-reference/openapi.json) now verify offset/limit paging and require more than the current UI displays: `data.callId`, segments with both `start` and `end`, caller identifier/text, `data.callers` with original local identifiers/type/nullable ID, language and pagination limit/offset/total. See the linked research for exact types and limits. Authorized sample execution and account entitlement still require commissioning.

Implement a shared strict Zod response model and a bounded reader before reusing it for capture. Limits must be named constants mirrored in SQL and tests. Select concrete maximum pages/segments/UTF-8 bytes/characters, per-page timeout and total capture duration during implementation; reject over-budget sources visibly rather than silently truncate. The existing note source budget is 60,000 UTF-16 characters; both full transcript projection and segment evidence must fit supported generation/storage limits before any paid request.

For each page verify:

- Successful fixed-host response, permitted content type, no redirects and bounded streamed bytes.
- Expected requested and returned offset, stable declared total, integer nonnegative counts, consistent language and permitted segment structure.
- Exact contiguous coverage through the terminal count; no gap, repeated page, skipped offset, empty or short nonterminal page, count overshoot, silent page-cap exit or inconsistent total.
- Valid finite timestamps and preserved original ordering; reject impossible supplied ranges. Equal/overlapping speaker timestamps require an explicit supported rule, not arbitrary sorting or dropping.
- Exact source text and attribution retained; never substitute `ai_summary`, translated summary, partial display or concatenated unrelated calls.

Retain page offset/count/hash/retrieval evidence and the final normalized full-source hash. Pin a real provider transcript revision/ETag if supplied and verified. Without an atomic provider revision contract, stable pagination proves a complete captured enumeration under the stated checks, not an atomic or forever-current provider snapshot. Document this limitation and decide whether a second consistency pass is necessary from actual authorized samples; never invent revision guarantees or remote-currentness from a local webhook timestamp. A changed supported revision/association invalidates admission and requires explicit recapture, preserving prior evidence.

Source text projection should include stable segment ordinals plus original time/speaker labels. Preserve raw segment text separately. Literal claim quotes map back to segment IDs and source offsets; repeated matching text must retain every possible support location or require explicit disambiguation. Do not attach a unique speaker/date based only on a repeated quote. Browser formatting must not change the bytes used for source hashing.

## Generation and acceptance contract

Extend `_shared/clinical-note-model.ts` and SQL coherently with `call_transcript`, a server-resolved call-source ID/hash and approved call-policy version. Keep typed/audio semantics and historical receipts backward compatible. Never accept pasted source text while claiming it was fetched from CloudTalk.

Reuse the shared request/parser, pinned template definition/hash, actual veterinary vocabulary receipt, bounded provider response, literal field claims, attempt budget and one-shot dispatch. Generation uses only the frozen selected patient's authorized call source. Source includes call context and attribution; it does not turn another pet's history or an owner's hypothesis into this patient's finding. Ambiguous speaker/pet statements remain visible and cannot silently populate multiple charts.

Add call-specific processing policy/gate checks to handler and SQL source guard. Pin model/prompt/template/vocabulary/source versions. Any changed prompt must have a new version, backward-compatible reads, matching SQL finish validation and explicit fidelity evaluation. An approved clinician-audio policy alone does not satisfy call processing. Real provider calls require authorized sample inputs and a bounded recorded decision; stubbed tests must remain labeled stubbed.

At completion retain the original field payload, source hash, segment support, provider/request/response IDs, versions and actual operator separately from edited sections. Correct current source labels: `finish_clinical_note` presently labels non-typed input as clinician audio; `ClinicalDictationReview` similarly assumes typed versus completed dictation.

Before reviewed acceptance, revalidate current ADMIN/session, call-source access, household/patient association, exact policy/template/source binding, and destination expected version. Existing generic dictation review currently does not invoke note-source guards; introduce source-aware validation in the same migration or a guarded review hook that cannot be bypassed through the generic RPC. Preserve terminal recovery semantics without returning call content after authority is lost.

Use `save_clinical_dictation_action`/existing unsigned encounter save for explicit selected-section acceptance after those guards. No direct updates, automatic signature, addendum shortcut or replacement of untouched SOAP sections. Signed/stale/inactive destinations refuse; rejected proposals retain a reason and no chart write. Original source, generated proposal, review edits and accepted record version remain separate.

## Actionable file map

All repository-relative paths below are under `/Users/davidedler/Developer/lrv-clinical-calls-20261016/`. The 3A migration is `20261017042642_clinical_call_sources.sql`; 3B rows remain planned. No files are deleted.

| Action | File/module | Responsibility/dependency |
| --- | --- | --- |
| Create | `supabase/migrations/<new>_clinical_call_sources.sql` | Private immutable capture/actions, strict guards, actual session/ADMIN and household joins; no historical migration edits |
| Create | `supabase/functions/_shared/clinical-call-model.ts` | Zod capture intents, pagination/segments, budgets, canonical source and receipt contracts |
| Create | `supabase/functions/_shared/clinical-call-handler.ts` | Dependency-injected fixed-host bounded pagination/capture orchestration; no general fetch proxy |
| Create | `supabase/functions/clinical-call-capture/{index.ts,deno.json,deno.lock}` | JWT-authenticated capture boundary and private service completion; independent processing scope |
| Create | `src/hub/features/clinical/call-drafts/{api.ts,model.ts,PatientCallDrafts.tsx}` | Exact patient/encounter scoped selection, full frozen transcript review, permission/error/recovery states |
| Modify | `src/hub/features/clinical/ClinicalWorkspace.tsx` | Source action beside existing note/dictation workflow; reuse mutual dirty/busy navigation guards |
| Reuse/modify narrowly | `src/hub/features/cloudtalk/use-cloudtalk-thread.ts` | Existing household projection identities; no phone-suffix pet mapping |
| Reuse/modify narrowly | `src/hub/features/cloudtalk/CallMediaControls.tsx` | Keep ordinary ADMIN-only media preview; shared validated reader only if it preserves existing behavior |
| Reuse/modify narrowly | `supabase/functions/cloudtalk-call-media/index.ts` | Avoid unrelated media refactor; existing proxy must not be represented as durable complete capture |
| Modify in 3B | New migration for note source/read/review integration | Genuine call source kind, source guard at reserve/dispatch/finish/review, safe list/direct-ID/recovery behavior |
| Modify in 3B | `_shared/clinical-note-{model,handler}.ts`, `clinical-note-process/index.ts` | Call source identity, policy/gate, source-attribution prompt and versioned result provenance |
| Modify in 3B | `src/hub/features/clinical/templates/{model.ts,api.ts,ClinicalNoteDrafts.tsx}` | Call-aware source selection/labeling without raw transcript leakage to staff |
| Modify in 3B | `src/hub/features/clinical/dictation/{model.ts,api.ts,ClinicalDictationReview.tsx}` | ADMIN call proposals, original segment evidence, source-aware acceptance and correct labels |
| Create | `tests/clinical-calls/{model.test.ts,handler.test.ts,local-roundtrip.ts,disposable.py,README.md}` | Stubbed provider pages, actual local Auth/RPC/browser/recovery/races and restore proof |
| Create | `supabase/tests/clinical_call_sources.test.sql` | ACL/RLS/actor/session/household/destination/immutable state and access-bypass tests |
| Modify as required | Migration-count tripwires, edge-isolation/CI checks, restore verification | Update actual repository required checks for each new migration/function; do not regenerate `types.ts` locally |
| Update after proof | Phase status and `docs/launch-evidence/<dated>-clinical-call-sources.*` | Exact revision, real versus stubbed calls, scope, remaining gates and cleanup |

## Acceptance and release checklist

The combined checklist below also includes generation/review and therefore stays open until 3B. Completed 3A engineering acceptance is separately recorded in the [evidence manifest](../../docs/launch-evidence/2026-10-16-clinical-call-sources.json): final 61 SQL, 75 API, 41 browser, 3 STAFF and 5 restore checks, two observed lock waits, exact source/input hashes and owned runtime cleanup. Canonical compatibility passes 164 files / 7,172 assertions. Actual account execution, clinical adjudication, exact-head CI and hosted release remain separate.

- [ ] Confirm provider pagination/schema/revision behavior using authorized documentation and explicitly permitted synthetic/sample data; preserve uncertainty where unsupported.
- [ ] Anonymous, inactive/banned/revoked-session and non-ADMIN users cannot capture/read/recover/generate/review a call source through any direct or generic RPC/Edge path.
- [ ] ADMIN demotion/session revocation during observed capture/finish/accept lock waits is rechecked before raw data exposure or commit.
- [ ] Call metadata visibility, guessed source/proposal IDs and generic note/dictation APIs do not disclose complete transcript, quotes, other-pet history or rejected proposals to staff.
- [ ] Wrong household/conversation/patient/encounter, unmatched call, untrusted/incomplete call, signed/stale destination and deceased/archived patient fail without clinical writes.
- [ ] Missing/repeated/out-of-order page, changing total/language/revision, malformed timestamps, oversized/truncated/body-interrupted source and provider refusal never become a complete source or paid generation.
- [ ] Duplicate reservation/dispatch/completion/review, cancellation race and lost committed responses recover original identities; no automatic provider retries.
- [ ] All stored source hashes derive from exact server-fetched evidence; full transcript and per-claim support resolve to retained segments without fabricated speaker or temporal certainty.
- [ ] Multi-pet, ambiguous names/speakers, owner-versus-clinician, negative findings, historical events, planned/declined care, corrections and hostile instructions remain faithful; missing fields remain missing.
- [ ] Real local Auth/PostgREST/handler/browser proof exercises source capture and reviewed chart save, not only mocked UI. Provider page and OpenAI stubs are labeled explicitly.
- [ ] Actual desktop and 390px patient workspace checks cover full preview, error/recovery and navigation protection. Browser storage retains only nonclinical pending IDs, not transcript/quotes/review text.
- [ ] Populated dump/restore preserves immutable sources, actions, provenance, accepted versions and permissions; replay reads retained results without regeneration.
- [ ] Required unit/SQL/Auth/browser/edge-isolation/build/CI checks pass at the exact reviewed revision. Update migration-count checks coherently.
- [ ] Staging proves dependency-order rollout and exact receipts while real processing remains off. Primary migration/functions/frontend are verified separately; merging Git does not deploy Edge Functions.
- [ ] Obtain Dave's specific merge go for the completed PR; no implicit merge from this plan. Obtain Susan's clinical/policy adjudication and explicit commissioning before enabling real calls.

## Open dependencies and next action

1. The public response/pagination schema is independently documented in the linked official-source research. Actual account behavior and a provider atomic revision protocol remain unverified; complete observed enumeration must not be called a revision-guaranteed snapshot.
2. Susan must approve call recording/transcript processing, retention and the separation between private full-call evidence and reviewed chart sections. Keep existing ADMIN access meanwhile.
3. Real calls may mention multiple pets or uncertain speakers. The first increment handles one explicitly selected patient with ambiguity flagged; it does not claim validated multi-pet automatic extraction or diarization.
4. Implemented 3A budgets are 100 segments/page, 10 pages/pass, two passes/20 requests, 1,000 segments, 60,000 UTF16 projection characters, 240,000 UTF8 projection bytes, 512,000 bytes/response, 10 seconds/request, 120 seconds total and a 2 MB document. Unsupported/over-budget sources fail visibly; authorized provider samples remain a commissioning dependency.
5. Complete exact-head CI and separately evidenced staging/primary rollout of the proven 3A package with its policy draft and gate off. Next implement [3B shared generation/acceptance](phase-03b-call-summary-implementation.md) and its separately recorded fidelity evaluation. [Dental dictation](phase-04-dental-dictation-implementation.md) remains a planned increment.
