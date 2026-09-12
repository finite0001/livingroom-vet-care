-- Extended source families preserve signed chart history and explicit attachment boundaries.
alter table public.record_release_policy add column accepted_schema_version integer not null default 1 check(accepted_schema_version in (1,2));
alter table public.record_release_sources drop constraint record_release_sources_source_kind_check;
alter table public.record_release_sources add check(source_kind in ('encounter','certificate','lab','document','dental','qol','anesthesia','lesion'));
alter function public.preview_record_release(uuid,uuid,text,text,jsonb) rename to preview_record_release_v1;
create or replace function public.preview_record_release_v1(p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare pet public.pets; owner public.clients; selected uuid; k text; ids jsonb; e public.clinical_encounters; c public.vaccine_certificates; l public.patient_lab_orders; d public.patient_documents; soaps jsonb:='[]'; certs jsonb:='[]'; labs jsonb:='[]'; docs jsonb:='[]'; snapshot jsonb; recipient text; count_selected integer:=0;
begin
 perform public.clinical_require_staff();
 if p_selection is null or jsonb_typeof(p_selection)<>'object' or exists(select 1 from jsonb_object_keys(p_selection) f where f not in ('encounter_ids','certificate_ids','lab_order_ids','document_ids')) then raise exception 'Choose explicit release sources' using errcode='23514'; end if;
 foreach k in array array['encounter_ids','certificate_ids','lab_order_ids','document_ids'] loop
  ids:=coalesce(p_selection->k,'[]');
  if jsonb_typeof(ids)<>'array' or jsonb_array_length(ids)>100 then raise exception 'Each source selection must be an array of at most 100 IDs' using errcode='23514'; end if;
  if exists(select 1 from jsonb_array_elements(ids) v where jsonb_typeof(v)<>'string') or (select count(*) from jsonb_array_elements_text(ids))<>(select count(distinct v::uuid) from jsonb_array_elements_text(ids) v) then raise exception 'Source IDs must be unique strings' using errcode='23514'; end if;
  count_selected:=count_selected+jsonb_array_length(ids);
 end loop;

 select * into pet from public.pets where id=p_pet_id and client_id=p_client_id for share;
 if not found then raise exception 'Patient does not belong to this household' using errcode='42501'; end if;
 select * into owner from public.clients where id=p_client_id for share;
 recipient:=public.communication_recipient(p_channel,p_recipient);
 if p_channel is null or p_channel not in ('EMAIL','SMS') or recipient is null or recipient is distinct from public.communication_recipient(p_channel,case when p_channel='EMAIL' then owner.primary_email else owner.primary_phone end) then raise exception 'Recipient must match the selected patient household contact' using errcode='42501'; end if;
 for selected in select v::uuid from jsonb_array_elements_text(coalesce(p_selection->'encounter_ids','[]')) v order by v loop
  select * into e from public.clinical_encounters where id=selected and pet_id=p_pet_id and status='signed' for update;
  if not found then raise exception 'Only signed encounters from this patient can be released' using errcode='23514'; end if;
  soaps:=soaps||jsonb_build_array(jsonb_build_object('id',e.id,'version',e.version,'visit_at',e.visit_at,'visit_type',e.visit_type,'subjective',e.subjective,'objective',e.objective,'assessment',e.assessment,'plan',e.plan,'signed_by',e.signed_by,'signed_at',e.signed_at,'addenda',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'content',a.content,'created_by',a.created_by,'created_at',a.created_at) order by a.created_at,a.id) from public.clinical_addenda a where a.encounter_id=e.id),'[]'::jsonb)));
 end loop;
 for selected in select v::uuid from jsonb_array_elements_text(coalesce(p_selection->'certificate_ids','[]')) v order by v loop
  select * into c from public.vaccine_certificates where id=selected and pet_id=p_pet_id for update;
  if not found or exists(select 1 from public.vaccine_certificate_events where certificate_id=selected) then raise exception 'Certificate is unavailable, belongs to another patient or is invalidated' using errcode='23514'; end if;
  certs:=certs||jsonb_build_array(to_jsonb(c)-array['request']);
 end loop;
 for selected in select v::uuid from jsonb_array_elements_text(coalesce(p_selection->'lab_order_ids','[]')) v order by v loop
  select * into l from public.patient_lab_orders where id=selected and pet_id=p_pet_id and status='resulted' for update;
  if not found then raise exception 'Only resulted laboratory records from this patient can be released' using errcode='23514'; end if;
  if l.result_document_id is null or not exists(select 1 from jsonb_array_elements_text(coalesce(p_selection->'document_ids','[]')) v where v::uuid=l.result_document_id) then raise exception 'Select the lab original report explicitly as a shareable attachment' using errcode='23514'; end if;
  labs:=labs||jsonb_build_array(jsonb_build_object('id',l.id,'version',l.version,'test_name',l.test_name,'accession',l.accession,'collected_date',l.collected_date,'result_date',l.result_date,'result_document_id',l.result_document_id));
 end loop;
 for selected in select v::uuid from jsonb_array_elements_text(coalesce(p_selection->'document_ids','[]')) v order by v loop
  select * into d from public.patient_documents where id=selected and pet_id=p_pet_id and status='ready' and visibility='client_shareable' for update;
  if not found then raise exception 'Only ready client-shareable documents from this patient can be released' using errcode='23514'; end if;
  if not exists(select 1 from storage.objects where bucket_id='patient-documents' and name=d.file_path and metadata->>'size'=d.file_size::text and metadata->>'mimetype'=d.mime_type) then raise exception 'Original document object is unavailable or metadata differs' using errcode='23514'; end if;
  docs:=docs||jsonb_build_array(jsonb_build_object('id',d.id,'version',d.version,'file_name',d.file_name,'file_path',d.file_path,'bucket','patient-documents','mime_type',d.mime_type,'file_size',d.file_size,'document_date',d.document_date,'category',d.category));
 end loop;
 snapshot:=jsonb_build_object('schema_version',1,'patient',jsonb_build_object('id',pet.id,'version',pet.version,'name',pet.name,'species',pet.species,'breed',pet.breed,'dob',pet.dob,'birth_date_precision',pet.birth_date_precision,'microchip_id',pet.microchip_id),'recipient',jsonb_build_object('client_id',owner.id,'client_version',owner.version,'name',owner.full_name,'channel',p_channel,'address',recipient),'encounters',soaps,'certificates',certs,'lab_results',labs,'attachments',docs);
 return jsonb_build_object('snapshot',snapshot,'source_hash',encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'));
exception when invalid_text_representation then raise exception 'Source IDs must be valid UUIDs' using errcode='23514';
end $$;
create function public.preview_record_release(p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare k text; ids jsonb; selected uuid; total integer:=0; base_selection jsonb; result jsonb; s jsonb; d public.dental_charts; q public.patient_qol_records; a public.patient_anesthesia_records; l public.patient_lesions; dental jsonb:='[]'; qol jsonb:='[]'; anesthesia jsonb:='[]'; lesions jsonb:='[]';
begin
 perform public.clinical_require_staff();
 if p_selection is null or jsonb_typeof(p_selection)<>'object' or exists(select 1 from jsonb_object_keys(p_selection) f where f not in ('encounter_ids','certificate_ids','lab_order_ids','document_ids','dental_ids','qol_ids','anesthesia_ids','lesion_ids')) then raise exception 'Choose explicit release sources' using errcode='23514';end if;
 foreach k in array array['encounter_ids','certificate_ids','lab_order_ids','document_ids','dental_ids','qol_ids','anesthesia_ids','lesion_ids'] loop
  ids:=coalesce(p_selection->k,'[]');
  if jsonb_typeof(ids)<>'array' then raise exception 'Source selections must be arrays' using errcode='23514';end if;
  if jsonb_array_length(ids)>100 then raise exception 'Choose at most 100 records per source family' using errcode='23514';end if;
  if exists(select 1 from jsonb_array_elements(ids) v where jsonb_typeof(v)<>'string') or (select count(*) from jsonb_array_elements_text(ids))<>(select count(distinct v::uuid) from jsonb_array_elements_text(ids) v) then raise exception 'Source IDs must be unique strings' using errcode='23514';end if;
  total:=total+jsonb_array_length(ids);
 end loop;
 if total=0 then raise exception 'Choose at least one source; nothing is included by default' using errcode='23514';end if;
 -- Acquire chart-parent locks before original-document locks, matching chart writers.
 for selected in select v::uuid from jsonb_array_elements_text(coalesce(p_selection->'dental_ids','[]')) v order by v loop
  select * into d from public.dental_charts where id=selected and pet_id=p_pet_id and status='signed' for update;
  if not found then raise exception 'Only signed dental charts from this patient can be released' using errcode='23514';end if;
  dental:=dental||jsonb_build_array(jsonb_build_object('id',d.id,'version',d.version,'species_family',d.species_family,'dentition',d.dentition,'visit_at',d.visit_at,'notes',d.notes,'teeth',d.teeth,'signed_by',d.signed_by,'signed_at',d.signed_at,'addenda',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.dental_chart_addenda x where chart_id=d.id),'[]')));
 end loop;
 for selected in select v::uuid from jsonb_array_elements_text(coalesce(p_selection->'qol_ids','[]')) v order by v loop
  select * into q from public.patient_qol_records where id=selected and pet_id=p_pet_id and status='signed' for update;
  if not found then raise exception 'Only signed QOL records from this patient can be released' using errcode='23514';end if;
  qol:=qol||jsonb_build_array(jsonb_build_object('id',q.id,'version',q.version,'template_version',q.template_version,'observed_at',q.observed_at,'observer',q.observer,'appetite',q.appetite,'drinking',q.drinking,'mobility',q.mobility,'comfort',q.comfort,'social_engagement',q.social_engagement,'good_days',q.good_days,'notes',q.notes,'signed_by',q.signed_by,'signed_at',q.signed_at,'addenda',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.patient_qol_addenda x where qol_id=q.id),'[]')));
 end loop;
 for selected in select v::uuid from jsonb_array_elements_text(coalesce(p_selection->'anesthesia_ids','[]')) v order by v loop
  select * into a from public.patient_anesthesia_records where id=selected and pet_id=p_pet_id and status='signed' for update;
  if not found then raise exception 'Only signed anesthesia records from this patient can be released' using errcode='23514';end if;
  anesthesia:=anesthesia||jsonb_build_array(jsonb_build_object('id',a.id,'version',a.version,'procedure_name',a.procedure_name,'started_at',a.started_at,'ended_at',a.ended_at,'team',a.team,'assessment',a.assessment,'plan',a.plan,'recovery_notes',a.recovery_notes,'observations',a.observations,'events',a.events,'source',a.source,'included_original_document_id',case when exists(select 1 from jsonb_array_elements_text(coalesce(p_selection->'document_ids','[]')) v where v::uuid=a.original_document_id) then a.original_document_id else null end,'signed_by',a.signed_by,'signed_at',a.signed_at,'addenda',coalesce((select jsonb_agg(to_jsonb(x) order by x.recorded_at,x.id) from public.anesthesia_record_addenda x where record_id=a.id),'[]')));
 end loop;
 for selected in select v::uuid from jsonb_array_elements_text(coalesce(p_selection->'lesion_ids','[]')) v order by v loop
  select * into l from public.patient_lesions where id=selected and pet_id=p_pet_id for update;
  if not found then raise exception 'Body-map history must belong to this patient' using errcode='23514';end if;
  lesions:=lesions||jsonb_build_array(jsonb_build_object('id',l.id,'version',l.version,'label',l.label,'observations',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'observed_at',o.observed_at,'label',o.label,'body_view',o.body_view,'x',o.x,'y',o.y,'length_mm',o.length_mm,'width_mm',o.width_mm,'depth_mm',o.depth_mm,'notes',o.notes,'created_by',o.created_by,'created_at',o.created_at,'photo_document_id',case when exists(select 1 from jsonb_array_elements_text(coalesce(p_selection->'document_ids','[]')) v where v::uuid=o.photo_document_id) then o.photo_document_id else null end,'corrections',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at,c.id) from public.patient_lesion_corrections c where c.observation_id=o.id),'[]')) order by o.observed_at,o.created_at,o.id) from public.patient_lesion_observations o where lesion_id=l.id),'[]')));
 end loop;
 base_selection:=p_selection-array['dental_ids','qol_ids','anesthesia_ids','lesion_ids'];
 result:=public.preview_record_release_v1(p_pet_id,p_client_id,p_channel,p_recipient,base_selection);
 s:=(result->'snapshot')||jsonb_build_object('schema_version',2,'dental_charts',dental,'qol_records',qol,'anesthesia_records',anesthesia,'lesions',lesions);
 return jsonb_build_object('snapshot',s,'source_hash',encode(sha256(convert_to(s::text,'UTF8')),'hex'));
exception when invalid_text_representation then raise exception 'Source IDs must be valid UUIDs' using errcode='23514';
end $$;
create function public.release_lock_chart_parent() returns trigger language plpgsql security definer set search_path=public as $$
begin
 case TG_TABLE_NAME
 when 'dental_chart_addenda' then perform 1 from public.dental_charts where id=NEW.chart_id for update;
 when 'patient_qol_addenda' then perform 1 from public.patient_qol_records where id=NEW.qol_id for update;
 when 'anesthesia_record_addenda' then perform 1 from public.patient_anesthesia_records where id=NEW.record_id for update;
 when 'patient_lesion_observations' then perform 1 from public.patient_lesions where id=NEW.lesion_id for update;
 when 'patient_lesion_corrections' then perform 1 from public.patient_lesions where id=(select lesion_id from public.patient_lesion_observations where id=NEW.observation_id) for update;
 end case;
 return NEW;
end $$;
create function public.invalidate_record_release_chart() returns trigger language plpgsql security definer set search_path=public as $$
declare source_type text; source uuid;
begin
 case TG_TABLE_NAME
 when 'dental_chart_addenda' then source_type:='dental';source:=NEW.chart_id;
 when 'patient_qol_addenda' then source_type:='qol';source:=NEW.qol_id;
 when 'anesthesia_record_addenda' then source_type:='anesthesia';source:=NEW.record_id;
 when 'patient_lesion_observations' then source_type:='lesion';source:=NEW.lesion_id;
 when 'patient_lesion_corrections' then source_type:='lesion';select lesion_id into source from public.patient_lesion_observations where id=NEW.observation_id;
 end case;
 insert into public.record_release_events(id,release_id,kind,reason,created_by) select gen_random_uuid(),release_id,'source_changed','Reviewed '||source_type||' history changed; prepare a fresh package',auth.uid() from public.record_release_sources where source_kind=source_type and source_id=source;
 return NEW;
end $$;
do $$ declare t text;begin
 foreach t in array array['dental_chart_addenda','patient_qol_addenda','anesthesia_record_addenda','patient_lesion_observations','patient_lesion_corrections'] loop
  execute format('create trigger aaa_release_chart_lock before insert on public.%I for each row execute function public.release_lock_chart_parent()',t);
  execute format('create trigger release_chart_changed after insert on public.%I for each row execute function public.invalidate_record_release_chart()',t);
 end loop;
end $$;

create or replace function public.confirm_record_release(p_id uuid,p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb,p_reviewed_snapshot jsonb,p_reviewed_hash text,p_attest_review boolean) returns public.record_releases language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff(); result public.record_releases; preview jsonb; req jsonb; k text; source_type text;
begin
 if p_id is null or p_attest_review is distinct from true then raise exception 'Stable ID and explicit content/recipient review are required' using errcode='23514'; end if;
 req:=jsonb_build_object('pet_id',p_pet_id,'client_id',p_client_id,'channel',p_channel,'recipient',p_recipient,'selection',p_selection,'reviewed_snapshot',p_reviewed_snapshot,'reviewed_hash',p_reviewed_hash,'attest_review',p_attest_review);
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,13));
 select * into result from public.record_releases where id=p_id;
 if found then if result.created_by<>actor or result.request is distinct from req then raise exception 'Release identifier already used' using errcode='23514'; end if; return result; end if;
 perform 1 from public.record_release_policy where id and enabled and accepted_at<=now() and accepted_schema_version>=2 for share;
 if not found then raise exception 'Clinical acceptance of the release form and workflow is required before confirmation' using errcode='42501'; end if;
 preview:=public.preview_record_release(p_pet_id,p_client_id,p_channel,p_recipient,p_selection);
 if preview->'snapshot' is distinct from p_reviewed_snapshot or preview->>'source_hash' is distinct from p_reviewed_hash then raise exception 'Release sources or recipient changed; preview and review again' using errcode='40001'; end if;
 insert into public.record_releases(id,pet_id,client_id,channel,recipient,selection,snapshot,source_hash,request,created_by) values(p_id,p_pet_id,p_client_id,p_channel,preview#>>'{snapshot,recipient,address}',p_selection,p_reviewed_snapshot,p_reviewed_hash,req,actor) returning * into result;
 foreach k in array array['encounter_ids','certificate_ids','lab_order_ids','document_ids','dental_ids','qol_ids','anesthesia_ids','lesion_ids'] loop
  source_type:=case k when 'encounter_ids' then 'encounter' when 'certificate_ids' then 'certificate' when 'lab_order_ids' then 'lab' when 'dental_ids' then 'dental' when 'qol_ids' then 'qol' when 'anesthesia_ids' then 'anesthesia' when 'lesion_ids' then 'lesion' else 'document' end;
  insert into public.record_release_sources(release_id,source_kind,source_id) select p_id,source_type,v::uuid from jsonb_array_elements_text(coalesce(p_selection->k,'[]')) v;
 end loop;
 return result;
end $$;
create or replace function public.read_record_release(p_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.record_releases; events jsonb; eligible boolean:=true; why text; current_preview jsonb;
begin
 perform public.clinical_require_staff();
 select * into r from public.record_releases where id=p_id for share;
 if not found then raise exception 'Release not found' using errcode='23514'; end if;
 select coalesce(jsonb_agg(to_jsonb(e) order by created_at,id),'[]') into events from public.record_release_events e where release_id=p_id;
 if jsonb_array_length(events)>0 then eligible:=false;why:='Withdrawn or a reviewed source changed';
 else
  begin
   if r.snapshot->>'schema_version'='1' then current_preview:=public.preview_record_release_v1(r.pet_id,r.client_id,r.channel,r.recipient,r.selection); else current_preview:=public.preview_record_release(r.pet_id,r.client_id,r.channel,r.recipient,r.selection);end if;
   if current_preview->>'source_hash'<>r.source_hash then eligible:=false;why:='Current source snapshot differs';end if;
  exception when sqlstate '23514' or sqlstate '42501' then eligible:=false;why:='Source or recipient is no longer eligible';end;
 end if;
 return jsonb_build_object('release',to_jsonb(r)-'request','events',events,'eligible',eligible,'ineligibility_reason',why);
end $$;
create or replace function public.authorize_record_release(p_id uuid,p_client_id uuid,p_channel text,p_recipient text) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 perform 1 from public.record_release_policy where id and enabled and accepted_at<=now() and accepted_schema_version>=coalesce((select (snapshot->>'schema_version')::integer from public.record_releases where id=p_id),2) for share;
 if not found then raise exception 'Clinical release acceptance is not active' using errcode='42501';end if;
 result:=public.read_record_release(p_id);
 if (result->>'eligible')::boolean is distinct from true or result#>>'{release,client_id}' is distinct from p_client_id::text or result#>>'{release,channel}' is distinct from p_channel or result#>>'{release,recipient}' is distinct from public.communication_recipient(p_channel,p_recipient) then raise exception 'Release is not eligible for this household recipient' using errcode='42501';end if;
 return result;
end $$;
create function public.list_record_release_sources(p_pet_id uuid,p_offset integer default 0) returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.pets;c public.clients;r jsonb;k text;rows jsonb;query text;skip integer:=greatest(coalesce(p_offset,0),0);
begin
 perform public.clinical_require_staff();
 select * into p from public.pets where id=p_pet_id;
 if not found then raise exception 'Patient not found' using errcode='23514';end if;
 select * into c from public.clients where id=p.client_id;
 r:=jsonb_build_object('pet_id',p.id,'client_id',c.id,'client_name',c.full_name,'email',public.communication_recipient('EMAIL',c.primary_email),'phone',public.communication_recipient('SMS',c.primary_phone),'policy_accepted',exists(select 1 from public.record_release_policy where id and enabled and accepted_at<=now() and accepted_schema_version>=2));
 foreach k in array array['encounter_ids','certificate_ids','lab_order_ids','document_ids','dental_ids','qol_ids','anesthesia_ids','lesion_ids'] loop
  query:=case k
   when 'encounter_ids' then 'select id,version,visit_at as recorded_at,''Signed SOAP · ''||visit_type as label from public.clinical_encounters where pet_id=$1 and status=''signed'''
   when 'certificate_ids' then 'select id,1 as version,issued_at as recorded_at,kind||'' certificate'' as label from public.vaccine_certificates c where pet_id=$1 and not exists(select 1 from public.vaccine_certificate_events e where e.certificate_id=c.id)'
   when 'lab_order_ids' then 'select id,version,updated_at as recorded_at,test_name as label,result_document_id as required_document_id from public.patient_lab_orders where pet_id=$1 and status=''resulted'''
   when 'document_ids' then 'select id,version,created_at as recorded_at,file_name as label,mime_type,file_size from public.patient_documents where pet_id=$1 and status=''ready'' and visibility=''client_shareable'''
   when 'dental_ids' then 'select id,version,visit_at as recorded_at,''Signed dental · ''||dentition as label from public.dental_charts where pet_id=$1 and status=''signed'''
   when 'qol_ids' then 'select id,version,observed_at as recorded_at,''Signed QOL · ''||observer as label from public.patient_qol_records where pet_id=$1 and status=''signed'''
   when 'anesthesia_ids' then 'select id,version,started_at as recorded_at,procedure_name as label from public.patient_anesthesia_records where pet_id=$1 and status=''signed'''
   else 'select id,version,updated_at as recorded_at,label from public.patient_lesions where pet_id=$1' end;
  execute 'select coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb) from ('||query||' order by recorded_at desc,id limit 100 offset $2) x' into rows using p_pet_id,skip;
  r:=r||jsonb_build_object(k,rows);
 end loop;
 return r;
end $$;
revoke all on function public.preview_record_release_v1(uuid,uuid,text,text,jsonb),public.release_lock_chart_parent(),public.invalidate_record_release_chart() from public,anon,authenticated,service_role;
revoke all on function public.preview_record_release(uuid,uuid,text,text,jsonb),public.list_record_release_sources(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.preview_record_release(uuid,uuid,text,text,jsonb),public.list_record_release_sources(uuid,integer) to authenticated;
