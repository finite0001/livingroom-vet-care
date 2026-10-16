# Source-bound dictation review

Base: merged PR261, `6f292fbff8b761c7fa8605091a2d5ed19fef5472`. Owner requested continued native VetRec/VetRocket reconstruction. Existing public research and the private implementation brief establish the intended direction; private account workflows remain unobserved.

## Scope of this implementation

Deliver a complete staff-supplied transcript/draft review path within an existing saved, unsigned encounter. This first slice does not record audio, call an AI provider, claim VetRec parity or implement a processing queue. Those depend on the subsequent audio/provider contract. Build the review destination now rather than a speculative queue with no producer.

1. Immutable, patient/encounter-bound transcript, source-use attestation, source hash and proposed SOAP sections with literal supporting excerpts.
2. Session-matched current-staff read/submit/review/recover RPCs. Raw tables private with RLS and explicit ACLs. Writes attributed to the signed-in actor.
3. Explicit review acceptance/rejection. Accept selected nonempty sections only, preserving unselected saved text; retain original proposal and reviewer edits. Atomically save the encounter draft and its review receipt. Preserve existing clinical role/signing/addenda behavior.
4. UUID recovery, duplicate acceptance protection, encounter-version conflict, signed-note rejection and shared encounter lock ordering.
5. Collapsible review UI on saved draft encounters. Keep parent clinical navigation guard; prevent overwriting unsaved local SOAP text. Retain drafts after validation/conflict/uncertain writes.
6. Unit/SQL/genuine Auth/browser and populated-restore acceptance. New generated migration; update deliberate replay inventory pins. Prepare a reviewable PR; do not merge without its own authorization.

## Files

- Create generated `supabase/migrations/*_clinical_dictation_review.sql`, `supabase/tests/clinical_dictation_review.test.sql`.
- Create `src/hub/features/clinical/dictation/{model.ts,api.ts,ClinicalDictationReview.tsx}` and `tests/clinical-dictation/` acceptance helpers.
- Modify `src/hub/features/clinical/ClinicalWorkspace.tsx`, applicable owned-runtime/restore helpers and CI.
- Add staff documentation and exact verification evidence. Do not regenerate `types.ts`.

## Design decisions

- One immutable proposal row binds one staff-supplied transcript/source snapshot to one expected encounter version. Changed source/proposed text is a new submission. Separate immutable reviews and UUID action receipts provide attribution/recovery. Audio source versions and processing jobs are later additions, not fictitious records now.
- Literal excerpts establish a resolvable source reference, not a guarantee of medical accuracy. The clinician must review attribution and selected wording. Empty/unselected sections never erase saved text.
- Raw transcript text is clinical source history; do not put it in browser persistence, message purge, normal document uploads, email or automatic record-release packages.
- Current active staff and live-session checks preserve the destination's current permission model. No service-role chart signing or CloudTalk-media permission expansion.
- Lock order: per-action advisory lock, then encounter row. All conflicting submit/review actions serialize on that encounter; immutable proposal/review history is not locked in the opposite order.

## Acceptance

- Wrong patient, stale encounter, signed encounter, retired session/role and direct raw access are denied.
- Source excerpt mismatch/unknown keys/empty selection and mismatched UUID reuse are denied.
- Concurrent reviews and repeated UUIDs produce one reviewed result, without duplicate append or silent overwrite.
- A different saved section remains byte-identical; signing remains a separate existing action.
- Browser covers import, source review, selected edits, rejection, lost acknowledgement recovery, unsaved parent/route protection and narrow viewport.
- Synthetic fixtures only. No external AI, audio uploads, clinical activation, email/SMS/payment requests or hosted patient edits in acceptance.

## Outstanding evidence / later work

Authorized VetRec/VetRocket accounts/tabs or exports; supported VetRocket exchange/worklist contract; selected transcription/generation provider and explicit source-retention/consent workflow for real recordings. Later phases: audio capture/upload and jobs → generation → record recap → call summary → dental dictation → imaging exchange/viewer foundations. Existing reminder delivery remains test-only with invoice cron inactive.

## Implementation result

Review UI, guarded immutable source/review/action histories, source excerpts, selective draft writes, conflict/recovery and clinical-editor integration implemented. [Acceptance evidence](../../docs/launch-evidence/2026-10-16-clinical-dictation-review.md):1,498 app tests;6,647 SQL assertions; real owned Auth/browser/concurrency/399-relation restore; staged acceptance and original-row preservation verified. Primary remains192 with no dictation tables. Prepare the PR for its own merge approval; install primary migration before frontend rollout after that approval. Recording, AI generation and jobs remain subsequent work, not completed features.
