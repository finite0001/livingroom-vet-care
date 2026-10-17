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
| [2. Records recap](phase-02-recapped-records.md) | Implemented; local/staging verified; PR CI and primary release pending | Reviewed, source-cited patient history; document ingestion is an explicit second increment |
| [3–5. Calls, dental and remaining parity](phase-03-05-calls-dental-and-parity.md) | Planned | Patient-linked call drafts, reviewed tooth proposals, separately evaluated discharge/multi-pet/ambient features |

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
