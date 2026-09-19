-- Schema8 composes schema7 narratives with explicitly selected DVM-reviewed prescriptions.
alter table public.record_release_policy drop constraint record_release_policy_accepted_schema_version_check;
alter table public.record_release_policy add check(accepted_schema_version in(1,2,3,4,5,6,7,8));
alter table public.record_release_sources drop constraint record_release_sources_source_kind_check;
alter table public.record_release_sources add check(source_kind in('encounter','certificate','lab','document','dental','qol','anesthesia','lesion','problem','weight','treatment','patient_summary','lab_report','external_record','imported_history','imported_vaccination','imported_prescription'));
create function public.ezyvet_validate_reviewed_prescriptions(p_pet_id uuid,p_sources jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare rowrecord record;x jsonb;selected_prescription public.ezyvet_imported_prescriptions;result jsonb:='[]';begin
 if p_sources is null or jsonb_typeof(p_sources)<>'array' or jsonb_array_length(p_sources) not between 1 and 20 or(select count(*)<>count(distinct(value->>'id')::uuid) from jsonb_array_elements(p_sources)) then raise exception 'Choose distinct reviewed prescriptions' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_sources) ref where jsonb_typeof(ref)<>'object' or not(ref ?& array['id','version_hash']) or (ref-'id'-'version_hash')<>'{}'::jsonb or jsonb_typeof(ref->'id') is distinct from 'string' or ref->>'id' !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' or jsonb_typeof(ref->'version_hash') is distinct from 'string' or ref->>'version_hash' !~ '^[a-f0-9]{64}$') then raise exception 'Exact prescription version references required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_pet_id::text,4700));
 for rowrecord in select distinct m.id from public.ezyvet_imported_prescriptions v join public.ezyvet_record_links m on m.id=v.animal_link_id where v.id in(select(value->>'id')::uuid from jsonb_array_elements(p_sources)) order by m.id loop perform 1 from public.ezyvet_record_links where id=rowrecord.id for share;end loop;
 perform 1 from public.pets where id=p_pet_id for share;
 for rowrecord in select distinct h.source_origin,h.source_site_uid,h.resource,h.external_id from public.ezyvet_imported_prescriptions v join public.ezyvet_identity_heads h on h.source_origin=v.source_origin and h.source_site_uid=v.source_site_uid and((h.resource='consult' and h.external_id=v.context#>>'{consult,reference}') or(h.resource='prescription' and h.external_id=v.prescription_external_id) or(h.resource='prescriptionitem' and exists(select 1 from jsonb_array_elements(v.context->'items') i where i->>'external_id'=h.external_id))) where v.id in(select(value->>'id')::uuid from jsonb_array_elements(p_sources)) order by 1,2,3,4 loop
  perform 1 from public.ezyvet_identity_heads where source_origin=rowrecord.source_origin and source_site_uid=rowrecord.source_site_uid and resource=rowrecord.resource and external_id=rowrecord.external_id for share;
 end loop;
 for x in select value from jsonb_array_elements(p_sources) order by value->>'id' loop
  select * into selected_prescription from public.ezyvet_imported_prescriptions where id=(x->>'id')::uuid;
  if not found or selected_prescription.pet_id is distinct from p_pet_id or selected_prescription.version_hash is distinct from x->>'version_hash' or public.ezyvet_prescription_current(selected_prescription.id)->>'is_current' is distinct from 'true' or public.ezyvet_prescription_current(selected_prescription.id)->>'is_latest' is distinct from 'true' then raise exception 'Current latest same-patient reviewed prescription required' using errcode='40001';end if;
  result:=result||jsonb_build_array(public.ezyvet_imported_prescription_projection(selected_prescription.id));
 end loop;return result;end $$;
create function public.release_preview_v8_internal(p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare result jsonb;s jsonb;ids jsonb;refs jsonb;prescriptions jsonb:='[]';older jsonb;k text;older_count integer:=0;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_pet_id::text,4700));
 if p_selection is null or jsonb_typeof(p_selection)<>'object' or exists(select 1 from jsonb_object_keys(p_selection) f where f not in('encounter_ids','certificate_ids','lab_order_ids','document_ids','dental_ids','qol_ids','anesthesia_ids','lesion_ids','problem_ids','weight_ids','treatment_ids','patient_summary_ids','lab_report_ids','external_record_ids','imported_history_ids','imported_vaccination_ids','imported_prescription_ids')) then raise exception 'Choose explicit release sources' using errcode='23514';end if;
 ids:=coalesce(p_selection->'imported_prescription_ids','[]');
 if jsonb_typeof(ids)<>'array' or jsonb_array_length(ids)>20 or exists(select 1 from jsonb_array_elements(ids) v where jsonb_typeof(v)<>'string') or (select count(*)<>count(distinct v::uuid) from jsonb_array_elements_text(ids) v) then raise exception 'Select at most20 distinct reviewed prescription versions' using errcode='23514';end if;
 older:=p_selection-'imported_prescription_ids';
 for k in select jsonb_object_keys(older) loop
  if jsonb_typeof(older->k)<>'array' then raise exception 'Source selections must be arrays' using errcode='23514';end if;
  older_count:=older_count+jsonb_array_length(older->k);
 end loop;
 if jsonb_array_length(ids)>0 then
  select jsonb_agg(jsonb_build_object('id',v.id,'version_hash',v.version_hash) order by v.id) into refs from public.ezyvet_imported_prescriptions v where v.id in(select x::uuid from jsonb_array_elements_text(ids) x);
  if coalesce(jsonb_array_length(refs),0)<>jsonb_array_length(ids) then raise exception 'Selected prescription version unavailable' using errcode='23514';end if;
  prescriptions:=public.ezyvet_validate_reviewed_prescriptions(p_pet_id,refs);
 end if;
 if older_count=0 and jsonb_array_length(ids)>0 then
  -- Original core validates recipient/patient with no fabricated implicit source.
  result:=public.preview_record_release_v1(p_pet_id,p_client_id,p_channel,p_recipient,'{}');s:=result->'snapshot';
  s:=s||jsonb_build_object('selection',coalesce(s->'selection','{}')||jsonb_build_object('imported_vaccination_ids','[]'::jsonb));
  foreach k in array array['dental_charts','qol_records','anesthesia_records','lesions','problems','weights','treatments','patient_summaries','lab_reports','external_records','imported_histories','imported_vaccinations','problem_source_extractions'] loop s:=s||jsonb_build_object(k,'[]'::jsonb);end loop;
 else result:=public.release_preview_v7_internal(p_pet_id,p_client_id,p_channel,p_recipient,older);s:=result->'snapshot';end if;
 s:=s||jsonb_build_object('schema_version',8,'selection',coalesce(s->'selection','{}')||jsonb_build_object('imported_prescription_ids',ids),'imported_prescriptions',prescriptions);
 if octet_length(s::text)>1048576 then raise exception 'Release exceeds maximum reviewed snapshot size' using errcode='23514';end if;
 return jsonb_build_object('snapshot',s,'source_hash',encode(sha256(convert_to(s::text,'UTF8')),'hex'));
exception when invalid_text_representation then raise exception 'Source IDs must be valid UUIDs' using errcode='23514';end $$;
create function public.preview_record_release_v8(p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
begin perform public.clinical_require_staff();return public.release_preview_v8_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection);end $$;
do $$declare d text;needle text;begin
 select pg_get_functiondef('public.confirm_record_release(uuid,uuid,uuid,text,text,jsonb,jsonb,text,boolean)'::regprocedure) into d;
 needle:='if (p_reviewed_snapshot->>''schema_version'')::integer=7 then';
 if strpos(d,needle)=0 then raise exception 'Expected schema7 confirmation dispatch missing';end if;
 d:=replace(d,needle,'if (p_reviewed_snapshot->>''schema_version'')::integer=8 then preview:=public.release_preview_v8_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection); elsif (p_reviewed_snapshot->>''schema_version'')::integer=7 then');
 d:=replace(d,'(''5'',''6'',''7'')','(''5'',''6'',''7'',''8'')');
 d:=replace(d,'(''6'',''7'')','(''6'',''7'',''8'')');
 needle:='''imported_vaccination_ids''] loop';if strpos(d,needle)=0 then raise exception 'Expected vaccination source registry missing';end if;
 d:=replace(d,needle,'''imported_vaccination_ids'',''imported_prescription_ids''] loop');
 d:=replace(d,'when ''imported_vaccination_ids'' then ''imported_vaccination'' else','when ''imported_vaccination_ids'' then ''imported_vaccination'' when ''imported_prescription_ids'' then ''imported_prescription'' else');execute d;
 select pg_get_functiondef('public.release_read_internal(uuid)'::regprocedure) into d;
 needle:='if r.snapshot->>''schema_version''=''7'' then';if strpos(d,needle)=0 then raise exception 'Expected schema7 recovery dispatch missing';end if;
 d:=replace(d,needle,'if r.snapshot->>''schema_version''=''8'' then current_preview:=public.release_preview_v8_internal(r.pet_id,r.client_id,r.channel,r.recipient,r.selection); elsif r.snapshot->>''schema_version''=''7'' then');
 d:=replace(d,'(''5'',''6'',''7'')','(''5'',''6'',''7'',''8'')');d:=replace(d,'(''6'',''7'')','(''6'',''7'',''8'')');execute d;
 select pg_get_functiondef(oid) into d from pg_proc where pronamespace='public'::regnamespace and proname='verify_release_source_original_v5';
 needle:='p_snapshot->>''schema_version'' is distinct from ''7''';if d is null or strpos(d,needle)=0 then raise exception 'Expected schema7 byte verification guard missing';end if;
 execute replace(d,needle,needle||' and p_snapshot->>''schema_version'' is distinct from ''8''');
end $$;
do $$declare name text;d text;needle text;begin
 foreach name in array array['invalidate_release_source_provenance','release_weight_provenance_changed','release_weight_source_head_changed'] loop
  select pg_get_functiondef(oid) into d from pg_proc where pronamespace='public'::regnamespace and proname=name;
  needle:='''6'',''7'')';if d is null or strpos(d,needle)=0 then raise exception 'Expected inherited provenance event guard missing: %',name;end if;
  execute replace(d,needle,'''6'',''7'',''8'')');
 end loop;
end $$;
create function public.invalidate_imported_prescription_release() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if TG_TABLE_NAME='ezyvet_identity_heads' then
  if NEW.resource not in('prescription','prescriptionitem','consult') or row(NEW.snapshot_id,NEW.version) is not distinct from row(OLD.snapshot_id,OLD.version) then return NEW;end if;
  insert into public.record_release_events(id,release_id,kind,reason,created_by)
  select gen_random_uuid(),r.id,'source_changed','Reviewed prescription source changed; review a fresh package',auth.uid() from public.record_releases r where exists(select 1 from public.record_release_sources rs join public.ezyvet_imported_prescriptions v on v.id=rs.source_id where rs.release_id=r.id and rs.source_kind='imported_prescription' and v.source_origin=NEW.source_origin and v.source_site_uid=NEW.source_site_uid and ((NEW.resource='prescription' and v.prescription_external_id=NEW.external_id) or (NEW.resource='consult' and v.context#>>'{consult,reference}'=NEW.external_id) or (NEW.resource='prescriptionitem' and exists(select 1 from jsonb_array_elements(v.context->'items') i where i->>'external_id'=NEW.external_id))));
 else
  insert into public.record_release_events(id,release_id,kind,reason,created_by)
  select gen_random_uuid(),r.id,'source_changed','Reviewed prescription superseded; review a fresh package',auth.uid() from public.record_releases r where exists(select 1 from public.record_release_sources rs join public.ezyvet_imported_prescriptions v on v.id=rs.source_id where rs.release_id=r.id and rs.source_kind='imported_prescription' and v.source_origin=NEW.source_origin and v.source_site_uid=NEW.source_site_uid and v.animal_link_id=NEW.animal_link_id and v.prescription_external_id=NEW.prescription_external_id);
 end if;
 -- Append-only events avoid acquiring a release row behind a source-head lock.
 return NEW;
end $$;
create trigger release_imported_prescription_source after update on public.ezyvet_identity_heads for each row execute function public.invalidate_imported_prescription_release();
create trigger release_imported_prescription_review after insert on public.ezyvet_imported_prescriptions for each row execute function public.invalidate_imported_prescription_release();
create function public.list_record_release_sources_v8(p_pet_id uuid,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;rows jsonb;more boolean;begin
 perform public.clinical_require_staff();result:=public.list_record_release_sources_v7(p_pet_id,p_offset);
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'version',version,'version_hash',version_hash,'completeness',context#>'{reviewed,completeness}','partial_disclosure',context#>'{reviewed,partial_reason}','recorded_at',approved_at,'label','Outside prescription '||prescription_external_id||' · reviewed version '||version,'source_label','ezyVet · '||source_site_uid) order by approved_at desc,id desc),'[]') into rows from(select * from public.ezyvet_imported_prescriptions v where pet_id=p_pet_id and public.ezyvet_prescription_current(v.id) @> '{"is_current":true,"is_latest":true,"identity_valid":true}'::jsonb order by approved_at desc,id desc offset p_offset limit 101) selected;
 more:=jsonb_array_length(rows)>100;if more then rows:=rows-100;end if;
 return result||jsonb_build_object('imported_prescription_ids',rows,'has_more',result->'has_more'||jsonb_build_object('imported_prescription_ids',more),'policy_v8_accepted',exists(select 1 from public.record_release_policy where id and enabled and accepted_at<=now() and accepted_schema_version>=8));
end $$;
create function public.select_all_record_release_sources_v8(p_pet_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;ids jsonb;begin
 perform public.clinical_require_staff();result:=public.select_all_record_release_sources_v7(p_pet_id);
 select coalesce(jsonb_agg(id order by id),'[]') into ids from public.ezyvet_imported_prescriptions v where pet_id=p_pet_id and public.ezyvet_prescription_current(v.id) @> '{"is_current":true,"is_latest":true,"identity_valid":true}'::jsonb;
 if jsonb_array_length(ids)>20 then raise exception 'More than20 reviewed prescriptions; split into explicit packages' using errcode='23514';end if;
 return result||jsonb_build_object('selection',result->'selection'||jsonb_build_object('imported_prescription_ids',ids));
end $$;
do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in('ezyvet_validate_reviewed_prescriptions','release_preview_v8_internal','preview_record_release_v8','invalidate_imported_prescription_release','list_record_release_sources_v8','select_all_record_release_sources_v8') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in('preview_record_release_v8','list_record_release_sources_v8','select_all_record_release_sources_v8') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
