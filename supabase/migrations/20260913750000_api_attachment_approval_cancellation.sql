-- Cancel an unconfirmed decision without permitting a delayed approval to revive it.
create table public.ezyvet_attachment_approval_cancellations (
 id uuid primary key,actor_id uuid not null references public.profiles(id),request_id uuid not null references public.ezyvet_attachment_captures(request_id),
 pet_id uuid not null references public.pets(id),capture_hash text not null check(capture_hash ~ '^[a-f0-9]{64}$'),created_at timestamptz not null default clock_timestamp()
);
alter table public.ezyvet_attachment_approval_cancellations enable row level security;
revoke all on public.ezyvet_attachment_approval_cancellations from public,anon,authenticated,service_role;
create trigger immutable_attachment_approval_cancellation before update or delete on public.ezyvet_attachment_approval_cancellations for each row execute function public.guard_inquiry_history();
alter function public.approve_ezyvet_attachment_record(uuid,uuid,uuid,text,uuid,text,text,boolean) rename to approve_ezyvet_attachment_record_uncancelled;
revoke all on function public.approve_ezyvet_attachment_record_uncancelled(uuid,uuid,uuid,text,uuid,text,text,boolean) from public,anon,authenticated,service_role;
create function public.approve_ezyvet_attachment_record(p_id uuid,p_request_id uuid,p_pet_id uuid,p_capture_hash text,p_previous_record_id uuid,p_title text,p_review_reason text,p_attest boolean)
returns public.ezyvet_attachment_record_versions language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();
begin
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null then raise exception 'Exact approval identity required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,7300));
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if exists(select 1 from public.ezyvet_attachment_approval_cancellations where id=p_id) then raise exception 'Approval was canceled; use an explicitly new decision' using errcode='23514';end if;
 return public.approve_ezyvet_attachment_record_uncancelled(p_id,p_request_id,p_pet_id,p_capture_hash,p_previous_record_id,p_title,p_review_reason,p_attest);
end $$;

create function public.cancel_ezyvet_attachment_approval(p_id uuid,p_request_id uuid,p_pet_id uuid,p_capture_hash text,p_confirmed boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();v public.ezyvet_attachment_record_versions;c public.ezyvet_attachment_approval_cancellations;r public.ezyvet_attachment_captures;
begin
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_request_id is null or p_pet_id is null or p_capture_hash is null or p_capture_hash !~ '^[a-f0-9]{64}$' or p_confirmed is distinct from true then raise exception 'Explicit cancellation and capture identity required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,7300));
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into v from public.ezyvet_attachment_record_versions where id=p_id;
 if found then
  if row(v.actor_id,v.request_id,v.pet_id,v.capture_hash) is distinct from row(actor,p_request_id,p_pet_id,p_capture_hash) then raise exception 'Approval identity differs' using errcode='42501';end if;
  return jsonb_build_object('status','approved','record',to_jsonb(v),'cancellation',null);
 end if;
 select * into c from public.ezyvet_attachment_approval_cancellations where id=p_id;
 if found then
  if row(c.actor_id,c.request_id,c.pet_id,c.capture_hash) is distinct from row(actor,p_request_id,p_pet_id,p_capture_hash) then raise exception 'Cancellation identity differs' using errcode='42501';end if;
 else
  select * into r from public.ezyvet_attachment_captures where request_id=p_request_id;
  if r.request_id is null or row(r.actor_id,r.pet_id,r.capture_hash) is distinct from row(actor,p_pet_id,p_capture_hash) then raise exception 'Owned exact capture required' using errcode='42501';end if;
  insert into public.ezyvet_attachment_approval_cancellations(id,actor_id,request_id,pet_id,capture_hash) values(p_id,actor,p_request_id,p_pet_id,p_capture_hash) returning * into c;
 end if;
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return jsonb_build_object('status','canceled','record',null,'cancellation',to_jsonb(c));
end $$;

create function public.recover_ezyvet_attachment_approval(p_id uuid,p_request_id uuid,p_pet_id uuid,p_capture_hash text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=auth.uid();v public.ezyvet_attachment_record_versions;c public.ezyvet_attachment_approval_cancellations;
begin
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into v from public.ezyvet_attachment_record_versions where id=p_id;
 if found then
  if row(v.actor_id,v.request_id,v.pet_id,v.capture_hash) is distinct from row(actor,p_request_id,p_pet_id,p_capture_hash) then raise exception 'Approval identity differs' using errcode='42501';end if;
  return jsonb_build_object('status','approved','record',to_jsonb(v),'cancellation',null);
 end if;
 select * into c from public.ezyvet_attachment_approval_cancellations where id=p_id;
 if not found then return null;end if;
 if row(c.actor_id,c.request_id,c.pet_id,c.capture_hash) is distinct from row(actor,p_request_id,p_pet_id,p_capture_hash) then raise exception 'Cancellation identity differs' using errcode='42501';end if;
 return jsonb_build_object('status','canceled','record',null,'cancellation',to_jsonb(c));
end $$;
revoke all on function public.approve_ezyvet_attachment_record(uuid,uuid,uuid,text,uuid,text,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.cancel_ezyvet_attachment_approval(uuid,uuid,uuid,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.recover_ezyvet_attachment_approval(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.approve_ezyvet_attachment_record(uuid,uuid,uuid,text,uuid,text,text,boolean) to authenticated;
grant execute on function public.cancel_ezyvet_attachment_approval(uuid,uuid,uuid,text,boolean) to authenticated;
grant execute on function public.recover_ezyvet_attachment_approval(uuid,uuid,uuid,text) to authenticated;
