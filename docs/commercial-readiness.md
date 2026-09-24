# Commercial-readiness evidence tracker

Goal: complete all requested practice software and website components, then perform one coordinated rollout. Stacked PRs are implementation increments; merging them is not evidence that a commercial launch is ready. The original scope is preserved below.

## User requirements

| Requirement | Current evidence | Still required for acceptance |
| --- | --- | --- |
| Client name/address/phone/email | PR2 household create/edit/search, separate mailing/housecall addresses, duplicate review tests | Multiple contacts, owner review, hosted staff test |
| Pet name/age/species/breed/weight/birthday/color/microchip | PR2 patient workspace, exact/estimated/unknown dates, dated units, mobile persistence test | Hosted clinician review, controlled merge/ownership workflow |
| Vaccine upcoming/last dates | Legacy `pet_vaccinations` schema only | Administration workflow, due logic, patient display and acceptance |
| SOAP records | PR2 versioned save/sign/addenda and concurrency/immutability tests | Full clinical acceptance, document exports and restore proof |
| Important historical diagnoses highlighted red | PR2 problem history and prominent red/icon/text flags | Propagation into booking/medication/vaccine/export workflows |
| Text/email with records and labs | Existing outbound handlers + disabled/test/live guard, truthful outcomes; staff client sends now enqueue into durable outbox; worker claim/result/callback RPCs have pgTAP coverage; local dispatcher, signed provider-webhook bridges, signed inbound SMS handling, Hub delivery visibility, and guarded retry/cancel controls exist | Reconciliation workflows, deployment/registration of provider webhooks, provider-document outbox/authorized packages, controlled provider round-trips, inbound email/voice coverage |
| Standard and per-patient vaccine/lab reminders | Legacy reminder tables only | Configurable due engine, invalidation, outbox and provider acceptance |
| Vaccine certificates with due dates | Not implemented | Frozen administration metadata, PDF samples and veterinarian acceptance |
| Rabies certificates with complete vaccine information | Not implemented | Separate template, required metadata, reviewed samples |
| Invoices and payment by text/email | Legacy `payment_links` only | Invoice/charge/payment ledgers, Stripe sandbox reconciliation, delivery integration |
| Select all/some medical records/certificates for email | Private patient documents: 46 SQL checks and 3 browser scenarios | Exact authorized package snapshots, export, delivery and privacy tests |
| Medication inventory, expiration/lot/billing | Not implemented; refill requests are not inventory | Product/lot/location stock ledger, dispensing/charge transaction, corrections |
| Vaccine inventory and billing | Legacy vaccination lot text only | Stock lots, administration+decrement+charge transaction, expiry checks |
| Clinic/housecall schedule + Maps | Staff appointment day list plus versioned RPC create/edit/cancel; DB enforces active staff, pet/client ownership, patient status, active-DVM assignment and stale-version rejection | Availability windows, atomic overlap checks, travel buffers, route grouping and hosted acceptance |
| Automatic appointment reminders | Reminder enqueue foundation exists; appointment schedule/status changes now supersede pending reminders and cancel queued outbound deliveries | Provider dispatcher/callback proof, live templates and operational acceptance |
| Dental charting in patient record | Not implemented | Species/dentition charts, findings/procedures, immutable history |
| Automatic anesthesia records | Not implemented | Charting/manual original file plus actual vendor adapter/sample/round-trip evidence |
| QOL charting | Not implemented | Practice-approved versioned instrument, authored answers/trend/print, clinician acceptance |
| Reopen/update mass body maps | Not implemented | Animal outlines, stable lesion IDs, measurements/photos/history and keyboard access |
| Unified inbox without Gmail dependence | Existing thread/assignment/template UI, Resend/Twilio groundwork, local signed inbound SMS ingestion, provider-message idempotency, STOP/START consent handling, outbound delivery visibility, and guarded retry/cancel controls | Inbound email, deployed SMS webhook, per-user read state, pagination, provider callbacks, reconciliation workflow, attachment release |
| ezyVet API connection | Reference adapter audited; current route still placeholder | Authorized account, non-destructive staged import, provenance/matching/conflict review, actual API test |
| Logo/new visuals | Existing warm palette, typography deferred | Original logo assets, responsive brand implementation and owner acceptance |
| Supabase/Vercel + owned domain | Dedicated Supabase provisioned; Vercel config/preflight; domain known; tracked `.env` removed; local checks/e2e and rollback pgTAP evidence captured for current wave | Hosted migration reconciliation, production browser envs, staff/Auth SMTP, DNS/HTTPS, backups/restore, monitoring and cutover |

## Deployment inventory revalidated 2026-09-12

- PR1 and PR2 are merged; baseline for current documents work is `56f8315`.
- The original backend is accessible through the Lovable connector, despite being inaccessible through the Supabase connector. Lovable project `7ea421c9-31d9-4bc4-acc7-d206c92b4b42` is associated with repository `livingroom-vet-care`, previews merged commit `56f8315`, and has a published `livingroom-vet-care.lovable.app` site.
- Original database has 14 migrations, 1 Auth user, 1 profile, 1 role, 8 app settings; every other public table has zero rows and Storage has zero objects. These are exact count queries, not estimated statistics. No row contents or credentials were exported. Recheck immediately before cutover because counts can change.
- Dedicated project `mgadheotkdnrsatfivjy` has the reviewed foundation/clinical migrations. It is still empty and outbound is disabled. Subsequent migration counts and commissioning checks are recorded per increment.
- The current tracked frontend connection still points at the original backend. Its missing clinical migration means environment parity remains an actual rollout task. No original-backend writes or public/DNS cutover were performed during this audit.
- A toolchain worktree is addressing the Vite/esbuild findings. React Router v6 has remaining upstream advisories; the user's v6 convention versus a patched v7 upgrade is awaiting clarification.

## Completion gates

Completion requires a real authorized staff workflow on the chosen hosted backend: household/patient creation → housecall or clinic booking → reminder → SOAP and alerts → stock-backed vaccine/medication administration → invoice and certificates → exact selected-record delivery → inbound client reply → verified payment reconciliation → next due reminders. Dental, anesthesia, QOL and body-map histories must reopen intact, and actual ezyVet/lab/anesthesia integrations require their real sample/account evidence.

No test count, branch label, disabled endpoint, mock vendor adapter or populated checklist alone proves that gate. Staff/clinician acceptance, production settings, domain sender verification, SMS consent/opt-out, monitoring, backup restoration and content/brand review are separate evidence items. Preserve all patient records and existing staff/account settings during cutover; no unreviewed destructive reconciliation.

## External inputs still pending

Practice phone, emergency referral contact, opening hours, staff identities/credentials, clinician reviewer, QOL/consent instrument approval, lab/anesthesia vendor, ezyVet access/source-of-truth decision, domain provider access, mail/Auth SMTP/SMS accounts and Stripe sandbox/production configuration. Secrets must be entered in provider/project secret stores rather than chat or Git.

## Current stack strategy

Build and test focused dependent branches, with each subsequent PR based on its predecessor. Keep production sends disabled while integration fixtures and controlled tests are built. Do not merge/redeploy the full stack until environment parity and the relevant acceptance gates are verified. User authorized a single coordinated rollout, not silent repeated production cutovers.

## 2026-09-22 commercial-readiness wave evidence

- Local frontend gate passed after dependency refresh: `npm run check`.
- Browser gate passed after public/legal/Hub route changes: `npm run test:e2e` with 13 Chromium tests.
- `git diff --check` passed.
- Outbound queue migration and worker-claim tests passed against the running dedicated local Supabase DB in a rollback-only transaction: 37 pgTAP assertions.
- Contact submission triage and abuse-control migrations passed rollback-only pgTAP coverage, including actor-spoof rejection, same-email throttling, and duplicate submission blocking: 27 assertions.
- Appointment write-safety and outbound worker-result migrations previously passed the full disposable-stack Supabase suite: 246 pgTAP assertions across 6 files.
- Callback-settlement migration passed focused disposable-stack pgTAP for outbound deliveries: 96 assertions in `supabase/tests/outbound_deliveries.test.sql`.
- Delivery handler tests now cover staff-send queueing, dispatcher, signed Resend/Twilio callback handlers, and signed Twilio inbound SMS handling: 51 Node unit tests.
- Inbound SMS migration and RPC tests passed in the disposable Supabase stack: 26 pgTAP assertions.
- Staff-send queue migration and RPC tests passed rollback-only against the local dedicated DB after applying queue prerequisites in a transaction: 16 pgTAP assertions.
- Hub outbound delivery visibility now exists for queue state, attempts, provider metadata, related records, failure context, and guarded retry/cancel actions; reconciliation workflow and production dispatcher/provider smoke remain open.
- Outbound delivery staff controls migration and pgTAP passed rollback-only against the local dedicated DB after applying the outbox prerequisite migration: 14 assertions.
- Full deployment preflight passed again on 2026-09-23 after the contact-submission abuse-control migration/docs update: lint, typecheck, 51 Node unit tests, production build, sitemap/config/diff checks, and 13 Playwright Chromium tests. The former fast-refresh lint warning in `src/hub/contexts/AuthContext.tsx` has been resolved by splitting the auth hook/context from the provider component.
- Current full deployment preflight is warning-free: lint, typecheck, 51 Node unit tests, production build, sitemap/config/diff checks, and 13 Playwright Chromium tests all passed after the auth context split.
- Official `supabase test db` now reaches the retargeted local `mgadheotkdnrsatfivjy` stack, but it is not green because the running database has not been reset/replayed to the newer commercial-readiness schema. Treat focused rollback/disposable-stack pgTAP as useful migration evidence, not as hosted launch acceptance.
- Public website readiness audit is now repeatable with `npm run public:readiness`; current status is not launch-ready because owner phone, email, emergency phone, and hours remain unset. Service-claim warnings are currently resolved.
- Hub workflow readiness audit is now repeatable with `npm run hub:readiness`; current local Hub status is ready for contact triage, appointments, and delivery ops, and hosted Supabase schema/function dependencies now pass after the 2026-09-23 hosted deployment.
- Aggregate commercial-readiness summary is now repeatable with `npm run readiness:summary`; current status is blocked, with 4 of 5 gates passing. Supabase/database, Hub/frontend, external services/deployment, and verification/release-control pass; public website launch readiness remains blocked on owner-approved public contact content.
- Remote-only migration recovery evidence is now repeatable with `npm run supabase:migration-file-search`, `npm run supabase:migration-source-compare`, and `npm run supabase:migration-restore`; all 96 formerly remote-only receipt versions were found, the two complete candidate recovery roots matched with 0 missing files and 0 SHA-256 mismatches, and 96 historical migration files were restored into the active worktree. Current drift after hosted migration push is 123 matching, 0 remote-only, and 0 local-only migrations.
- Reviewed launch Edge Functions are deployed remotely with expected JWT modes: `send-email`, `send-sms`, `dispatch-outbound-deliveries`, `resend-delivery-webhook`, `twilio-message-status-callback`, and `twilio-inbound-sms`. Seven legacy conflict slugs were replaced with explicit disabled stubs that return HTTP 410 with replacement-route hints: `dispatch-outbox`, `enqueue-message`, `process-inbound`, `public-contact`, `queue-reminders`, `resend-webhook`, and `twilio-webhook`. A non-destructive routing check found no hosted `cron.job` table; provider dashboards still need to point at the reviewed replacement webhook URLs before live provider use.
- Vercel Production browser envs now point to `mgadheotkdnrsatfivjy`, and Production deployment `dpl_EnvwqCoXkakCik1Sd6A7yyq6kxAY` is ready. `thelivingroom.vet` and `www.thelivingroom.vet` are attached to Vercel and verified with the GoDaddy DNS records Vercel recommended (`A @ 216.150.1.1`, `A @ 216.150.16.1`, and `CNAME www 1115926f442091d7.vercel-dns-016.com.`). HTTP serves from Vercel on both custom domains; HTTPS certificate readiness still needs a follow-up smoke check after Vercel provisioning catches up.
- Hub workflow readiness no longer hard-codes dated schema/function inventory filenames; ad-hoc runs select the latest evidence, and `npm run readiness:refresh` passes same-date inventory paths explicitly.
- Ordered evidence refresh is now repeatable with `npm run readiness:refresh`; current refresh completed all evidence steps successfully and left the aggregate status blocked.
