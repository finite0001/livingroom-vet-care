# Hosted readiness pre-apply check

Date: 2026-09-24
Scope: read-only hosted Supabase checks before the current two-migration readiness apply
Target project: `mgadheotkdnrsatfivjy`
Commit checked: `9291b6d`

## Summary

The current hosted pre-apply checks confirm the same readiness boundary:

- Hosted Supabase still has exactly two local-only readiness migrations.
- The linked project target is `mgadheotkdnrsatfivjy`.
- Scheduler Vault secrets `project_url` and `scheduler_worker_key` are absent.
- `pg_cron`, `pg_net`, and the six expected cron jobs are present from the previous PR #204 rollout.
- No hosted SQL was applied during this check.

## Migration drift

Command:

```bash
npm run supabase:migration-drift
```

Result:

```json
{
  "matching_count": 148,
  "remote_only_count": 0,
  "local_only_count": 2,
  "local_only": [
    "20260924120000",
    "20260924130000"
  ],
  "remote_only_first": [],
  "remote_only_last": [],
  "source": {
    "command": "npx supabase db push --linked --dry-run --skip-vault",
    "message": "Finished supabase db push."
  }
}
```

## Linked target verification

Command:

```bash
npx supabase status --output json
```

Relevant result:

```json
{
  "linked_project_name": "livingroom-vet-care",
  "linked_project_ref": "mgadheotkdnrsatfivjy"
}
```

`supabase/config.toml` also contains:

```toml
project_id = "mgadheotkdnrsatfivjy"
```

## Hosted dry run

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

A direct `--project-ref mgadheotkdnrsatfivjy` dry run returned `LegacyDbConnectError` for `cli_login_postgres` in this CLI auth context and suggested `SUPABASE_DB_PASSWORD`. The linked command above succeeds after verifying the linked target, so the current runbook uses `--linked` plus explicit target verification.

## Scheduler containment

Command:

```bash
npx supabase db query --linked \
  "select name from vault.secrets where name in ('project_url','scheduler_worker_key') order by name;"
```

Result:

```json
{
  "rows": []
}
```

Command:

```bash
npx supabase db query --linked \
  "select exists(select 1 from pg_extension where extname='pg_cron') as pg_cron_installed, exists(select 1 from pg_extension where extname='pg_net') as pg_net_installed;"
```

Result:

```json
{
  "rows": [
    {
      "pg_cron_installed": true,
      "pg_net_installed": true
    }
  ]
}
```

Command:

```bash
npx supabase db query --linked \
  "select to_regclass('cron.job') is not null as cron_job_table_exists;"
```

Result:

```json
{
  "rows": [
    {
      "cron_job_table_exists": true
    }
  ]
}
```

Command:

```bash
npx supabase db query --linked \
  "select jobname, schedule from cron.job where jobname in ('dispatch-outbox','process-inbound','process-stripe-events','queue-reminders','cleanup-abandoned-attachment','scheduler-reconcile') order by jobname;"
```

Result:

```json
{
  "rows": [
    {
      "jobname": "cleanup-abandoned-attachment",
      "schedule": "*/30 * * * *"
    },
    {
      "jobname": "dispatch-outbox",
      "schedule": "* * * * *"
    },
    {
      "jobname": "process-inbound",
      "schedule": "* * * * *"
    },
    {
      "jobname": "process-stripe-events",
      "schedule": "* * * * *"
    },
    {
      "jobname": "queue-reminders",
      "schedule": "*/15 * * * *"
    },
    {
      "jobname": "scheduler-reconcile",
      "schedule": "* * * * *"
    }
  ]
}
```

## What this proves

- The hosted apply boundary is still the two expected readiness migrations.
- The currently linked Supabase project is the intended hosted project.
- Scheduler database infrastructure is present but contained by absent Vault secrets.
- The hosted apply can be performed later through the linked project context after explicit owner approval.

## What this does not prove

- This does not apply hosted SQL.
- This does not configure provider dashboards, CloudTalk, live phone, voice, voicemail, live SMS, or live email.
- This does not clear public phone/email/emergency content blockers.
- This does not replace a fresh dry run immediately before the actual hosted apply.
