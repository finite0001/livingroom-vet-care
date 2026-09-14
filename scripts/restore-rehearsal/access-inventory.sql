-- Read-only application access inventory. Names, not internal role OIDs, define order.
with settings as materialized (
  select set_config('search_path','public, extensions',true)
), relations as (
  select c.relname as name,c.relkind as kind,pg_get_userbyid(c.relowner) as owner,
    c.relrowsecurity as rls,c.relforcerowsecurity as force_rls,
    (select jsonb_object_agg(r,case when c.relkind='S' then
      (select jsonb_object_agg(priv,has_sequence_privilege(r,c.oid,priv)) from unnest(array['USAGE','SELECT','UPDATE']) priv)
     else (select jsonb_object_agg(priv,has_table_privilege(r,c.oid,priv)) from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) priv) end)
     from unnest(array['anon','authenticated','service_role']) r) as grants
  from settings cross join pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p','v','m','S')
), policies as (
  select p.* from settings cross join pg_policies p where p.schemaname='public'
), defaults as (
  select pg_get_userbyid(d.defaclrole) as owner,d.defaclobjtype as kind,
    case when d.defaclnamespace=0 then '*' else 'public' end as schema,
    (select jsonb_agg(jsonb_build_object(
      'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
      'grantor',pg_get_userbyid(a.grantor),'privilege',a.privilege_type,'grantable',a.is_grantable)
      order by (case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end) collate "C",
        pg_get_userbyid(a.grantor) collate "C",a.privilege_type collate "C",a.is_grantable)
     from aclexplode(d.defaclacl) a) as acl
  from settings cross join pg_default_acl d
  where d.defaclnamespace in (0,'public'::regnamespace)
)
select jsonb_build_object(
  'versions',(select jsonb_agg(version order by version collate "C") from supabase_migrations.schema_migrations),
  'relations',(select jsonb_agg(to_jsonb(r) order by name collate "C") from relations r),
  'policies',coalesce((select jsonb_agg(to_jsonb(p) order by tablename collate "C",policyname collate "C") from policies p),'[]'::jsonb),
  'default_privileges',coalesce((select jsonb_agg(to_jsonb(d) order by owner collate "C",schema collate "C",kind) from defaults d),'[]'::jsonb)
) as inventory;
