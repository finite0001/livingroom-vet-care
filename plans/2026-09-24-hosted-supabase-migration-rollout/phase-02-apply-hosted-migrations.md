# Phase 02 — apply hosted migrations

## Priority

Critical. Mutates hosted Supabase. Do not run without explicit operator approval.

## Apply set

```text
20260924120000_canonical_housecall_appointment_contract.sql
20260924130000_inbound_sms_service_rpc_security.sql
```

## Risk classification

- Medium: `20260924120000` replaces appointment write/reminder functions so hosted appointment saves remain on the canonical housecall-aware contract.
- Low-to-medium: `20260924130000` changes the existing service-role-only inbound SMS RPC to run as `SECURITY DEFINER` with `search_path = public`; this lets the verified Edge handler path write through the RPC while direct table writes remain denied.
- Operational: no scheduler, provider dashboard, phone, CloudTalk, live SMS, voice, voicemail, seed, or role commissioning is included in this apply.

No explicit `COMMIT`, `VACUUM`, `REINDEX`, `CREATE INDEX CONCURRENTLY`, broad `DELETE`, or actual top-level `TRUNCATE` was found in the apply set.

## Apply command

```sh
npx supabase db push \
  --linked \
  --skip-vault \
  --yes
```

Rationale:

- `--linked` matches the current authenticated CLI context after Phase 01 verifies the linked target is `mgadheotkdnrsatfivjy`.
- `--skip-vault` avoids unintended secret updates.
- `--include-all` is intentionally omitted because both pending migrations are later than the current hosted checkpoint.
- `--yes` makes the operation noninteractive and auditable.

## Stop conditions

Stop and report if:

- CLI target is not `mgadheotkdnrsatfivjy`.
- CLI lists a different migration set.
- Any migration fails.

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
