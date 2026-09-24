# Phase 01 — final preflight and backup

## Priority

Critical. Run immediately before applying hosted migrations.

## Context links

- Target config: `/Users/davidedler/livingroom-vet-care/supabase/config.toml`
- Deployment runbook: `/Users/davidedler/livingroom-vet-care/docs/deployment-runbook.md`
- Restore runbook: `/Users/davidedler/livingroom-vet-care/docs/restore-runbook.md`
- Prior drift evidence: `/Users/davidedler/livingroom-vet-care/docs/launch-evidence/2026-09-23-supabase-link-and-migration-drift.md`

## Required checks

```sh
cd /Users/davidedler/livingroom-vet-care

git switch main
git pull --ff-only origin main
git status --short --branch
git log -1 --oneline --decorate

rg -n '^project_id = "mgadheotkdnrsatfivjy"$' supabase/config.toml
npm run supabase:migration-drift
```

Expected drift:

```json
{
  "matching_count": 123,
  "remote_only_count": 0,
  "local_only_count": 25
}
```

Run explicit dry-run:

```sh
npx supabase db push \
  --project-ref mgadheotkdnrsatfivjy \
  --skip-vault \
  --include-all \
  --dry-run
```

Expected: exactly the 25 migration files listed in Phase 02. No seeds. No roles.

## Scheduler containment checks

```sh
npx supabase db query --project-ref mgadheotkdnrsatfivjy \
  "select name from vault.secrets where name in ('project_url','scheduler_worker_key') order by name;"

npx supabase db query --project-ref mgadheotkdnrsatfivjy \
  "select exists(select 1 from pg_extension where extname='pg_cron') as pg_cron_installed, exists(select 1 from pg_extension where extname='pg_net') as pg_net_installed;"

npx supabase db query --project-ref mgadheotkdnrsatfivjy \
  "select to_regclass('cron.job') is not null as cron_job_table_exists;"
```

Expected before apply:

- no `project_url`
- no `scheduler_worker_key`
- `pg_cron_installed = false`
- `pg_net_installed = false`
- `cron_job_table_exists = false`

If Vault secrets are present, stop and decide whether scheduler worker commissioning is in scope.

## Conflict prechecks

```sh
npx supabase db query --project-ref mgadheotkdnrsatfivjy \
  "select jsonb_build_object(
    'storage_buckets', (
      select coalesce(jsonb_agg(id order by id), '[]'::jsonb)
      from storage.buckets
      where id in ('conversation-attachment-uploads','inbound-attachment-originals')
    ),
    'native_return_policy_state', to_regclass('public.native_return_policy_state') is not null
  ) as precheck;"
```

Expected:

- `storage_buckets` does not include those two bucket IDs.
- `native_return_policy_state` is false before this migration set.

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
- Drift unchanged and understood.
- Dry-run succeeds with exactly 25 files.
- Backup/PITR posture accepted.
- Scheduler containment understood before apply.
