begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
create temp table unchanged_access as select jsonb_build_object(
 'functions',(select jsonb_agg(jsonb_build_object('id',p.oid,'definition',pg_get_functiondef(p.oid),'owner',p.proowner,'acl',p.proacl) order by p.oid) from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f'),
 'tables',(select jsonb_agg(jsonb_build_object('id',c.oid,'owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity) order by c.oid) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in('r','p','v','m')),
 'policies',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_policy p),
 'other_defaults',(select jsonb_agg(to_jsonb(d) order by d.oid) from pg_default_acl d where not(d.defaclrole='postgres'::regrole and d.defaclnamespace='public'::regnamespace))
) as value;
-- REPRODUCE_ACCESS_DRIFT
select is(jsonb_build_object(
 'functions',(select jsonb_agg(jsonb_build_object('id',p.oid,'definition',pg_get_functiondef(p.oid),'owner',p.proowner,'acl',p.proacl) order by p.oid) from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f'),
 'tables',(select jsonb_agg(jsonb_build_object('id',c.oid,'owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity) order by c.oid) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in('r','p','v','m')),
 'policies',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_policy p),
 'other_defaults',(select jsonb_agg(to_jsonb(d) order by d.oid) from pg_default_acl d where not(d.defaclrole='postgres'::regrole and d.defaclnamespace='public'::regnamespace))
),(select value from unchanged_access),'Correction preserves all functions/table access, policies and other creators/global defaults');
select ok(not exists(select 1 from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
 where d.defaclrole='postgres'::regrole and d.defaclnamespace='public'::regnamespace and d.defaclobjtype in('r','S','f')
 and a.grantee in(0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)),
 'Public postgres defaults contain no implicit API-role grants');
select ok(not has_sequence_privilege(r,s,p),r||' cannot '||p||' private history sequence '||s)
 from unnest(array['anesthesia_record_revisions_id_seq','care_plan_revisions_id_seq','communication_processing_history_id_seq','lab_work_revisions_id_seq','reminder_automation_policy_history_id_seq']) s
 cross join unnest(array['anon','authenticated','service_role']) r cross join unnest(array['USAGE','SELECT','UPDATE']) p;
select ok(has_sequence_privilege('postgres',s,'USAGE,SELECT,UPDATE'), 'Owner retains sequence access: '||s)
 from unnest(array['anesthesia_record_revisions_id_seq','care_plan_revisions_id_seq','communication_processing_history_id_seq','lab_work_revisions_id_seq','reminder_automation_policy_history_id_seq']) s;
set local role anon;
select throws_ok($$select nextval('public.anesthesia_record_revisions_id_seq')$$,'42501',null,'Anonymous sequence allocation is denied');
select throws_ok($$select setval('public.care_plan_revisions_id_seq',1)$$,'42501',null,'Anonymous sequence rewrite is denied');
reset role;
set local role postgres;
create table public.access_default_probe(id integer);
create sequence public.access_sequence_probe;
create function public.access_function_probe() returns integer language sql as 'select 1';
revoke all on function public.access_function_probe() from public;
select ok(not has_table_privilege(r,'public.access_default_probe',p),r||' has no future table '||p)
 from unnest(array['anon','authenticated','service_role']) r cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p;
select ok(not has_sequence_privilege(r,'public.access_sequence_probe',p),r||' has no future sequence '||p)
 from unnest(array['anon','authenticated','service_role']) r cross join unnest(array['USAGE','SELECT','UPDATE']) p;
select ok(not has_function_privilege(r,'public.access_function_probe()','EXECUTE'),r||' has no residual direct function execution after PUBLIC revoke')
 from unnest(array['anon','authenticated','service_role']) r;
select is(public.access_function_probe(),1,'Owner can execute future private function');
insert into public.access_default_probe values(1);
select is((select count(*) from public.access_default_probe),1::bigint,'Owner can populate future private table');
select is(nextval('public.access_sequence_probe'),1::bigint,'Owner can allocate future private sequence');
select * from finish();
rollback;
