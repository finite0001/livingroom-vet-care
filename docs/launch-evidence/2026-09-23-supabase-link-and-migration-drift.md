# 2026-09-23 release-target evidence

Scope: release-control evidence after retargeting the repository from the original Lovable backend to the approved dedicated Supabase project and refreshing Vercel/domain inventory. This is not a hosted launch or production cutover.

## Actions

- Updated `supabase/config.toml` to target `mgadheotkdnrsatfivjy` (`livingroom-vet-care`).
- Ran `npx supabase link --project-ref mgadheotkdnrsatfivjy`; the CLI returned the expected project ref.
- Ran a redacted `npx supabase status --output json`; the command now reaches the `mgadheotkdnrsatfivjy` local stack instead of failing on the old `ugpyjacqganaqtsiekay` stack.
- Ran `npx supabase migration list`; the command now connects to the remote project and exposes migration drift.
- Added and ran `npm run supabase:migration-drift` as a repeatable read-only drift summary.
- Added and ran `npm run supabase:migration-file-search` as a bounded read-only search for remote-only migration files in likely Living Room Vet worktrees. The generated artifact records grouped version/path evidence without SQL contents.
- Added and ran `npm run supabase:migration-source-compare` as a read-only hash comparison between the two complete candidate recovery roots.
- Added and ran `npm run supabase:migration-restore` first in dry-run mode, then with `--apply`, restoring 96 verified historical migration files into this worktree from `/Users/davidedler/Developer/livingroom-readiness-reconciliation/supabase/migrations`.
- Added and ran `npm run readiness:inventory -- --output docs/launch-evidence/2026-09-23-hosted-readiness-inventory.json` as a repeatable read-only hosted readiness snapshot. The generated artifact redacts Vercel environment values and records the current git state, Supabase migration drift, Vercel project/env/domain status, and DNS targets.
- Added and ran `npm run supabase:schema-inventory -- --output docs/launch-evidence/2026-09-23-remote-public-schema-inventory.json` as a repeatable read-only remote public-schema inventory. The generated artifact records object names/counts and readiness-object presence; it intentionally does not commit raw schema SQL.
- Added and ran `npm run supabase:functions-inventory -- --output docs/launch-evidence/2026-09-23-edge-functions-inventory.json` as a repeatable read-only hosted Edge Function inventory. The generated artifact records local slugs, remote slugs, JWT mode, status, version, and expected readiness-function presence while omitting deployment hashes and source paths.
- Added and ran `npm run public:readiness -- --output docs/launch-evidence/2026-09-23-public-site-readiness.json` as a repeatable public website launch gate. The generated artifact checks owner contact fields, emergency/contact-form disclaimers, robots/sitemap route coverage, and risky public claims that need owner/veterinarian approval.
- Added and ran `npm run hub:readiness -- --output docs/launch-evidence/2026-09-23-hub-workflow-readiness.json` as a repeatable Hub workflow gate. The generated artifact checks the contact-inbox, appointment, and delivery-ops route/nav/page/hook wiring, then cross-checks hosted schema/function inventories for required backend dependencies.
- Added and ran `npm run readiness:summary -- --output docs/launch-evidence/2026-09-23-commercial-readiness-summary.json` as the aggregate commercial-readiness gate. The generated artifact picks the latest matching evidence artifacts and rolls them into Supabase/database, Hub/frontend, external services, public website, and release-control gates.
- Added and ran `npm run readiness:refresh` as the ordered evidence refresh command. It regenerates hosted inventory, remote-only migration file search, migration source comparison, remote schema inventory, Edge Function inventory, public-site readiness, Hub workflow readiness, the aggregate commercial-readiness summary, and `2026-09-23-readiness-refresh.json`.
- Ran `npx supabase test db`; the command reaches the local DB, but the current local DB is not replayed to the new commercial-readiness schema.
- Pushed the 10 local commercial-readiness migrations to hosted Supabase project `mgadheotkdnrsatfivjy` with `npx supabase db push --linked --skip-vault --yes`.
- Redeployed `send-email` and `send-sms`, then deployed `dispatch-outbound-deliveries`, `resend-delivery-webhook`, `twilio-message-status-callback`, and `twilio-inbound-sms` with expected JWT settings.
- Added and ran `npm run supabase:functions-review` as a non-destructive remote-only Edge Function review. It downloads remote-only source to a temporary directory, records hashes/classification, and deletes the downloaded source.
- Ran a non-destructive hosted scheduler check: `cron.job` does not exist on the linked hosted database.
- Deployed disabled stubs for former legacy conflict slugs `dispatch-outbox`, `enqueue-message`, `process-inbound`, `public-contact`, `queue-reminders`, `resend-webhook`, and `twilio-webhook`. These return HTTP 410 with replacement-route hints instead of executing legacy worker/webhook/contact behavior.
- Added Vercel Production browser env vars for the dedicated Supabase backend, ran a fresh Vercel Production deployment, and attached `thelivingroom.vet` plus `www.thelivingroom.vet` to the Vercel project.

## Current post-deployment state

After the hosted migration/function/Vercel work on 2026-09-23:

- Supabase migration drift: 123 matching, 0 remote-only, 0 local-only.
- Supabase readiness schema inventory: required launch table/RPC/trigger objects are present.
- Reviewed launch Edge Functions are active remotely with expected JWT modes.
- Hub workflow readiness: `local-hub-ready` and `hosted-dependencies-ready`.
- Vercel Production browser env vars are present for `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_SUPABASE_PROJECT_ID`.
- Vercel Production deployment `dpl_EnvwqCoXkakCik1Sd6A7yyq6kxAY` is `READY`.
- `thelivingroom.vet` and `www.thelivingroom.vet` are attached to the Vercel project, and Vercel reports both domains `configured_correctly` after the GoDaddy DNS update. HTTP served from Vercel immediately; HTTPS still needs a follow-up smoke check after certificate provisioning.
- Aggregate readiness remains blocked with 4 of 5 gates passing. The remaining blocker is owner-approved public phone, email, emergency instructions and hours.

## Migration inventory

Current `npx supabase migration list` / `npm run supabase:migration-drift` summary after historical migration restore:

- 123 migration versions exist both locally and remotely.
- 0 remote migration receipts are missing from this worktree.
- 0 local migration files are unapplied remotely.

Before restoration, the remote-only receipts ranged from `20260912230000` through `20260916020000`. They are now present in this worktree, so hosted ledger reconciliation no longer depends on destructive migration repair or inference from receipt IDs.

Bounded migration-file search captured in `2026-09-23-remote-only-migration-file-search.json` initially found local files for all 96 remote-only versions in likely Living Room Vet worktrees:

- Remote-only versions matched: 96 of 96.
- Still missing after bounded search: 0.
- Complete candidate recovery roots identified by follow-up review: `/Users/davidedler/Developer/livingroom-readiness-reconciliation/supabase/migrations` and `/Users/davidedler/Developer/livingroom-readiness-weight/supabase/migrations`.
- `2026-09-23-remote-only-migration-source-comparison.json` confirmed both candidate roots contain all 96 remote-only versions with 0 missing files and 0 SHA-256 mismatches.
- `2026-09-23-remote-only-migration-restore.json` records the applied restore: 96 planned, 96 restored, 0 already present, and 0 missing from source.
- The post-restore refresh records `no-remote-only-receipts` for the migration file search and source comparison steps because the active worktree now contains those files.

The 10 local-only commercial-readiness migrations were subsequently applied to hosted Supabase. Current migration drift is 123 matching, 0 remote-only, and 0 local-only.

## Official local DB test result

`npx supabase test db` currently fails against the running local `mgadheotkdnrsatfivjy` stack because the database does not contain the newer local readiness migrations. Representative failures:

- `save_appointment(...)` and `cancel_appointment(...)` are absent for `appointments_write_safety.test.sql`.
- Contact triage columns such as `triage_status` are absent.
- Inbound SMS provider/idempotency columns and `record_inbound_sms(...)` are absent.
- `outbound_deliveries` and staff outbox RPCs are absent.
- The older `staff_access.test.sql` still expects anonymous contact inserts that the newer triage hardening changes.

This is useful evidence: the old local-network blocker is resolved, but full local pgTAP cannot be treated as green until the local stack is reset/replayed or an isolated disposable stack is used.

## Current release-control conclusion

- CLI target/link: points at the approved dedicated project.
- Browser/runtime cutover: Vercel Production envs point at the dedicated project; public DNS points at Vercel and Vercel verifies both custom domains. HTTPS certificate readiness still needs a follow-up smoke check.
- Hosted migration reconciliation: complete for current worktree/hosted ledger, with 123 matching and no local/remote drift.
- Full local DB suite: preflight is green for application checks; focused rollback/disposable-stack pgTAP remains the strongest database-test evidence for the new migrations until a clean local stack replay is performed.

## Remote public-schema inventory

Read-only schema inventory captured on 2026-09-23 from the linked hosted project:

- Public schema object counts: 200 tables, 1 view, 550 functions, 242 policies, 278 triggers, and 109 indexes.
- Commercial-readiness table presence: `public.outbound_deliveries` is present remotely.
- Commercial-readiness RPC presence: `public.cancel_appointment`, `public.cancel_outbound_delivery`, `public.claim_due_outbound_deliveries`, `public.enqueue_staff_outbound_message`, `public.guard_contact_submission`, `public.normalize_sms_phone`, `public.record_inbound_sms`, `public.record_outbound_delivery_callback`, `public.record_outbound_delivery_result`, `public.retry_outbound_delivery`, and `public.save_appointment` are present remotely.
- Commercial-readiness trigger presence: `trg_create_appointment_reminders` and `guard_contact_submission` are present remotely.

This confirms that the hosted public schema contains the audited operating-loop objects that local Hub and messaging code now expects.

## Hosted Edge Function inventory

Read-only function inventory captured on 2026-09-23 from the linked hosted project:

- Local repository function slugs: 16.
- Hosted remote function slugs: 34.
- Readiness functions active remotely with expected JWT mode: `invite-staff`, `send-email`, `send-sms`, `dispatch-outbound-deliveries`, `resend-delivery-webhook`, `twilio-message-status-callback`, and `twilio-inbound-sms`.
- Former launch-conflict slugs `dispatch-outbox`, `enqueue-message`, `process-inbound`, `public-contact`, `queue-reminders`, `resend-webhook`, and `twilio-webhook` are deployed as explicit disabled stubs returning HTTP 410 with replacement-route hints.
- Local-only functions also include `send-provider-email` and `suggest-replies`, which remain intentionally not commissioned for launch.

This confirms the hosted function layer is cut over for the audited launch-critical operating-loop implementation. Provider dashboards and schedulers still need separate review before live messaging.

## Vercel/domain refresh

Read-only Vercel CLI evidence captured on 2026-09-23 after the DNS and Production environment update:

- `npx --yes vercel whoami` returned `finite0001`.
- `npx --yes vercel project inspect livingroom-vet-care` found project `daves-projects-e0da43ba/livingroom-vet-care`, Node.js `24.x`, framework preset `Vite`, build command `npm run build:deployment`, output directory `dist`, and install command `npm ci --ignore-scripts`.
- `npx --yes vercel env ls` showed Production `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_SUPABASE_PROJECT_ID` values present, redacted in the evidence artifact.
- Vercel domain verification returned `configured_correctly` for both `thelivingroom.vet` and `www.thelivingroom.vet`.
- `dig +short A thelivingroom.vet` returned `216.150.1.1` and `216.150.16.1`; `dig +short CNAME www.thelivingroom.vet` returned `1115926f442091d7.vercel-dns-016.com.`.
- HTTP served the Vercel site on both custom domains immediately; HTTPS returned an SSL handshake error during the same run and should be re-smoked after Vercel certificate provisioning catches up.

Current Vercel conclusion:

- Vercel project settings match the repository build contract.
- Production browser envs are commissioned for the dedicated Supabase project.
- The owned domain is attached and Vercel-verified for this project.
- Public SEO/canonical assets should not be treated as launch-approved until owner contact content is filled and HTTPS is re-smoked.

## Public website readiness

Read-only public website readiness audit captured on 2026-09-23:

- Status: not launch-ready.
- Route/SEO coverage: 14 public route metadata entries and 14 sitemap entries; Hub routes are disallowed in `robots.txt`.
- Blockers: practice phone, email, emergency phone, and hours are intentionally unset in `src/config/practice.ts`.
- Warnings: none after softening unapproved service-timing and diagnostic-capability claims in the public service pages.

This confirms the public site has a strong prelaunch structure, but it is not ready for domain cutover until owner contact details, emergency instructions, and hours are resolved.

## Hub workflow readiness

Read-only Hub workflow readiness audit captured on 2026-09-23:

- Local Hub status: `local-hub-ready`.
- Workflows checked: contact submission triage, appointment create/edit/cancel, and outbound delivery operations.
- Local wiring: required pages, hooks, protected routes, desktop navigation, and mobile navigation are present for all three workflows.
- Hosted dependency status: `hosted-dependencies-ready`.
- Hosted blockers: none in the current Hub workflow readiness artifact.

This confirms the Hub UI and hosted dependencies are ready for the audited workflows. Production use still depends on staff/Auth acceptance, provider commissioning, monitoring, and restore proof.

## Aggregate commercial-readiness gate

Latest aggregate readiness summary captured on 2026-09-23:

- Overall status: blocked.
- Gates passing: 4 of 5.
- Passing gates: Supabase/database operating loop, Hub/frontend workflow readiness, external services/deployment readiness, and verification/release control.
- Blocked gates:
  - Public website launch readiness: owner phone, email, emergency phone, and hours are unset.

This aggregate gate should remain blocked until each underlying evidence artifact is refreshed and every gate passes.

## Ordered readiness refresh

`npm run readiness:refresh` completed on 2026-09-23:

- Hosted readiness inventory: passed.
- Remote-only migration file search: passed; post-restore status is `no-remote-only-receipts`.
- Remote-only migration source comparison: passed; post-restore status is `no-remote-only-receipts`.
- Remote public-schema inventory: passed.
- Edge Function inventory: passed.
- Remote-only Edge Function review: passed in evidence mode; after deploying disabled legacy stubs, no remote-only launch blockers remain.
- Public-site readiness audit: passed in evidence mode.
- Hub workflow readiness audit: passed in evidence mode.
- Aggregate commercial-readiness summary: passed in evidence mode.
- Aggregate launch status after refresh: blocked, with 4 of 5 gates passing and 1 blocked.

Use this command before any future launch review so the summary reflects a fresh, ordered evidence chain.
