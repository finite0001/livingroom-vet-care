-- API attachment metadata only. Downloads, approval and delivery remain separate.
alter table public.ezyvet_import_runs drop constraint ezyvet_import_runs_resource_check;
alter table public.ezyvet_import_runs add constraint ezyvet_import_runs_resource_check check(resource in ('contact','contactdetail','address','animal','species','breed','sex','animalcolour','appointment','consult','history','vaccination','diagnostic','healthstatus','prescription','prescriptionitem','attachment'));
create function public.ezyvet_attachment_parent_context(p_animal_link_id uuid,p_origin text,p_site text,p_parent_type text,p_snapshot_id uuid,p_hash text,p_version integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare m public.ezyvet_record_links;s public.ezyvet_import_snapshots;h public.ezyvet_identity_heads;
begin
 if p_parent_type is null or p_parent_type not in ('Animal','Consult') or p_snapshot_id is null or p_hash is null or p_version is null or p_version<1 then raise exception 'Supported exact attachment parent required' using errcode='23514';end if;
 select * into m from public.ezyvet_record_links where id=p_animal_link_id and resource='animal' and source_origin=p_origin and source_site_uid=p_site for share;
 if not found then raise exception 'Reviewed patient mapping required' using errcode='42501';end if;
 perform 1 from public.pets where id=m.pet_id and client_id=m.client_id for share;
 if not found then raise exception 'Attachment patient membership changed' using errcode='40001';end if;
 if p_parent_type='Consult' then
  s:=public.ezyvet_validate_vaccination_consult(m.id,p_origin,p_site,p_snapshot_id,p_hash,p_version);
 else
  select * into s from public.ezyvet_import_snapshots where id=p_snapshot_id;
  if s.id is null or row(s.source_origin,s.source_site_uid,s.resource,s.external_id,s.payload_hash,s.payload->>'id') is distinct from row(p_origin,p_site,'animal'::text,m.external_id,p_hash,m.external_id) then raise exception 'Attachment animal parent mismatch' using errcode='42501';end if;
  select * into h from public.ezyvet_identity_heads where source_origin=p_origin and source_site_uid=p_site and resource='animal' and external_id=m.external_id for share;
  if h.snapshot_id is distinct from s.id or h.version is distinct from p_version then raise exception 'SOURCE_ATTACHMENT_PARENT_STALE' using errcode='40001';end if;
 end if;
 if s.external_id !~ '^(0|[1-9][0-9]{0,15})$' or s.external_id::numeric>9007199254740991 then raise exception 'Invalid attachment parent ID' using errcode='23514';end if;
 return jsonb_build_object('animal_link_id',m.id,'pet_id',m.pet_id,'client_id',m.client_id,'animal_external_id',m.external_id,'source_origin',p_origin,'source_site_uid',p_site,'parent_type',p_parent_type,'parent_external_id',s.external_id,'parent_snapshot_id',s.id,'parent_payload_hash',s.payload_hash,'parent_observed_head_version',p_version);
end $$;
create table public.ezyvet_attachment_runs (
 run_id uuid primary key references public.ezyvet_import_runs(id),actor_id uuid not null references public.profiles(id),
 animal_link_id uuid not null references public.ezyvet_record_links(id),pet_id uuid not null references public.pets(id),
 parent_context jsonb not null check(jsonb_typeof(parent_context)='object'),created_at timestamptz not null default now()
);
create table public.ezyvet_attachment_pages (
 run_id uuid not null references public.ezyvet_attachment_runs(run_id),page integer not null,
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),created_at timestamptz not null default now(),
 primary key(run_id,page),foreign key(run_id,page) references public.ezyvet_import_pages(run_id,page)
);
create table public.ezyvet_attachment_page_observations (
 run_id uuid not null,page integer not null,snapshot_id uuid not null references public.ezyvet_import_snapshots(id),head_version integer not null check(head_version>0),
 primary key(run_id,page,snapshot_id),foreign key(run_id,page) references public.ezyvet_attachment_pages(run_id,page),
 foreign key(run_id,page,snapshot_id) references public.ezyvet_import_page_items(run_id,page,snapshot_id)
);
create index ezyvet_attachment_runs_owner on public.ezyvet_attachment_runs(actor_id,animal_link_id,created_at desc,run_id desc);
create index ezyvet_attachment_observation_snapshot on public.ezyvet_attachment_page_observations(snapshot_id,head_version desc);
do $$declare t text;begin foreach t in array array['ezyvet_attachment_runs','ezyvet_attachment_pages','ezyvet_attachment_page_observations'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger immutable_attachment_intake before update or delete on public.%I for each row execute function public.guard_inquiry_history()',t);
end loop;end $$;
create or replace function public.claim_ezyvet_import(p_id uuid,p_actor uuid,p_site_uid text,p_resource text,p_source_origin text) returns public.ezyvet_import_runs language plpgsql security definer set search_path=public as $$begin
 if p_resource in ('healthstatus','diagnostic','consult','history','vaccination','prescription','prescriptionitem','attachment') then raise exception 'Resource requires a supported patient-scoped contract' using errcode='23514';end if;
 return public.claim_ezyvet_import_core(p_id,p_actor,p_site_uid,p_resource,p_source_origin);
end $$;
create function public.claim_ezyvet_attachment_import(p_id uuid,p_actor uuid,p_site_uid text,p_source_origin text,p_animal_link_id uuid,p_parent_type text,p_parent_snapshot_id uuid,p_parent_payload_hash text,p_parent_observed_head_version integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.ezyvet_attachment_runs;r public.ezyvet_import_runs;context jsonb;
begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null then raise exception 'Owned attachment operation required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('attachment-run:'||p_id::text,0));
 select * into c from public.ezyvet_attachment_runs where run_id=p_id;
 select * into r from public.ezyvet_import_runs where id=p_id;
 if c.run_id is not null then
  if row(c.actor_id,c.animal_link_id,r.resource,r.source_origin,r.source_site_uid,c.parent_context->>'parent_type',c.parent_context->>'parent_snapshot_id',c.parent_context->>'parent_payload_hash',c.parent_context->>'parent_observed_head_version') is distinct from row(p_actor,p_animal_link_id,'attachment'::text,p_source_origin,p_site_uid,p_parent_type,p_parent_snapshot_id::text,p_parent_payload_hash,p_parent_observed_head_version::text) then raise exception 'Attachment operation identity changed' using errcode='42501';end if;
  if r.status<>'running' then return to_jsonb(r)||jsonb_build_object('scope','parent_scoped','parent_context',c.parent_context);end if;
 elsif r.id is not null then raise exception 'ATTACHMENT_RUN_REQUIRES_NEW_CONTEXT' using errcode='22023';end if;
 context:=public.ezyvet_attachment_parent_context(p_animal_link_id,p_source_origin,p_site_uid,p_parent_type,p_parent_snapshot_id,p_parent_payload_hash,p_parent_observed_head_version);
 if c.run_id is not null and c.parent_context is distinct from context then raise exception 'Attachment parent context changed' using errcode='40001';end if;
 r:=public.claim_ezyvet_import_core(p_id,p_actor,p_site_uid,'attachment',p_source_origin);
 insert into public.ezyvet_attachment_runs(run_id,actor_id,animal_link_id,pet_id,parent_context) values(p_id,p_actor,p_animal_link_id,(context->>'pet_id')::uuid,context) on conflict(run_id) do nothing;
 return to_jsonb(r)||jsonb_build_object('scope','parent_scoped','parent_context',context);
end $$;
alter function public.stage_ezyvet_import_page(uuid,uuid,uuid,integer,boolean,jsonb) rename to stage_ezyvet_import_page_pre_attachment;
revoke all on function public.stage_ezyvet_import_page_pre_attachment(uuid,uuid,uuid,integer,boolean,jsonb) from public,anon,authenticated,service_role;
create function public.stage_ezyvet_import_page(p_id uuid,p_actor uuid,p_lease_id uuid,p_page integer,p_complete boolean,p_items jsonb) returns public.ezyvet_import_runs language plpgsql security definer set search_path=public,extensions as $$
declare r public.ezyvet_import_runs;c public.ezyvet_attachment_runs;context jsonb;fingerprint text;previous text;ordered_items jsonb;
begin
 select * into strict r from public.ezyvet_import_runs where id=p_id;
 if r.resource<>'attachment' then return public.stage_ezyvet_import_page_pre_attachment(p_id,p_actor,p_lease_id,p_page,p_complete,p_items);end if;
 perform pg_advisory_xact_lock(hashtextextended('attachment-run:'||p_id::text,0));
 select * into strict r from public.ezyvet_import_runs where id=p_id for update;
 if public.ezyvet_is_active_admin(p_actor) is not true or r.requested_by is distinct from p_actor then raise exception 'Active import owner required' using errcode='42501';end if;
 select * into c from public.ezyvet_attachment_runs where run_id=p_id;
 if c.run_id is null then raise exception 'ATTACHMENT_RUN_REQUIRES_NEW_CONTEXT' using errcode='22023';end if;
 if p_complete is null or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>10 or octet_length(p_items::text)>2097152 then raise exception 'Invalid attachment page' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x)<>'object' or jsonb_typeof(x->'payload') is distinct from 'object' or x->>'external_id' is null or x->>'external_id' !~ '^(0|[1-9][0-9]{0,15})$' or x#>>'{payload,id}' is distinct from x->>'external_id' or jsonb_typeof(x#>'{payload,id}') not in ('string','number') or x#>>'{payload,record_type}' is distinct from c.parent_context->>'parent_type' or x#>>'{payload,record_id}' is distinct from c.parent_context->>'parent_external_id' or jsonb_typeof(x#>'{payload,record_id}') not in ('string','number')) then raise exception 'Attachment source parent mismatch' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where (x->>'external_id')::numeric>9007199254740991) or (select count(*)<>count(distinct x->>'external_id') from jsonb_array_elements(p_items) x) then raise exception 'Invalid or duplicate attachment identity' using errcode='23514';end if;
 -- Retain unsupported MIME/URLs as metadata for later discrepancy review; never fetch them here.
 fingerprint:=encode(digest(jsonb_build_array(p_complete,p_items)::text,'sha256'),'hex');
 select request_hash into previous from public.ezyvet_attachment_pages where run_id=p_id and page=p_page;
 if found then if previous<>fingerprint then raise exception 'Committed attachment page changed' using errcode='40001';end if;return r;end if;
 if r.status<>'running' or p_lease_id is null or r.lease_id is distinct from p_lease_id or r.lease_until is null or r.lease_until<=now() or p_page is distinct from r.next_page then raise exception 'Attachment lease or cursor changed' using errcode='40001';end if;
 context:=public.ezyvet_attachment_parent_context(c.animal_link_id,r.source_origin,r.source_site_uid,c.parent_context->>'parent_type',(c.parent_context->>'parent_snapshot_id')::uuid,c.parent_context->>'parent_payload_hash',(c.parent_context->>'parent_observed_head_version')::integer);
 if context is distinct from c.parent_context then raise exception 'Attachment parent context changed' using errcode='40001';end if;
 select coalesce(jsonb_agg(value order by value->>'external_id'),'[]') into ordered_items from jsonb_array_elements(p_items);
 r:=public.stage_ezyvet_import_page_core(p_id,p_actor,p_lease_id,p_page,p_complete,ordered_items);
 insert into public.ezyvet_attachment_pages(run_id,page,request_hash) values(p_id,p_page,fingerprint);
 insert into public.ezyvet_attachment_page_observations(run_id,page,snapshot_id,head_version)
 select i.run_id,i.page,i.snapshot_id,h.version from public.ezyvet_import_page_items i join public.ezyvet_import_snapshots s on s.id=i.snapshot_id join public.ezyvet_identity_heads h using(source_origin,source_site_uid,resource,external_id) where i.run_id=p_id and i.page=p_page;
 return r;
end $$;
create function public.ezyvet_attachment_run_projection(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',r.id,'requested_by',r.requested_by,'resource',r.resource,'source_origin',r.source_origin,'source_site_uid',r.source_site_uid,'status',r.status,'next_page',r.next_page,'retry_after',r.retry_after,'last_error_code',r.last_error_code,'created_at',r.created_at,'updated_at',r.updated_at,'lease_active',coalesce(r.lease_until>now(),false),'scope','parent_scoped','parent_context',c.parent_context)
 from public.ezyvet_import_runs r join public.ezyvet_attachment_runs c on c.run_id=r.id where r.id=p_id;
$$;
create function public.recover_ezyvet_attachment_run(p_id uuid,p_animal_link_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare c public.ezyvet_attachment_runs;begin
 if public.ezyvet_is_active_admin(auth.uid()) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_animal_link_id is null then raise exception 'Exact attachment recovery identity required' using errcode='23514';end if;
 select * into c from public.ezyvet_attachment_runs where run_id=p_id;
 if not found then return null;end if;
 if c.actor_id is distinct from auth.uid() or c.animal_link_id is distinct from p_animal_link_id then raise exception 'Attachment recovery identity mismatch' using errcode='42501';end if;
 return public.ezyvet_attachment_run_projection(p_id);
end $$;
create function public.list_ezyvet_attachment_runs(p_animal_link_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare items jsonb;more boolean;lastrow jsonb;begin
 if public.ezyvet_is_active_admin(auth.uid()) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_animal_link_id is null or p_limit is null or p_limit not between 1 and 50 or (p_before_at is null)<>(p_before_id is null) then raise exception 'Invalid attachment discovery query' using errcode='23514';end if;
 select coalesce(jsonb_agg(public.ezyvet_attachment_run_projection(run_id) order by created_at desc,run_id desc),'[]') into items from (select run_id,created_at from public.ezyvet_attachment_runs where actor_id=auth.uid() and animal_link_id=p_animal_link_id and (p_before_at is null or (created_at,run_id)<(p_before_at,p_before_id)) order by created_at desc,run_id desc limit p_limit+1) selected;
 more:=jsonb_array_length(items)>p_limit;items:=case when more then items-p_limit else items end;lastrow:=items->(jsonb_array_length(items)-1);
 return jsonb_build_object('runs',items,'has_more',more,'next_cursor',case when more then jsonb_build_object('before_at',lastrow->'created_at','before_id',lastrow->'id') else null end);
end $$;
do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in('ezyvet_attachment_parent_context','claim_ezyvet_attachment_import','ezyvet_attachment_run_projection','recover_ezyvet_attachment_run','list_ezyvet_attachment_runs','claim_ezyvet_import','stage_ezyvet_import_page') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in('claim_ezyvet_import','claim_ezyvet_attachment_import','stage_ezyvet_import_page') then execute format('grant execute on function %s to service_role',f.signature);
  elsif f.proname in('recover_ezyvet_attachment_run','list_ezyvet_attachment_runs') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
