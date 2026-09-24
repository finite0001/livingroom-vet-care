# Phase 02 — apply hosted migrations

## Priority

Critical. Mutates hosted Supabase. Do not run without explicit operator approval.

## Apply set

```text
20260916033310_ezyvet_migration_weight_evidence.sql
20260916043949_ezyvet_migration_resolutions.sql
20260916055043_native_prescriptions_lifecycle.sql
20260916062136_native_prescription_authorization_events.sql
20260916063857_native_refill_operational_intake.sql
20260916070108_inventory_product_before_lot_locking.sql
20260916072509_native_fulfillment.sql
20260916080105_native_record_releases.sql
20260916083056_native_dispense_corrections.sql
20260916090000_native_dispense_returns.sql
20260916093000_native_return_quantity_replay.sql
20260916094500_native_return_reconciliation.sql
20260916100000_native_return_reconciliation_releases.sql
20260916100001_conversation_attachment_uploads.sql
20260916110000_native_dispense_finance.sql
20260916110001_conversation_email_preparation.sql
20260916120000_inbound_attachment_capture.sql
20260916120716_native_estimate_drafts.sql
20260916123017_native_estimate_publications.sql
20260916130000_abandoned_attachment_cleanup.sql
20260916144117_native_estimate_decisions.sql
20260919120000_new_auth_users_inactive.sql
20260921120000_a5_on_duty_guard.sql
20260921130000_a4_consent_submission_columns.sql
20260922120000_b1_scheduler.sql
```

## Risk classification

- Low-to-medium: ezyVet evidence/review migrations are mostly additive admin-gated tables/RPCs.
- Medium: native prescriptions/refills/fulfillment alter constraints and remove legacy refill writes.
- Highest: native dispense corrections/returns/reconciliation/finance alter existing inventory/record-release behavior and wrap/rename core RPCs.
- Medium: conversation/inbound attachment migrations add Storage buckets and service-only capture/read flows.
- Medium: native estimates add a large security-definer surface and integrity triggers.
- Operational: scheduler creates `pg_net`, `pg_cron`, and cron jobs. With Vault secrets absent, it should fail closed as `configuration_missing`; with Vault secrets present, it begins calling Edge workers.

No explicit `COMMIT`, `VACUUM`, `REINDEX`, `CREATE INDEX CONCURRENTLY`, broad `DELETE`, or actual top-level `TRUNCATE` was found in the apply set.

## Apply command

```sh
npx supabase db push \
  --project-ref mgadheotkdnrsatfivjy \
  --skip-vault \
  --include-all \
  --yes
```

Rationale:

- `--project-ref` prevents accidental linked-context drift.
- `--skip-vault` avoids unintended secret updates.
- `--include-all` is required because these files are earlier than the current remote latest migration receipt.
- `--yes` makes the operation noninteractive and auditable.

## Stop conditions

Stop and report if:

- CLI target is not `mgadheotkdnrsatfivjy`.
- CLI lists a different migration set.
- Any migration fails.
- The failure is after creating `pg_cron` jobs or Storage buckets; immediately capture the error and post-state before retrying.

Do not use `migration repair` as rollback. Do not edit hosted migration history to force parity.

## Immediate containment if scheduler misbehaves

If scheduled jobs start making unintended calls:

```sql
select cron.unschedule('dispatch-outbox');
select cron.unschedule('process-inbound');
select cron.unschedule('process-stripe-events');
select cron.unschedule('queue-reminders');
select cron.unschedule('cleanup-abandoned-attachment');
select cron.unschedule('scheduler-reconcile');
```

Also remove/withhold Vault `project_url` and `scheduler_worker_key` until worker commissioning is intentionally approved.
