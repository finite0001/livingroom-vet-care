-- Durable API attachment intent. Byte worker/capture transitions are added separately.
create table public.ezyvet_attachment_download_requests (
 id uuid primary key,
 actor_id uuid not null references public.profiles(id),
 pet_id uuid not null references public.pets(id),
 status text not null check(status in ('pending','abandoned')),
 request_payload jsonb,
 request_hash text check(request_hash is null or request_hash ~ '^[a-f0-9]{64}$'),
 source_context jsonb,
 created_at timestamptz not null default clock_timestamp(),
 resolved_at timestamptz,
 check(status='abandoned' or (request_payload is not null and request_hash is not null and source_context is not null)),
 check((status='abandoned')=(resolved_at is not null))
);
create index ezyvet_attachment_download_owner on public.ezyvet_attachment_download_requests(actor_id,pet_id,created_at desc,id desc);
alter table public.ezyvet_attachment_download_requests enable row level security;
revoke all on public.ezyvet_attachment_download_requests from public,anon,authenticated,service_role;
create function public.ezyvet_attachment_download_guard() returns trigger language plpgsql set search_path=public as $$
begin
 if TG_OP='DELETE' or OLD.status<>'pending' or NEW.status<>'abandoned'
  or (to_jsonb(NEW)-array['status','resolved_at']) is distinct from (to_jsonb(OLD)-array['status','resolved_at']) then
  raise exception 'Attachment download intent is immutable' using errcode='23514';
 end if;
 return NEW;
end $$;
create trigger immutable_attachment_download before update or delete on public.ezyvet_attachment_download_requests
for each row execute function public.ezyvet_attachment_download_guard();

-- Private currentness collector. Intake owns run-before-parent-before-attachment order.
create function public.ezyvet_attachment_download_context(p_actor uuid,p_pet_id uuid,p_run_id uuid,p_page integer,p_snapshot_id uuid,p_hash text,p_version integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.ezyvet_import_runs;c public.ezyvet_attachment_runs;s public.ezyvet_import_snapshots;h public.ezyvet_identity_heads;context jsonb;
begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_pet_id is null or p_run_id is null or p_page is null or p_page not between 1 and 1000 or p_snapshot_id is null
  or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_version is null or p_version<1 then
  raise exception 'Exact attachment observation required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('attachment-run:'||p_run_id::text,0));
 select * into r from public.ezyvet_import_runs where id=p_run_id for share;
 select * into c from public.ezyvet_attachment_runs where run_id=p_run_id;
 if c.run_id is null or row(c.actor_id,c.pet_id,r.requested_by,r.resource) is distinct from row(p_actor,p_pet_id,p_actor,'attachment'::text) then
  raise exception 'Owned patient attachment run required' using errcode='42501';end if;
 -- A committed page is usable even if later pages have not completed. Its run/page
 -- identity remains in the context so this cannot be presented as a complete migration.
 if not exists(select 1 from public.ezyvet_attachment_page_observations where run_id=p_run_id and page=p_page and snapshot_id=p_snapshot_id and head_version=p_version) then
  raise exception 'Attachment page observation mismatch' using errcode='42501';end if;
 context:=public.ezyvet_attachment_parent_context(c.animal_link_id,r.source_origin,r.source_site_uid,c.parent_context->>'parent_type',
  (c.parent_context->>'parent_snapshot_id')::uuid,c.parent_context->>'parent_payload_hash',(c.parent_context->>'parent_observed_head_version')::integer);
 if context is distinct from c.parent_context then raise exception 'Attachment parent context changed' using errcode='40001';end if;
 select * into s from public.ezyvet_import_snapshots where id=p_snapshot_id;
 if s.id is null or row(s.source_origin,s.source_site_uid,s.resource,s.payload_hash,s.payload->>'id',s.payload->>'record_type',s.payload->>'record_id')
  is distinct from row(r.source_origin,r.source_site_uid,'attachment'::text,p_hash,s.external_id,context->>'parent_type',context->>'parent_external_id') then
  raise exception 'Attachment source context mismatch' using errcode='42501';end if;
 select * into h from public.ezyvet_identity_heads where source_origin=s.source_origin and source_site_uid=s.source_site_uid and resource=s.resource and external_id=s.external_id for share;
 if h.snapshot_id is distinct from s.id or h.version is distinct from p_version then raise exception 'SOURCE_ATTACHMENT_STALE' using errcode='40001';end if;
 return jsonb_build_object('schema_version',1,'parent',context,'run_id',p_run_id,'page',p_page,
  'attachment_snapshot_id',s.id,'attachment_external_id',s.external_id,'attachment_payload_hash',s.payload_hash,
  'attachment_observed_head_version',p_version,'attachment_metadata',s.payload);
end $$;
create function public.ezyvet_attachment_download_projection(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('request',to_jsonb(r),'capture',null,'download_available',false)
 from public.ezyvet_attachment_download_requests r where id=p_id;
$$;
create function public.prepare_ezyvet_attachment_download(p_id uuid,p_pet_id uuid,p_run_id uuid,p_page integer,p_snapshot_id uuid,p_payload_hash text,p_observed_head_version integer)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare actor uuid:=auth.uid();r public.ezyvet_attachment_download_requests;payload jsonb;context jsonb;
begin
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_pet_id is null then raise exception 'Owned attachment operation and patient required' using errcode='23514';end if;
 payload:=jsonb_build_object('run_id',p_run_id,'page',p_page,'snapshot_id',p_snapshot_id,'payload_hash',p_payload_hash,'observed_head_version',p_observed_head_version);
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,6600));
 select * into r from public.ezyvet_attachment_download_requests where id=p_id;
 if found then
  if row(r.actor_id,r.pet_id,r.request_payload) is distinct from row(actor,p_pet_id,payload) or r.status='abandoned' then
   raise exception 'Attachment operation identity cannot change or revive' using errcode='42501';end if;
  return public.ezyvet_attachment_download_projection(p_id);
 end if;
 context:=public.ezyvet_attachment_download_context(actor,p_pet_id,p_run_id,p_page,p_snapshot_id,p_payload_hash,p_observed_head_version);
 insert into public.ezyvet_attachment_download_requests(id,actor_id,pet_id,status,request_payload,request_hash,source_context)
 values(p_id,actor,p_pet_id,'pending',payload,encode(digest(jsonb_build_array(payload,context)::text,'sha256'),'hex'),context);
 return public.ezyvet_attachment_download_projection(p_id);
end $$;
create function public.recover_ezyvet_attachment_download(p_id uuid,p_pet_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=auth.uid();r public.ezyvet_attachment_download_requests;
begin
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_pet_id is null then raise exception 'Owned attachment operation and patient required' using errcode='23514';end if;
 select * into r from public.ezyvet_attachment_download_requests where id=p_id;if not found then return null;end if;
 if row(r.actor_id,r.pet_id) is distinct from row(actor,p_pet_id) then raise exception 'Attachment recovery identity mismatch' using errcode='42501';end if;
 return public.ezyvet_attachment_download_projection(p_id);
end $$;
create function public.abandon_ezyvet_attachment_download(p_id uuid,p_pet_id uuid,p_confirmed boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();r public.ezyvet_attachment_download_requests;
begin
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_pet_id is null or p_confirmed is distinct from true then raise exception 'Explicit attachment abandonment required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,6600));
 select * into r from public.ezyvet_attachment_download_requests where id=p_id for update;
 if found then
  if row(r.actor_id,r.pet_id) is distinct from row(actor,p_pet_id) then raise exception 'Attachment recovery identity mismatch' using errcode='42501';end if;
  if r.status='pending' then update public.ezyvet_attachment_download_requests set status='abandoned',resolved_at=clock_timestamp() where id=p_id and actor_id=actor;end if;
 else
  -- A tombstone prevents a delayed prepare from resurrecting a discarded request.
  insert into public.ezyvet_attachment_download_requests(id,actor_id,pet_id,status,resolved_at) values(p_id,actor,p_pet_id,'abandoned',clock_timestamp());
 end if;
 return public.ezyvet_attachment_download_projection(p_id);
end $$;
create function public.list_ezyvet_attachment_downloads(p_pet_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=auth.uid();items jsonb;more boolean;lastrow jsonb;
begin
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_pet_id is null or p_limit is null or p_limit not between 1 and 50 or(p_before_at is null)<>(p_before_id is null) then raise exception 'Invalid attachment request cursor' using errcode='23514';end if;
 -- Discovery omits potentially large raw metadata; owned recovery returns it in full.
 select coalesce(jsonb_agg(public.ezyvet_attachment_download_projection(id) #- '{request,source_context,attachment_metadata}' order by created_at desc,id desc),'[]') into items
 from(select id,created_at from public.ezyvet_attachment_download_requests where actor_id=actor and pet_id=p_pet_id
  and(p_before_at is null or(created_at,id)<(p_before_at,p_before_id)) order by created_at desc,id desc limit p_limit+1) s;
 more:=jsonb_array_length(items)>p_limit;if more then items:=items-p_limit;end if;lastrow:=items->(jsonb_array_length(items)-1)->'request';
 return jsonb_build_object('requests',items,'has_more',more,'next_cursor',case when more then jsonb_build_object('before_at',lastrow->'created_at','before_id',lastrow->'id') end);
end $$;
do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in
 ('ezyvet_attachment_download_guard','ezyvet_attachment_download_context','ezyvet_attachment_download_projection','prepare_ezyvet_attachment_download','recover_ezyvet_attachment_download','abandon_ezyvet_attachment_download','list_ezyvet_attachment_downloads') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in ('prepare_ezyvet_attachment_download','recover_ezyvet_attachment_download','abandon_ezyvet_attachment_download','list_ezyvet_attachment_downloads') then
   execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
