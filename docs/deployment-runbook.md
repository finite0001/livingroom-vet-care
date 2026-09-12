# Living Room Vet deployment runbook

## Confirmed environments (2026-09-12)

- Source: `finite0001/livingroom-vet-care`; foundation branch `codex/practice-foundation`.
- Owned domain: `thelivingroom.vet`. Domain ownership is confirmed by the owner; DNS cutover and email domain verification are not yet performed.
- New dedicated Supabase project: `mgadheotkdnrsatfivjy` / `livingroom-vet-care`, US West, in the owner-approved Camp Sequoia Lake organization. Its data/auth/storage are isolated from the camp projects; organization billing and administrators are shared. Owner approved the quoted $10/month project cost.
- Original Lovable backend: `ugpyjacqganaqtsiekay`. The Supabase connector cannot access it; the Lovable connector was subsequently verified to have SQL access (see commercial-readiness.md). No data was copied or connection changed; current `.env` and `supabase/config.toml` still identify the original backend.
- Local validation stack: `/private/tmp/livingroom-vet-foundation`, database port 56322, API port 56321. Disposable synthetic data only; never use its development keys in cloud environments.
- Vercel team is available; project deployment has not yet been commissioned. `vercel.json` provides npm build and SPA rewrites.

The subsequent [clinical-core increment](clinical-core.md) adds migration `20260912210000` to the dedicated project (16 total). Its new frontend requires this migration on the active application backend before rollout.

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

Apply checked-in migrations in chronological order. Prefer authenticated CLI deployment when available; always specify and verify the target project. The MCP migration tool generates receipt timestamps, so this initial empty-project commissioning reconciles each receipt to the exact repository migration version/name after successful execution. Never replay a migration merely because its receipt timestamp differs: inspect history first. Record any reconciliation in the commissioning report.

The new project has reviewed `invite-staff`, `send-email`, and `send-sms` functions deployed with JWT verification enabled. `APP_URL=https://thelivingroom.vet`, `APP_ENV=staging`, and `OUTBOUND_DELIVERY_MODE=disabled` are saved. No provider credentials were installed. Deploy only reviewed Edge Functions. `invite-staff` requires fixed `APP_URL` and active-admin authentication. Auth SMTP and real invitations are a separate operational acceptance step; configure them using [staff-access.md](staff-access.md). Keep client/provider delivery disabled by default using [messaging-environments.md](messaging-environments.md). No outbox/inbound/callback capability is implied by deployment of an outbound endpoint.

`send-provider-email` still references provider contact/delivery tables absent from the baseline. Do not enable or deploy that endpoint until its schema contract is implemented and tested. `suggest-replies` requires its own AI provider configuration; it is not needed for the foundation release.

## Before switching from the old backend

Inventory existing clients, pets, documents, auth users, secrets, scheduled jobs and vendor callbacks through authorized access to the old project. Determine whether data is disposable or needs migration. Export privately, rehearse import, compare row counts/relationships and file checksums, plan password reset where required, and coordinate a writer/send-worker freeze. Update Lovable and Vercel together to the chosen destination only after verification. Never run two delivery workers during cutover.

## Provider setup still required

Verify the practice's sending/receiving domain; establish the intended shared mailbox, e.g. `hello@thelivingroom.vet`, only after mailbox provisioning. The website does not currently publish an unconfigured mailbox. Provision Twilio and SMS consent/opt-out, Stripe account/test keys, and authorized ezyVet API access in their respective services. Keep secrets out of chat and Git. ezyVet is confirmed as the requested API; no API credentials or live source records have been used.
