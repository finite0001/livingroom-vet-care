# Current-stack database replay and focused pgTAP proof

Date: 2026-09-24  
Environment: local Supabase Docker stack for `mgadheotkdnrsatfivjy`  
Scope: pre-phone/CloudTalk commercial-readiness database proof

## Summary

The current repository migration stack replayed locally through:

- `20260924120000_canonical_housecall_appointment_contract.sql`

Subsequent same-day no-live-send verification added and locally applied:

- `20260924130000_inbound_sms_service_rpc_security.sql`

The original replay database reported:

- `149` migration receipts.
- Latest migration: `20260924120000`.
- `npx supabase db push --local --include-all --dry-run` reports `upToDate: true`.

After the same-day inbound-SMS service-RPC security migration, the current local ledger reports:

- `150` migration receipts.
- Latest migration: `20260924130000`.
- `npx supabase db push --local --dry-run` reports `upToDate: true`.

No hosted database, provider dashboard, phone number, or CloudTalk state was changed.

## Operational note

I attempted to validate through a separately named disposable database using:

```bash
docker exec supabase_db_mgadheotkdnrsatfivjy psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "create database lrv_readiness_prephone_20260924_c916c47;"
npx supabase db reset --db-url "postgresql://postgres:postgres@127.0.0.1:54322/lrv_readiness_prephone_20260924_c916c47" --no-seed --yes
```

Supabase CLI initialized and replayed the full migration stack, but the named database was not retained afterwards. The default local `postgres` database in the local Supabase stack was reset and replayed. Treat this as a local-stack reset event. It did not touch the hosted Supabase project.

## Migration replay evidence

Reset output applied every migration through the current Phase 2 migration:

```text
Applying migration 20260922230000_contact_submission_abuse_controls.sql...
Applying migration 20260924120000_canonical_housecall_appointment_contract.sql...
Finished supabase db reset on branch main.
```

Post-replay catalog check:

```bash
docker exec supabase_db_mgadheotkdnrsatfivjy psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc "select count(*) from supabase_migrations.schema_migrations; select version from supabase_migrations.schema_migrations order by version desc limit 5;"
```

Result:

```text
149
20260924120000
20260922230000
20260922224500
20260922223000
20260922220000
```

Dry-run drift check:

```bash
npx supabase db push --local --include-all --dry-run
```

Result:

```json
{"upToDate":true,"dryRun":true,"migrations":[],"seeds":[],"roles":[],"message":"Local database is up to date."}
```

## Focused Phase 2 pgTAP

Command:

```bash
npx supabase test db --local \
  supabase/tests/scheduling.test.sql \
  supabase/tests/appointments_write_safety.test.sql \
  supabase/tests/reminder_outbox.test.sql
```

Result:

```text
All tests successful.
Files=3, Tests=97
Result: PASS
```

During this proof, `supabase/tests/appointments_write_safety.test.sql` was updated to match the current onboarding and canonical appointment contract:

- Raw Auth inserts now create inactive, roleless profiles, so appointment fixtures explicitly activate staff and assign roles.
- The slim compatibility RPC now routes through the canonical housecall-aware save contract, so expected validation messages and “active staff assignment lives” assertions were corrected.
- Fixed near-term static appointment dates were replaced with relative future dates so 48-hour and 24-hour reminder assertions stay valid.

## Focused Phase 3 pgTAP

Command:

```bash
npx supabase test db --local \
  supabase/tests/inventory_billing.test.sql \
  supabase/tests/inventory_read_models.test.sql \
  supabase/tests/inventory_product_locking.test.sql \
  supabase/tests/care_charts.test.sql \
  supabase/tests/care_reminders.test.sql \
  supabase/tests/vaccine_certificates.test.sql \
  supabase/tests/certificate_due_plans.test.sql \
  supabase/tests/invoice_documents.test.sql \
  supabase/tests/payment_ledger.test.sql \
  supabase/tests/payment_collection_access.test.sql \
  supabase/tests/payment_reconciliation_observations.test.sql \
  supabase/tests/payment_reconciliation_resolution.test.sql \
  supabase/tests/payment_reconciliation_discovery.test.sql \
  supabase/tests/stripe_event_inbox.test.sql \
  supabase/tests/stripe_event_retry_cycles.test.sql
```

Result:

```text
All tests successful.
Files=15, Tests=555
Result: PASS
```

## What this proves

- The current local migration chain replays through the Phase 2 appointment-contract migration.
- The local stack is current with repository migrations.
- The housecall scheduling/write-safety/reminder contracts pass focused pgTAP.
- Existing inventory, care-chart, certificate, invoice, payment, reconciliation, and Stripe event foundations pass focused pgTAP.

## What this does not prove

- Hosted Supabase has not yet received the local Phase 2 migration.
- Provider dashboards were not configured.
- No live email, SMS, phone, voice, voicemail, or CloudTalk path was exercised.
- This is database-level proof, not named staff browser acceptance or clinician approval.
