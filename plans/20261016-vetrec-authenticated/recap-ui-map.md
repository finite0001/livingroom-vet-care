# Phase 2 records recap — UI implementation map

Status: implementation design only. No recap application code, runtime checks, migrations, provider requests or activation were performed for this document. Baseline inspected: Phase 1 `fd3f329a`. All tests below are **planned**, not completed. [Strict proposed contract](recap-contract.md) and [scope](phase-02-recapped-records.md) remain authoritative.

## Placement and ownership boundary

Use a patient-level Medical section, independent of the encounter editor. An internal recap can cover several signed encounters and optional problem-list evidence; it must not require an open encounter or create a draft encounter.

Proposed entry: `/hub/patient/:id?tab=medical&section=recap`, using existing `patientHref(petId, 'medical', 'recap')`. Add `<Section360 id="recap">` immediately after the existing SOAP section; its focus/scroll target becomes `#p360-recap`. The existing `/hub/patient/:id` route and `medical` tab already support this section pattern. A new top-level route or tab is unnecessary.

| File | Observed integration / proposed change |
| --- | --- |
| `src/App.tsx` | Existing `/hub/patient/:id` route renders `PatientPage`; retain it unchanged. |
| `src/hub/features/patients/PatientPage.tsx` | Actual patient workspace owner. Lazy-mount `PatientRecap` in Medical using `Suspense`, as Imaging/Labs do. Add `recapDirty` to `dirty` and `medicalDirty`; feed `onDirtyChange`. Preserve first-visit mount / subsequent hidden-tab retention. |
| `src/hub/features/patient-360/model.ts` | Reuse `patientHref` for section links. No new tab, timeline source type, next-step signal or summary mutation in this increment. |
| `src/hub/features/patient-360/Section360.tsx` and `use-scroll-to-section.ts` | Reuse their `p360-` IDs, delayed focus/scroll and user-interruption behavior. No recap-specific scroll implementation. |
| `src/hub/features/clinical/use-unsaved-changes.tsx` | Existing path-change guard and `beforeunload` protection remain the navigation boundary. Same-record tab changes preserve mounted editors. |
| `src/hub/features/clinical/recap/model.ts` — new | Reexport shared strict recap schemas. Add UI metadata schemas with canonical UUIDs, fixed retry reasons and no clinical strings in persistent recovery metadata. |
| `src/hub/features/clinical/recap/api.ts` — new | Actual session actor on every RPC; validate envelopes, actor/patient/job/output/manifest/source identities. Independent `clinical-recap-process` invocation with exact `x-recap-intent`. |
| `src/hub/features/clinical/recap/PatientRecap.tsx` — new | Patient-scoped controller: selection, frozen job, attempt/review history, dirty/busy aggregation and durable recovery. Key by actor and patient. |
| `src/hub/features/clinical/recap/RecapSourceSelection.tsx` — new | Discovery pages, selected encounter IDs, date filter and whole eligible native-problem group toggle. |
| `src/hub/features/clinical/recap/RecapSourcePreview.tsx` — new | Current server preview, full source inventory/content, exclusions and hard budgets; capture action. |
| `src/hub/features/clinical/recap/RecapCitation.tsx` — new | Authorized frozen citation reader, source metadata and excerpt highlighting; separate current-record navigation. |
| `src/hub/features/clinical/recap/RecapReview.tsx` — new | Per-claim selection/editing, evidence display, explicit accept/reject and immutable terminal review display. |
| `src/hub/features/clinical/recap/RecapPolicy.tsx` — new | Independent recap policy display / ADMIN configuration with its own approval attestation and recovery controls. |
| `src/hub/features/clinical/ClinicalWorkspace.tsx` | Retain existing encounter/appointment/dictation editor. Only consider a mutual `recapDirty` busy guard through its existing `disabled` prop; do not embed recap in its encounter draft state or reuse its write actions. |

Do not inherit `ClinicalWorkspace.disabled` as a recap eligibility rule: it includes inactive patients. Archived/deceased patients remain eligible for authorized historical recap. Pass separate `blocked` (other unsaved work), saved patient identity/version and lifecycle props; lifecycle appears as context, not a reason to deny historical discovery/review. Retain existing new-care restrictions.

While recap selection/review is dirty or uncertain, pause Patient360 background summary refresh through existing `dirty` behavior. Other editor guards should include `recapDirty` where the neighboring feature already participates in shared dirty exclusion. The recap's own `blocked` expression excludes `recapDirty`, preventing a self-blocking editor. Read-only citations/history can remain available while mutation controls are blocked. No need to disable harmless source browsing because the processing policy is draft.

## Screen and state map

### 1. History and independent approval

Heading: **Records recap**. Explain: “A dated summary of selected records. It does not update the clinical chart.” Show historical patient lifecycle if archived/deceased. Display recap policy version/status and separate runtime-unavailable feedback; approval does not imply the server processing gate is enabled. Existing recaps remain readable under current staff access when processing is inactive.

History uses `list_clinical_recaps` newest-first with explicit earlier-page controls. Opening a row calls `read_clinical_recap_job`; do not infer current/stale or reviewer status from an unspecified list-summary field. Show capture time, selected scope and reviewer decision once the detailed envelope is available. Separate actual generating operator from actual reviewer. Resolve authorized staff names when available, retaining ID fallback without inventing a doctor/signature.

ADMIN policy form has consent and retention text, immutable current version and an independent “I reviewed this exact recap policy” checkbox. Clear that attestation whenever its base policy version refreshes or text changes. Policy approval is a deliberate separate action; note/audio policy approval and recap review checkboxes must not transfer approval state. Defaults remain draft/OFF. Current non-ADMIN staff may recover/cancel their own earlier policy action after demotion without being offered a new policy write.

### 2. Choose sources

Controls: **Visit date from**, **Visit date through**, **Signed encounters**, and **Include eligible native problem-list records**. Use Denver calendar dates. List each signed encounter's actual visit/signature time and complete addendum count; selection is encounter IDs, not a body supplied by the browser. Problem evidence is the entire eligible group, including active/resolved, with outside-linked exclusions counted separately. No per-problem picking or unsigned-record option in v1.

Keep selected IDs across discovery pages, canonicalize before preview, prevent duplicates and enforce the 20-encounter client limit. Discovery `has_more` means more candidates, not incomplete inclusion of selected parents' addenda. Changing date range invalidates the preview and requires the clinician to reconcile selected IDs outside the new range; never silently drop selected records or send hidden out-of-range IDs. Show no-data, read failure/retry and ineligible source states explicitly.

Selection changes are local dirty state. Do not reserve on selection, route load or date filtering. A source set must include at least one eligible source; problems-only is permitted when the group is nonempty.

### 3. Preview and capture

**Preview selected sources** calls `preview_clinical_recap`. Display exact server counts against limits: encounters 20, problems 40, total source units 64, clinical UTF-16 characters 60,000 and canonical UTF-8 bytes 240,000. Display source families excluded, outside-linked problem count and the fact that the visit range does not exclude later addenda or date-filter problem-list onset.

Render the preview's patient identity/version, signed SOAP fields, every included addendum with its own authored date and native problem status/onset as recorded. Missing onset is “Not recorded”; an addendum has no invented independent version/signature. Medication/vaccine coverage is narrative-only and cannot establish completeness or current status. A preview timestamp is local display context, not part of the source fingerprint or an approval token.

Over-budget or empty preview disables capture, explains what must be deselected, retains the selection and does not clip content or silently omit an addendum. A single oversized encounter needs a clear unsupported-in-this-increment explanation. Do not approximate server byte/hash budgets from browser JSON.

Capture collects **Source and permission** (server-retained <=1,000 characters) plus a patient/source authorization attestation. **Capture selected records** submits the exact preview fingerprint, patient version and current policy version. No provider call occurs. On capture conflict retain local selection/note, mark preview invalid and require a new explicit preview; do not automatically recapture or merge changed sources. When capture succeeds, display immutable manifest capture time/hash/fingerprint separately from current-source status.

### 4. Explicit generation and recovery

From a captured job, show a read-only manifest and all attempt history. Only the job's original operator may generate/retry; another authorized staff member can read/review. The user must explicitly authorize sending the selected sources to OpenAI and possible charges before the first call. Initial wire intent remains `retry_of:null`, `reason:''`, `ack_cost:false`; the local checkbox is still mandatory. A retry chooses one fixed nonclinical reason and explicitly acknowledges possible additional charges; it names the latest attempt and sends `ack_cost:true`.

Use exact attempt IDs and no automatic provider retry/poll-triggered dispatch. Read/recover may refresh state; it cannot create a provider request. Missing/invalid required attempt timing is unresolved, not permission to start a new attempt. Claimed/sending/uncertain outcomes must be rendered distinctly; server lease/cooldown checks remain authoritative. A late or stale source change blocks a new dispatch. Source changes during processing produce historical stale evidence if retained, never an automatic new generation.

### 5. Source-cited review

Each claim card shows category, historical/as-of-capture/uncertain label, original model wording, explanation of uncertainty and all 1–4 citations. Dates, source kind/version/hash, author/signer and quote paths come from the pinned manifest. “Recorded status as of capture” does not become a current confirmed problem. Contradictions remain separate and unresolved. Review flags describe attention needs; they cannot assert undocumented clinical facts.

Checkboxes choose existing claim IDs. Optional edited wording is separate from proposed wording, with the original always available. **Retain selected claims as reviewed recap** requires at least one selected claim plus an explicit review attestation; preview the exact retained claim list and wording before submission. No new claim/source can be added here. **Reject recap** requires a reason and empty accepted claims. Acceptance/rejection changes only internal recap review persistence. Use “Reviewed recap”, not “Signed record”, “SOAP note” or “sent records”.

After a conflict preserve local claim choices, edits and review note in memory. Refresh current status/output metadata without replacing those edits. Do not auto-select new output or silently reset expected review/output versions. A committed terminal review is immutable and attributed to the actual reviewer; later correction starts a new linked job and fresh selection/capture. The original remains available.

### 6. Citations and stale historical snapshots

Opening a citation calls `read_clinical_recap_citation` under the current session every time; a cached excerpt alone is not renewed authority. Open the frozen source projection and highlight the exact cited substring within the whitelisted field. Never inject HTML from source/model strings. With repeated identical excerpts, identify the field and show all exact matching occurrences or explain that the citation does not carry an occurrence offset; do not invent one.

Label **Captured source** separately from **Open current record**. The latter uses existing patient Medical navigation and must not replace the displayed frozen text. Current problem rows can differ from captured versions, because native problems do not have a generic historical-version table. Addenda keep their own IDs/date/author and are not promoted into original visit examination findings.

Current status comes from the detailed server envelope: current, stale or unavailable, with fixed reason labels. Stale/unavailable output remains clearly historical when authorized, acceptance disabled. Allow rejection or receipt recovery to close stale work. **Start a fresh recap** explicitly creates a linked job with a fresh source preview; do not mutate the old manifest/review or silently carry edited claims forward. No covert copying into typed-note generation, SOAP, problems, exports, certificates, messages or outbox.

## Lost-acknowledgement transitions

Reuse Phase 1 protocol concepts, not its source/proposal schemas. Store only actor/patient/job/attempt/action/output identifiers, pinned hashes/versions and fixed processing intent choices in browser recovery metadata. Never store preview source bodies, permission notes, edited claim text or review notes in local/session storage. Same-tab exact retries may reuse the immutable in-memory request; after reload recover or durably cancel before editing.

| Operation / observed state | Required UI transition |
| --- | --- |
| Preview read pending/failure | Keep selection; retry read-only preview. No job or persistent intent needed. |
| Reservation sent, acknowledgement lost | Persist job ID before send, freeze capture controls. Read that job; if present verify actor/patient/manifest and adopt. If absent/unconfirmed, offer durable reservation cancellation. Never create a replacement ID until cancellation is confirmed. |
| Reservation canceled before original commits | Clear pending metadata only after tombstone receipt. Retain same-tab source choices/note for editing, without persisting their text. A late original request must fail server-side. |
| Reservation already committed when cancellation arrives | Adopt immutable job; no deletion. Clear resolved local capture fields/attestations and show saved scope. |
| Generation request denied before claim, or attempt admission acknowledgement lost | Read original job/attempt. Offer **Cancel undispatched recap attempt** using the exact stored intent; missing-attempt cancellation creates a tombstone, preventing a delayed original claim. Do not blindly clear a 403/503. |
| Original attempt claimed but not dispatched | Durable cancellation may safely terminate it. A matching cancellation receipt permits a deliberate new attempt; server decides retry ancestry. |
| Original attempt sending / response uncertain | Retain original identity; recover state and show possible charge. Cancellation cannot erase a possibly sent request. New retry is explicit and subject to authoritative cooldown/lease rules. |
| Provider completed, result-persistence acknowledgement lost | Read immutable output. UI never regenerates as recovery; handler may replay only its exact received result. Clear all resolved temporary authorization/retry state so review is not blocked by a hidden dirty checkbox. |
| Review sent, acknowledgement lost in same tab | Freeze editors and keep exact request in memory. Recover by actor/action/job; receipt wins. Exact retry uses the same action/request only. |
| Reload during unconfirmed review | Persist action/job/output/hash metadata, no review text. Recover bound receipt. If absent, durably cancel the old review action before opening a new editable review. Explain that unsubmitted local edits were not stored. |
| Competing review / stale sources / policy change | Preserve local edits, display conflict and latest state. A committed terminal review is displayed as history; do not overwrite it with local changes. Acceptance remains blocked if stale/unavailable/unapproved. |
| Policy action acknowledgement lost | Owner recovery or cancellation remains accessible after role change; policy edit controls still require ADMIN. Do not store free-text policy/review content in recovery metadata. |

Use a synchronous per-action lock as well as rendered busy flags to prevent double-click races. Pending attempts/reviews participate in parent dirty/busy guards and survive same-record tab switches. Failed reads must not discard pending state. Every successful terminal recovery must clear the pending marker **and** transient authorization/retry fields. Discard/navigation confirmation is not equivalent to durable cancellation of a request already sent.

## 390px and accessibility requirements

Use the hub's semantic brand tokens, `font-display` heading and existing shadcn controls. Single-column cards at 390px, optional source/review columns at `md:`; no large fixed-width table or side-by-side forced citation layout. Every card/content parent needs `min-w-0`; wrap UUIDs/hashes and source text. Native select options must not determine page width. Controls use visible labels and at least 44px touch height; wrapped action labels remain usable.

Prefer an in-section citation reader on mobile; a dialog/sheet is acceptable only with correct focus trap, title/description, close control and return focus to the exact originating citation. Source content uses bounded internal scroll with readable wrapping. Do not rely on color alone for stale, missing, unresolved or reviewer states. `role=status` announces operation progress, while specific actionable failures use `role=alert`; avoid duplicate status messages for the same operation.

Proposed stable regions/selectors for planned browser coverage: **Records recap**, **Recap source selection**, **Selected source preview**, **Captured recap sources**, **Recap attempt history**, **Recap claim review**, **Captured citation source**, **Unconfirmed recap action**, **Recap processing policy**. Scope repeated citation/selection controls to their claim/source card rather than creating globally ambiguous “Accept” buttons.

## Recommended exact API projections for contract integration

These are concrete recommended design decisions for the DB/shared-contract owner to integrate into `recap-contract.md`; this map does not itself amend that owned contract or claim implemented endpoints. All keys below are required; explicitly nullable values use `|null`. Objects reject unknown keys. Reuse the contract's canonical UUID/date/timestamp/hash/string rules and exact `Policy`, `Job`, `Manifest`, `Source`, `Selection`, `budgets`, `Claim`, `Output` and `Review` definitions unless narrowed below. Browser recovery persists identifiers/hashes/versions/fixed intents only, never returned content-bearing objects.

### 1. Policy read and IDs-only action recovery

- `read_clinical_recap_policy(p_actor_id:UUID)` → `{actor_id:UUID, policy:Policy}`. Current active staff/live session may read, including before any job exists. Source discovery/preview and policy display remain available while policy status is draft; reserve/admission/dispatch/accept retain their separate approval requirements.
- `save_clinical_recap_policy(p_actor_id:UUID,p_id:UUID,p_request:PolicyRequest)` → `PolicyReceipt`. `PolicyRequest` remains `{expected_version:positive_integer,status:'draft'|'approved',consent_text:nonblank<=4000,retention_text:nonblank<=2000,attest_reviewed:boolean}`; approving requires literal true. Same action UUID plus same request recovers the committed receipt; changed intent rejects. New policy writes require current ADMIN after waits.
- `PolicyReceipt = {id:UUID,actor_id:UUID,request_hash:SHA256,policy:Policy}`. Receipt ID is the policy action ID, actor is the actual writer, and its `policy` is the immutable version created by that action, not the latest policy. Appending successfully from expected version N creates N+1. `request_hash` is an opaque server-canonical exact-request hash.
- `recover_clinical_recap_policy(p_actor_id:UUID,p_id:UUID)` → `PolicyReceipt|null`; `cancel_clinical_recap_policy(p_actor_id:UUID,p_id:UUID)` → `{cancelled:true,receipt:null}|{cancelled:false,receipt:PolicyReceipt}`. Both require actual current active staff/live session and action ownership, but not current ADMIN or still-approved policy. Cancellation durably tombstones an absent action; an already committed action returns its original receipt. No free-text request is needed after reload.
- Recovery metadata: actor/action ID plus expected policy version only. Verify returned receipt ID/actor and created version; in the same tab compare policy contents against the original in-memory request. Do not pretend the browser independently reproduced PostgreSQL's request hash or persist the receipt/policy text.

### 2. Job history summary and deterministic ordering

`list_clinical_recaps(p_actor_id:UUID,p_pet_id:UUID,p_after:{created_at:timestamp,id:UUID}|null)` → `{actor_id:UUID,pet_id:UUID,items:JobSummary[0..20],has_more:boolean,next:{created_at:timestamp,id:UUID}|null}`. Rows order `created_at DESC,id DESC`; cursor advances strictly below both values lexicographically. `next` is the last returned row only when `has_more=true`; otherwise null. Selection persists across pages. Source discovery uses its separately defined `visit_at DESC,id DESC` keyset with the same null/has-more rule.

`JobSummary = {id:UUID,actor_id:UUID,pet_id:UUID,policy_version:positive_integer,manifest_id:UUID,manifest_sha256:SHA256,created_at:timestamp,captured_at:timestamp,previous_job_id:UUID|null,selection:Selection,budgets:budgets,output_id:UUID|null,review_version:1|2,review_decision:'accepted'|'rejected'|null,reviewer_id:UUID|null,reviewed_at:timestamp|null,latest_attempt:{id:UUID,state:Attempt.state,created_at:timestamp}|null}`.

All review summary fields are null together before terminal review; review version is then 1, otherwise 2. No source bodies, source note, accepted wording, contacts or source-currentness claims belong in this summary. Detailed current status is read when opening the job, avoiding a stale “current” badge inferred from a history list.

`Job.attempts` is authoritative newest-first, maximum six, with latest at index 0. Newness follows the serialized retry chain: each retry names the previous latest attempt, so the leaf precedes its parent. Use ancestry rank first, with `created_at DESC,id DESC` only as deterministic secondary order; timestamp ties cannot make an ancestor become latest. Do not reorder attempts in the client. `latest_attempt` equals the first detailed attempt's ID/state/time when present.

### 3. Citation envelope and current-workspace links

`read_clinical_recap_citation(p_actor_id:UUID,p_job_id:UUID,p_source_ref:/^src_[0-9]{4}$/)` → `{actor_id:UUID,pet_id:UUID,job_id:UUID,manifest_id:UUID,manifest_sha256:SHA256,source_ref:string,source:Source,current:Current}`.

The reference must be one of this manifest's actual `src_0001`..`src_0064` entries, not merely match the pattern. `source.ref` matches the request and `source.pet_id` matches the job patient; source hash/ID/version/content and field projection are exactly frozen. `Current` below refers to the complete selected manifest, not a claim that each individual source changed. Authority failure returns a sanitized denial with no frozen content. A retained source that is now unavailable may still return historical content only when current staff/retention authority explicitly permits reading that manifest.

No HTML, external URL or generated date/author fields are returned. Compute a separate local **Open current clinical workspace** link with `patientHref(pet_id,'medical','soap')` for all three v1 source kinds. For addenda retain `source.metadata.encounter_id` as evidence, without claiming the link focuses that row. The existing SOAP section contains both encounters and native problems. Exact-row focus is intentionally outside this increment, not an unresolved dependency. Frozen source content never changes after following that link.

### 4. Proposed versus reviewed claims and bound receipts

Pin accepted review item shape to `{claim_id:Claim.claim_id,category:Claim.category,temporal_status:Claim.temporal_status,uncertainty:Claim.uncertainty,citations:Citation[1..4],proposed_text:nonblank<=500,reviewed_text:nonblank<=500}`. Every value except `reviewed_text` is copied from the original validated claim; `proposed_text` is exactly original `Claim.text`. Retain accepted items in original output claim order, regardless of checkbox click/request order. No unselected claim, invented citation or change of category/temporal status/uncertainty is allowed. Rejection retains `accepted_claims:[]`.

The save request remains `accepted_claims:[{claim_id,text:nonblank<=500}]`, with 1..48 unique IDs for acceptance and zero for rejection. `text` maps only to `reviewed_text`. Review note remains <=2,000; nonblank is required for rejection. `expected_output_hash` and `Review.output_sha256` both mean exact `Output.payload_sha256`; `manifest_sha256` binds exact `Manifest.sha256`.

`save_clinical_recap_review(p_actor_id:UUID,p_id:UUID,p_request:ReviewRequest)` → `Receipt`, using existing `{id,actor_id,job_id,request_hash,review}`. `recover_clinical_recap_review(p_actor_id:UUID,p_id:UUID,p_job_id:UUID)` → `Receipt|null`; `cancel_clinical_recap_review` with those same three IDs → `{cancelled:true,receipt:null}|{cancelled:false,receipt:Receipt}`. A stale-source rejection can still terminally close the output under current review authority. A committed receipt cannot be canceled or replaced.

Verify actor/action/job IDs, review ID/job/output/manifest/payload hash and terminal review version against pending metadata. Same-tab exact-request recovery additionally compares decision, review note and each selected ID/reviewed wording to the retained in-memory request. After reload, IDs/hashes bind the receipt; the UI must not assert it retained or reconstructed discarded local wording. The opaque request hash is validated as a hash, not regenerated from browser JSON.

### 5. Complete source reasons and safe refusal projection

`Reason = 'patient_changed'|'encounters_changed'|'addenda_changed'|'problems_changed'|'problem_eligibility_changed'|'source_unavailable'`. `Current = {source_status:'current'|'stale'|'unavailable',reasons:Reason[0..6]}`. Reasons are unique and use the enum order above. Current means `reasons:[]`; stale requires at least one changed reason; unavailable includes `source_unavailable` and may also list changed reasons. `problem_eligibility_changed` covers outside-source links changing eligibility; policy state is not a source-change reason. All labels are local fixed copy, not raw SQL/provider text.

Normalize UI-safe refusals to strict `{code:RefusalCode,source_reasons:Reason[0..6],budget_violations:BudgetViolation[0..5],retry_after_seconds:integer(0..86400)|null}`.

`RefusalCode = 'invalid_request'|'authentication_required'|'forbidden'|'not_found'|'operation_unavailable'|'policy_unapproved'|'policy_changed'|'source_changed'|'source_unavailable'|'empty_selection'|'budget_exceeded'|'identity_conflict'|'intent_conflict'|'action_cancelled'|'review_conflict'|'attempt_active'|'retry_not_allowed'|'processing_disabled'|'rate_limited'|'provider_rejected'|'provider_unavailable'|'provider_uncertain'|'invalid_provider_output'`.

`BudgetViolation = {dimension:'encounters'|'problems'|'source_units'|'source_characters'|'source_bytes',observed:nonnegative_integer,limit:positive_integer}`. Exact dimension limits are 20/40/64/60000/240000 respectively. Violations are unique per dimension, use that order and report only `observed>limit`; `budget_exceeded` requires 1..5 violations. Other refusal codes use `budget_violations:[]`. Source-change/unavailable codes carry fixed source reasons; other codes use an empty reasons array. A retry delay, when applicable, is numeric; never derive one from free-text errors. Numeric budgets contain no source body or excerpts.

For PostgREST SQL errors, place this exact JSON in the `details` string and parse it strictly in the API wrapper; ordinary `message`, `hint` and unknown details never become clinical UI copy. Use PT422 for invalid/empty/budget, PT409 for identity/intent/cancellation/review/source/policy-version/attempt conflicts, PT403 for forbidden/unapproved policy, and PT404 for authorized not-found. Edge returns `{error:Refusal}` with matching HTTP status (401/403/404/409/422/429/503, 502 for known provider rejection/invalid output, 504 for uncertain timeout). Runtime processing disabled returns 503 with `processing_disabled`. Unknown/nonconforming failures normalize to `operation_unavailable` with empty arrays/null delay. Existing immutable `Attempt.failure_details` still retains its separately whitelisted bounded provider metadata; the UI never renders raw provider bodies.

### 6. Reserve result and identity verification

`reserve_clinical_recap(p_actor_id:UUID,p_id:UUID,p_request:ReserveRequest)` returns the same complete `JobRead = {actor_id,job,manifest,policy,current,output,review}` envelope as `read_clinical_recap_job`. For a newly reserved job, `job.id=p_id`, `job.actor_id=actor_id=p_actor_id`, output/review are null, attempts empty, review version 1 and `current.source_status='current'`. Same-intent recovery may return the later immutable output/review/current status of that original job, never a replacement job. `policy` is the current policy at read time; `job.policy_version` pins the captured approval version, and mismatches block new processing/acceptance. Original approval identity remains recoverable in private audit; do not relabel the job's policy version from the current projection.

Check patient ID and captured patient version against request, exact manifest ID/hash agreement across envelope/job/output/review, manifest's source fingerprint against the requested preview fingerprint, canonical selection equality, previous job ID and source note against the in-memory request. Server verifies canonical hashes; JavaScript treats PostgreSQL fingerprints as opaque. On reload verify persisted IDs/versions/hashes and actual current session actor; do not recreate source notes from storage. A changed-current-source recovery returns stale status on the original frozen manifest rather than rejecting access to an otherwise authorized history.

`cancel_clinical_recap_reservation(p_actor_id:UUID,p_id:UUID)` retains existing exact `{cancelled:true,job:null}|{cancelled:false,job:Job}`. `cancel_clinical_recap_attempt(p_actor_id:UUID,p_id:UUID,p_job_id:UUID,p_retry_of:UUID|null,p_reason:''|RetryReason,p_ack_cost:boolean)` → `{cancelled:boolean,job:Job}`; job is nonnull, actual-owner-only, with exact intent matching. A canceled absent intent is tombstoned; a canceled claimed attempt becomes known failed before dispatch. Sending/completed work is never erased. Read the full `JobRead` after cancellation for policy/manifest/current/output/review rather than treating the cancellation summary as a complete source read.

## Planned verification only

| Planned check | Intended observation |
| --- | --- |
| Patient route and 390px/desktop browser pass | New section deep link focuses the visible recap region; source/claim/citation cards wrap without horizontal page overflow. Same-record tab switches retain local edits; leaving the patient invokes one shared guard. |
| Source discovery / preview | Signed-only selection across pages, complete later addenda, problems-only group, imported-linked exclusions, Denver date range and refusal of empty/oversized sets. Preview triggers zero provider calls and writes. |
| Approval separation | Draft recap policy permits authorized read/preview, blocks capture/generation as specified; note/audio approval never activates recap. Policy/review attestations do not transfer between versions or actions. |
| Historical status / evidence | Archived/deceased patient history stays eligible. Each claim opens exactly its frozen source; changed current rows never substitute for it. All citations, unknown onset, contradictions and missing coverage remain correctly labeled. |
| Reservation and attempt recovery | Lost response + reload, cancellation racing a late original reserve/claim, pre-claim denial, dispatch uncertainty and terminal recovery. Browser storage contains metadata/fixed codes only; no source or free-text notes. |
| Review recovery / concurrency | Competing reviews, source mutation before accept, reviewer/session revocation and lost accepted/rejected receipt. Local edits survive same-tab conflict, reload recovery uses receipt or durable cancellation, and resolved attempts release all dirty-state guards. |
| Native write isolation | Capture/generation/review leave canonical encounters, addenda, problems, signatures, clinical proposals, exports and outbox unchanged. No hidden use of Phase 1 SOAP acceptance or release-publication RPCs. |
| Source synchronization / restore / model fidelity | Separate database race/epoch/lock and populated restore proof; separate bounded synthetic provider evaluation. UI mock success alone proves neither concurrency correctness nor clinical fidelity. |
