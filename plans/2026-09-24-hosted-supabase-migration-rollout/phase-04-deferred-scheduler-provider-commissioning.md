# Phase 04 — deferred scheduler/provider commissioning

## Priority

After DB parity. Not required to close migration drift.

## Why separate

The DB migration can install scheduler tables/functions/cron jobs without enabling live work if Vault secrets are absent. Provider and scheduler commissioning is a different risk class because it can call Edge workers, queue work, or contact providers.

## Current cautions

- `cleanup-abandoned-attachment` is local-only in the current remote function inventory; do not add scheduler Vault secrets until this function is deployed or the cron job is intentionally unscheduled.
- Earlier launch evidence deployed some legacy-conflict slugs as disabled stubs. Before enabling scheduler Vault secrets, confirm `dispatch-outbox`, `process-inbound`, and `queue-reminders` remote source matches current reviewed code.
- `queue-reminders` remains default-off unless `REMINDER_SCHEDULER_ENABLED=true` and `APP_ENV` is staging/production.
- Outbound delivery remains gated by `OUTBOUND_DELIVERY_MODE`.
- CloudTalk remains deferred and out of scope.

## Commissioning checklist

1. Deploy or verify byte-match for worker slugs:
   - `dispatch-outbox`
   - `process-inbound`
   - `process-stripe-events`
   - `queue-reminders`
   - `cleanup-abandoned-attachment`
2. Confirm Edge secrets exist and are correct for worker auth:
   - `SUPABASE_SECRET_KEYS`
   - provider-specific keys only where intentionally commissioned
3. Only then add DB Vault names used by scheduler:
   - `project_url`
   - `scheduler_worker_key`
4. Review `/hub/admin/operations` as an ADMIN.
5. Confirm each scheduler job shows expected disabled/ok/failure state.
6. Enable provider delivery modes one provider/workflow at a time.

## Rollback / pause controls

- Withhold or remove Vault `project_url` / `scheduler_worker_key` to stop DB-initiated calls.
- Unschedule individual cron jobs with `cron.unschedule`.
- Keep provider flags disabled until acceptance evidence exists.
- Restore/PITR is the database rollback path for schema/data failures; migration repair is not rollback.
