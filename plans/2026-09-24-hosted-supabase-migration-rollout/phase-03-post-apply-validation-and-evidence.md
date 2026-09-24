# Phase 03 — post-apply validation and evidence

## Priority

Critical. Run immediately after Phase 02.

## Migration parity

```sh
npm run supabase:migration-drift

npx supabase db push \
  --project-ref mgadheotkdnrsatfivjy \
  --skip-vault \
  --include-all \
  --dry-run
```

Expected:

- 148 matching migrations.
- 0 remote-only.
- 0 local-only.
- Dry-run says database is up to date.

## Schema and scheduler checks

```sh
npx supabase db query --linked \
  "select exists(select 1 from pg_extension where extname='pg_cron') as pg_cron_installed, exists(select 1 from pg_extension where extname='pg_net') as pg_net_installed;"

npx supabase db query --linked \
  "select jobname, schedule, command from cron.job where jobname in ('dispatch-outbox','process-inbound','process-stripe-events','queue-reminders','cleanup-abandoned-attachment','scheduler-reconcile') order by jobname;"

npx supabase db query --linked \
  "select name from vault.secrets where name in ('project_url','scheduler_worker_key') order by name;"
```

Expected:

- `pg_cron` and `pg_net` installed.
- Six expected cron jobs present.
- Scheduler Vault secrets still absent unless separately commissioned.

After one cron interval, optional direct table evidence:

```sh
npx supabase db query --linked \
  "select r.job, s.outcome, s.status_code, s.error_message
   from public.scheduler_job_runs r
   left join public.scheduler_job_results s on s.run_id = r.id
   order by r.requested_at desc, r.id desc
   limit 20;"
```

Expected while uncommissioned: no rows yet, or bounded `configuration_missing` rows. No successful worker calls should be expected until Vault secrets and worker deployments are intentionally commissioned.

## Readiness evidence refresh

```sh
LRV_EVIDENCE_DATE="$(date -u +%F)"

node scripts/hosted-readiness-inventory.mjs \
  --output "docs/launch-evidence/${LRV_EVIDENCE_DATE}-hosted-readiness-inventory.json"

node scripts/supabase-schema-inventory.mjs \
  --output "docs/launch-evidence/${LRV_EVIDENCE_DATE}-remote-public-schema-inventory.json"

node scripts/supabase-functions-inventory.mjs \
  --output "docs/launch-evidence/${LRV_EVIDENCE_DATE}-edge-functions-inventory.json"

node scripts/review-remote-edge-functions.mjs \
  --inventory "docs/launch-evidence/${LRV_EVIDENCE_DATE}-edge-functions-inventory.json" \
  --output "docs/launch-evidence/${LRV_EVIDENCE_DATE}-remote-edge-function-review.json"

node scripts/hub-workflow-readiness.mjs \
  --schema-inventory "docs/launch-evidence/${LRV_EVIDENCE_DATE}-remote-public-schema-inventory.json" \
  --functions-inventory "docs/launch-evidence/${LRV_EVIDENCE_DATE}-edge-functions-inventory.json" \
  --output "docs/launch-evidence/${LRV_EVIDENCE_DATE}-hub-workflow-readiness.json"

node scripts/commercial-readiness-summary.mjs \
  --output "docs/launch-evidence/${LRV_EVIDENCE_DATE}-commercial-readiness-summary.json"
```

Then:

```sh
npm run readiness:summary
```

Expected: 4/5 gates passing, still blocked only by owner public contact content unless the owner details have been filled.

`npm run preflight:deployment` is valid again after the build-contract assertion was aligned with the guarded deployment wrapper. Treat it as a broader deployment gate, not the minimal hosted DB rollout gate, because it also runs browser tests and a deployment build.

Do not make the Supabase `health` Edge Function a hard gate unless deploying `health` is explicitly added to this rollout. Current remote function inventory does not show that slug deployed.

## Public/domain smoke

These are useful after hosted DB parity, but they validate Vercel/domain routing rather than migration correctness:

```sh
curl -I --max-time 10 https://thelivingroom.vet
curl -I --max-time 10 https://www.thelivingroom.vet
curl -I --max-time 10 https://thelivingroom.vet/hub
```

Expected known blockers remain owner public-contact content and deferred CloudTalk/public contact setup. Provider dashboards, schedulers, and live delivery remain separate commissioning boundaries.

## Commit evidence

If evidence files are written into `docs/launch-evidence`, commit them separately:

```sh
git status --short
git diff -- docs/launch-evidence
git add docs/launch-evidence
git commit -m "docs(readiness): record hosted migration rollout"
git push origin main
```

Do not commit private dumps, raw schema SQL, local credentials, or provider secret values.
