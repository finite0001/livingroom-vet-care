-- Additive review against canonical7000 captures; existing bucket policies remain unchanged.
-- API source records remain distinct from manually exported patient documents.
create table public.ezyvet_attachment_record_versions (
 id uuid primary key, actor_id uuid not null references public.profiles(id),
 request_id uuid not null references public.ezyvet_attachment_original_captures(request_id),
 pet_id uuid not null references public.pets(id), animal_link_id uuid not null references public.ezyvet_record_links(id),
 source_origin text not null, source_site_uid text not null, attachment_external_id text not null,
 request_hash text not null, capture_hash text not null, source_context jsonb not null,
 title text not null check(length(title) between 1 and 200), review_reason text not null check(length(review_reason) between 1 and 2000),
 previous_record_id uuid references public.ezyvet_attachment_record_versions(id), version integer not null check(version>0),
 entry_method text not null default 'staff_reviewed_api_attachment_v2' check(entry_method='staff_reviewed_api_attachment_v2'),
 record_hash text not null check(record_hash ~ '^[a-f0-9]{64}$'), created_at timestamptz not null default clock_timestamp(),
 unique(animal_link_id,attachment_external_id,version)
);
alter table public.ezyvet_attachment_record_versions enable row level security;
revoke all on public.ezyvet_attachment_record_versions from public,anon,authenticated,service_role;
create trigger immutable_api_attachment_record before update or delete on public.ezyvet_attachment_record_versions for each row execute function public.guard_inquiry_history();
create index api_attachment_record_patient_cursor on public.ezyvet_attachment_record_versions(pet_id,created_at desc,id desc);

create function public.approve_ezyvet_attachment_record(p_id uuid,p_request_id uuid,p_pet_id uuid,p_capture_hash text,p_previous_record_id uuid,p_title text,p_review_reason text,p_attest boolean)
returns public.ezyvet_attachment_record_versions language plpgsql security definer set search_path=public,extensions as $$
declare actor uuid:=auth.uid();r public.ezyvet_attachment_capture_requests;c public.ezyvet_attachment_original_captures;i public.ezyvet_attachment_original_intents;v public.ezyvet_attachment_record_versions;prior public.ezyvet_attachment_record_versions;context jsonb;m uuid;external_id text;record jsonb;
begin
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_request_id is null or p_pet_id is null or p_capture_hash is null or p_capture_hash !~ '^[a-f0-9]{64}$' or p_attest is distinct from true
  or p_title is null or p_title<>btrim(p_title) or length(p_title) not between 1 and 200 or p_review_reason is null or p_review_reason<>btrim(p_review_reason) or length(p_review_reason) not between 1 and 2000 then raise exception 'Exact capture and explicit original review required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,7300));
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into v from public.ezyvet_attachment_record_versions where id=p_id;
 if found then
  if row(v.actor_id,v.request_id,v.pet_id,v.capture_hash,v.previous_record_id,v.title,v.review_reason) is distinct from row(actor,p_request_id,p_pet_id,p_capture_hash,p_previous_record_id,p_title,p_review_reason) then raise exception 'Approval identity differs' using errcode='23505';end if;
  return v;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,7000));
 select * into r from public.ezyvet_attachment_capture_requests where id=p_request_id for share;
 select * into c from public.ezyvet_attachment_original_captures where request_id=p_request_id;
 select * into i from public.ezyvet_attachment_original_intents where request_id=p_request_id;
 if public.ezyvet_is_active_admin(actor) is not true or r.id is null or c.request_id is null or i.id is null
  or row(r.requested_by,r.pet_id,r.status,c.capture_hash,c.intent_id,c.content_sha256,c.mime_type,c.file_size)
   is distinct from row(actor,p_pet_id,'ready'::text,p_capture_hash,i.id,i.content_sha256,i.mime_type,i.file_size)
 then raise exception 'Owned ready original required' using errcode='42501';end if;
 perform public.ezyvet_attachment_capture_lock_source(r.id,false);
 context:=jsonb_build_object('capture_contract','canonical_api_original_v1','parent',r.parent_context,
  'run_id',r.run_id,'page',r.page,'ordinal',r.ordinal,'attachment_snapshot_id',r.snapshot_id,
  'attachment_observed_head_version',r.observed_head_version,'attachment_external_id',r.external_id,
  'file_id',r.file_id,'stable_metadata_sha256',r.stable_metadata_sha256,'raw_record_sha256',r.raw_record_sha256,
  'metadata',r.metadata);
 m:=r.animal_link_id;external_id:=r.external_id;
 perform pg_advisory_xact_lock(hashtextextended(m::text||':'||external_id,7301));
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into prior from public.ezyvet_attachment_record_versions where animal_link_id=m and attachment_external_id=external_id order by version desc limit 1;
 if prior.id is distinct from p_previous_record_id or (prior.id is not null and prior.pet_id<>p_pet_id) then raise exception 'Review latest attachment version before correction' using errcode='40001';end if;
 perform 1 from storage.objects where id=c.storage_object_id and bucket_id=i.bucket_id and name=i.object_path and metadata->>'size'=i.file_size::text and metadata->>'mimetype'=i.mime_type for share;
 if not found then raise exception 'Captured original unavailable' using errcode='40001';end if;
 record:=jsonb_build_object('id',p_id,'actor_id',actor,'request_id',r.id,'pet_id',p_pet_id,'animal_link_id',m,'source_context',context,'request_hash',r.request_hash,'capture_hash',c.capture_hash,'title',p_title,'review_reason',p_review_reason,'previous_record_id',prior.id,'version',coalesce(prior.version,0)+1,'entry_method','staff_reviewed_api_attachment_v2');
 insert into public.ezyvet_attachment_record_versions(id,actor_id,request_id,pet_id,animal_link_id,source_origin,source_site_uid,attachment_external_id,request_hash,capture_hash,source_context,title,review_reason,previous_record_id,version,record_hash)
 values(p_id,actor,r.id,p_pet_id,m,context->'parent'->>'source_origin',context->'parent'->>'source_site_uid',external_id,r.request_hash,c.capture_hash,context,p_title,p_review_reason,prior.id,coalesce(prior.version,0)+1,encode(digest(convert_to(record::text,'UTF8'),'sha256'),'hex')) returning * into v;
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return v;
end $$;

create function public.recover_ezyvet_attachment_record(p_id uuid,p_pet_id uuid)
returns public.ezyvet_attachment_record_versions language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=auth.uid();v public.ezyvet_attachment_record_versions;
begin
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into v from public.ezyvet_attachment_record_versions where id=p_id;
 if v.id is null then return null;end if;
 if row(v.actor_id,v.pet_id) is distinct from row(actor,p_pet_id) then raise exception 'Approval identity differs' using errcode='42501';end if;
 return v;
end $$;
revoke all on function public.approve_ezyvet_attachment_record(uuid,uuid,uuid,text,uuid,text,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.recover_ezyvet_attachment_record(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.approve_ezyvet_attachment_record(uuid,uuid,uuid,text,uuid,text,text,boolean) to authenticated;
grant execute on function public.recover_ezyvet_attachment_record(uuid,uuid) to authenticated;
