# Phase 2: reviewed, source-cited records recap

Priority: after Phase 1. Status: native first increment released in PR268 with verified primary backend/frontend; initial eight-case provider baseline complete with blocking fidelity findings; no recap processing activated. Vendor observation VR-A06 establishes a form, not verified OCR or citation behavior. This is an independent native implementation.

Implementation preparation: [strict source/job/review contract](recap-contract.md), [database race and preservation acceptance matrix](recap-db-acceptance.md), [patient workspace and recovery map](recap-ui-map.md), and [synthetic model-fidelity evaluation](recap-model-evaluation.md). These documents specify the implementation and its acceptance targets. Release evidence must distinguish actual structural/workflow checks from the separately assessed provider fidelity and clinical activation.

Actual completed checks and remaining activation gates: [initial synthetic evaluation](../../docs/launch-evidence/2026-10-16-clinical-recap-synthetic-evaluation.md) and [workflow and hosted release receipt](../../docs/launch-evidence/2026-10-16-clinical-record-recaps.md).

## First increment

Patient → Medical → Recap → choose signed encounters and optional native problem-list evidence → review the exact source set → freeze → explicitly generate → check each dated claim and citation → retain a reviewed internal recap. A recap is a summary of the selected records as of capture, never a complete/current chart, diagnosis, SOAP update, medication order, certificate or signature.

Use existing native clinical data first:

| Source | Actual native contract | Capture and attribution |
| --- | --- | --- |
| `clinical_encounters` | Signed rows have `id`, `pet_id`, `version`, four SOAP fields, visit time, signer/time; signed text is immutable | Signed only; retain exact version, selected column snapshot and SHA256. Visit time is the clinical event time, not the generation date |
| `clinical_addenda` | Append-only `id`, `encounter_id`, `content`, author and creation time; no independent version or signature | Include **all** addenda for each selected encounter, even if added after the visit-date range. Keep each ID/hash and author/time; never relabel an addendum as part of the original signed text |
| `patient_problems` | Mutable versioned title/notes/onset/status/importance; staff-entered, not signed clinical encounters | Optional group of native-authored rows, explicitly reviewed at selection. Preserve active/resolved and high/routine **as recorded at capture**; unknown onset remains unknown. Do not call these medically confirmed diagnoses merely because a row exists |

Schema anchors: [clinical core](../../supabase/migrations/20260912210000_clinical_core.sql), [native queries](../../src/hub/features/clinical/queries.ts), [problem UI/provenance](../../src/hub/features/clinical/PatientProblems.tsx). Problems linked through `ezyvet_problem_extractions` are excluded from this first adapter, including locally edited linked rows; a later adapter must retain their outside-source/discrepancy evidence. Show that exclusion explicitly. Do not start new ezyVet synchronization.

Visit-date range filters encounter discovery only; show included addendum dates separately. Optional problem-list evidence is an as-of-capture group, not a dated encounter within that range. Patient context contains only the saved patient ID/version and needed identity fields; omit client contacts, balances, conversations and unrelated household pets.

Initial hard budgets: source discovery pages of 20; at most 20 signed encounters, 40 native problem rows, 64 source units including addenda/problems, and 60,000 UTF-16 source characters / 240,000 UTF-8 bytes combined. Include complete selected SOAP/addendum content; refuse an over-budget selection before creating a job or contacting OpenAI. Never truncate or split an encounter's addendum group silently. A single oversized encounter is an explicit first-increment limitation. Display selected counts, excluded source families and capture time.

## Snapshot, citations and stale sources

- Server resolves IDs under the actual saved patient and captures one immutable manifest transactionally. Keep ordered source kind/ID, nullable native version, exact selected fields, canonical hash, event/documented dates, author/signature metadata and patient identity snapshot. Model-facing source references map back to this manifest; the model cannot invent source IDs, dates or authority.
- Each supported claim has a bounded text, historical/as-of-capture/uncertain label and one or more citations: source reference, field path and literal contiguous excerpt. Server validates membership, allowable fields, excerpt bounds and claim budgets. Date/author labels render from captured metadata. Quotes establish membership, not medical entailment.
- A citation opens the private **frozen snapshot** and highlights its excerpt, with a separate link to the currently authorized native record. Mutable problems have no general historical-version table; never pretend the current row is the old version. Preserve every original model claim, reviewer edit and supporting excerpt separately.
- Fingerprint encounter/addendum membership and the optional eligible native-problem group, not only encounter versions. New addenda, new/edited problems, patient identity changes, or lost source eligibility mark the affected snapshot stale. Compare exact selected rows/set hashes at reservation, admission, dispatch, completion and review acceptance. Use a transactional per-patient source epoch/lock maintained by native append/update triggers; row locks alone do not prevent new-addendum/new-problem phantoms. Specify consistent writer/reader lock order, read fresh state and recheck authority after waits. A new unselected encounter may show “new records available”; it does not silently enlarge a deliberately selected subset.
- Change before dispatch blocks the paid call. Change during processing retains received output as private stale evidence only while current authority/retention permit, without presenting it as current or allowing acceptance; no automatic regeneration. Changed sources at acceptance return a conflict and preserve review edits. Regeneration explicitly captures a new manifest/job; prior snapshots and reviews remain immutable.
- Historical recaps remain readable to currently authorized staff with visible capture/stale status. Retired or changed sources never erase retained evidence or silently update accepted text. Stale recaps cannot be reused as current clinical context. Revalidate current staff access before opening citations; no public download link is created.

## Review, authority and processing

Create an independent versioned recap-processing policy, seeded draft, and `CLINICAL_RECAP_PROCESSING_ENABLED=false` default. Reuse OpenAI and the approved pinned model, veterinary terminology version/hash and exact prompt/request fingerprint. Audio/note-policy approval does not approve sending an entire record selection to a model; recap approval does not enable audio, typed generation, record delivery or document extraction. ADMIN configures/attests recap policy after clinical approval; current active staff with a live session may select/review, matching existing clinical authority rather than inventing a DVM-only restriction.

Use Phase 1's durable **protocol**, not its SOAP destination/job schema: actual operator and originating live session, immutable source/policy manifest, exact attempt UUID and intent, single dispatch, bounded lease/quota, sanitized errors, explicit retry reason/cost acknowledgement, exact received-result persistence replay, and durable cancellation before an undispatched intent is abandoned. Recheck original job/attempt sessions and policy after blocking locks. Browser recovery stores IDs and fixed nonclinical intent choices only; no source text or free-text clinical review notes. No provider request on navigation, source preview or citation opening.

Fixed output categories: dated history; recorded problem-list status; historical medication/vaccine mentions **only when selected narrative supplies them**; contradictions and unknowns. Proposed limits: 48 claims, four citations per claim, 500 characters/claim, 1,000/excerpt, 10 review flags, 8,000 output tokens and 60-second provider timeout. No recommendations, inferred normal findings, reconciled doses, inferred administrations/due dates or resolved contradictions. No mention in the selected sources means unknown, not absent disease or treatment.

Explicit review accepts selected, optionally edited claims into a private immutable **reviewed recap**, or rejects with a reason. Acceptance checks current manifest/policy, expected recap review version, reviewer/session and source availability atomically; one terminal decision per proposal, exact-action recovery after lost responses. It does not call `save_clinical_dictation_action`, alter any encounter/problem, sign a record, enqueue messages or create shareable documents. Later corrections require a new recap/review linked to its predecessor.

Future use as note-generation background needs a separate explicit `reviewed_recap` source adapter, current-snapshot checks, original citations and processing-policy scope. Do not paste recap text invisibly into Phase 1's typed/audio source or automatically include it in every visit.

## Delivery and verification

1. Add private recap policy/manifest/source/job/attempt/output/review/action persistence and narrow RPCs in one new migration. No direct authenticated/service table grants; worker-only dispatch/finish/fail, staff-owned exact-intent writes, read-only authorized historical views. Use source/policy locks and post-wait session checks. Publish a strict shared contract before UI/SQL implementation.
2. Add `supabase/functions/_shared/clinical-recap-{model,handler}.ts`, `clinical-recap-process` with function-local Deno config/lock, and a read-only native-source adapter. Reuse shared request/fidelity utilities where compatible; preserve old audio/note/proposal readers.
3. Add `src/hub/features/clinical/recap/{model,api,PatientRecap}.ts[x]` and patient Medical wiring: source selection/budget preview, citation snapshots, missing/excluded evidence, stale banner, explicit review and recovery. Preserve clinical dirty/busy navigation guards at desktop and 390px.
4. Verify source-set membership races (especially added addenda and edited/current problems), wrong-patient/operator/session, revoked approval while waiting, signed-only selection, import-linked exclusions, current-versus-historical attribution, unknown onset, declined treatments, contradictory doses, prompt injection and every output citation. Test over-budget refusal without partial capture/provider calls.
5. Real local Auth/HTTP/browser tests must cover lost reservation/dispatch/result/review responses, cancellation versus late claim, competing reviews, stale review edits retained, and zero SOAP/problem/outbox/signature changes. Add populated restore coverage, isolated frozen Edge checks, required CI, staging and exact-head review; obtain specific PR merge approval before primary migration → Edge → frontend rollout. Real synthetic OpenAI evaluation remains separately bounded and is not clinical accuracy validation.

Source-ID/version/hash patterns in [release selection](../../src/hub/features/record-releases/selection.ts) are useful references. Do **not** call release publication/preparation RPCs, inherit client-shareability rules, or use `record_request_inventory` as a recap adapter: its discovery/disclosure/dependency semantics concern sending records. Internal authorized reading is a separate boundary.

## Explicit later increments and dependencies

Not in this first release: uploaded/scanned/handwritten PDFs, OCR, Office/ZIP/Excel parsing, URL fetch, DICOM, structured lab/diagnostic/treatment/prescription/vaccine adapters, outside-record ingestion, export/email, or automatic incorporation into signed clinical records. Existing diagnostic-renderer `pdftotext` verifies generated PDFs; it is not a general extractor. Native narrative mentions do not establish complete medication reconciliation, current vaccination status or laboratory coverage.

- [ ] Approve the independent recap policy and clinical presentation with Susan; keep processing inactive meanwhile.
- [x] Implement and release the native-source/manifest/review contract; actual completed checks are recorded in the release receipts. Real-model and clinical evaluation are separate gates.
- [ ] Scope additional native adapters individually with their correction/void/version semantics.
- [ ] Obtain authorized sample documents and approve extraction/runtime/provider scope before claiming uploaded-record recap support. Document ingestion requires immutable originals, MIME/page/size limits, isolated bounded parsing/OCR and per-page provenance in its own plan/release.

## Latest correction candidate

The [fidelity correction candidate](../../docs/launch-evidence/2026-10-16-clinical-recap-fidelity-corrections.md) completes a final v3 eight-case engineering pass (8/8 parser,41/41 required facts,16/16 forbidden checks), preserving the original failures and the intervening rejected v2 H result. Staging200/functionv2 source verified; primary unchanged. Susan clinical adjudication, policy approval, CI and specific merge/release gates remain pending. No processing activation.
