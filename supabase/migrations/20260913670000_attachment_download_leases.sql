-- Worker reservations only. No byte capture or Storage access is enabled here.
create table public.ezyvet_attachment_download_attempts (
 lease_id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.ezyvet_attachment_download_requests(id),
 attempt_no integer not null check(attempt_no>0),
 actor_id uuid not null references public.profiles(id),
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 source_origin text not null,source_site_uid text not null,
 created_at timestamptz not null default clock_timestamp(),
 lease_until timestamptz not null default clock_timestamp()+interval '90 seconds',
 unique(request_id,attempt_no),check(lease_until>created_at)
);
create index ezyvet_attachment_attempt_source on public.ezyvet_attachment_download_attempts(source_origin,source_site_uid,lease_until);
create table public.ezyvet_attachment_download_failures (
 lease_id uuid primary key references public.ezyvet_attachment_download_attempts(lease_id),
 code text not null check(code in ('UPSTREAM_UNAVAILABLE','RATE_LIMITED','UPSTREAM_AUTH_FAILED','UPSTREAM_SCOPE_DENIED','SOURCE_ATTACHMENT_STALE','SOURCE_ATTACHMENT_PARENT_STALE','SOURCE_ATTACHMENT_METADATA_CHANGED','ATTACHMENT_UNSUPPORTED_TYPE','ATTACHMENT_INVALID_CONTENT','ATTACHMENT_TOO_LARGE','STORAGE_UNAVAILABLE')),
 retryable boolean not null,retry_seconds integer not null check(retry_seconds between 0 and 3600),
 retry_after timestamptz,created_at timestamptz not null default clock_timestamp(),
 check(retryable=(retry_after is not null)),check(retryable=(retry_seconds>0))
);
do $$declare t text;begin foreach t in array array['ezyvet_attachment_download_attempts','ezyvet_attachment_download_failures'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger immutable_attachment_worker before update or delete on public.%I for each row execute function public.guard_inquiry_history()',t);
end loop;end $$;
create function public.ezyvet_attachment_source_slot(p_origin text,p_site text) returns void language plpgsql security definer set search_path=public as $$
begin
 -- Same source/resource serialization as the existing metadata core.
 perform pg_advisory_xact_lock(hashtextextended(p_origin||':'||p_site||':attachment',0));
 if exists(select 1 from public.ezyvet_import_runs where source_origin=p_origin and source_site_uid=p_site and resource='attachment' and (lease_until>clock_timestamp() or retry_after>clock_timestamp()))
 or exists(select 1 from public.ezyvet_attachment_download_attempts a left join public.ezyvet_attachment_download_failures f using(lease_id)
  where a.source_origin=p_origin and a.source_site_uid=p_site and ((f.lease_id is null and a.lease_until>clock_timestamp()) or f.retry_after>clock_timestamp())) then
  raise exception 'Attachment source busy or cooling down' using errcode='55P03';
 end if;
end $$;
create function public.claim_ezyvet_attachment_download(p_id uuid,p_actor uuid,p_pet_id uuid,p_request_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.ezyvet_attachment_download_requests;a public.ezyvet_attachment_download_attempts;f public.ezyvet_attachment_download_failures;context jsonb;n integer;
begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_pet_id is null or p_request_hash is null then raise exception 'Exact owned download required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,6600));
 select * into r from public.ezyvet_attachment_download_requests where id=p_id for update;
 if r.id is null or row(r.actor_id,r.pet_id,r.request_hash) is distinct from row(p_actor,p_pet_id,p_request_hash) then raise exception 'Download identity mismatch' using errcode='42501';end if;
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
 return jsonb_build_object('request_id',p_id,'pet_id',p_pet_id,'request_hash',r.request_hash,'lease_id',a.lease_id,'lease_until',a.lease_until,'attempt_no',a.attempt_no,'source_context',context);
end $$;
create function public.fail_ezyvet_attachment_download(p_id uuid,p_actor uuid,p_lease_id uuid,p_request_hash text,p_code text,p_retry_seconds integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.ezyvet_attachment_download_requests;a public.ezyvet_attachment_download_attempts;f public.ezyvet_attachment_download_failures;retryable boolean;
begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_lease_id is null or p_request_hash is null or p_code is null or p_retry_seconds is null then raise exception 'Exact worker failure required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,6600));
 select * into r from public.ezyvet_attachment_download_requests where id=p_id;
 select * into a from public.ezyvet_attachment_download_attempts where lease_id=p_lease_id and request_id=p_id;
 if a.lease_id is null or row(r.actor_id,r.request_hash,a.actor_id,a.request_hash) is distinct from row(p_actor,p_request_hash,p_actor,p_request_hash) then raise exception 'Download failure identity mismatch' using errcode='42501';end if;
 select * into f from public.ezyvet_attachment_download_failures where lease_id=p_lease_id;
 if found then
  if row(f.code,f.retry_seconds) is distinct from row(p_code,p_retry_seconds) then raise exception 'Saved download failure changed' using errcode='40001';end if;
  return to_jsonb(f)-'lease_id';
 end if;
 if r.status<>'pending' or exists(select 1 from public.ezyvet_attachment_download_attempts where request_id=p_id and attempt_no>a.attempt_no) then raise exception 'Download worker superseded' using errcode='40001';end if;
 if p_code not in ('UPSTREAM_UNAVAILABLE','RATE_LIMITED','UPSTREAM_AUTH_FAILED','UPSTREAM_SCOPE_DENIED','SOURCE_ATTACHMENT_STALE','SOURCE_ATTACHMENT_PARENT_STALE','SOURCE_ATTACHMENT_METADATA_CHANGED','ATTACHMENT_UNSUPPORTED_TYPE','ATTACHMENT_INVALID_CONTENT','ATTACHMENT_TOO_LARGE','STORAGE_UNAVAILABLE') then raise exception 'Invalid download failure code' using errcode='23514';end if;
 retryable:=p_code in ('UPSTREAM_UNAVAILABLE','RATE_LIMITED','UPSTREAM_AUTH_FAILED','STORAGE_UNAVAILABLE');
 if (retryable and p_retry_seconds not between 1 and 3600) or (not retryable and p_retry_seconds<>0) then raise exception 'Invalid download retry policy' using errcode='23514';end if;
 -- Serialize failure publication with both metadata and other download claims.
 perform pg_advisory_xact_lock(hashtextextended(a.source_origin||':'||a.source_site_uid||':attachment',0));
 insert into public.ezyvet_attachment_download_failures(lease_id,code,retryable,retry_seconds,retry_after)
 values(p_lease_id,p_code,retryable,p_retry_seconds,case when retryable then clock_timestamp()+make_interval(secs=>p_retry_seconds) end) returning * into f;
 return to_jsonb(f)-'lease_id';
end $$;
-- Keep service lease IDs private while exposing an actionable, bounded worker state.
create or replace function public.ezyvet_attachment_download_projection(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('request',to_jsonb(r),'capture',null,'download_available',false,'worker',
  case when a.lease_id is null then null else jsonb_build_object('attempt_no',a.attempt_no,'lease_active',f.lease_id is null and a.lease_until>now(),
   'lease_until',a.lease_until,'error_code',f.code,'retryable',f.retryable,'retry_after',f.retry_after) end)
 from public.ezyvet_attachment_download_requests r
 left join lateral(select * from public.ezyvet_attachment_download_attempts where request_id=r.id order by attempt_no desc limit 1) a on true
 left join public.ezyvet_attachment_download_failures f using(lease_id) where r.id=p_id;
$$;

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
  if exists(select 1 from public.ezyvet_attachment_download_attempts a where request_id=p_id and lease_until>clock_timestamp() and not exists(select 1 from public.ezyvet_attachment_download_failures f where f.lease_id=a.lease_id)) then raise exception 'Download worker still holds a lease' using errcode='55P03';end if;
  if r.status='pending' then update public.ezyvet_attachment_download_requests set status='abandoned',resolved_at=clock_timestamp() where id=p_id and actor_id=actor;end if;
 else
  -- A tombstone prevents a delayed prepare from resurrecting a discarded request.
  insert into public.ezyvet_attachment_download_requests(id,actor_id,pet_id,status,resolved_at) values(p_id,actor,p_pet_id,'abandoned',clock_timestamp());
 end if;
 return public.ezyvet_attachment_download_projection(p_id);
end $$;

create or replace function public.claim_ezyvet_attachment_import(p_id uuid,p_actor uuid,p_site_uid text,p_source_origin text,p_animal_link_id uuid,p_parent_type text,p_parent_snapshot_id uuid,p_parent_payload_hash text,p_parent_observed_head_version integer) returns jsonb language plpgsql security definer set search_path=public as $$
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
 perform public.ezyvet_attachment_source_slot(p_source_origin,p_site_uid);
 r:=public.claim_ezyvet_import_core(p_id,p_actor,p_site_uid,'attachment',p_source_origin);
 insert into public.ezyvet_attachment_runs(run_id,actor_id,animal_link_id,pet_id,parent_context) values(p_id,p_actor,p_animal_link_id,(context->>'pet_id')::uuid,context) on conflict(run_id) do nothing;
 return to_jsonb(r)||jsonb_build_object('scope','parent_scoped','parent_context',context);
end $$;

do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in
 ('ezyvet_attachment_source_slot','claim_ezyvet_attachment_download','fail_ezyvet_attachment_download') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in ('claim_ezyvet_attachment_download','fail_ezyvet_attachment_download') then execute format('grant execute on function %s to service_role',f.signature);end if;
 end loop;
end $$;
