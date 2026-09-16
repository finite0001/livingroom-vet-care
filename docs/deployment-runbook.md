# Living Room Vet deployment runbook

## Current rollout direction — September 16, 2026

This section supersedes the September12 commissioning snapshot below. Verify external state again before deployment; these repository receipts describe past checks, not a fresh live audit.

- **Primary application backend:** `livingroom-vet-care` / `mgadheotkdnrsatfivjy`, per the owner's approved rollout and `AGENTS.md`. Legacy `ugpyjacqganaqtsiekay` is retained, not a target for new application writes. Verify the project reference before every CLI/MCP operation; Lovable's retained Cloud panel is not proof of the selected application backend.
- **Recorded public release:** [September15 live readiness release](live-readiness-release-20260915.md) published `codex/lovable-publication` revision `c5cd483` through Lovable. Its recorded served bundle used the primary backend; `/hub` redirected unauthenticated visitors to login. This supersedes the historical claim that website cutover had not occurred.
- **Staging is separate:** the [pilot staging receipt](pilot-staging-deployment-20260915.md) identifies backend `kothoqicubowyhwfsrte` and the protected Vercel preview. That receipt's migration count is historical. Inspect the current migration ledger, take the required backup and rehearse the actual upgrade path; never infer staging/primary parity from a count in an older document.
- **Standalone practice platform:** [September16 direction](standalone-platform-direction-20260916.md) stops further ezyVet synchronization, write-back, registration and migration-report development. Preserve source evidence and existing credentials; provider import/write gates remain disabled. Historical ezyVet commissioning below is not a standalone launch requirement.
- **Provider gates:** Stripe remains sandbox-only. Email/SMS delivery and new attachment capture/cleanup remain separately commissioned capabilities, not automatically enabled by a frontend publication. Production contact verification is still an open gate in the last recorded public release; do not bypass it.
- **Attachment release status:** PRs150→152→153→156 are dependent candidates. PRs152/153 are ready for review, not merged/deployed. PR156 has verified incoming-file milestones, but its latest cleanup/discovery/concurrency candidate requires its own completed CI and hosted acceptance. See [attachment cleanup operations](attachment-cleanup-operations.md) and the [feature matrix](standalone-feature-matrix-20260916.md).

For the next publication, resolve the dependency stack into the intended Lovable-synced branch, verify the resulting revision, back up and rehearse the exact target database upgrade, deploy compatible reviewed Edge handlers with gates disabled, run hosted authenticated/unauthenticated checks, and then publish and inspect the served frontend. Do not treat a green child PR as evidence that its parent chain is already published. Keep legacy data intact and preserve the clinical/provider acceptance gates in the comprehensive readiness tracker.

## Historical commissioning snapshot

The following September12 notes explain the original setup. Their environment states, counts, provider prerequisites and outstanding-work statements are historical and may be superseded by the current direction and later dated receipts above.

## Confirmed environments (2026-09-12)

- Source: `finite0001/livingroom-vet-care`; foundation branch `codex/practice-foundation`.
- Owned domain: `thelivingroom.vet`. Domain ownership is confirmed by the owner; the three Resend sending records are saved and verified. Website cutover, receiving mailboxes and Auth SMTP remain uncommissioned.
- New dedicated Supabase project: `mgadheotkdnrsatfivjy` / `livingroom-vet-care`, US West, in the owner-approved Camp Sequoia Lake organization. Its data/auth/storage are isolated from the camp projects; organization billing and administrators are shared. Owner approved the quoted $10/month project cost.
- Original Lovable backend: `ugpyjacqganaqtsiekay`. The Supabase connector cannot access it; the Lovable connector was subsequently verified to have SQL access (see commercial-readiness.md). No data was copied or connection changed; current `.env` and `supabase/config.toml` still identify the original backend.
- Local validation stack: `/private/tmp/livingroom-vet-foundation`, database port 56322, API port 56321. Disposable synthetic data only; never use its development keys in cloud environments.
- Vercel team is available; project deployment has not yet been commissioned. `vercel.json` provides npm build and SPA rewrites.

The [clinical-core increment](clinical-core.md) originally brought the dedicated project to 16 migrations. [Hosted schema commissioning](hosted-schema-commissioning.md) subsequently applied the remaining 31 migrations through invoice email: 47 total, with 120 RLS-enabled public tables. Compatible Edge handlers, hosted staff acceptance and the frontend/backend switch remain separate rollout steps.

## Local verification

Use `npm ci`, then `npm run check`. Browser tests: `npx playwright install chromium`, then `npx playwright test`. Tests set synthetic environment values and mock network traffic; do not reuse a running dev server pointed at real data.

The database test file is `supabase/tests/staff_access.test.sql`. Run it only on an isolated database after all migrations. It uses synthetic records inside a transaction and rolls them back. It checks staff gating, metadata role injection, last-admin protection, anonymous contact inserts and removal of TRUNCATE privileges. The migration `20260912193000_explicit_application_grants.sql` is required on fresh projects; RLS policies alone do not confer table access.

## Vercel commissioning

1. Import this GitHub repository into the selected Vercel team; use Vite preset, `npm ci --ignore-scripts`, `npm run build:deployment`, `dist`. Keep the checked-in build command; the guarded command runs Vite only after configuration checks pass.
2. Configure `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` explicitly for each environment. The tracked Lovable `.env` is not a production configuration template. Never add service-role/provider secrets to browser variables. See [deployment configuration checks](deployment-environment.md) for exact requirements and limitations.
3. Use a separate staging backend for arbitrary previews, or the isolated local database. Do not point automatically generated previews at a populated production backend. Until a paid staging environment is approved, keep integration tests local and production sending disabled.
4. Test direct entry to `/hub/login`, `/hub/reset-password`, and protected routes. Verify unknown routes render the application 404. Check assets resolve and sign-out/account switches clear cached client records.
5. Configure the custom domain only after owner content and DNS review. Preview deployment is not the October clinical launch.

## Supabase commissioning

Public self-signup is disabled on the new project. Site URL is `https://thelivingroom.vet`; the exact allowed recovery redirect is `https://thelivingroom.vet/hub/reset-password`. Anonymous sign-in remains disabled and email confirmation remains enabled. No staff accounts have been created.

Apply checked-in migrations in chronological order. Prefer authenticated CLI deployment when available; always specify and verify the target project. Run CLI database operations sequentially because concurrent temporary login-role initialization can invalidate another operation’s credentials. Use `--skip-vault` for schema-only commissioning. The MCP migration tool generates receipt timestamps, so this initial empty-project commissioning reconciles each receipt to the exact repository migration version/name after successful execution. Never replay a migration merely because its receipt timestamp differs: inspect history first. Record any reconciliation in the commissioning report.

The dedicated project now has [13 reviewed handlers deployed](hosted-edge-commissioning.md). The three server workers use managed secret API-key authentication; staff endpoints retain JWT verification. `send-email` and `send-sms` are retired 410 endpoints directing callers to the reviewed queue workflow. `APP_URL=https://thelivingroom.vet`, `APP_ENV=staging`, and `OUTBOUND_DELIVERY_MODE=disabled` are saved. No provider credentials were installed. Deploy only reviewed Edge Functions. `invite-staff` requires fixed `APP_URL` and active-admin authentication. Auth SMTP and real invitations are a separate operational acceptance step; configure them using [staff-access.md](staff-access.md). Keep client/provider delivery disabled by default using [messaging-environments.md](messaging-environments.md). Hosted probes verify unauthorized denial, disabled delivery/scheduling and an authenticated empty inbound queue. Provider round-trips and actual staff workflows remain unverified.

`send-provider-email` still references provider contact/delivery tables absent from the baseline. Do not enable or deploy that endpoint until its schema contract is implemented and tested. `suggest-replies` requires its own AI provider configuration; it is not needed for the foundation release.

## Before switching from the old backend

Inventory existing clients, pets, documents, auth users, secrets, scheduled jobs and vendor callbacks through authorized access to the old project. Determine whether data is disposable or needs migration. Export privately, rehearse import, compare row counts/relationships and file checksums, plan password reset where required, and coordinate a writer/send-worker freeze. Update Lovable and Vercel together to the chosen destination only after verification. Never run two delivery workers during cutover.

## Provider setup still required

Follow the [mail commissioning proposal](mail-commissioning-plan.md): preserve verified sending DNS, establish private root-domain staff mailboxes, and commission isolated client receiving and Auth SMTP before publication. The website does not currently publish an unconfigured mailbox. Provision Twilio and SMS consent/opt-out, Stripe account/test keys, and authorized ezyVet API access in their respective services. Keep secrets out of chat and Git. ezyVet is confirmed as the requested API; no API credentials or live source records have been used.
