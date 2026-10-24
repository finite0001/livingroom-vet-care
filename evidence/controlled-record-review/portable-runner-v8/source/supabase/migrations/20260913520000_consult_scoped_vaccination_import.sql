-- Consult-scoped vaccination source observations only; no native clinical promotion.
create table public.ezyvet_vaccination_runs (
 run_id uuid primary key references public.ezyvet_import_runs(id),
 animal_link_id uuid not null references public.ezyvet_record_links(id),
 actor_id uuid not null references public.profiles(id),pet_id uuid not null references public.pets(id),client_id uuid not null references public.clients(id),
 source_origin text not null,source_site_uid text not null,resource text not null check(resource in ('vaccination')),
 animal_external_id text not null check(animal_external_id ~ '^[0-9]+$'),
 consult_snapshot_id uuid not null references public.ezyvet_import_snapshots(id),consult_payload_hash text not null check(consult_payload_hash ~ '^[a-f0-9]{64}$'),
 consult_observed_head_version integer not null check(consult_observed_head_version>0),consult_external_id text not null,created_at timestamptz not null default now()
);
create table public.ezyvet_vaccination_pages (
 run_id uuid not null references public.ezyvet_vaccination_runs(run_id),page integer not null,
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),created_at timestamptz not null default now(),
 primary key(run_id,page),foreign key(run_id,page) references public.ezyvet_import_pages(run_id,page)
);
create table public.ezyvet_vaccination_page_observations (
 run_id uuid not null,page integer not null,snapshot_id uuid not null references public.ezyvet_import_snapshots(id),
 head_version integer not null check(head_version>0),primary key(run_id,page,snapshot_id),
 foreign key(run_id,page) references public.ezyvet_vaccination_pages(run_id,page),
 foreign key(run_id,page,snapshot_id) references public.ezyvet_import_page_items(run_id,page,snapshot_id)
);
create index ezyvet_vaccination_runs_mapping on public.ezyvet_vaccination_runs(animal_link_id,created_at desc,run_id desc);
create index ezyvet_vaccination_observations_snapshot on public.ezyvet_vaccination_page_observations(snapshot_id,head_version desc);
do $$declare t text;begin foreach t in array array['ezyvet_vaccination_runs','ezyvet_vaccination_pages','ezyvet_vaccination_page_observations'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger immutable_vaccination_import before update or delete on public.%I for each row execute function public.guard_inquiry_history()',t);
end loop;end $$;

create or replace function public.claim_ezyvet_import(p_id uuid,p_actor uuid,p_site_uid text,p_resource text,p_source_origin text) returns public.ezyvet_import_runs language plpgsql security definer set search_path=public as $$
begin
 if p_resource in ('healthstatus','diagnostic','consult','history','vaccination') then raise exception 'Resource requires a supported patient-scoped contract' using errcode='23514';end if;
 return public.claim_ezyvet_import_core(p_id,p_actor,p_site_uid,p_resource,p_source_origin);
end $$;
create function public.ezyvet_validate_vaccination_consult(p_animal_link_id uuid,p_source_origin text,p_site_uid text,p_consult_snapshot_id uuid,p_consult_payload_hash text,p_consult_observed_head_version integer) returns public.ezyvet_import_snapshots language plpgsql security definer set search_path=public as $$
declare m public.ezyvet_record_links;s public.ezyvet_import_snapshots;h public.ezyvet_identity_heads;
begin
 select * into m from public.ezyvet_record_links where id=p_animal_link_id and resource='animal' and source_origin=p_source_origin and source_site_uid=p_site_uid for share;
 if not found then raise exception 'Reviewed patient mapping required for this source site' using errcode='42501';end if;
 perform 1 from public.pets where id=m.pet_id and client_id=m.client_id for share;
 if not found then raise exception 'Vaccination patient mapping changed' using errcode='40001';end if;
 select * into s from public.ezyvet_import_snapshots where id=p_consult_snapshot_id;
 if s.id is null or row(s.source_origin,s.source_site_uid,s.resource,s.payload_hash,s.payload->>'animal_id') is distinct from row(p_source_origin,p_site_uid,'consult'::text,p_consult_payload_hash,m.external_id) then raise exception 'Scoped consult identity mismatch' using errcode='42501';end if;
 if s.external_id !~ '^(0|[1-9][0-9]{0,15})$' or s.external_id::numeric>9007199254740991 then raise exception 'Invalid consult external ID' using errcode='23514';end if;
 -- SHARE is compatible across vaccination readers, but blocks consult observations until commit.
 select * into h from public.ezyvet_identity_heads where source_origin=s.source_origin and source_site_uid=s.source_site_uid and resource='consult' and external_id=s.external_id for share;
 if h.snapshot_id is distinct from s.id or h.version is distinct from p_consult_observed_head_version or not exists(
  select 1 from public.ezyvet_clinical_page_observations o join public.ezyvet_clinical_runs c on c.run_id=o.run_id
  where o.snapshot_id=s.id and o.head_version=p_consult_observed_head_version and c.animal_link_id=m.id
   and row(c.resource,c.source_origin,c.source_site_uid,c.animal_external_id,c.pet_id,c.client_id)=row('consult'::text,m.source_origin,m.source_site_uid,m.external_id,m.pet_id,m.client_id)
 ) then raise exception 'SOURCE_CONSULT_STALE' using errcode='40001';end if;
 return s;
end $$;
revoke all on function public.ezyvet_validate_vaccination_consult(uuid,text,text,uuid,text,integer) from public,anon,authenticated,service_role;

create function public.claim_ezyvet_vaccination_import(p_id uuid,p_actor uuid,p_site_uid text,p_resource text,p_source_origin text,p_animal_link_id uuid,p_consult_snapshot_id uuid,p_consult_payload_hash text,p_consult_observed_head_version integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare m public.ezyvet_record_links;c public.ezyvet_vaccination_runs;r public.ezyvet_import_runs;s public.ezyvet_import_snapshots;
begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_consult_snapshot_id is null or p_consult_payload_hash is null or p_consult_payload_hash !~ '^[a-f0-9]{64}$' or p_consult_observed_head_version is null or p_consult_observed_head_version<1 or p_resource is null or p_resource not in ('vaccination') then raise exception 'Supported vaccination resource required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('vaccination-run:'||p_id::text,0));
 select * into c from public.ezyvet_vaccination_runs where run_id=p_id;
 if found then
  if row(c.actor_id,c.animal_link_id,c.source_origin,c.source_site_uid,c.resource,c.consult_snapshot_id,c.consult_payload_hash,c.consult_observed_head_version) is distinct from row(p_actor,p_animal_link_id,p_source_origin,p_site_uid,p_resource,p_consult_snapshot_id,p_consult_payload_hash,p_consult_observed_head_version) then raise exception 'Vaccination import identity cannot change' using errcode='42501';end if;
 elsif exists(select 1 from public.ezyvet_import_runs where id=p_id) then
  raise exception 'VACCINATION_RUN_REQUIRES_NEW_CONTEXT' using errcode='22023';
 end if;
 select * into r from public.ezyvet_import_runs where id=p_id;
 if c.run_id is not null and r.status<>'running' then
  return to_jsonb(r)||jsonb_build_object('animal_link_id',c.animal_link_id,'animal_external_id',c.animal_external_id,'pet_id',c.pet_id,'client_id',c.client_id,'consult_snapshot_id',c.consult_snapshot_id,'consult_payload_hash',c.consult_payload_hash,'consult_observed_head_version',c.consult_observed_head_version,'consult_external_id',c.consult_external_id);
 end if;
 select * into m from public.ezyvet_record_links where id=p_animal_link_id and resource='animal' and source_origin=p_source_origin and source_site_uid=p_site_uid for share;
 if not found or m.external_id !~ '^[0-9]+$' then raise exception 'Reviewed patient mapping required for this source site' using errcode='42501';end if;
 if c.run_id is not null and row(c.pet_id,c.client_id,c.animal_external_id) is distinct from row(m.pet_id,m.client_id,m.external_id) then raise exception 'Vaccination patient mapping changed' using errcode='40001';end if;
 -- Terminal exact runs recover without revalidating mutable household membership.
 select * into r from public.ezyvet_import_runs where id=p_id;
 if r.id is null or r.status='running' then
  perform 1 from public.pets where id=m.pet_id and client_id=m.client_id for share;
  if not found then raise exception 'Patient mapping changed; review before importing' using errcode='40001';end if;
 end if;
 s:=public.ezyvet_validate_vaccination_consult(p_animal_link_id,p_source_origin,p_site_uid,p_consult_snapshot_id,p_consult_payload_hash,p_consult_observed_head_version);
 r:=public.claim_ezyvet_import_core(p_id,p_actor,p_site_uid,p_resource,p_source_origin);
 insert into public.ezyvet_vaccination_runs(run_id,animal_link_id,actor_id,pet_id,client_id,source_origin,source_site_uid,resource,animal_external_id,consult_snapshot_id,consult_payload_hash,consult_observed_head_version,consult_external_id)
 values(p_id,m.id,p_actor,m.pet_id,m.client_id,p_source_origin,p_site_uid,p_resource,m.external_id,s.id,s.payload_hash,p_consult_observed_head_version,s.external_id) on conflict(run_id) do nothing;
 return to_jsonb(r)||jsonb_build_object('animal_link_id',m.id,'animal_external_id',m.external_id,'pet_id',m.pet_id,'client_id',m.client_id,'consult_snapshot_id',s.id,'consult_payload_hash',s.payload_hash,'consult_observed_head_version',p_consult_observed_head_version,'consult_external_id',s.external_id);
end $$;

alter function public.stage_ezyvet_import_page(uuid,uuid,uuid,integer,boolean,jsonb) rename to stage_ezyvet_import_page_pre_vaccination;
revoke all on function public.stage_ezyvet_import_page_pre_vaccination(uuid,uuid,uuid,integer,boolean,jsonb) from public,anon,authenticated,service_role;
create function public.stage_ezyvet_import_page(p_id uuid,p_actor uuid,p_lease_id uuid,p_page integer,p_complete boolean,p_items jsonb) returns public.ezyvet_import_runs language plpgsql security definer set search_path=public,extensions as $$
declare r public.ezyvet_import_runs;c public.ezyvet_vaccination_runs;m public.ezyvet_record_links;fingerprint text;previous text;ordered_items jsonb;
begin
 -- Serialize claim and stage before either holds the run or consult head lock.
 -- This also excludes a queued consult writer from forming a three-way lock cycle.
 if exists(select 1 from public.ezyvet_import_runs where id=p_id and resource='vaccination') then
  perform pg_advisory_xact_lock(hashtextextended('vaccination-run:'||p_id::text,0));
 end if;
 select * into strict r from public.ezyvet_import_runs where id=p_id for update;
 if r.resource not in ('vaccination') then
  return public.stage_ezyvet_import_page_pre_vaccination(p_id,p_actor,p_lease_id,p_page,p_complete,p_items);
 end if;
 if public.ezyvet_is_active_admin(p_actor) is not true or r.requested_by is distinct from p_actor then raise exception 'Active import owner required' using errcode='42501';end if;
 select * into c from public.ezyvet_vaccination_runs where run_id=p_id;
 if not found then raise exception 'VACCINATION_RUN_REQUIRES_NEW_CONTEXT' using errcode='22023';end if;
 if row(c.actor_id,c.resource,c.source_origin,c.source_site_uid) is distinct from row(p_actor,r.resource,r.source_origin,r.source_site_uid) then raise exception 'Vaccination import context mismatch' using errcode='42501';end if;
 if p_complete is null or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>10 or octet_length(p_items::text)>2097152 then raise exception 'Invalid patient-scoped vaccination page' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x)<>'object' or jsonb_typeof(x->'payload') is distinct from 'object' or x->>'external_id' is null or x->>'external_id' !~ '^(0|[1-9][0-9]{0,15})$' or coalesce(jsonb_typeof(x#>'{payload,id}'),'null') not in ('number','string') or x#>>'{payload,id}' is distinct from x->>'external_id' or coalesce(jsonb_typeof(x#>'{payload,consult_id}'),'null') not in ('number','string') or x#>>'{payload,consult_id}' is distinct from c.consult_external_id) then raise exception 'Vaccination source identity mismatch' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where (x->>'external_id')::numeric>9007199254740991 or (x#>'{payload,product_id}' is not null and x#>'{payload,product_id}'<>'null'::jsonb and (jsonb_typeof(x#>'{payload,product_id}') not in ('number','string') or x#>>'{payload,product_id}' !~ '^(0|[1-9][0-9]{0,15})$'))) then raise exception 'Invalid vaccination source reference' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x#>'{payload,product_id}') in ('number','string') and (x#>>'{payload,product_id}')::numeric>9007199254740991) then raise exception 'Invalid vaccination product reference' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x cross join unnest(array['qty','date_of_administration','date_of_next_administration','vet_id','created_at','modified_at']) field where x->'payload' ? field and jsonb_typeof(x->'payload'->field) not in ('null','string','number'))
 or exists(select 1 from jsonb_array_elements(p_items) x cross join unnest(array['description','notes']) field where x->'payload' ? field and jsonb_typeof(x->'payload'->field) not in ('null','string'))
 or exists(select 1 from jsonb_array_elements(p_items) x where x->'payload' ? 'active' and jsonb_typeof(x#>'{payload,active}') not in ('null','string','number','boolean')) then raise exception 'Invalid vaccination source values' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x cross join unnest(array['qty','date_of_administration','date_of_next_administration','vet_id','created_at','modified_at']) field where case when jsonb_typeof(x->'payload'->field)='number' then abs((x->'payload'->>field)::numeric)>1.7976931348623157e308::numeric else false end) then raise exception 'Nonfinite vaccination source number' using errcode='23514';end if;
 fingerprint:=encode(digest(jsonb_build_array(p_complete,p_items)::text,'sha256'),'hex');
 select request_hash into previous from public.ezyvet_vaccination_pages where run_id=p_id and page=p_page;
 if found then
  if previous<>fingerprint then raise exception 'Committed vaccination page request changed' using errcode='40001';end if;
  return r;
 end if;
 if r.status<>'running' or p_lease_id is null or r.lease_id is null or r.lease_id<>p_lease_id or r.lease_until is null or r.lease_until<=now() or p_page is distinct from r.next_page then raise exception 'Import lease or cursor changed' using errcode='40001';end if;
 select * into m from public.ezyvet_record_links where id=c.animal_link_id for share;
 if row(m.resource,m.source_origin,m.source_site_uid,m.external_id,m.pet_id,m.client_id) is distinct from row('animal'::text,c.source_origin,c.source_site_uid,c.animal_external_id,c.pet_id,c.client_id) then raise exception 'Vaccination patient mapping changed' using errcode='40001';end if;
 perform 1 from public.pets where id=c.pet_id and client_id=c.client_id for share;
 if not found then raise exception 'Vaccination patient mapping changed' using errcode='40001';end if;
 perform public.ezyvet_validate_vaccination_consult(c.animal_link_id,c.source_origin,c.source_site_uid,c.consult_snapshot_id,c.consult_payload_hash,c.consult_observed_head_version);
 -- Existing core preserves source/resource lease, cooldown, cursor and identity-head semantics.
 select coalesce(jsonb_agg(value order by value->>'external_id'),'[]') into ordered_items from jsonb_array_elements(p_items);
 r:=public.stage_ezyvet_import_page_core(p_id,p_actor,p_lease_id,p_page,p_complete,ordered_items);
 insert into public.ezyvet_vaccination_pages(run_id,page,request_hash) values(p_id,p_page,fingerprint);
 insert into public.ezyvet_vaccination_page_observations(run_id,page,snapshot_id,head_version)
 select i.run_id,i.page,i.snapshot_id,h.version from public.ezyvet_import_page_items i join public.ezyvet_import_snapshots s on s.id=i.snapshot_id join public.ezyvet_identity_heads h using(source_origin,source_site_uid,resource,external_id) where i.run_id=p_id and i.page=p_page;
 return r;
end $$;

create function public.ezyvet_vaccination_run_projection(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',r.id,'requested_by',r.requested_by,'resource',r.resource,'source_origin',r.source_origin,'source_site_uid',r.source_site_uid,'status',r.status,'next_page',r.next_page,'retry_after',r.retry_after,'last_error_code',r.last_error_code,'created_at',r.created_at,'updated_at',r.updated_at,'lease_active',coalesce(r.lease_until>now(),false),'scope',case when c.run_id is null then 'legacy_unscoped' else 'consult_scoped' end,'animal_link_id',c.animal_link_id,'animal_external_id',c.animal_external_id,'pet_id',c.pet_id,'client_id',c.client_id,'consult_snapshot_id',c.consult_snapshot_id,'consult_payload_hash',c.consult_payload_hash,'consult_observed_head_version',c.consult_observed_head_version,'consult_external_id',c.consult_external_id)
 from public.ezyvet_import_runs r left join public.ezyvet_vaccination_runs c on c.run_id=r.id where r.id=p_id;
$$;
create function public.recover_ezyvet_vaccination_run(p_id uuid,p_animal_link_id uuid,p_consult_snapshot_id uuid,p_consult_payload_hash text,p_consult_observed_head_version integer) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r public.ezyvet_import_runs;c public.ezyvet_vaccination_runs;m public.ezyvet_record_links;
begin
 if public.ezyvet_is_active_admin(auth.uid()) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_animal_link_id is null or p_consult_snapshot_id is null or p_consult_payload_hash is null or p_consult_payload_hash !~ '^[a-f0-9]{64}$' or p_consult_observed_head_version is null or p_consult_observed_head_version<1 then raise exception 'Vaccination recovery identity required' using errcode='23514';end if;
 select * into r from public.ezyvet_import_runs where id=p_id;
 if not found then return null;end if;
 select * into m from public.ezyvet_record_links where id=p_animal_link_id and resource='animal';
 select * into c from public.ezyvet_vaccination_runs where run_id=p_id;
 if r.requested_by is distinct from auth.uid() or r.resource is distinct from 'vaccination' or row(r.source_origin,r.source_site_uid) is distinct from row(m.source_origin,m.source_site_uid) or (c.run_id is not null and row(c.animal_link_id,c.consult_snapshot_id,c.consult_payload_hash,c.consult_observed_head_version) is distinct from row(p_animal_link_id,p_consult_snapshot_id,p_consult_payload_hash,p_consult_observed_head_version)) then raise exception 'Vaccination recovery identity mismatch' using errcode='42501';end if;
 return public.ezyvet_vaccination_run_projection(p_id);
end $$;
create function public.list_ezyvet_vaccination_runs(p_animal_link_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare m public.ezyvet_record_links;items jsonb;more boolean;lastrow jsonb;
begin
 if public.ezyvet_is_active_admin(auth.uid()) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_limit is null or p_limit not between 1 and 50 or (p_before_at is null)<>(p_before_id is null) then raise exception 'Invalid vaccination run query' using errcode='23514';end if;
 select * into strict m from public.ezyvet_record_links where id=p_animal_link_id and resource='animal';
 select coalesce(jsonb_agg(public.ezyvet_vaccination_run_projection(id) order by created_at desc,id desc),'[]') into items from (
  select r.id,r.created_at from public.ezyvet_import_runs r left join public.ezyvet_vaccination_runs c on c.run_id=r.id
  where r.requested_by=auth.uid() and r.resource='vaccination' and r.source_origin=m.source_origin and r.source_site_uid=m.source_site_uid and (c.run_id is null or c.animal_link_id=m.id)
  and (p_before_at is null or (r.created_at,r.id)<(p_before_at,p_before_id)) order by r.created_at desc,r.id desc limit p_limit+1
 ) selected;
 more:=jsonb_array_length(items)>p_limit;items:=case when more then items-p_limit else items end;lastrow:=items->(jsonb_array_length(items)-1);
 return jsonb_build_object('runs',items,'has_more',more,'next_cursor',case when more then jsonb_build_object('before_at',lastrow->'created_at','before_id',lastrow->'id') else null end);
end $$;
create function public.list_ezyvet_vaccination_candidates(p_animal_link_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare m public.ezyvet_record_links;items jsonb;more boolean;lastrow jsonb;
begin
 if public.ezyvet_is_active_admin(auth.uid()) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_limit is null or p_limit not between 1 and 50 or (p_before_at is null)<>(p_before_id is null) then raise exception 'Invalid vaccination candidate query' using errcode='23514';end if;
 select * into strict m from public.ezyvet_record_links where id=p_animal_link_id and resource='animal';
 select coalesce(jsonb_agg(item order by created_at desc,id desc),'[]') into items from (
  select s.id,s.created_at,jsonb_build_object('id',s.id,'payload',s.payload,'payload_hash',s.payload_hash,'external_id',s.external_id,'resource',s.resource,'source_origin',s.source_origin,'source_site_uid',s.source_site_uid,'created_at',s.created_at,'head_version',h.version,'current_snapshot_id',h.snapshot_id,
   'is_current',h.snapshot_id=s.id and h.version=observed.head_version,'is_current_snapshot',h.snapshot_id=s.id,'observed_head_version',observed.head_version,'current_head_scoped',h.snapshot_id=s.id and h.version=observed.head_version,
   'animal_link_id',m.id,'pet_id',observed.pet_id,'client_id',observed.client_id,
   'consult_snapshot_id',observed.consult_snapshot_id,'consult_payload_hash',observed.consult_payload_hash,'consult_observed_head_version',observed.consult_observed_head_version,'consult_external_id',observed.consult_external_id,
   'consult_head_version',ch.version,'consult_current_snapshot_id',ch.snapshot_id,'consult_is_current',coalesce(ch.snapshot_id=observed.consult_snapshot_id and ch.version=observed.consult_observed_head_version,false),
   'eligible_for_review',coalesce(h.snapshot_id=s.id and h.version=observed.head_version and ch.snapshot_id=observed.consult_snapshot_id and ch.version=observed.consult_observed_head_version and exists(select 1 from public.pets p where p.id=observed.pet_id and p.client_id=observed.client_id),false)) item
  from public.ezyvet_import_snapshots s join public.ezyvet_identity_heads h using(source_origin,source_site_uid,resource,external_id)
  join lateral (
   select o.head_version,c.* from public.ezyvet_vaccination_page_observations o join public.ezyvet_vaccination_runs c on c.run_id=o.run_id join public.ezyvet_vaccination_pages vp on vp.run_id=o.run_id and vp.page=o.page
   where o.snapshot_id=s.id and c.animal_link_id=m.id and row(c.resource,c.source_origin,c.source_site_uid,c.animal_external_id)=row(s.resource,s.source_origin,s.source_site_uid,m.external_id)
   order by o.head_version desc,c.consult_observed_head_version desc,vp.created_at desc,o.run_id desc,o.page desc limit 1
  ) observed on true
  left join public.ezyvet_identity_heads ch on ch.source_origin=s.source_origin and ch.source_site_uid=s.source_site_uid and ch.resource='consult' and ch.external_id=observed.consult_external_id
  where s.resource='vaccination' and s.source_origin=m.source_origin and s.source_site_uid=m.source_site_uid
  and (p_before_at is null or (s.created_at,s.id)<(p_before_at,p_before_id)) order by s.created_at desc,s.id desc limit p_limit+1
 ) selected;
 more:=jsonb_array_length(items)>p_limit;items:=case when more then items-p_limit else items end;lastrow:=items->(jsonb_array_length(items)-1);
 return jsonb_build_object('animal_link_id',m.id,'resource','vaccination','candidates',items,'has_more',more,'next_cursor',case when more then jsonb_build_object('before_at',lastrow->'created_at','before_id',lastrow->'id') else null end);
end $$;
do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in ('claim_ezyvet_import','claim_ezyvet_vaccination_import','stage_ezyvet_import_page','ezyvet_vaccination_run_projection','recover_ezyvet_vaccination_run','list_ezyvet_vaccination_runs','list_ezyvet_vaccination_candidates') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in ('claim_ezyvet_import','claim_ezyvet_vaccination_import','stage_ezyvet_import_page') then execute format('grant execute on function %s to service_role',f.signature);
  elsif f.proname<>'ezyvet_vaccination_run_projection' then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
