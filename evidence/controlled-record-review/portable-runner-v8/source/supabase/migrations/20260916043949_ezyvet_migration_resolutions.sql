-- Operational exceptions only. No clinical approval, continuation or cutover authority.
create table public.ezyvet_migration_resolutions (
 id uuid primary key, actor_id uuid not null references public.profiles(id),
 migration_run_id uuid not null references public.ezyvet_migration_runs(id), scope_id uuid not null references public.ezyvet_migration_scopes(id),
 target_kind text not null check(target_kind in ('scope','observation')), target jsonb not null, target_key text not null check(target_key ~ '^[a-f0-9]{64}$'),
 action text not null check(action in ('exclude','reopen')), reason text not null check(reason=btrim(reason) and length(reason) between 1 and 2000),
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'), reviewed_context jsonb not null, reviewed_context_hash text not null check(reviewed_context_hash ~ '^[a-f0-9]{64}$'),
 replaces_id uuid unique references public.ezyvet_migration_resolutions(id), version integer not null check(version>0),
 record_hash text not null check(record_hash ~ '^[a-f0-9]{64}$'),created_at timestamptz not null default clock_timestamp(),
 unique(target_key,version),check((replaces_id is null)=(version=1)),check(action<>'reopen' or replaces_id is not null)
);
create unique index ezyvet_migration_resolution_root on public.ezyvet_migration_resolutions(target_key) where replaces_id is null;
create index ezyvet_migration_resolution_scope_history on public.ezyvet_migration_resolutions(scope_id,created_at desc,id desc);
create index ezyvet_migration_resolution_target_history on public.ezyvet_migration_resolutions(target_key,created_at desc,id desc);
alter table public.ezyvet_migration_resolutions enable row level security;
revoke all on public.ezyvet_migration_resolutions from public,anon,authenticated,service_role;
create trigger immutable_migration_resolution before update or delete on public.ezyvet_migration_resolutions for each row execute function public.guard_inquiry_history();

create function public.ezyvet_migration_resolution_target(p_target jsonb) returns jsonb language plpgsql immutable set search_path=public as $$
declare kind text;b uuid;s uuid;pg integer;o integer;h text;
begin
 if p_target is null or jsonb_typeof(p_target)<>'object' or not p_target ?& array['kind','binding_id','page','ordinal','snapshot_id','evidence_hash'] or (select count(*) from jsonb_object_keys(p_target))<>6 then raise exception 'Exact resolution target required' using errcode='23514';end if;
 kind:=p_target->>'kind';
 if kind='scope' then
  if p_target is distinct from jsonb_build_object('kind','scope','binding_id',null,'page',null,'ordinal',null,'snapshot_id',null,'evidence_hash',null) then raise exception 'Scope target cannot carry an observation' using errcode='23514';end if;
  return p_target;
 end if;
 if kind is distinct from 'observation' or jsonb_typeof(p_target->'binding_id')<>'string' or jsonb_typeof(p_target->'snapshot_id')<>'string' or jsonb_typeof(p_target->'evidence_hash')<>'string'
  or jsonb_typeof(p_target->'page')<>'number' or jsonb_typeof(p_target->'ordinal')<>'number' or (p_target->>'page') !~ '^[0-9]+$' or (p_target->>'ordinal') !~ '^[0-9]+$' then raise exception 'Invalid observation target' using errcode='23514';end if;
 b:=(p_target->>'binding_id')::uuid;s:=(p_target->>'snapshot_id')::uuid;pg:=(p_target->>'page')::integer;o:=(p_target->>'ordinal')::integer;h:=p_target->>'evidence_hash';
 if b is null or s is null or pg not between 1 and 1000 or o not between 0 and 10 or h !~ '^[a-f0-9]{64}$' then raise exception 'Invalid observation target' using errcode='23514';end if;
 return jsonb_build_object('kind',kind,'binding_id',b,'page',pg,'ordinal',o,'snapshot_id',s,'evidence_hash',h);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'Invalid resolution target value' using errcode='23514';
end $$;

-- STABLE helper: all mutable pins use the calling statement's snapshot. Not a commit-wide source lock.
create function public.ezyvet_migration_resolution_context(p_scope_id uuid,p_target jsonb) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare a uuid:=auth.uid();t jsonb;result jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_scope_id is null then raise exception 'Scope required' using errcode='23514';end if;
 t:=public.ezyvet_migration_resolution_target(p_target);
 with owned as materialized (
  select s.*,r.actor_id,r.source_origin,r.source_site_uid,r.intent_hash from public.ezyvet_migration_scopes s join public.ezyvet_migration_runs r on r.id=s.migration_run_id where s.id=p_scope_id and r.actor_id=a
 ), manifest as (
  select encode(sha256(convert_to(jsonb_build_object('version',1,'run_id',x.migration_run_id,'actor_id',x.actor_id,'source_origin',x.source_origin,'source_site_uid',x.source_site_uid,'intent_hash',x.intent_hash,
   'scopes',(select jsonb_agg(jsonb_build_object('id',s.id,'migration_run_id',s.migration_run_id,'mapping_id',s.mapping_id,'mapping_snapshot_id',s.mapping_snapshot_id,
    'mapping_head_version',s.mapping_head_version,'client_id',s.client_id,'pet_id',s.pet_id,'resource',s.resource,'parent_type',s.parent_type,'parent_snapshot_id',s.parent_snapshot_id,'parent_head_version',s.parent_head_version,
    'parent_external_id',s.parent_external_id,'parent_payload_hash',s.parent_payload_hash,'disposition',s.disposition,'reason',s.reason) order by s.id) from public.ezyvet_migration_scopes s where s.migration_run_id=x.migration_run_id))::text,'UTF8')),'hex') hash from owned x
 ), current_binding as materialized (
  select b.* from owned x join public.ezyvet_migration_bindings b on b.scope_id=x.id and b.actor_id=a where not exists(select 1 from public.ezyvet_migration_bindings n where n.replaces_id=b.id)
 ), selected_binding as materialized (
  select b.* from owned x join public.ezyvet_migration_bindings b on b.scope_id=x.id and b.actor_id=a join public.ezyvet_import_runs c on c.id=b.child_run_id and c.requested_by=a
  where (t->>'kind'='scope' and b.id=(select id from current_binding)) or (t->>'kind'='observation' and b.id=(t->>'binding_id')::uuid)
 ), observations as (
  select o.page,o.ordinal,o.snapshot_id,o.head_version,o.file_id,o.raw_record_sha256,o.stable_metadata_sha256 from selected_binding b join owned x on true join public.ezyvet_attachment_page_observations o on o.run_id=b.child_run_id where x.resource='attachment'
  union all select o.page,0,o.snapshot_id,o.head_version,null,null,null from selected_binding b join owned x on true join public.ezyvet_clinical_page_observations o on o.run_id=b.child_run_id where x.resource in ('consult','history')
  union all select o.page,0,o.snapshot_id,o.head_version,null,null,null from selected_binding b join owned x on true join public.ezyvet_vaccination_page_observations o on o.run_id=b.child_run_id where x.resource='vaccination'
  union all select o.page,0,o.snapshot_id,o.head_version,null,null,null from selected_binding b join owned x on true join public.ezyvet_prescription_page_observations o on o.run_id=b.child_run_id where x.resource='prescription'
  union all select o.page,0,o.snapshot_id,o.head_version,null,null,null from selected_binding b join owned x on true join public.ezyvet_prescriptionitem_page_observations o on o.run_id=b.child_run_id where x.resource='prescriptionitem'
  union all select o.page,0,o.snapshot_id,null,null,null,null from selected_binding b join owned x on true join public.ezyvet_import_page_items o on o.run_id=b.child_run_id join public.ezyvet_import_snapshots ss on ss.id=o.snapshot_id
   where x.resource in ('contact','animal','healthstatus') and ss.resource=x.resource and ss.source_origin=x.source_origin and ss.source_site_uid=x.source_site_uid and ((x.resource='healthstatus' and ss.payload->>'animal_id'=x.parent_external_id) or (x.resource in ('contact','animal') and ss.external_id=x.parent_external_id))
 ), observed as materialized (
  select o.*,ss.external_id,ss.payload_hash,ih.snapshot_id current_snapshot_id,ih.version current_head_version,
   encode(sha256(convert_to(jsonb_build_object('version',1,'child_run_id',b.child_run_id,'page',o.page,'ordinal',o.ordinal,'source_origin',ss.source_origin,'source_site_uid',ss.source_site_uid,
    'resource',ss.resource,'external_id',ss.external_id,'snapshot_id',ss.id,'payload_hash',ss.payload_hash,'observed_head_version',o.head_version,'file_id',o.file_id,'raw_record_sha256',o.raw_record_sha256,'stable_metadata_sha256',o.stable_metadata_sha256)::text,'UTF8')),'hex') evidence_hash
  from observations o cross join owned x cross join selected_binding b join public.ezyvet_import_snapshots ss on ss.id=o.snapshot_id and ss.resource=x.resource and ss.source_origin=x.source_origin and ss.source_site_uid=x.source_site_uid
  left join public.ezyvet_identity_heads ih on ih.source_origin=ss.source_origin and ih.source_site_uid=ss.source_site_uid and ih.resource=ss.resource and ih.external_id=ss.external_id
  where t->>'kind'='observation' and o.page=(t->>'page')::integer and o.ordinal=(t->>'ordinal')::integer and o.snapshot_id=(t->>'snapshot_id')::uuid
 ), context as (
  select jsonb_build_object('version',1,'manifest_hash',(select hash from manifest),'source_origin',x.source_origin,'source_site_uid',x.source_site_uid,
   'scope',jsonb_build_object('id',x.id,'migration_run_id',x.migration_run_id,'resource',x.resource,'disposition',x.disposition,'mapping_id',x.mapping_id,'mapping_snapshot_id',x.mapping_snapshot_id,'mapping_head_version',x.mapping_head_version,
    'client_id',x.client_id,'pet_id',x.pet_id,'parent_type',x.parent_type,'parent_snapshot_id',x.parent_snapshot_id,'parent_head_version',x.parent_head_version),
   'binding',jsonb_build_object('selected_id',b.id,'selected_context_hash',b.context_hash,'current_id',cb.id,'current_context_hash',cb.context_hash,'child_run_id',b.child_run_id,'superseded',b.id is not null and b.id is distinct from cb.id),
   'mapping',jsonb_build_object('current_snapshot_id',mh.snapshot_id,'current_head_version',mh.version),
   'parent',jsonb_build_object('current_snapshot_id',ph.snapshot_id,'current_head_version',ph.version),
   'local',jsonb_build_object('client_exists',cl.id is not null,'client_version',cl.version,'pet_exists',case when x.pet_id is null then null else p.id is not null end,'pet_version',p.version,'household_current',case when x.pet_id is null then cl.id is not null else coalesce(p.client_id=x.client_id,false) end),
   'scan',case when c.id is null then null else jsonb_build_object('status',c.status,'next_page',c.next_page,'retry_after',c.retry_after,'error_code',case when c.last_error_code ~ '^[A-Z_]{1,64}$' then c.last_error_code when c.last_error_code is null then null else 'UNCLASSIFIED_ERROR' end,
    'attempt_sequence',coalesce((select max(e.sequence) from public.ezyvet_migration_attempt_events e where e.child_run_id=c.id),0)) end,
   'observation',case when o.snapshot_id is null then null else jsonb_build_object('page',o.page,'ordinal',o.ordinal,'snapshot_id',o.snapshot_id,'external_id',o.external_id,'payload_hash',o.payload_hash,'observed_head_version',o.head_version,
    'file_id',o.file_id,'raw_record_sha256',o.raw_record_sha256,'stable_metadata_sha256',o.stable_metadata_sha256,'evidence_hash',o.evidence_hash,'current_snapshot_id',o.current_snapshot_id,'current_head_version',o.current_head_version) end) value
  from owned x left join selected_binding b on true left join current_binding cb on true left join public.ezyvet_import_runs c on c.id=b.child_run_id
  left join public.ezyvet_record_links m on m.id=x.mapping_id
  left join public.ezyvet_identity_heads mh on mh.source_origin=x.source_origin and mh.source_site_uid=x.source_site_uid and mh.resource=m.resource and mh.external_id=m.external_id
  left join public.ezyvet_identity_heads ph on ph.source_origin=x.source_origin and ph.source_site_uid=x.source_site_uid and ph.resource=x.parent_type and ph.external_id=x.parent_external_id
  left join public.clients cl on cl.id=x.client_id left join public.pets p on p.id=x.pet_id left join observed o on o.evidence_hash=t->>'evidence_hash'
  where t->>'kind'='scope' or o.snapshot_id is not null
 ) select value into result from context;
 if result is null then raise exception 'Exact owned migration target required' using errcode='42501';end if;
 return result;
end $$;

create function public.ezyvet_migration_resolution_receipt(p_row public.ezyvet_migration_resolutions) returns jsonb language sql immutable set search_path=public as $$
 select jsonb_build_object('receipt_version',1,'id',p_row.id,'actor_id',p_row.actor_id,'migration_run_id',p_row.migration_run_id,'scope_id',p_row.scope_id,
  'target_kind',p_row.target_kind,'binding_id',p_row.target->'binding_id','page',p_row.target->'page','ordinal',p_row.target->'ordinal','snapshot_id',p_row.target->'snapshot_id','evidence_hash',p_row.target->'evidence_hash',
  'target_key',p_row.target_key,'action',p_row.action,'reason',p_row.reason,'request_hash',p_row.request_hash,'reviewed_context',p_row.reviewed_context,'reviewed_context_hash',p_row.reviewed_context_hash,
  'replaces_id',p_row.replaces_id,'version',p_row.version,'record_hash',p_row.record_hash,'created_at',p_row.created_at);
$$;

create function public.read_ezyvet_migration_resolution(p_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=auth.uid();result jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select public.ezyvet_migration_resolution_receipt(d) into result from public.ezyvet_migration_resolutions d join public.ezyvet_migration_runs r on r.id=d.migration_run_id where d.id=p_id and d.actor_id=a and r.actor_id=a;
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return result;
end $$;

create function public.read_ezyvet_migration_resolution_context(p_scope_id uuid,p_target jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=auth.uid();t jsonb;key text;result jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 t:=public.ezyvet_migration_resolution_target(p_target);key:=encode(sha256(convert_to(jsonb_build_object('version',1,'scope_id',p_scope_id,'target',t)::text,'UTF8')),'hex');
 with ctx as materialized (select public.ezyvet_migration_resolution_context(p_scope_id,t) value)
 select jsonb_build_object('version',1,'actor_id',a,'scope_id',p_scope_id,'target',t,'target_key',key,'context',value,'context_hash',encode(sha256(convert_to(value::text,'UTF8')),'hex'),
  'latest',(select public.ezyvet_migration_resolution_receipt(d) from public.ezyvet_migration_resolutions d where d.target_key=key and d.actor_id=a and not exists(select 1 from public.ezyvet_migration_resolutions n where n.replaces_id=d.id)),
  'clinical_approval_performed',false,'complete_coverage_verified',false,'observed_at',statement_timestamp()) into result from ctx;
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return result;
end $$;

create function public.save_ezyvet_migration_resolution(p_id uuid,p_scope_id uuid,p_target jsonb,p_action text,p_reason text,p_expected_context_hash text,p_replaces_id uuid default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a uuid:=auth.uid();t jsonb;key text;request_hash text;previous public.ezyvet_migration_resolutions;existing public.ezyvet_migration_resolutions;stamp timestamptz;ver integer;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_scope_id is null or p_action is null or p_action not in ('exclude','reopen') or p_reason is null or p_reason<>btrim(p_reason) or length(p_reason) not between 1 and 2000 or p_expected_context_hash is null or p_expected_context_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid operational resolution' using errcode='23514';end if;
 t:=public.ezyvet_migration_resolution_target(p_target);key:=encode(sha256(convert_to(jsonb_build_object('version',1,'scope_id',p_scope_id,'target',t)::text,'UTF8')),'hex');
 request_hash:=encode(sha256(convert_to(jsonb_build_object('version',1,'actor_id',a,'scope_id',p_scope_id,'target',t,'action',p_action,'reason',p_reason,'expected_context_hash',p_expected_context_hash,'replaces_id',p_replaces_id)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('ezyvet-migration-resolution:'||p_id::text,0));
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into existing from public.ezyvet_migration_resolutions where id=p_id;
 if found then
  if existing.actor_id<>a or existing.request_hash<>request_hash then raise exception 'Resolution request identity cannot change' using errcode='42501';end if;
  return public.read_ezyvet_migration_resolution(p_id);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('ezyvet-migration-scope-binding:'||p_scope_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('ezyvet-migration-resolution-target:'||key,0));
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if not exists(select 1 from public.ezyvet_migration_scopes s join public.ezyvet_migration_runs r on r.id=s.migration_run_id where s.id=p_scope_id and r.actor_id=a) then raise exception 'Owned migration scope required' using errcode='42501';end if;
 select * into previous from public.ezyvet_migration_resolutions d where d.target_key=key and not exists(select 1 from public.ezyvet_migration_resolutions n where n.replaces_id=d.id);
 if previous.id is distinct from p_replaces_id then raise exception 'Exact preceding resolution required' using errcode='40001';end if;
 if p_action='reopen' and (previous.id is null or previous.action<>'exclude') then raise exception 'Reopen requires a preceding exclusion' using errcode='23514';end if;
 ver:=coalesce(previous.version,0)+1;stamp:=clock_timestamp();
 -- Compare and append share one post-wait statement snapshot. Later source commits can stale the receipt.
 with context as materialized (select public.ezyvet_migration_resolution_context(p_scope_id,t) value),
 hashed as materialized (select value,encode(sha256(convert_to(value::text,'UTF8')),'hex') hash from context)
 insert into public.ezyvet_migration_resolutions(id,actor_id,migration_run_id,scope_id,target_kind,target,target_key,action,reason,request_hash,reviewed_context,reviewed_context_hash,replaces_id,version,record_hash,created_at)
 select p_id,a,(value#>>'{scope,migration_run_id}')::uuid,p_scope_id,t->>'kind',t,key,p_action,p_reason,request_hash,value,hash,p_replaces_id,ver,
  encode(sha256(convert_to(jsonb_build_object('version',1,'id',p_id,'actor_id',a,'scope_id',p_scope_id,'target',t,'target_key',key,'action',p_action,'reason',p_reason,'request_hash',request_hash,
   'reviewed_context_hash',hash,'replaces_id',p_replaces_id,'resolution_version',ver,'created_at',stamp)::text,'UTF8')),'hex'),stamp from hashed where hash=p_expected_context_hash;
 if not found then raise exception 'Operational evidence changed; review again' using errcode='40001';end if;
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return public.read_ezyvet_migration_resolution(p_id);
end $$;

create function public.list_ezyvet_migration_resolutions(p_scope_id uuid,p_target jsonb default null,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a uuid:=auth.uid();t jsonb;key text;result jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_scope_id is null or (p_before_at is null)<>(p_before_id is null) or (p_before_at is not null and not isfinite(p_before_at)) or p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid resolution history cursor' using errcode='23514';end if;
 if not exists(select 1 from public.ezyvet_migration_scopes s join public.ezyvet_migration_runs r on r.id=s.migration_run_id where s.id=p_scope_id and r.actor_id=a) then raise exception 'Owned migration scope required' using errcode='42501';end if;
 if p_target is not null then t:=public.ezyvet_migration_resolution_target(p_target);key:=encode(sha256(convert_to(jsonb_build_object('version',1,'scope_id',p_scope_id,'target',t)::text,'UTF8')),'hex');perform public.ezyvet_migration_resolution_context(p_scope_id,t);end if;
 with bounded as materialized (
  select d.* from public.ezyvet_migration_resolutions d where d.scope_id=p_scope_id and d.actor_id=a and (key is null or d.target_key=key) and (p_before_at is null or (d.created_at,d.id)<(p_before_at,p_before_id)) order by d.created_at desc,d.id desc limit p_limit+1
 ), selected as materialized (select * from bounded order by created_at desc,id desc limit p_limit), targets as materialized (
  select distinct target_key,target from selected
 ), contexts as materialized (select target_key,encode(sha256(convert_to(public.ezyvet_migration_resolution_context(p_scope_id,target)::text,'UTF8')),'hex') hash from targets)
 select jsonb_build_object('version',1,'actor_id',a,'scope_id',p_scope_id,'target',t,'target_key',key,
  'resolutions',(select coalesce(jsonb_agg(jsonb_build_object('receipt',public.ezyvet_migration_resolution_receipt(d),'superseded',exists(select 1 from public.ezyvet_migration_resolutions n where n.replaces_id=d.id),'context_current',d.reviewed_context_hash=c.hash) order by d.created_at desc,d.id desc),'[]') from selected d join contexts c using(target_key)),
  'has_more',(select count(*)>p_limit from bounded),'next_cursor',case when (select count(*)>p_limit from bounded) then (select jsonb_build_object('before_at',created_at,'before_id',id) from selected order by created_at,id limit 1) else null end,
  'clinical_approval_performed',false,'complete_coverage_verified',false,'observed_at',statement_timestamp()) into result;
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return result;
end $$;

do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in ('ezyvet_migration_resolution_target','ezyvet_migration_resolution_context','ezyvet_migration_resolution_receipt','read_ezyvet_migration_resolution','read_ezyvet_migration_resolution_context','save_ezyvet_migration_resolution','list_ezyvet_migration_resolutions') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in ('read_ezyvet_migration_resolution','read_ezyvet_migration_resolution_context','save_ezyvet_migration_resolution','list_ezyvet_migration_resolutions') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;

-- Preserve the validated patient relationship even for privileged historical fixtures.
-- Bounded source-evidence drill-down. Live currentness never rewrites an observation.
-- No payloads, original bytes, clinical promotion or coverage acceptance are returned.
create or replace function public.list_ezyvet_migration_items(p_binding_id uuid,p_after_page integer default null,p_after_ordinal integer default null,p_after_snapshot_id uuid default null,p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a uuid:=auth.uid();result jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_binding_id is null or p_limit is null or p_limit not between 1 and 100
  or num_nonnulls(p_after_page,p_after_ordinal,p_after_snapshot_id) not in (0,3)
  or p_after_page not between 1 and 1000 or p_after_ordinal not between 0 and 10 then raise exception 'Invalid migration item cursor' using errcode='23514';end if;
 -- Context, bounded observations and current heads share one statement snapshot.
 with owned as materialized (
  select b.id binding_id,b.child_run_id,b.context_hash,s.*,r.source_origin,r.source_site_uid,
   exists(select 1 from public.ezyvet_migration_bindings newer where newer.replaces_id=b.id) superseded,
   exists(select 1 from public.ezyvet_record_links m where m.id=s.mapping_id and m.snapshot_id=s.mapping_snapshot_id and m.head_version=s.mapping_head_version
    and m.source_origin=r.source_origin and m.source_site_uid=r.source_site_uid and m.client_id=s.client_id and m.pet_id is not distinct from s.pet_id) mapping_matches_manifest,
   exists(select 1 from public.ezyvet_record_links m join public.ezyvet_identity_heads h using(source_origin,source_site_uid,resource,external_id)
    where m.id=s.mapping_id and h.snapshot_id=s.mapping_snapshot_id and h.version=s.mapping_head_version) mapping_source_current,
   exists(select 1 from public.ezyvet_identity_heads h where h.source_origin=r.source_origin and h.source_site_uid=r.source_site_uid and h.resource=s.parent_type and h.external_id=s.parent_external_id and h.snapshot_id=s.parent_snapshot_id and h.version=s.parent_head_version) parent_current,
   case when s.pet_id is null then exists(select 1 from public.clients where id=s.client_id) else exists(select 1 from public.pets where id=s.pet_id and client_id=s.client_id) end household_current
  from public.ezyvet_migration_bindings b join public.ezyvet_migration_scopes s on s.id=b.scope_id
  join public.ezyvet_migration_runs r on r.id=s.migration_run_id join public.ezyvet_import_runs c on c.id=b.child_run_id
  where b.id=p_binding_id and b.actor_id=a and r.actor_id=a and c.requested_by=a
 ), observed as (
  select o.page,o.ordinal,o.snapshot_id,o.head_version,o.file_id,o.raw_record_sha256,o.stable_metadata_sha256 from owned x join public.ezyvet_attachment_page_observations o on o.run_id=x.child_run_id where x.resource='attachment'
  union all select o.page,0,o.snapshot_id,o.head_version,null,null,null from owned x join public.ezyvet_clinical_page_observations o on o.run_id=x.child_run_id where x.resource in ('consult','history')
  union all select o.page,0,o.snapshot_id,o.head_version,null,null,null from owned x join public.ezyvet_vaccination_page_observations o on o.run_id=x.child_run_id where x.resource='vaccination'
  union all select o.page,0,o.snapshot_id,o.head_version,null,null,null from owned x join public.ezyvet_prescription_page_observations o on o.run_id=x.child_run_id where x.resource='prescription'
  union all select o.page,0,o.snapshot_id,o.head_version,null,null,null from owned x join public.ezyvet_prescriptionitem_page_observations o on o.run_id=x.child_run_id where x.resource='prescriptionitem'
  union all select o.page,0,o.snapshot_id,null,null,null,null from owned x join public.ezyvet_import_page_items o on o.run_id=x.child_run_id
   join public.ezyvet_import_snapshots s on s.id=o.snapshot_id where x.resource in ('contact','animal','healthstatus') and s.resource=x.resource
    and s.source_origin=x.source_origin and s.source_site_uid=x.source_site_uid and ((x.resource='healthstatus' and s.payload->>'animal_id'=x.parent_external_id) or (x.resource in ('contact','animal') and s.external_id=x.parent_external_id))
 ), bounded as materialized (
  select * from observed o where p_after_page is null or (o.page,o.ordinal,o.snapshot_id)>(p_after_page,p_after_ordinal,p_after_snapshot_id)
  order by o.page,o.ordinal,o.snapshot_id limit p_limit+1
 ), selected as (
  select * from bounded order by page,ordinal,snapshot_id limit p_limit
 ), items as (
  select o.page,o.ordinal,o.snapshot_id,jsonb_build_object(
   'page',o.page,'ordinal',o.ordinal,'snapshot_id',o.snapshot_id,'observed_head_version',o.head_version,
   'external_id',s.external_id,'payload_hash',s.payload_hash,'file_id',o.file_id,'raw_record_sha256',o.raw_record_sha256,'stable_metadata_sha256',o.stable_metadata_sha256,
   'evidence_hash',encode(sha256(convert_to(jsonb_build_object('version',1,'child_run_id',x.child_run_id,'page',o.page,'ordinal',o.ordinal,
    'source_origin',s.source_origin,'source_site_uid',s.source_site_uid,'resource',s.resource,'external_id',s.external_id,'snapshot_id',s.id,'payload_hash',s.payload_hash,
    'observed_head_version',o.head_version,'file_id',o.file_id,'raw_record_sha256',o.raw_record_sha256,'stable_metadata_sha256',o.stable_metadata_sha256)::text,'UTF8')),'hex'),
   'current_snapshot_id',h.snapshot_id,'current_head_version',h.version,'payload_current',coalesce(h.snapshot_id=o.snapshot_id,false),
   'exact_source_current',case when o.head_version is null then null else coalesce(h.snapshot_id=o.snapshot_id and h.version=o.head_version,false) end) item
  from selected o cross join owned x join public.ezyvet_import_snapshots s on s.id=o.snapshot_id
  left join public.ezyvet_identity_heads h on h.source_origin=s.source_origin and h.source_site_uid=s.source_site_uid and h.resource=s.resource and h.external_id=s.external_id
 )
 select jsonb_build_object('version',1,'binding_id',x.binding_id,'scope_id',x.id,'migration_run_id',x.migration_run_id,'child_run_id',x.child_run_id,
  'resource',x.resource,'context_hash',x.context_hash,'superseded',x.superseded,'mapping_matches_manifest',x.mapping_matches_manifest,'mapping_source_current',x.mapping_source_current,
  'parent_current',x.parent_current,'household_current',x.household_current,
  'occurrence_fidelity',case when x.resource='attachment' then 'page_ordinal' else 'deduplicated_page_snapshot' end,
  'review_reconciled',false,'complete_coverage_verified',false,'observed_at',statement_timestamp(),
  'items',(select coalesce(jsonb_agg(item order by page,ordinal,snapshot_id),'[]') from items),
  'has_more',(select count(*)>p_limit from bounded),
  'next_cursor',case when (select count(*)>p_limit from bounded) then (select jsonb_build_object('page',page,'ordinal',ordinal,'snapshot_id',snapshot_id) from selected order by page desc,ordinal desc,snapshot_id desc limit 1) else null end)
 into result from owned x;
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if result is null then raise exception 'Owned migration binding required' using errcode='42501';end if;
 return result;
end $$;
revoke all on function public.list_ezyvet_migration_items(uuid,integer,integer,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_ezyvet_migration_items(uuid,integer,integer,uuid,integer) to authenticated;
