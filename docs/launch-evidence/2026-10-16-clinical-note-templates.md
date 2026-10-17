# Clinical note templates — verification and staging receipt

October 16, 2026. Scope: Phase 1 of the [authenticated VetRec plan](../../plans/20261016-vetrec-authenticated/plan.md). Independent implementation of versioned practice templates and drafts from typed observations or an existing completed encounter transcript. Records recap, calls and dental dictation remain later phases.

## Staging

Staging `kothoqicubowyhwfsrte` advanced from 197 to 198 migrations, latest `20261016224741_clinical_note_templates`. Dry-run and push each selected exactly that migration with `--skip-vault`; neither included roles or seed files. No primary deployment was performed.

- All 371 prior public table row counts/fingerprints and column, RLS, policy, ACL and noninternal trigger metadata matched the baseline exactly.
- All 1,235 prior public functions retained identical definitions, bodies, owners, ACLs, execution settings and role privileges. The migration adds 10 private tables and 24 functions, with exact local body hashes and intended permissions/search paths.
- The expected five seed rows are present: two template roots, two immutable versions and one draft processing policy. All new job, attempt, event, receipt and provenance tables are empty. No hosted patient or Auth fixture was created.
- Note policy remains version 1/draft. Existing audio policy remains version 1/draft/`not_stored`. `CLINICAL_NOTE_PROCESSING_ENABLED` is absent and therefore false; no secret values were changed or exposed.
- `clinical-note-process` is ACTIVE version 1 with JWT verification on. All six uploaded files match local source exactly. All 51 existing hosted Edge Functions retain identical metadata. An unauthenticated POST returns 401; this is not an authenticated clinical acceptance test.
- Security-advisor delta is exactly 10 INFO [private RLS tables without direct-access policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) and 12 WARN [authenticated SECURITY DEFINER RPCs](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). These implement the deliberate RPC-only boundary: tables deny direct access and staff functions check actual actor/live session. No other advisor findings changed.

Private before/after snapshots, function sources and advisor comparison remain in the worktree's ignored `tmp/clinical-notes-*` files. They contain no hosted patient bodies; row comparisons retain only counts and fingerprints.

## Local verification

The complete SQL suite passed 6,953 assertions across 161 files. The focused final template suite passed 138 assertions. Frozen, function-only Deno checks and bundles passed for both the legacy audio and new note functions without root Node resolution.

The uniquely owned real Auth/PostgREST/browser run passed 31 API assertions, 14 browser assertions and three restore assertions across 418 populated Auth/Storage/public/extensions relations. It dropped two committed browser responses, recovered the original source/result identities, verified same-intent one-shot dispatch, exercised cancellation and originating-session revocation during a blocked dispatch, and accepted only the reviewed Subjective section. Objective text and unsigned encounter status remained unchanged. The marked restore clone and owned runtime were removed. The receipt hashes 218 proof inputs.

`npm run check` passed: lint (zero errors, four existing refresh warnings), all three TypeScript projects, 1,554 unit tests and the production build. Restore safeguard checks also passed: 10 comparison tests, three privilege-diagnostic tests and the original Storage-metadata byte test. The build retains its existing large-chunk warning.

Provider contract tests and the owned workflow use fictional sources and simulated outputs (three simulated requests, zero real requests). No real clinical recordings have been processed for this batch. Desktop and 390px viewport checks do not establish real iPhone microphone/background behavior. Literal source excerpts prove membership, not medical entailment.

## Release dependencies

Imaging PR266 precedes this stacked feature. Primary still needs migration 197, then 198, then the new function before releasing the compatible frontend. Git commits do not deploy Edge Functions. Keep processing off and policies draft until Susan reviews the processing scope and independently drafted clinical template. Real-provider model fidelity and real iPhone recording/background behavior remain separate acceptance work.
