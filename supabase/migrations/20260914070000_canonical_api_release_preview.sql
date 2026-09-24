-- Private preview composition; confirmation/delivery and schema9 policy remain unactivated.
create function public.release_api_attachment_document(p_source jsonb) returns jsonb
language plpgsql immutable set search_path=public as $$
declare approval jsonb:=p_source->'record';capture jsonb:=p_source->'capture';extension text;
begin
 if jsonb_typeof(approval) is distinct from 'object' or jsonb_typeof(capture) is distinct from 'object'
  or exists(select 1 from unnest(array['id','actor_id','pet_id','request_id']) f where approval->>f is null or approval->>f !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$')
  or exists(select 1 from unnest(array['actor_id','pet_id','request_id','intent_id','storage_object_id']) f where capture->>f is null or capture->>f !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$')
  or approval->>'record_hash' is null or approval->>'record_hash' !~ '^[a-f0-9]{64}$'
  or capture->>'capture_hash' is null or capture->>'capture_hash' !~ '^[a-f0-9]{64}$'
  or approval#>>'{source_context,capture_contract}' is distinct from 'canonical_api_original_v1'
  or capture->>'entry_method' is distinct from 'ezyvet_api_attachment_original_v1'
  or approval->>'attachment_external_id' is null or approval->>'attachment_external_id' !~ '^(0|[1-9][0-9]*)$'
  or jsonb_typeof(capture->'file_size') is distinct from 'number' or capture->>'file_size' !~ '^[0-9]+$'
 then raise exception 'Incomplete canonical API capture provenance' using errcode='23514';end if;
 if (capture->>'file_size')::numeric not between 1 and 20971520 then raise exception 'API original exceeds file bounds' using errcode='23514';end if;
 if approval->>'entry_method' is distinct from 'staff_reviewed_api_attachment_v2'
  or approval->>'capture_hash' is distinct from capture->>'capture_hash'
  or approval->>'request_id' is distinct from capture->>'request_id'
  or approval->>'actor_id' is distinct from capture->>'actor_id'
  or approval->>'pet_id' is distinct from capture->>'pet_id'
  or capture->>'bucket_id' is distinct from 'ezyvet-attachment-originals'
  or capture->>'content_sha256' is null or capture->>'content_sha256' !~ '^[a-f0-9]{64}$'
  or capture->>'object_path' is null or capture->>'object_path' !~ ('^'||(capture->>'actor_id')||'/'||(capture->>'pet_id')||'/'||(capture->>'request_id')||'/[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}/original$')
 then raise exception 'Incomplete API capture provenance' using errcode='23514';end if;
 extension:=case capture->>'mime_type' when 'application/pdf' then '.pdf' when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else null end;
 if extension is null then raise exception 'Unsupported API original type' using errcode='23514';end if;
 return jsonb_build_object('id',capture->'request_id','version',1,'file_name','ezyvet-attachment-'||(approval->>'attachment_external_id')||extension,
 'file_path',capture->'object_path','bucket',capture->'bucket_id','mime_type',capture->'mime_type','file_size',capture->'file_size','content_sha256',capture->'content_sha256',
 'document_date',null,'category','api_attachment','api_attachment_ref',jsonb_build_object('record_id',approval->'id','record_hash',approval->'record_hash','capture_hash',capture->'capture_hash'));
end $$;

create function public.release_preview_v9_internal(p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare result jsonb;s jsonb;ids jsonb;refs jsonb;originals jsonb:='[]';older jsonb;k text;older_count integer:=0;item jsonb;documents jsonb;
begin
 perform public.clinical_require_staff();
 perform pg_advisory_xact_lock(hashtextextended(p_pet_id::text,4700));
 if p_selection is null or jsonb_typeof(p_selection)<>'object' or exists(select 1 from jsonb_object_keys(p_selection) f where f not in('encounter_ids','certificate_ids','lab_order_ids','document_ids','dental_ids','qol_ids','anesthesia_ids','lesion_ids','problem_ids','weight_ids','treatment_ids','patient_summary_ids','lab_report_ids','external_record_ids','imported_history_ids','imported_vaccination_ids','imported_prescription_ids','api_attachment_ids')) then raise exception 'Choose explicit release sources' using errcode='23514';end if;
 ids:=coalesce(p_selection->'api_attachment_ids','[]');
 if jsonb_typeof(ids)<>'array' or jsonb_array_length(ids)>20 or exists(select 1 from jsonb_array_elements(ids) v where jsonb_typeof(v)<>'string') or (select count(*)<>count(distinct v::uuid) from jsonb_array_elements_text(ids) v) then raise exception 'Select at most20 distinct API attachment approvals' using errcode='23514';end if;
 older:=p_selection-'api_attachment_ids';
 for k in select jsonb_object_keys(older) loop
  if jsonb_typeof(older->k)<>'array' then raise exception 'Source selections must be arrays' using errcode='23514';end if;
  older_count:=older_count+jsonb_array_length(older->k);
 end loop;
 if jsonb_array_length(ids)>0 then
  select jsonb_agg(jsonb_build_object('id',v.id,'record_hash',v.record_hash) order by v.id) into refs from public.ezyvet_attachment_record_versions v where v.id in(select x::uuid from jsonb_array_elements_text(ids) x);
  if coalesce(jsonb_array_length(refs),0)<>jsonb_array_length(ids) then raise exception 'Selected API approval unavailable' using errcode='23514';end if;
  originals:=public.ezyvet_validate_release_attachments(p_pet_id,refs);
 end if;
 if older_count=0 and jsonb_array_length(ids)>0 then
  result:=public.preview_record_release_v1(p_pet_id,p_client_id,p_channel,p_recipient,'{}');s:=result->'snapshot';
  foreach k in array array['dental_charts','qol_records','anesthesia_records','lesions','problems','weights','treatments','patient_summaries','lab_reports','external_records','imported_histories','problem_source_extractions','imported_vaccinations','imported_prescriptions'] loop s:=s||jsonb_build_object(k,'[]'::jsonb);end loop;
 else result:=public.release_preview_v8_internal(p_pet_id,p_client_id,p_channel,p_recipient,older);s:=result->'snapshot';end if;
 documents:=s->'attachments';
 for item in select value from jsonb_array_elements(originals) loop documents:=documents||jsonb_build_array(public.release_api_attachment_document(item));end loop;
 if jsonb_array_length(documents)>24 or (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(documents)) then raise exception 'Distinct originals within24-file limit required' using errcode='23514';end if;
 s:=s||jsonb_build_object('schema_version',9,'selection',coalesce(s->'selection','{}')||jsonb_build_object('imported_vaccination_ids',coalesce(s#>'{selection,imported_vaccination_ids}','[]'),'imported_prescription_ids',coalesce(s#>'{selection,imported_prescription_ids}','[]'),'api_attachment_ids',ids),'api_attachments',originals,'attachments',documents);
 if octet_length(s::text)>1048576 then raise exception 'Release exceeds maximum reviewed snapshot size' using errcode='23514';end if;
 perform public.clinical_require_staff();
 return jsonb_build_object('snapshot',s,'source_hash',encode(sha256(convert_to(s::text,'UTF8')),'hex'));
exception when invalid_text_representation then raise exception 'Source IDs must be valid UUIDs' using errcode='23514';end $$;

revoke all on function public.release_api_attachment_document(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.release_preview_v9_internal(uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
