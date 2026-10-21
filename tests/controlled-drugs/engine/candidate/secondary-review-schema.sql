-- Candidate-only synthetic retrospective review foundation. Not a migration.
-- Exact reviewed bodies consumed by secondary_review_protocol_descriptor.py.
-- BEGIN FUNCTION immutable_guard|trigger|plpgsql
begin
 raise exception 'Secondary-review evidence is immutable' using errcode='23514';
end
-- END FUNCTION
-- BEGIN FUNCTION target|jsonb|sql|p_event_id uuid
 select jsonb_build_object('event_id',e.id,'product_id',e.product_id,'sequence',e.sequence,
 'record_hash',e.record_hash,'original_actor_id',e.actor_id,'policy_version_id',e.policy_version_id,
 'opening_id',e.opening_id,'engine_revision',e.engine_revision)
 from public.controlled_stock_events e where e.id=p_event_id
-- END FUNCTION
-- BEGIN FUNCTION site|uuid|plpgsql|p_event_id uuid
declare target public.controlled_stock_events; total bigint; matched bigint;
 sites uuid[]; wrong_product boolean;
begin
 select * into strict target from public.controlled_stock_events where id=p_event_id;
 if target.event_kind not in('receive_inventory','adjust_inventory','record_native_dispense_return_v2:retract_disposal') then
  raise exception 'Unsupported secondary-review historical event kind' using errcode='23514';
 end if;
 select count(*),count(c.id),array_agg(distinct c.controlling_site_id),
  coalesce(bool_or(c.product_id is distinct from target.product_id),false)
 into total,matched,sites,wrong_product
 from public.controlled_stock_container_transitions t
 left join public.controlled_stock_containers c on c.id=t.container_id
 where t.event_id=target.id;
 if total=0 or matched<>total or wrong_product or cardinality(sites)<>1 or sites[1] is null then
  raise exception 'Exactly one retained controlling site is required' using errcode='23514';
 end if;
 return sites[1];
end
-- END FUNCTION
-- BEGIN FUNCTION packet|jsonb|plpgsql|p_context jsonb
declare e public.controlled_stock_events; d controlled_review.definitions; result jsonb;
begin
 perform public.controlled_stock_keys(p_context,array['event_id','definition_id']);
 select * into strict e from public.controlled_stock_events where id=public.controlled_stock_uuid(p_context->'event_id');
 select * into strict d from controlled_review.definitions where id=public.controlled_stock_uuid(p_context->'definition_id');
 result:=jsonb_build_object('version',1,'event',to_jsonb(e),'target',controlled_review.target(e.id),
  'controlling_site_id',controlled_review.site(e.id),'definition',to_jsonb(d),
  'transitions',(select coalesce(jsonb_agg(to_jsonb(t)order by t.container_id,t.id),'[]'::jsonb)
    from public.controlled_stock_container_transitions t where t.event_id=e.id),
  'containers',(select coalesce(jsonb_agg(to_jsonb(c)order by c.id),'[]'::jsonb)
    from public.controlled_stock_containers c where exists(select 1 from public.controlled_stock_container_transitions t where t.event_id=e.id and t.container_id=c.id)));
 if octet_length(result::text)>1048576 then
  raise exception 'Secondary-review evidence packet exceeds one MiB' using errcode='23514';
 end if;
 return result;
end
-- END FUNCTION
-- BEGIN FUNCTION receipt|jsonb|plpgsql|p_context jsonb
declare p jsonb:=p_context->'preparation'; d jsonb:=p_context->'decision'; v integer;
begin
 perform public.controlled_stock_keys(p_context,array['preparation','decision']);
 select version into strict v from controlled_review.definitions where id=(p->>'definition_id')::uuid;
 return jsonb_build_object('version',1,'operation_id',d->'operation_id','event_id',d->'event_id',
  'target',p->'target','target_hash',d->'target_hash','request_hash',d->'request_hash','packet_hash',d->'packet_hash',
  'actor_id',d->'actor_id','session_id',d->'session_id','actor_name',d->'actor_name',
  'definition_id',d->'definition_id','definition_version',v,'decision',d->'decision','reason',d->'reason',
  'meaning',d->'meaning_text','meaning_version',d->'meaning_version','recorded_at',d->'recorded_at',
  'due_at',null,'deadline_state','not_configured');
end
-- END FUNCTION
-- BEGIN FUNCTION required|void|plpgsql
declare d jsonb;
begin
 if (select count(*) from controlled_review.descriptor)<>1 then
  raise exception 'Exactly one independent secondary-review descriptor required' using errcode='23514';
 end if;
 select definition into strict d from controlled_review.descriptor;
 if (select count(*) from public.controlled_stock_engine_manifests)<>1 or not exists(
  select 1 from public.controlled_stock_engine_manifests m where m.revision=1
   and m.definition=d#>'{parent,manifest}' and m.definition_hash=public.controlled_stock_hash(m.definition)) then
  raise exception 'Unchanged frozen-205 parent revision and independent literal required' using errcode='23514';
 end if;
 if d is distinct from controlled_review.snapshot() then
  raise exception 'Secondary-review metadata differs from independent descriptor' using errcode='23514';
 end if;
end
-- END FUNCTION
-- BEGIN FUNCTION require_prior_commit|void|plpgsql|p_operation_id uuid
declare p controlled_review.preparations;
begin
 select * into strict p from controlled_review.preparations where operation_id=p_operation_id;
 if p.prepared_boot=pg_postmaster_start_time() and p.prepared_xid=pg_current_xact_id() then
  raise exception 'Preparation must commit before a later signing transaction' using errcode='23514';
 end if;
end
-- END FUNCTION
-- BEGIN FUNCTION definition_guard|trigger|plpgsql
declare prior_version integer;
begin
 perform pg_advisory_xact_lock_shared(90271040,0);
 perform pg_advisory_xact_lock(hashtextextended('controlled-review-definition:'||jsonb_build_array(new.product_id,new.site_id,new.event_kind,new.capability)::text,0));
 perform controlled_review.required();
 if new.id='00000000-0000-0000-0000-000000000000'::uuid or new.capability not in('review','read')
  or new.event_kind not in('receive_inventory','adjust_inventory','record_native_dispense_return_v2:retract_disposal')
  or array_ndims(new.roles) is distinct from 1 or array_lower(new.roles,1) is distinct from 1
  or cardinality(new.roles)not between 1 and 20 or exists(select 1 from unnest(new.roles)r where r is null or r!~'^[A-Z][A-Z_]{0,39}$')
  or (select count(distinct r)from unnest(new.roles)r)<>cardinality(new.roles) then
  raise exception 'Exact bounded synthetic secondary-review definition required' using errcode='23514';
 end if;
 select coalesce(max(version),0)into prior_version from controlled_review.definitions
  where product_id=new.product_id and site_id=new.site_id and event_kind=new.event_kind and capability=new.capability;
 if new.version is distinct from prior_version+1 then
  raise exception 'Next immutable exact-scope review definition version required' using errcode='23514';
 end if;
 return new;
end
-- END FUNCTION
-- BEGIN FUNCTION binding_guard|trigger|plpgsql
declare p controlled_review.preparations; e public.controlled_stock_events; d controlled_review.definitions;
 event_id uuid; current_version integer; expected_request jsonb; stamp timestamptz;
begin
 perform public.controlled_stock_actor(new.actor_id);
 perform pg_advisory_xact_lock_shared(90271040,0);
 perform public.controlled_stock_actor(new.actor_id);
 perform pg_advisory_xact_lock(hashtextextended('controlled-review-operation:'||new.operation_id::text,0));
 perform public.controlled_stock_actor(new.actor_id);
 if tg_table_name='preparations' then event_id:=new.event_id;
 else
  select * into strict p from controlled_review.preparations where operation_id=new.operation_id;
  event_id:=p.event_id;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('controlled-review-event:'||event_id::text,0));
 perform public.controlled_stock_actor(new.actor_id);
 if new.session_id is distinct from public.next_visit_review_session() then
  raise exception 'Exact current reviewer session required' using errcode='42501';
 end if;
 perform controlled_review.required();
 if new.operation_id='00000000-0000-0000-0000-000000000000'::uuid then
  raise exception 'Nonzero review operation UUID required' using errcode='23514';
 end if;
 if tg_table_name='cancellations' then
  if p.actor_id<>new.actor_id or exists(select 1 from controlled_review.decisions where operation_id=new.operation_id) then
   raise exception 'Cancellation must bind its own unsaved review preparation' using errcode='23514';
  end if;
  new.recorded_at:=clock_timestamp();
  perform public.controlled_stock_actor(new.actor_id);
  if new.session_id is distinct from public.next_visit_review_session() then
   raise exception 'Exact current reviewer session required before cancellation' using errcode='42501';
  end if;
  return new;
 end if;
 select * into strict e from public.controlled_stock_events where id=event_id;
 select * into strict d from controlled_review.definitions where id=new.definition_id;
 select max(version)into current_version from controlled_review.definitions
  where product_id=d.product_id and site_id=d.site_id and event_kind=d.event_kind and capability=d.capability;
 if not e.secondary_review_required or e.actor_id=new.actor_id or d.capability<>'review' or not d.enabled
  or d.product_id<>e.product_id or d.site_id<>controlled_review.site(e.id) or d.event_kind<>e.event_kind
  or d.version is distinct from current_version or not exists(select 1 from public.user_roles r where r.user_id=new.actor_id and r.role::text=any(d.roles)) then
  raise exception 'Current independent exact-scope reviewer entitlement required' using errcode='42501';
 end if;
 perform public.controlled_stock_validate_event(e.id);
 perform public.controlled_stock_text(to_jsonb(new.reason),4000,true);
 if new.decision not in('approve','reject') or char_length(new.reason)not between 1 and 4000
  or new.meaning_version is distinct from 1
  or new.meaning_text is distinct from 'Independent record review; no claim of personal physical observation.' then
  raise exception 'Bounded final review decision and explicit independent meaning required' using errcode='23514';
 end if;
 expected_request:=jsonb_build_object('actor_id',new.actor_id,'operation_id',new.operation_id,'event_id',event_id,
  'definition_id',new.definition_id,'decision',new.decision,'reason',new.reason);
 if tg_table_name='preparations' then
  if new.canonical_request is distinct from expected_request or octet_length(new.canonical_request::text)>131072
   or new.request_hash is distinct from public.controlled_stock_hash(expected_request)
   or new.target is distinct from controlled_review.target(e.id)
   or new.target_hash is distinct from public.controlled_stock_hash(new.target)
   or new.packet is distinct from controlled_review.packet(jsonb_build_object('event_id',e.id,'definition_id',d.id))
   or new.packet_hash is distinct from public.controlled_stock_hash(new.packet) then
   raise exception 'Exact authoritative review request, target and packet binding required' using errcode='23514';
  end if;
  stamp:=clock_timestamp();new.prepared_boot:=pg_postmaster_start_time();new.prepared_xid:=pg_current_xact_id();
  new.created_at:=stamp;new.expires_at:=stamp+interval '15 minutes';
 else
  perform controlled_review.require_prior_commit(p.operation_id);
  if p.expires_at<=clock_timestamp() then
   raise exception 'Secondary-review preparation expired before persistence' using errcode='PT409';
  end if;
  if exists(select 1 from controlled_review.cancellations where operation_id=p.operation_id)
   or new.actor_id<>p.actor_id or new.event_id<>p.event_id or new.definition_id<>p.definition_id
   or new.target_hash<>p.target_hash or new.request_hash<>p.request_hash or new.packet_hash<>p.packet_hash
   or new.decision<>p.decision or new.reason<>p.reason or new.meaning_text<>p.meaning_text or new.meaning_version<>p.meaning_version
   or p.canonical_request is distinct from expected_request
   or p.target is distinct from controlled_review.target(e.id)
   or p.packet is distinct from controlled_review.packet(jsonb_build_object('event_id',e.id,'definition_id',d.id)) then
   raise exception 'Final decision must bind one original uncancelled immutable preparation' using errcode='23514';
  end if;
  select full_name into strict new.actor_name from public.profiles where id=new.actor_id;
  if new.actor_name is null or char_length(new.actor_name)not between 1 and 200 then
   raise exception 'Bounded recorded reviewer name required' using errcode='23514';
  end if;
  new.recorded_at:=clock_timestamp();
  new.receipt:=controlled_review.receipt(jsonb_build_object('preparation',to_jsonb(p),'decision',to_jsonb(new)));
 end if;
 select max(version)into current_version from controlled_review.definitions
  where product_id=d.product_id and site_id=d.site_id and event_kind=d.event_kind and capability=d.capability;
 if d.version is distinct from current_version or not exists(select 1 from public.user_roles r where r.user_id=new.actor_id and r.role::text=any(d.roles)) then
  raise exception 'Current review entitlement changed before persistence' using errcode='42501';
 end if;
 if tg_table_name='decisions' and p.expires_at<=clock_timestamp() then
  raise exception 'Secondary-review preparation expired before persistence' using errcode='PT409';
 end if;
 perform public.controlled_stock_actor(new.actor_id);
 if new.session_id is distinct from public.next_visit_review_session() then
  raise exception 'Exact current reviewer session required before persistence' using errcode='42501';
 end if;
 return new;
end
-- END FUNCTION
-- BEGIN FUNCTION validate_operation|void|plpgsql|p_operation_id uuid
declare p controlled_review.preparations; d controlled_review.decisions; c controlled_review.cancellations;
 f controlled_review.definitions; e public.controlled_stock_events; expected_request jsonb;
begin
 select * into strict p from controlled_review.preparations where operation_id=p_operation_id;
 select * into strict f from controlled_review.definitions where id=p.definition_id;
 select * into strict e from public.controlled_stock_events where id=p.event_id;
 perform public.controlled_stock_validate_event(e.id);
 expected_request:=jsonb_build_object('actor_id',p.actor_id,'operation_id',p.operation_id,'event_id',p.event_id,
  'definition_id',p.definition_id,'decision',p.decision,'reason',p.reason);
 perform public.controlled_stock_text(to_jsonb(p.reason),4000,true);
 if not e.secondary_review_required or e.actor_id=p.actor_id or f.capability<>'review' or not f.enabled
  or f.product_id<>e.product_id or f.site_id<>controlled_review.site(e.id) or f.event_kind<>e.event_kind
  or not exists(select 1 from public.profiles where id=p.actor_id)
  or p.operation_id='00000000-0000-0000-0000-000000000000'::uuid
  or p.session_id='00000000-0000-0000-0000-000000000000'::uuid
  or p.decision not in('approve','reject') or char_length(p.reason)not between 1 and 4000
  or p.meaning_version<>1 or p.meaning_text<>'Independent record review; no claim of personal physical observation.'
  or p.canonical_request is distinct from expected_request or octet_length(p.canonical_request::text)>131072
  or p.request_hash is distinct from public.controlled_stock_hash(expected_request)
  or p.target is distinct from controlled_review.target(e.id) or p.target_hash is distinct from public.controlled_stock_hash(p.target)
  or p.packet is distinct from controlled_review.packet(jsonb_build_object('event_id',e.id,'definition_id',f.id))
  or p.packet_hash is distinct from public.controlled_stock_hash(p.packet)
  or not isfinite(p.prepared_boot) or not isfinite(p.created_at) or not isfinite(p.expires_at)
  or p.expires_at<>p.created_at+interval '15 minutes' then
  raise exception 'Historical preparation binding is invalid' using errcode='23514';
 end if;
 select * into d from controlled_review.decisions where operation_id=p.operation_id;
 select * into c from controlled_review.cancellations where operation_id=p.operation_id;
 if d.operation_id is not null and c.operation_id is not null then
  raise exception 'Review operation cannot have both decision and cancellation' using errcode='23514';
 end if;
 if c.operation_id is not null and(c.actor_id<>p.actor_id or not isfinite(c.recorded_at)or c.recorded_at<p.created_at
  or c.session_id='00000000-0000-0000-0000-000000000000'::uuid) then
  raise exception 'Historical cancellation binding is invalid' using errcode='23514';
 end if;
 if d.operation_id is not null and(d.event_id<>p.event_id or d.actor_id<>p.actor_id or d.definition_id<>p.definition_id
  or d.target_hash<>p.target_hash or d.request_hash<>p.request_hash or d.packet_hash<>p.packet_hash
  or d.decision<>p.decision or d.reason<>p.reason or d.meaning_text<>p.meaning_text or d.meaning_version<>p.meaning_version
  or d.session_id='00000000-0000-0000-0000-000000000000'::uuid or char_length(d.actor_name)not between 1 and 200
  or not isfinite(d.recorded_at)or d.recorded_at<p.created_at or d.recorded_at>=p.expires_at
  or d.receipt is distinct from controlled_review.receipt(jsonb_build_object('preparation',to_jsonb(p),'decision',to_jsonb(d)))) then
  raise exception 'Historical final decision and exact receipt binding is invalid' using errcode='23514';
 end if;
end
-- END FUNCTION
-- BEGIN FUNCTION terminal_check|trigger|plpgsql
begin
 perform controlled_review.validate_operation(new.operation_id);
 return null;
end
-- END FUNCTION
-- BEGIN FUNCTION validate_history|void|plpgsql
declare operation_row record; definition_row controlled_review.definitions;
begin
 perform controlled_review.required();
 for definition_row in select * from controlled_review.definitions loop
  if definition_row.id='00000000-0000-0000-0000-000000000000'::uuid or definition_row.version<=0
   or definition_row.capability not in('review','read') or definition_row.event_kind not in('receive_inventory','adjust_inventory','record_native_dispense_return_v2:retract_disposal')
   or array_ndims(definition_row.roles) is distinct from 1 or array_lower(definition_row.roles,1) is distinct from 1 or cardinality(definition_row.roles)not between 1 and 20
   or exists(select 1 from unnest(definition_row.roles)r where r is null or r!~'^[A-Z][A-Z_]{0,39}$')
   or (select count(distinct r)from unnest(definition_row.roles)r)<>cardinality(definition_row.roles)
   or not exists(select 1 from public.catalog_products where id=definition_row.product_id)
   or not exists(select 1 from public.controlled_stock_sites where id=definition_row.site_id) then
   raise exception 'Historical synthetic review definition is invalid' using errcode='23514';
  end if;
 end loop;
 if exists(select 1 from controlled_review.definitions group by product_id,site_id,event_kind,capability
  having min(version)<>1 or max(version)<>count(*) or count(distinct version)<>count(*)) then
  raise exception 'Historical definition stream versions are incomplete' using errcode='23514';
 end if;
 if exists(select 1 from controlled_review.decisions d left join controlled_review.preparations p using(operation_id) where p.operation_id is null)
  or exists(select 1 from controlled_review.cancellations c left join controlled_review.preparations p using(operation_id) where p.operation_id is null)
  or exists(select event_id from controlled_review.decisions group by event_id having count(*)<>1) then
  raise exception 'Orphan or duplicate historical review terminal' using errcode='23514';
 end if;
 for operation_row in select operation_id from controlled_review.preparations order by operation_id loop
  perform controlled_review.validate_operation(operation_row.operation_id);
 end loop;
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
select jsonb_build_object('kind','controlled-review-foundation-v1',
 'parent',jsonb_build_object('revision',1,'manifest',public.controlled_stock_manifest_snapshot()),
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
