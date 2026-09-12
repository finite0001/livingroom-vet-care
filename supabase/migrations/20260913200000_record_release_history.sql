-- Explicit clinical history families; compatibility snapshots remain unchanged.
alter table public.record_release_policy drop constraint record_release_policy_accepted_schema_version_check;
alter table public.record_release_policy add check(accepted_schema_version in (1,2,3));
alter table public.record_release_sources drop constraint record_release_sources_source_kind_check;
alter table public.record_release_sources add check(source_kind in ('encounter','certificate','lab','document','dental','qol','anesthesia','lesion','problem','weight','treatment','patient_summary'));
alter function public.preview_record_release(uuid,uuid,text,text,jsonb) rename to preview_record_release_v2;
create or replace function public.preview_record_release_v2(p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
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

-- Audit evidence is projected to clinical fields only, never exposed as raw audit records.
create function public.release_problem_fields(p jsonb) returns jsonb language sql immutable set search_path=public as $$
select jsonb_build_object('version',p->'version','title',p->'title','notes',p->'notes','onset_date',p->'onset_date','status',p->'status','importance',p->'importance','updated_by',p->'updated_by','updated_at',p->'updated_at') $$;
create function public.preview_record_release(p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare k text;ids jsonb;selected uuid;total integer:=0;added integer:=0;r jsonb;s jsonb;p public.patient_problems;w public.patient_weights;t public.patient_treatments;pet public.pets;problems jsonb:='[]';weights jsonb:='[]';treatments jsonb:='[]';summary jsonb:='[]';
begin
 perform public.clinical_require_staff();
 if p_selection is null or jsonb_typeof(p_selection)<>'object' or exists(select 1 from jsonb_object_keys(p_selection) f where f not in ('encounter_ids','certificate_ids','lab_order_ids','document_ids','dental_ids','qol_ids','anesthesia_ids','lesion_ids','problem_ids','weight_ids','treatment_ids','patient_summary_ids')) then raise exception 'Choose explicit release sources' using errcode='23514';end if;
 foreach k in array array['encounter_ids','certificate_ids','lab_order_ids','document_ids','dental_ids','qol_ids','anesthesia_ids','lesion_ids','problem_ids','weight_ids','treatment_ids','patient_summary_ids'] loop
  ids:=coalesce(p_selection->k,'[]');
  if jsonb_typeof(ids)<>'array' then raise exception 'Source selections must be arrays' using errcode='23514';end if;
  if jsonb_array_length(ids)>100 then raise exception 'Choose at most 100 records per source family' using errcode='23514';end if;
  if exists(select 1 from jsonb_array_elements(ids) v where jsonb_typeof(v)<>'string') or (select count(*) from jsonb_array_elements_text(ids))<>(select count(distinct v::uuid) from jsonb_array_elements_text(ids) v) then raise exception 'Source IDs must be unique strings' using errcode='23514';end if;
  total:=total+jsonb_array_length(ids);
  if k in ('problem_ids','weight_ids','treatment_ids','patient_summary_ids') then added:=added+jsonb_array_length(ids);end if;
 end loop;
 if total=0 then raise exception 'Choose at least one source; nothing is included by default' using errcode='23514';end if;
 if added=0 then return public.preview_record_release_v2(p_pet_id,p_client_id,p_channel,p_recipient,p_selection-array['problem_ids','weight_ids','treatment_ids','patient_summary_ids']);end if;
 for selected in select v::uuid from jsonb_array_elements_text(coalesce(p_selection->'problem_ids','[]')) v order by v loop
  select * into p from public.patient_problems where id=selected and pet_id=p_pet_id for update;
  if not found then raise exception 'Diagnosis history must belong to this patient' using errcode='23514';end if;
  problems:=problems||jsonb_build_array(jsonb_build_object('id',p.id,'created_by',p.created_by,'created_at',p.created_at,'current',public.release_problem_fields(to_jsonb(p)),'history',coalesce((select jsonb_agg(jsonb_build_object('recorded_at',a.created_at,'recorded_by',a.user_id,'action',a.action,'before',case when a.old_data is not null then public.release_problem_fields(a.old_data) end,'after',case when a.new_data is not null then public.release_problem_fields(a.new_data) end) order by a.created_at,a.id) from public.audit_logs a where a.table_name='patient_problems' and a.record_id=p.id and (a.new_data->>'pet_id'=p_pet_id::text or a.old_data->>'pet_id'=p_pet_id::text)),'[]')));
 end loop;
 for selected in select v::uuid from jsonb_array_elements_text(coalesce(p_selection->'weight_ids','[]')) v order by v loop
  select * into w from public.patient_weights where id=selected and pet_id=p_pet_id for share;
  if not found then raise exception 'Weight measurement must belong to this patient' using errcode='23514';end if;
  weights:=weights||jsonb_build_array(to_jsonb(w)-'pet_id');
 end loop;
 for selected in select v::uuid from jsonb_array_elements_text(coalesce(p_selection->'treatment_ids','[]')) v order by v loop
  select * into t from public.patient_treatments where id=selected and pet_id=p_pet_id for update;
  if not found then raise exception 'Treatment history must belong to this patient' using errcode='23514';end if;
  treatments:=treatments||jsonb_build_array((to_jsonb(t)-array['request','pet_id','product_id','lot_id','invoice_id'])||jsonb_build_object('corrections',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at,c.id) from public.patient_treatment_corrections c where treatment_id=t.id),'[]')));
 end loop;
 for selected in select v::uuid from jsonb_array_elements_text(coalesce(p_selection->'patient_summary_ids','[]')) v loop
  select * into pet from public.pets where id=selected and id=p_pet_id for share;
  if not found then raise exception 'Patient summary must belong to this patient' using errcode='23514';end if;
  summary:=jsonb_build_array(jsonb_build_object('id',pet.id,'version',pet.version,'allergies',pet.allergies,'legacy_weight_lbs',pet.weight_lbs,'provenance','Existing patient profile; allergy verification and legacy weight measurement date are not recorded'));
 end loop;
 r:=public.preview_record_release_v2(p_pet_id,p_client_id,p_channel,p_recipient,p_selection-array['problem_ids','weight_ids','treatment_ids','patient_summary_ids']);
 s:=(r->'snapshot')||jsonb_build_object('schema_version',3,'problems',problems,'weights',weights,'treatments',treatments,'patient_summaries',summary);
 return jsonb_build_object('snapshot',s,'source_hash',encode(sha256(convert_to(s::text,'UTF8')),'hex'));
exception when invalid_text_representation then raise exception 'Source IDs must be valid UUIDs' using errcode='23514';
end $$;
create or replace function public.confirm_record_release(p_id uuid,p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb,p_reviewed_snapshot jsonb,p_reviewed_hash text,p_attest_review boolean) returns public.record_releases language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff(); result public.record_releases; preview jsonb; req jsonb; k text; source_type text;
begin
 if p_id is null or p_attest_review is distinct from true then raise exception 'Stable ID and explicit content/recipient review are required' using errcode='23514'; end if;
 req:=jsonb_build_object('pet_id',p_pet_id,'client_id',p_client_id,'channel',p_channel,'recipient',p_recipient,'selection',p_selection,'reviewed_snapshot',p_reviewed_snapshot,'reviewed_hash',p_reviewed_hash,'attest_review',p_attest_review);
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,13));
 select * into result from public.record_releases where id=p_id;
 if found then if result.created_by<>actor or result.request is distinct from req then raise exception 'Release identifier already used' using errcode='23514'; end if; return result; end if;
 perform 1 from public.record_release_policy where id and enabled and accepted_at<=now() and accepted_schema_version>=coalesce((p_reviewed_snapshot->>'schema_version')::integer,3) for share;
 if not found then raise exception 'Clinical acceptance of the release form and workflow is required before confirmation' using errcode='42501'; end if;
 preview:=public.preview_record_release(p_pet_id,p_client_id,p_channel,p_recipient,p_selection);
 if preview->'snapshot' is distinct from p_reviewed_snapshot or preview->>'source_hash' is distinct from p_reviewed_hash then raise exception 'Release sources or recipient changed; preview and review again' using errcode='40001'; end if;
 insert into public.record_releases(id,pet_id,client_id,channel,recipient,selection,snapshot,source_hash,request,created_by) values(p_id,p_pet_id,p_client_id,p_channel,preview#>>'{snapshot,recipient,address}',p_selection,p_reviewed_snapshot,p_reviewed_hash,req,actor) returning * into result;
 foreach k in array array['encounter_ids','certificate_ids','lab_order_ids','document_ids','dental_ids','qol_ids','anesthesia_ids','lesion_ids','problem_ids','weight_ids','treatment_ids','patient_summary_ids'] loop
  source_type:=case k when 'encounter_ids' then 'encounter' when 'certificate_ids' then 'certificate' when 'lab_order_ids' then 'lab' when 'dental_ids' then 'dental' when 'qol_ids' then 'qol' when 'anesthesia_ids' then 'anesthesia' when 'lesion_ids' then 'lesion' when 'problem_ids' then 'problem' when 'weight_ids' then 'weight' when 'treatment_ids' then 'treatment' when 'patient_summary_ids' then 'patient_summary' else 'document' end;
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
   if r.snapshot->>'schema_version'='1' then current_preview:=public.preview_record_release_v1(r.pet_id,r.client_id,r.channel,r.recipient,r.selection); elsif r.snapshot->>'schema_version'='2' then current_preview:=public.preview_record_release_v2(r.pet_id,r.client_id,r.channel,r.recipient,r.selection); else current_preview:=public.preview_record_release(r.pet_id,r.client_id,r.channel,r.recipient,r.selection);end if;
   if current_preview->>'source_hash'<>r.source_hash then eligible:=false;why:='Current source snapshot differs';end if;
  exception when sqlstate '23514' or sqlstate '42501' then eligible:=false;why:='Source or recipient is no longer eligible';end;
 end if;
 return jsonb_build_object('release',to_jsonb(r)-'request','events',events,'eligible',eligible,'ineligibility_reason',why);
end $$;

create function public.invalidate_record_release_history() returns trigger language plpgsql security definer set search_path=public as $$
declare kind text;source uuid;
begin
 if TG_TABLE_NAME='patient_problems' then kind:='problem';source:=NEW.id;
 elsif TG_TABLE_NAME='patient_treatment_corrections' then kind:='treatment';source:=NEW.treatment_id;
 end if;
 insert into public.record_release_events(id,release_id,kind,reason,created_by) select gen_random_uuid(),release_id,'source_changed','Reviewed '||kind||' history changed; prepare a fresh package',auth.uid() from public.record_release_sources where source_kind=kind and source_id=source;
 return NEW;
end $$;
create function public.release_lock_treatment_history() returns trigger language plpgsql security definer set search_path=public as $$
begin perform 1 from public.patient_treatments where id=NEW.treatment_id for update;return NEW;end $$;
create trigger release_problem_changed after update on public.patient_problems for each row execute function public.invalidate_record_release_history();
create trigger aaa_release_treatment_lock before insert on public.patient_treatment_corrections for each row execute function public.release_lock_treatment_history();
create trigger release_treatment_changed after insert on public.patient_treatment_corrections for each row execute function public.invalidate_record_release_history();
create or replace function public.list_record_release_sources(p_pet_id uuid,p_offset integer default 0) returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.pets;c public.clients;r jsonb;k text;rows jsonb;query text;skip integer:=greatest(coalesce(p_offset,0),0);
begin
 perform public.clinical_require_staff();
 select * into p from public.pets where id=p_pet_id;
 if not found then raise exception 'Patient not found' using errcode='23514';end if;
 select * into c from public.clients where id=p.client_id;
 r:=jsonb_build_object('pet_id',p.id,'client_id',c.id,'client_name',c.full_name,'email',public.communication_recipient('EMAIL',c.primary_email),'phone',public.communication_recipient('SMS',c.primary_phone),'policy_accepted',exists(select 1 from public.record_release_policy where id and enabled and accepted_at<=now() and accepted_schema_version>=3));
 foreach k in array array['encounter_ids','certificate_ids','lab_order_ids','document_ids','dental_ids','qol_ids','anesthesia_ids','lesion_ids','problem_ids','weight_ids','treatment_ids','patient_summary_ids'] loop
  query:=case k
   when 'encounter_ids' then 'select id,version,visit_at as recorded_at,''Signed SOAP · ''||visit_type as label from public.clinical_encounters where pet_id=$1 and status=''signed'''
   when 'certificate_ids' then 'select id,1 as version,issued_at as recorded_at,kind||'' certificate'' as label from public.vaccine_certificates c where pet_id=$1 and not exists(select 1 from public.vaccine_certificate_events e where e.certificate_id=c.id)'
   when 'lab_order_ids' then 'select id,version,updated_at as recorded_at,test_name as label,result_document_id as required_document_id from public.patient_lab_orders where pet_id=$1 and status=''resulted'''
   when 'document_ids' then 'select id,version,created_at as recorded_at,file_name as label,mime_type,file_size from public.patient_documents where pet_id=$1 and status=''ready'' and visibility=''client_shareable'''
   when 'dental_ids' then 'select id,version,visit_at as recorded_at,''Signed dental · ''||dentition as label from public.dental_charts where pet_id=$1 and status=''signed'''
   when 'qol_ids' then 'select id,version,observed_at as recorded_at,''Signed QOL · ''||observer as label from public.patient_qol_records where pet_id=$1 and status=''signed'''
   when 'anesthesia_ids' then 'select id,version,started_at as recorded_at,procedure_name as label from public.patient_anesthesia_records where pet_id=$1 and status=''signed'''
   when 'lesion_ids' then 'select id,version,updated_at as recorded_at,label from public.patient_lesions where pet_id=$1'
   when 'problem_ids' then 'select id,version,updated_at as recorded_at,case when importance=''high'' then ''IMPORTANT · '' else '''' end||title||'' · ''||status as label,importance from public.patient_problems where pet_id=$1'
   when 'weight_ids' then 'select id,1 as version,measured_at as recorded_at,weight::text||'' ''||unit as label from public.patient_weights where pet_id=$1'
   when 'treatment_ids' then 'select id,1 as version,administered_at as recorded_at,kind||'' · ''||product_name||case when exists(select 1 from public.patient_treatment_corrections c where c.treatment_id=t.id) then '' · CORRECTED HISTORY'' else '''' end as label from public.patient_treatments t where pet_id=$1'
   else 'select id,version,created_at as recorded_at,''Allergy summary and undated legacy profile weight'' as label from public.pets where id=$1' end;
  execute 'select coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb) from ('||query||' order by recorded_at desc,id limit 100 offset $2) x' into rows using p_pet_id,skip;
  r:=r||jsonb_build_object(k,rows);
 end loop;
 return r;
end $$;

-- One SQL statement snapshot collects every eligible ID independently of the UI page.
create function public.select_all_record_release_sources(p_pet_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;over_limit text;
begin
 perform public.clinical_require_staff();
 if not exists(select 1 from public.pets where id=p_pet_id) then raise exception 'Patient not found' using errcode='23514';end if;
 with eligible_docs as (
  select d.id from public.patient_documents d join storage.objects o on o.bucket_id='patient-documents' and o.name=d.file_path and o.metadata->>'size'=d.file_size::text and o.metadata->>'mimetype'=d.mime_type where d.pet_id=p_pet_id and d.status='ready' and d.visibility='client_shareable'
 ), sources(k,id) as (
  select 'encounter_ids',id from public.clinical_encounters where pet_id=p_pet_id and status='signed'
  union all select 'certificate_ids',id from public.vaccine_certificates c where pet_id=p_pet_id and not exists(select 1 from public.vaccine_certificate_events e where e.certificate_id=c.id)
  union all select 'lab_order_ids',id from public.patient_lab_orders where pet_id=p_pet_id and status='resulted' and result_document_id in (select id from eligible_docs)
  union all select 'document_ids',id from eligible_docs
  union all select 'dental_ids',id from public.dental_charts where pet_id=p_pet_id and status='signed'
  union all select 'qol_ids',id from public.patient_qol_records where pet_id=p_pet_id and status='signed'
  union all select 'anesthesia_ids',id from public.patient_anesthesia_records where pet_id=p_pet_id and status='signed'
  union all select 'lesion_ids',id from public.patient_lesions where pet_id=p_pet_id
  union all select 'problem_ids',id from public.patient_problems where pet_id=p_pet_id
  union all select 'weight_ids',id from public.patient_weights where pet_id=p_pet_id
  union all select 'treatment_ids',id from public.patient_treatments where pet_id=p_pet_id
  union all select 'patient_summary_ids',id from public.pets where id=p_pet_id
 ), families as (select k,count(*) as n,case when count(*)<=100 then jsonb_agg(id order by id) else '[]'::jsonb end as ids from sources group by k)
 select jsonb_build_object('selection',coalesce((select jsonb_object_agg(k,ids) from families),'{}'),
 'excluded_unavailable_originals',(select count(*) from public.patient_documents where pet_id=p_pet_id and status='ready' and visibility='client_shareable' and id not in (select id from eligible_docs)),
 'excluded_labs_without_shareable_original',(select count(*) from public.patient_lab_orders where pet_id=p_pet_id and status='resulted' and (result_document_id is null or result_document_id not in(select id from eligible_docs))),
 'scope','All currently eligible native structured records and ready client-shareable originals. Unsigned drafts, invalid certificates and internal originals are excluded. Selection is fixed now; review the exact snapshot before confirming.'),
 (select string_agg(k,', ' order by k) from families where n>100) into result,over_limit;
 if over_limit is not null then raise exception 'More than 100 records in %. Split this patient history into explicitly reviewed packages; no partial all-record selection was returned',over_limit using errcode='23514';end if;
 return result;
end $$;
revoke all on function public.preview_record_release_v2(uuid,uuid,text,text,jsonb),public.release_problem_fields(jsonb),public.invalidate_record_release_history(),public.release_lock_treatment_history() from public,anon,authenticated,service_role;
revoke all on function public.preview_record_release(uuid,uuid,text,text,jsonb),public.select_all_record_release_sources(uuid) from public,anon,authenticated,service_role;
grant execute on function public.preview_record_release(uuid,uuid,text,text,jsonb),public.select_all_record_release_sources(uuid) to authenticated;
