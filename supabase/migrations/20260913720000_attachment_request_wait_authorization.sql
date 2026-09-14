-- Recheck staff authority after request/source/FK waits, including exact retries.
create or replace function public.prepare_ezyvet_attachment_download(p_id uuid,p_pet_id uuid,p_run_id uuid,p_page integer,p_snapshot_id uuid,p_payload_hash text,p_observed_head_version integer)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare actor uuid:=auth.uid();r public.ezyvet_attachment_download_requests;payload jsonb;context jsonb;
begin
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_pet_id is null then raise exception 'Owned attachment operation and patient required' using errcode='23514';end if;
 payload:=jsonb_build_object('run_id',p_run_id,'page',p_page,'snapshot_id',p_snapshot_id,'payload_hash',p_payload_hash,'observed_head_version',p_observed_head_version);
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,6600));
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into r from public.ezyvet_attachment_download_requests where id=p_id;
 if found then
  if row(r.actor_id,r.pet_id,r.request_payload) is distinct from row(actor,p_pet_id,payload) or r.status='abandoned' then
   raise exception 'Attachment operation identity cannot change or revive' using errcode='42501';end if;
  if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
  return public.ezyvet_attachment_download_projection(p_id);
 end if;
 context:=public.ezyvet_attachment_download_context(actor,p_pet_id,p_run_id,p_page,p_snapshot_id,p_payload_hash,p_observed_head_version);
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 insert into public.ezyvet_attachment_download_requests(id,actor_id,pet_id,status,request_payload,request_hash,source_context)
 values(p_id,actor,p_pet_id,'pending',payload,encode(digest(jsonb_build_array(payload,context)::text,'sha256'),'hex'),context);
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return public.ezyvet_attachment_download_projection(p_id);
end $$;

create or replace function public.abandon_ezyvet_attachment_download(p_id uuid,p_pet_id uuid,p_confirmed boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();r public.ezyvet_attachment_download_requests;
begin
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_pet_id is null or p_confirmed is distinct from true then raise exception 'Explicit attachment abandonment required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,6600));
 select * into r from public.ezyvet_attachment_download_requests where id=p_id for update;
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if r.id is not null then
  if row(r.actor_id,r.pet_id) is distinct from row(actor,p_pet_id) then raise exception 'Attachment recovery identity mismatch' using errcode='42501';end if;
  if r.status='captured' then raise exception 'Captured evidence cannot be abandoned' using errcode='23514';end if;
  if exists(select 1 from public.ezyvet_attachment_download_attempts a where request_id=p_id and lease_until>clock_timestamp() and not exists(select 1 from public.ezyvet_attachment_download_failures f where f.lease_id=a.lease_id)) then raise exception 'Download worker still holds a lease' using errcode='55P03';end if;
  if r.status='pending' then update public.ezyvet_attachment_download_requests set status='abandoned',resolved_at=clock_timestamp() where id=p_id and actor_id=actor;end if;
 else
  -- A tombstone prevents a delayed prepare from resurrecting a discarded request.
  insert into public.ezyvet_attachment_download_requests(id,actor_id,pet_id,status,resolved_at) values(p_id,actor,p_pet_id,'abandoned',clock_timestamp());
 end if;
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return public.ezyvet_attachment_download_projection(p_id);
end $$;

comment on function public.prepare_ezyvet_attachment_download(uuid,uuid,uuid,integer,uuid,text,integer) is 'Rechecks active administrator after request and source waits.';
