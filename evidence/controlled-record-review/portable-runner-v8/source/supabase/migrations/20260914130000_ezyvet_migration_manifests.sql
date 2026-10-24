-- Migration planning evidence only: no provider claim, clinical promotion or send.
create table public.ezyvet_migration_runs (
 id uuid primary key,
 actor_id uuid not null references public.profiles(id),
 source_origin text not null check(source_origin in ('https://api.trial.ezyvet.com','https://api.ezyvet.com')),
 source_site_uid text not null check(length(btrim(source_site_uid)) between 1 and 4096),
 intent jsonb not null check(jsonb_typeof(intent)='object'),
 intent_hash text not null check(intent_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp()
);
create index ezyvet_migration_runs_owner on public.ezyvet_migration_runs(actor_id,created_at desc,id desc);
create table public.ezyvet_migration_scopes (
 id uuid primary key,
 migration_run_id uuid not null references public.ezyvet_migration_runs(id),
 mapping_id uuid not null references public.ezyvet_record_links(id),
 mapping_snapshot_id uuid not null references public.ezyvet_import_snapshots(id),
 mapping_head_version integer not null check(mapping_head_version>0),
 client_id uuid not null references public.clients(id),
 pet_id uuid references public.pets(id),
 resource text not null check(resource in ('contact','animal','healthstatus','consult','history','vaccination','prescription','prescriptionitem','attachment')),
 parent_type text not null check(parent_type in ('contact','animal','consult','prescription')),
 parent_snapshot_id uuid not null references public.ezyvet_import_snapshots(id),
 parent_head_version integer not null check(parent_head_version>0),
 parent_external_id text not null,
 parent_payload_hash text not null,
 disposition text not null check(disposition in ('required','excluded','unsupported')),
 reason text not null check(length(btrim(reason)) between 1 and 2000),
 unique(migration_run_id,mapping_id,resource,parent_type,parent_snapshot_id)
);
do $$declare t text;begin
 foreach t in array array['ezyvet_migration_runs','ezyvet_migration_scopes'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
  execute format('create trigger immutable_migration_manifest before update or delete on public.%I for each row execute function public.guard_inquiry_history()',t);
 end loop;
end $$;

create function public.read_ezyvet_migration_run(p_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a uuid:=auth.uid();r public.ezyvet_migration_runs;result jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into r from public.ezyvet_migration_runs where id=p_id and actor_id=a;
 if not found then return null;end if;
 select jsonb_build_object('run',to_jsonb(r),'scopes',coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]'::jsonb)) into result
 from public.ezyvet_migration_scopes s where migration_run_id=r.id;
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return result;
end $$;

create function public.prepare_ezyvet_migration_run(p_id uuid,p_source_origin text,p_source_site_uid text,p_scopes jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a uuid:=auth.uid();normalized jsonb;intent jsonb;digest text;r public.ezyvet_migration_runs;
 item jsonb;m public.ezyvet_record_links;s public.ezyvet_import_snapshots;h public.ezyvet_identity_heads;
 scope_id uuid;mapping_id uuid;parent_id uuid;observed integer;resource text;parent text;disposition text;reason text;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_source_origin is null or p_source_origin not in ('https://api.trial.ezyvet.com','https://api.ezyvet.com')
  or p_source_site_uid is null or p_source_site_uid<>btrim(p_source_site_uid) or length(p_source_site_uid) not between 1 and 4096
  or p_scopes is null or jsonb_typeof(p_scopes)<>'array' then raise exception 'Invalid migration manifest' using errcode='23514';end if;
 if jsonb_array_length(p_scopes) not between 1 and 100 or octet_length(p_scopes::text)>524288 then raise exception 'Use a bounded migration manifest' using errcode='23514';end if;
 for item in select value from jsonb_array_elements(p_scopes) loop
  if jsonb_typeof(item)<>'object' or not item ?& array['id','mapping_id','resource','parent_type','parent_snapshot_id','parent_head_version','disposition','reason'] then
   raise exception 'Incomplete migration scope' using errcode='23514';end if;
  if (select count(*) from jsonb_object_keys(item))<>8 or exists(select 1 from jsonb_each(item) e where e.key<>'parent_head_version' and jsonb_typeof(e.value)<>'string')
   or jsonb_typeof(item->'parent_head_version')<>'number' or (item->>'parent_head_version') !~ '^[1-9][0-9]{0,8}$' then
   raise exception 'Invalid migration scope fields' using errcode='23514';end if;
  scope_id:=(item->>'id')::uuid;mapping_id:=(item->>'mapping_id')::uuid;parent_id:=(item->>'parent_snapshot_id')::uuid;
 end loop;
 if (select count(distinct (value->>'id')::uuid) from jsonb_array_elements(p_scopes))<>jsonb_array_length(p_scopes) then
  raise exception 'Duplicate migration scope identity' using errcode='23514';end if;
 select jsonb_agg(value order by (value->>'id')::uuid) into normalized from jsonb_array_elements(p_scopes);
 intent:=jsonb_build_object('version',1,'source_origin',p_source_origin,'source_site_uid',p_source_site_uid,'scopes',normalized);
 digest:=encode(sha256(convert_to(intent::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('ezyvet-migration:'||p_id::text,0));
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into r from public.ezyvet_migration_runs where id=p_id;
 if found then
  if r.actor_id<>a or r.intent is distinct from intent or r.intent_hash<>digest then raise exception 'Migration request identity cannot change' using errcode='42501';end if;
  return public.read_ezyvet_migration_run(p_id);
 end if;
 insert into public.ezyvet_migration_runs(id,actor_id,source_origin,source_site_uid,intent,intent_hash)
 values(p_id,a,p_source_origin,p_source_site_uid,intent,digest);
 for item in select value from jsonb_array_elements(normalized) order by (value->>'mapping_id')::uuid,(value->>'parent_snapshot_id')::uuid,(value->>'id')::uuid loop
  scope_id:=(item->>'id')::uuid;mapping_id:=(item->>'mapping_id')::uuid;parent_id:=(item->>'parent_snapshot_id')::uuid;
  observed:=(item->>'parent_head_version')::integer;resource:=item->>'resource';parent:=item->>'parent_type';disposition:=item->>'disposition';reason:=item->>'reason';
  if resource not in ('contact','animal','healthstatus','consult','history','vaccination','prescription','prescriptionitem','attachment')
   or parent not in ('contact','animal','consult','prescription') or disposition not in ('required','excluded','unsupported')
   or reason<>btrim(reason) or length(reason) not between 1 and 2000 then raise exception 'Unsupported migration scope' using errcode='23514';end if;
  if not ((resource='contact' and parent='contact') or (resource in ('animal','healthstatus','consult','history','prescription') and parent='animal')
   or (resource='vaccination' and parent='consult') or (resource='prescriptionitem' and parent='prescription')
   or (resource='attachment' and (parent='animal' or (parent in ('contact','consult') and disposition<>'required')))) then
   raise exception 'Resource parent contract unavailable' using errcode='23514';end if;
  select * into m from public.ezyvet_record_links where id=mapping_id and source_origin=p_source_origin and source_site_uid=p_source_site_uid for share;
  if m.id is null or m.resource<>(case when parent='contact' then 'contact' else 'animal' end) then raise exception 'Exact approved mapping required' using errcode='42501';end if;
  if m.pet_id is not null then
   perform 1 from public.pets where id=m.pet_id and client_id=m.client_id for share;
   if not found then raise exception 'Patient household changed' using errcode='40001';end if;
  end if;
  select * into s from public.ezyvet_import_snapshots where id=parent_id;
  if s.id is null or row(s.source_origin,s.source_site_uid,s.resource) is distinct from row(p_source_origin,p_source_site_uid,parent)
   or (parent in ('contact','animal') and s.external_id<>m.external_id)
   or (parent in ('consult','prescription') and s.payload->>'animal_id' is distinct from m.external_id) then
   raise exception 'Parent source identity mismatch' using errcode='42501';end if;
  select hh.* into h from public.ezyvet_identity_heads hh where hh.source_origin=p_source_origin and hh.source_site_uid=p_source_site_uid and hh.resource=parent and hh.external_id=s.external_id for share;
  if h.snapshot_id is distinct from s.id or h.version is distinct from observed then raise exception 'Parent source changed; review scope again' using errcode='40001';end if;
  if parent='consult' then perform public.ezyvet_validate_vaccination_consult(m.id,p_source_origin,p_source_site_uid,s.id,s.payload_hash,observed);end if;
  if parent='prescription' then perform public.ezyvet_validate_prescriptionitem_prescription(m.id,p_source_origin,p_source_site_uid,s.id,s.payload_hash,observed);end if;
  insert into public.ezyvet_migration_scopes values(scope_id,p_id,m.id,m.snapshot_id,m.head_version,m.client_id,m.pet_id,resource,parent,s.id,observed,s.external_id,s.payload_hash,disposition,reason);
 end loop;
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return public.read_ezyvet_migration_run(p_id);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'Invalid migration scope value' using errcode='23514';
end $$;

create function public.list_ezyvet_migration_runs(p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a uuid:=auth.uid();result jsonb;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if (p_before_at is null)<>(p_before_id is null) or p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid migration history cursor' using errcode='23514';end if;
 with candidates as materialized (
  select id,source_origin,source_site_uid,intent_hash,created_at from public.ezyvet_migration_runs
  where actor_id=a and (p_before_at is null or (created_at,id)<(p_before_at,p_before_id)) order by created_at desc,id desc limit p_limit+1
 ), page as (select * from candidates order by created_at desc,id desc limit p_limit)
 select jsonb_build_object('runs',coalesce((select jsonb_agg(to_jsonb(p) order by created_at desc,id desc) from page p),'[]'::jsonb),'has_more',(select count(*)>p_limit from candidates)) into result;
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return result;
end $$;
revoke all on function public.prepare_ezyvet_migration_run(uuid,text,text,jsonb),public.read_ezyvet_migration_run(uuid),public.list_ezyvet_migration_runs(timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.prepare_ezyvet_migration_run(uuid,text,text,jsonb),public.read_ezyvet_migration_run(uuid),public.list_ezyvet_migration_runs(timestamptz,uuid,integer) to authenticated;
