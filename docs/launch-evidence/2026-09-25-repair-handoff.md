# Bounded implementation prompt

Copy the prompt below into Kimi or another coding agent with repository access. Supply the audit Markdown and JSON alongside it if these uncommitted files are not present in that checkout.

---

Review and repair `finite0001/livingroom-vet-care` for commercial launch with CloudTalk deferred. Read repository AGENTS.md and `docs/launch-evidence/2026-09-25-independent-commercial-audit.md` plus its JSON snapshot first. Audit baseline is main `7eccfaf0a1227358edb44e14cbb725e28fe97298`; fetch current main and account for any later changes before editing.

Use a coordinator and at most three implementation agents in separate git worktrees. All agents share responsibility for preserving others' edits. Assign exclusive file ownership; only the database agent may create migrations or edit SQL tests. Resolve shared architecture decisions centrally before parallel edits. Avoid reviewing all historical ezyVet code or undertaking visual redesigns.

This task authorizes local repairs, tests, a release plan, and draft PR preparation. Do not apply hosted SQL, deploy, enable delivery/payments, send messages, rotate credentials, reset a shared database, rewrite applied migrations, or merge/publish automatically. Use disposable local databases and synthetic fixtures. Never include credentials or client data in output. Missing provider access is an explicit unverified item, never a pass. Preserve standalone operation and deferred CloudTalk; do not restart ezyVet synchronization.

Known facts to reproduce:

- Latest audited main CI run 36082301466 failed. Unit tests: 1,081 pass. Browser: 448 pass/4 failures in commissioned-navigation. Database: failures in public_intake, staff_access, website_inquiries, including successful direct anonymous INSERT where 42501 was expected.
- Production has 148 migrations; repository 150. Missing production versions are 20260924120000 and 20260924130000. Staging has 119 versions with 31 gaps, some interleaved. Use the JSON list and fresh reads if available.
- Migration 20260922183000 restores INSERT column grants and an INSERT RLS policy for anon/authenticated on contact_submissions, reversing the verified intake boundary. Table-level privilege checks alone miss it.
- Deployed enqueue-message, public-contact, dispatch-outbox, process-inbound, queue-reminders are HTTP 410 placeholders, despite ACTIVE inventory status. Current messaging invokes enqueue-message. Production send-email/send-sms differ from local retired stubs. Do not blindly redeploy all functions.
- Thirteen local functions are absent from production. Only send-provider-email and suggest-replies are explicitly optional in the existing inventory. Other gaps include attachment capture/verification/reading, cleanup, and estimate publication/client decision endpoints.
- Existing cron targets older workers; newer outbound_deliveries uses dispatch-outbound-deliveries with a different token/header. No schedule for the latter was found. Vault scheduler configuration is absent, and worker receipts show configuration_missing.
- The production contact form has no configured intake URL, and public-contact returns 410. OPTIONS 200 is not functional acceptance.
- Readiness reports can pass release control without checking actual CI, and function review ignores source drift under existing slugs.

Agent A — database/intake owner:

1. Reproduce the three failing SQL suites in a disposable database using the full migration chain.
2. Add a forward migration to close both table- and column-level direct INSERT access to contact_submissions for public/anon/authenticated/service_role. Preserve trusted definer RPC intake, staff triage, audit attribution, receipt recovery, and idempotency.
3. Reconcile duplicate/rate-limit behavior with existing protected intake tests; preserve meaningful abuse protection. Add only tests that catch the actual regression.
4. Review the two pending migration contracts and prepare an exact staging upgrade/recovery plan. Do not execute hosted changes. Verify permission behavior with anon, nonstaff authenticated, staff, and service roles.

Agent B — Home frontend/browser owner:

1. Reproduce the four commissioned-navigation failures against the approved Home redesign.
2. Restore explicit pending/error/retry states for unread and other attention counts; do not silently hide failed queries or interpret them as zero.
3. Update accessible test selectors for the approved UI while preserving checks for per-user unread state, authorization, mobile navigation, and retry recovery. No test deletion or arbitrary timeout inflation.
4. Run the focused browser suite and frontend checks. Preserve project semantic tokens and StatusChip conventions.

Agent C — release tooling/evidence owner:

1. Map every enabled workflow to frontend callers, database RPCs/grants, Edge entrypoints/shared modules, scheduler routes/authentication, and provider callback dependencies. Distinguish required from deliberately deferred features.
2. Make readiness fail on absent, stale, failed, or mismatched evidence. Bind release control to an exact SHA and successful required checks; a function's name/ACTIVE status cannot prove behavior. Compare source or a reviewed artifact manifest for existing deployed slugs too.
3. Keep “contained for testing,” “deployed,” “provider accepted,” and “commercial ready” separate. A disabled worker must not satisfy a functional delivery gate.
4. Add focused regression tests for missing/invalid evidence and disabled/mismatched runtime contracts. Prepare a staging-first deployment manifest, including attachment/estimate dependencies or explicit UI commissioning gates.

Coordinator — queue/runtime decisions and integration:

Decide the supported queue architecture from current callers, immutable artifact requirements, consent, replay, and provider contracts. Resolve communication_outbox versus outbound_deliveries and corresponding workers centrally. Give follow-up implementation tasks only after selecting a coherent design; do not let agents independently retire each other's APIs. Include scheduler routing and authentication, attachment preservation, callbacks, reminder enqueueing, and recovery after uncertain responses. Keep live send gates closed.

Acceptance:

- `npm run check` and affected browser tests pass; full required GitHub gates must eventually pass on the integrated commit.
- Full local pgTAP suite passes; run actual HTTP/Auth/Storage and concurrency tests relevant to any changed contracts.
- A synthetic local workflow exercises household/patient → housecall → signed record/addendum → stock/treatment → invoice → sandbox payment/callback simulation → document/estimate → queue/worker/callback. Record what was executed versus inferred.
- Frontend, database, and Edge deployment requirements agree. Report remaining hosted/provider/human steps without marking them complete.
- Clinical/staff acceptance register remains pending until actual named reviewers supply decisions. CloudTalk remains deferred. Real Stripe activation, hosted recovery settings, public contacts, and production SMTP/delivery must be independently commissioned.

Deliver small reviewable commits, an integrated test report with exact commands/results/SHA, and a concrete deployment/recovery checklist with remaining blockers. Summarize changed files and unresolved risks. Do not claim commercial readiness from a build, inventory count, mocked callback, or local fixture alone.
