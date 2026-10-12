# Actor, policy and Storage locking — 3B2B

Read-only source research against merged #241 (`9456f515613cc3a132583763d55007161e1cedfc`). No implementation or hosted mutations performed.

## Authoritative eligibility

- `supabase/migrations/20260613183224_9575f409-8565-4e33-ab7a-1a004e11a670.sql:3`: `is_active_staff(uuid)` is a SQL STABLE EXISTS over `profiles.is_active=true` joined to `user_roles.role IN ('ADMIN','DVM','TECH','STAFF')`. It acquires no row locks.
- `supabase/migrations/20260912210000_clinical_core.sql:38`: `clinical_require_staff()` checks `auth.uid()` and that helper; it also acquires no eligibility locks.
- `supabase/migrations/20260930120000_linkage_integrity.sql:178`: `profiles.role` is explicitly deprecated for authorization; `user_roles` is authoritative.
- `supabase/migrations/20260614151553_376b87c5-04a7-4f77-8386-321af04d2cfe.sql:43`: `admin_update_staff_role` updates target profile, then deletes/inserts role rows. `admin_set_staff_active` updates profile only. Direct admin UPDATE/DELETE role policies also exist in the June13 migration, so locking profile alone does not protect role membership.

## Consistent order for new processing operations

1. Stable action/claim advisory lock, if required, before row locks. Always use the same namespace/order across replay and fresh execution.
2. Exact job `FOR UPDATE`; bind patient, immutable source/snapshot and current `requested_by`.
3. Current requester's profile `FOR SHARE`, selected by ID; then all existing requester role rows `ORDER BY id FOR SHARE`. Recheck active profile and authoritative qualifying role after acquisition. `FOR KEY SHARE` does not block changes to `profiles.is_active`.
4. Worker/registration policy rows `FOR SHARE` in one documented deterministic order. Recheck enabled state and exact renderer/settings/validator/rules hashes.
5. Processing row `FOR UPDATE`; exact actor/attempt/fence/expiry. Create a missing row only under the already locked job. All writers must lock job before processing.
6. Exact Storage object `FOR SHARE`; multiple objects sorted by object UUID. Verify actual identity and metadata, then recheck lease expiry with `clock_timestamp()` before commit.

Profile/role share locks hold eligibility through the transaction. Fresh checks after waits see committed revocation; a revocation starting later waits until the legitimate operation commits. Do not retain DB locks across rendering, HTTP upload or download.

The current byte-capture helper (`20261011203250_diagnostic_pdf_jobs.sql:134`) instead locks job then policy and only rechecks staff. New processing should use its own ordered helper; do not silently retrofit old capture behavior without adjusting old concurrency tests.

## Policy ordering conflict

There is no public policy-write RPC for `diagnostic_pdf_worker_policy`; private-table writes currently occur only in owned probes/tests. `supabase/tests/diagnostic_pdf_jobs_concurrency.py:146` deliberately holds policy `FOR UPDATE`, then updates the requester profile while another worker waits. That is reverse ordering relative to new profile-before-policy processing and would deadlock if reused unchanged.

New policy configuration must acquire relevant actor eligibility before policy, or remain policy-only. Never hold policy and then acquire profile/roles, jobs or processing. Existing native return-policy configuration (`20260916090000_native_dispense_returns.sql:58`) is policy-only after a non-locking actor check, so it does not establish a global actor/policy order.

## Storage identity and byte verification

- `20260913700000_attachment_original_capture.sql:206`: capture completion selects reserved bucket/path `FOR SHARE`, checks non-null object, exact metadata size/MIME, then binds object UUID into immutable capture fingerprint.
- `20260914010000_reviewed_canonical_api_originals.sql:53`: canonical approval checks saved object UUID plus bucket/path/size/MIME under `FOR SHARE`.
- `20260914060000_canonical_release_attachment_validation.sql:31`: multiple original objects locked in UUID order before final eligibility checks. The later permanent-condition migration supersedes its old `40001` errors; new code must use `PT409` for stale/unavailable conditions.
- `20261009160543_patient_identity_photos.sql:100`: photo verification additionally checks caller-supplied actual object UUID against reservation and rejects changed verification identity.

Registration should check immutable intent bucket/path, capture SHA/length/MIME, supplied actual object UUID, actual object creation timestamp, and exact `storage.objects.metadata->>'size'` / `mimetype`. Preserve the original timestamp string or DB timestamptz precision; JavaScript Date conversion may discard microseconds. Bind these facts and validation/claim/source hashes into the immutable registration receipt.

SQL metadata checks do not verify the file digest. Privileged coordinator must download actual bytes, check SHA/length and then register the same identity. `upsert:false`, a unique immutable hash-bound path and no uploader DELETE/UPDATE keep normal concurrent writes from replacing it. Revalidate object identity after download and in the registration transaction. Service-role Storage operations bypass RLS, so a DB fence does not physically stop a delayed upload; stale workers may populate only the same frozen bytes, cannot register, and unregistered objects remain private/recoverable. No automatic cleanup in this package.

## Replay semantics

- Exact historical operation/registration receipt lookup precedes live lease checks, but validates stable operation ID, complete submitted intent, actor/patient/job binding and original immutable receipt.
- Return the saved receipt after lease expiry, policy disablement or newer processing attempt; this is read-only historical recovery, not authorization to upload or register anew.
- Fresh work requires current active request owner and live policy/processing lease. Preserve original `capture.actor_id`; requester takeover changes operational authority, not historical byte provenance.
- Receipt existence is not proof of current object availability. Staff projection/download separately validates saved object UUID/creation time/path and actual bytes. Never rewrite the historical receipt to match a replacement object.
- Changed stable ID intent/bytes: `23505`; access/actor mismatch: `42501`; expired/superseded lease or changed policy/object: `PT409`; malformed values: `23514`. Avoid permanent `40001`.

## Required observed-lock cases

- Offboard actor while worker waits on job/profile; role removal while waiting on role row; policy disable/change while waiting on policy; lease expiry during policy/Storage wait.
- Revocation initiated after share locks must wait until worker transaction commits; then subsequent fresh work denied.
- Two distinct attempts obey job-before-processing order; identical register replay is one immutable receipt; stale attempt cannot register.
- Object removed/replaced before registration rejected; exact saved receipt recovers without pretending replaced Storage is available.
- Policy-only writer cannot deadlock with job→profile/roles→policy processing; avoid the existing policy→profile fixture order for new operations.
