-- Private prerequisite for schema9 composition; no release policy is activated.
create function public.ezyvet_validate_release_attachments(p_pet_id uuid,p_sources jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.ezyvet_attachment_record_versions;r public.ezyvet_attachment_capture_requests;
 c public.ezyvet_attachment_original_captures;i public.ezyvet_attachment_original_intents;
 ref jsonb;parent jsonb;context jsonb;locked record;result jsonb:='[]';
begin
 perform public.clinical_require_staff();
 if p_pet_id is null or p_sources is null or jsonb_typeof(p_sources) is distinct from 'array' then raise exception 'Choose exact reviewed API attachments' using errcode='23514';end if;
 if jsonb_array_length(p_sources) not between 1 and 20 then raise exception 'Choose between1 and20 reviewed API attachments' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_sources) x where jsonb_typeof(x) is distinct from 'object'
  or not(x ?& array['id','record_hash']) or x-array['id','record_hash']<>'{}'
  or jsonb_typeof(x->'id') is distinct from 'string' or x->>'id' !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'
  or jsonb_typeof(x->'record_hash') is distinct from 'string' or x->>'record_hash' !~ '^[a-f0-9]{64}$') then raise exception 'Exact API approval references required' using errcode='23514';end if;
 if(select count(*)<>count(distinct(x->>'id')::uuid) from jsonb_array_elements(p_sources) x) then raise exception 'Distinct API approval references required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_pet_id::text,4700));
 for locked in select distinct animal_link_id from public.ezyvet_attachment_record_versions where pet_id=p_pet_id and id in(select(x->>'id')::uuid from jsonb_array_elements(p_sources) x) order by animal_link_id loop
  perform 1 from public.ezyvet_record_links where id=locked.animal_link_id for share;
 end loop;
 perform 1 from public.pets where id=p_pet_id for share;
 for v in select * from public.ezyvet_attachment_record_versions where pet_id=p_pet_id and id in(select(x->>'id')::uuid from jsonb_array_elements(p_sources) x) order by source_origin,source_site_uid,source_context#>>'{parent,animal_external_id}',id loop
  parent:=public.ezyvet_attachment_parent_context(v.animal_link_id,v.source_origin,v.source_site_uid);
  if parent is distinct from v.source_context->'parent' then raise exception 'Selected API attachment parent changed' using errcode='40001';end if;
 end loop;
 for locked in select distinct source_origin,source_site_uid,attachment_external_id from public.ezyvet_attachment_record_versions where pet_id=p_pet_id and id in(select(x->>'id')::uuid from jsonb_array_elements(p_sources) x) order by source_origin,source_site_uid,attachment_external_id loop
  perform 1 from public.ezyvet_identity_heads where source_origin=locked.source_origin and source_site_uid=locked.source_site_uid and resource='attachment' and external_id=locked.attachment_external_id for share;
 end loop;
 for locked in select distinct animal_link_id,attachment_external_id from public.ezyvet_attachment_record_versions where pet_id=p_pet_id and id in(select(x->>'id')::uuid from jsonb_array_elements(p_sources) x) order by animal_link_id,attachment_external_id loop
  perform pg_advisory_xact_lock(hashtextextended(locked.animal_link_id::text||':'||locked.attachment_external_id,7301));
 end loop;
 for locked in select distinct cap.storage_object_id from public.ezyvet_attachment_original_captures cap join public.ezyvet_attachment_record_versions approval on approval.request_id=cap.request_id where approval.pet_id=p_pet_id and approval.id in(select(x->>'id')::uuid from jsonb_array_elements(p_sources) x) order by cap.storage_object_id loop
  perform 1 from storage.objects where id=locked.storage_object_id for share;
 end loop;
 perform public.clinical_require_staff();
 for ref in select value from jsonb_array_elements(p_sources) order by(value->>'id')::uuid loop
  select * into v from public.ezyvet_attachment_record_versions where id=(ref->>'id')::uuid;
  if not found or v.pet_id is distinct from p_pet_id or v.record_hash is distinct from ref->>'record_hash'
   or exists(select 1 from public.ezyvet_attachment_record_versions newer where newer.animal_link_id=v.animal_link_id and newer.attachment_external_id=v.attachment_external_id and newer.version>v.version)
   or public.ezyvet_attachment_capture_current(v.request_id) is not true
  then raise exception 'Current latest same-patient API approval required' using errcode='40001';end if;
  select * into r from public.ezyvet_attachment_capture_requests where id=v.request_id;
  select * into c from public.ezyvet_attachment_original_captures where request_id=v.request_id;
  select * into i from public.ezyvet_attachment_original_intents where id=c.intent_id and request_id=v.request_id;
  context:=jsonb_build_object('capture_contract','canonical_api_original_v1','parent',r.parent_context,
   'run_id',r.run_id,'page',r.page,'ordinal',r.ordinal,'attachment_snapshot_id',r.snapshot_id,
   'attachment_observed_head_version',r.observed_head_version,'attachment_external_id',r.external_id,
   'file_id',r.file_id,'stable_metadata_sha256',r.stable_metadata_sha256,'raw_record_sha256',r.raw_record_sha256,'metadata',r.metadata);
  if r.id is null or c.request_id is null or i.id is null or v.source_context is distinct from context
   or row(r.requested_by,r.pet_id,r.animal_link_id,r.request_hash,r.status,c.capture_hash,c.content_sha256,c.mime_type,c.file_size)
    is distinct from row(v.actor_id,p_pet_id,v.animal_link_id,v.request_hash,'ready'::text,v.capture_hash,i.content_sha256,i.mime_type,i.file_size)
   or not exists(select 1 from storage.objects o where o.id=c.storage_object_id and o.bucket_id=i.bucket_id and o.name=i.object_path and o.metadata->>'size'=i.file_size::text and o.metadata->>'mimetype'=i.mime_type)
  then raise exception 'Exact captured API original unavailable' using errcode='40001';end if;
  result:=result||jsonb_build_array(jsonb_build_object(
   'record',to_jsonb(v)-'source_context'||jsonb_build_object('source_context',v.source_context-'metadata'),
   'capture',jsonb_build_object('request_id',r.id,'actor_id',r.requested_by,'pet_id',r.pet_id,'capture_hash',c.capture_hash,
    'intent_id',i.id,'storage_object_id',c.storage_object_id,'bucket_id',i.bucket_id,'object_path',i.object_path,
    'content_sha256',c.content_sha256,'file_size',c.file_size,'mime_type',c.mime_type,'entry_method',c.entry_method,'captured_at',c.captured_at)));
 end loop;
 perform public.clinical_require_staff();
 return result;
end $$;
revoke all on function public.ezyvet_validate_release_attachments(uuid,jsonb) from public,anon,authenticated,service_role;
