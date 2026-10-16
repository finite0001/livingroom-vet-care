# VetRec AI Scribe workflow: evidence for native LRV implementation

2026-10-16. Focus: recording, interruption/recovery, audio upload, patient identity, transcription and reviewed SOAP generation. This report reuses the 2026-10-15 investigation and refreshes selected official help pages with Firecrawl. It does not claim authenticated VetRec parity.

## Evidence boundary

- **Observed runtime, reused:** `VR-R1` / REA `ev_249a37f5c71dd6a8a040291320df0a579cd61ec50190372d10d53669f23a9223` observed the public product website. `VR-R2` / REA `ev_44b747d9092a469f7e54ebea7b702c7c33025b13a24814488945e0eb8b782e27` observed the app sign-in boundary. Neither entered a practice account or exercised a scribe workflow.
- **Published behavior:** official help articles retrieved below, using `maxAge: 0`; HTTP 200 returned for every cited refreshed page. These are vendor instructions, not execution evidence or quality measurements.
- **Native design:** implementation requirements below are independent LRV choices. OpenAI for transcription and generation is Dave's choice; it is not a finding about VetRec's providers.
- No login, signup, microphone access, call, recording or patient-data upload occurred. No vendor support message was sent. No REA capture or setup was repeated.

Prior evidence: `/Users/davidedler/Developer/lrv-vendor-reconstruction-20261015/evidence/rea-vetrec/report.md` and `acceptance-matrix.md`. Their exact runtime envelopes and older published-document bundles remain available beside those files.

## Findings and minimum useful native behavior

| Question | Published VetRec behavior | Status / native implication |
| --- | --- | --- |
| Start, stop and process | Patient name → start → recording consent prompt → capture → stop → select template → start processing → visit note. [Generate Medical Notes](https://help.vetrec.io/en/articles/9733183-generate-medical-notes) | Published only. Native LRV should start from saved patient + encounter IDs, capture consent before microphone acquisition, and separate Stop from transcription/generation. Do not copy the vendor's unmeasured timing claim. |
| Pause and resume | Pause during diagnostic work or an absence; resume the consultation; stop and process after discussion ends. [Pause Recording](https://help.vetrec.io/en/articles/9673807-pause-recording) | Published only. Keep one encounter/source identity across chunks. Show recording versus paused clearly; pause excludes capture. Returning to another patient must not silently carry over an active recorder. |
| Upload failure | Recordings remain local until upload confirmation. Website offers automatic retry, manual retry and download; Local Recordings exposes pending uploads. Phone app can recover pending recordings on reopen or through settings. [Troubleshooting: Upload Failed](https://help.vetrec.io/en/articles/10151805-troubleshooting-upload-failed) | Published recovery after failed upload; it does **not** establish recovery from every browser crash or mid-capture interruption. Native must distinguish locally saved chunks, finalized playable audio, server receipt and successful processing. Retry preserves source/job identity. |
| Existing audio | Associate a visit first; visit Overview → Actions → Upload Recording → select audio/template → generate. [Upload Phone calls and audio recordings](https://help.vetrec.io/en/articles/10152219-upload-phone-calls-and-audio-recordings) | Published only; codecs, byte/duration limits and validation are unspecified. Native upload needs explicit encounter, consent/source authority, supported-type and size checks, and durable source receipt. |
| Patient versus multiple patients | Up to 10 entered patient names; speak names; separate patient tabs; selected pet controls transfer. Multi-pet and multi-note cannot coexist. Vendor also offers automatic name splitting on “and.” [Creating Multi-Pet Appointments](https://help.vetrec.io/en/articles/10731442-creating-multi-pet-appointments) | Published only; attribution accuracy unverified. Minimum native slice should bind one saved patient and encounter. Multi-pet recordings require explicit attribution review; names and automatic text splitting cannot authorize cross-patient writes. |
| New audio for an existing note | Existing investigation documents explicit target-note selection, then capture/process to combine with that note. [Add to visit](https://help.vetrec.io/en/articles/9673809-add-to-visit-update-existing-notes-in-a-visit) | Reused published evidence. Native continuation must name its target and pin draft version. New audio should produce a reviewable proposal; signed content requires the existing addendum workflow. |
| Regeneration | One selected note; choose template, one-off instructions, and on web reselect contributing recordings; regenerate. [Actions: Regenerate notes and reselect inputs](https://help.vetrec.io/en/articles/9743012-actions-regenerate-notes-and-reselect-inputs) | Published only. Native regenerate creates a new version with frozen source/transcript/template manifest; it must not overwrite clinician edits or automatically insert into the chart. Retry and deliberate regeneration are different operations. |
| Note editing | Web/phone edits are supported; web uses explicit Save. Web editing is unavailable when notes are split into sections. Manually edited title is preserved. Extension editing/renaming/deletion is unsupported. [Actions: Edit, Retitle and Delete Notes](https://help.vetrec.io/en/articles/11506414-actions-edit-retitle-and-delete-notes) | Published only. Native should retain original output plus reviewer edits and use the existing explicit draft save/sign contract. No vendor conflict/version/audit guarantee established. |
| Transcript visibility/correction | Transcript tab lists recordings oldest first with audio player/download/move/delete controls. Moves require access to both visits and are disabled during transcription; dependent transcript/analysis follows source. [Move Recording to Another Visit](https://help.vetrec.io/en/articles/12330522-move-recording-to-another-visit) | Visibility and source relation documented; arbitrary transcript editing is **not** established. Native should preserve original transcription separately from corrected text; generation pins the reviewed transcript version. Wrong-patient media needs a correction trail, not silent chart reassignment. |
| Language | Recording/transcription language and generated-note language are independent defaults; recording selector can override per capture and template can override note language. [Language Settings](https://help.vetrec.io/en/articles/13923921-language-settings) | Published only. Native first slice can pin English and show the selected language; never infer that a language change guarantees correct translation. |
| Corrections and terminology | Note-only replacements can apply to current and future notes, not earlier visits; find/replace affects selected note only. Personal/team glossaries support names and medication terms. [Replacements](https://help.vetrec.io/en/articles/10145859-replacements), [Custom Glossary](https://help.vetrec.io/en/articles/12038987-custom-glossary) | Published post-generation terminology control; this does not establish retranscription or model fine-tuning. Native can start with explicit source correction and regeneration; glossary administration is optional later scope. |
| Templates | Instructions exist at template, section, subsection and field levels. Fixed text/defaults can appear; unavailable information can become “Not Mentioned” or an optional omitted field. [Writing template instructions](https://help.vetrec.io/en/articles/9673749-writing-template-instructions) | Published only. Native minimum is a versioned SOAP schema + clinical instructions. Missing unspoken findings stay unknown; normal findings must never be filled by template defaults. Pin instructions and schema per generation. |
| Support and feedback | Thumbs-down can attach feedback to output or highlighted text; AI and manual reviewers process feedback and it may change templates. Intercom chat is the support channel. [Providing feedback](https://help.vetrec.io/en/articles/9683280-providing-feedback-on-notes-and-recaps), [Ask support questions](https://help.vetrec.io/en/articles/9683309-ask-support-questions) | Published workflow, not proof of automatic personalized model training. Native minimum is a visible failure/retry path and reviewer rejection; do not send patient material to external support by default or promise that each edit trains a model. |
| Consent settings | Help allows disabling consent banner; team admins govern whether members may do so. Older start-recording instructions describe consent each new visit. [Recording Settings](https://help.vetrec.io/en/articles/13183596-recording-settings) | Documentation discrepancy/configuration boundary. Native should follow the Susan-reviewed policy and retain an explicit receipt, not copy vendor reminder-toggle semantics. Real processing remains OFF while policy is draft. |

## Interruption and processing requirements derived for LRV

These are native acceptance criteria, not proven VetRec internals:

1. Record → pause → resume → stop yields one ordered source manifest for the selected encounter. Keep capture duration separate from elapsed/pause time.
2. Persist chunks as they arrive and surface persistence failures immediately. Recoverable chunks are not necessarily a valid complete media file; verify playback/container integrity after interruption before upload or provider submission. An interrupted source must be labeled incomplete until reviewed.
3. Route change, tab close, lost microphone track, recorder error, storage quota failure and session change must stop/interrupt safely and expose recovery state. Never resume a new patient's recording automatically.
4. Upload acknowledgment retires local pending status only after the server confirms the intended source object/version. Ambiguous acknowledgment must reconcile, preserving the only usable audio copy and avoiding duplicate jobs.
5. Separate capture failure, upload failure, transcription failure, generation failure and review rejection. A transcript can exist while SOAP generation is pending/failed; retry only the failed stage where possible.
6. Present source audio/transcript and structured SOAP proposal together. Clinician acceptance is explicit, audited once and checks expected encounter/draft version. Never auto-sign or infer unspoken findings.
7. Pin patient/encounter, source digest/segments, consent policy/version, transcript revision, SOAP schema/template instructions, provider/model and reviewer/insertion receipt. A deliberate regeneration has a new generation ID and preserves prior output.
8. Keep the real processing switch OFF until Susan approves consent/retention and operational validation succeeds. Current user provider choice: OpenAI for both stages. Vendor equivalence is unnecessary for that independent implementation.

## Remaining unknowns

**Partially answered:** all workflow-control questions have published guidance. **Unresolved:** actual authenticated behavior, clinical output quality, difficult/noisy audio, source language accuracy, arbitrary transcript edit/retranscribe controls, exact upload limits, browser/device support, background recording, crash or power-loss guarantees, container/chunk implementation, audio encryption/local storage policy, retention/deletion/backups, model vendor/version/routing, tenant roles, duplicate/retry receipts, output history and concurrent edit handling.

The failed-upload article explicitly promises retention until upload confirmation; it does not specify how long server audio survives afterward. Model references in Vocabulary Settings describe terminology controls without identifying the underlying model. No account was supplied, so private controls and implementation remain unverified. These gaps do not block an independently designed native draft workflow; they block parity claims and assumptions about vendor guarantees.

Bounded discovery: Firecrawl map searches for `transcript`, `model` and `record` (limits 30/30/40) located the relevant pages but also unrelated content. Three focused indexed searches for model/OpenAI, interrupted/closed-browser recovery and transcript editing returned no results; this is a search limitation, not proof these capabilities do not exist. No broader crawl was performed.

## Refreshed source receipts

Firecrawl scrape IDs, 2026-10-16; IDs identify public-document retrieval, not REA/runtime execution:

| Official article | Scrape ID |
| --- | --- |
| Generate Medical Notes | `01a1451f-dbb2-71be-be94-0d5b1f256e8a` |
| Pause Recording | `01a1451f-d1c7-728f-a604-e9499883e859` |
| Troubleshooting: Upload Failed | `01a1451f-f268-77df-ad75-1bdd1bbe0df8` |
| Upload Phone calls and audio recordings | `01a1451f-fe28-748f-9926-535047852376` |
| Regenerate notes and reselect inputs | `01a14520-1dcf-74bf-879c-e0abc9a29cf9` |
| Creating Multi-Pet Appointments | `01a14520-26f4-71c9-9040-2086bd5ba3c2` |
| Providing feedback | `01a14520-3dfb-71a9-b193-19d6e14879ed` |
| Edit, Retitle and Delete Notes | `01a14520-3363-7358-98dc-7cfe77912a0a` |
| Language Settings | `01a14520-f224-7772-9f10-ded1010a5dc4` |
| Vocabulary Settings | `01a14520-e3de-70de-8d63-24d5f979e194` |
| Recording Settings | `01a14521-1c11-72d8-96b3-1399fd49a761` |
| Recording collection | `01a14521-1193-77b4-99b7-687b2bb1c4de` |
| Ask support questions | `01a14521-0861-739a-bd50-10a9166d5d04` |
| Writing template instructions | `01a14520-fdf5-77d6-8c96-dcb6f3c738df` |
| Change spoken language | `01a14521-3b9f-74d9-a416-d6f374969d78` |
| Replacements | `01a14521-4637-71c6-8f49-8ff0a9087593` |
| Custom Glossary | `01a14521-51d3-7038-b505-1e997dcbf8bc` |
| Move Recording to Another Visit | `01a14521-5bfc-757a-b743-19af913c209f` |

Map IDs: `01a14520-52cf-70ef-98d0-c28bc5273f2a` (transcript), `01a14520-7875-7039-9693-de9ec40aa927` (model), `01a14520-918b-72ad-b4cd-5644ec82392c` (record). Focused empty search IDs: `01a14521-7ce3-72dc-9ea3-8b8384bf0a03`, `01a14521-7cc0-706f-acc9-e76c0523244e`, `01a14521-7dae-7798-a7d5-c0c498f05fb5`.
