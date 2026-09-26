# Independent commercial readiness review — September 25, 2026

**Decision: not ready for commercial operation, even with CloudTalk deferred.** The main risks are mismatched deployed code, a contact-intake permission regression, unfinished automation, and failed release checks. This is a targeted repository and hosted-state audit, not certification of every clinical workflow or database routine.

Reviewed repository: `finite0001/livingroom-vet-care`, current fetched `main` at `7eccfaf0a1227358edb44e14cbb725e28fe97298`. Live observations were collected September 25 Pacific / September 26 UTC. Machine-readable observations: [audit snapshot](2026-09-25-independent-commercial-audit.json). Implementation handoff: [bounded repair prompt](2026-09-25-repair-handoff.md).

## Verified baseline

| Area | Observation |
| --- | --- |
| Primary Supabase | `mgadheotkdnrsatfivjy`, ACTIVE_HEALTHY; 148 migration receipts |
| Staging Supabase | `kothoqicubowyhwfsrte`, ACTIVE_HEALTHY; 119 migration receipts |
| Repository migrations | 150; primary missing 2; staging missing 31; neither has remote-only versions |
| Public schema | All 254 ordinary tables have RLS enabled |
| Storage | All 7 buckets are private |
| Deployed functions | 35 deployed versus 48 local entrypoints; presence does not imply matching behavior |
| Public website | Apex and www `/hub` respond over HTTPS; entry bundle targets the intended primary backend, not retained legacy `ugpyjacqganaqtsiekay` |
| Health endpoint | HTTP 200 and successful database ping; only a liveness check |
| Latest main CI | [Run 36082301466](https://github.com/finite0001/livingroom-vet-care/actions/runs/36082301466) failed: 1,081 unit tests passed; browser 448 passed/4 failed; database run reported 4,720 assertions across 118 files with failures in 3 files |

These observations do not establish correct policies on every table, successful production recovery, provider delivery, or clinical acceptance.

## Critical findings — resolve before launch

### C1. Deployed functions do not implement the contracts used by the current application

The downloaded production entrypoints for `enqueue-message`, `public-contact`, `dispatch-outbox`, `process-inbound`, and `queue-reminders` call `serveDisabledLegacyFunction`, returning HTTP 410 for non-OPTIONS requests. Their slugs still appear ACTIVE in the Supabase inventory.

- `src/hub/hooks/use-message-queue.ts:148` invokes `enqueue-message`. The live implementation is a disabled placeholder, so the current staff queue workflow cannot complete through that endpoint.
- The repository contact page uses the verified intake service. Production `public-contact` instead advertises direct `contact_submissions` insertion as its replacement. A read-only GET confirmed HTTP 410. OPTIONS returns 200, so a CORS preflight alone gives misleading reassurance.
- The deployed contact chunk `Contact-C2L79WyR.js` has no configured intake URL and contains an unconditional “The request form is not available yet” failure. Public inquiries are not commercially ready.
- Production `send-email` and `send-sms` version 8 enqueue into `outbound_deliveries`, while their current repository entrypoints explicitly retire those endpoints with HTTP 410. Blindly deploying every local function is therefore not a reviewed repair.
- Seven entrypoints were directly compared: six differed; `dispatch-outbound-deliveries` matched. This is source drift, not just missing configuration.

There are also 13 local functions absent from production. Two are explicitly optional in the inventory (`send-provider-email`, `suggest-replies`). The other 11 include attachment capture/verification/reading, cleanup, and client estimate publication/decision endpoints. Current callers include:

- `src/hub/features/communications/conversation-email-queue.ts:38` → `capture-conversation-email`;
- `src/hub/features/communications/attachment-upload-api.ts:58` → `verify-conversation-attachment`;
- `src/hub/components/conversations/IncomingAttachments.tsx:27` → capture/read inbound attachments;
- `src/hub/features/estimates/publication-api.ts:745` → estimate publication;
- `src/shared/estimate-decision-public-api.ts:81` → public estimate decision.

**Repair:** choose one coherent release contract, map every enabled UI action to its database and Edge dependencies, and prepare an explicit deployment manifest. Compare deployed entrypoints and shared modules with the intended release; deploy and exercise the matching set in staging before production. Mark optional features unavailable until commissioned.

### C2. Anonymous website-inquiry insertion bypasses the verified intake boundary

`supabase/migrations/20260922183000_contact_submission_triage.sql:99` recreates the anonymous INSERT policy; lines 115–122 grant INSERT on `name`, `email`, `phone`, `subject`, and `message` to `anon` and `authenticated`. This reverses the earlier protected intake migration.

Live catalog reads confirm all five column privileges for both roles and the permissive INSERT policy. A table-level privilege check returns false and would miss these column grants. Existing CI actually demonstrates an anonymous insert succeeding where SQLSTATE 42501 was required.

The later trigger limits requests by claimed email and duplicate text, but does not require a verified challenge. It is not equivalent to the configured Turnstile/receipt boundary. Impact is unverified/spam inquiry creation; this audit did not establish anonymous access to read patient records.

The same trigger also conflicts with the existing trusted intake test: repeated accepted payloads used to exercise the hourly budget now abort with a duplicate-submission exception. Preserve idempotency and reconcile the intended rate-limit contract when repairing this.

**Repair:** add a forward migration that revokes both table and column INSERT grants and restores the verified intake path while retaining staff triage. Keep direct anonymous/authenticated/service-role insertion tests and controlled RPC acceptance tests. Do not edit applied migration history or weaken these tests to make CI green.

### C3. The release summary passes checks that have not been established

`scripts/commercial-readiness-summary.mjs:175` derives “Verification/release control” from the Hub artifact and public-site status; it does not consult CI for the reviewed commit. The generated summary reports that gate passing while current main CI is failing.

`scripts/review-remote-edge-functions.mjs` reviews remote-only slugs, so an existing slug whose implementation has been replaced with a disabled placeholder escapes that check. `scripts/supabase-functions-inventory.mjs:10` tests a small expected set rather than all active UI dependencies. This explains why the report's external-services gate can pass despite C1.

The four browser failures all expect the prior named unread-count region. Some assertions need updating for the approved Home redesign, but there is also a real gap: `HubHomePage.tsx:415` only places numeric query results into its attention lists. Failed count queries have no corresponding error/retry row in those lists, unlike the schedule query.

**Repair:** bind readiness to the exact commit/deployment and evidence timestamp, fail on missing/stale/error evidence, validate function content and required behavior, and require the applicable CI gates. Update the browser tests to verify the approved UI while preserving per-user unread counts, loading, error, and retry coverage.

## Warnings — commissioning and acceptance still required

### W1. Database parity and inbound SMS remain unfinished

Primary is missing:

1. `20260924120000_canonical_housecall_appointment_contract.sql`: appointment write/reminder corrections;
2. `20260924130000_inbound_sms_service_rpc_security.sql`: enables the controlled service-role SMS RPC to run with its owner permissions.

Live `record_inbound_sms` is still SECURITY INVOKER, and `service_role` cannot INSERT into `conversations`. The current function creates a conversation for a new thread, so that path cannot complete with the deployed privileges. Its anon/authenticated EXECUTE permissions are correctly denied; the missing change concerns legitimate service execution.

Staging lacks 31 repository versions, including older timestamps interleaved with its applied history. A simple “apply the two newest files” operation cannot bring staging to parity. Inventory and rehearse the actual missing set, preserve existing data and history, and compare definitions/access after upgrading. Receipt counts alone do not prove equivalence.

### W2. Scheduled processing is contained, and scheduler targets conflict with deployed workers

Six cron jobs exist. Vault has neither `project_url` nor `scheduler_worker_key`. Actual last-day application receipts show `configuration_missing` for every dispatch job; meanwhile cron reports no SQL execution failures. Monitor worker outcomes, not only cron's execution status.

Even adding those secrets would not finish the work: scheduled `dispatch-outbox`, `process-inbound`, and `queue-reminders` currently resolve to disabled placeholders, and scheduled `cleanup-abandoned-attachment` is absent from the deployed inventory. The newer `outbound_deliveries` queue requires `dispatch-outbound-deliveries`, whose token/header contract differs from the existing scheduler. No schedule for that worker was found in the repository or inspected database; an external scheduler was not verified.

**Repair:** reconcile queue ownership and scheduler routes/authentication as part of C1. Exercise enqueue → worker → signed callback → visible terminal state with synthetic data and controlled recipients before enabling delivery. Do not infer provider success from HTTP 200 or a queued row.

### W3. Provider, clinical, and staff acceptance is incomplete

The current clinical/staff register has eight clinical decisions and eight staff workflow decisions pending, plus missing operator, date, frontend, and deployment metadata. Use `docs/pre-phone-cloudtalk-acceptance-checklist.md`; do not replace named human decisions with model-generated approvals.

Production invitation/recovery/deactivation, Resend delivery/reply/bounce handling, SMS consent/status behavior, and payment/refund/reconciliation round trips were not accepted in this audit. Repository instructions retain Stripe sandbox-only operation and disabled delivery until separately commissioned. Live payment credentials and runtime gate values were not verified here.

CloudTalk is appropriately deferred. Existing SMS delivery is coded for Twilio, and no CloudTalk runtime integration was found in the reviewed application/Edge source. Finalizing a CloudTalk account does not by itself wire voice, voicemail, SMS, or events into this system; define which provider owns each channel before implementing that step. Ongoing ezyVet integration is retired by project direction and is not a launch blocker.

Public phone, email, and emergency phone remain null in `src/config/practice.ts`. Phone can wait for CloudTalk; email and emergency contact content need owner confirmation independently.

### W4. Hosted recovery and operational alerting are not established

The September 24 restore evidence is a useful 148-migration local synthetic rehearsal including private Storage bytes, Auth mapping, and permission comparisons. It explicitly excludes hosted PITR acceptance and production recovery objectives.

Confirm hosted backup retention/restore points, ownership and backup of actual private Storage files, restore access, recovery objectives, and alert delivery to the responsible operator. Rehearse the final release schema. A working `/health` endpoint does not verify that an external monitor is configured or that staff will receive an alert.

## Security follow-up

Supabase reports leaked-password protection disabled and `pg_net` in the public schema. Its many “RLS enabled, no policy” and SECURITY DEFINER execution advisories require contextual review: this application deliberately uses restricted tables and guarded RPCs. Do not mass-add permissive policies or replace all definer functions.

References: [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), [extension placement](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public), [anonymous definer execution](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).

## Recommended sequence and model use

1. Fix C2 and the Home/error/readiness regressions on isolated branches; retain the failing security assertions.
2. Produce and review one coherent frontend/database/Edge/scheduler release manifest, accounting for missing attachment and estimate functions.
3. Rehearse the staging upgrade and restore; deploy the reviewed set to staging and verify actual workflows.
4. Run the controlled provider/staff loop and collect clinical decisions. Commission production recovery and monitoring.
5. Roll out the accepted release, then commission CloudTalk/public phone and any approved live payment/message gates separately.

A cheaper model is suitable for bounded implementation tasks with explicit ownership and tests. Database permissions, shared release composition, provider activation, and final sign-off should receive central review. The accompanying handoff prevents several agents from making incompatible changes to the same migrations or queue architecture.

## Audit limits and changes

This review used fetched GitHub source/CI logs, live Supabase metadata/catalog reads, selected deployed source comparisons, public HTTP checks, served-bundle inspection, and the existing acceptance/readiness generators. It did not rerun the entire automated suite or test real patient records, live charges, or customer delivery. No hosted migrations, configuration changes, messages, or synthetic hosted records were created. Only this report, the sanitized snapshot, and the handoff were added locally; nothing was committed or published.

Findings: **3 critical, 4 warnings, and the security follow-up above.**
