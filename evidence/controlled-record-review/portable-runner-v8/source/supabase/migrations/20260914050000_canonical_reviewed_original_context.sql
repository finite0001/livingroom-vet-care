-- Service-only context for active-staff retrieval of exact reviewed originals.
create function public.get_reviewed_ezyvet_original_context(p_actor uuid,p_record_id uuid,p_pet_id uuid,p_capture_hash text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 if public.is_active_staff(p_actor) is not true then raise exception 'Active staff access required' using errcode='42501';end if;
 select jsonb_build_object('record_id',v.id,'record_hash',v.record_hash,'pet_id',v.pet_id,'request_id',v.request_id,
  'capture_hash',c.capture_hash,'capture_owner',r.requested_by,'intent_id',i.id,'storage_object_id',c.storage_object_id,
  'bucket_id',i.bucket_id,'object_path',i.object_path,'content_sha256',i.content_sha256,'mime_type',i.mime_type,'file_size',i.file_size)
 into result from public.ezyvet_attachment_record_versions v
 join public.ezyvet_attachment_capture_requests r on r.id=v.request_id and r.pet_id=v.pet_id and r.animal_link_id=v.animal_link_id and r.request_hash=v.request_hash and r.status='ready'
 join public.ezyvet_attachment_original_captures c on c.request_id=r.id and c.capture_hash=v.capture_hash
 join public.ezyvet_attachment_original_intents i on i.id=c.intent_id and i.request_id=r.id and i.content_sha256=c.content_sha256 and i.file_size=c.file_size and i.mime_type=c.mime_type
 join storage.objects o on o.id=c.storage_object_id and o.bucket_id=i.bucket_id and o.name=i.object_path and o.metadata->>'size'=i.file_size::text and o.metadata->>'mimetype'=i.mime_type
 where v.id=p_record_id and v.pet_id=p_pet_id and v.capture_hash=p_capture_hash;
 if result is null then raise exception 'Reviewed original unavailable' using errcode='42501';end if;
 return result;
end $$;
revoke all on function public.get_reviewed_ezyvet_original_context(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.get_reviewed_ezyvet_original_context(uuid,uuid,uuid,text) to service_role;
