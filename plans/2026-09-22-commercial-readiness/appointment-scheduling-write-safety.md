# Appointment Scheduling Write Safety

Status: core database hardening implemented locally in `20260922203000_appointment_write_safety.sql`; full disposable-stack pgTAP passed with 233 assertions.

## Implemented in this wave

- Dropped the broad `Auth manage appointments` path for browser users.
- Added `version`, `created_by`, and `updated_by` appointment metadata.
- Added `save_appointment(...)` and `cancel_appointment(...)` RPCs for Hub create/update/cancel.
- Added database validation for active staff, pet/client ownership, archived/deceased patient scheduling, active-DVM assignment, duration/type/notes bounds, closed-status reactivation, and optimistic version conflicts.
- Added reminder regeneration: scheduling-relevant appointment changes supersede pending/queued reminders, cancel queued outbound deliveries, and create replacement pending reminders.
- Added `supabase/tests/appointments_write_safety.test.sql`.

## Still required before live scheduling

- Add practice hours, clinician availability, blocked-time, and capacity rules.
- Add housecall travel buffers, route grouping, and map-distance checks.
- Add staff-facing conflict warnings/override policy once business rules are approved.
- Add hosted acceptance against the chosen Supabase project after project linkage/cutover decisions.

## Outbound operating-loop follow-up

Appointment reminders now enqueue into `outbound_deliveries`. The direct `send-email` and `send-sms` Edge Functions are retired HTTP 410 endpoints, so live messaging must use the reviewed durable queue/worker path with shared idempotency, retry, lease ownership and provider callback semantics. Keep provider delivery disabled until controlled round-trip acceptance is approved.
