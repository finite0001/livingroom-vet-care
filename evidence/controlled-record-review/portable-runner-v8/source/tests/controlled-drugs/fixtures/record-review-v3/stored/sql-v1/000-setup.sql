do $cr_fixture$
declare refused boolean; actual_code text; actual_message text; returned jsonb; case_input jsonb; expected_value jsonb; expected_text text; item record;
begin

 if current_user<>'postgres' or session_user<>'postgres' or current_setting('role')<>'none'
 or current_setting('session_replication_role')<>'origin' or current_setting('transaction_isolation')<>'read committed'
 or auth.uid() is not null or auth.role() is not null or auth.email() is not null
 or exists(select 1 from unnest(array['request.jwt.claims','request.jwt.claim.sub','request.jwt.claim.role','request.jwt.claim.email'])g(k)where coalesce(current_setting(k,true),'')<>'') then
 raise exception 'record_fixture_direct_postgres_origin_required';end if;

end
$cr_fixture$;
-- Fixed diagnostic SQL only. Requires ON_ERROR_STOP and separately admitted source metadata.
create temp table cr_render(id text primary key,raw_text text not null,expected_text text not null,preimage_hash text check(preimage_hash ~ '^[0-9a-f]{64}$'));
create temp table cr_render_proof(id text primary key);
create temp table cr_cases(id text primary key,ordinal integer not null unique check(ordinal between 0 and 1593),function_name text not null check(function_name in('validate_stored_configuration','validate_configuration_record','configuration_record','validate_configuration_pair')),argument_kind text not null check(argument_kind in('sql_null','jsonb')),argument_text text,argument_value jsonb,expected_text text,expected_value jsonb,outcome text not null,
 check((argument_kind='sql_null'and argument_text is null and argument_value is null)or(argument_kind='jsonb'and argument_text is not null and argument_value is not null)),
 check((outcome='literal_success'and expected_text is not null and expected_value is not null)or(outcome<>'literal_success'and expected_text is null and expected_value is null)));
create temp table cr_proof(id text primary key,outcome text not null);
create temp table cr_baseline(permanent_value jsonb not null,session_value jsonb not null,metadata_value jsonb not null,temp_value jsonb not null);
create temp table cr_context(value jsonb not null);
create temp table cr_guard_immutable_guard(id integer not null);
create trigger cr_internal_guard before insert on pg_temp.cr_guard_immutable_guard for each row execute function controlled_review_v3.immutable_guard();
create temp table cr_guard_refuse_insert(id integer not null);
create trigger cr_internal_guard before insert on pg_temp.cr_guard_refuse_insert for each row execute function controlled_review_v3.refuse_insert();
create temp table cr_guard_terminal_check(id integer not null);
create constraint trigger cr_internal_guard after insert on pg_temp.cr_guard_terminal_check deferrable initially immediate for each row execute function controlled_review_v3.terminal_check();

create function pg_temp.v3_gate_catalog()returns jsonb language sql stable as $catalog$
select jsonb_build_object(
 'schemas',(select coalesce(jsonb_object_agg(n.nspname,to_jsonb(n)),'{}')from pg_namespace n where n.nspname in('public','auth','storage','extensions','supabase_migrations','controlled_review','controlled_review_cli_fixture','controlled_review_v3')),
 'functions',(select coalesce(jsonb_object_agg(n.nspname||'.'||p.oid::regprocedure::text,jsonb_build_object('attributes',to_jsonb(p),'definition',pg_get_functiondef(p.oid))),'{}')from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','auth','storage','extensions','supabase_migrations','controlled_review','controlled_review_cli_fixture','controlled_review_v3')and p.prokind in('f','p','w')),
 'relations',(select coalesce(jsonb_object_agg(n.nspname||'.'||c.relname,jsonb_build_object(
  'attributes',jsonb_build_object('kind',c.relkind,'owner',c.relowner,'access_method',c.relam,'tablespace',c.reltablespace,'persistence',c.relpersistence,'row_security',c.relrowsecurity,'force_row_security',c.relforcerowsecurity,'replica_identity',c.relreplident,'partition',c.relispartition,'options',to_jsonb(c.reloptions),'acl',to_jsonb(c.relacl),'partition_bound',pg_get_expr(c.relpartbound,c.oid)),'view',case when c.relkind in('v','m')then pg_get_viewdef(c.oid,true)else null end,
  'columns',(select coalesce(jsonb_agg(jsonb_build_object('attributes',to_jsonb(a),'default',pg_get_expr(d.adbin,d.adrelid))order by a.attnum),'[]')from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
  'constraints',(select coalesce(jsonb_agg(jsonb_build_object('attributes',to_jsonb(k),'definition',pg_get_constraintdef(k.oid,true))order by k.conname),'[]')from pg_constraint k where k.conrelid=c.oid),
  'triggers',(select coalesce(jsonb_agg(jsonb_build_object('attributes',to_jsonb(t),'definition',pg_get_triggerdef(t.oid,true))order by t.tgname),'[]')from pg_trigger t where t.tgrelid=c.oid),
  'policies',(select coalesce(jsonb_agg(to_jsonb(p)order by p.polname),'[]')from pg_policy p where p.polrelid=c.oid),
  'indexes',(select coalesce(jsonb_agg(jsonb_build_object('attributes',to_jsonb(i),'definition',pg_get_indexdef(i.indexrelid))order by i.indexrelid),'[]')from pg_index i where i.indrelid=c.oid))),'{}')from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','auth','storage','extensions','supabase_migrations','controlled_review','controlled_review_cli_fixture','controlled_review_v3')));
$catalog$;

create function pg_temp.v3_gate_rows()returns jsonb language plpgsql as $rows$
declare r record;v jsonb;answer jsonb:='{}';begin
 for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in ('public','auth','storage','extensions','supabase_migrations','controlled_review','controlled_review_cli_fixture','controlled_review_v3') and c.relkind in('r','p')order by 1,2 loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t)order by to_jsonb(t)::text),''[]'')from %I.%I t',r.nspname,r.relname)into v;
  answer:=answer||jsonb_build_object(r.nspname||'.'||r.relname,v);
 end loop;return answer;end$rows$;

create function pg_temp.cr_identity()returns void language plpgsql as $identity$ begin

 if current_user<>'postgres' or session_user<>'postgres' or current_setting('role')<>'none'
 or current_setting('session_replication_role')<>'origin' or current_setting('transaction_isolation')<>'read committed'
 or auth.uid() is not null or auth.role() is not null or auth.email() is not null
 or exists(select 1 from unnest(array['request.jwt.claims','request.jwt.claim.sub','request.jwt.claim.role','request.jwt.claim.email'])g(k)where coalesce(current_setting(k,true),'')<>'') then
 raise exception 'record_fixture_direct_postgres_origin_required';end if;
end $identity$;
create function pg_temp.cr_session()returns jsonb language sql as $session$ select jsonb_build_object('settings',(select jsonb_object_agg(k,current_setting(k,true))from unnest(array['TimeZone','search_path','session_replication_role','transaction_isolation','role','request.jwt.claims','request.jwt.claim.sub','request.jwt.claim.role','request.jwt.claim.email'])as keys(k)),'current_user',current_user,'session_user',session_user,'auth_uid',auth.uid(),'auth_role',auth.role(),'auth_email',auth.email(),'advisory',(select coalesce(jsonb_agg(to_jsonb(l)-'pid' order by l.classid,l.objid,l.objsubid,l.mode),'[]')from pg_locks l where l.pid=pg_backend_pid()and l.locktype='advisory')) $session$;
create function pg_temp.cr_temp_structure()returns jsonb language sql as $temp_structure$
select jsonb_build_object(
 'relations',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'kind',c.relkind,'owner',c.relowner,'acl',c.relacl,
  'columns',(select jsonb_agg(to_jsonb(a)order by a.attnum)from pg_attribute a where a.attrelid=c.oid and a.attnum>0),
  'constraints',(select coalesce(jsonb_agg(to_jsonb(k)order by k.conname),'[]')from pg_constraint k where k.conrelid=c.oid),
  'triggers',(select coalesce(jsonb_agg(to_jsonb(t)order by t.tgname),'[]')from pg_trigger t where t.tgrelid=c.oid),
  'index',case when c.relkind='i'then pg_get_indexdef(c.oid)else null end)order by c.relname),'[]')from pg_class c where c.relnamespace=pg_my_temp_schema()),
 'functions',(select coalesce(jsonb_agg(to_jsonb(p)order by p.proname,p.oid),'[]')from pg_proc p where p.pronamespace=pg_my_temp_schema()),
 'types',(select coalesce(jsonb_agg(to_jsonb(t)order by t.typname),'[]')from pg_type t where t.typnamespace=pg_my_temp_schema()));
$temp_structure$;
create function pg_temp.cr_conserved()returns void language plpgsql as $conserved$
begin
 perform pg_temp.cr_identity();
 perform controlled_review_v3.required();
 if (select count(*)from pg_temp.cr_baseline)<>1 or not exists(select 1 from pg_temp.cr_baseline b where b.permanent_value=(jsonb_build_object('catalog',pg_temp.v3_gate_catalog(),'rows',pg_temp.v3_gate_rows(),
 'types',(select coalesce(jsonb_object_agg(n.nspname||'.'||t.typname,jsonb_build_object('attributes',to_jsonb(t),
  'enum',(select coalesce(jsonb_agg(to_jsonb(e)order by e.enumsortorder),'[]')from pg_enum e where e.enumtypid=t.oid),
  'constraints',(select coalesce(jsonb_agg(to_jsonb(c)order by c.conname),'[]')from pg_constraint c where c.contypid=t.oid))),'{}')from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname in ('public','auth','storage','extensions','supabase_migrations','controlled_review','controlled_review_cli_fixture','controlled_review_v3')),
 'ledger',(select jsonb_agg(to_jsonb(m)order by version)from supabase_migrations.schema_migrations m),
 'parent',public.controlled_stock_manifest_snapshot(),
 'parent_literal',(select jsonb_agg(to_jsonb(m))from public.controlled_stock_engine_manifests m),
 'parent_literal_hash_valid',(select count(*)=1 and bool_and(revision=1 and definition_hash=public.controlled_stock_hash(definition))from public.controlled_stock_engine_manifests),
 'private206',controlled_review.snapshot(),'private206_literal',(select jsonb_agg(to_jsonb(d))from controlled_review.descriptor d),'writers',(select jsonb_object_agg(signature,encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(signature)),'UTF8')),'hex'))from public.stock_writer_manifests)))and b.session_value=pg_temp.cr_session()and b.metadata_value=controlled_review_v3.snapshot()and b.temp_value=pg_temp.cr_temp_structure())then raise exception 'record_fixture_permanent_session_or_metadata_changed';end if;
 if exists(select 1 from pg_temp.cr_context) or exists(select 1 from pg_temp.cr_guard_immutable_guard) or exists(select 1 from pg_temp.cr_guard_refuse_insert) or exists(select 1 from pg_temp.cr_guard_terminal_check) then raise exception 'record_fixture_temp_control_rows_remain';end if;
end $conserved$;
select pg_temp.cr_identity();
