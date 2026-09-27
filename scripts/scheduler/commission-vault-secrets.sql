-- Owner-run: create or rotate the two Vault secrets public.scheduler_dispatch()
-- reads (20260922120000_b1_scheduler.sql). Idempotent: re-running updates the
-- existing secrets in place, so it is also the rotation procedure.
--
-- No secret value lives in this file, in argv or in shell history. psql reads
-- both values from environment variables with \getenv (psql 15 or newer), and
-- nothing below prints them. Full procedure: docs/scheduler.md.
--
--   read -r  LRV_PROJECT_URL            # https://<project-ref>.supabase.co
--   read -rs LRV_SCHEDULER_WORKER_KEY   # an sb_secret_... key; input is hidden
--   export LRV_PROJECT_URL LRV_SCHEDULER_WORKER_KEY
--   LRV_DRY_RUN=1 psql "$LRV_DB_URL" -X -f scripts/scheduler/commission-vault-secrets.sql   # validate, then roll back
--   psql "$LRV_DB_URL" -X -f scripts/scheduler/commission-vault-secrets.sql                 # commit
--   unset LRV_SCHEDULER_WORKER_KEY
--
-- Setting these secrets STARTS database-initiated calls to the Edge workers every
-- minute. Workers stay fail-closed behind their own gates
-- (REMINDER_SCHEDULER_ENABLED, APP_ENV, OUTBOUND_DELIVERY_MODE), so this alone
-- sends no message. To stop the calls, delete the two secrets (docs/scheduler.md).

\set ON_ERROR_STOP on
\set QUIET on
\getenv lrv_project_url LRV_PROJECT_URL
\getenv lrv_worker_key LRV_SCHEDULER_WORKER_KEY
\getenv lrv_dry_run LRV_DRY_RUN
\if :{?lrv_project_url}
\else
  \echo 'LRV_PROJECT_URL is not set. Nothing was changed.'
  \quit
\endif
\if :{?lrv_worker_key}
\else
  \echo 'LRV_SCHEDULER_WORKER_KEY is not set. Nothing was changed.'
  \quit
\endif

begin;
-- Session-private and dropped at transaction end; never selected back out.
create temp table lrv_scheduler_secret_input(name text primary key, value text not null, description text not null) on commit drop;
insert into lrv_scheduler_secret_input values
  ('project_url', :'lrv_project_url', 'Supabase project URL for public.scheduler_dispatch (docs/scheduler.md)'),
  ('scheduler_worker_key', :'lrv_worker_key', 'sb_secret_ worker key accepted by _shared/worker-auth.ts (docs/scheduler.md)');

do $$
declare s record; existing uuid;
begin
  -- Messages never include the supplied values.
  if (select value from lrv_scheduler_secret_input where name = 'project_url') !~ '^https://[a-z0-9]{20}\.supabase\.co$' then
    raise exception 'project_url must look like https://<20-character project ref>.supabase.co with no trailing slash';
  end if;
  if (select value from lrv_scheduler_secret_input where name = 'scheduler_worker_key') !~ '^sb_secret_[A-Za-z0-9_-]+$' then
    raise exception 'scheduler_worker_key must be an sb_secret_ key; publishable, anon and legacy JWT keys are rejected by the workers';
  end if;
  for s in select * from lrv_scheduler_secret_input order by name loop
    select id into existing from vault.secrets where name = s.name;
    if existing is null then
      perform vault.create_secret(s.value, s.name, s.description);
    else
      perform vault.update_secret(existing, s.value, s.name, s.description);
    end if;
  end loop;
end $$;

-- Names, timestamps and the non-secret project URL only.
select s.name,
       case when s.name = 'project_url' then d.decrypted_secret else '(hidden)' end as value,
       s.updated_at
  from vault.secrets s join vault.decrypted_secrets d on d.id = s.id
 where s.name in ('project_url', 'scheduler_worker_key')
 order by s.name;

\if :{?lrv_dry_run}
  rollback;
  \echo 'Dry run: values validated and rolled back. Vault is unchanged.'
\else
  commit;
  \echo 'Vault secrets committed. Run scripts/scheduler/verify-scheduler.sql after two minutes.'
\endif
