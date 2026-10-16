# Staff-supplied dictation review acceptance

This implements the review destination for later native speech/AI work: retain an authorized transcript and proposed SOAP text, review literal excerpts and current saved text, then accept selected sections or reject with a reason. Audio capture, transcription, generation, processing jobs and private-vendor parity are not implemented by this slice.

## Exact local acceptance

[Pinned local receipt](2026-10-16-clinical-dictation-local.json) contains 203 verified source hashes, including all193 generated migrations and the tested editor/API/harness inputs.

- `npm run check`:1,498 application tests, typecheck and build passed;0 lint errors and4 existing refresh warnings. Existing bundle-size warning remains.
- Canonical SQL:157 suites /6,647 assertions, including42 dictation assertions.
- Actual owned Auth/PostgREST:27 assertions, separate from7 SQL/restore assertions. These are assertion counts, not27 independent network requests.
- Actual browser:16 checks. Staff import/review, route-draft protection, narrow-screen acceptance/rejection, readable/selectable read-only reviewed text, and two deliberately dropped responses after real committed writes. Recovery reused the original UUIDs without duplicate source/review records.
- Competing genuine HTTP encounter update and review were both observed waiting. The test accounts for PostgreSQL's queued tuple-lock blocker, not only the original lock holder. Normal role timeouts were retained. The earlier waiting update committed; the stale review failed without replacing it.
- A colleague signed the encounter after acceptance committed but before its lost response was recovered. The UI recovered the action and loaded the current signed encounter, rather than adopting the older unsigned receipt snapshot.
- Populated restore matched399 exact relation fingerprints across public/auth/storage/extensions, including all3 new dictation families. Restored staff-source read used an explicit SQL session context; it was not a second HTTP service or browser proof.
- Owned containers, volumes, clone and private runtime work were removed. No audio/AI/email/SMS/payment provider requests.
- Existing mocked clinical regression:2 browser tests passed for SOAP conflict retention, signing, addenda and explicit route discard. These are separate from the genuine owned-runtime browser proof.

Private execution logs and screenshots are retained in the working checkout's ignored `tmp/` and `/tmp/lrv-dictation-*` evidence files. No credentials or browser session exports are committed.

## Staging

[Staged receipt](2026-10-16-clinical-dictation-staging.json): generated migration193 installed only on `kothoqicubowyhwfsrte`; dry-run selected only `20261016040402_clinical_dictation_review.sql`. Vault, seed and custom-role deployment were not included.

- Real Auth/API acceptance:20 assertions, plus1 fixture-ownership SQL assertion and2 cleanup SQL assertions. The private staged runner originally labels its combined21 setup/API assertions together; the published receipt separates their evidence types.
- Two synthetic proposals, two reviews and four action receipts were retained. Selective acceptance preserved unselected text; rejection left the chart unchanged. No clinical signature or external provider request.
- One explicitly synthetic client/patient/encounter and its attributed source histories remain in staging. The patient is archived; the fixture account is inactive and banned, with0 roles, sessions or refresh tokens.
- All16 tracked original business fingerprints matched after excluding the one new owned client, patient, retired profile and owned role rows. Original encounter/addendum fingerprints and six existing clinical/session function definitions matched exactly.
- All5 new function bodies match local source. Owner is postgres; search path is pinned to public before pg_temp. Internal helpers are owner-only; only the guarded public staff RPCs grant authenticated execution. Anonymous/service execution and raw table reads were denied.
- Security advisors returned the same five findings, with no added findings or warning/error categories. This is not a claim that the project has no existing advisories.

## Production and merge boundary

PR261 is already merged/deployed as `6f292fbff8b761c7fa8605091a2d5ed19fef5472`. Primary `mgadheotkdnrsatfivjy` remains at192 migrations and has no dictation tables. This slice is not released there. Existing unpaid-reminder policy/worker configuration remains separate; delivery is test-only and invoice scheduling is inactive.

Before releasing the new frontend, obtain this PR's specific merge authorization, install the same generated migration on primary after fingerprint/ACL preflight, verify its empty histories and preserved existing clinical records/functions, then merge the exact tested head and verify production/domain. Preview builds pointed at primary require that backend migration before their new panel can work. Do not use primary patient records as deployment fixtures or silently enable unrelated clinical/provider automation.
