# Client and patient integrity implementation evidence

**Status:** implementation candidate, not applied to either hosted database. Branch `feat/client-integrity-20261008`; baseline `1790f11c1989b3a5daac94757ddbe104299c14b8`. Scope: N04, N09 and H20, with N05 multiple-pet regression coverage from the October 8 feedback plan.

## Behavior

- Every new or edited client requires both a valid phone and email. Forms and database writes enforce the rule, including direct staff writes and retained import promotion. No administrator override exists.
- Phone uses an explicitly supplied country code and is normalized to the existing communications format; email is trimmed and lowercased. Having these details does not create SMS consent.
- New patients require an existing contact-complete client. The household UI explains why Add patient is unavailable; the database independently enforces the same condition and serializes it with client changes.
- Existing incomplete households and patient history survive the additive migration. Existing patient identity/history remains accessible. Editing an incomplete client requires supplying its actual missing contacts; creating another patient remains blocked until then.
- The retained Twilio ingestion path no longer creates phone-only placeholder clients. Unknown/shared senders enter canonical inbound review, including STOP handling. Replays retain the original receipt even if a household is created later. Changed content under the same canonical provider ID is rejected; supported long legacy identifiers retain their original value in metadata.

The migration adds a NOT VALID contact constraint and write triggers. NOT VALID avoids silently rewriting historical rows; it still checks every subsequent insert/update. It does not provide an application exception. Generated Supabase types and existing RPC argument/return shapes are unchanged.

## Read-only hosted baseline

Measured through explicitly targeted Management API queries at **2026-10-09 01:27:19 UTC** (October 8 in Denver). Only aggregate counts were retrieved; no client details or credentials are included here.

| Environment | Project | Applied migrations | Clients | Incomplete phone/email |
|---|---|---:|---:|---:|
| Primary | `mgadheotkdnrsatfivjy` | 167 | 1 | 0 |
| Staging | `kothoqicubowyhwfsrte` | 167 | 2 | 2 |

These observations are scoped to contact completeness and migration inventory; they do not establish full clinical acceptance or provider readiness.

## Validation

- `npm run check`: passed lint, type checking, **1,267 unit tests** and production build. Existing React-refresh and bundle-size warnings remain.
- Targeted contact/patient/navigation browser suite: **12 passed**, including phone/email refusal, preserved drafts, legacy-client correction and mobile multiple pets.
- Full browser run: **470 passed, 1 skipped, 7 failed**. All seven failed cases subsequently **passed on a serial rerun** without changing their implementation or weakening their assertions. Keep this distinction visible; do not describe the original full run as clean.
- Full local database suite: **133 files / 5,388 assertions passed**. Final inbound/contact tests after the additional replay safeguards: **55 passed**.
- Initial CI SQL suite: **133 files / 5,394 assertions passed**, including the final replay safeguards. Its broader integration job found a retained attachment fixture without contacts. All remaining client-creation fixtures in the integration/restore runners now provide valid synthetic contacts; **11 affected concurrency suites / 248 checks passed locally**, with their existing assertions unchanged. Final CI status is tracked in [PR #230](https://github.com/finite0001/livingroom-vet-care/pull/230).
- Actual two-session database race: unknown SMS receipt held open while a complete household is created and the same webhook retries; one original review item remains and no second legacy message is created. Added to CI.
- Final migration replay in an owned disposable project and an upgrade proof: historical incomplete household/patient preserved; existing patient editable; new patient blocked, then allowed after real-shaped synthetic contacts are supplied.
- Edge Function type checking: all committed entrypoints and the retained import metadata module passed with the frozen Deno lock.
- Restore-helper unit tests: **10 passed**. Migration inventory tripwires now require 168 canonical migrations and include the new version explicitly.

Local validation used an owned `lrv-client-integrity-*` runtime with synthetic fixtures and verified Docker project/workdir labels. A private, synthetic pre-migration fixture established the legacy upgrade case; it is not part of the canonical deployment inventory. No provider message, payment or payroll execution was used for validation.

## Review notes

- **Security:** scoped checks passed. Existing staff actor/version checks remain authoritative; row guards close non-form write paths. New pure helpers/trigger functions do not expand anonymous access. Retained inbound ingestion checks service authorization.
- **Correctness:** scoped checks passed, including missing/invalid contacts, no administrative exception, multiple pets, preserved history, provider replay and concurrent household creation.
- **Performance:** the patient button uses already-loaded household fields; no additional UI fetch is introduced. Provider-ID transactions serialize only the corresponding receipt.
- **Maintainability:** shared Zod validation is used by client forms and household eligibility; database rules remain independent of UI validation. Most changed test files supply valid synthetic contacts where older fixtures omitted them.
- Full schema lint reports one **pre-existing** diagnostic in unchanged `outbox_retry_source_internal` (`record l` / `request_id` in its dynamic source branches). Its existing SQL tests pass. No new routine is flagged. Review that diagnostic separately; global schema lint is not claimed clean.

## Rollout

1. Review the candidate and required CI results on the exact branch revision. Dave performs the explicit PR merge.
2. Apply `20261009011500_client_contact_integrity.sql` to the verified staging project before deploying the dependent frontend. No Edge handler contract changed or new provider credentials are required.
3. Correct the two staging contact-incomplete households through the staff workflow with appropriate actual test/owner data. Do not fabricate contacts for real households. Demonstrate complete client creation, two pets, legacy reads, missing-contact refusal and unknown-message review.
4. Recheck primary counts immediately before its reviewed migration rollout; the above aggregate is a dated observation.
5. After every existing client is contact-complete, validate `clients_required_contacts_check` through the approved rollout procedure. Do not silently mark the legacy cleanup gate complete while rows remain incomplete.
6. Verify actor/version denial and the two-pet workflow after rollout. Retain existing charts and the contact constraint; use a reviewed forward correction for any migration issue.

Patient photos, Whogot and the remaining feature batches are separate pending work. This receipt does not mark Phase 1 or the all-features release complete.
