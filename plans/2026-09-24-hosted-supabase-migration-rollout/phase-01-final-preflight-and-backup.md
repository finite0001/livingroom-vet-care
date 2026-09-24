# Phase 01 — final preflight and backup

## Priority

Critical. Run immediately before applying hosted migrations.

## Context links

- Target config: `/Users/davidedler/livingroom-vet-care/supabase/config.toml`
- Deployment runbook: `/Users/davidedler/livingroom-vet-care/docs/deployment-runbook.md`
- Restore runbook: `/Users/davidedler/livingroom-vet-care/docs/restore-runbook.md`
- Prior drift evidence: `/Users/davidedler/livingroom-vet-care/docs/launch-evidence/2026-09-23-supabase-link-and-migration-drift.md`
- Current local DB replay proof: `/Users/davidedler/livingroom-vet-care/docs/launch-evidence/2026-09-24-current-stack-db-replay-pgtap.md`
- Current no-live-send proof: `/Users/davidedler/livingroom-vet-care/docs/launch-evidence/2026-09-24-no-live-send-local-drill.md`
- Current release-control proof: `/Users/davidedler/livingroom-vet-care/docs/launch-evidence/2026-09-24-local-release-control-check.md`
- Current pre-apply linked-target proof: `/Users/davidedler/livingroom-vet-care/docs/launch-evidence/2026-09-24-hosted-readiness-preapply-check.md`

## Required checks

```sh
cd /Users/davidedler/livingroom-vet-care

git switch main
git pull --ff-only origin main
git status --short --branch
git log -1 --oneline --decorate

rg -n '^project_id = "mgadheotkdnrsatfivjy"$' supabase/config.toml
npx supabase status --output json
npm run supabase:migration-drift
```

Expected drift:

```json
{
  "matching_count": 148,
  "remote_only_count": 0,
  "local_only_count": 2,
  "local_only": ["20260924120000", "20260924130000"]
}
```

Run explicit dry-run:

```sh
npx supabase db push \
  --linked \
  --skip-vault \
  --dry-run
```

Expected: exactly the two migration files listed in Phase 02. No seeds. No roles.

The linked dry run is acceptable only after `supabase/config.toml` and `npx supabase status --output json` both identify `mgadheotkdnrsatfivjy`. If using `--project-ref mgadheotkdnrsatfivjy`, be aware that the CLI may require `SUPABASE_DB_PASSWORD` even when linked commands work.

## Scheduler containment checks

```sh
npx supabase db query --linked \
  "select name from vault.secrets where name in ('project_url','scheduler_worker_key') order by name;"

npx supabase db query --linked \
  "select exists(select 1 from pg_extension where extname='pg_cron') as pg_cron_installed, exists(select 1 from pg_extension where extname='pg_net') as pg_net_installed;"

npx supabase db query --linked \
  "select to_regclass('cron.job') is not null as cron_job_table_exists;"
```

Expected before apply:

- no `project_url`
- no `scheduler_worker_key`
- `pg_cron_installed = true`
- `pg_net_installed = true`
- `cron_job_table_exists = true`

If Vault secrets are present, stop and decide whether scheduler worker commissioning is in scope.

## Backup / restore gate

Preferred: confirm Supabase managed backup/PITR is available for `mgadheotkdnrsatfivjy` immediately before apply.

Optional private operator dumps, outside Git:

```sh
LRV_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LRV_PRIVATE_DIR="/Users/davidedler/.local/share/livingroom-vet/hosted-rollout/$LRV_STAMP"
install -d -m 700 "$LRV_PRIVATE_DIR"

npx supabase db dump --project-ref mgadheotkdnrsatfivjy --schema public --file "$LRV_PRIVATE_DIR/public-schema-before.sql" --yes
npx supabase db dump --project-ref mgadheotkdnrsatfivjy --role-only --file "$LRV_PRIVATE_DIR/roles-before.sql" --yes
shasum -a 256 "$LRV_PRIVATE_DIR"/*.sql > "$LRV_PRIVATE_DIR/SHA256SUMS.txt"
```

Do not commit private dumps. A full data dump may contain PII; use a protected local directory only if the operator explicitly wants it.

## Success criteria

- Target project verified.
- Linked project verified as `mgadheotkdnrsatfivjy`.
- Drift unchanged and understood.
- Dry-run succeeds with exactly two files.
- Backup/PITR posture accepted.
- Scheduler containment understood before apply.
