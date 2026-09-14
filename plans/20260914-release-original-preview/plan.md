# Review selected API originals within the package preview

Baseline: merged PR131, `9d860961c7153f6fb0cd206f1f9f16f155197eb8`.

Problem: previewing a release locks sibling chart actions, so a DVM who needs to inspect a selected API original must otherwise clear and rebuild selection. The preview already holds exact immutable original evidence. Reuse the existing DVM retrieval endpoint directly, without another API or permission change.

## Implementation

- Mount a selected-original download component only for an active DVM. Key its lifecycle by actor, patient and preview fingerprint; role loss unmounts it.
- Download via `downloadOriginal(record, actor, true)`, preserving endpoint-side authorization and browser size/signature/SHA-256 verification. Recheck the browser session after awaiting bytes.
- Discard late results after component invalidation; revoke object URLs at the next download and on cleanup. Download contents never enter browser persistent storage.
- Include download progress in the existing release dirty/busy guard; disable confirmation/edit/clear during retrieval. Clear prior attestation on every attempt and never auto-acknowledge or auto-confirm.
- Keep restricted-role metadata preview and explicit DVM handoff guidance. Update R03 and the review index; clinical acceptance remains pending.

Files: `src/hub/features/record-releases/ApiOriginalPreviewDownloads.tsx`, `PatientRecordReleases.tsx`, `e2e/record-release-workflow.spec.ts`, and the existing clinical-review script/index. No migration, function deployment, provider request or sharing-policy change.

## Acceptance

- [x] DVM download yields exact selected synthetic bytes and record/patient POST identity, with no direct Storage/capture request.
- [x] STAFF and ADMIN-only previews expose no download control or retrieval request.
- [x] Same-size substituted bytes fail verification and yield no browser download; prior attestation clears.
- [x] A delayed response after signout cannot trigger a file download.
- [x] Existing schema9 selection/recovery and chart review scenarios continue to pass; lint and typecheck pass.
- [ ] Dr. Edler evaluates the deployed review workflow separately.

Local validation: all 46 chart/release browser scenarios passed on an isolated port, including six new preview-download cases. Lint/typecheck and production build passed with existing Fast Refresh/bundle warnings; 23 local documentation links resolve. Independent code review found no blocking issue. The first browser invocation was blocked before execution by another workspace using port8080; the isolated8087 run passed. No shared process was stopped.
