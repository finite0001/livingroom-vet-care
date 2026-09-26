# Living Room Vet deployment runbook

## September 25 correction

The [independent commercial audit](launch-evidence/2026-09-25-independent-commercial-audit.md) supersedes the September 24 readiness claims below. The deployed staff-message and public-contact endpoints return 410 despite ACTIVE inventory entries, the production contact form is disabled, direct anonymous inquiry insertion is open through column grants, scheduler workers are unconfigured or disabled, and audited CI failed. Use the [repair progress and release order](launch-evidence/2026-09-25-repair-progress.md) before any staging or production deployment. The older 3/6 gate summary is historical evidence.

## Current rollout direction — September 24, 2026

This section supersedes the September 12 and September 16 commissioning snapshots below. Verify external state again before any production-affecting action; dated receipts are evidence, not permission to skip a fresh check.

- **Primary application backend:** `livingroom-vet-care` / `mgadheotkdnrsatfivjy`, per the owner's approved rollout and `AGENTS.md`. Legacy `ugpyjacqganaqtsiekay` is retained as historical state and is not a target for new application writes.
- **Hosted database state:** the post-PR #204 rollout checkpoint recorded 148 matching migrations, 0 remote-only migrations and 0 local-only migrations. The current local readiness stack has since added two unapplied hosted migrations, `20260924120000` and `20260924130000`. Use `npm run supabase:migration-drift --silent` before and after any schema operation.
- **Public deployment:** Vercel Production is configured for `mgadheotkdnrsatfivjy`; `thelivingroom.vet`, `www.thelivingroom.vet` and `/hub` return HTTP/2 200 over HTTPS. See [public domain HTTPS smoke](launch-evidence/2026-09-24-public-domain-https-smoke.md).
- **Readiness status:** the generated summary records 3/6 gates passing. Hub/frontend workflows, external services/deployment and verification/release control pass. Supabase/database is blocked by the two unapplied readiness migrations; clinical/staff acceptance is blocked by pending clinical decisions, staff run metadata and workflow decisions; public website launch is blocked by owner-approved public-contact content: `phone`, `email` and `emergencyPhone` in `src/config/practice.ts`.
- **Provider gates:** outbound delivery stays disabled by default. Scheduler jobs exist, but DB Vault names `project_url` and `scheduler_worker_key` remain absent, so database cron cannot call scheduler workers until explicit scheduler/provider commissioning. CloudTalk and the public phone number remain deferred.
- **Monitoring:** the `health` Edge Function is deployed with JWT disabled and smoke-tested over GET and HEAD. It proves only that the function and database answer; provider readiness and scheduler health remain staff/admin observations. See [health Edge smoke](launch-evidence/2026-09-24-health-edge-smoke.md).

The September 16 attachment, staging and preview receipts below are historical implementation evidence. Do not use them as current instructions for the primary rollout unless a fresh audit proves they still describe the target state.

## Historical commissioning snapshot

The following September12 notes explain the original setup. Their environment states, counts, provider prerequisites and outstanding-work statements are historical and may be superseded by the current direction and later dated receipts above.

## Confirmed environments (2026-09-12)

- Source: `finite0001/livingroom-vet-care`; foundation branch `codex/practice-foundation`.
- Owned domain: `thelivingroom.vet`. Domain ownership is confirmed by the owner; the three Resend sending records are saved and verified. Website cutover, receiving mailboxes and Auth SMTP remain uncommissioned.
- New dedicated Supabase project: `mgadheotkdnrsatfivjy` / `livingroom-vet-care`, US West, in the owner-approved Camp Sequoia Lake organization. Its data/auth/storage are isolated from the camp projects; organization billing and administrators are shared. Owner approved the quoted $10/month project cost.
- Original Lovable backend as of the September 12 audit: `ugpyjacqganaqtsiekay`. The Supabase connector could not access it; the Lovable connector was subsequently verified to have SQL access (see commercial-readiness.md). Later readiness work moved the tracked local CLI target and Vercel Production browser environment to `mgadheotkdnrsatfivjy`.
- Local validation stack: `/private/tmp/livingroom-vet-foundation`, database port 56322, API port 56321. Disposable synthetic data only; never use its development keys in cloud environments.
- Vercel was available but not yet commissioned in this historical snapshot. Current Vercel/domain state is recorded in the September 24 rollout direction above.

The [clinical-core increment](clinical-core.md) originally brought the dedicated project to 16 migrations. [Hosted schema commissioning](hosted-schema-commissioning.md) subsequently applied the remaining 31 migrations through invoice email: 47 total, with 120 RLS-enabled public tables. Compatible Edge handlers, hosted staff acceptance and the frontend/backend switch remain separate rollout steps.

## Local verification

Use `npm ci`, then `npm run check`. Browser tests: `npx playwright install chromium`, then `npx playwright test`. Tests set synthetic environment values and mock network traffic; do not reuse a running dev server pointed at real data.

The database test file is `supabase/tests/staff_access.test.sql`. Run it only on an isolated database after all migrations. It uses synthetic records inside a transaction and rolls them back. It checks staff gating, metadata role injection, last-admin protection, anonymous contact inserts and removal of TRUNCATE privileges. The migration `20260912193000_explicit_application_grants.sql` is required on fresh projects; RLS policies alone do not confer table access.

## Vercel commissioning

1. Import this GitHub repository into the selected Vercel team; use Vite preset, `npm ci --ignore-scripts`, `npm run build:deployment`, `dist`. Keep the checked-in build command; the guarded command runs Vite only after configuration checks pass.
2. Configure `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` explicitly for each environment. The ignored local `.env` / `.env.local` files are not production configuration templates. Never add service-role/provider secrets to browser variables. See [deployment configuration checks](deployment-environment.md) for exact requirements and limitations.
3. Use a separate staging backend for arbitrary previews, or the isolated local database. Do not point automatically generated previews at a populated production backend. Until a paid staging environment is approved, keep integration tests local and production sending disabled.
4. Test direct entry to `/hub/login`, `/hub/reset-password`, and protected routes. Verify unknown routes render the application 404. Check assets resolve and sign-out/account switches clear cached client records.
5. The custom domain is already attached for the selected Production deployment. Reconfigure DNS or aliases only after a fresh owner/domain review. A preview deployment alone is not commercial launch approval.

## Supabase commissioning

Public self-signup is disabled on the new project. Site URL is `https://thelivingroom.vet`; the exact allowed recovery redirect is `https://thelivingroom.vet/hub/reset-password`. Anonymous sign-in remains disabled and email confirmation remains enabled. No staff accounts have been created.

Apply checked-in migrations in chronological order. Prefer authenticated CLI deployment when available; always specify and verify the target project. Run CLI database operations sequentially because concurrent temporary login-role initialization can invalidate another operation’s credentials. Use `--skip-vault` for schema-only commissioning. The MCP migration tool generates receipt timestamps, so this initial empty-project commissioning reconciles each receipt to the exact repository migration version/name after successful execution. Never replay a migration merely because its receipt timestamp differs: inspect history first. Record any reconciliation in the commissioning report.

The September 24 Edge Function inventory records 35 hosted functions, including the current launch worker/webhook slugs and the public `health` probe. The three server workers use managed secret API-key authentication; staff endpoints retain JWT verification. `send-email` and `send-sms` are retired 410 endpoints directing callers to the reviewed queue workflow. `APP_URL=https://thelivingroom.vet`, `APP_ENV=staging`, and `OUTBOUND_DELIVERY_MODE=disabled` are the intended safe defaults unless a controlled test changes them deliberately. No provider credentials are required for disabled-mode readiness. Deploy only reviewed Edge Functions. `invite-staff` requires fixed `APP_URL` and active-admin authentication. Production Auth SMTP and real invitations are separate operational acceptance steps; configure them using [staff-access.md](staff-access.md). Keep client/provider delivery disabled by default using [messaging-environments.md](messaging-environments.md). Provider round-trips and actual staff workflows remain unverified.

`send-provider-email` and `suggest-replies` remain intentionally not commissioned for launch. Do not enable either until its schema, provider configuration and acceptance evidence are explicitly reviewed.

## Before switching from the old backend

Inventory existing clients, pets, documents, auth users, secrets, scheduled jobs and vendor callbacks through authorized access to the old project. Determine whether data is disposable or needs migration. Export privately, rehearse import, compare row counts/relationships and file checksums, plan password reset where required, and coordinate a writer/send-worker freeze. Update Lovable and Vercel together to the chosen destination only after verification. Never run two delivery workers during cutover.

## Provider setup still required

Follow the [mail commissioning proposal](mail-commissioning-plan.md): preserve verified sending DNS, establish private root-domain staff mailboxes, and commission isolated client receiving and Auth SMTP before publication. The website does not currently publish an unconfigured mailbox. Provision Twilio and SMS consent/opt-out, Stripe account/test keys, and authorized ezyVet API access in their respective services. Keep secrets out of chat and Git. ezyVet is confirmed as the requested API; no API credentials or live source records have been used.

## Uptime monitoring

The `health` Edge Function is a public liveness probe. Point a monitor at:

```
https://<project-ref>.supabase.co/functions/v1/health
```

- **Healthy:** HTTP 200 with `{"status":"ok","checked_at":"…"}`.
- **Not healthy:** HTTP 503 with `{"status":"unavailable","checked_at":"…"}`. The
  body never says why - a public endpoint's error text is reconnaissance, and the
  regression test enforces that it stays absent.
- It answers `GET` and `HEAD` (monitors use both) and refuses anything else with
  405. The response is `no-store`, so a monitor is never shown a cached answer
  from a healthier minute.

**What a 200 proves:** the function is deployed and serving, and the database
answered a query. **What it does not prove:** that providers are configured, that
outbound delivery is enabled, or that the scheduler is running. Those are visible
to administrators on `/hub/admin/operations`, which is where the practice's real
operational state belongs.

Deployed with `verify_jwt = false` on purpose: a monitor holds no credential. Do
not add authentication to it, and do not make it report more than up or down.

Suggested cadence: every minute, alerting after two consecutive failures.
