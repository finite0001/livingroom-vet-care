-- Animal-scoped, sanitized metadata only. No download, clinical promotion or delivery.
alter table public.ezyvet_import_runs drop constraint ezyvet_import_runs_resource_check;
alter table public.ezyvet_import_runs add constraint ezyvet_import_runs_resource_check check(resource in ('contact','contactdetail','address','animal','species','breed','sex','animalcolour','appointment','consult','history','vaccination','diagnostic','healthstatus','prescription','prescriptionitem','attachment'));
create table public.ezyvet_attachment_runs (
 run_id uuid primary key references public.ezyvet_import_runs(id),
 actor_id uuid not null references public.profiles(id),
 animal_link_id uuid not null references public.ezyvet_record_links(id),
 pet_id uuid not null references public.pets(id),
 parent_context jsonb not null check(jsonb_typeof(parent_context)='object'),
 created_at timestamptz not null default clock_timestamp()
);
create table public.ezyvet_attachment_pages (
 run_id uuid not null references public.ezyvet_attachment_runs(run_id),page integer not null,
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 page_sha256 text not null check(page_sha256 ~ '^[a-f0-9]{64}$'),
 pagination jsonb not null,complete boolean not null,
 observed_count integer not null check(observed_count between 0 and 10),
 staged_count integer not null check(staged_count between 0 and observed_count),
 created_at timestamptz not null default clock_timestamp(),
 primary key(run_id,page),foreign key(run_id,page) references public.ezyvet_import_pages(run_id,page)
);
create table public.ezyvet_attachment_page_observations (
 run_id uuid not null,page integer not null,ordinal integer not null check(ordinal between 1 and 10),
 external_id text not null,file_id text not null,
 snapshot_id uuid not null references public.ezyvet_import_snapshots(id),head_version integer not null check(head_version>0),
 raw_record_sha256 text not null check(raw_record_sha256 ~ '^[a-f0-9]{64}$'),
 stable_metadata_sha256 text not null check(stable_metadata_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(),
 primary key(run_id,page,ordinal),foreign key(run_id,page) references public.ezyvet_attachment_pages(run_id,page),
 foreign key(run_id,page,snapshot_id) references public.ezyvet_import_page_items(run_id,page,snapshot_id)
);
create index ezyvet_attachment_runs_owner on public.ezyvet_attachment_runs(actor_id,animal_link_id,created_at desc,run_id desc);
do $$declare t text;begin foreach t in array array['ezyvet_attachment_runs','ezyvet_attachment_pages','ezyvet_attachment_page_observations'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger immutable_attachment_metadata before update or delete on public.%I for each row execute function public.guard_inquiry_history()',t);
end loop;end $$;

create function public.ezyvet_attachment_parent_context(p_animal_link_id uuid,p_origin text,p_site text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare m public.ezyvet_record_links;s public.ezyvet_import_snapshots;h public.ezyvet_identity_heads;
begin
 select * into m from public.ezyvet_record_links where id=p_animal_link_id and resource='animal' and source_origin=p_origin and source_site_uid=p_site for share;
 if not found then raise exception 'Reviewed patient mapping required' using errcode='42501';end if;
 perform 1 from public.pets where id=m.pet_id and client_id=m.client_id for share;
 if not found then raise exception 'SOURCE_ATTACHMENT_PARENT_STALE' using errcode='40001';end if;
 select * into h from public.ezyvet_identity_heads where source_origin=p_origin and source_site_uid=p_site and resource='animal' and external_id=m.external_id for share;
 select * into s from public.ezyvet_import_snapshots where id=h.snapshot_id;
 if s.id is null or row(s.source_origin,s.source_site_uid,s.resource,s.external_id,s.payload->>'id') is distinct from row(p_origin,p_site,'animal'::text,m.external_id,m.external_id)
  or m.external_id !~ '^(0|[1-9][0-9]{0,15})$' then raise exception 'Current exact animal parent required' using errcode='23514';end if;
 if m.external_id::numeric>9007199254740991 then raise exception 'Invalid attachment animal ID' using errcode='23514';end if;
 return jsonb_build_object('animal_link_id',m.id,'pet_id',m.pet_id,'client_id',m.client_id,'animal_external_id',m.external_id,'source_origin',p_origin,'source_site_uid',p_site,'parent_type','Animal','parent_external_id',s.external_id,'parent_snapshot_id',s.id,'parent_payload_hash',s.payload_hash,'parent_observed_head_version',h.version);
end $$;
create or replace function public.claim_ezyvet_import(p_id uuid,p_actor uuid,p_site_uid text,p_resource text,p_source_origin text) returns public.ezyvet_import_runs language plpgsql security definer set search_path=public as $$begin
 if p_resource in ('healthstatus','diagnostic','consult','history','vaccination','prescription','prescriptionitem','attachment') then raise exception 'Resource requires a supported patient-scoped contract' using errcode='23514';end if;
 return public.claim_ezyvet_import_core(p_id,p_actor,p_site_uid,p_resource,p_source_origin);
end $$;
create function public.claim_ezyvet_attachment_import(p_id uuid,p_actor uuid,p_site_uid text,p_source_origin text,p_animal_link_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c public.ezyvet_attachment_runs;r public.ezyvet_import_runs;context jsonb;
begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_animal_link_id is null or p_source_origin is null or p_site_uid is null then raise exception 'Exact attachment operation required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('attachment-run:'||p_id::text,0));
 select * into c from public.ezyvet_attachment_runs where run_id=p_id;
 select * into r from public.ezyvet_import_runs where id=p_id;
 if c.run_id is not null then
  if row(c.actor_id,c.animal_link_id,r.requested_by,r.resource,r.source_origin,r.source_site_uid) is distinct from row(p_actor,p_animal_link_id,p_actor,'attachment'::text,p_source_origin,p_site_uid) then raise exception 'Attachment operation identity changed' using errcode='42501';end if;
  if r.status<>'running' then return to_jsonb(r)||jsonb_build_object('scope','animal_attachment_metadata','parent_context',c.parent_context,'animal_link_id',c.animal_link_id,'animal_external_id',c.parent_context->'animal_external_id','pet_id',c.pet_id,'client_id',c.parent_context->'client_id');end if;
 elsif r.id is not null then raise exception 'ATTACHMENT_RUN_REQUIRES_NEW_CONTEXT' using errcode='22023';end if;
 context:=public.ezyvet_attachment_parent_context(p_animal_link_id,p_source_origin,p_site_uid);
 if c.run_id is not null and c.parent_context is distinct from context then raise exception 'SOURCE_ATTACHMENT_PARENT_STALE' using errcode='40001';end if;
 r:=public.claim_ezyvet_import_core(p_id,p_actor,p_site_uid,'attachment',p_source_origin);
 -- Core uses transaction time. A claim delayed by locks must not hand out an expired lease.
 if r.lease_until<=clock_timestamp() then raise exception 'Attachment lease expired during claim' using errcode='40001';end if;
 insert into public.ezyvet_attachment_runs(run_id,actor_id,animal_link_id,pet_id,parent_context) values(p_id,p_actor,p_animal_link_id,(context->>'pet_id')::uuid,context) on conflict(run_id) do nothing;
 return to_jsonb(r)||jsonb_build_object('scope','animal_attachment_metadata','parent_context',context,'animal_link_id',p_animal_link_id,'animal_external_id',context->'animal_external_id','pet_id',context->'pet_id','client_id',context->'client_id');
end $$;

-- Validate the service parser's safe projection independently before any cast or write.
create function public.ezyvet_attachment_validate_page(p_page jsonb,p_parent_id text) returns void
language plpgsql set search_path=public as $$
declare x jsonb;m jsonb;k text;pg jsonb;n integer;page_no numeric;page_total numeric;page_size numeric;item_total numeric;expected numeric;empty_page boolean;
begin
 if p_page is null or jsonb_typeof(p_page) is distinct from 'object' or octet_length(p_page::text)>262144
  or not(p_page ?& array['contract_version','parent','page','complete','pagination','observations','page_sha256'])
  or p_page-array['contract_version','parent','page','complete','pagination','observations','page_sha256']<>'{}'
  or p_page->>'contract_version' is distinct from 'ezyvet_animal_attachment_metadata_v1'
  or p_page->'parent' is distinct from jsonb_build_object('record_type','Animal','record_id',p_parent_id)
  or jsonb_typeof(p_page->'complete') is distinct from 'boolean'
  or jsonb_typeof(p_page->'observations') is distinct from 'array'
  or jsonb_typeof(p_page->'page_sha256') is distinct from 'string' or p_page->>'page_sha256' !~ '^[a-f0-9]{64}$'
  or jsonb_typeof(p_page->'page') is distinct from 'number' or p_page->>'page' !~ '^[0-9]+$' then raise exception 'Invalid attachment metadata page' using errcode='23514';end if;
 page_no:=(p_page->>'page')::numeric;pg:=p_page->'pagination';n:=jsonb_array_length(p_page->'observations');
 if page_no not between 1 and 1000 or n>10 or jsonb_typeof(pg) is distinct from 'object'
  or not(pg ?& array['items_page','items_page_total','items_page_size','items_total'])
  or pg-array['items_page','items_page_total','items_page_size','items_total']<>'{}' then raise exception 'Invalid attachment pagination' using errcode='23514';end if;
 foreach k in array array['items_page','items_page_total','items_page_size','items_total'] loop
  if jsonb_typeof(pg->k) is distinct from 'number' or pg->>k !~ '^[0-9]+$' then raise exception 'Invalid attachment pagination' using errcode='23514';end if;
  if (pg->>k)::numeric>9007199254740991 then raise exception 'Invalid attachment pagination' using errcode='23514';end if;
 end loop;
 page_total:=(pg->>'items_page_total')::numeric;page_size:=(pg->>'items_page_size')::numeric;item_total:=(pg->>'items_total')::numeric;
 if (pg->>'items_page')::numeric<>page_no or page_size not between 1 and 10 then raise exception 'Invalid attachment pagination' using errcode='23514';end if;
 empty_page:=item_total=0 and page_no=1 and n=0;expected:=ceil(item_total/page_size);
 if (empty_page and page_total not in(0,1)) or (not empty_page and (page_total<>expected or page_no>expected))
  or n<>(case when empty_page then 0 else least(page_size,item_total-(page_no-1)*page_size) end)
  or (p_page->>'complete')::boolean is distinct from (empty_page or page_no=expected) then raise exception 'Invalid attachment pagination' using errcode='23514';end if;
 for x in select value from jsonb_array_elements(p_page->'observations') loop
  if jsonb_typeof(x) is distinct from 'object' or not(x ?& array['external_id','file_id','metadata','raw_record_sha256','stable_metadata_sha256','file_sha256'])
   or x-array['external_id','file_id','metadata','raw_record_sha256','stable_metadata_sha256','file_sha256']<>'{}'
   or x->'file_sha256' is distinct from 'null'::jsonb then raise exception 'Invalid attachment observation' using errcode='23514';end if;
  foreach k in array array['external_id','file_id'] loop
   if jsonb_typeof(x->k) is distinct from 'string' or x->>k !~ '^(0|[1-9][0-9]{0,15})$' then raise exception 'Invalid attachment identity' using errcode='23514';end if;
   if (x->>k)::numeric>9007199254740991 then raise exception 'Invalid attachment identity' using errcode='23514';end if;
  end loop;
  foreach k in array array['raw_record_sha256','stable_metadata_sha256'] loop
   if jsonb_typeof(x->k) is distinct from 'string' or x->>k !~ '^[a-f0-9]{64}$' then raise exception 'Invalid attachment digest' using errcode='23514';end if;
  end loop;
  m:=x->'metadata';
  if jsonb_typeof(m) is distinct from 'object' or not(m ?& array['id','file_id','record_type','record_id'])
   or m-array['id','file_id','record_type','record_id','active','created_at','modified_at','mime_type','name','primary_image','notes']<>'{}'
   or m->'id' is distinct from x->'external_id' or m->'file_id' is distinct from x->'file_id'
   or m->'record_type' is distinct from '"Animal"'::jsonb or m->'record_id' is distinct from to_jsonb(p_parent_id)
   or octet_length(m::text)>32768 then raise exception 'Invalid safe attachment metadata' using errcode='23514';end if;
  foreach k in array array['active','created_at','modified_at','mime_type','name','primary_image','notes'] loop
   if not(m ? k) then continue;end if;
   if jsonb_typeof(m->k) not in ('null','string') and not(k in('active','primary_image') and jsonb_typeof(m->k)='boolean')
    and not(k in('active','created_at','modified_at','primary_image') and jsonb_typeof(m->k)='number') then raise exception 'Invalid safe attachment scalar' using errcode='23514';end if;
   if jsonb_typeof(m->k)='number' and abs((m->>k)::numeric)>1.7976931348623157e308::numeric then raise exception 'Invalid finite attachment scalar' using errcode='23514';end if;
   if jsonb_typeof(m->k)='string' and octet_length(m->>k)>(case when k='notes' then 16384 else 1024 end) then raise exception 'Attachment metadata too large' using errcode='23514';end if;
  end loop;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_page->'observations') duplicate_observation group by duplicate_observation->>'external_id' having count(distinct duplicate_observation->'metadata')>1 or count(distinct duplicate_observation->>'stable_metadata_sha256')>1) then raise exception 'Conflicting duplicate attachment metadata' using errcode='23514';end if;
end $$;

alter function public.stage_ezyvet_import_page(uuid,uuid,uuid,integer,boolean,jsonb) rename to stage_ezyvet_import_page_pre_attachment;
revoke all on function public.stage_ezyvet_import_page_pre_attachment(uuid,uuid,uuid,integer,boolean,jsonb) from public,anon,authenticated,service_role;
create function public.stage_ezyvet_import_page(p_id uuid,p_actor uuid,p_lease_id uuid,p_page integer,p_complete boolean,p_items jsonb) returns public.ezyvet_import_runs language plpgsql security definer set search_path=public as $$begin
 if exists(select 1 from public.ezyvet_import_runs where id=p_id and resource='attachment') then raise exception 'Attachment metadata requires its dedicated stage contract' using errcode='23514';end if;
 return public.stage_ezyvet_import_page_pre_attachment(p_id,p_actor,p_lease_id,p_page,p_complete,p_items);
end $$;
create function public.stage_ezyvet_attachment_page(p_run_id uuid,p_actor uuid,p_lease_id uuid,p_page jsonb) returns public.ezyvet_import_runs
language plpgsql security definer set search_path=public,extensions as $$
declare r public.ezyvet_import_runs;c public.ezyvet_attachment_runs;context jsonb;fingerprint text;previous text;items jsonb;page_no integer;rowrecord record;
begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('attachment-run:'||p_run_id::text,0));
 select * into r from public.ezyvet_import_runs where id=p_run_id for update;
 select * into c from public.ezyvet_attachment_runs where run_id=p_run_id;
 if c.run_id is null or row(r.requested_by,r.resource,c.actor_id) is distinct from row(p_actor,'attachment'::text,p_actor) then raise exception 'Owned attachment run required' using errcode='42501';end if;
 perform public.ezyvet_attachment_validate_page(p_page,c.parent_context->>'animal_external_id');
 page_no:=(p_page->>'page')::integer;fingerprint:=encode(digest(p_page::text,'sha256'),'hex');
 select request_hash into previous from public.ezyvet_attachment_pages where run_id=p_run_id and page=page_no;
 if found then if previous<>fingerprint then raise exception 'Committed attachment page changed' using errcode='40001';end if;return r;end if;
 if r.status<>'running' or p_lease_id is null or r.lease_id is distinct from p_lease_id or r.lease_until is null or r.lease_until<=clock_timestamp() or page_no is distinct from r.next_page then raise exception 'Attachment lease or cursor changed' using errcode='40001';end if;
 context:=public.ezyvet_attachment_parent_context(c.animal_link_id,r.source_origin,r.source_site_uid);
 if context is distinct from c.parent_context then raise exception 'SOURCE_ATTACHMENT_PARENT_STALE' using errcode='40001';end if;
 -- Serialize fresh attachment stages with competing source claims before head locks.
 perform pg_advisory_xact_lock(hashtextextended(r.source_origin||':'||r.source_site_uid||':attachment',0));
 for rowrecord in select distinct value->>'external_id' external_id from jsonb_array_elements(p_page->'observations') order by 1 loop
  perform 1 from public.ezyvet_identity_heads where source_origin=r.source_origin and source_site_uid=r.source_site_uid and resource='attachment' and external_id=rowrecord.external_id for update;
 end loop;
 if r.lease_until<=clock_timestamp() then raise exception 'Attachment lease expired during source lock wait' using errcode='40001';end if;
 select coalesce(jsonb_agg(jsonb_build_object('external_id',external_id,'payload',metadata||jsonb_build_object('representation','sanitized_attachment_metadata_v1')) order by external_id),'[]') into items
 from(select distinct value->>'external_id' external_id,value->'metadata' metadata from jsonb_array_elements(p_page->'observations')) s;
 r:=public.stage_ezyvet_import_page_core(p_run_id,p_actor,p_lease_id,page_no,(p_page->>'complete')::boolean,items);
 insert into public.ezyvet_attachment_pages(run_id,page,request_hash,page_sha256,pagination,complete,observed_count,staged_count)
 values(p_run_id,page_no,fingerprint,p_page->>'page_sha256',p_page->'pagination',(p_page->>'complete')::boolean,jsonb_array_length(p_page->'observations'),jsonb_array_length(items));
 insert into public.ezyvet_attachment_page_observations(run_id,page,ordinal,external_id,file_id,snapshot_id,head_version,raw_record_sha256,stable_metadata_sha256)
 select p_run_id,page_no,x.ordinality::integer,x.value->>'external_id',x.value->>'file_id',s.id,h.version,x.value->>'raw_record_sha256',x.value->>'stable_metadata_sha256'
 from jsonb_array_elements(p_page->'observations') with ordinality x
 join public.ezyvet_import_page_items i on i.run_id=p_run_id and i.page=page_no
 join public.ezyvet_import_snapshots s on s.id=i.snapshot_id and s.external_id=x.value->>'external_id'
 join public.ezyvet_identity_heads h on h.source_origin=s.source_origin and h.source_site_uid=s.source_site_uid and h.resource=s.resource and h.external_id=s.external_id;
 return r;
end $$;

create function public.ezyvet_attachment_run_projection(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',r.id,'requested_by',r.requested_by,'resource',r.resource,'source_origin',r.source_origin,'source_site_uid',r.source_site_uid,'status',r.status,'next_page',r.next_page,'retry_after',r.retry_after,'last_error_code',r.last_error_code,'created_at',r.created_at,'updated_at',r.updated_at,'lease_active',coalesce(r.lease_until>now(),false),'scope','animal_attachment_metadata','parent_context',c.parent_context,'observed_count',(select coalesce(sum(observed_count),0) from public.ezyvet_attachment_pages where run_id=r.id),'staged_count',(select count(distinct snapshot_id) from public.ezyvet_attachment_page_observations where run_id=r.id),'capture_available',false)
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
 if p_animal_link_id is null or p_limit is null or p_limit not between 1 and 50 or (p_before_at is null)<>(p_before_id is null) or (p_before_at is not null and not isfinite(p_before_at)) then raise exception 'Invalid attachment discovery query' using errcode='23514';end if;
 select coalesce(jsonb_agg(public.ezyvet_attachment_run_projection(run_id) order by created_at desc,run_id desc),'[]') into items from(select r.run_id,g.created_at from public.ezyvet_attachment_runs r join public.ezyvet_import_runs g on g.id=r.run_id where r.actor_id=auth.uid() and r.animal_link_id=p_animal_link_id and(p_before_at is null or(g.created_at,r.run_id)<(p_before_at,p_before_id)) order by g.created_at desc,r.run_id desc limit p_limit+1) selected;
 more:=jsonb_array_length(items)>p_limit;if more then items:=items-p_limit;end if;lastrow:=items->(jsonb_array_length(items)-1);
 return jsonb_build_object('runs',items,'has_more',more,'next_cursor',case when more then jsonb_build_object('before_at',lastrow->'created_at','before_id',lastrow->'id') else null end);
end $$;
create function public.list_ezyvet_attachment_observations(p_run_id uuid,p_animal_link_id uuid,p_after_page integer default null,p_after_ordinal integer default null,p_limit integer default 20) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare c public.ezyvet_attachment_runs;items jsonb;more boolean;lastrow jsonb;parent_current boolean;begin
 if public.ezyvet_is_active_admin(auth.uid()) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_run_id is null or p_animal_link_id is null or p_limit is null or p_limit not between 1 and 50 or(p_after_page is null)<>(p_after_ordinal is null) or p_after_page not between 1 and 1000 or p_after_ordinal not between 1 and 10 then raise exception 'Invalid attachment observation cursor' using errcode='23514';end if;
 select * into c from public.ezyvet_attachment_runs where run_id=p_run_id;
 if c.run_id is null or row(c.actor_id,c.animal_link_id) is distinct from row(auth.uid(),p_animal_link_id) then raise exception 'Attachment observation owner mismatch' using errcode='42501';end if;
 select exists(select 1 from public.ezyvet_record_links m join public.pets p on p.id=m.pet_id and p.client_id=m.client_id join public.ezyvet_identity_heads h on h.source_origin=m.source_origin and h.source_site_uid=m.source_site_uid and h.resource='animal' and h.external_id=m.external_id
 where m.id=c.animal_link_id and m.pet_id=c.pet_id and h.snapshot_id::text=c.parent_context->>'parent_snapshot_id' and h.version::text=c.parent_context->>'parent_observed_head_version') into parent_current;
 select coalesce(jsonb_agg(jsonb_build_object('run_id',o.run_id,'page',o.page,'ordinal',o.ordinal,'external_id',o.external_id,'file_id',o.file_id,'metadata',s.payload-'representation','raw_record_sha256',o.raw_record_sha256,'stable_metadata_sha256',o.stable_metadata_sha256,'snapshot_id',o.snapshot_id,'observed_head_version',o.head_version,'is_current',parent_current and coalesce(h.snapshot_id=o.snapshot_id and h.version=o.head_version,false),'created_at',o.created_at,'file_sha256',null) order by o.page,o.ordinal),'[]') into items
 from(select * from public.ezyvet_attachment_page_observations where run_id=p_run_id and(p_after_page is null or(page,ordinal)>(p_after_page,p_after_ordinal)) order by page,ordinal limit p_limit+1) o
 join public.ezyvet_import_snapshots s on s.id=o.snapshot_id left join public.ezyvet_identity_heads h on h.source_origin=s.source_origin and h.source_site_uid=s.source_site_uid and h.resource=s.resource and h.external_id=s.external_id;
 more:=jsonb_array_length(items)>p_limit;if more then items:=items-p_limit;end if;lastrow:=items->(jsonb_array_length(items)-1);
 return jsonb_build_object('observations',items,'has_more',more,'next_cursor',case when more then jsonb_build_object('after_page',lastrow->'page','after_ordinal',lastrow->'ordinal') else null end);
end $$;
do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in('ezyvet_attachment_parent_context','claim_ezyvet_attachment_import','ezyvet_attachment_validate_page','stage_ezyvet_attachment_page','ezyvet_attachment_run_projection','recover_ezyvet_attachment_run','list_ezyvet_attachment_runs','list_ezyvet_attachment_observations','claim_ezyvet_import','stage_ezyvet_import_page') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in('claim_ezyvet_import','claim_ezyvet_attachment_import','stage_ezyvet_import_page','stage_ezyvet_attachment_page') then execute format('grant execute on function %s to service_role',f.signature);
  elsif f.proname in('recover_ezyvet_attachment_run','list_ezyvet_attachment_runs','list_ezyvet_attachment_observations') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
