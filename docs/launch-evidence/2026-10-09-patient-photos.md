# Patient identity photos — implementation and release checks

Requirement N17 / plan phase 1B. Merged in PR #232 and deployed to staging and primary. [Hosted rollout receipt](2026-10-09-patient-photo-rollout.md). Practice acceptance remains pending.

## Behavior

Active staff can upload, change or remove the optional image from the Patient 360 header. A missing or failed image does not hide the clinical chart. A placeholder and retry action handle access/load errors. The existing patient navigation guard covers unconfirmed photo actions.

JPEG and PNG inputs must be nonempty, at most 10 MiB and at most 40 megapixels. The browser decodes with EXIF orientation, resizes the long side to at most 1024 pixels, and re-encodes PNG without the input's metadata. The retained document contains that processed PNG, rather than the original camera file. The stored PNG is at most 5 MiB.

The server requires the owned reservation and genuine Auth identity. It checks the actual private bytes, exact size/MIME/hash, PNG CRCs, supported normalized pixel format, bounded decompression, scanline length and PNG filters. It captures the Storage object UUID before downloading and verifies that UUID again when recording proof. Replacement during capture cannot be accepted as the original object. This verification is not a malware scan.

A photo becomes current only after server verification, document finalization and a version-checked selection. The previous current photo survives an unsuccessful replacement. Removal clears the current reference, retaining document and file history. Voiding the underlying document hides its image. Ready/void documents and verified pending originals cannot be overwritten or deleted through staff Storage operations.

Images use the existing private patient-documents bucket and 60-second signed access. Authorized staff share the current photo; pending reservations remain uploader-scoped. Previously issued signed URLs may remain usable until their short expiry. No public bucket, automatic record release, AI input or provider delivery is added.

Stable reservation/action identifiers and an actor/patient-scoped retry journal recover uncertain responses. The journal stores request metadata, not image bytes, credentials or signed URLs. A reload before successful upload requires explicit reselection. Replaying an older action returns its original receipt without undoing a later action. A stale new selection fails with PT409 and requires staff to review the latest state.

## Schema and deployment

- Additive migration: `20261009160543_patient_identity_photos.sql`; canonical migration count becomes 169.
- New tables: patient_photo_uploads, patient_photo_state and patient_photo_actions, with restricted grants/RLS and server-stamped actors. The shared audit trigger records current-state changes.
- Active-staff RPCs: read_patient_photo, prepare_patient_photo, read_patient_photo_upload and set_patient_photo.
- Service-only RPC: verify_patient_photo_bytes. Authenticated staff cannot write verification proof or direct current state.
- Edge Function: verify-patient-photo, with gateway JWT verification, actual Auth verification and its own pinned Deno dependency map/lock.
- Existing generic patient-document writes keep their behavior except verified photo originals become immutable while pending.
- Generated Supabase types are unchanged; additive client RPC responses use a narrow adapter with Zod validation.

Roll out the reviewed migration to staging, deploy the verifier, then deploy the frontend. Verify with synthetic staff/patients and a real JPEG/PNG on desktop and mobile before repeating that order on primary. Confirm project references before every hosted operation: staging `kothoqicubowyhwfsrte`, primary `mgadheotkdnrsatfivjy`. The legacy Lovable database is not the target. Hide/remove the frontend photo controls to roll back presentation; retain database/document evidence. Do not drop tables or delete originals as a rollback.

## Validation

Automated coverage is committed in:

- `tests/patient-photos/verification.test.ts`: byte/container/pixel validation, strict body limits, ownership, object binding and uncertain receipts.
- `supabase/tests/patient_photos.test.sql`: reservation retries, normalization contract, verification/selection grants, cross-patient rejection, frozen originals, shared reads, void/removal history, stale versions and immutable action replay.
- `supabase/tests/patient_photos_concurrency.py`: observed PostgreSQL lock waits for competing choices, identical actions and deletion while server verification commits.
- `tests/patient-photos/local-roundtrip.ts`: genuine local Auth, private Storage upload/replacement, proof rejection, shared staff access, actual signed-byte download and retained removal. This exercises the production handler with real local dependencies; it does not claim hosted gateway acceptance.
- `e2e/patient-360.spec.ts`: mobile photo workflow, failed replacement, reload after lost responses, scoped retry journal and navigation guard, alongside existing summary/alert behavior.
- `scripts/verify-patient-photo-edge-isolation.py`: frozen functions-only typecheck and bundle without frontend Node dependency resolution.

Local verification on the candidate branch (2026-10-09):

| Check | Result |
|---|---|
| Fresh isolated migration replay | 169 migrations, successful |
| All pgTAP suites | 134 files, 5,437 assertions passed |
| Lint, app/node typecheck, unit tests and production build | Passed; 1,274 unit tests |
| Frozen check of all Edge entries | Passed |
| Functions-only frozen photo check and bundle | Passed |
| Actual local Auth/Storage photo roundtrip | Passed |
| Observed PostgreSQL concurrency checks | Passed |
| Patient 360 browser coverage | 15 cases passed; additional image-load fallback/retry case passed separately |
| Existing anesthesia/certificate regressions | 8 passed on a single-worker rerun |
| Restore rehearsal Python checks | 10 + 3 passed |

A broad browser run during edits was interrupted after development-server reloads/timeouts. An initial focused run had two existing browser timing failures; those passed in the single-worker rerun without changes to their tests or application behavior. The final broad browser run is tracked in PR checks; no full-browser success is claimed before they finish.

The CI workflow runs photo tests along with the existing frontend, Edge and database checks. Engineering evidence does not replace Susan's clinical/practice acceptance or a staged hosted demonstration.
