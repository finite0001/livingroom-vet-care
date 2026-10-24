-- Owned API originals are quarantined evidence, never automatic patient documents.
create table public.ezyvet_attachment_capture_requests (
 id uuid primary key,requested_by uuid not null references auth.users(id),animal_link_id uuid not null references public.ezyvet_record_links(id),
 pet_id uuid not null references public.pets(id),client_id uuid not null references public.clients(id),
 run_id uuid not null,page integer not null,ordinal integer not null,
 snapshot_id uuid not null references public.ezyvet_import_snapshots(id),observed_head_version integer not null,
 external_id text not null,file_id text not null,stable_metadata_sha256 text not null,raw_record_sha256 text not null,
 metadata jsonb not null,parent_context jsonb not null,request_payload jsonb not null,request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 status text not null default 'prepared' check(status in('prepared','reserved','ready','blocked','discarding','abandoned')),
 lease_id uuid,lease_until timestamptz,retry_after timestamptz,last_error_code text,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 foreign key(run_id,page,ordinal) references public.ezyvet_attachment_page_observations(run_id,page,ordinal),
 check((lease_id is null)=(lease_until is null)),check(last_error_code is null or last_error_code ~ '^[A-Z_]{1,64}$')
);
create index ezyvet_attachment_capture_owner on public.ezyvet_attachment_capture_requests(requested_by,animal_link_id,created_at desc,id desc);
create table public.ezyvet_attachment_capture_attempts (
 lease_id uuid primary key,request_id uuid not null references public.ezyvet_attachment_capture_requests(id),
 actor_id uuid not null references auth.users(id),created_at timestamptz not null,lease_until timestamptz not null check(lease_until>created_at)
);
create table public.ezyvet_attachment_capture_failures (
 lease_id uuid primary key references public.ezyvet_attachment_capture_attempts(lease_id),request_id uuid not null references public.ezyvet_attachment_capture_requests(id),
 code text not null,retry_seconds integer not null,terminal boolean not null,created_at timestamptz not null default clock_timestamp()
);
create table public.ezyvet_attachment_original_intents (
 id uuid primary key default gen_random_uuid(),request_id uuid not null unique references public.ezyvet_attachment_capture_requests(id),
 bucket_id text not null check(bucket_id='ezyvet-attachment-originals'),object_path text not null unique,
 content_sha256 text not null check(content_sha256 ~ '^[a-f0-9]{64}$'),mime_type text not null check(mime_type in('application/pdf','image/jpeg','image/png')),
 file_size integer not null check(file_size between 1 and 20971520),before_raw_sha256 text not null check(before_raw_sha256 ~ '^[a-f0-9]{64}$'),after_raw_sha256 text not null check(after_raw_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp()
);
create table public.ezyvet_attachment_original_captures (
 id uuid primary key default gen_random_uuid(),request_id uuid not null unique references public.ezyvet_attachment_capture_requests(id),
 intent_id uuid not null unique references public.ezyvet_attachment_original_intents(id),lease_id uuid not null references public.ezyvet_attachment_capture_attempts(lease_id),
 storage_object_id uuid not null,entry_method text not null default 'ezyvet_api_attachment_original_v1' check(entry_method='ezyvet_api_attachment_original_v1'),
 content_sha256 text not null check(content_sha256 ~ '^[a-f0-9]{64}$'),mime_type text not null,file_size integer not null,
 capture_hash text not null check(capture_hash ~ '^[a-f0-9]{64}$'),captured_at timestamptz not null default clock_timestamp()
);
do $$declare t text;begin foreach t in array array['ezyvet_attachment_capture_requests','ezyvet_attachment_capture_attempts','ezyvet_attachment_capture_failures','ezyvet_attachment_original_intents','ezyvet_attachment_original_captures'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
 if t<>'ezyvet_attachment_capture_requests' then execute format('create trigger immutable_api_original before update or delete on public.%I for each row execute function public.guard_inquiry_history()',t);end if;
end loop;end $$;
create function public.guard_ezyvet_attachment_capture_request() returns trigger language plpgsql set search_path=public as $$begin
 if TG_OP='DELETE' or(to_jsonb(NEW)-array['status','lease_id','lease_until','retry_after','last_error_code','updated_at']) is distinct from(to_jsonb(OLD)-array['status','lease_id','lease_until','retry_after','last_error_code','updated_at']) then raise exception 'Original capture identity is immutable' using errcode='23514';end if;
 if OLD.status in('ready','abandoned') or(OLD.status='discarding' and NEW.status not in('discarding','abandoned'))
  or(OLD.status='blocked' and NEW.status not in('blocked','discarding'))
  or(OLD.status='reserved' and NEW.status='prepared') then raise exception 'Original capture state cannot revive or regress' using errcode='23514';end if;
 if NEW.status='reserved' and not exists(select 1 from public.ezyvet_attachment_original_intents where request_id=NEW.id) then raise exception 'Reserved original intent required' using errcode='23514';end if;
 if NEW.status='ready' and not exists(select 1 from public.ezyvet_attachment_original_captures where request_id=NEW.id) then raise exception 'Verified original capture required' using errcode='23514';end if;
 if NEW.status in('ready','blocked','discarding','abandoned') and(NEW.lease_id is not null or NEW.lease_until is not null) then raise exception 'Resolved capture cannot hold a worker lease' using errcode='23514';end if;
 if NEW.status='abandoned' and OLD.status<>'discarding' then raise exception 'Discard fence required' using errcode='23514';end if;
 return NEW;
end $$;
create trigger guard_api_original_request before update or delete on public.ezyvet_attachment_capture_requests for each row execute function public.guard_ezyvet_attachment_capture_request();

create function public.ezyvet_attachment_capture_current(p_id uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.ezyvet_attachment_capture_requests r
 join public.ezyvet_record_links m on m.id=r.animal_link_id and m.pet_id=r.pet_id and m.client_id=r.client_id and m.resource='animal'
 join public.pets p on p.id=r.pet_id and p.client_id=r.client_id
 join public.ezyvet_identity_heads parent on parent.source_origin=m.source_origin and parent.source_site_uid=m.source_site_uid and parent.resource='animal' and parent.external_id=m.external_id
 join public.ezyvet_identity_heads h on h.source_origin=m.source_origin and h.source_site_uid=m.source_site_uid and h.resource='attachment' and h.external_id=r.external_id
 where r.id=p_id and m.source_origin=r.parent_context->>'source_origin' and m.source_site_uid=r.parent_context->>'source_site_uid' and m.external_id=r.parent_context->>'animal_external_id'
 and parent.snapshot_id::text=r.parent_context->>'parent_snapshot_id' and parent.version::text=r.parent_context->>'parent_observed_head_version'
 and h.snapshot_id=r.snapshot_id and h.version=r.observed_head_version);
$$;
create function public.ezyvet_attachment_capture_projection(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',r.id,'requested_by',r.requested_by,'animal_link_id',r.animal_link_id,'pet_id',r.pet_id,'client_id',r.client_id,'run_id',r.run_id,'page',r.page,'ordinal',r.ordinal,'snapshot_id',r.snapshot_id,'observed_head_version',r.observed_head_version,'external_id',r.external_id,'file_id',r.file_id,'stable_metadata_sha256',r.stable_metadata_sha256,'raw_record_sha256',r.raw_record_sha256,'metadata',r.metadata,'parent_context',r.parent_context,'request_hash',r.request_hash,'status',r.status,'source_current',public.ezyvet_attachment_capture_current(r.id),'lease_active',coalesce(r.lease_until>now(),false),'retry_after',r.retry_after,'last_error_code',r.last_error_code,'retryable',r.status in('prepared','reserved') and public.ezyvet_attachment_capture_current(r.id),'created_at',r.created_at,'updated_at',r.updated_at,'capture',(select jsonb_build_object('id',c.id,'request_id',c.request_id,'entry_method',c.entry_method,'content_sha256',c.content_sha256,'mime_type',c.mime_type,'file_size',c.file_size,'capture_hash',c.capture_hash,'captured_at',c.captured_at) from public.ezyvet_attachment_original_captures c where c.request_id=r.id))
 from public.ezyvet_attachment_capture_requests r where r.id=p_id;
$$;
create function public.ezyvet_attachment_capture_private(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('request',public.ezyvet_attachment_capture_projection(r.id),'lease_id',r.lease_id,'lease_until',r.lease_until,'intent',(select jsonb_build_object('id',i.id,'bucket_id',i.bucket_id,'object_path',i.object_path,'content_sha256',i.content_sha256,'mime_type',i.mime_type,'file_size',i.file_size,'before_raw_sha256',i.before_raw_sha256,'after_raw_sha256',i.after_raw_sha256) from public.ezyvet_attachment_original_intents i where i.request_id=r.id)) from public.ezyvet_attachment_capture_requests r where r.id=p_id;
$$;
create function public.ezyvet_attachment_original_source_gate(p_origin text,p_site text,p_ignore_request uuid default null) returns void language plpgsql security definer set search_path=public as $$begin
 perform pg_advisory_xact_lock(hashtextextended(p_origin||':'||p_site||':attachment',0));
 if exists(select 1 from public.ezyvet_import_runs where source_origin=p_origin and source_site_uid=p_site and resource='attachment' and(lease_until>clock_timestamp() or retry_after>clock_timestamp()))
  or exists(select 1 from public.ezyvet_attachment_capture_requests where id is distinct from p_ignore_request and parent_context->>'source_origin'=p_origin and parent_context->>'source_site_uid'=p_site and(lease_until>clock_timestamp() or retry_after>clock_timestamp())) then raise exception 'Attachment source busy or cooling down' using errcode='55P03';end if;
end $$;
-- Locks match metadata staging: run, mapping/patient/Animal, source gate, attachment.
create function public.ezyvet_attachment_capture_lock_source(p_id uuid,p_claim_slot boolean default false) returns void language plpgsql security definer set search_path=public as $$
declare r public.ezyvet_attachment_capture_requests;context jsonb;h public.ezyvet_identity_heads;begin
 select * into strict r from public.ezyvet_attachment_capture_requests where id=p_id;
 perform pg_advisory_xact_lock(hashtextextended('attachment-run:'||r.run_id::text,0));
 context:=public.ezyvet_attachment_parent_context(r.animal_link_id,r.parent_context->>'source_origin',r.parent_context->>'source_site_uid');
 if context is distinct from r.parent_context then raise exception 'SOURCE_ATTACHMENT_PARENT_STALE' using errcode='40001';end if;
 if p_claim_slot then perform public.ezyvet_attachment_original_source_gate(context->>'source_origin',context->>'source_site_uid',r.id);
 else perform pg_advisory_xact_lock(hashtextextended((context->>'source_origin')||':'||(context->>'source_site_uid')||':attachment',0));end if;
 select * into h from public.ezyvet_identity_heads where source_origin=context->>'source_origin' and source_site_uid=context->>'source_site_uid' and resource='attachment' and external_id=r.external_id for share;
 if h.snapshot_id is distinct from r.snapshot_id or h.version is distinct from r.observed_head_version then raise exception 'SOURCE_ATTACHMENT_STALE' using errcode='40001';end if;
end $$;
create function public.ezyvet_attachment_capture_prepare_core(p_id uuid,p_animal_link_id uuid,p_run_id uuid,p_page integer,p_ordinal integer,p_snapshot_id uuid,p_observed_head_version integer,p_stable_metadata_sha256 text,p_abandon boolean) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare actor uuid:=auth.uid();r public.ezyvet_attachment_capture_requests;c public.ezyvet_attachment_runs;o public.ezyvet_attachment_page_observations;s public.ezyvet_import_snapshots;payload jsonb;fingerprint text;
begin
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_animal_link_id is null or p_run_id is null or p_page is null or p_page not between 1 and 1000 or p_ordinal is null or p_ordinal not between 1 and 10 or p_snapshot_id is null or p_observed_head_version is null or p_observed_head_version<1 or p_stable_metadata_sha256 is null or p_stable_metadata_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'Exact owned attachment observation required' using errcode='23514';end if;
 payload:=jsonb_build_object('animal_link_id',p_animal_link_id,'run_id',p_run_id,'page',p_page,'ordinal',p_ordinal,'snapshot_id',p_snapshot_id,'observed_head_version',p_observed_head_version,'stable_metadata_sha256',p_stable_metadata_sha256);
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,7000));
 select * into r from public.ezyvet_attachment_capture_requests where id=p_id;
 if found then
  if r.requested_by is distinct from actor or r.request_payload is distinct from payload then raise exception 'Capture request UUID already used' using errcode='42501';end if;
  return public.ezyvet_attachment_capture_projection(p_id);
 end if;
 select * into c from public.ezyvet_attachment_runs where run_id=p_run_id;
 if c.run_id is null or row(c.actor_id,c.animal_link_id) is distinct from row(actor,p_animal_link_id) then raise exception 'Owned attachment metadata run required' using errcode='42501';end if;
 select * into o from public.ezyvet_attachment_page_observations where run_id=p_run_id and page=p_page and ordinal=p_ordinal;
 if o.run_id is null or row(o.snapshot_id,o.head_version,o.stable_metadata_sha256) is distinct from row(p_snapshot_id,p_observed_head_version,p_stable_metadata_sha256) then raise exception 'Exact metadata observation changed' using errcode='42501';end if;
 select * into strict s from public.ezyvet_import_snapshots where id=o.snapshot_id;
 if s.resource<>'attachment' or s.payload->>'representation' is distinct from 'sanitized_attachment_metadata_v1' then raise exception 'Sanitized attachment evidence required' using errcode='23514';end if;
 fingerprint:=encode(digest(jsonb_build_array(p_id,actor,payload,c.parent_context,s.payload,o.raw_record_sha256)::text,'sha256'),'hex');
 insert into public.ezyvet_attachment_capture_requests(id,requested_by,animal_link_id,pet_id,client_id,run_id,page,ordinal,snapshot_id,observed_head_version,external_id,file_id,stable_metadata_sha256,raw_record_sha256,metadata,parent_context,request_payload,request_hash,status)
 values(p_id,actor,c.animal_link_id,c.pet_id,(c.parent_context->>'client_id')::uuid,p_run_id,p_page,p_ordinal,o.snapshot_id,o.head_version,o.external_id,o.file_id,o.stable_metadata_sha256,o.raw_record_sha256,s.payload-'representation',c.parent_context,payload,fingerprint,case when p_abandon then 'abandoned' else 'prepared' end);
 if not p_abandon then perform public.ezyvet_attachment_capture_lock_source(p_id,false);end if;
 return public.ezyvet_attachment_capture_projection(p_id);
end $$;
create function public.prepare_ezyvet_attachment_capture(p_id uuid,p_animal_link_id uuid,p_run_id uuid,p_page integer,p_ordinal integer,p_snapshot_id uuid,p_observed_head_version integer,p_stable_metadata_sha256 text) returns jsonb language sql security definer set search_path=public as $$ select public.ezyvet_attachment_capture_prepare_core(p_id,p_animal_link_id,p_run_id,p_page,p_ordinal,p_snapshot_id,p_observed_head_version,p_stable_metadata_sha256,false); $$;
create function public.abandon_ezyvet_attachment_capture_preparation(p_id uuid,p_animal_link_id uuid,p_run_id uuid,p_page integer,p_ordinal integer,p_snapshot_id uuid,p_observed_head_version integer,p_stable_metadata_sha256 text) returns jsonb language sql security definer set search_path=public as $$ select public.ezyvet_attachment_capture_prepare_core(p_id,p_animal_link_id,p_run_id,p_page,p_ordinal,p_snapshot_id,p_observed_head_version,p_stable_metadata_sha256,true); $$;
create function public.recover_ezyvet_attachment_capture(p_id uuid,p_animal_link_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r public.ezyvet_attachment_capture_requests;begin
 if public.ezyvet_is_active_admin(auth.uid()) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_animal_link_id is null then raise exception 'Owned capture identity required' using errcode='23514';end if;
 select * into r from public.ezyvet_attachment_capture_requests where id=p_id;if not found then return null;end if;
 if row(r.requested_by,r.animal_link_id) is distinct from row(auth.uid(),p_animal_link_id) then raise exception 'Capture recovery owner mismatch' using errcode='42501';end if;
 return public.ezyvet_attachment_capture_projection(p_id);
end $$;
create function public.list_ezyvet_attachment_captures(p_animal_link_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare items jsonb;more boolean;lastrow jsonb;begin
 if public.ezyvet_is_active_admin(auth.uid()) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_animal_link_id is null or p_limit is null or p_limit not between 1 and 50 or(p_before_at is null)<>(p_before_id is null) or(p_before_at is not null and not isfinite(p_before_at)) then raise exception 'Bounded capture cursor required' using errcode='23514';end if;
 select coalesce(jsonb_agg(public.ezyvet_attachment_capture_projection(id) order by created_at desc,id desc),'[]') into items from(select id,created_at from public.ezyvet_attachment_capture_requests where requested_by=auth.uid() and animal_link_id=p_animal_link_id and(p_before_at is null or(created_at,id)<(p_before_at,p_before_id)) order by created_at desc,id desc limit p_limit+1) x;
 more:=jsonb_array_length(items)>p_limit;if more then items:=items-p_limit;end if;lastrow:=items->(jsonb_array_length(items)-1);
 return jsonb_build_object('captures',items,'has_more',more,'next_cursor',case when more then jsonb_build_object('before_at',lastrow->'created_at','before_id',lastrow->'id') else null end);
end $$;
create function public.list_ezyvet_attachment_capture_mappings(p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare items jsonb;more boolean;lastrow jsonb;begin
 if public.ezyvet_is_active_admin(auth.uid()) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_limit is null or p_limit not between 1 and 50 or(p_before_at is null)<>(p_before_id is null) or(p_before_at is not null and not isfinite(p_before_at)) then raise exception 'Bounded capture mapping cursor required' using errcode='23514';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by last_capture_at desc,link_id desc),'[]') into items from (
  select r.animal_link_id link_id,r.pet_id,p.name patient_name,c.full_name household_name,
   r.parent_context->>'source_origin' source_origin,r.parent_context->>'source_site_uid' source_site_uid,
   l.external_id,p.version patient_version,r.created_at last_capture_at
  from (select distinct on(animal_link_id) * from public.ezyvet_attachment_capture_requests where requested_by=auth.uid() order by animal_link_id,created_at desc,id desc) r
  join public.pets p on p.id=r.pet_id join public.clients c on c.id=r.client_id join public.ezyvet_record_links l on l.id=r.animal_link_id
  where p_before_at is null or(r.created_at,r.animal_link_id)<(p_before_at,p_before_id)
  order by r.created_at desc,r.animal_link_id desc limit p_limit+1
 ) x;
 more:=jsonb_array_length(items)>p_limit;if more then items:=items-p_limit;end if;lastrow:=items->(jsonb_array_length(items)-1);
 return jsonb_build_object('mappings',items,'has_more',more,'next_cursor',case when more then jsonb_build_object('before_at',lastrow->'last_capture_at','before_id',lastrow->'link_id') else null end);
end $$;
create function public.get_ezyvet_attachment_capture_context(p_id uuid,p_actor uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$begin
 if public.ezyvet_is_active_admin(p_actor) is not true or not exists(select 1 from public.ezyvet_attachment_capture_requests where id=p_id and requested_by=p_actor) then raise exception 'Owned capture unavailable' using errcode='42501';end if;
 return public.ezyvet_attachment_capture_private(p_id);
end $$;
create function public.ezyvet_attachment_capture_require_lease(p_id uuid,p_actor uuid,p_lease_id uuid) returns public.ezyvet_attachment_capture_requests language plpgsql security definer set search_path=public as $$
declare r public.ezyvet_attachment_capture_requests;begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into r from public.ezyvet_attachment_capture_requests where id=p_id for update;
 if r.id is null or r.requested_by is distinct from p_actor then raise exception 'Capture owner mismatch' using errcode='42501';end if;
 if r.status not in('prepared','reserved') or p_lease_id is null or r.lease_id is distinct from p_lease_id or r.lease_until<=clock_timestamp() then raise exception 'Capture lease changed or expired' using errcode='40001';end if;
 return r;
end $$;
create function public.claim_ezyvet_attachment_capture(p_id uuid,p_actor uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.ezyvet_attachment_capture_requests;lease uuid;started timestamptz;begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,7000));
 select * into r from public.ezyvet_attachment_capture_requests where id=p_id for update;
 if r.id is null or r.requested_by is distinct from p_actor then raise exception 'Capture owner mismatch' using errcode='42501';end if;
 if r.status='ready' then return public.ezyvet_attachment_capture_private(p_id);end if;
 if r.status not in('prepared','reserved') then raise exception 'Capture cannot be retried' using errcode='23514';end if;
 if r.lease_until>clock_timestamp() or r.retry_after>clock_timestamp() then raise exception 'Capture busy or cooling down' using errcode='55P03';end if;
 perform public.ezyvet_attachment_capture_lock_source(p_id,true);
 lease:=gen_random_uuid();started:=clock_timestamp();
 insert into public.ezyvet_attachment_capture_attempts(lease_id,request_id,actor_id,created_at,lease_until) values(lease,p_id,p_actor,started,started+interval '180 seconds');
 update public.ezyvet_attachment_capture_requests set lease_id=lease,lease_until=started+interval '180 seconds',retry_after=null,last_error_code=null,updated_at=started where id=p_id and requested_by=p_actor;
 return public.ezyvet_attachment_capture_private(p_id);
end $$;
create function public.reserve_ezyvet_attachment_original(p_id uuid,p_actor uuid,p_lease_id uuid,p_content_sha256 text,p_mime_type text,p_file_size integer,p_before_raw_sha256 text,p_after_raw_sha256 text) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.ezyvet_attachment_capture_requests;i public.ezyvet_attachment_original_intents;begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_content_sha256 is null or p_content_sha256 !~ '^[a-f0-9]{64}$' or p_before_raw_sha256 is null or p_before_raw_sha256 !~ '^[a-f0-9]{64}$' or p_after_raw_sha256 is null or p_after_raw_sha256 !~ '^[a-f0-9]{64}$' or p_file_size is null or p_file_size not between 1 and 20971520 or p_mime_type is null or p_mime_type not in('application/pdf','image/jpeg','image/png') then raise exception 'Exact bounded original evidence required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,7000));
 select * into r from public.ezyvet_attachment_capture_requests where id=p_id for update;
 if r.id is null or r.requested_by is distinct from p_actor then raise exception 'Capture owner mismatch' using errcode='42501';end if;
 select * into i from public.ezyvet_attachment_original_intents where request_id=p_id;
 if found then
  if row(i.content_sha256,i.mime_type,i.file_size,i.before_raw_sha256,i.after_raw_sha256) is distinct from row(p_content_sha256,p_mime_type,p_file_size,p_before_raw_sha256,p_after_raw_sha256) then raise exception 'Original capture intent is immutable' using errcode='23514';end if;
  return public.ezyvet_attachment_capture_private(p_id);
 end if;
 r:=public.ezyvet_attachment_capture_require_lease(p_id,p_actor,p_lease_id);
 perform public.ezyvet_attachment_capture_lock_source(p_id,false);
 if r.metadata->>'mime_type' is not null and lower(trim(split_part(r.metadata->>'mime_type',';',1))) not in(p_mime_type,'application/octet-stream') then raise exception 'Original MIME conflicts with source' using errcode='23514';end if;
 perform public.ezyvet_attachment_capture_require_lease(p_id,p_actor,p_lease_id);
 insert into public.ezyvet_attachment_original_intents(request_id,bucket_id,object_path,content_sha256,mime_type,file_size,before_raw_sha256,after_raw_sha256)
 values(p_id,'ezyvet-attachment-originals',p_actor::text||'/'||r.pet_id::text||'/'||p_id::text||'/'||gen_random_uuid()::text||'/original',p_content_sha256,p_mime_type,p_file_size,p_before_raw_sha256,p_after_raw_sha256);
 update public.ezyvet_attachment_capture_requests set status='reserved',updated_at=clock_timestamp() where id=p_id and requested_by=p_actor;
 return public.ezyvet_attachment_capture_private(p_id);
end $$;
create function public.complete_ezyvet_attachment_capture(p_id uuid,p_actor uuid,p_lease_id uuid,p_intent_id uuid,p_content_sha256 text,p_mime_type text,p_file_size integer) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare r public.ezyvet_attachment_capture_requests;i public.ezyvet_attachment_original_intents;c public.ezyvet_attachment_original_captures;o storage.objects;fingerprint text;begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,7000));
 select * into r from public.ezyvet_attachment_capture_requests where id=p_id for update;
 select * into i from public.ezyvet_attachment_original_intents where request_id=p_id;
 if r.id is null or r.requested_by is distinct from p_actor or i.id is null or row(i.id,i.content_sha256,i.mime_type,i.file_size) is distinct from row(p_intent_id,p_content_sha256,p_mime_type,p_file_size) then raise exception 'Exact owned original verification required' using errcode='42501';end if;
 select * into c from public.ezyvet_attachment_original_captures where request_id=p_id;
 if found then return public.ezyvet_attachment_capture_private(p_id);end if;
 perform public.ezyvet_attachment_capture_require_lease(p_id,p_actor,p_lease_id);
 perform public.ezyvet_attachment_capture_lock_source(p_id,false);
 select * into o from storage.objects where bucket_id=i.bucket_id and name=i.object_path for share;
 if o.id is null or o.metadata->>'size' is distinct from i.file_size::text or o.metadata->>'mimetype' is distinct from i.mime_type then raise exception 'Exact private original unavailable' using errcode='23514';end if;
 perform public.ezyvet_attachment_capture_require_lease(p_id,p_actor,p_lease_id);
 fingerprint:=encode(digest(jsonb_build_array(r.request_hash,i.id,o.id,i.bucket_id,i.object_path,i.content_sha256,i.mime_type,i.file_size,'ezyvet_api_attachment_original_v1')::text,'sha256'),'hex');
 insert into public.ezyvet_attachment_original_captures(request_id,intent_id,lease_id,storage_object_id,content_sha256,mime_type,file_size,capture_hash) values(p_id,i.id,p_lease_id,o.id,i.content_sha256,i.mime_type,i.file_size,fingerprint);
 update public.ezyvet_attachment_capture_requests set status='ready',lease_id=null,lease_until=null,retry_after=null,last_error_code=null,updated_at=clock_timestamp() where id=p_id and requested_by=p_actor;
 return public.ezyvet_attachment_capture_private(p_id);
end $$;
create function public.fail_ezyvet_attachment_capture(p_id uuid,p_actor uuid,p_lease_id uuid,p_code text,p_retry_seconds integer,p_terminal boolean) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.ezyvet_attachment_capture_requests;f public.ezyvet_attachment_capture_failures;begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_code is null or p_code not in('UPSTREAM_UNAVAILABLE','RATE_LIMITED','UPSTREAM_AUTH_FAILED','UPSTREAM_SCOPE_DENIED','SOURCE_ATTACHMENT_PARENT_STALE','SOURCE_ATTACHMENT_STALE','SOURCE_ATTACHMENT_METADATA_CHANGED','ATTACHMENT_UNSUPPORTED_TYPE','ATTACHMENT_INVALID_CONTENT','ATTACHMENT_TOO_LARGE','STORAGE_UNAVAILABLE','STORAGE_OBJECT_CHANGED','CAPTURE_UNAVAILABLE') or p_terminal is null or p_retry_seconds is null or(p_terminal and p_retry_seconds<>0) or(not p_terminal and p_retry_seconds not between 1 and 3600) then raise exception 'Bounded safe capture failure required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,7000));
 select * into r from public.ezyvet_attachment_capture_requests where id=p_id for update;
 if r.id is null or r.requested_by is distinct from p_actor then raise exception 'Capture owner mismatch' using errcode='42501';end if;
 select * into f from public.ezyvet_attachment_capture_failures where lease_id=p_lease_id;
 if found then
  if row(f.request_id,f.code,f.retry_seconds,f.terminal) is distinct from row(p_id,p_code,p_retry_seconds,p_terminal) then raise exception 'Recorded failure is immutable' using errcode='23514';end if;
  return public.ezyvet_attachment_capture_private(p_id);
 end if;
 if r.status not in('prepared','reserved') or p_lease_id is null or r.lease_id is distinct from p_lease_id then raise exception 'Capture worker superseded' using errcode='40001';end if;
 perform pg_advisory_xact_lock(hashtextextended((r.parent_context->>'source_origin')||':'||(r.parent_context->>'source_site_uid')||':attachment',0));
 insert into public.ezyvet_attachment_capture_failures(lease_id,request_id,code,retry_seconds,terminal) values(p_lease_id,p_id,p_code,p_retry_seconds,p_terminal);
 update public.ezyvet_attachment_capture_requests set status=case when p_terminal then 'blocked' else status end,lease_id=null,lease_until=null,retry_after=case when p_terminal then null else clock_timestamp()+make_interval(secs=>p_retry_seconds) end,last_error_code=p_code,updated_at=clock_timestamp() where id=p_id and requested_by=p_actor;
 return public.ezyvet_attachment_capture_private(p_id);
end $$;
create function public.begin_discard_ezyvet_attachment_capture(p_id uuid,p_actor uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.ezyvet_attachment_capture_requests;begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,7000));
 select * into r from public.ezyvet_attachment_capture_requests where id=p_id for update;
 if r.id is null or r.requested_by is distinct from p_actor then raise exception 'Capture owner mismatch' using errcode='42501';end if;
 if r.status='ready' then raise exception 'Captured original cannot be discarded' using errcode='23514';end if;
 if r.status in('discarding','abandoned') then return public.ezyvet_attachment_capture_private(p_id);end if;
 update public.ezyvet_attachment_capture_requests set status='discarding',lease_id=null,lease_until=null,retry_after=null,updated_at=clock_timestamp() where id=p_id and requested_by=p_actor;
 return public.ezyvet_attachment_capture_private(p_id);
end $$;
create function public.complete_discard_ezyvet_attachment_capture(p_id uuid,p_actor uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.ezyvet_attachment_capture_requests;i public.ezyvet_attachment_original_intents;begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,7000));
 select * into r from public.ezyvet_attachment_capture_requests where id=p_id for update;
 if r.id is null or r.requested_by is distinct from p_actor then raise exception 'Capture owner mismatch' using errcode='42501';end if;
 if r.status='abandoned' then return public.ezyvet_attachment_capture_private(p_id);end if;
 if r.status<>'discarding' then raise exception 'Original discard fence required' using errcode='23514';end if;
 select * into i from public.ezyvet_attachment_original_intents where request_id=p_id;
 if exists(select 1 from storage.objects where bucket_id=i.bucket_id and name=i.object_path) then raise exception 'Discard object removal unconfirmed' using errcode='23514';end if;
 update public.ezyvet_attachment_capture_requests set status='abandoned',updated_at=clock_timestamp() where id=p_id and requested_by=p_actor;
 return public.ezyvet_attachment_capture_private(p_id);
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('ezyvet-attachment-originals','ezyvet-attachment-originals',false,20971520,array['application/pdf','image/jpeg','image/png']);
create function public.ezyvet_attachment_original_storage_insert(p_path text) returns boolean language plpgsql security definer set search_path=public as $$
declare i public.ezyvet_attachment_original_intents;r public.ezyvet_attachment_capture_requests;begin
 if public.ezyvet_is_active_admin(auth.uid()) is not true then return false;end if;
 select * into i from public.ezyvet_attachment_original_intents where object_path=p_path;if not found then return false;end if;
 -- Same row lock as discard/complete. A delayed upload cannot pass a committed fence.
 select * into r from public.ezyvet_attachment_capture_requests where id=i.request_id for update;
 return r.requested_by=auth.uid() and r.status='reserved' and r.lease_id is not null and r.lease_until>clock_timestamp();
end $$;
create policy "Upload exact reserved API original" on storage.objects for insert to authenticated with check(bucket_id='ezyvet-attachment-originals' and public.ezyvet_attachment_original_storage_insert(name));
-- No SELECT, UPDATE or DELETE policy. Verified readback and fenced deletion run server-side.

-- Add the original-capture interlock without changing immutable6900.
create or replace function public.claim_ezyvet_attachment_import(p_id uuid,p_actor uuid,p_site_uid text,p_source_origin text,p_animal_link_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c public.ezyvet_attachment_runs;r public.ezyvet_import_runs;context jsonb;
begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_animal_link_id is null or p_source_origin is null or p_site_uid is null then raise exception 'Exact attachment operation required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('attachment-run:'||p_id::text,0));
 select * into c from public.ezyvet_attachment_runs where run_id=p_id;select * into r from public.ezyvet_import_runs where id=p_id;
 if c.run_id is not null then
  if row(c.actor_id,c.animal_link_id,r.requested_by,r.resource,r.source_origin,r.source_site_uid) is distinct from row(p_actor,p_animal_link_id,p_actor,'attachment'::text,p_source_origin,p_site_uid) then raise exception 'Attachment operation identity changed' using errcode='42501';end if;
  if r.status<>'running' then return to_jsonb(r)||jsonb_build_object('scope','animal_attachment_metadata','parent_context',c.parent_context,'animal_link_id',c.animal_link_id,'animal_external_id',c.parent_context->'animal_external_id','pet_id',c.pet_id,'client_id',c.parent_context->'client_id');end if;
 elsif r.id is not null then raise exception 'ATTACHMENT_RUN_REQUIRES_NEW_CONTEXT' using errcode='22023';end if;
 context:=public.ezyvet_attachment_parent_context(p_animal_link_id,p_source_origin,p_site_uid);
 if c.run_id is not null and c.parent_context is distinct from context then raise exception 'SOURCE_ATTACHMENT_PARENT_STALE' using errcode='40001';end if;
 perform public.ezyvet_attachment_original_source_gate(p_source_origin,p_site_uid,null);
 r:=public.claim_ezyvet_import_core(p_id,p_actor,p_site_uid,'attachment',p_source_origin);
 if r.lease_until<=clock_timestamp() then raise exception 'Attachment lease expired during claim' using errcode='40001';end if;
 insert into public.ezyvet_attachment_runs(run_id,actor_id,animal_link_id,pet_id,parent_context) values(p_id,p_actor,p_animal_link_id,(context->>'pet_id')::uuid,context) on conflict(run_id) do nothing;
 return to_jsonb(r)||jsonb_build_object('scope','animal_attachment_metadata','parent_context',context,'animal_link_id',p_animal_link_id,'animal_external_id',context->'animal_external_id','pet_id',context->'pet_id','client_id',context->'client_id');
end $$;
do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in('ezyvet_attachment_capture_prepare_core','abandon_ezyvet_attachment_capture_preparation','list_ezyvet_attachment_capture_mappings','guard_ezyvet_attachment_capture_request','ezyvet_attachment_capture_current','ezyvet_attachment_capture_projection','ezyvet_attachment_capture_private','ezyvet_attachment_original_source_gate','ezyvet_attachment_capture_lock_source','prepare_ezyvet_attachment_capture','recover_ezyvet_attachment_capture','list_ezyvet_attachment_captures','get_ezyvet_attachment_capture_context','ezyvet_attachment_capture_require_lease','claim_ezyvet_attachment_capture','reserve_ezyvet_attachment_original','complete_ezyvet_attachment_capture','fail_ezyvet_attachment_capture','begin_discard_ezyvet_attachment_capture','complete_discard_ezyvet_attachment_capture','ezyvet_attachment_original_storage_insert','claim_ezyvet_attachment_import') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 if f.proname in('abandon_ezyvet_attachment_capture_preparation','list_ezyvet_attachment_capture_mappings','prepare_ezyvet_attachment_capture','recover_ezyvet_attachment_capture','list_ezyvet_attachment_captures','ezyvet_attachment_original_storage_insert') then execute format('grant execute on function %s to authenticated',f.signature);
 elsif f.proname in('get_ezyvet_attachment_capture_context','claim_ezyvet_attachment_capture','reserve_ezyvet_attachment_original','complete_ezyvet_attachment_capture','fail_ezyvet_attachment_capture','begin_discard_ezyvet_attachment_capture','complete_discard_ezyvet_attachment_capture','claim_ezyvet_attachment_import') then execute format('grant execute on function %s to service_role',f.signature);end if;
 end loop;
end $$;
