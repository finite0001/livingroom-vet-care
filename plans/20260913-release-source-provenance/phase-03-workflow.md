# Phase3 — Staff selection, integration and review evidence

Priority: high. Status: pending. Depends on frozen phase1/2 contracts; UI work may start against typed fixtures while backend work proceeds.

## Workflow

- Add separate verified lab-report and approved external-original source groups. Select immutable version IDs, never merely the latest patient or lab ID.
- Display original/corrected/replacement, historical/current state, source identity, received/result dates, exact original and acknowledgment state. Acknowledgment is separate from administrator approval and byte verification.
- Keep originals explicit in selection. If a source selection offers a combined source-plus-original action, show both selections and explain the dependency. Removing an original while its source remains selected must surface a validation error or require removing the dependent selection; never silently omit provenance or include an unreviewed attachment.
- Preserve bounded selection across pages, duplicate handling, load-error recovery and draft/navigation/actor guards. “All” means the explicit reviewed eligible IDs within the limit, not unseen future rows.
- Use versioned discovery and v5 preview, exact returned snapshot/hash confirmation and existing retained UUID recovery. Clearly show pending schema5 acceptance; preview remains possible but confirmation is gated.
- Render the shared schema5 artifact in staff preview/print and frozen delivery reports. Existing email/SMS composers retain recipient/message/expiry/forwarding and exact-artifact attestation; do not introduce an unsupported claim that opening a download proves it was read.

## Files

Modify in the UI worktree (absolute reference paths):

- `/Users/davidedler/livingroom-vet-release-provenance-plan/src/hub/features/record-releases/api.ts`
- `/Users/davidedler/livingroom-vet-release-provenance-plan/src/hub/features/record-releases/selection.ts`
- `/Users/davidedler/livingroom-vet-release-provenance-plan/src/hub/features/record-releases/PatientRecordReleases.tsx`
- `/Users/davidedler/livingroom-vet-release-provenance-plan/src/hub/features/record-releases/RecordReleaseArtifact.tsx`
- `/Users/davidedler/livingroom-vet-release-provenance-plan/e2e/record-release-workflow.spec.ts`
- `/Users/davidedler/livingroom-vet-release-provenance-plan/e2e/record-release-artifact.spec.ts`

Existing `print.ts` re-exports the shared renderer; do not duplicate rendering logic. Change composer files only if necessary to expose the new frozen report clearly, preserving their reviewed attachment/recovery behavior.

Root owns integration, CI, generated type reconciliation and evidence updates. Database files include a new migration4700 and focused SQL/contention fixtures under `/Users/davidedler/livingroom-vet-release-provenance-plan/supabase/`; do not edit historical4100/4200 files. Reserve4700/4800 only after revalidating the latest migration inventory.

## Review and tests

- [ ] Browser cases cover explicit source/original selection across pages, new format acceptance, stale correction/review/document rejection, acknowledgment labels and unsaved-navigation protection.
- [ ] Add synthetic original/corrected lab and original/replacement ezyVet examples with both absent and exact-version DVM acknowledgments.
- [ ] Generate a schema5 example with the production renderer and extend D02 disclosure plus C09/C10 source review checklists. Keep all decisions pending with exact source revision; do not activate policy.
- [ ] Update `docs/record-releases.md`, `docs/release-email-delivery.md`, `docs/plans/ezyvet-historical-records.md`, the clinician register/examples and `docs/commercial-readiness.md` to describe final behavior and limits.
- [ ] Run focused SQL, actual contention, renderer/payload unit tests, browser workflow tests and an actual local Auth/Storage release→email/link capture workflow. Temporary clinical-policy acceptance must stay inside rolled-back tests or disposable generated projects, never hosted.
- [ ] Run repository check/frozen Edge checks and required CI. Revalidate the final migration inventory and update the deliberately frozen local backfill rehearsal only after reviewing the added versions; run restore validation for the integrated source.
- [ ] Stack reviewed draft PRs with concrete local evidence and explicit provider/hosted/clinical limits. No main merge or public deployment.

## Completion boundary

This extension is complete only when the actual selected-source workflow and both exact-byte capture paths pass, legacy frozen artifacts retain compatibility, source changes stop delivery, and review artifacts are available. Clinical approval and real hosted/provider acceptance remain required for commercial readiness. Structured ezyVet clinical conversion, live Antech transport and automatic anesthesia remain separate unfinished requirements.
