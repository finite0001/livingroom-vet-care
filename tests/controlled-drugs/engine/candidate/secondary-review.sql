-- Gate A feasibility shell only: no review protocol, grants, eligibility or activation.
-- Bodies are independently bound by secondary_review_descriptor.py's finite inventory.
-- BEGIN FUNCTION immutable_guard|trigger|plpgsql
begin
 raise exception 'Secondary-review evidence is immutable' using errcode='23514';
end
-- END FUNCTION
-- BEGIN FUNCTION preparation_context|trigger|plpgsql
begin
 new.prepared_boot:=pg_postmaster_start_time();
 new.prepared_xid:=pg_current_xact_id();
 return new;
end
-- END FUNCTION
-- BEGIN FUNCTION required|void|plpgsql
begin
 perform public.controlled_stock_manifest_required();
 if (select count(*) from controlled_review.descriptor)<>1 or
    (select definition from controlled_review.descriptor) is distinct from controlled_review.snapshot() then
  raise exception 'Secondary-review metadata differs from independent descriptor' using errcode='23514';
 end if;
end
-- END FUNCTION
-- BEGIN FUNCTION require_prior_commit|void|plpgsql|p_operation_id uuid
 declare p controlled_review.preparations;
begin
 perform controlled_review.required();
 select * into strict p from controlled_review.preparations where operation_id=p_operation_id;
 if p.prepared_boot=pg_postmaster_start_time() and p.prepared_xid=pg_current_xact_id() then
  raise exception 'Preparation must commit before a later signing transaction' using errcode='23514';
 end if;
end
-- END FUNCTION
-- BEGIN FUNCTION snapshot|jsonb|sql
with ns as (select oid,nspowner,nspacl from pg_namespace where nspname='controlled_review'),
functions as (
 select p.* from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='controlled_review' or (n.nspname='public' and p.proname=any(array[
 'prepare_controlled_secondary_review','read_controlled_secondary_review','execute_controlled_secondary_review',
 'cancel_controlled_secondary_review','read_controlled_secondary_review_event','list_controlled_secondary_reviews']))
), relations as (select c.* from pg_class c,ns where c.relnamespace=ns.oid),
acl as (
 select 'schema'::text as kind,'controlled_review'::text as name,x.* from ns cross join lateral aclexplode(coalesce(ns.nspacl,acldefault('n',ns.nspowner)))x
 union all select 'function',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',x.*
 from functions p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))x
 union all select 'table',c.relname,x.* from relations c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))x where c.relkind='r'
), acl_json as (
 select kind,name,jsonb_agg(jsonb_build_object('grantee',case when grantee=0 then 'PUBLIC' else pg_get_userbyid(grantee) end,
 'grantor',pg_get_userbyid(grantor),'privilege',privilege_type,'grantable',is_grantable)
 order by (case when grantee=0 then 'PUBLIC' else pg_get_userbyid(grantee) end)collate "C",pg_get_userbyid(grantor)collate "C",privilege_type collate "C") as value from acl group by kind,name
)
select jsonb_build_object('kind','controlled-review-gate-a-v1',
 'schema',(select jsonb_build_object('owner',pg_get_userbyid(nspowner),'acl',(select value from acl_json where kind='schema'))from ns),
 'functions',coalesce((select jsonb_object_agg(n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
 jsonb_build_object('source',p.prosrc,'owner',pg_get_userbyid(p.proowner),'language',l.lanname,'return_type',format_type(p.prorettype,null),
 'kind',p.prokind,'security_definer',p.prosecdef,'strict',p.proisstrict,'leakproof',p.proleakproof,'volatility',p.provolatile,
 'parallel',p.proparallel,'returns_set',p.proretset,'cost',p.procost,'rows',p.prorows,'configuration',to_jsonb(p.proconfig),
 'argument_names',to_jsonb(p.proargnames),'all_argument_types',to_jsonb(p.proallargtypes),'argument_modes',to_jsonb(p.proargmodes),
 'default_count',p.pronargdefaults,'defaults',pg_get_expr(p.proargdefaults,0),'variadic',p.provariadic::regtype::text,'support',p.prosupport::text,
 'sql_body',p.prosqlbody::text,'acl',(select value from acl_json a where a.kind='function' and a.name=n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')')))
 from functions p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang),'{}'::jsonb),
 'relations',coalesce((select jsonb_object_agg(c.relname,jsonb_build_object('kind',c.relkind,'owner',pg_get_userbyid(c.relowner),
 'persistence',c.relpersistence,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'replica_identity',c.relreplident,'options',to_jsonb(c.reloptions),
 'acl',(select value from acl_json a where a.kind='table' and a.name=c.relname),
 'columns',(select coalesce(jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,
 'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid),'collation',a.attcollation::regcollation::text,
 'column_acl',(select coalesce(jsonb_agg(jsonb_build_object('grantee',case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee)end,
 'grantor',pg_get_userbyid(x.grantor),'privilege',x.privilege_type,'grantable',x.is_grantable)order by x.grantee::regrole::text,x.grantor::regrole::text,x.privilege_type),'[]'::jsonb)from aclexplode(a.attacl)x))order by a.attnum),'[]'::jsonb)
 from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
 'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',k.conname,'definition',pg_get_constraintdef(k.oid,true),'validated',k.convalidated)order by k.conname),'[]'::jsonb)from pg_constraint k where k.conrelid=c.oid),
 'indexes',(select coalesce(jsonb_agg(jsonb_build_object('definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive,'primary',i.indisprimary,'unique',i.indisunique,'exclusion',i.indisexclusion,'immediate',i.indimmediate)order by i.indexrelid::regclass::text),'[]'::jsonb)from pg_index i where i.indrelid=c.oid),
 'triggers',(select coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid,true))order by t.tgname),'[]'::jsonb)from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
 'policies',(select coalesce(jsonb_agg(to_jsonb(p)-'oid'-'polrelid' order by p.polname),'[]'::jsonb)from pg_policy p where p.polrelid=c.oid),
 'rules',(select coalesce(jsonb_agg(pg_get_ruledef(r.oid,true)order by r.rulename),'[]'::jsonb)from pg_rewrite r where r.ev_class=c.oid)))from relations c where c.relkind='r'),'{}'::jsonb),
 'relation_inventory',coalesce((select jsonb_agg(jsonb_build_object('name',relname,'kind',relkind)order by relname)from relations),'[]'::jsonb),
 'types',coalesce((select jsonb_agg(jsonb_build_object('name',t.typname,'kind',t.typtype,'owner',pg_get_userbyid(t.typowner),
 'relation',case when t.typrelid=0 then null else c.relname end,'element',case when t.typelem=0 then null else e.typname end,
 'acl',t.typacl::text)order by t.typname)from pg_type t join ns on ns.oid=t.typnamespace left join pg_class c on c.oid=t.typrelid left join pg_type e on e.oid=t.typelem),'[]'::jsonb),
 'facade_objects',coalesce((select jsonb_agg(identity order by identity)from (
 select 'relation:'||relname as identity from pg_class where relnamespace='public'::regnamespace and relname=any(array[
 'prepare_controlled_secondary_review','read_controlled_secondary_review','execute_controlled_secondary_review',
 'cancel_controlled_secondary_review','read_controlled_secondary_review_event','list_controlled_secondary_reviews'])
 union all select 'type:'||typname from pg_type where typnamespace='public'::regnamespace and typname=any(array[
 'prepare_controlled_secondary_review','read_controlled_secondary_review','execute_controlled_secondary_review',
 'cancel_controlled_secondary_review','read_controlled_secondary_review_event','list_controlled_secondary_reviews'])
 )q),'[]'::jsonb),
 'foreign_key_triggers',coalesce((select jsonb_agg(jsonb_build_object(
 'constraint',k.conname,'relation',tn.nspname||'.'||tc.relname,'function',fn.nspname||'.'||f.proname,
 'constraint_relation',rn.nspname||'.'||rc.relname,'type',t.tgtype,'enabled',t.tgenabled,'internal',t.tgisinternal,
 'deferrable',t.tgdeferrable,'initially_deferred',t.tginitdeferred,'argument_count',t.tgnargs,'arguments',encode(t.tgargs,'hex'),
 'columns',t.tgattr::text,'condition',pg_get_expr(t.tgqual,t.tgrelid),'old_table',t.tgoldtable,'new_table',t.tgnewtable)
 order by k.conname,tn.nspname,tc.relname,fn.nspname,f.proname)
 from pg_constraint k join ns on ns.oid=k.connamespace join pg_trigger t on t.tgconstraint=k.oid
 join pg_class tc on tc.oid=t.tgrelid join pg_namespace tn on tn.oid=tc.relnamespace
 join pg_class rc on rc.oid=t.tgconstrrelid join pg_namespace rn on rn.oid=rc.relnamespace
 join pg_proc f on f.oid=t.tgfoid join pg_namespace fn on fn.oid=f.pronamespace where k.contype='f'),'[]'::jsonb),
 'other_objects',coalesce((select jsonb_agg(identity order by identity)from (
 select pg_describe_object(d.classid,d.objid,d.objsubid) as identity from pg_depend d,ns
 where d.refclassid='pg_namespace'::regclass and d.refobjid=ns.oid
 and d.classid not in('pg_class'::regclass,'pg_type'::regclass,'pg_proc'::regclass,'pg_constraint'::regclass)
 )q),'[]'::jsonb))
-- END FUNCTION
