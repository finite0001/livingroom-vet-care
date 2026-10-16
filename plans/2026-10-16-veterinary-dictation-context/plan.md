# Veterinary dictation context

2026-10-16. Owner explicitly authorizes planning and implementation; standing PR merge/deployment authorization applies. Base main f9105aaa (PR263). Real clinical processing stays OFF pending Susan's existing policy approval.

## Findings

- Prior [VetRec research](../2026-10-16-clinical-audio-soap/research/vetrec-workflow.md) used REA public runtime evidence and Firecrawl official help. Published glossary/replacement controls are documented; authenticated behavior, private datasets, models and training are unknown.
- Current transcription supplies no context. Current SOAP has generic veterinary safety instructions but no specific terminology set. No claim of vendor-internal parity or fine-tuning.
- Official OpenAI transcription docs support prompt, keywords[] and languages[] for gpt-transcribe. Keywords are hints, not required output; test for unspoken-term leakage.

## Implementation

1. Create versioned, source-attributed English small-animal veterinary vocabulary: clinic shorthand, diagnostics/procedures, vaccines and medication spellings. Meanings are terminology context, never patient evidence, diagnoses, treatment recommendations or dosing guidance.
2. Send a bounded spelling-hint subset plus recording context and English language to transcription. Give SOAP the full bounded terminology guide with explicit rules for negation, abbreviations, units, owner attribution, uncertainty and planned versus performed care. No transcript rewrite or automatic brand/generic substitution.
3. Add deterministic review flags for dangerous/ambiguous abbreviations. Preserve source excerpts and existing clinician acceptance/signing separation. Unknown terms remain source wording; do not guess.
4. Attach vocabulary-version, bundle and request SHA256 fingerprints to both successful stage receipts. Additive SQL migration validates optional context metadata and exposes each receipt in existing staff-only provenance; older results remain explicitly unversioned. No new tables or approval endpoints, no changes to consent policy or activation flags.
5. Show compact vocabulary provenance in the SOAP review. Keep glossary editing/training out of this slice; reviewed source changes require a new version and regression fixtures.
6. Test real handler request wiring, transcript preservation, deterministic ambiguity flags, metadata replay/validation and legacy compatibility. Run owned Auth/browser/restore proof and bounded real OpenAI synthetic evaluation with staging key. No real clinical input or production fixtures.
7. Run checks/CI, review, commit as David Edler, PR, merge under existing authorization. Apply only additive migration then deploy clinical-audio-process to staging and primary; verify off-gates and data/function preservation. Verify production alias and exact commit.

## Files

Create /Users/davidedler/Developer/lrv-vet-vocabulary-20261016/supabase/functions/_shared/clinical-veterinary-context.ts and vocabulary dataset; modify clinical-audio-handler.ts/model.ts; modify ClinicalDictationReview.tsx. Create generated migration 20261016162448_clinical_audio_veterinary_context.sql and extend the existing SQL suite. Extend tests/clinical-audio/{model.test.ts,synthetic-provider.py,local-roundtrip.ts}; bump migration inventory pins. Add feature/research/evaluation docs.

## Acceptance and limits

- Both actual provider requests include their intended context; raw transcript remains unchanged. Same paid-call and retry behavior.
- Synthetic fixtures cover abbreviations/slang, drug names, negation, ambiguous medication/frequency/laterality, numbers, vaccines and absence of exam data. Literal source quotes remain mandatory. Explicitly report failures and test limits; synthetic speech is not clinician/device validation.
- Historical provenance stays readable and never falsely claims new context. Reject malformed context; immutable result-hash replay includes it. Existing staff/session/encounter guards and RPC privileges remain intact.
- Susan reviews vocabulary and policy before real activation; actual iPhone/accent/noise acceptance remains outstanding. No new owner decision blocks this engineering slice.

Status: research and implementation complete. Unit/build, 6,708 SQL assertions and owned Auth/browser/restore validation passed. Final synthetic provider corpus checked; clinical activation still pending Susan/device review. PR/CI and release pending.
