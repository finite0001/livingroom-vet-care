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
| [2. Records recap](phase-02-recapped-records.md) | Released in PR268; v3 correction candidate passes eight-case engineering review and staging; clinical adjudication/merge/release pending | Reviewed, source-cited patient history; document ingestion is an explicit second increment |
| [3–5. Calls, dental and remaining parity](phase-03-05-calls-dental-and-parity.md) | 3A source capture implemented with frozen local SQL/Auth/browser/restore proof; staging backend verified with policy draft and gate off; generation/dental remain planned | Private complete call evidence first; [3B call generation/review](phase-03b-call-summary-implementation.md) and [dental dictation](phase-04-dental-dictation-implementation.md) remain separate increments |

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

## Latest correction candidate

The [fidelity correction candidate](../../docs/launch-evidence/2026-10-16-clinical-recap-fidelity-corrections.md) completes a final v3 eight-case engineering pass (8/8 parser,41/41 required facts,16/16 forbidden checks), preserving the original failures and the intervening rejected v2 H result. Staging200/functionv2 source verified; primary unchanged. Susan clinical adjudication, policy approval, CI and specific merge/release gates remain pending. No processing activation.

## Call source increment

The [Phase 3A engineering evidence](../../docs/launch-evidence/2026-10-16-clinical-call-sources.md) records final private source capture proof: 61 call SQL assertions, 75 actual local API assertions, 41 browser assertions, 3 STAFF boundary checks, 5 populated-restore checks and two observed lock waits. Current canonical compatibility also passes 164 SQL files / 7,172 assertions with 201 migrations. All provider HTTP in the call proof is explicitly stubbed; no real call, OpenAI request or clinical chart write was performed. The separate policy remains draft and processing defaults off. This completes local capture infrastructure, not call summaries or clinical activation; exact-head CI, primary release, Susan's policy review and provider commissioning remain separate gates.
