-- Cleanup is explicit abandoned-intent maintenance, never automatic expiry of
-- recoverable pending evidence. Physical deletion belongs to the Storage API.
create table public.ezyvet_attachment_cleanup_attempts (
 id uuid primary key,request_id uuid not null references public.ezyvet_attachment_capture_intents(request_id),
 actor_id uuid not null references public.profiles(id),pet_id uuid not null references public.pets(id),
 request_hash text not null,intent_hash text not null,
 lease_id uuid not null unique default gen_random_uuid(),
 created_at timestamptz not null default clock_timestamp(),
 lease_until timestamptz not null default clock_timestamp()+interval '90 seconds',
 check(lease_until>created_at)
);
create index ezyvet_attachment_cleanup_request on public.ezyvet_attachment_cleanup_attempts(request_id,created_at,id);
create table public.ezyvet_attachment_cleanup_receipts (
 cleanup_id uuid primary key references public.ezyvet_attachment_cleanup_attempts(id),
 request_id uuid not null references public.ezyvet_attachment_capture_intents(request_id),
 actor_id uuid not null references public.profiles(id),
 intent_hash text not null,verified_absent_at timestamptz not null default clock_timestamp()
);
do $$declare t text;begin
 foreach t in array array['ezyvet_attachment_cleanup_attempts','ezyvet_attachment_cleanup_receipts'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
  execute format('create trigger immutable_attachment_cleanup before update or delete on public.%I for each row execute function public.guard_inquiry_history()',t);
 end loop;
end $$;

create function public.ezyvet_attachment_cleanup_ready(p_id uuid,p_actor uuid) returns boolean
language plpgsql security definer set search_path=public as $$
declare r public.ezyvet_attachment_download_requests;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,6600));
 select * into r from public.ezyvet_attachment_download_requests where id=p_id for share;
 -- Recheck the role after waiting, including for Storage policy calls.
 return public.ezyvet_is_active_admin(p_actor) and r.actor_id=p_actor and r.status='abandoned'
  and r.resolved_at+interval '2 minutes'<=clock_timestamp()
  and not exists(select 1 from public.ezyvet_attachment_captures where request_id=p_id)
  and not exists(select 1 from public.ezyvet_attachment_download_attempts where request_id=p_id and lease_until+interval '2 minutes'>clock_timestamp());
end $$;

create function public.claim_ezyvet_attachment_cleanup(p_cleanup_id uuid,p_id uuid,p_actor uuid,p_pet_id uuid,p_request_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.ezyvet_attachment_download_requests;i public.ezyvet_attachment_capture_intents;a public.ezyvet_attachment_cleanup_attempts;
begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_cleanup_id is null or p_id is null or p_pet_id is null or p_request_hash is null then raise exception 'Exact owned cleanup required' using errcode='23514';end if;
 -- Same cleanup UUID cannot be allocated concurrently to different requests.
 perform pg_advisory_xact_lock(hashtextextended(p_cleanup_id::text,6900));
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,6600));
 select * into r from public.ezyvet_attachment_download_requests where id=p_id for update;
 select * into i from public.ezyvet_attachment_capture_intents where request_id=p_id;
 if i.request_id is null or row(r.actor_id,r.pet_id,r.request_hash) is distinct from row(p_actor,p_pet_id,p_request_hash) then raise exception 'Cleanup identity mismatch' using errcode='42501';end if;
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into a from public.ezyvet_attachment_cleanup_attempts where id=p_cleanup_id;
 if found then
  if row(a.request_id,a.actor_id,a.pet_id,a.request_hash,a.intent_hash) is distinct from row(p_id,p_actor,p_pet_id,p_request_hash,i.intent_hash) then raise exception 'Cleanup identity mismatch' using errcode='42501';end if;
  -- Recovery does not renew an expired lease or promise the object is still absent.
  return jsonb_build_object('attempt',to_jsonb(a),'bucket',i.bucket,'object_path',i.object_path,'receipt',(select to_jsonb(c) from public.ezyvet_attachment_cleanup_receipts c where cleanup_id=p_cleanup_id));
 end if;
 if public.ezyvet_attachment_cleanup_ready(p_id,p_actor) is not true then raise exception 'Abandoned attachment cleanup not ready' using errcode='23514';end if;
 if exists(select 1 from public.ezyvet_attachment_cleanup_attempts worker where request_id=p_id and lease_until>clock_timestamp()
  and not exists(select 1 from public.ezyvet_attachment_cleanup_receipts c where c.cleanup_id=worker.id)) then raise exception 'Cleanup worker still holds a lease' using errcode='55P03';end if;
 insert into public.ezyvet_attachment_cleanup_attempts(id,request_id,actor_id,pet_id,request_hash,intent_hash)
 values(p_cleanup_id,p_id,p_actor,p_pet_id,p_request_hash,i.intent_hash) returning * into a;
 return jsonb_build_object('attempt',to_jsonb(a),'bucket',i.bucket,'object_path',i.object_path,'receipt',null);
end $$;

create function public.ezyvet_attachment_storage_delete(p_path text) returns boolean
language plpgsql security definer set search_path=public as $$
declare i public.ezyvet_attachment_capture_intents;actor uuid:=auth.uid();
begin
 if public.ezyvet_is_active_admin(actor) is not true then return false;end if;
 select * into i from public.ezyvet_attachment_capture_intents where object_path=p_path and actor_id=actor;
 if not found or public.ezyvet_attachment_cleanup_ready(i.request_id,actor) is not true then return false;end if;
 return exists(select 1 from public.ezyvet_attachment_cleanup_attempts a where request_id=i.request_id and actor_id=actor and intent_hash=i.intent_hash
  and lease_until>clock_timestamp() and not exists(select 1 from public.ezyvet_attachment_cleanup_receipts c where c.cleanup_id=a.id));
end $$;
create policy "Delete leased abandoned API attachment" on storage.objects for delete to authenticated
 using(bucket_id='ezyvet-attachments' and public.ezyvet_attachment_storage_delete(name));

create function public.complete_ezyvet_attachment_cleanup(p_cleanup_id uuid,p_id uuid,p_actor uuid,p_lease_id uuid,p_request_hash text,p_intent_hash text,p_verified_absent boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.ezyvet_attachment_cleanup_attempts;i public.ezyvet_attachment_capture_intents;c public.ezyvet_attachment_cleanup_receipts;
begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_verified_absent is distinct from true then raise exception 'Storage absence verification required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,6600));
 select * into a from public.ezyvet_attachment_cleanup_attempts where id=p_cleanup_id;
 select * into i from public.ezyvet_attachment_capture_intents where request_id=p_id;
 if a.id is null or i.request_id is null or row(a.request_id,a.actor_id,a.lease_id,a.request_hash,a.intent_hash) is distinct from row(p_id,p_actor,p_lease_id,p_request_hash,p_intent_hash)
  or i.intent_hash is distinct from p_intent_hash then raise exception 'Cleanup identity mismatch' using errcode='42501';end if;
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into c from public.ezyvet_attachment_cleanup_receipts where cleanup_id=p_cleanup_id;
 if found then return to_jsonb(c);end if;
 if public.ezyvet_attachment_cleanup_ready(p_id,p_actor) is not true or a.lease_until<=clock_timestamp() then raise exception 'Cleanup worker lease changed' using errcode='40001';end if;
 if exists(select 1 from storage.objects where bucket_id=i.bucket and name=i.object_path) then raise exception 'Reserved object is still present' using errcode='23514';end if;
 if public.ezyvet_attachment_cleanup_ready(p_id,p_actor) is not true or a.lease_until<=clock_timestamp() then raise exception 'Cleanup worker lease changed' using errcode='40001';end if;
 -- The service worker must verify physical absence through Storage before this RPC.
 -- This records a point-in-time observation. A later sweep may issue a new cleanup UUID.
 insert into public.ezyvet_attachment_cleanup_receipts(cleanup_id,request_id,actor_id,intent_hash)
 values(p_cleanup_id,p_id,p_actor,p_intent_hash) returning * into c;
 return to_jsonb(c);
end $$;

create function public.recover_ezyvet_attachment_cleanup(p_cleanup_id uuid,p_id uuid,p_pet_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();a public.ezyvet_attachment_cleanup_attempts;r public.ezyvet_attachment_download_requests;
begin
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into r from public.ezyvet_attachment_download_requests where id=p_id;
 if r.id is null or row(r.actor_id,r.pet_id) is distinct from row(actor,p_pet_id) then raise exception 'Cleanup identity mismatch' using errcode='42501';end if;
 select * into a from public.ezyvet_attachment_cleanup_attempts where id=p_cleanup_id;
 if not found then return null;end if;
 if row(a.request_id,a.actor_id,a.pet_id) is distinct from row(p_id,actor,p_pet_id) then raise exception 'Cleanup identity mismatch' using errcode='42501';end if;
 return jsonb_build_object('attempt',to_jsonb(a)-'lease_id','receipt',(select to_jsonb(c) from public.ezyvet_attachment_cleanup_receipts c where cleanup_id=p_cleanup_id));
end $$;

do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in
 ('ezyvet_attachment_cleanup_ready','claim_ezyvet_attachment_cleanup','ezyvet_attachment_storage_delete','complete_ezyvet_attachment_cleanup','recover_ezyvet_attachment_cleanup') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in ('claim_ezyvet_attachment_cleanup','complete_ezyvet_attachment_cleanup') then execute format('grant execute on function %s to service_role',f.signature);
  elsif f.proname in ('recover_ezyvet_attachment_cleanup','ezyvet_attachment_storage_delete') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
