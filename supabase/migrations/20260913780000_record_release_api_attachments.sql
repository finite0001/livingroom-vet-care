-- Schema9 adds an explicit API original family. Existing snapshots are immutable.
alter table public.record_release_policy drop constraint record_release_policy_accepted_schema_version_check;
alter table public.record_release_policy add check(accepted_schema_version in(1,2,3,4,5,6,7,8,9));
alter table public.record_release_sources drop constraint record_release_sources_source_kind_check;
alter table public.record_release_sources add check(source_kind in('encounter','certificate','lab','document','dental','qol','anesthesia','lesion','problem','weight','treatment','patient_summary','lab_report','external_record','imported_history','imported_vaccination','imported_prescription','api_attachment'));

create function public.release_api_attachment_document(p_source jsonb) returns jsonb
language plpgsql immutable set search_path=public as $$
declare approval jsonb:=p_source->'record';capture jsonb:=p_source->'capture';extension text;
begin
 if approval->>'entry_method' is distinct from 'staff_reviewed_api_attachment_v1'
  or approval->>'capture_hash' is distinct from capture->>'capture_hash'
  or approval->>'request_id' is distinct from capture->>'request_id'
  or approval->>'actor_id' is distinct from capture->>'actor_id'
  or approval->>'pet_id' is distinct from capture->>'pet_id'
  or capture->>'bucket' is distinct from 'ezyvet-attachments'
  or capture->>'content_sha256' is null or capture->>'content_sha256' !~ '^[a-f0-9]{64}$'
  or capture->>'object_path' is null or capture->>'object_path' !~ ('^'||(capture->>'actor_id')||'/'||(capture->>'pet_id')||'/'||(capture->>'request_id')||'/[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}/original$')
 then raise exception 'Incomplete API capture provenance' using errcode='23514';end if;
 extension:=case capture->>'mime_type' when 'application/pdf' then '.pdf' when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else null end;
 if extension is null then raise exception 'Unsupported API original type' using errcode='23514';end if;
 return jsonb_build_object('id',capture->'request_id','version',1,'file_name','ezyvet-attachment-'||(approval->>'attachment_external_id')||extension,
 'file_path',capture->'object_path','bucket',capture->'bucket','mime_type',capture->'mime_type','file_size',capture->'file_size','content_sha256',capture->'content_sha256',
 'document_date',null,'category','api_attachment','api_attachment_ref',jsonb_build_object('record_id',approval->'id','record_hash',approval->'record_hash','capture_hash',capture->'capture_hash'));
end $$;

create function public.release_preview_v9_internal(p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare result jsonb;s jsonb;ids jsonb;refs jsonb;originals jsonb:='[]';older jsonb;k text;older_count integer:=0;item jsonb;documents jsonb;
begin
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
 return jsonb_build_object('snapshot',s,'source_hash',encode(sha256(convert_to(s::text,'UTF8')),'hex'));
exception when invalid_text_representation then raise exception 'Source IDs must be valid UUIDs' using errcode='23514';end $$;
create function public.preview_record_release_v9(p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;begin perform public.clinical_require_staff();result:=public.release_preview_v9_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection);perform public.clinical_require_staff();return result;end $$;

do $$declare d text;needle text;begin
 select pg_get_functiondef('public.confirm_record_release(uuid,uuid,uuid,text,text,jsonb,jsonb,text,boolean)'::regprocedure) into d;
 needle:='if (p_reviewed_snapshot->>''schema_version'')::integer=8 then';if strpos(d,needle)=0 then raise exception 'Expected schema8 confirmation dispatch missing';end if;
 d:=replace(d,needle,'if (p_reviewed_snapshot->>''schema_version'')::integer=9 then preview:=public.release_preview_v9_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection); elsif (p_reviewed_snapshot->>''schema_version'')::integer=8 then');
 d:=replace(d,'p_reviewed_snapshot->>''schema_version'' not in (''5'',''6'',''7'',''8'')','p_reviewed_snapshot->>''schema_version'' not in (''5'',''6'',''7'',''8'',''9'')');
 d:=replace(d,'p_reviewed_snapshot->>''schema_version'' not in (''6'',''7'',''8'')','p_reviewed_snapshot->>''schema_version'' not in (''6'',''7'',''8'',''9'')');
 needle:='''imported_vaccination_ids'',''imported_prescription_ids''] loop';if strpos(d,needle)=0 then raise exception 'Expected schema8 source registry missing';end if;
 d:=replace(d,needle,'''imported_vaccination_ids'',''imported_prescription_ids'',''api_attachment_ids''] loop');
 d:=replace(d,'when ''imported_prescription_ids'' then ''imported_prescription'' else','when ''imported_prescription_ids'' then ''imported_prescription'' when ''api_attachment_ids'' then ''api_attachment'' else');
 needle:='insert into public.record_releases(';if strpos(d,needle)=0 then raise exception 'Expected release insertion missing';end if;
 d:=replace(d,needle,'perform public.clinical_require_staff(); '||needle);execute d;
 select pg_get_functiondef('public.release_read_internal(uuid)'::regprocedure) into d;
 needle:='if r.snapshot->>''schema_version''=''8'' then';if strpos(d,needle)=0 then raise exception 'Expected schema8 recovery dispatch missing';end if;
 d:=replace(d,needle,'if r.snapshot->>''schema_version''=''9'' then current_preview:=public.release_preview_v9_internal(r.pet_id,r.client_id,r.channel,r.recipient,r.selection); elsif r.snapshot->>''schema_version''=''8'' then');
 d:=replace(d,'r.snapshot->>''schema_version'' not in (''5'',''6'',''7'',''8'')','r.snapshot->>''schema_version'' not in (''5'',''6'',''7'',''8'',''9'')');
 d:=replace(d,'r.snapshot->>''schema_version'' not in (''6'',''7'',''8'')','r.snapshot->>''schema_version'' not in (''6'',''7'',''8'',''9'')');
 needle:='exception when sqlstate ''23514'' or sqlstate ''42501'' then';if strpos(d,needle)=0 then raise exception 'Expected current-source recovery exception boundary missing';end if;
 d:=replace(d,needle,'exception when sqlstate ''23514'' or sqlstate ''42501'' or sqlstate ''40001'' then');execute d;
end $$;
do $$declare name text;d text;needle text;replacement text;begin
 foreach name in array array['invalidate_release_source_provenance','release_weight_provenance_changed','release_weight_source_head_changed'] loop
  select pg_get_functiondef(oid) into d from pg_proc where pronamespace='public'::regnamespace and proname=name;
  if name='invalidate_release_source_provenance' then needle:='in (''5'',''6'',''7'',''8'')';replacement:='in (''5'',''6'',''7'',''8'',''9'')';else needle:='in (''4'',''5'',''6'',''7'',''8'')';replacement:='in (''4'',''5'',''6'',''7'',''8'',''9'')';end if;
  if d is null or strpos(d,needle)=0 then raise exception 'Expected inherited provenance event guard missing: %',name;end if;execute replace(d,needle,replacement);
 end loop;
end $$;

-- Preserve old byte contracts; schema9 API documents have a separate identity.
do $$declare d text;needle text;begin
 select pg_get_functiondef('public.verify_release_source_original_v5(jsonb,jsonb,bytea)'::regprocedure) into d;
 d:=replace(d,'public.verify_release_source_original_v5(','public.verify_release_source_original_legacy(');
 needle:='p_snapshot->>''schema_version'' is distinct from ''8''';if strpos(d,needle)=0 then raise exception 'Expected schema8 original verification missing';end if;
 execute replace(d,needle,needle||' and p_snapshot->>''schema_version'' is distinct from ''9''');
end $$;
create or replace function public.verify_release_source_original_v5(p_snapshot jsonb,p_document jsonb,p_bytes bytea) returns void language plpgsql security definer set search_path=public as $$
declare item jsonb;expected jsonb;matches integer;
begin
 if p_snapshot->>'schema_version' is distinct from '9' then perform public.verify_release_source_original_legacy(p_snapshot,p_document,p_bytes);return;end if;
 if jsonb_typeof(p_snapshot->'api_attachments') is distinct from 'array' then raise exception 'Missing API attachment provenance' using errcode='23514';end if;
 if p_document->>'bucket'='ezyvet-attachments' then
  select count(*),jsonb_agg(value)->0 into matches,item from jsonb_array_elements(p_snapshot->'api_attachments') where value#>>'{record,id}'=p_document#>>'{api_attachment_ref,record_id}';
  if matches<>1 then raise exception 'Exact selected API source required' using errcode='23514';end if;
  expected:=public.release_api_attachment_document(item);
  if expected is distinct from p_document or item#>>'{record,pet_id}' is distinct from p_snapshot#>>'{patient,id}'
   or p_document->>'content_sha256' is distinct from encode(sha256(p_bytes),'hex')
   or (p_document->>'file_size')::bigint<>octet_length(p_bytes) then raise exception 'API original differs from reviewed capture' using errcode='23514';end if;
 else
  if p_document->>'bucket' is distinct from 'patient-documents' or p_document ? 'api_attachment_ref'
   or exists(select 1 from jsonb_array_elements(p_snapshot->'api_attachments') where value#>>'{capture,request_id}'=p_document->>'id') then raise exception 'API original cannot be downgraded to ordinary document' using errcode='23514';end if;
  perform public.verify_release_source_original_legacy(p_snapshot,p_document,p_bytes);
 end if;
end $$;

create function public.invalidate_api_attachment_release() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if TG_TABLE_NAME='ezyvet_identity_heads' then
  if NEW.resource not in('animal','consult','attachment') or row(NEW.snapshot_id,NEW.version) is not distinct from row(OLD.snapshot_id,OLD.version) then return NEW;end if;
  insert into public.record_release_events(id,release_id,kind,reason,created_by)
  select gen_random_uuid(),r.id,'source_changed','Reviewed API attachment source changed; review a fresh package',auth.uid() from public.record_releases r where exists(select 1 from public.record_release_sources rs join public.ezyvet_attachment_record_versions v on v.id=rs.source_id where rs.release_id=r.id and rs.source_kind='api_attachment' and v.source_origin=NEW.source_origin and v.source_site_uid=NEW.source_site_uid and ((NEW.resource='attachment' and v.attachment_external_id=NEW.external_id) or (NEW.resource=case v.source_context#>>'{parent,parent_type}' when 'Animal' then 'animal' else 'consult' end and v.source_context#>>'{parent,parent_external_id}'=NEW.external_id)));
 elsif TG_TABLE_NAME='ezyvet_record_links' then
  if row(NEW.source_origin,NEW.source_site_uid,NEW.resource,NEW.external_id,NEW.pet_id,NEW.client_id) is not distinct from row(OLD.source_origin,OLD.source_site_uid,OLD.resource,OLD.external_id,OLD.pet_id,OLD.client_id) then return NEW;end if;
  insert into public.record_release_events(id,release_id,kind,reason,created_by)
  select gen_random_uuid(),r.id,'source_changed','Reviewed API attachment mapping changed; review a fresh package',auth.uid() from public.record_releases r where exists(select 1 from public.record_release_sources rs join public.ezyvet_attachment_record_versions v on v.id=rs.source_id where rs.release_id=r.id and rs.source_kind='api_attachment' and v.animal_link_id=NEW.id);
 else
  insert into public.record_release_events(id,release_id,kind,reason,created_by)
  select gen_random_uuid(),r.id,'source_changed','Reviewed API attachment superseded; review a fresh package',auth.uid() from public.record_releases r where exists(select 1 from public.record_release_sources rs join public.ezyvet_attachment_record_versions v on v.id=rs.source_id where rs.release_id=r.id and rs.source_kind='api_attachment' and v.animal_link_id=NEW.animal_link_id and v.attachment_external_id=NEW.attachment_external_id);
 end if;
 return NEW;
end $$;
create trigger release_api_attachment_source after update on public.ezyvet_identity_heads for each row execute function public.invalidate_api_attachment_release();
create trigger release_api_attachment_mapping after update on public.ezyvet_record_links for each row execute function public.invalidate_api_attachment_release();
create trigger release_api_attachment_approval after insert on public.ezyvet_attachment_record_versions for each row execute function public.invalidate_api_attachment_release();
do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in('release_api_attachment_document','release_preview_v9_internal','preview_record_release_v9','verify_release_source_original_v5','verify_release_source_original_legacy','invalidate_api_attachment_release') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname='preview_record_release_v9' then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
