# Authenticated VetRec observation ledger

2026-10-16, Chrome, user-authorized practice login. Source baseline for native comparison: main `989c9e5`. Labels below are this report's observation IDs, **not REA Evidence IDs**. Vendor routes identify the surface; account, visit and template identifiers are intentionally omitted.

## Evidence boundary and method

Used the reverse-engineer-anything skill, existing public-document evidence, authorized accessibility-based desktop inspection and a scoped read-only native source audit. REA `list_browser_targets` failed against the existing loopback endpoint with `invalid_endpoint_response` / `unreadable_output`. Read-only doctor reported healthy client registration; unrelated missing binary engines were not installed. Consequently, no new authenticated REA browser/network capture or private API contract is claimed.

Chrome accessibility exposed the controls and generated text. Screenshot capture rendered the content area blank despite the populated accessibility tree, so visual chart geometry and visual layout are unverified. Existing REA public-site/login evidence is linked from the earlier report and does not prove authenticated behavior.

No real patient material uploaded or dictated, no microphone started, no phone call placed, no email sent, no global setting/template/glossary changed. One private fictional visit was generated and remains labeled `SYNTHETIC TEST — NOT A PATIENT`; it was not manually saved, locked, signed or emailed. Generation itself persisted a note. No deletion was attempted.

## Observed controls

| ID | Surface | Direct observation | Limit / native implication |
| --- | --- | --- | --- |
| VR-A01 | `/scribe` | Record, Phone, Upload and Text inputs; record-as clinician; selected medical template; discharge toggle; detail choices Normal/Detailed/Very detailed; microphone selector and audio test | Input controls inspected, not all executed. Preserve actual actor and explicit saved patient/encounter |
| VR-A02 | `/scribe` | Patient name optional; Multi-pet exposes two fields plus Add Patient / Switch to Single Patient; per-visit Team/Private control | No split-generation test. Native patient links must be explicit and saved; do not duplicate optional/unlinked name behavior |
| VR-A03 | `/scribe#text` | Typed observations/history form with 50,000-character counter and Generate Notes | Executed once with fictional text; no transcription test |
| VR-A04 | `/scribe#upload` | Audio/PDF/image drop zone and Upload control; onboarding explicitly mentions documents | No upload; formats, OCR accuracy, limits and extraction quality unverified |
| VR-A05 | `/scribe#phone` | Web/Phone call-method choices, caller ID/number controls, client-number/extension area, audio test and microphone selection; Start Call disabled while connecting | No number dialed; call-recording behavior, cost, consent and patient attribution unverified |
| VR-A06 | `/prehistory` | Patient, summarizing clinician, recap template, Team/Private, optional instructions; upload supports PDFs/images/Word/Excel/text/ZIP; Summarize and Start Visit disabled without input | Form only; no recap quality, OCR, citations or historical-context handling observed |
| VR-A07 | `/templates` and `/templateBuilder` | Personal/team/prebuilt templates; note/discharge/recap categories; ordered sections/entries, field type, required control, instructions, optional default, preview and explicit Save; reusable sections/entries and Charts palette | Existing templates viewed only. Template saving/version/concurrency behavior not tested |
| VR-A08 | custom SOAP builder | Practice-specific subjective shorthand, detailed physical examination, differential problem list and plan subsections; an exam entry has a normal default; builder flags a missing prognosis instruction | Structure/default observed. Do not copy proprietary instructions or assume template completeness |
| VR-A09 | synthetic visit `/history` | Editable generated note; explicit Save, Lock, Copy, PDF download, feedback; Add to visit offers target-note continuation, New note and Quick recording; separate Overview/Recap/Notes/Discharges/Transcript tabs | Output directly observed. Lock/save/export/continuation not executed; signature text is not proof of a cryptographic or audited clinical signature |
| VR-A10 | note editor and Vocabulary settings | Incorrect→preferred spelling with case sensitivity; separate Replacements and Custom Glossary; glossary described for proper names, medications and technical terms; no personal terms present | No terms added. These are visible terminology controls; provider, training data and model fine-tuning unknown |
| VR-A11 | Medical Notes settings | Note language separate from recording language; detail/units/abbreviation categories/custom instructions; recap-context switch off; Default Normals switch on | Read-only configuration. Enabled defaults are consistent with VR-T01, not a complete causal trace |
| VR-A12 | Recording settings | English US; consent confirmation on and disabled for personal override by team policy; long-recording auto-stop off; automatic floating recorder on when leaving tab | Controls only; actual consent prompt, floating/background capture, crash recovery and retention not exercised |
| VR-A13 | canine dental template | Chart-type section, four quadrants with 10/10/11/11 entries, tooth labels 101–110/201–210/301–311/401–411; preview lists default NSF; plan sections | Template/preview only. Voice-to-tooth attribution, generated chart graphics and clinical chart accuracy not verified |

## VR-T01: controlled text-generation test

Setup: a new visit, privacy switched from Team to Private before submission, practice's selected custom SOAP-with-exam template, Normal detail. No template or account settings modified. The following is independently authored fictional test input, safe to reproduce:

> FICTIONAL SOFTWARE TEST ONLY. No real patient or owner. Patient: Test Maple, 4-year-old spayed female DSH, 4.2 kg. Owner reports eating and drinking normally, no vomiting or diarrhea, sneezing for two days. On exam: BAR, BCS 6/9, mild serous nasal discharge. Temperature was not obtained. Heart and lungs were not examined. Ears, oral cavity, abdomen, lymph nodes and neurologic exam were not assessed. Assessment: sneezing; differentials include upper respiratory infection versus environmental irritation. Discussed CBC and chemistry, but owner declined today; these tests were NOT performed. No medications or vaccines administered or prescribed. Plan: monitor appetite and breathing; recheck in 48 hours if not improving. Historical vaccine reaction is owner-reported, vaccine name unknown. Do not assume other normal findings.

Observed: Generate Notes entered Processing, then navigated to the visit's Notes view with a generated editable note. Reloading that visit still exposed the generated note. This is a text-to-note generation test, **not an audio/transcription test**.

| Test | Observed result | Assessment |
| --- | --- | --- |
| Explicit heart/lung not examined | Output asserted normal cardiovascular and respiratory findings | Failed source fidelity in this configuration |
| Ears/oral/abdomen/lymph not assessed | Output asserted normal findings for these systems | Failed source fidelity in this configuration |
| Unmentioned systems | Normal hydration, eyes, skin, urogenital and musculoskeletal findings also appeared | Unsupported template content |
| BAR / BCS / weight | Preserved BAR and 6/9 score, weight 4.2 kg; appearance also added friendliness | Partially faithful; added behavior unsupported |
| Temperature not obtained | Preserved missing temperature; pulse/respiratory rate not recorded | Faithful missing measurements |
| CBC/chemistry declined | Retained declined and not performed | Faithful diagnostic status |
| Vaccine reaction | Retained owner-reported history and unknown vaccine | Faithful uncertainty/history |
| No medications/vaccines | These fields became unmentioned placeholders; no invented prescription or administration seen | No administration fabrication, but explicit negative detail lost |
| Demographics and patient label | Opening used the synthetic visit label; age/sex/breed not clearly retained in note | Do not use free-text label as canonical patient identity |
| Signature | Appended configured doctor signature text without our clicking Lock/Save | Native proposals must not auto-sign or impersonate the reviewer |

One run cannot measure model error rate or other templates/settings. Do not generalize this as universal vendor behavior. Do not change Susan's vendor settings without her direction.

## Native comparison (source-backed)

| Capability | Existing native implementation | Gap / relevant code |
| --- | --- | --- |
| Appointment→dictation | Saved patient/encounter confirmation, actual starter attribution, preflight checks, explicit mic start | Implemented in PR265; `src/hub/features/clinical/appointment-dictation/` |
| Record/upload→SOAP | Pause/resume/preview, canonical WAV input, durable OpenAI jobs, transcript and claim-backed proposals, review/version checks | `src/hub/features/clinical/dictation/audio/`; currently clinician dictation, mono 16kHz 16-bit PCM WAV, 1 sec–10 min; ambient/multispeaker and arbitrary codecs not validated |
| Veterinary terminology | Versioned lexical reference, transcription hints and generation constraints; no patient facts or dose tables in reference | `supabase/functions/_shared/clinical-veterinary-context.ts`; custom per-practice glossary management absent |
| Template/detail | Fixed four SOAP sections with supporting transcript excerpts and editable acceptance | `dictation/model.ts`, `_shared/clinical-audio-model.ts`; versioned custom field templates/detail absent |
| Typed generation | Manual transcript plus already-proposed SOAP can be submitted | No text-only AI generation action; do not confuse manual proposal submission with generation |
| Recap | Release-source selection, exact versions/hashes and snapshots already exist | No internal source-cited recap; release eligibility is not internal clinical read authority. `record-releases/selection.ts` |
| Phone | CloudTalk household conversations and provider summaries; recordings/transcripts ADMIN-only | No explicit patient-linked reviewed clinical adapter; `cloudtalk/`, `supabase/functions/cloudtalk-call-media/` |
| Dental | Structured tooth chart, revisions, signature/addenda | No transcript→tooth proposals; `src/hub/features/dental/`, migration `20260913070000_dental_chart.sql` |
| Discharge | SOAP Plan exists | No separate generated/reviewed discharge artifact. Generation must not send automatically |
| Multi-pet | One saved patient per encounter/job | Explicit multi-pet source attribution/review missing; never split chart writes from names alone |

Current acceptance authority: `clinical_dictation_actor` requires active staff and a live session. It is **not DVM-only**. `save_clinical_dictation_action` checks the intended unsigned encounter and expected version; preserve actual reviewer identity rather than implying stricter enforcement than exists.

## Unresolved scope

Actual mobile/microphone recording, noisy veterinary audio, interruptions, background capture, transcription quality, multi-pet splitting, dental generation, uploaded-record OCR/recaps, call generation, output/version locking, vendor retention/security guarantees, model/provider identity and authenticated API contracts remain untested. Case Board, Rounds, Coaching and Analytics labels are not feature-parity evidence and are outside this scribe/recap/call/dental pass. VetRocket access is still separate.
