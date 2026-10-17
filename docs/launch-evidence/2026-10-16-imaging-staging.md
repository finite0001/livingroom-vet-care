# Native imaging register — staging receipt

October16,2026. Scope: [manual imaging register](../features/patient-imaging.md), not automatic VetRocket exchange or account acceptance.

Staging `kothoqicubowyhwfsrte` advanced from196 to197 migrations, latest `20261016215048_patient_imaging_studies`. Dry-run and push each selected exactly this one committed migration, no seeds/roles, with `--skip-vault`. Primary `mgadheotkdnrsatfivjy` remains unchanged by this package; deploy migration197 there before releasing its frontend.

After the push:

- All368 prior public table row counts/fingerprints matched the before snapshot exactly.
- All1,223 unrelated public function definitions matched. The previous record-request inventory implementation was retained under an owner-only name and wrapped to disclose imaging omissions without exporting viewer links.
- Three private imaging tables are empty. All11 new function bodies match local SQL, owner `postgres`, pinned `public,pg_temp` search paths. Six staff RPCs have authenticated EXECUTE only; helpers and inventory functions remain owner-only. No table has direct staff/anon/service access.
- Security-advisor delta: three INFO private-table/no-policy findings and six WARN authenticated SECURITY DEFINER RPC findings, no other changes. These are the deliberate RPC-only boundary; active staff, actual live session and exact actor checks are verified in SQL and real-Auth tests.
- Audio policy remains version1/draft/`not_stored`. This migration contains no provider configuration, credentials, audio activation or image fetching. No synthetic hosted patient, study, report or Auth fixture was created.

Local validation includes root `npm run check` (1,538 unit tests, lint/type checks/build),77 imaging SQL assertions, and uniquely owned Auth/PostgREST/Storage/browser/concurrency/dump-restore verification. Private receipts and source hashes remain under the worktree’s `tmp/`; the PR records final execution/CI outcomes. The restore compares408 Auth/Storage/public/extensions relations and removes its marked clone/runtime.

Account acceptance remains open: obtain the practice’s VetRocket portal/product/interface and representative study/report identifiers, then prove matching, replay handling, expiration/revocation and the agreed supported feed. Public demo behavior is documented in the [evidence ledger](../../plans/20261016-vetrocket-imaging/research.md).
