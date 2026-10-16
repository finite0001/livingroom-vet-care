# Phase 1: versioned templates and typed-note generation

Priority: next. Status: planned, no implementation in this investigation. Depends on [observations VR-A07–12 and VR-T01](research/authenticated-workflows.md), existing audio/proposal pipeline and current clinical policy. Paths below are relative to this worktree root (`/Users/davidedler/Developer/lrv-vetrec-investigation-20261016`); implementation should use a fresh branch from then-current main.

## Outcome and design choice

Clinician opens a saved patient/unsigned encounter from the patient record or appointment, chooses a practice-approved template, types observations or records dictation, generates, checks each proposed field against supporting source text, edits and accepts selected content. No automatic normal findings or signature. Existing clinical signing remains separate.

Choose bounded structured templates mapped to the four existing SOAP fields. This preserves the current encounter model and existing reviewed-write path. An unrestricted rich-document/template scripting engine would add complexity and permit incompatible chart writes; defer it. Keep existing jobs/reviews reproducible after a template changes.

## Implementation steps

1. Add Zod schemas for immutable template versions: name, output kind, ordered sections/entries, stable field IDs, SOAP destination, bounded instruction text, optional/required display policy and optional formatting detail. Required means missing data is flagged, not invented. Defaults may provide headings/placeholders only; disallow factual normal values and injected signatures. Treat instructions as untrusted configuration subordinate to source fidelity rules.
2. Add private template roots/versions with practice scope, draft/approved/retired lifecycle and actual actor/session audit. Determine approval role from existing practice-settings authority before implementation. Seed a draft matching Susan's section structure using independently written instructions; her clinical approval activates that template. Keep a fixed approved legacy SOAP option for old jobs.
3. Add template/version/hash and output-contract version to new generation manifests without invalidating old job readers. Pin prompt, vocabulary, source/transcript and model identities. Editing the template affects future runs only; deliberate regeneration creates a new generation, never silently rewrites reviewed output.
4. Extend the shared generator to produce bounded field-level claims with exact source quotes/locations, explicit uncertainty/status and destination. Validate field IDs, source membership, byte/length limits and no unsupported destinations. Quotes prove provenance, not truth or entailment; clinician review and fidelity evaluations remain necessary.
5. Add typed-observations source kind distinct from audio transcript. Reuse durable reservation, idempotency, processing/recovery and reviewed acceptance; do not manufacture a WAV or label typed text as a transcription. Define policy authorization for text explicitly; fail closed until that scope is approved. Never bypass the audio processing gate through another source kind.
6. Add patient/encounter template selector, preview, typed input and field-level proposal review. Render assembled approved fields into existing SOAP destinations, preserving existing text until explicit acceptance. If accepting would replace existing text, show that change; check expected encounter version again server-side. Existing dirty-route guards apply to typed text and template editor.
7. Keep terminology configuration separate from patient facts. Future approved personal/practice glossary additions need version/hash, bounded terms, conflict review and prompt-injection handling; do not introduce blind medication substitutions or automatic feedback-based training. Custom glossary administration can follow the core template/text slice.
8. Add deployment/backward-compatibility evidence, exact source manifests and synthetic provider evaluation. Existing jobs and manual proposal submission must still read/recover. Preserve real audio policy draft/OFF until separately approved.

## File responsibilities

| Action | Path | Purpose |
| --- | --- | --- |
| Create | `supabase/migrations/<new>_clinical_note_templates.sql` | Private versioned templates, approved selection and narrowly scoped staff RPCs |
| Create | `src/hub/features/clinical/templates/{model,api,TemplateSelector,TemplateEditor}.ts[x]` | Schemas, explicit template management and preview |
| Modify | `src/hub/features/clinical/dictation/{model,api,ClinicalDictationReview}.ts[x]` | Verify actual component name first; typed source and field-aware review while retaining old proposal reads |
| Modify | `src/hub/features/clinical/dictation/audio/ClinicalDictationAudio.tsx` | Pass pinned template context without changing microphone consent/start semantics |
| Modify | `supabase/functions/_shared/{clinical-audio-model,clinical-audio-handler}.ts` | Versioned generation contract and durable source-kind handling |
| Create | `supabase/functions/_shared/clinical-note-template.ts` | Shared strict field assembly/validation; no duplicate prompt logic |
| Create/modify | `tests/clinical-*` and relevant `src` tests | Meaningful source-fidelity, access, version, recovery and browser assertions |

No deletions planned. Verify existing filenames/RPCs and migration inventory pins before changing them; do not generate `types.ts` locally.

## Acceptance / risk checks

- VR-T01 fixture preserves not-examined systems, owner-reported uncertain history, declined tests, explicit no-medication/no-vaccine statements, measurements and demographics; no unsolicited normal or signature text.
- Ambiguous ADR/PU, drug sound-alikes, corrected doses, negation, planned versus performed, missing BCS scale and historical vaccines remain source-bound or flagged. Test English vocabulary with reviewed synthetic audio as well as text.
- Unknown template field/version, malicious instructions and forged clinical destinations rejected; old manifest versions still work.
- Wrong patient/operator/session, signed encounter, changed template status and stale encounter version fail closed; compare explicit regeneration with same-intent retry.
- Lost request/response and concurrent accept cannot duplicate or overwrite another staff member's edits. No provider invocation merely on route load or template preview.
- Template instruction size, source size, field count and generation spend bounded; log IDs/status/error categories, not transcript bodies or secrets.
- Actual local browser check at 390px/desktop; required unit/SQL/Edge/full-check CI as relevant, staging before production.

## Checklist

- [ ] Confirm schema/backward-compatible job contract against current main.
- [ ] Implement private template/version RPCs and access/version tests.
- [ ] Add typed generation and field assembly with synthetic fidelity tests.
- [ ] Build selector/editor/review and lost-response browser checks.
- [ ] Susan reviews independently drafted template and processing policy.
- [ ] Required CI, staging, specific PR approval, production release evidence.

Open decisions: clinical template approval role and typed-source processing policy. Draft implementation may proceed with inactive settings; activation waits for the relevant approval.
