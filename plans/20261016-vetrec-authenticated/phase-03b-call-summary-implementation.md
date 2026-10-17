# Phase 3B — OpenAI call drafts with private source evidence

Status: **plan only**. Inspected against the Phase 3A call-source worktree on 2026-10-16. No feature edits, migrations, runtimes, provider requests, policy approvals or activation are authorized by this document itself. Phase 3A final proof and release must be verified separately.

Repository root for every path below: `/Users/davidedler/Developer/lrv-clinical-calls-20261016`.

Read with [Phase 3 source plan](phase-03-call-source-implementation.md), [Phases 3–5 scope](phase-03-05-calls-dental-and-parity.md), and [parent plan](plan.md). `docs/development-rules.md` is absent in this checkout; project `AGENTS.md` and the confirmed owner requirements govern implementation.

## Outcome and scope

An active administrator opens an already captured complete household call, explicitly confirms its one saved patient and unsigned encounter, chooses an approved clinical template, and requests an OpenAI draft. Each proposed clinical claim resolves to exact retained transcript segments. The administrator inspects the source, edits and selects proposed SOAP sections, then explicitly accepts them through the existing unsigned encounter save. Signing remains a separate action.

The owner selected **OpenAI**, not Claude, for the recording/note workflow. A captured CloudTalk transcript is already text: this increment summarizes that frozen source; it does not re-transcribe audio or fetch CloudTalk again during generation. Use the existing server-side `OPENAI_API_KEY` boundary and policy-pinned model. The inspected note policy currently permits `gpt-6-luna`; do not silently change it or represent the returned alias as an immutable model snapshot.

Keep these different products distinct:

| Product | Source and destination | First 3B boundary |
| --- | --- | --- |
| Patient-linked clinical call draft | One complete captured call, explicitly mapped to one patient and unsigned encounter | Implement. Private source and unaccepted proposal remain ADMIN-only; only explicitly reviewed clinical sections enter the ordinary chart. |
| Whole conversation/client summary | Potentially multiple calls/messages, several pets, balances, logistics and tasks | Do not infer this from one patient link or copy a clinical draft into Messages. A whole-household summary needs its own scope, evidence selection and visibility contract. This plan does not add automatic inbox write-back. |
| Encounter/medical-record recap | Existing selected signed encounters, addenda and native problems | Continue using the records-recap workflow. Do not quietly include raw calls or unaccepted call proposals. Reviewed chart wording may subsequently enter a signed encounter and be summarized under ordinary chart access. |

No automatic chart insertion, signature, addendum, diagnosis/problem entry, vaccine administration, medication order, invoice, payment, task/ticket, reminder, certificate, export, email or text. A caller saying a drug was discussed is not evidence it was prescribed, billed or administered.

## What exists and why an enum-only change is unsafe

| Existing location | Verified behavior | Required change |
| --- | --- | --- |
| `supabase/migrations/20261017042642_clinical_call_sources.sql` and `_shared/clinical-call-model.ts` | Private captured source, immutable `{context,document}` manifest hash, original call times, segments/page evidence, current ADMIN/source-association/trust guards | Reuse retained evidence. Never accept browser-supplied replacement transcripts, timestamps or source hashes. |
| `supabase/migrations/20261016224741_clinical_note_templates.sql` | `clinical_note_jobs.source_kind` supports only `typed` and `audio_transcript`; note reads expose `source_text`; finish creates a dictation proposal containing the full transcript | Introduce genuine `call_transcript` plus source-aware access across every read/write/recovery path before creating any call note. |
| Same migration: `clinical_note_guard`, reserve/claim/dispatch/finish/cancel routines | Existing session, template, policy, unsigned destination and completed-audio checks | Branch on the trusted stored source kind and invoke call-specific source/policy/ADMIN checks, including after lock waits. |
| `supabase/migrations/20261016040402_clinical_dictation_review.sql` | `read_clinical_dictation` returns original transcript and reviews to active staff; `recover_clinical_dictation_action` returns saved receipts; acceptance calls `save_clinical_encounter` | Guard call-derived proposals and receipts. Generic reviewed acceptance must not bypass call authority. |
| `_shared/clinical-note-{model,handler}.ts` and `clinical-note-process/index.ts` | Shared template request, vocabulary, parser, attempts and OpenAI boundary; only typed/audio source forms | Reuse machinery with versioned call evidence and an independent call-generation gate. Preserve legacy result readability. |
| `src/hub/features/clinical/dictation/ClinicalDictationReview.tsx` | Full proposals/provenance use generic query caches; source labels currently distinguish typed versus clinician audio | Call-specific authorization, cache isolation and truthful source labels are required; an audio-label fallback is insufficient. |
| `clinical_recap_collect` in `20261017015543_clinical_record_recap.sql` | Explicit native signed-encounter/addendum/problem whitelist | Keep private call tables and unaccepted proposals outside recap collection. Preserve historical source contracts/hashes. |

All historical migrations stay unchanged. New migrations replace affected routines coherently; do not regenerate `src/integrations/supabase/types.ts` locally.

## Recommended design

Reuse shared note job/attempt/generation persistence, pure request/validation helpers and the reviewed encounter save semantics. Add a narrowly scoped private call-source adapter and versioned call-aware reads. Do not duplicate the complete scribe pipeline or disguise call text as typed observations.

A separate call generation/proposal persistence lane is the fallback if all shared-source access paths cannot be proven safe in the same release. Its cost is duplicate orchestration/review integration. Do not ship a partially guarded shared enum expansion to avoid that cost.

### Immutable binding and output versions

Add a source-discriminated reservation contract:

- `source_kind='call_transcript'` requires a server-resolved `call_source_id`, exact source-manifest hash, one matching `pet_id`, `encounter_id` and expected unsigned encounter version, approved template version/hash, general note-policy version, and call-generation policy version.
- `source_text` and `audio_job_id` must be null for call reservations. The server loads `clinical_call_sources.document.projection`; the browser cannot supply a transcript, provider URL, call ID override, speaker identity or alternative call time.
- Retain **two different hashes**: existing `source_sha256` for exact projection text, and the captured call's manifest SHA256 for immutable `{context,document}`. Neither substitutes for the other.
- Pin the source capture-policy version and original call context, including started/ended time, call/household/conversation/message IDs and assignment version. Capture timestamps and webhook arrival times must not become clinical event dates.
- Retain actual capture operator, generation operator/session and reviewer separately. A provider `agent` label does not identify a doctor. An old source creator leaving the practice does not by itself erase a completed source; new readers need current ADMIN authority, while live generation/attempt workers must revalidate their recorded initiating sessions.
- Version call request/payload/provider manifests explicitly; retain legacy typed/audio prompt/result readers. Store the actual provider/request/response IDs, returned model alias, template snapshot, veterinary vocabulary receipt and the exact source IDs/hashes used.

Use a call-specific claim support contract rather than relying on a single bare quote inside the concatenated projection. Each claim must reference retained segment ordinal(s), their text hash and exact contiguous excerpt/range in the segment text. Do not treat generated projection headers as clinical evidence. A compound comparison needs its own support from every relevant segment; a citation on another claim cannot repair it. Repeated wording must carry an explicit valid segment selection or all possible support locations, with ambiguity visible. Verify the same rules in TypeScript and SQL finish validation.

Preserve original speaker labels and numeric relative times; never fabricate a speaker identity or absolute event time for an ambiguous segment. Use recorded call time for contextual wording such as “yesterday,” and keep ambiguous relative dates uncertain. A local capture time is not the date of the conversation.

### Independent policy and backend gate

Create a separate call-generation policy, initially **draft**, whose wording covers OpenAI processing of household calls, provider handling/retention, other-pet and speaker ambiguity, and private source/proposal versus reviewed chart visibility. Phase 3A capture approval, typed-note approval and clinician-recording approval do not silently satisfy it.

Proposed gate: `CLINICAL_CALL_NOTE_PROCESSING_ENABLED`, default false. It is distinct from `CLINICAL_CALL_CAPTURE_ENABLED`, general note processing and clinician audio processing. All applicable general note/template and call-generation approvals must be current at dispatch/finish/accept. The selected captured source must also retain valid current source permissions and approved capture scope.

A changed generation policy/template requires a fresh explicitly authorized job. A changed capture scope/assignment/trust requires review and, when necessary, explicit recapture; never automatically fetch a new transcript or substitute a new source into an existing job. Historical authorized evidence remains retained independently of whether new processing is allowed.

## Authorization and rollout compatibility

Define one server-side source classifier/access helper that follows trusted generation/job/proposal relationships. Never authorize from a browser-supplied `source_kind` or a guessed UUID. Preserve denied direct table access, fixed search paths and service-only completion. Helper routines themselves must not gain public/authenticated execution accidentally.

**Concrete banned-user audit:** the inspected generic `clinical_dictation_actor` → `clinical_require_staff`/`is_active_staff` chain does not by itself check `auth.users.banned_until`; `clinical_audio_worker_actor` does. Phase 3A hardens its own call actor using the worker check. For 3B, inventory every private transcript-derived source/read/provenance/list/recovery/cancel/reserve/generation/accept surface and route it through the hardened current-user/session/ADMIN check, or an equivalent source-aware helper. Do not assume an active profile or existing valid JWT means the user is not banned. Repeat the actual non-banned live-session check after observed waits, including idempotent receipt recovery. Service workers additionally check their recorded initiating operator/session, not a supplied actor UUID. Add actual Auth tests that ban an otherwise active ADMIN after token issuance and during blocked read/generation/review/recovery operations; assert refusal and no raw transcript/quote/proposal disclosure or chart write. Keep any broad legacy authorization cleanup separately scoped; this increment must not inherit the generic gap for calls.

| Path | Call-specific requirement |
| --- | --- |
| `read_clinical_notes` and any call-aware list | Filter inaccessible call rows **before** limit, count and pagination. Prefer metadata-only call lists, then explicit guarded full reads. A STAFF user must not receive transcripts, quotes, private proposal text or revealing pagination state. |
| `read_clinical_note_job`, `clinical_note_job_view`, `read_clinical_note_provenance` | Direct-ID call reads require current active ADMIN/session and current source access. Internal view helpers remain non-public. |
| `read_clinical_dictation` | Exclude private call proposals before its 20-row pagination/`has_more` calculation for unauthorized readers, even after review. Ordinary chart readers receive accepted chart wording through the chart, not the private full-call proposal. |
| `save_clinical_dictation_action` and `recover_clinical_dictation_action` | Classify the referenced saved proposal/action server-side; apply call access before returning an existing receipt as well as before new acceptance/rejection. An administrator demoted to STAFF cannot recover private call content through an old action ID. |
| Note reserve/claim/dispatch/finish/cancel and reservation cancellation | Apply call authority on idempotent returns, cancellation conflict responses and lost-ACK recovery, not only initial admission. Terminal receipts must not become alternate transcript read APIs. |
| Audio provenance and generic manual submit | Call IDs cannot masquerade as audio sources or browser-pasted call imports. Manual typed/chart editing remains its existing explicit workflow; it must not receive forged provider-source provenance. |
| Recap preview/list/read/citation/review/recovery | Keep the existing native whitelist; prove raw calls, private proposals and their quotes never enter it. Accepted, subsequently signed chart text is ordinary chart evidence; it does not confer full-call access. |
| Other exports/read models | Inventory source/proposal joins, download routes, caches and generated artifacts before enabling call jobs. Generic chart export must not traverse into private transcript/proposal evidence. |

**Minimum clinical extraction boundary:** acceptance deliberately copies only the administrator-reviewed, clinically relevant wording for the explicitly selected patient into selected native SOAP fields. Present a diff that separates those sections from unrelated household discussion, other pets, billing/logistics, raw speaker assertions and unresolved patient attribution. Other-pet or unassigned claims are not automatically eligible chart fields. Keep the complete call, original/generated claim quotes, segment support, private call summary, provider/call/conversation/message/source IDs, hashes and source URLs on the private side of the review link; the server must not concatenate that provenance into ordinary SOAP text or chart metadata. Preserve original proposed versus reviewer-edited wording and author/time attribution in the appropriate audited records. This structural separation does not replace clinician review of whether edited wording belongs in the selected patient's chart.

After explicit acceptance, otherwise authorized staff retain normal native medical-record access to the resulting SOAP sections, and existing signing/export/record-recap rules apply to that chart text. Do not impose ADMIN-only access on the whole encounter merely because reviewed text originated in a call. Conversely, an accepted chart version, generic review receipt, recap citation or guessed private source ID must not grant access to the original call or other-pet quotes. Keep the review/job/source relation private and test both sides: STAFF can read the final accepted chart wording, but cannot follow generic reads/recovery/export back to full transcript, unaccepted proposal or private source identifiers.

Adding columns to `clinical_note_jobs` can break old strict Zod readers because `clinical_note_job_view` uses `to_jsonb(j)`. Adding call rows can also break old ADMIN clients whose source enum has only typed/audio. Preserve legacy list/view shapes and exclude calls from legacy lists for all old clients; add a versioned call-aware read surface for the new UI. New schemas must explicitly validate legacy versus call shapes. Test database-first rollout against the current frontend. Do not solve compatibility by making every object permissive or dropping provenance checks.

Document and test one lock order before replacing routines. Recheck current actor/session/ADMIN and source access after every potentially blocking policy/source/patient/encounter/job/attempt lock, including reviewed acceptance. Bind the attempt's actual operator independently of the job's original operator where the existing contract distinguishes them.

## User flow and recovery

1. Open the Phase 3A private source panel; select a retained source with a fresh server access check. Display original call date separately from capture date, current workspace identity and the frozen patient/encounter binding.
2. Explicitly choose the approved clinical template and confirm patient attribution, consent and the unsigned destination. Reserve one journaled note job with exact source/template/policy hashes. No provider call occurs on source selection.
3. Explicitly request generation. Perform one dispatch/provider request per admitted attempt. Do not refetch the call, retry automatically after timeout, or imply a failed/uncertain outcome was free.
4. Display a private **call-derived clinical proposal**, not a signed note or a client-facing summary. Show field claims, segment evidence, original speaker/time, missing findings and uncertainty. Other pets' statements and unassigned speech must not silently populate this patient.
5. Review/edit/select clinical sections and show a before/after diff. Preserve original model wording and citations separately from reviewer edits; edited wording is not automatically source-verified. Empty/unselected sections leave saved chart sections unchanged.
6. Accept through the existing expected-version unsigned encounter save inside the guarded review transaction. Store one immutable review and resulting encounter version. Reject requires a reason and no chart write. Signing still uses the existing separate sign workflow; signed encounters require their established addendum path, never a call shortcut.
7. Lost reserve, finish or accept acknowledgement recovers the original immutable identity and receipt. Repeating acceptance never appends twice or overwrites a later edit. Changing the source/template/policy requires a new action rather than rebinding the old ID.

Keep transcript/quotes/proposal/review text out of local/session storage, URLs, logs and notifications. Store only strictly validated pending IDs/versions/hashes. Keep private call reads in role-scoped ephemeral state or a dedicated cache that is removed on role/session/patient changes; never leak them into generic staff caches. Explicitly discarded invalid local metadata must not cancel an unknown remote action; require investigation of retained history/outstanding actions before a new attempt.

If source trust/household access, policy, template, patient lifecycle, encounter signature/version or original live session changes during dispatch/finish/accept, fail closed. Preserve authorized historical sources and sanitized failure categories; do not publish raw provider output to a revoked reader or persist private text in `failure_details`. No accepted sections means no chart mutation.

## Incremental PR boundaries

Every increment must leave real call generation off. Do not create source-kind rows until the access/compatibility increment has passed and landed. Obtain Dave's specific merge approval for each completed PR.

### 3B.1 — shared source contract, access and compatibility

- Add a new migration for `call_transcript`, exact server-resolved source bindings and the initially draft call-generation policy.
- Add source-aware guards to all generic note/dictation reads, idempotent returns, recovery, cancel and reviewed acceptance. Keep legacy readers and old frontend shapes working.
- Add versioned call-aware metadata/read APIs. Preserve Phase 3A private source ACLs and immutable manifest semantics.
- Add role/session/direct-ID/generic-bypass tests, pre-pagination filtering, old-frontend compatibility and populated restore evidence. No OpenAI/clinical chart writes in this increment.

### 3B.2 — OpenAI generation and private clinical review

- Extend the shared handler/SQL finish validation with the versioned segment-backed call request/result contract and default-off gate.
- Add private call draft generation/recovery and segment evidence UI to the lazy Phase 3A panel. Keep generic typed/audio flows and labels correct.
- Use the guarded existing dictation review/unsigned save semantics. Add an explicit accepted-section diff and recovery of exactly one resulting chart version.
- Complete deterministic source/claim checks and actual owned local Auth/HTTP/browser/concurrency/restore proof with labeled provider stubs. No real provider call follows from running ordinary unit/CI tests.

### 3B.3 — fidelity evaluation and hosted rollout preparation

- Freeze a synthetic call corpus and mandatory/forbidden fact inventory before paid requests; include all cases and raw assistant outputs, not just successful parser results.
- Record an explicit bounded paid-request decision, exact source/prompt/template/vocabulary versions and no-retry budget. Use the existing protected secret boundary; no key extraction or hosted patient reads. Remove temporary resources and prove preservation.
- Independently review every claim's own segment citations, patient/speaker attribution, dates, negation, unknowns and clinical meaning. Exact excerpt membership is necessary, not medical entailment. Preserve failed baselines, version fixes and separately bound reruns.
- Package exact CI/staging/frontend/Edge/DB evidence. Susan's clinical and call-specific policy approval plus explicit backend commissioning remain required for real calls. Staging/primary rollout and Edge deployment are separate from Git merge.

## Exact implementation map

Paths are absolute to make ownership reviewable. New migration names and new RPC names are proposals, not implemented APIs.

| Action | File | Responsibility |
| --- | --- | --- |
| Create | `/Users/davidedler/Developer/lrv-clinical-calls-20261016/supabase/migrations/<timestamp>_clinical_call_note_sources.sql` | Source-kind/schema, draft generation policy, access/compatibility guard changes; no historical migration edits. |
| Create | `/Users/davidedler/Developer/lrv-clinical-calls-20261016/supabase/migrations/<later_timestamp>_clinical_call_note_generation.sql` | Versioned finish/proposal/review integration when 3B.1 access proof is complete. |
| Modify | `/Users/davidedler/Developer/lrv-clinical-calls-20261016/supabase/functions/_shared/clinical-note-model.ts` | Discriminated source/reservation/job/provenance versions, segment-supported call result; preserve typed/audio readers. |
| Modify | `/Users/davidedler/Developer/lrv-clinical-calls-20261016/supabase/functions/_shared/clinical-note-handler.ts` | Call-specific OpenAI request/parse branch, vocabulary and source-time context, independent gate, no automatic retry. |
| Modify | `/Users/davidedler/Developer/lrv-clinical-calls-20261016/supabase/functions/clinical-note-process/index.ts` | Wire default-off call-generation flag and existing server key; update frozen dependency lock if required. |
| Reuse narrowly | `/Users/davidedler/Developer/lrv-clinical-calls-20261016/supabase/functions/_shared/clinical-call-model.ts` | Existing immutable source/context/segment contracts; add generation schemas only if separation remains clear. |
| Modify/create within | `/Users/davidedler/Developer/lrv-clinical-calls-20261016/src/hub/features/clinical/call-drafts/` | Private source selection, policy, generated proposal, segment provenance, recovery and explicit clinical review. |
| Modify | `/Users/davidedler/Developer/lrv-clinical-calls-20261016/src/hub/features/clinical/templates/{model.ts,api.ts,ClinicalNoteDrafts.tsx}` | Versioned call-aware contracts where shared; preserve ordinary note behavior and truthful source labels. |
| Modify | `/Users/davidedler/Developer/lrv-clinical-calls-20261016/src/hub/features/clinical/dictation/{model.ts,api.ts,ClinicalDictationReview.tsx}` | Source-specific review/provenance, ADMIN handling, cache isolation, section diff and recovered accepted version. |
| Modify narrowly | `/Users/davidedler/Developer/lrv-clinical-calls-20261016/src/hub/features/clinical/ClinicalWorkspace.tsx` | Existing mutual dirty/busy/navigation guard and accepted saved-record adoption. |
| Create/extend | `/Users/davidedler/Developer/lrv-clinical-calls-20261016/tests/clinical-calls/` | Call-generation/segment-fidelity fixtures, actual Auth/HTTP/browser/race/restore proof, private evidence instructions. |
| Extend | `/Users/davidedler/Developer/lrv-clinical-calls-20261016/tests/clinical-notes/` and `/Users/davidedler/Developer/lrv-clinical-calls-20261016/tests/clinical-dictation/` | Legacy typed/audio behavior, private call leakage/bypass and review idempotency regression. |
| Create/extend | `/Users/davidedler/Developer/lrv-clinical-calls-20261016/supabase/tests/clinical_call_sources.test.sql` and new call-note SQL tests | Every ACL/guard/receipt/source/attempt/review path, including effective grants after restore. |
| Update as needed | `/Users/davidedler/Developer/lrv-clinical-calls-20261016/.github/workflows/ci.yml`, edge-isolation scripts and all actual migration-count tripwires | Exact new migration/function proof; ordinary CI remains offline/synthetic. |

No deletion planned. No new CloudTalk outbound dialer or Messages synchronization required.

## Required acceptance proof

| Concern | Required evidence |
| --- | --- |
| Access matrix | Anonymous, inactive, banned, revoked session and non-ADMIN direct/indirect source/job/proposal/provenance/recovery/cancel/accept requests denied. Test ADMIN demotion during observed lock waits and stale cached browser state. |
| Source identity | Wrong patient/household/conversation/message/call, forged browser transcript/hash/time, source from a different encounter, retired template, policy drift, untrusted reassignment, inactive/deceased patient and signed/stale destination refused. |
| Citation fidelity | Cross-segment unsupported comparison, duplicate quotes/speaker ambiguity, another pet's statement, owner/caller versus examined findings, historical events, exact decimals/units, planned/declined care, correction, unrecorded measurement and hostile transcript instructions. All compound claims support their own clauses. |
| Time | Original call versus capture/webhook timestamps; relative dates near midnight/DST; unknown start time; overlapping speakers; no invented absolute segment date. |
| Transport/parser | One admitted OpenAI dispatch, refusal/truncation/malformed/unusable response, request/response byte budgets, server-computed source hash, matching SQL/TypeScript validation and backward prompt readers. Zero usable claims fails without filler. |
| Recovery/races | Lost reservation, provider-finish and reviewed-accept ACK; duplicate requests; canceled ID tombstone; expired/uncertain attempt; concurrent source trust/assignment, role/session, policy/template, encounter-edit/sign and acceptance races. Observe real lock barriers rather than sleeps. |
| Clinical writes | Before explicit acceptance, canonical patient/encounter/medication/vaccine/invoice/outbox/task tables remain unchanged. Acceptance modifies selected nonempty SOAP sections once, leaves other sections intact, preserves review/author attribution and does not sign. Rejection writes only private review evidence. |
| Indirect disclosure | Generic staff note/dictation lists/counts/caches, audio provenance, recap selection/citation/recovery and chart export cannot expose original full calls, private proposals or other-pet segments. Accepted chart wording is the explicit visibility exception. |
| Actual UI | Local Auth/PostgREST and the actual Patient 360 at desktop and 390px: select source, generate, inspect all segment evidence, edit/select/reject/accept, recover after reload, protect navigation and refuse STAFF access. Chromium mobile width is not an iPhone/Safari device acceptance claim. |
| Restore/release | Populated sources, drafts, reviews, actions, original/result hashes and effective permissions survive dump/restore. Read retained results without regeneration. Required checks pass at exact reviewed revision; primary/staging DB/functions/frontend verified separately. |

## Exit criteria and dependencies

- [ ] 3A exact released schema/ACL/source proof confirmed; migrate from that reviewed revision, not an unverified worktree assumption.
- [ ] 3B.1 access and database-first compatibility pass before real call jobs can exist.
- [ ] 3B.2 deterministic + actual local end-to-end proof passes with no automatic signature/billing/delivery.
- [ ] 3B.3 complete bounded synthetic evaluation passes; failures remain preserved and Susan independently adjudicates clinical fidelity.
- [ ] Susan approves OpenAI call processing/retention and the private-source versus accepted-chart distinction. Existing approvals are not reused implicitly.
- [ ] Authorized CloudTalk account behavior and real sample access are commissioned separately; Phase 3A synthetic two-pass tests are not proof of account entitlement or atomic remote revision support.
- [ ] Production key/gates are configured only through approved secret handling and explicit commissioning; no activation is performed by this plan.
- [ ] Dave gives the specific merge go for each completed PR; deployment receipts distinguish Git, database, Edge and frontend changes.

Open decisions: approve the exact call-generation policy/retention wording; decide whether a separately scoped whole-conversation/client summary is wanted after patient-linked clinical drafts; obtain authorized real call samples for speaker/pet ambiguity review; schedule real iPhone/Safari acceptance. None blocks implementing and proving the default-off synthetic increment.
