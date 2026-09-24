# No-live-send local workflow drill

Date: 2026-09-24  
Scope: local disabled/test-mode delivery, callback, inbound SMS, reminder, and operations evidence for commercial-readiness Stage 3  
Environment: local Supabase stack for `mgadheotkdnrsatfivjy`

## Summary

Local no-live-send verification passed for delivery policy, provider signature parsing, inbound processing, staff queueing, manual delivery controls, appointment reminder containment, scheduler containment, and operations visibility.

This is not the hosted staff workflow drill. It is local contract evidence that the workflow paths are safe to exercise in disabled/test mode before phone number and CloudTalk setup.

## Schema fix found during the drill

The SQL drill exposed a real local schema bug: `public.record_inbound_sms(...)` was service-role-only but not `SECURITY DEFINER`, while the launch-readiness schema revokes direct service-role writes to conversations, messages, and SMS consent tables.

The fix is the new migration:

- `supabase/migrations/20260924130000_inbound_sms_service_rpc_security.sql`

It marks the existing Twilio inbound SMS RPC as `SECURITY DEFINER` with `search_path = public`, preserving service-role-only execute grants while allowing the verified Edge handler path to write through the definer-owned RPC.

## Local migration state

Command:

```bash
npx supabase db push --local --dry-run
```

Result:

```json
{"upToDate":true,"dryRun":true,"migrations":[],"seeds":[],"roles":[],"message":"Local database is up to date."}
```

Local migration ledger:

```text
150|20260924130000
```

## Hosted apply set after this fix

Command:

```bash
npx supabase db push --linked --dry-run --skip-vault
```

Result:

```text
Would push these migrations:
 • 20260924120000_canonical_housecall_appointment_contract.sql
 • 20260924130000_inbound_sms_service_rpc_security.sql
{"upToDate":false,"dryRun":true,"migrations":["20260924120000_canonical_housecall_appointment_contract.sql","20260924130000_inbound_sms_service_rpc_security.sql"],"seeds":[],"roles":[],"message":"Finished supabase db push."}
```

No hosted SQL was applied during this drill.

## Node delivery/inbound/reminder tests

Command:

```bash
node --experimental-strip-types --test \
  tests/delivery/delivery-handlers.test.ts \
  tests/delivery/delivery-policy.test.ts \
  tests/delivery/delivery-result.test.ts \
  tests/inbound/verification.test.ts \
  tests/inbound/auth-mail.test.ts \
  tests/inbound/processing.test.ts \
  tests/inbound-review/processing.test.ts \
  tests/inbound-review/state.test.ts \
  tests/reminder-dispatch/scheduler.test.ts \
  tests/payment-access/delivery-payload.test.ts \
  tests/payment-access/delivery-staff.test.ts \
  tests/payments/delivery.test.ts
```

Result:

```text
tests 69
pass 69
fail 0
duration_ms 756.191959
```

Coverage highlights:

- Retired direct send endpoints cannot bypass the queue even with credentials.
- Delivery policy fails closed for missing/disabled/malformed modes.
- Resend/Svix and Twilio signature validators reject changed, expired, or malformed payloads.
- Inbound processing preserves durable pending/retry/review semantics without inventing outcomes.
- Payment delivery previews verify exact email/SMS payload hashes without exposing live capabilities.
- Reminder dispatcher is disabled by default and blocks unauthorized/unconfigured execution before database work.

## Focused pgTAP no-live-send SQL drill

Command:

```bash
npx supabase test db --local \
  supabase/tests/contact_submissions_triage.test.sql \
  supabase/tests/outbound_deliveries.test.sql \
  supabase/tests/staff_outbound_queue.test.sql \
  supabase/tests/outbound_delivery_staff_controls.test.sql \
  supabase/tests/inbound_sms.test.sql \
  supabase/tests/inbound_delivery.test.sql \
  supabase/tests/operations_visibility.test.sql \
  supabase/tests/operations_candidates.test.sql \
  supabase/tests/reminder_outbox.test.sql \
  supabase/tests/b1_scheduler.test.sql
```

Result:

```text
All tests successful.
Files=10, Tests=369
Result: PASS
```

Coverage highlights:

- Anonymous contact submissions can be triaged by active staff and audited.
- Staff email/SMS queueing creates visible staff messages and queued outbound deliveries without direct browser RPC access.
- Manual retry/cancel controls work only for active staff and preserve direct table write denial.
- Inbound SMS handles existing-client, unknown-client, duplicate, STOP, and START flows through the service-role RPC.
- Delivery operations visibility covers queue/history states without direct client access to private scheduler tables.
- Appointment reminder enqueue and dispatcher containment remain closed to direct staff writes.
- Scheduler Vault values are absent, so scheduler calls record `configuration_missing` instead of posting.

## What this proves

- Disabled/test-mode delivery logic is locally coherent.
- Synthetic Resend/Twilio signature and callback handling is covered by local tests.
- Inbound STOP/START semantics are locally verified after the service-RPC security fix.
- Staff-visible queue/retry/cancel/operations surfaces have local database coverage.
- The local database is current through `20260924130000`.

## What this does not prove

- This is not a hosted staff/operator drill.
- Hosted Supabase still needs the two local-only migrations applied after explicit owner approval.
- No provider dashboard callback URL was activated.
- No live email, SMS, phone, voice, voicemail, or CloudTalk path was exercised.
- No production client recipient received a message.
