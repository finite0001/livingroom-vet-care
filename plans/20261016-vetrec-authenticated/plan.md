# VetRec: authenticated investigation and native completion plan

Date: 2026-10-16. Native source baseline: `989c9e588f00eba22c65377bde013fbfdbbf2bf8` (PR265). Investigation authorized by Dave after signing into VetRec. Implementation remains independent LRV code; no vendor source or private API copied.

## Result

Authenticated inspection and one private, explicitly fictional text-generation test establish useful workflow gaps. Most consequential: the tested account/template inserted normal exam findings despite explicit statements that those systems were not examined. Its Default Normals setting was enabled. This is one configuration and one test, not a claim about all VetRec outputs.

See [observation ledger and native gap matrix](research/authenticated-workflows.md). Existing [public-document investigation](../2026-10-16-clinical-audio-soap/research/vetrec-workflow.md) remains published evidence, not authenticated execution evidence.

## Delivery order

| Phase | Status | Outcome |
| --- | --- | --- |
| Authenticated investigation | Complete within stated boundary | Input workflows, template structure, terminology settings and one generated note inspected |
| [1. Templates and typed notes](phase-01-templates-and-text.md) | Released in PR267; primary backend and thelivingroom.vet verified | Versioned practice templates, source-backed field proposals and typed observations without microphone capture |
| [2. Records recap](phase-02-recapped-records.md) | Released in PR268; PR270 v3 fidelity correction merged and primary rollout verified; Susan's clinical adjudication remains pending | Reviewed, source-cited patient history; document ingestion is an explicit second increment |
| [3–5. Calls, dental and remaining parity](phase-03-05-calls-dental-and-parity.md) | 3A released in PR271; 3B.1 released in PR272 with primary202 verified; processing off; generation/dental remain planned | Private complete call evidence first; [3B call generation/review](phase-03b-call-summary-implementation.md) and [dental dictation](phase-04-dental-dictation-implementation.md) remain separate increments |

Templates/text first because they serve the everyday SOAP path, reuse the existing proposal/review machinery, and provide output contracts for later call and recap adapters. Building an unrestricted general template engine or replacing existing clinical signing is unnecessary.

## Invariants

- Saved client and patient remain mandatory. Optional names or name splitting cannot authorize chart writes.
- Actual authenticated operator is retained separately from assigned doctor. Existing review authority is active staff with a live session; it is not currently restricted to DVMs.
- No inferred normal findings, doses, administered treatments, completed tests or signatures. Missing input stays unknown; historical facts stay historical.
- Original sources, corrected transcripts, generation manifests, model/prompt/template/vocabulary versions, reviewer edits and accepted encounter version remain distinguishable.
- AI output remains a proposal. Explicit reviewed acceptance updates only the intended unsigned encounter/chart at its expected version. Signed records use existing addenda.
- Do not enable real audio processing while Susan's recording/retention policy remains draft. Typed text, calls and record uploads need their own approved processing scope; they are not a way around that gate.
- Keep OpenAI as the selected provider for transcription and generation. A terminology reference/prompt is not model fine-tuning or proof of clinical accuracy.

## Release and verification

Each implementation increment: scoped unit/schema tests, SQL access/version/recovery tests when persistence changes, actual local Auth/browser/HTTP tests for clinical writes and ambiguous responses, required CI, staging, exact-head review, specific PR merge approval, then primary migration/functions/frontend in dependency order. Never assume a Git merge deploys Edge Functions.

Evaluate desktop and 390px layout; real iPhone recording/background/screen-lock remains a separate hardware acceptance item. Provider tests use only explicitly labeled synthetic sources and record real versus stubbed requests.

## Open dependencies

- Susan's consent/retention and clinical-template approval; real clinical processing stays off pending that review.
- Authorized sample record uploads and source-document requirements before claiming scanned/handwritten recap support.
- Call transcript access policy: current call recordings/transcripts are ADMIN-only.
- Real VetRocket portal/API/DICOM access remains separate. This VetRec login does not resolve it; PR266 is a manual imaging register, not automatic PACS integration.

## Latest recap correction release

The [fidelity correction](../../docs/launch-evidence/2026-10-16-clinical-recap-fidelity-corrections.md) completed its final v3 eight-case engineering pass (8/8 parser, 41/41 required facts, 16/16 forbidden checks), preserving the original failures and rejected v2 H result. PR270 merged with specific approval and completed its [primary rollout](../../docs/launch-evidence/2026-10-16-clinical-recap-fidelity-primary-rollout.md). Susan's clinical adjudication and policy approval remain pending; no processing activation occurred.

## Call source increment

The [Phase 3A engineering evidence](../../docs/launch-evidence/2026-10-16-clinical-call-sources.md) records frozen 201-migration capture proof: 61 call SQL assertions, 75 actual local API assertions, 41 browser assertions, 3 STAFF boundary checks, 5 populated-restore checks and two observed lock waits, plus its original canonical compatibility proof. PR271's exact-head CI, merge and [primary rollout](../../docs/launch-evidence/2026-10-17-clinical-call-sources-primary-rollout.md) are complete. Capture remains off with a draft policy and no provider commissioning.

The subsequent [3B.1 access/compatibility proof](../../docs/launch-evidence/2026-10-17-clinical-call-note-sources.md) passes 53 targeted SQL assertions, 144 local boundary/compatibility assertions, two observed authorization waits, nine exact legacy responses, 27 frontend parses and populated restore of 20 relation families/1,331 routines. All 165 canonical SQL suites/7,235 assertions pass with the unpublished controlled-stock candidate. PR272 passed exact-head CI, merged with specific approval and completed [primary202 rollout](../../docs/launch-evidence/2026-10-17-clinical-call-note-sources-primary-rollout.md). No call admission, generation or acceptance API or UI is added. The separate generation/review increment and Susan's clinical/policy review remain outstanding.
