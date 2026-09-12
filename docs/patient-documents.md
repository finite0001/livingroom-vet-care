# Private patient documents

Staff can attach PDF, JPEG and PNG originals (up to 20 MiB) to a patient, optionally associated with an encounter for that same patient. Categories include medical records, lab results, consents, anesthesia and dental records. Historical documents may be attached to archived patients. Source, document date and visibility are captured with immutable metadata.

## Persistence and authorization

An upload first reserves a UUID and server-owned object path, uploads to the private `patient-documents` bucket, then finalizes after the server verifies Storage size and MIME metadata. The same UUID is retained across ambiguous responses. Retries probe the same object path before uploading, and finalization is idempotent. Pending reservations survive reload; the original uploader can discard them after removing any pending blob.

Active staff can read finalized records. Only the uploader sees or modifies an unfinished upload. Authenticated callers cannot directly mutate document metadata, overwrite finalized objects, delete ready/void originals, or impersonate another author. Server RPCs stamp the authenticated actor and append audit events. Storage policies serialize pending writes with finalization and abandonment.

Voiding requires a reason and expected record version, preserves the original file, and records who voided it and when. Upload a replacement instead of overwriting history. Downloads use private signed URLs with a 60-second lifetime and an attachment filename. A signed URL remains usable until its short expiry; it must not be treated as an immediately revocable client release.

`Internal` is the default. `Eligible for client sharing` is metadata for a later reviewed release workflow; selecting it does not email, text, publish or grant client access. The implementation does not yet export selected record packages, automatically ingest lab/anesthesia feeds or scan files for malware. Client byte-signature checks provide feedback, not a security scanning guarantee.

## Verification and rollout

Clean local replay of all 17 migrations passed 117 database assertions, including 46 document assertions. The full browser suite passes 13 scenarios, including finalize failure recovery, an upload accepted before its response is lost, invalid file feedback, same-patient encounter selection, private download parameters and retained void history. Browser requests are mocked; database policy tests execute against isolated PostgreSQL/Storage metadata. A real hosted Storage upload/download and clinician acceptance remain rollout gates.

Run `npm run check`, `npm run test:e2e` and `supabase test db` on an isolated migrated stack. Apply `20260912220000_patient_documents.sql` before deploying this UI against a backend. This PR does not migrate existing backend accounts or change the frontend connection. Review [commercial readiness](commercial-readiness.md) for the complete remaining scope.
