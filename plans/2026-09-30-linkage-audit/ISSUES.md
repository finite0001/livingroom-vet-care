# Linkage audit — 2026-09-30

Read-only sweep of `main` @ `9fb0576` across four dimensions: database schema, frontend → database,
edge functions/scheduler, and UI routes/tabs/links. All 165 migrations replay cleanly into a fresh
Postgres; `tsc -p tsconfig.app.json` is clean; no link targets a nonexistent route; every `.from()`,
`.rpc()`, embed, bucket and edge-function name resolves. The findings below are the real gaps.

Goal: **every item below is fixed, or explicitly closed as an owner decision, on one reviewed PR train
— with migrations replay-tested and the full `npm run check` + SQL suite green.**

## Resolution (integration/2026-09-30-linkage)

All items are addressed in this train: #223 (A + B10), #222 (B), #221 (C), #224 (D + C4), plus
integration commits for A19 and a final types regeneration.

- **Closed without code change, by design:** D16 (bookmark-only stub routes).
- **Owner decision taken 2026-09-30:** A19. New inquiries is the single triage surface. `/hub/contact-submissions`
  redirects there, and notes from the retired page show read-only on the inquiry.
- **A11:** `refills.refill_requests` is excluded from the composite check. An existing trigger already refuses every
  write to it, and restore validation requires its constraints to be validated.
- **Documented, not migrated:** A9, A13, A15, A16 and A20 are recorded as SQL comments in `20260930120000_linkage_integrity.sql`.
- **Owner actions after merge** (hosted projects were not touched):
  - Apply `20260930120000` and `20260930130000` to staging, then to prod.
  - Run the NOT VALID violation query from PR #223. Validate the constraints only once every count is 0.
  - Deploy `process-stripe-events` before setting the Vault scheduler secrets (B4).
  - Redeploy the changed workers and Twilio callbacks.
  - Undeploy `suggest-replies` and `send-provider-email`.
  - Set the `ESTIMATE_DECISION_*` secrets and run the origin agreement check (B13/B14) before issuing client estimate links.

## A. Database integrity (migrations)

| # | Sev | Issue | Fix |
|---|-----|-------|-----|
| A1 | HIGH | `pet_vaccinations.pet_id`, `wellness_reminders.pet_id` ON DELETE CASCADE; admins can hard-delete `pets`; no delete guard | RESTRICT + BEFORE DELETE guard on `pets` (archive instead) |
| A2 | HIGH | `lab_results`, `consent_submissions`, `refill_requests`, `follow_up_instances`, `waitlist_entries` `.pet_id` SET NULL — deleting a pet orphans labs/signed consents | RESTRICT |
| A3 | HIGH | `consent_submissions.template_id` CASCADE — deleting a template wipes signed consents | RESTRICT |
| A4 | MED | ~13 legacy `client_id` FKs CASCADE (labs, consents, `sms_consent` TCPA evidence, files, notes, appointments…) while `pets.client_id` is RESTRICT | RESTRICT |
| A5 | MED | `profiles.id → auth.users` CASCADE → nulls `administered_by`, `reviewed_by`, `assigned_dvm_id` | RESTRICT; deactivate staff instead of deleting |
| A6 | MED | `time_entries.staff_id`, `on_call_schedules.dvm_id` CASCADE delete labor/schedule history | RESTRICT |
| A7 | LOW | survey→responses, follow-up template→instances, campaign→recipients CASCADE | RESTRICT |
| A8 | LOW | `conversations`/`messages` FKs CASCADE but guarded by trigger; dead `delete_conversation_cascade()` | RESTRICT; drop dead function |
| A9 | MED | Staff actor columns split between `auth.users` and `profiles` | Document `profiles` as the convention for new columns |
| A10 | LOW | `appointments.updated_by` intended SET NULL never applied (`add column if not exists` no-op) | Re-create constraint |
| A11 | MED | 23 tables carry `pet_id`+`client_id` with nothing ensuring the pet belongs to the client | `unique(id, client_id)` on `pets` + composite FKs (NOT VALID) on legacy writable tables |
| A12 | MED | `reminder_outbox_links.job_id` polymorphic, orphaned by `appointment_reminders` cascade | Covered by A4 RESTRICT on appointments chain |
| A13 | LOW | Other polymorphic `source_id`/`entity_id` columns rely on function logic | Document as intentional |
| A14 | LOW | `response_metrics.staff_id`, `client_files.uploaded_by` have no FK | Add FK (NOT VALID) |
| A15 | LOW | `appointment_reminders.outbound_delivery_id` ↔ `outbound_deliveries.appointment_reminder_id` two-way link (retired pipeline) | Document as frozen |
| A16 | LOW | `urgent_alerts.campaign_id` is text vs uuid `campaigns.id` | Document (legacy, unused) |
| A17 | MED | Legacy `pet_vaccinations`/`lab_results` still staff-writable, no immutability | Revoke insert/update/delete |
| A18 | LOW | `lab_results.status`, `appointment_reminders.channel` have no CHECK; channel/sex casing inconsistent | CHECK (NOT VALID); document casing |
| A19 | MED | Two triage states per contact submission (`website_inquiry_triage` vs `contact_submissions.triage_status`) | `[owner]` pick one; documented |
| A20 | LOW | Roles stored in `profiles.role` and `user_roles`; only `user_roles` is authoritative | Comment column as deprecated |
| A21 | LOW | Hot FK columns without indexes (outbox/inbound conversation/client, consents, labs, etc.) | Add indexes |

## B. Edge functions & scheduler

| # | Sev | Issue | Fix |
|---|-----|-------|-----|
| B1 | HIGH | `cleanup-abandoned-attachment` cron posts `{}`; handler requires `upload_id` → fails every 30 min | Batch mode: empty body claims next eligible upload |
| B2 | MED | Workers process one item per invocation (60/hr cap) vs reminders enqueuing ~100/hr | Loop with item cap + time budget |
| B3 | MED | pg_net `timeout_milliseconds := 5000` too short | Raise; keep worker budget below it |
| B4 | MED | Scheduler targets `process-stripe-events`, not yet deployed | `[owner]` deploy before Vault secrets (runbook note) |
| B5 | MED | `prepare/recover-estimate-decision-grant` have no caller — client estimate link unreachable | Wire "issue/recover client link" in EstimateDecisionWorkspace |
| B6 | MED | `suggest-replies` + `use-smart-replies` orphaned; depends on Lovable AI gateway | Remove |
| B7 | LOW | `send-provider-email` retired 410 stub | Remove |
| B8 | LOW | Legacy `twilio-webhook` still writes to DB alongside `twilio-inbound-sms` | Convert to disabled-legacy stub |
| B9 | LOW | Twilio signature check falls back to `req.url` when URL env unset → 403 forever | 503 when env missing |
| B10 | LOW | `enqueue_staff_outbound_message` granted to `authenticated` feeds an unscheduled legacy queue | Revoke |
| B11 | LOW | `invite-staff`, `suggest-replies`, `send-provider-email` lack `config.toml` entries | Add explicit entry for `invite-staff` |
| B12 | LOW | Email-payload purge functions never scheduled | Daily cron |
| B13 | LOW | 6 env vars undocumented (`ESTIMATE_DECISION_*`, `TWILIO_WEBHOOK_URL`) | Add to environment manifest |
| B14 | LOW | Five origin settings must agree (`APP_URL`, `DOCUMENT_LINK_ORIGIN`, `PAYMENT_ACCESS_ORIGIN`, `STRIPE_RETURN_ORIGIN`, `ESTIMATE_DECISION_ORIGIN`) | Commissioning check in runbook |

## C. Types (frontend ↔ database)

| # | Sev | Issue | Fix |
|---|-----|-------|-----|
| C1 | MED | `types.ts` has 117/266 tables, 184/916 functions; missing `QUEUED` enum value and 7 columns | Regenerate from replayed migrations |
| C2 | LOW | ~30 modules cast to hand-written `XDatabase` types | Switch to generated `Database` |
| C3 | LOW | Untyped `rpc(name: string)` wrappers / index-signature clients | Type against generated `Database` where feasible |
| C4 | INFO | CareReminders filters `status = 'PENDING'`, hiding `QUEUED` reminders | Show QUEUED as "Queued" |

## D. UI routes, tabs, links

| # | Sev | Issue | Fix |
|---|-----|-------|-----|
| D1 | HIGH | No sign-out on mobile | Add to More sheet |
| D2 | HIGH | `?tab=&section=` deep links don't scroll on cold load (hook fires before data) | Retry until element exists; re-fire on repeat click |
| D3 | HIGH | Schedule never links appointment → patient/client | Link names |
| D4 | HIGH | Home "Review notes" → `/hub/patients` with no unsigned filter | Link to the encounter's patient SOAP section |
| D5 | MED | Prefix active-state: `/hub/admin` lights on all admin pages; `/hub/time` lights on `/hub/timesheet` | `exact` + segment-boundary match |
| D6 | MED | Detail pages highlight no nav item | `activePrefixes` on NavItem |
| D7 | MED | Login forgets intended URL | `state.from` round-trip |
| D8 | MED | Global search matches pets but only shows households | Show matched pet, link to patient |
| D9 | MED | ezyVet import tool unreachable from admin nav | Add admin nav item |
| D10 | MED | CareReminders "Open patient due plan" → Overview; `petId` null → `/hub/patient/null` | Deep link to section; guard null |
| D11 | MED | Treatment "billing panel" link → household Overview | `householdHref(id,"billing","invoices")` |
| D12 | MED | Operations "Open household billing" → Overview | Same |
| D13 | MED | Ticket detail doesn't link client/conversation | Add links |
| D14 | MED | Duplicate nav icons despite "distinct" comment | Distinct icons |
| D15 | LOW | Dead `AppointmentsPage.tsx`, `PlaceholderPage.tsx` | Delete |
| D16 | LOW | Bookmark-only routes (campaigns/surveys/alerts/admin import) | Intentional — no change |
| D17 | LOW | Home "rest of day" visits not linked | Link |
| D18 | LOW | Refills → patient Overview; household never linked; legacy rows show raw ids | Deep link; link household |
| D19 | LOW | Inquiries "Reviewed household" not linked | Link |
| D20 | LOW | Schedule date not written to URL | Sync `?date` |
| D21 | LOW | Patient not-found → "Back to clients" | "Back to patients" |
| D22 | LOW | Non-admin on admin URL silently redirected | Toast/notice |
| D23 | LOW | AppShell reserves 56px, tab bar is 64px | Match |
| D24 | LOW | Operations "locate appointment" lacks `?date`; Stripe recovery label | Pass date; clarify label |
| D25 | LOW | Repeat click on same section link does nothing | Covered by D2 |
