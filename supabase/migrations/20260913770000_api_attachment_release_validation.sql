-- Private schema9 prerequisite: exact selected approvals and original captures.
-- No API entrypoint or policy activation; composition supplies staff authorization.
create function public.ezyvet_validate_release_attachments(p_pet_id uuid,p_sources jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.ezyvet_attachment_record_versions;c public.ezyvet_attachment_captures;r public.ezyvet_attachment_download_requests;
 ref jsonb;parent jsonb;context jsonb;locked record;result jsonb:='[]';
begin
 if p_pet_id is null or p_sources is null or jsonb_typeof(p_sources) is distinct from 'array' then raise exception 'Choose exact reviewed API attachments' using errcode='23514';end if;
 if jsonb_array_length(p_sources) not between 1 and 20 then raise exception 'Choose between1 and20 reviewed API attachments' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_sources) x where jsonb_typeof(x) is distinct from 'object'
  or not(x ?& array['id','record_hash']) or x-array['id','record_hash']<>'{}'
  or jsonb_typeof(x->'id') is distinct from 'string' or x->>'id' !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'
  or jsonb_typeof(x->'record_hash') is distinct from 'string' or x->>'record_hash' !~ '^[a-f0-9]{64}$') then raise exception 'Exact API approval references required' using errcode='23514';end if;
 if (select count(*)<>count(distinct(x->>'id')::uuid) from jsonb_array_elements(p_sources) x) then raise exception 'Distinct API approval references required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_pet_id::text,4700));
 -- Lock mapping and patient before source heads, matching intake parent validation.
 for locked in select distinct animal_link_id from public.ezyvet_attachment_record_versions where pet_id=p_pet_id and id in(select(x->>'id')::uuid from jsonb_array_elements(p_sources) x) order by animal_link_id loop
  perform 1 from public.ezyvet_record_links where id=locked.animal_link_id for share;
 end loop;
 perform 1 from public.pets where id=p_pet_id for share;
 for v in select * from public.ezyvet_attachment_record_versions where pet_id=p_pet_id and id in(select(x->>'id')::uuid from jsonb_array_elements(p_sources) x) order by source_origin,source_site_uid,source_context#>>'{parent,parent_type}',source_context#>>'{parent,parent_external_id}',id loop
  parent:=v.source_context->'parent';
  context:=public.ezyvet_attachment_parent_context(v.animal_link_id,v.source_origin,v.source_site_uid,parent->>'parent_type',(parent->>'parent_snapshot_id')::uuid,parent->>'parent_payload_hash',(parent->>'parent_observed_head_version')::integer);
  if context is distinct from parent then raise exception 'Selected API attachment parent changed' using errcode='40001';end if;
 end loop;
 for locked in select distinct source_origin,source_site_uid,attachment_external_id from public.ezyvet_attachment_record_versions where pet_id=p_pet_id and id in(select(x->>'id')::uuid from jsonb_array_elements(p_sources) x) order by source_origin,source_site_uid,attachment_external_id loop
  perform 1 from public.ezyvet_identity_heads where source_origin=locked.source_origin and source_site_uid=locked.source_site_uid and resource='attachment' and external_id=locked.attachment_external_id for share;
 end loop;
 -- Same chain lock as approval. A correction cannot commit between latest-check
 -- and the caller's snapshot confirmation; no owned run or request lock is needed.
 for locked in select distinct animal_link_id,attachment_external_id from public.ezyvet_attachment_record_versions where pet_id=p_pet_id and id in(select(x->>'id')::uuid from jsonb_array_elements(p_sources) x) order by animal_link_id,attachment_external_id loop
  perform pg_advisory_xact_lock(hashtextextended(locked.animal_link_id::text||':'||locked.attachment_external_id,7301));
 end loop;
 for locked in select distinct cap.storage_object_id from public.ezyvet_attachment_captures cap join public.ezyvet_attachment_record_versions approval on approval.request_id=cap.request_id where approval.pet_id=p_pet_id and approval.id in(select(x->>'id')::uuid from jsonb_array_elements(p_sources) x) order by cap.storage_object_id loop
  perform 1 from storage.objects where id=locked.storage_object_id for share;
 end loop;
 for ref in select value from jsonb_array_elements(p_sources) order by (value->>'id')::uuid loop
  select * into v from public.ezyvet_attachment_record_versions where id=(ref->>'id')::uuid;
  if not found or v.pet_id is distinct from p_pet_id or v.record_hash is distinct from ref->>'record_hash'
   or exists(select 1 from public.ezyvet_attachment_record_versions newer where newer.animal_link_id=v.animal_link_id and newer.attachment_external_id=v.attachment_external_id and newer.version>v.version)
   or not exists(select 1 from public.ezyvet_identity_heads h where h.source_origin=v.source_origin and h.source_site_uid=v.source_site_uid and h.resource='attachment' and h.external_id=v.attachment_external_id and h.snapshot_id=(v.source_context->>'attachment_snapshot_id')::uuid and h.version=(v.source_context->>'attachment_observed_head_version')::integer)
  then raise exception 'Current latest same-patient API approval required' using errcode='40001';end if;
  select * into c from public.ezyvet_attachment_captures where request_id=v.request_id;
  select * into r from public.ezyvet_attachment_download_requests where id=v.request_id;
  if c.request_id is null or r.id is null
   or row(c.actor_id,c.pet_id,c.capture_hash,r.actor_id,r.pet_id,r.request_hash,r.source_context,r.status) is distinct from row(v.actor_id,p_pet_id,v.capture_hash,v.actor_id,p_pet_id,v.request_hash,v.source_context,'captured'::text)
   or not exists(select 1 from storage.objects o where o.id=c.storage_object_id and o.bucket_id=c.bucket and o.name=c.object_path and o.metadata->>'size'=c.file_size::text and o.metadata->>'mimetype'=c.mime_type)
  then raise exception 'Exact captured API original unavailable' using errcode='40001';end if;
  result:=result||jsonb_build_array(jsonb_build_object('record',to_jsonb(v)-'source_context'||jsonb_build_object('source_context',v.source_context-'attachment_metadata'),'capture',to_jsonb(c)-'lease_id'));
 end loop;
 return result;
end $$;
revoke all on function public.ezyvet_validate_release_attachments(uuid,jsonb) from public,anon,authenticated,service_role;
