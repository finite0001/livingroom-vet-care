-- API file capture is separate from manual documents and clinical approval.
create table public.ezyvet_attachment_capture_intents (
 request_id uuid primary key references public.ezyvet_attachment_download_requests(id),
 actor_id uuid not null references public.profiles(id),pet_id uuid not null references public.pets(id),
 originating_lease_id uuid not null references public.ezyvet_attachment_download_attempts(lease_id),
 request_hash text not null,intent_hash text not null check(intent_hash ~ '^[a-f0-9]{64}$'),
 bucket text not null check(bucket='ezyvet-attachments'),object_path text not null unique,
 content_sha256 text not null check(content_sha256 ~ '^[a-f0-9]{64}$'),
 file_size bigint not null check(file_size between 1 and 20971520),mime_type text not null check(mime_type in('application/pdf','image/jpeg','image/png')),
 before_metadata jsonb not null,after_metadata jsonb not null,
 created_at timestamptz not null default clock_timestamp(),check(before_metadata=after_metadata)
);
create table public.ezyvet_attachment_captures (
 request_id uuid primary key references public.ezyvet_attachment_capture_intents(request_id),
 actor_id uuid not null references public.profiles(id),pet_id uuid not null references public.pets(id),
 lease_id uuid not null references public.ezyvet_attachment_download_attempts(lease_id),
 intent_hash text not null,capture_hash text not null check(capture_hash ~ '^[a-f0-9]{64}$'),
 storage_object_id uuid not null,bucket text not null,object_path text not null,
 content_sha256 text not null,file_size bigint not null,mime_type text not null,
 captured_at timestamptz not null default clock_timestamp()
);
do $$declare t text;begin foreach t in array array['ezyvet_attachment_capture_intents','ezyvet_attachment_captures'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger immutable_attachment_capture before update or delete on public.%I for each row execute function public.guard_inquiry_history()',t);
end loop;end $$;
alter table public.ezyvet_attachment_download_requests drop constraint ezyvet_attachment_download_requests_status_check;
alter table public.ezyvet_attachment_download_requests add constraint ezyvet_attachment_download_requests_status_check check(status in('pending','abandoned','captured'));
-- Locate the original resolved-at check by its expression rather than its generated suffix.
do $$declare c record;begin
 for c in select conname from pg_constraint where conrelid='public.ezyvet_attachment_download_requests'::regclass and contype='c' and pg_get_constraintdef(oid) like '%resolved_at%' loop
  execute format('alter table public.ezyvet_attachment_download_requests drop constraint %I',c.conname);
 end loop;
end $$;
alter table public.ezyvet_attachment_download_requests add constraint ezyvet_attachment_resolution check((status in('abandoned','captured'))=(resolved_at is not null));
create or replace function public.ezyvet_attachment_download_guard() returns trigger language plpgsql set search_path=public as $$
begin
 if TG_OP='DELETE' or OLD.status<>'pending' or NEW.status not in('abandoned','captured')
  or (to_jsonb(NEW)-array['status','resolved_at']) is distinct from (to_jsonb(OLD)-array['status','resolved_at']) then
  raise exception 'Attachment download intent is immutable' using errcode='23514';end if;
 if NEW.status='captured' and not exists(select 1 from public.ezyvet_attachment_captures where request_id=NEW.id and actor_id=NEW.actor_id and pet_id=NEW.pet_id) then raise exception 'Verified capture required' using errcode='23514';end if;
 return NEW;
end $$;
create function public.ezyvet_attachment_require_lease(p_id uuid,p_actor uuid,p_lease_id uuid,p_hash text)
returns public.ezyvet_attachment_download_requests language plpgsql security definer set search_path=public as $$
declare r public.ezyvet_attachment_download_requests;a public.ezyvet_attachment_download_attempts;
begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,6600));
 select * into r from public.ezyvet_attachment_download_requests where id=p_id for update;
 if r.id is null or row(r.actor_id,r.request_hash) is distinct from row(p_actor,p_hash) then raise exception 'Capture request identity mismatch' using errcode='42501';end if;
 select * into a from public.ezyvet_attachment_download_attempts where request_id=p_id order by attempt_no desc limit 1;
 if r.status<>'pending' or p_lease_id is null or a.lease_id is distinct from p_lease_id or a.lease_until<=clock_timestamp()
  or exists(select 1 from public.ezyvet_attachment_download_failures where lease_id=a.lease_id) then raise exception 'Capture worker lease changed' using errcode='40001';end if;
 return r;
end $$;
create function public.prepare_ezyvet_attachment_capture(p_id uuid,p_actor uuid,p_lease_id uuid,p_request_hash text,p_content_sha256 text,p_file_size bigint,p_mime_type text,p_before_metadata jsonb,p_after_metadata jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare r public.ezyvet_attachment_download_requests;i public.ezyvet_attachment_capture_intents;context jsonb;path text;fingerprint text;
begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_request_hash is null or p_content_sha256 is null or p_content_sha256 !~ '^[a-f0-9]{64}$' or p_file_size is null or p_file_size not between 1 and 20971520 or p_mime_type is null or p_mime_type not in('application/pdf','image/jpeg','image/png')
  or p_before_metadata is null or p_after_metadata is null or jsonb_typeof(p_before_metadata)<>'object' or p_before_metadata is distinct from p_after_metadata or octet_length(p_before_metadata::text)>2097152 then raise exception 'Exact bounded capture evidence required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,6600));
 select * into r from public.ezyvet_attachment_download_requests where id=p_id for update;
 if r.id is null or row(r.actor_id,r.request_hash) is distinct from row(p_actor,p_request_hash) then raise exception 'Capture request identity mismatch' using errcode='42501';end if;
 select * into i from public.ezyvet_attachment_capture_intents where request_id=p_id;
 if found then
  if row(i.content_sha256,i.file_size,i.mime_type,i.before_metadata,i.after_metadata) is distinct from row(p_content_sha256,p_file_size,p_mime_type,p_before_metadata,p_after_metadata) then raise exception 'Reserved capture evidence changed' using errcode='40001';end if;
  return to_jsonb(i);
 end if;
 r:=public.ezyvet_attachment_require_lease(p_id,p_actor,p_lease_id,p_request_hash);
 context:=public.ezyvet_attachment_download_context(p_actor,r.pet_id,(r.request_payload->>'run_id')::uuid,(r.request_payload->>'page')::integer,(r.request_payload->>'snapshot_id')::uuid,r.request_payload->>'payload_hash',(r.request_payload->>'observed_head_version')::integer);
 if context is distinct from r.source_context or p_before_metadata is distinct from context->'attachment_metadata' then raise exception 'SOURCE_ATTACHMENT_METADATA_CHANGED' using errcode='40001';end if;
 if p_before_metadata->>'mime_type' is not null and lower(trim(split_part(p_before_metadata->>'mime_type',';',1))) not in(p_mime_type,'application/octet-stream') then raise exception 'Capture MIME conflicts with source' using errcode='23514';end if;
 -- Source locks may have waited beyond the original lease check.
 perform public.ezyvet_attachment_require_lease(p_id,p_actor,p_lease_id,p_request_hash);
 path:=p_actor::text||'/'||r.pet_id::text||'/'||p_id::text||'/'||gen_random_uuid()::text||'/original';
 fingerprint:=encode(digest(jsonb_build_array(p_id,p_actor,r.pet_id,p_request_hash,p_content_sha256,p_file_size,p_mime_type,p_before_metadata,p_after_metadata,'ezyvet-attachments',path)::text,'sha256'),'hex');
 insert into public.ezyvet_attachment_capture_intents(request_id,actor_id,pet_id,originating_lease_id,request_hash,intent_hash,bucket,object_path,content_sha256,file_size,mime_type,before_metadata,after_metadata)
 values(p_id,p_actor,r.pet_id,p_lease_id,p_request_hash,fingerprint,'ezyvet-attachments',path,p_content_sha256,p_file_size,p_mime_type,p_before_metadata,p_after_metadata) returning * into i;
 return to_jsonb(i);
end $$;
create function public.complete_ezyvet_attachment_capture(p_id uuid,p_actor uuid,p_lease_id uuid,p_request_hash text,p_intent_hash text,p_verified_sha256 text,p_verified_size bigint,p_verified_mime text,p_final_metadata jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare r public.ezyvet_attachment_download_requests;i public.ezyvet_attachment_capture_intents;c public.ezyvet_attachment_captures;context jsonb;o storage.objects;
begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,6600));
 select * into r from public.ezyvet_attachment_download_requests where id=p_id for update;
 select * into i from public.ezyvet_attachment_capture_intents where request_id=p_id;
 if i.request_id is null or row(r.actor_id,r.request_hash,i.intent_hash,i.content_sha256,i.file_size,i.mime_type,i.after_metadata) is distinct from row(p_actor,p_request_hash,p_intent_hash,p_verified_sha256,p_verified_size,p_verified_mime,p_final_metadata) then raise exception 'Stored original verification mismatch' using errcode='42501';end if;
 select * into c from public.ezyvet_attachment_captures where request_id=p_id;
 if found then return to_jsonb(c);end if;
 r:=public.ezyvet_attachment_require_lease(p_id,p_actor,p_lease_id,p_request_hash);
 context:=public.ezyvet_attachment_download_context(p_actor,r.pet_id,(r.request_payload->>'run_id')::uuid,(r.request_payload->>'page')::integer,(r.request_payload->>'snapshot_id')::uuid,r.request_payload->>'payload_hash',(r.request_payload->>'observed_head_version')::integer);
 if context is distinct from r.source_context or p_final_metadata is distinct from context->'attachment_metadata' then raise exception 'SOURCE_ATTACHMENT_METADATA_CHANGED' using errcode='40001';end if;
 select * into o from storage.objects where bucket_id=i.bucket and name=i.object_path for share;
 if o.id is null or o.metadata->>'size' is distinct from i.file_size::text or o.metadata->>'mimetype' is distinct from i.mime_type then raise exception 'Exact private original is unavailable' using errcode='23514';end if;
 -- Recheck after all source/object lock waits before recording fresh completion.
 perform public.ezyvet_attachment_require_lease(p_id,p_actor,p_lease_id,p_request_hash);
 insert into public.ezyvet_attachment_captures(request_id,actor_id,pet_id,lease_id,intent_hash,capture_hash,storage_object_id,bucket,object_path,content_sha256,file_size,mime_type)
 values(p_id,p_actor,r.pet_id,p_lease_id,i.intent_hash,encode(digest(jsonb_build_array(i.intent_hash,o.id,i.bucket,i.object_path,i.content_sha256,i.file_size,i.mime_type)::text,'sha256'),'hex'),o.id,i.bucket,i.object_path,i.content_sha256,i.file_size,i.mime_type) returning * into c;
 update public.ezyvet_attachment_download_requests set status='captured',resolved_at=clock_timestamp() where id=p_id and actor_id=p_actor;
 return to_jsonb(c);
end $$;
-- Upload with the actor's JWT, never the service-role key. No overwrite or delete policy exists.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('ezyvet-attachments','ezyvet-attachments',false,20971520,array['application/pdf','image/jpeg','image/png']);
create function public.ezyvet_attachment_storage_insert(p_path text) returns boolean language plpgsql security definer set search_path=public as $$
declare i public.ezyvet_attachment_capture_intents;r public.ezyvet_attachment_download_requests;a public.ezyvet_attachment_download_attempts;
begin
 if public.ezyvet_is_active_admin(auth.uid()) is not true then return false;end if;
 select * into i from public.ezyvet_attachment_capture_intents where object_path=p_path;
 if not found or i.actor_id is distinct from auth.uid() then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(i.request_id::text,6600));
 select * into r from public.ezyvet_attachment_download_requests where id=i.request_id for share;
 select * into a from public.ezyvet_attachment_download_attempts where request_id=i.request_id order by attempt_no desc limit 1;
 -- Authorization may change while the request advisory/row lock is waiting.
 return public.ezyvet_is_active_admin(auth.uid()) and r.status='pending' and a.lease_until>clock_timestamp() and not exists(select 1 from public.ezyvet_attachment_download_failures where lease_id=a.lease_id);
end $$;
create function public.ezyvet_attachment_storage_read(p_path text) returns boolean language sql stable security definer set search_path=public as $$
 select public.ezyvet_is_active_admin(auth.uid()) and exists(select 1 from public.ezyvet_attachment_capture_intents where object_path=p_path and actor_id=auth.uid());
$$;
create policy "Upload owned reserved API attachment" on storage.objects for insert to authenticated with check(bucket_id='ezyvet-attachments' and public.ezyvet_attachment_storage_insert(name));
create policy "Read owned API attachment evidence" on storage.objects for select to authenticated using(bucket_id='ezyvet-attachments' and public.ezyvet_attachment_storage_read(name));

create or replace function public.ezyvet_attachment_source_slot(p_origin text,p_site text) returns void language plpgsql security definer set search_path=public as $$
begin
 -- Same source/resource serialization as the existing metadata core.
 perform pg_advisory_xact_lock(hashtextextended(p_origin||':'||p_site||':attachment',0));
 if exists(select 1 from public.ezyvet_import_runs where source_origin=p_origin and source_site_uid=p_site and resource='attachment' and (lease_until>clock_timestamp() or retry_after>clock_timestamp()))
 or exists(select 1 from public.ezyvet_attachment_download_attempts a join public.ezyvet_attachment_download_requests r on r.id=a.request_id left join public.ezyvet_attachment_download_failures f using(lease_id)
  where a.source_origin=p_origin and a.source_site_uid=p_site and ((r.status='pending' and f.lease_id is null and a.lease_until>clock_timestamp()) or f.retry_after>clock_timestamp())) then
  raise exception 'Attachment source busy or cooling down' using errcode='55P03';
 end if;
end $$;

create or replace function public.claim_ezyvet_attachment_download(p_id uuid,p_actor uuid,p_pet_id uuid,p_request_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.ezyvet_attachment_download_requests;a public.ezyvet_attachment_download_attempts;f public.ezyvet_attachment_download_failures;context jsonb;n integer;
begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_pet_id is null or p_request_hash is null then raise exception 'Exact owned download required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,6600));
 select * into r from public.ezyvet_attachment_download_requests where id=p_id for update;
 if r.id is null or row(r.actor_id,r.pet_id,r.request_hash) is distinct from row(p_actor,p_pet_id,p_request_hash) then raise exception 'Download identity mismatch' using errcode='42501';end if;
 if r.status='captured' then return jsonb_build_object('request_id',p_id,'pet_id',r.pet_id,'request_hash',r.request_hash,'status','captured','capture',(select to_jsonb(c) from public.ezyvet_attachment_captures c where request_id=p_id));end if;
 if r.status<>'pending' then raise exception 'Download request no longer pending' using errcode='23514';end if;
 select * into a from public.ezyvet_attachment_download_attempts where request_id=p_id order by attempt_no desc limit 1;
 if found then
  select * into f from public.ezyvet_attachment_download_failures where lease_id=a.lease_id;
  if f.lease_id is null and a.lease_until>clock_timestamp() then raise exception 'Download already leased' using errcode='55P03';end if;
  if f.lease_id is not null and not f.retryable then raise exception 'Download discrepancy requires a new reviewed request' using errcode='23514';end if;
  if f.retry_after>clock_timestamp() then raise exception 'Download cooling down' using errcode='55P03';end if;
 end if;
 n:=coalesce(a.attempt_no,0)+1;
 context:=public.ezyvet_attachment_download_context(p_actor,p_pet_id,(r.request_payload->>'run_id')::uuid,(r.request_payload->>'page')::integer,
  (r.request_payload->>'snapshot_id')::uuid,r.request_payload->>'payload_hash',(r.request_payload->>'observed_head_version')::integer);
 if context is distinct from r.source_context then raise exception 'SOURCE_ATTACHMENT_METADATA_CHANGED' using errcode='40001';end if;
 perform public.ezyvet_attachment_source_slot(context#>>'{parent,source_origin}',context#>>'{parent,source_site_uid}');
 insert into public.ezyvet_attachment_download_attempts(request_id,attempt_no,actor_id,request_hash,source_origin,source_site_uid)
 values(p_id,n,p_actor,p_request_hash,context#>>'{parent,source_origin}',context#>>'{parent,source_site_uid}') returning * into a;
 return jsonb_build_object('request_id',p_id,'pet_id',p_pet_id,'request_hash',r.request_hash,'lease_id',a.lease_id,'lease_until',a.lease_until,'attempt_no',a.attempt_no,'source_context',context,'capture_intent',(select to_jsonb(i) from public.ezyvet_attachment_capture_intents i where request_id=p_id));
end $$;

create or replace function public.abandon_ezyvet_attachment_download(p_id uuid,p_pet_id uuid,p_confirmed boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();r public.ezyvet_attachment_download_requests;
begin
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_pet_id is null or p_confirmed is distinct from true then raise exception 'Explicit attachment abandonment required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,6600));
 select * into r from public.ezyvet_attachment_download_requests where id=p_id for update;
 if found then
  if row(r.actor_id,r.pet_id) is distinct from row(actor,p_pet_id) then raise exception 'Attachment recovery identity mismatch' using errcode='42501';end if;
  if r.status='captured' then raise exception 'Captured evidence cannot be abandoned' using errcode='23514';end if;
  if exists(select 1 from public.ezyvet_attachment_download_attempts a where request_id=p_id and lease_until>clock_timestamp() and not exists(select 1 from public.ezyvet_attachment_download_failures f where f.lease_id=a.lease_id)) then raise exception 'Download worker still holds a lease' using errcode='55P03';end if;
  if r.status='pending' then update public.ezyvet_attachment_download_requests set status='abandoned',resolved_at=clock_timestamp() where id=p_id and actor_id=actor;end if;
 else
  -- A tombstone prevents a delayed prepare from resurrecting a discarded request.
  insert into public.ezyvet_attachment_download_requests(id,actor_id,pet_id,status,resolved_at) values(p_id,actor,p_pet_id,'abandoned',clock_timestamp());
 end if;
 return public.ezyvet_attachment_download_projection(p_id);
end $$;


create or replace function public.ezyvet_attachment_download_projection(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('request',to_jsonb(r),'capture_intent',to_jsonb(i)-'originating_lease_id','capture',to_jsonb(c)-'lease_id','download_available',false,'worker',
  case when a.lease_id is null then null else jsonb_build_object('attempt_no',a.attempt_no,'lease_active',r.status='pending' and f.lease_id is null and a.lease_until>now(),
   'lease_until',a.lease_until,'error_code',f.code,'retryable',f.retryable,'retry_after',f.retry_after) end)
 from public.ezyvet_attachment_download_requests r
 left join lateral(select * from public.ezyvet_attachment_download_attempts where request_id=r.id order by attempt_no desc limit 1) a on true
 left join public.ezyvet_attachment_download_failures f using(lease_id)
 left join public.ezyvet_attachment_capture_intents i on i.request_id=r.id
 left join public.ezyvet_attachment_captures c on c.request_id=r.id where r.id=p_id;
$$;
-- Keep list responses small despite the additional immutable before/after evidence.
create or replace function public.list_ezyvet_attachment_downloads(p_pet_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=auth.uid();items jsonb;more boolean;lastrow jsonb;
begin
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_pet_id is null or p_limit is null or p_limit not between 1 and 50 or(p_before_at is null)<>(p_before_id is null) then raise exception 'Invalid attachment request cursor' using errcode='23514';end if;
 -- Discovery omits potentially large raw metadata; owned recovery returns it in full.
 select coalesce(jsonb_agg(public.ezyvet_attachment_download_projection(id) #- '{request,source_context,attachment_metadata}' #- '{capture_intent,before_metadata}' #- '{capture_intent,after_metadata}' order by created_at desc,id desc),'[]') into items
 from(select id,created_at from public.ezyvet_attachment_download_requests where actor_id=actor and pet_id=p_pet_id
  and(p_before_at is null or(created_at,id)<(p_before_at,p_before_id)) order by created_at desc,id desc limit p_limit+1) s;
 more:=jsonb_array_length(items)>p_limit;if more then items:=items-p_limit;end if;lastrow:=items->(jsonb_array_length(items)-1)->'request';
 return jsonb_build_object('requests',items,'has_more',more,'next_cursor',case when more then jsonb_build_object('before_at',lastrow->'created_at','before_id',lastrow->'id') end);
end $$;

do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in
 ('ezyvet_attachment_require_lease','prepare_ezyvet_attachment_capture','complete_ezyvet_attachment_capture','ezyvet_attachment_storage_insert','ezyvet_attachment_storage_read') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in ('prepare_ezyvet_attachment_capture','complete_ezyvet_attachment_capture') then execute format('grant execute on function %s to service_role',f.signature);
  elsif f.proname in ('ezyvet_attachment_storage_insert','ezyvet_attachment_storage_read') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
