# Hosted Supabase migration rollout plan

Date: 2026-09-24
Target branch: `main`
Target Supabase project: `mgadheotkdnrsatfivjy` / `livingroom-vet-care`
Status: applied and validated 2026-09-24.

## Objective

Bring hosted Supabase migration history back to parity with merged `main` after PR #204, without accidentally commissioning CloudTalk, provider delivery, or live schedulers.

## Current evidence

- Local repo is on `main` with rollout evidence committed locally after merge commit `6574baa`.
- `npm run supabase:migration-drift` reports 148 matching, 0 remote-only, 0 local-only.
- `npx supabase db push --linked --skip-vault --include-all --dry-run` reports the remote database is up to date.
- Remote public schema post-inventory succeeds and includes the audited operating-loop dependencies.
- Remote data-volume spot check is low-risk: 1 Auth user; 0 clients, pets, communication outbox rows, and contact submissions.
- Remote Vault names `project_url` and `scheduler_worker_key` are absent, so the scheduler migration should not actively call Edge workers until later commissioning.
- Remote `pg_cron`, `pg_net`, and the expected `cron.job` entries now exist. Scheduler Vault secrets remain absent, so database cron cannot call workers yet.

## Rollout phases

1. [Phase 01 — final preflight and backup](phase-01-final-preflight-and-backup.md)
2. [Phase 02 — apply hosted migrations](phase-02-apply-hosted-migrations.md)
3. [Phase 03 — post-apply validation and evidence](phase-03-post-apply-validation-and-evidence.md)
4. [Phase 04 — deferred scheduler/provider commissioning](phase-04-deferred-scheduler-provider-commissioning.md)

## Go / no-go summary

The 2026-09-24 apply is complete. For any future rerun, go only if:

- The operator confirms hosted DB mutation.
- The explicit target is `mgadheotkdnrsatfivjy`.
- `--include-all --dry-run` still lists the same 25 migrations.
- A managed backup/PITR checkpoint or private operator dump exists outside Git.
- Scheduler Vault secrets remain absent, unless scheduler worker commissioning is intentionally included.

No-go if:

- Any remote-only migrations reappear.
- `--include-all --dry-run` lists anything other than the known 25 files.
- Existing storage buckets or singleton policy rows would conflict with migration inserts.
- The operator cannot accept restore/PITR as the rollback path.

## Apply command, only after explicit approval

```sh
npx supabase db push \
  --project-ref mgadheotkdnrsatfivjy \
  --skip-vault \
  --include-all \
  --yes
```

Do not run this plan with `--include-seed`, `--include-roles`, or without `--skip-vault`.

## Expected post-apply state

- Migration drift: 148 matching, 0 remote-only, 0 local-only.
- `pg_cron` and `pg_net` installed after `20260922120000_b1_scheduler.sql`.
- Scheduler jobs may exist, but without Vault `project_url` / `scheduler_worker_key` they should record bounded `configuration_missing` evidence instead of calling Edge workers.
- Commercial readiness should remain 4/5 blocked only by owner public contact content.

## Separate cleanup handled

`npm run preflight:deployment` previously had a stale assertion for the deployment build script. It now verifies the guarded `node scripts/build-deployment.mjs` wrapper and the checked-in Vercel build command. The full preflight remains larger than the hosted DB rollout gate because it also runs browser tests and a deployment build.
