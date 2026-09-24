# 2026-09-22 commercial-readiness wave evidence

Scope: local implementation and verification for the first commercial-readiness wave after the private patient documents increment. This is not hosted launch acceptance.

## Implemented

- Public launch blockers:
  - Added `/privacy` and `/terms` routes.
  - Wired the Experience page "Schedule a Tour" CTA to the contact path.
  - Replaced generic `Inter`/`Montserrat` font stack with `Nunito Sans`/`Bricolage Grotesque`; Impeccable detector returned no findings for `src/index.css`.
  - Added tracked route metadata, canonical URLs, JSON-LD, `robots.txt`, `sitemap.xml`, and a local Open Graph image.
- Hub workflow readiness:
  - Added `/hub/contact-submissions` with staff triage states, notes, reviewed/contacted/closed metadata, and staff-scoped updates.
  - Added contact inbox load-error/retry handling, server-side status filtering, and "new contacts" counts for Hub dashboard/sidebar badges.
  - Added `/hub/appointments` with day list, create, edit, and cancel controls.
  - Moved appointment create/edit/cancel controls from direct table writes to versioned RPCs.
  - Added `/hub/deliveries` visibility for outbound delivery queue state, provider metadata, attempts, timing, related appointments/messages, operational failure context, and guarded staff retry/cancel actions.
- Database operating loop:
  - Added `public.outbound_deliveries` with idempotency, status, lease, retry, provider, appointment reminder, message, and audit fields.
  - Added `public.claim_due_outbound_deliveries(...)` for service-role-only worker claiming with `FOR UPDATE SKIP LOCKED`.
  - Added `public.record_outbound_delivery_result(...)` for service-role-only worker settlement, lease-owner validation, provider metadata capture, retry scheduling, terminal status timestamps, and appointment-reminder status synchronization.
  - Added `public.record_outbound_delivery_callback(...)` for service-role-only provider callback settlement by provider message ID, duplicate same-status idempotency, conflicting terminal-state rejection, and appointment-reminder synchronization.
  - Added active-staff `public.retry_outbound_delivery(...)` and `public.cancel_outbound_delivery(...)` RPCs with stale-row guards, retry eligibility limited to `FAILED`/`UNKNOWN`, cancel eligibility limited to `QUEUED`, and direct browser table writes still denied.
  - Added contact submission triage columns, grants, RLS update policy, audit trigger, immutable public-field guard, trigger enforcement that triage actor fields cannot be spoofed away from `auth.uid()`, and DB-side same-email/duplicate public-submission abuse controls.
  - Added appointment-reminder enqueueing into `outbound_deliveries`; this queues due reminders but does not dispatch provider messages.
  - Added `public.enqueue_staff_outbound_message(...)` and rewired `send-email` / `send-sms` so staff client-conversation sends atomically create the visible staff message and a queued outbound delivery instead of calling Resend/Twilio synchronously.
  - Added `dispatch-outbound-deliveries`, a token-protected Supabase Edge Function that claims due outbox rows, sends email/SMS through Resend/Twilio under delivery-policy safeguards, and records each worker result through `record_outbound_delivery_result(...)`.
  - Added `resend-delivery-webhook` and `twilio-message-status-callback` Edge Functions that verify provider signatures, map terminal delivery events to callback statuses, ignore non-terminal events, and call `record_outbound_delivery_callback(...)`.
  - Added `public.record_inbound_sms(...)`, `public.normalize_sms_phone(...)`, message provider idempotency columns, and `twilio-inbound-sms` for signed Twilio inbound SMS ingestion, client matching/placeholder creation, unread client-message insertion, duplicate `MessageSid` handling, and STOP/START/HELP consent semantics.
  - Added appointment write-safety migration: direct browser DML is closed, `save_appointment(...)`/`cancel_appointment(...)` enforce active staff, optimistic versions, pet/client ownership, active patient scheduling, active-DVM assignment, closed-status reactivation rules, audit rows, and pending reminder regeneration/cancellation.
- Release control:
  - Retargeted `supabase/config.toml` from the absent original Lovable backend to the approved dedicated project `mgadheotkdnrsatfivjy`; this is a CLI target alignment, not a Vercel/Lovable browser cutover.
  - Matched tracked Vercel build config to the observed project build command: `npm run build:deployment`.
  - Added `npm run preflight:deployment` to repeat lint, typecheck, unit tests, production build, Playwright tests, sitemap XML validation, Vercel config contract checks, and whitespace checks.
  - Removed tracked `.env` from Git while leaving the local file on disk; `.env.example` remains the committed template.

## Verification

- `npm run check` passed.
- `npm run build:deployment` passed.
- `npm run preflight:deployment` passed again on 2026-09-23 after the contact-submission abuse-control migration/docs update; this covered lint, typecheck, 51 Node unit tests, production build, sitemap/config/diff checks, and 13 Playwright Chromium tests. The former `react-refresh/only-export-components` warning in `src/hub/contexts/AuthContext.tsx` was later resolved by moving `useAuth` into a non-component context module.
- `npm run preflight:deployment` passed again after the auth context split; lint is now warning-free, typecheck passed, 51 Node unit tests passed, production build passed, and 13 Playwright Chromium tests passed.
- `npm run test:e2e` passed with 13 Chromium tests.
- `git diff --check` passed.
- `xmllint --noout public/sitemap.xml` passed.
- Impeccable detector returned no findings for `src/hub/pages/DeliveriesPage.tsx`, `src/hub/hooks/use-outbound-deliveries.ts`, Hub route/nav files, and `src/index.css`.
- Outbound delivery migration plus `supabase/tests/outbound_deliveries.test.sql` passed in a rollback-only transaction against `supabase_db_mgadheotkdnrsatfivjy`: 37 pgTAP assertions.
- Contact submission triage and abuse-control migrations plus `supabase/tests/contact_submissions_triage.test.sql` passed in a rollback-only transaction against `supabase_db_mgadheotkdnrsatfivjy`: 27 pgTAP assertions.
- Focused appointment write-safety pgTAP passed in a disposable Supabase stack after all migrations: `supabase/tests/appointments_write_safety.test.sql`, 24 assertions.
- Focused outbound delivery pgTAP passed in a disposable Supabase stack after all migrations: `supabase/tests/outbound_deliveries.test.sql`, 96 assertions after callback-settlement coverage was added.
- All `supabase/tests` passed in a disposable Supabase stack after the appointment and outbound worker-result migrations: 246 pgTAP assertions across 6 files.
- Focused inbound SMS pgTAP passed in the disposable Supabase stack after the inbound migration fix: `supabase/tests/inbound_sms.test.sql`, 26 assertions.
- Focused staff-send queue pgTAP passed rollback-only against `supabase_db_mgadheotkdnrsatfivjy` after applying queue prerequisites in a transaction: `supabase/tests/staff_outbound_queue.test.sql`, 16 assertions. The transaction ended with `ROLLBACK`.
- Focused outbound-delivery staff controls pgTAP passed rollback-only against `supabase_db_mgadheotkdnrsatfivjy` after applying the outbox prerequisite migration in a transaction: `supabase/tests/outbound_delivery_staff_controls.test.sql`, 14 assertions. The transaction ended with `ROLLBACK`.
- `npm test -- tests/delivery/delivery-handlers.test.ts tests/delivery/delivery-policy.test.ts tests/delivery/delivery-result.test.ts` passed locally; because the project test script expands `tests/**/*.test.ts`, this covered 51 Node unit tests including staff-send queueing, dispatcher, provider-webhook, and inbound-SMS handler harnesses.
- `npx supabase link --project-ref mgadheotkdnrsatfivjy` now succeeds, and `npx supabase migration list` connects to the dedicated project. Current drift: 17 matching migration versions, 96 remote-only receipts, and 10 local-only readiness migrations. See `2026-09-23-supabase-link-and-migration-drift.md`.

## Known Gaps

- Hosted Supabase migration reconciliation remains incomplete: the local CLI target is now linked to the dedicated project `mgadheotkdnrsatfivjy`, but migration inventory shows remote-only receipts and local-only readiness migrations that must be reconciled before launch.
- The main repo's default `npx supabase test db` path now reaches the correct local stack, but fails because that running DB has not been reset/replayed to the newer readiness schema; focused rollback/disposable-stack pgTAP evidence is currently stronger for the new migrations.
- The outbox has enqueue/claim/result/callback database lifecycle coverage, a local `dispatch-outbound-deliveries` Edge Function bridge, Hub delivery visibility, and guarded staff retry/cancel controls. Staff-facing `send-email`/`send-sms` now enqueue into it locally, but reconciliation workflows, production dispatcher/callback deployment, and provider smoke tests are still missing.
- `dispatch-outbound-deliveries`, `resend-delivery-webhook`, `twilio-message-status-callback`, and `twilio-inbound-sms` are implemented and locally unit-tested, but they are not deployed, scheduled/registered, connected to provider dashboards, or provider-smoke-tested in this evidence wave.
- Two-way SMS now has local signed inbound handling and STOP/START consent updates, but voice/voicemail webhooks, inbound email parsing, bounce/suppression workflow, and production SMS policy acceptance remain open.
- Appointment create/edit/cancel is now RPC-protected for core invariants, but commercial scheduling still needs availability windows, travel buffers, clinician capacity, route optimization, and hosted acceptance.
- Public site still needs owner-provided contact details, hours, emergency referral wording, credential review, DNS/HTTPS, and legal review.
- Hosted acceptance, restore rehearsal, Auth SMTP acceptance, Stripe, and provider round-trips remain open.
