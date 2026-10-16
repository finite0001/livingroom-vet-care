# Clinical note templates and typed observations

Phase 1 of the [authenticated VetRec completion plan](../../plans/20261016-vetrec-authenticated/plan.md). Independent implementation; no vendor API or model-training claim.

## Staff workflow

Patient → Medical → open a saved unsigned encounter → Template note drafts. Choose an approved template and typed observations or one of your completed dictation transcripts for that exact encounter. Verify the patient/source permission and save the source. Saving does not invoke OpenAI or change SOAP. Review the pinned source and template, explicitly authorize generation, then open its proposal under Dictation drafts.

Review each field's claim, supporting source excerpt, missing required information and uncertainty. Edit/select the SOAP sections you intend to replace, attest review and accept. Other SOAP sections remain unchanged; signing is a separate action. An excerpt establishes source membership, not medical correctness. Template instructions do not authorize normal findings, diagnoses, doses, tests, treatments or signatures absent from the source.

ADMIN staff can open Clinical note templates to create/save immutable versions, preview/reorder fields, inspect version history, approve an exact saved definition/hash after clinical review, or retire a template with a reason. Policy and template review have separate attestations. A standard SOAP template is available; the independently drafted Susan-style template starts as a draft. Template changes affect future reservations; historical sources, outputs and reviews remain retained.

## Processing and release gates

- The migration seeds a **draft** note-processing policy. No real clinical generation is activated by this change.
- Deploy migration `20261016224741` after its predecessor, then `clinical-note-process` with its committed function-local Deno config/lock, then compatible frontend. A Git commit does not deploy Edge Functions.
- New Edge secret `CLINICAL_NOTE_PROCESSING_ENABLED` defaults off. It reuses the practice's `OPENAI_API_KEY` and the policy's pinned `gpt-6-luna` model. Do not put either secret in Vite/Vercel browser variables.
- Completed-audio transcript generation additionally requires the existing `CLINICAL_AUDIO_PROCESSING_ENABLED` switch and current approved audio policy. It cannot bypass recording/retention approval.
- Practice policy approval and exact template approval are required in the database at reservation, admission, dispatch and completion. Old audio v1 jobs/contracts remain unchanged.
- Stage and verify before primary rollout. Actual iPhone/background recording and clinical model-fidelity acceptance remain separate from desktop/mobile-viewport tests.

## Recovery and data handling

Jobs pin the actual operator/session, patient, unsigned encounter version, policy version, immutable template/version/hash and exact source/hash. Audio adapters also pin the original audio job/transcription and policy. Original text and all claim/excerpt evidence remain in private database history. No new raw-audio storage is introduced.

The browser's pending-note entry retains identifiers/intent only, not typed clinical source text. An interrupted source save is recovered by its original job ID; abandoning an unconfirmed reservation first records a durable cancellation that blocks a late write. An already committed source stays in history. Configuration changes use exact action receipts and durable cancellation too.

Provider dispatch is admitted once. A lost completion acknowledgement retries persistence of the same received result, never repeats OpenAI automatically. Unknown/expired attempts require inspecting saved state and an explicit new-attempt reason/cost acknowledgement. Source, policy, template, encounter, or live-session changes fail closed; they never redirect a job to another patient or silently overwrite an encounter.

Limits: 48 unique ordered template fields; 12,000 instruction characters total; 60,000 source characters; 96 claims overall and 24 per SOAP destination; 500 characters/claim and 1,000/source excerpt. Required means missing information is visible for review, not filled automatically. Operational logs contain status/IDs/sanitized failure categories, not source text or secrets.

## Verification

Focused tests: `tests/clinical-notes/{model,handler}.test.ts`. Owned database/Auth/HTTP/browser/restore runner: `tests/clinical-notes/disposable.py --run-synthetic-local`; add `--include-sql-regression` for the full SQL suite or `--sql-only` for schema checks. It creates uniquely marked local resources, uses fictional records and a stubbed provider, compares populated Auth/Storage/public/extensions dumps, then removes its own runtime and clone. It does not touch hosted patients or invoke a real provider.

Run `npm run check`, the frozen function isolation script and required CI. Receipts must distinguish stubbed provider tests from a real synthetic OpenAI evaluation; neither is proof of clinical accuracy across real recordings.
