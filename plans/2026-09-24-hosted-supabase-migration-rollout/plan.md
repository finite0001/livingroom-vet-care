# Hosted Supabase migration rollout plan

Date: 2026-09-24
Target branch: `main`
Target Supabase project: `mgadheotkdnrsatfivjy` / `livingroom-vet-care`
Status: PR #204 hosted rollout applied and validated 2026-09-24; current two-migration readiness apply is pending explicit owner approval.

## Objective

Bring hosted Supabase migration history back to parity with current `main` after the post-PR #204 readiness work, without accidentally commissioning CloudTalk, provider delivery, or live schedulers.

## Current evidence

- PR #204 hosted rollout evidence recorded 148 matching migrations, 0 remote-only, and 0 local-only at that checkpoint.
- Current local readiness stack reaches `20260924130000_inbound_sms_service_rpc_security.sql`.
- `npx supabase db push --linked --dry-run --skip-vault` currently reports exactly two local-only migrations:
  - `20260924120000_canonical_housecall_appointment_contract.sql`
  - `20260924130000_inbound_sms_service_rpc_security.sql`
- [2026-09-24 hosted readiness pre-apply check](../../docs/launch-evidence/2026-09-24-hosted-readiness-preapply-check.md) verifies the linked target is `mgadheotkdnrsatfivjy` and records scheduler containment.
- Generated readiness evidence currently reports 3/5 gates passing, blocked by the two local-only migrations and owner public-contact content.
- Local release-control proof at `e88b7a8` passed lint, TypeScript, 1078 Node tests, and production build.
- Local no-live-send and integrated synthetic workflow evidence exists before hosted apply.
- Remote Vault names `project_url` and `scheduler_worker_key` are absent, so the scheduler migration should not actively call Edge workers until later commissioning.
- Remote `pg_cron`, `pg_net`, and the expected `cron.job` entries already exist from the PR #204 rollout. Scheduler Vault secrets remain absent, so database cron cannot call workers yet.

## Rollout phases

1. [Phase 01 — final preflight and backup](phase-01-final-preflight-and-backup.md)
2. [Phase 02 — apply hosted migrations](phase-02-apply-hosted-migrations.md)
3. [Phase 03 — post-apply validation and evidence](phase-03-post-apply-validation-and-evidence.md)
4. [Phase 04 — deferred scheduler/provider commissioning](phase-04-deferred-scheduler-provider-commissioning.md)

## Go / no-go summary

Go only if:

- The operator confirms hosted DB mutation.
- The explicit target is `mgadheotkdnrsatfivjy`.
- The dry run still lists exactly the same two migrations.
- A managed backup/PITR checkpoint or private operator dump exists outside Git.
- Scheduler Vault secrets remain absent, unless scheduler worker commissioning is intentionally included.

No-go if:

- Any remote-only migrations reappear.
- The dry run lists anything other than the two readiness migrations.
- The operator cannot accept restore/PITR as the rollback path.
- CloudTalk, live phone, live SMS, voice, voicemail, or public-contact publication is being folded into this apply.

## Apply command, only after explicit approval

```sh
npx supabase db push \
  --linked \
  --skip-vault \
  --yes
```

Before using `--linked`, verify `npx supabase status --output json` reports `linked_project_ref` as `mgadheotkdnrsatfivjy`. A direct `--project-ref mgadheotkdnrsatfivjy` dry run may require `SUPABASE_DB_PASSWORD` in the current CLI auth context; use it only if the operator has supplied that securely. Do not run this plan with `--include-all`, `--include-seed`, `--include-roles`, or without `--skip-vault` unless a fresh dry run proves that broader scope is required and the owner explicitly approves it.

## Expected post-apply state

- Migration drift: 150 matching, 0 remote-only, 0 local-only.
- `pg_cron`, `pg_net`, and scheduler jobs remain present from PR #204.
- Scheduler jobs may exist, but without Vault `project_url` / `scheduler_worker_key` they should record bounded `configuration_missing` evidence instead of calling Edge workers.
- Commercial readiness should remain 4/5 blocked only by owner public contact content.

## Separate cleanup handled

`npm run preflight:deployment` previously had a stale assertion for the deployment build script. It now verifies the guarded `node scripts/build-deployment.mjs` wrapper and the checked-in Vercel build command. The full preflight remains larger than the hosted DB rollout gate because it also runs browser tests and a deployment build.
