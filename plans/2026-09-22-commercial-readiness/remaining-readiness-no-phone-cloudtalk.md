# Remaining commercial-readiness plan — excluding phone number and CloudTalk

Date: 2026-09-24  
Scope: complete all software/evidence work that can be finished before public phone-number selection and CloudTalk commissioning. Phone, CloudTalk, public emergency phone wording, and live voice/voicemail are final owner/provider gates.

## Current facts to preserve

- The selected hosted Supabase project is `mgadheotkdnrsatfivjy`.
- PR #204 hosted rollout evidence recorded 148 matching migrations, 0 remote-only, and 0 local-only at that checkpoint.
- Local Phase 2 has a later migration: `supabase/migrations/20260924120000_canonical_housecall_appointment_contract.sql`.
- Local current-stack replay now has database evidence through that Phase 2 migration: [2026-09-24 current-stack DB replay and pgTAP](../../docs/launch-evidence/2026-09-24-current-stack-db-replay-pgtap.md).
- `/hub/schedule` is now the canonical appointment workspace.
- Inventory, invoices, payment collection/reconciliation, certificates, care reminders, estimate publication, and delivery operations already have local implementation and tests. Do not restart Phase 3 from an empty-state assumption.
- Scheduler Vault values are intentionally absent, so database cron is contained until explicit provider/scheduler commissioning.
- Public launch remains blocked by owner-approved contact content. That blocker is intentionally deferred here.

## Work order

### 1. Reconcile and prove the current local database stack

Goal: make the repository’s latest migrations proveable without mutating production.

Steps:

1. Create a disposable or explicitly approved local Supabase stack.
2. Replay all migrations through `20260924120000_canonical_housecall_appointment_contract.sql`.
3. Run the focused Phase 2 pgTAP suites:
   - `supabase/tests/scheduling.test.sql`
   - `supabase/tests/appointments_write_safety.test.sql`
   - `supabase/tests/reminder_outbox.test.sql`
4. Run the core preventive/billing/payment pgTAP suites already present:
   - `supabase/tests/inventory_billing.test.sql`
   - `supabase/tests/inventory_read_models.test.sql`
   - `supabase/tests/inventory_product_locking.test.sql`
   - `supabase/tests/care_charts.test.sql`
   - `supabase/tests/care_reminders.test.sql`
   - `supabase/tests/vaccine_certificates.test.sql`
   - `supabase/tests/certificate_due_plans.test.sql`
   - `supabase/tests/invoice_documents.test.sql`
   - `supabase/tests/payment_ledger.test.sql`
   - `supabase/tests/payment_collection_access.test.sql`
   - `supabase/tests/payment_reconciliation_*.test.sql`
   - `supabase/tests/stripe_event_*.test.sql`
5. Regenerate Supabase TypeScript types if the local replay exposes stale generated types.

Acceptance evidence:

- Fresh command output recorded under `docs/launch-evidence/`.
- No unexplained duplicate fixture failures.
- No direct mutation of hosted production during this proof.

### 2. Refresh readiness evidence after Phase 2 migration

Goal: ensure readiness reports stop relying on the pre-Phase-2 hosted checkpoint.

Steps:

1. If the owner approves hosted migration apply, apply only the current local-only migration set to `mgadheotkdnrsatfivjy`.
2. Re-run:
   - `npm run readiness:inventory`
   - `npm run supabase:schema-inventory`
   - `npm run supabase:functions-inventory`
   - `npm run hub:readiness`
   - `npm run readiness:refresh`
   - `npm run readiness:summary -- --fail-on-blockers`
3. If hosted apply is not approved yet, keep the summary wording explicit: hosted evidence is a dated checkpoint and local Phase 2 remains unapplied.

Acceptance evidence:

- Updated dated files in `docs/launch-evidence/`.
- Summary either passes all non-public-contact gates or names the exact local-only hosted blocker.

### 3. Commission a no-live-send hosted workflow drill

Goal: prove staff workflows and provider adapters in disabled/test mode before phone/CloudTalk.

Must cover:

- Anonymous contact submit → Hub contact triage/audit.
- Staff email queueing through the current outbox path.
- Staff SMS queueing only as disabled/test evidence; no live SMS number required.
- Appointment reminder enqueue and dispatcher containment.
- Resend delivery webhook signature handling with synthetic payload.
- Twilio status callback and inbound SMS/STOP/START signature handling with synthetic payload.
- Delivery operations UI can inspect queued, failed, retryable, canceled, and unknown states.

Do not cover:

- Live phone-number publishing.
- CloudTalk account/dashboard setup.
- Production voice or voicemail.
- Live SMS delivery from a real number.

Acceptance evidence:

- A dated hosted drill report under `docs/launch-evidence/`.
- Outbound mode remains disabled or test-only.
- Provider dashboard callback URLs are documented but not activated for live sends.

### 4. Prove the native preventive/inventory/billing loop with synthetic data

Goal: verify the existing Phase 3 implementation as an integrated workflow rather than rebuilding it.

Workflow:

`household/patient → housecall appointment → SOAP/care chart → stock-backed vaccine or medication administration → invoice line → payment collection link → Stripe sandbox/test evidence → certificate/due-plan update → selected record/package delivery`

Focus files already present:

- `src/hub/features/inventory/`
- `src/hub/features/care-charts/`
- `src/hub/features/care-reminders/`
- `src/hub/features/certificates/`
- `src/hub/features/billing/`
- `src/hub/features/payments/`
- `supabase/functions/invoice-checkout/`
- `supabase/functions/stripe-webhook/`
- `supabase/functions/process-stripe-events/`
- `supabase/functions/prepare-payment-delivery/`

Acceptance evidence:

- One integrated local or hosted-staging synthetic run.
- Expired/insufficient stock blocked.
- Retry does not duplicate stock movement, charge, payment, certificate, or outbound delivery.
- Stripe sandbox/test webhook replay is idempotent.
- Issued certificate/invoice snapshots remain frozen after later edits.

### 5. Clinical and staff acceptance package

Goal: make owner/veterinarian review actionable before public launch.

Steps:

1. Prepare a short checklist for Dr. Susan Edler covering:
   - SOAP/addenda.
   - serious alerts.
   - vaccine records and next-due policy.
   - certificate templates.
   - client record-release policy.
   - invoice/payment language.
2. Prepare staff acceptance steps:
   - invite/recover/deactivate staff account.
   - create household/patient.
   - schedule a housecall.
   - complete the synthetic preventive/invoice/payment/certificate loop.
   - inspect delivery failures and retries.
3. Store signed-off or rejected decisions as dated launch evidence.

Acceptance evidence:

- Clinical review decisions are explicit and versioned.
- Staff acceptance has named operator, date, environment, and known exceptions.

### 6. Final deferred gates

These remain intentionally outside the current work until owner/provider setup is ready:

- Public practice phone.
- Public emergency phone/instructions.
- CloudTalk.
- Live SMS number/A2P activation.
- Live voice/voicemail.
- Public-contact launch gate.
- Final owner go/no-go.

## Definition of done for this pre-phone/CloudTalk phase

- Current migrations replay cleanly on a disposable/current local stack.
- Phase 2 hosted drift is either applied and refreshed or explicitly recorded as the only non-public local-only blocker.
- No-live-send hosted workflow drill is documented.
- Existing inventory/billing/payment/certificate implementation is integrated in one synthetic workflow proof.
- Clinical/staff acceptance package is ready for named reviewers.
- Public phone/CloudTalk gates remain deferred and clearly isolated.
