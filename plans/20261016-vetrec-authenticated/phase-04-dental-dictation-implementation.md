# Phase 4: source-cited dental dictation proposals

Status: implementation-ready design from read-only native-code inspection on 2026-10-16. No dental implementation, clinical-rule change, vendor/account request or paid model call performed here. This file is outside the active call-source proof inputs.

Read with [parent plan](plan.md), [Phase 4 scope](phase-03-05-calls-dental-and-parity.md), [source/template work](phase-01-templates-and-text.md), and [authenticated workflow evidence](research/authenticated-workflows.md). VetRec's inspected dental preview does not establish voice-to-tooth accuracy; no vendor defaults or normal findings are copied.

## Outcome and smallest useful increment

An authorized clinician/staff operator selects an existing saved patient and unsigned dental chart, supplies typed dental observations or explicitly selects an eligible completed clinician dictation transcript, and receives source-cited proposed changes. The reviewer sees each affected tooth/field against the exact saved baseline, accepts selected changes, and updates only the intended unsigned chart through its native save RPC. Recording, source text, generated findings, reviewer edits, accepted chart version and later signature remain separate.

Delivery:

1. **4A — typed dental proposals and reviewed diff.** Pin an existing unsigned supported dog/cat chart; capture authorized typed source immutably; parse into a bounded tooth-operation proposal; review and accept selected changes with terminal recovery. No new audio subsystem or signed-chart mutation.
2. **4B — completed dictation source adapter.** Reuse already completed native clinician-audio transcription through an explicit source-to-chart mapping, preserving recording policy/session/hash provenance. Do not route recordings through call-source tables or paste a transcript while labeling it native audio.
3. **Separate follow-up:** recording directly from the dental panel, manual/nonstandard/mixed dentition automation, and generated signed-record addendum drafts require their own explicit contracts. The existing manual chart/addendum path continues to serve these cases. No automated procedure completion or signing.

Real generation remains off until Susan approves the dental source-processing scope, clinical template/presentation and any relevant recording/retention policy. Synthetic provider evaluation is separate from approval. Use OpenAI as selected by Dave.

## Existing native destination and RPC contracts

`supabase/migrations/20260913070000_dental_chart.sql` defines the core schema. The current `save_dental_chart` and `sign_dental_chart` bodies are later replaced in `20260928190000_no_retryable_sqlstate_for_permanent_conditions.sql` (permanent version conflicts now use `PT409`). Inspect the latest definitions, not just the original migration.

| Native object/path | Current contract | Reuse / boundary |
| --- | --- | --- |
| `dental_charts` | Stable UUID; patient ID; saved `species_family` dog/cat/manual; explicit dentition adult/deciduous/manual; visit instant, notes, JSON teeth; draft/signed state and positive version | No `encounter_id`, appointment link, source transcript or AI proposal identity exists |
| Tooth row | `presence`, `findings`, `planned`, `performed`, `measurements` | Keep independent fields; presence does not itself establish a performed procedure |
| Presence | `not_recorded`, `present`, `missing`, `extracted` | Present is not healthy/normal; unmentioned teeth remain unchanged/absent, never initialized as normal |
| Narratives | Findings/planned/performed strings, each at most 5,000 database characters | Preserve source timing, negation and planned/performed distinctions; no clinical staging calculation |
| Measurements | Array at most 12 per tooth; each `{label, value_mm}`; nonblank site/description at most 120 characters; positive numeric millimeters | Existing format is a raw observation. It has no measurement ID, time, confidence, procedure link or inferred periodontal stage |
| `dental_chart_revisions` | After-insert/update snapshot of chart version, visit, notes, teeth, status and actor; unique chart/version | Reuse exactly one accepted revision per terminal action; don't create a competing dental record |
| `save_dental_chart(id, pet, expected_version, dentition, visit_at, notes, teeth)` | Stable ID; active/nondeceased saved patient; chart advisory lock `(id,5)`; pet SHARE and chart UPDATE locks; draft-only; saved dentition cannot change; full-chart optimistic update | Review wrapper must supply a server-merged full chart from the exact pinned baseline, not arbitrary client replacement |
| Save recovery | Exact repeated create/update can return the prior result when actor/input/version match | Add a durable proposal-review receipt; field equality alone must not stand in for review-action identity |
| `sign_dental_chart(id, pet, expected_version)` | Matching patient/version, nonblank observations or notes, explicit draft-to-signed transition, increments version; exact repeated signature recovers | Acceptance never calls this function automatically. Keep explicit review/sign UI separate |
| `add_dental_addendum(id, chart, pet, content)` | Matching signed patient chart; stable action UUID and exact actor/content replay; bounded append-only narrative | Signed chart stays unchanged. Initial AI increment refuses signed destinations; future addendum drafts must be reviewed before this explicit append path |
| Dental SELECT | Active staff can read charts/revisions/addenda under RLS; direct writes revoked | New proposal source access must be deliberate; do not introduce ADMIN-only call transcripts into broadly readable dental history |
| Signed record release | Existing release source `dental`, signed-only selected chart snapshot and addenda; `record-release-charts.ts` renders tooth fields/measurements | Reuse after independent signature/release review. Draft acceptance is not a release or email; existing HTML/release rendering is not proof of a new dental PDF export |

`PatientDentalChart.tsx` already provides explicit dentition, quadrant/tooth selection, per-field editing, visit time in Denver, save/sign/addenda, author/revision display, dirty navigation guards and idempotent stable create/addendum IDs. `PatientPage.tsx` mounts this in Medical/dental and tracks `dentalDirty` against other workflows.

## Tooth identity, species and dentition

Reuse the existing allowlists in SQL `dental_tooth_numbers` and TypeScript `toothQuadrants`. Do not ask a model to invent, complete or correct the allowlist.

Current implemented sets (code behavior, not newly independently validated medical definitions):

| Family/dentition | Upper suffixes | Lower suffixes | Implemented total |
| --- | --- | --- | --- |
| Dog adult | 01–10 | 01–11 | 42 |
| Cat adult | 01,02,03,04,06,07,08,09 | 01,02,03,04,07,08,09 | 30 |
| Dog deciduous | 01,02,03,04,06,07,08 | 01,02,03,04,06,07,08 | 28 |
| Cat deciduous | 01,02,03,04,06,07,08 | 01,02,03,04,07,08 | 26 |

SQL uses adult quadrant bases 100/200/300/400 and deciduous 500/600/700/800. UI intentionally displays quadrants as patient-right maxillary, patient-left maxillary, patient-right mandibular, patient-left mandibular, using adult bases 100/200/400/300 and deciduous 500/600/800/700. This is a display ordering difference; ID-set parity must compare sets rather than flattening display order.

`dentalSpecies` maps trimmed dog/canine and cat/feline to native families; other species use manual mode. Saved chart family/dentition are authoritative; current patient free-text species is additional identity context, not permission to mutate the saved template. Pin both saved chart family/dentition and current patient version/species. If they disagree or change, stop for review rather than silently change quadrants. Explicit manual dentition has no automatic tooth allowlist, even for dog/cat. Mixed dentition is not a supported existing enum; do not approximate it as adult/deciduous or overwrite the chart template.

Tests already assert counts, deliberate gaps and some quadrant orientation, but those are regression tests of code. Before real activation, retain a current authoritative tooth-number reference and Susan's verification of these definitions. This investigation did not establish fresh authoritative clinical validation or new procedure/periodontal rules.

## Sources and explicit chart mapping

**Typed:** store the actual clinician input and source note/attestation immutably with source hash, actual actor/session and selected chart snapshot. Client must not supply a fake native audio/call identity. Retain edited observations as a new source/version, not an overwrite of generation evidence.

**Existing clinician audio:** `clinical_audio_jobs` are pinned to patient, SOAP `encounter_id`, expected encounter version, originating session, recording policy and immutable completed transcript. Dental charts have no SOAP encounter link. The adapter must explicitly select both chart and source recording, verify same saved patient and intended clinical context, and retain that mapping. No source choice by matching visit dates, phone number, pet name, appointment proximity or chart selection alone.

Only a server-resolved completed transcription from its actual job identity is authoritative audio evidence. Pin transcript hash, source audio policy/model/vocabulary receipts and original actor/session. Revalidate recording authority and the actual source job before generation and acceptance. If current native audio access/version rules cannot support this destination without changing the SOAP encounter, design a separate reviewed source bridge instead of weakening those guards or updating a SOAP version artificially.

Existing audio limits are 16 kHz canonical WAV, 1–600 seconds, bounded original byte/sample hash and recording policy; raw server audio retention is `not_stored`. Reuse established transport/transcription behavior and real-device limitations. Do not promise ambient diarization, unlimited duration, replayable raw audio or tooth accuracy from those structural guarantees.

Do not allow CloudTalk transcript sources in the first dental adapter. Their ADMIN-only authority and multi-pet/speaker context would require inherited access restrictions throughout the dental lane; ordinary staff dental reads cannot become a bypass.

## Proposal shape and evidence semantics

Create a dedicated dental model/validator. Existing note templates only target subjective/objective/assessment/plan and cannot validate a tooth patch. Reuse provider transport, one-shot attempt/recovery patterns and veterinary vocabulary receipts, not the SOAP output schema or SOAP acceptance RPC.

Proposed source manifest pins patient/client linkage and patient version, chart ID/version/family/dentition/visit instant, exact baseline teeth/notes hash, source kind/ID/hash/version, source-to-chart mapping, actual actor/session, policy/model/prompt/output-contract/vocabulary versions and exact permitted tooth IDs. The model gets no unrelated patient records, household contacts or balance. Current chart values are baseline context, not source evidence of newly dictated findings or permission to copy all existing findings into new proposals.

Proposed output is a bounded list of uniquely identified operations, each containing:

- Target tooth ID from the pinned allowlist; an unresolved identifier cannot carry an automatically applicable patch.
- Destination `presence`, `findings`, `planned`, `performed` or `measurement`, with narrowly typed value; no arbitrary JSON path, chart ID or SQL operation from the model.
- Supported/uncertain status, explicit nonempty ambiguity reason when uncertain, and source-supported historical/planned/performed context where relevant. No assumed “today” from generation time.
- One or more literal exact source spans with original UTF-16 offsets and quotes (and native source segment identity if actually available). Each operation's own citations must support tooth, value, unit/site, negation, correction and procedure timing. A quote on another operation cannot repair missing support.
- A before-value reference from the pinned chart, computed/validated server-side; generated before-values are not trusted. Untouched fields/teeth remain unchanged.

Enforce strict Zod and matching SQL bounds, exact keys, unique operation IDs, literal contiguous source-span membership, correct source binding, allowed tooth IDs and destination/value types. A model schema can constrain shape; it cannot prove clinical entailment or identify the intended tooth from ambiguous audio.

The first safe application subset should permit only independently source-supported, unambiguous operations reviewed against the original wording. Ambiguous/contradictory operations stay visible but cannot be accepted automatically by merely selecting a checkbox; the reviewer must explicitly correct the proposed mapping/value with a retained reason and supporting source, or reject it. Never silently select 108 over 208, convert patient-left/right to an unverified tooth, or apply the first number when a later phrase corrects it. If typed/spoken numeric words require lexical normalization, pin an approved conversion grammar/version and retain original wording; do not make ad hoc substitutions.

For measurements, preserve explicit millimeter units and site/description. Missing unit, absent site, ambiguous decimal or unsupported value blocks a structured measurement proposal. Native schema currently rejects zero/nonpositive measurements; this is a storage restriction, not a clinical conclusion that zero is medically invalid. Preserve and visibly flag such source statements; never replace zero with a positive number, infer a scale/site or quietly omit it to make validation pass. No conversion from other units without a separately approved contract. No new diagnosis, periodontal stage, severity, extraction recommendation, billing item or drug event is calculated.

## Review, merge, versioning and signed records

Persist private immutable dental source/proposal/generation records plus terminal review actions/receipts in a new migration. Add a source-processing policy seeded draft and a separate default-off generation gate, while retaining existing recording policy requirements for audio. New source/proposal reads require actual active staff/live session and authorized source scope; configuration approval remains administrator-only. A chart assignment is distinct from actual recording/generation/review actor.

At review, show the selected patient, family/dentition, tooth ID/quadrant, exact source excerpt and before/proposed/reviewed values together. Measurements have no native IDs: use the pinned full baseline array plus explicit proposed insertion/change and a complete resulting array diff. Do not address a moving array index or append again on replay. Narratives need explicit append/replace behavior; never overwrite existing findings or notes just because a generated string is nonempty. Initial operations should not delete preexisting observations implicitly.

The acceptance RPC:

1. Authenticates actual current operator/live session and exact review-action UUID/request; recovers an existing terminal receipt without reapplying edits, subject to current read authority.
2. Acquires locks in an order compatible with native `save_dental_chart` (chart advisory namespace 5, then patient SHARE, then chart UPDATE); define proposal/policy/action mutex ordering before implementation and prove it against native save/sign/addendum behavior.
3. Revalidates exact chart/patient/source/policy/template/vocabulary binding after waits; refuses changed species/dentition/version, signed/inactive patient or revoked source/session. Do not infer authority solely from a retained job ID.
4. Validates selected operations/reviewer changes and builds the full merged teeth JSON from the saved baseline server-side. Preserve unselected teeth, existing notes and visit time. Validate the result through native `dental_validate_data` plus the stricter proposal contract.
5. Calls `save_dental_chart` once under the actual user JWT context, using the expected version and same saved dentition/visit/notes. Recheck originating/review authority before commit. Any failure rolls back chart revision and receipt together.
6. Stores one review receipt linking source/proposal hash, original and reviewed operations, actor, accepted chart version and decision. Rejection requires a reason and creates no chart update. Lost responses recover this exact identity; cancellation tombstones prevent delayed acceptance from reviving.

Do not bypass `save_dental_chart` with a direct UPDATE or call the generic SOAP `save_clinical_dictation_action`. Signing remains a separate explicit action through `sign_dental_chart`. A chart signed during generation/review blocks acceptance. Signed corrections use existing `add_dental_addendum`; a future AI addendum draft must be a separate reviewed append, not a patch to signed teeth or fabricated retrospective procedure. Preserve existing release invalidation locks/triggers on dental addenda.

## Actionable file map

Paths are repository-relative beneath `/Users/davidedler/Developer/lrv-record-recap-20261016/`; implement later in an isolated branch after the active call proof. No files are deleted.

| Action | File/module | Work |
| --- | --- | --- |
| Reuse / narrowly extend | `src/hub/features/dental/tooth-chart.ts` | Existing ID sets, labels and neutral empty tooth; add strict shared projection only with SQL parity |
| Create | `supabase/functions/_shared/clinical-dental-model.ts` | Source, tooth-operation, quote-span, reviewed patch, receipt and budget Zod contracts |
| Create | `supabase/functions/_shared/clinical-dental-handler.ts` | Dental-specific OpenAI request/parser with pinned allowlist and source manifest; reuse bounded one-shot patterns |
| Create | `supabase/functions/clinical-dental-process/{index.ts,deno.json,deno.lock}` | JWT/actual actor boundary, independent off gate and service completion; no direct chart writes by worker |
| Create | `supabase/migrations/<new>_clinical_dental_proposals.sql` | Private immutable sources/jobs/attempts/proposals/reviews/actions, policy, source guards and atomic reviewed native-save wrapper |
| Create | `src/hub/features/dental/dictation/{api.ts,model.ts,DentalDictationDrafts.tsx,DentalProposalDiff.tsx}` | Source capture, exact chart selection, full per-tooth diff, source preview, explicit reviewed acceptance and recovery |
| Modify narrowly | `src/hub/features/dental/PatientDentalChart.tsx` | Mount saved-chart proposal panel; pass exact chart/context, coordinate manual dirty/busy/sign state, adopt returned native version |
| Modify if required | `src/hub/features/patients/PatientPage.tsx` | Keep patient-level dirty/navigation protections; no hidden cross-patient recording state |
| Reuse, not replace | `clinical-audio-{model,handler}.ts`, dictation audio API/recorder | Completed transcript source proof; add explicit dental source bridge only when source authority remains intact |
| Reuse | `_shared/clinical-veterinary-context.ts` | Pinned terminology reference, not tooth/procedure evidence or model fine-tuning |
| Reuse | `supabase/functions/_shared/record-release-charts.ts`, record-release UI/API | Existing signed chart export/release; separate signing/delivery and preserve original addenda |
| Create | `tests/clinical-dental/{model.test.ts,handler.test.ts,local-roundtrip.ts,disposable.py,README.md}` | Synthetic fidelity fixtures, actual local Auth/SQL/HTTP/browser/race/recovery/restore proof |
| Create | `supabase/tests/clinical_dental_proposals.test.sql` | ACL, source/actor/session boundaries, patch validation and native version/revision invariants |
| Extend | `tests/dental/tooth-chart.test.ts`, `supabase/tests/dental_chart.test.sql`, `e2e/dental.spec.ts` | Full allowlist parity, original save/sign/addendum behavior and revised interaction |
| Update as required | CI, edge-isolation verifier and migration-count tripwires | Include new function/test/runtime sources without locally regenerating autogenerated `types.ts` |
| Update after proof | Launch evidence and Phase 4 status | Exact release/head, real versus stubbed model calls, clinical approval and remaining limits |

## Acceptance and release gates

- [ ] Compare every SQL/TypeScript allowed tooth ID for all four supported family/dentition combinations; preserve quadrant display orientation and deliberate gaps. Manual/unsupported/mixed source never gets an invented template.
- [ ] Synthetic source fixtures cover 108 versus 208; corrected tooth number; patient-left/right ambiguity; adult versus deciduous IDs; dog/cat unsupported IDs; missing versus extracted; planned/declined versus performed; historical extraction versus today's care; explicit negation; repeated source phrases and hostile instructions.
- [ ] Measurement fixtures preserve exact decimal, unit/site and attribution; missing units/sites, zero/nonpositive/unsupported values, nonfinite numeric input and repeated arrays fail visibly without invented substitutes or stage calculations.
- [ ] Each retained operation's own source spans support all its tooth/value/time qualifiers; exact quoted membership alone is never called clinical correctness. No empty-source filler, inferred normal teeth or automatic procedures.
- [ ] Actual Auth/RPC tests reject wrong patient/chart/encounter/source identity, changed chart version/species/dentition/policy, invalid/expired session, inactive/deceased patient and unauthorized source reads. Staff/ADMIN boundaries are proven explicitly.
- [ ] Observe real lock waits for manual save/sign versus review, session/source/policy revocation after waits, duplicate acceptance and cancellation. Exactly one native revision/receipt; unselected teeth/fields and source evidence unchanged.
- [ ] Lost reservation/provider/finish/review responses recover exact durable identities. Unknown paid outcomes are recorded, never automatically regenerated. Same text/source with a different action is not silently deduplicated into a false receipt.
- [ ] Real local patient UI at desktop/390px shows tooth IDs/source/proposal/diff, preserves edits on conflicts and guards navigation. Browser storage retains only permitted nonclinical pending IDs, not source/review text. Real phone/audio acceptance remains separate from mobile viewport proof.
- [ ] Original manual save/sign/addenda and signed release rendering continue to pass. No chart signature, billing, medication event, certificate or delivery appears from generation or unreviewed proposals.
- [ ] Populated restore preserves sources, proposed/reviewed changes, exact chart versions/revisions, signatures/addenda and permissions; replay reads retained output without model calls.
- [ ] Required tests, SQL regression, edge isolation, TypeScript/lint/build and CI pass at exact frozen sources. Staging and primary rollout verify migrations/functions/frontend independently after the specific PR merge approval.
- [ ] Under an explicitly bounded run decision, evaluate wholly fictional typed/audio dental sources through the real selected OpenAI request/parser; retain every failure, model/prompt/vocabulary/source hash and full clinical review packet. Do not reuse SOAP/recap success as dental accuracy evidence.
- [ ] Susan or qualified delegate approves tooth definitions, shorthand/normalization, source-fidelity outputs and policy/presentation. Commission generation/audio gates explicitly only after release evidence and approval.

## Outstanding decisions and next step

The first implementable package is 4A typed source-to-tooth proposals for an existing unsigned supported chart. Before coding, settle the bounded operation/edit schema, numeric-word policy, narrative append/replace behavior, measurement array diff and consistent lock order. Existing native restrictions are preserved; extending zero-value/mixed-dentition/clinical-stage semantics requires authoritative reference and clinician approval rather than agent invention. The next voice increment needs the explicit dental-to-audio-source bridge because dental charts have no native SOAP encounter identity.
