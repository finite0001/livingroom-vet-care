-- Historical membership only. This never claims, continues or alters an import.
create table public.ezyvet_migration_bindings (
 id uuid primary key,
 scope_id uuid not null references public.ezyvet_migration_scopes(id),
 child_run_id uuid not null references public.ezyvet_import_runs(id),
 actor_id uuid not null references public.profiles(id),
 replaces_id uuid unique references public.ezyvet_migration_bindings(id),
 reason text not null check(reason=btrim(reason) and length(reason) between 1 and 2000),
 child_context jsonb not null check(jsonb_typeof(child_context)='object'),
 context_hash text not null check(context_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(),
 unique(scope_id,child_run_id)
);
create index ezyvet_migration_bindings_scope on public.ezyvet_migration_bindings(scope_id,created_at desc,id desc);
alter table public.ezyvet_migration_bindings enable row level security;
revoke all on public.ezyvet_migration_bindings from public,anon,authenticated,service_role;
create trigger immutable_migration_binding before update or delete on public.ezyvet_migration_bindings
 for each row execute function public.guard_inquiry_history();

create function public.read_ezyvet_migration_binding(p_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a uuid:=auth.uid();result jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select to_jsonb(b) into result from public.ezyvet_migration_bindings b
 join public.ezyvet_migration_scopes s on s.id=b.scope_id join public.ezyvet_migration_runs r on r.id=s.migration_run_id
 where b.id=p_id and b.actor_id=a and r.actor_id=a;
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return result;
end $$;

create function public.bind_ezyvet_migration_child(p_id uuid,p_scope_id uuid,p_child_run_id uuid,p_reason text,p_replaces_id uuid default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a uuid:=auth.uid();s public.ezyvet_migration_scopes;r public.ezyvet_migration_runs;c public.ezyvet_import_runs;
 b public.ezyvet_migration_bindings;previous uuid;context jsonb;mapping public.ezyvet_record_links;descriptor jsonb;fidelity text;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_scope_id is null or p_child_run_id is null or p_reason is null or p_reason<>btrim(p_reason) or length(p_reason) not between 1 and 2000 then
  raise exception 'Invalid migration binding' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('ezyvet-migration-binding:'||p_id::text,0));
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into b from public.ezyvet_migration_bindings where id=p_id;
 if found then
  if row(b.actor_id,b.scope_id,b.child_run_id,b.reason,b.replaces_id) is distinct from row(a,p_scope_id,p_child_run_id,p_reason,p_replaces_id) then
   raise exception 'Migration binding identity cannot change' using errcode='42501';end if;
  return public.read_ezyvet_migration_binding(p_id);
 end if;
 -- Serialize only this new ledger's predecessor chain; no child/source claim locks.
 perform pg_advisory_xact_lock(hashtextextended('ezyvet-migration-scope-binding:'||p_scope_id::text,0));
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into s from public.ezyvet_migration_scopes where id=p_scope_id;
 select * into r from public.ezyvet_migration_runs where id=s.migration_run_id and actor_id=a;
 if r.id is null then raise exception 'Owned migration scope required' using errcode='42501';end if;
 if s.disposition<>'required' then raise exception 'Excluded or unsupported scope cannot acquire work' using errcode='23514';end if;
 select x.id into previous from public.ezyvet_migration_bindings x where x.scope_id=s.id
 and not exists(select 1 from public.ezyvet_migration_bindings n where n.replaces_id=x.id);
 if previous is distinct from p_replaces_id then raise exception 'Exact preceding binding required' using errcode='40001';end if;
 if exists(select 1 from public.ezyvet_migration_bindings where scope_id=s.id and child_run_id=p_child_run_id) then
  raise exception 'Child already bound to this scope; recover its binding' using errcode='23514';end if;
 select * into c from public.ezyvet_import_runs where id=p_child_run_id;
 if c.id is null or row(c.requested_by,c.source_origin,c.source_site_uid,c.resource) is distinct from row(a,r.source_origin,r.source_site_uid,s.resource) then
  raise exception 'Child owner, site or resource mismatch' using errcode='42501';end if;
 select * into mapping from public.ezyvet_record_links where id=s.mapping_id;
 if s.resource in ('contact','animal') then
  -- An unscoped scan is filtered to this identity in reconciliation, never credited wholesale.
  context:=jsonb_build_object('selected_external_id',s.parent_external_id,'selected_snapshot_id',s.parent_snapshot_id,'selected_head_version',s.parent_head_version);
  fidelity:='selected_identity_filter';
 elsif s.resource='healthstatus' then
  select to_jsonb(x) into context from public.ezyvet_weight_runs x where x.run_id=c.id and x.animal_link_id=s.mapping_id;
  fidelity:='mapping_identity_only';
 elsif s.resource in ('consult','history') then
  select to_jsonb(x) into context from public.ezyvet_clinical_runs x where x.run_id=c.id;
  fidelity:='mapping_identity_only';
 elsif s.resource='prescription' then
  select to_jsonb(x) into context from public.ezyvet_prescription_runs x where x.run_id=c.id;
  fidelity:='mapping_identity_only';
 elsif s.resource='vaccination' then
  select to_jsonb(x) into context from public.ezyvet_vaccination_runs x where x.run_id=c.id;
  if row(context->>'consult_snapshot_id',context->>'consult_payload_hash',context->>'consult_observed_head_version',context->>'consult_external_id')
   is distinct from row(s.parent_snapshot_id::text,s.parent_payload_hash,s.parent_head_version::text,s.parent_external_id) then
   raise exception 'Exact child parent version required' using errcode='42501';end if;
  fidelity:='exact_parent_version';
 elsif s.resource='prescriptionitem' then
  select to_jsonb(x) into context from public.ezyvet_prescriptionitem_runs x where x.run_id=c.id;
  if row(context->>'prescription_snapshot_id',context->>'prescription_payload_hash',context->>'prescription_observed_head_version',context->>'prescription_external_id')
   is distinct from row(s.parent_snapshot_id::text,s.parent_payload_hash,s.parent_head_version::text,s.parent_external_id) then
   raise exception 'Exact child parent version required' using errcode='42501';end if;
  fidelity:='exact_parent_version';
 elsif s.resource='attachment' then
  select x.parent_context into context from public.ezyvet_attachment_runs x where x.run_id=c.id and x.actor_id=a and x.animal_link_id=s.mapping_id and x.pet_id=s.pet_id;
  if row(context->>'parent_snapshot_id',context->>'parent_payload_hash',context->>'parent_observed_head_version',context->>'parent_external_id',context->>'parent_type')
   is distinct from row(s.parent_snapshot_id::text,s.parent_payload_hash,s.parent_head_version::text,s.parent_external_id,'Animal'::text) then
   raise exception 'Exact child parent version required' using errcode='42501';end if;
  fidelity:='exact_parent_version';
 end if;
 if context is null then raise exception 'Scoped child evidence required' using errcode='42501';end if;
 if s.resource not in ('contact','animal','healthstatus') then
  if row(context->>'animal_link_id',context->>'pet_id',context->>'client_id',context->>'source_origin',context->>'source_site_uid',context->>'animal_external_id')
   is distinct from row(s.mapping_id::text,s.pet_id::text,s.client_id::text,r.source_origin,r.source_site_uid,mapping.external_id)
   or (s.resource<>'attachment' and row(context->>'actor_id',context->>'resource') is distinct from row(a::text,s.resource)) then
   raise exception 'Child patient or mapping mismatch' using errcode='42501';end if;
 end if;
 descriptor:=jsonb_build_object('version',1,'run_id',c.id,'owner',c.requested_by,'source_origin',c.source_origin,'source_site_uid',c.source_site_uid,
  'resource',c.resource,'parent_evidence',fidelity,'context',context);
 insert into public.ezyvet_migration_bindings(id,scope_id,child_run_id,actor_id,replaces_id,reason,child_context,context_hash)
 values(p_id,s.id,c.id,a,p_replaces_id,p_reason,descriptor,encode(sha256(convert_to(descriptor::text,'UTF8')),'hex'));
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return public.read_ezyvet_migration_binding(p_id);
end $$;

create function public.list_ezyvet_migration_bindings(p_scope_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a uuid:=auth.uid();result jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_scope_id is null or (p_before_at is null)<>(p_before_id is null) or p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid binding history cursor' using errcode='23514';end if;
 if not exists(select 1 from public.ezyvet_migration_scopes s join public.ezyvet_migration_runs r on r.id=s.migration_run_id where s.id=p_scope_id and r.actor_id=a) then
  raise exception 'Owned migration scope required' using errcode='42501';end if;
 with candidates as materialized (
  select b.* from public.ezyvet_migration_bindings b where scope_id=p_scope_id and actor_id=a
  and (p_before_at is null or (created_at,id)<(p_before_at,p_before_id)) order by created_at desc,id desc limit p_limit+1
 ), page as (select * from candidates order by created_at desc,id desc limit p_limit)
 select jsonb_build_object('bindings',coalesce((select jsonb_agg(to_jsonb(p) order by created_at desc,id desc) from page p),'[]'::jsonb),'has_more',(select count(*)>p_limit from candidates)) into result;
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return result;
end $$;
revoke all on function public.bind_ezyvet_migration_child(uuid,uuid,uuid,text,uuid),public.read_ezyvet_migration_binding(uuid),public.list_ezyvet_migration_bindings(uuid,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.bind_ezyvet_migration_child(uuid,uuid,uuid,text,uuid),public.read_ezyvet_migration_binding(uuid),public.list_ezyvet_migration_bindings(uuid,timestamptz,uuid,integer) to authenticated;
