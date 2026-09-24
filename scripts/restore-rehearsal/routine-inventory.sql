-- Read-only application routine/trigger drift inventory. Hashes detect differences,
-- not authenticity. Exclude extension-owned routines that Supabase manages.
with settings as materialized (
  select set_config('search_path', 'public, extensions', true)
), routines as (
  select p.oid::regprocedure::text as signature,
    md5(pg_get_functiondef(p.oid)) as definition_md5,
    pg_get_userbyid(p.proowner) as owner,
    p.prosecdef as security_definer, p.proconfig as configuration,
    (select jsonb_object_agg(role_name, has_function_privilege(role_name,p.oid,'EXECUTE'))
      from unnest(array['anon','authenticated','service_role']) role_name) as execute_grants
  from settings cross join pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f'
    and not exists (select 1 from pg_depend d where d.classid='pg_proc'::regclass
      and d.objid=p.oid and d.deptype='e')
), triggers as (
  select c.relname as table_name, t.tgname as trigger_name,
    t.tgenabled as enabled_mode, pg_get_triggerdef(t.oid) as definition
  from settings cross join pg_trigger t
  join pg_class c on c.oid=t.tgrelid
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and not t.tgisinternal
)
select jsonb_build_object(
  'versions',(select jsonb_agg(version order by version collate "C") from supabase_migrations.schema_migrations),
  'routines',(select jsonb_agg(to_jsonb(r) order by signature collate "C") from routines r),
  'triggers',(select jsonb_agg(to_jsonb(t) order by table_name collate "C", trigger_name collate "C") from triggers t)
) as inventory;
