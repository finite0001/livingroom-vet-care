-- Schema10 adds explicitly selected native prescribing/dispensing evidence.
-- No policy acceptance and no historical release rewrite occurs here.
alter table public.record_release_policy drop constraint record_release_policy_accepted_schema_version_check;
alter table public.record_release_policy add constraint record_release_policy_accepted_schema_version_check check(accepted_schema_version in(1,2,3,4,5,6,7,8,9,10));
alter table public.record_release_sources drop constraint record_release_sources_source_kind_check;
alter table public.record_release_sources add constraint record_release_sources_source_kind_check check(source_kind in('encounter','certificate','lab','document','dental','qol','anesthesia','lesion','problem','weight','treatment','patient_summary','lab_report','external_record','imported_history','imported_vaccination','imported_prescription','api_attachment','native_prescription','native_dispense'));

-- Caller holds the authorization gate. No volatile observation timestamp enters
-- this deterministic projection; private worker composition has no auth.uid dependency.
create function public.release_native_prescription(p_id uuid,p_pet_id uuid,p_client_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare d jsonb;e public.native_prescription_authorization_events;state text;
begin
 d:=public.native_rx_verified_authorization(p_id);
 if d is null or d->>'pet_id' is distinct from p_pet_id::text or d->>'client_id' is distinct from p_client_id::text then raise exception 'Selected native prescription unavailable for patient household' using errcode='23514';end if;
 select * into e from public.native_prescription_authorization_events where authorization_id=p_id order by event_version desc limit 1;
 state:=case when e.action='cancel' then 'cancelled' when e.action='replace' then 'replaced' when (d#>>'{artifact,expires_on}')::date<(clock_timestamp() at time zone 'America/Denver')::date then 'expired' else 'active' end;
 return jsonb_build_object('id',p_id,'authorization_hash',d->'authorization_hash','artifact',d->'artifact',
 'status',jsonb_build_object('state',state,'head_id',e.id,'head_version',coalesce(e.event_version,0),'event_at',e.created_at,'reason',e.reason,'replacement_id',e.replacement_id),
 'usage',public.native_rx_usage_context(p_id));
end $$;

create function public.release_preview_v10_internal(p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare k text;ids jsonb;rxids jsonb;fillids jsonb;older jsonb;count_old integer:=0;aid uuid;did uuid;d jsonb;pickup jsonb;s jsonb;result jsonb;prescriptions jsonb:='[]';dispenses jsonb:='[]';selection jsonb:='{}';
begin
 if auth.role() is distinct from 'service_role' then perform public.clinical_require_staff();end if;
 if p_pet_id is null or p_client_id is null or p_selection is null or jsonb_typeof(p_selection) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_selection) f where f not in('encounter_ids','certificate_ids','lab_order_ids','document_ids','dental_ids','qol_ids','anesthesia_ids','lesion_ids','problem_ids','weight_ids','treatment_ids','patient_summary_ids','lab_report_ids','external_record_ids','imported_history_ids','imported_vaccination_ids','imported_prescription_ids','api_attachment_ids','native_prescription_ids','native_dispense_ids')) then raise exception 'Choose explicit release sources' using errcode='23514';end if;
 foreach k in array array['native_prescription_ids','native_dispense_ids'] loop
  ids:=coalesce(p_selection->k,'[]');
  if jsonb_typeof(ids) is distinct from 'array' or jsonb_array_length(ids)>20 then raise exception 'Select at most20 distinct native sources per family' using errcode='23514';end if;
  if exists(select 1 from jsonb_array_elements(ids) v where jsonb_typeof(v) is distinct from 'string') or (select count(*)<>count(distinct v::uuid) from jsonb_array_elements_text(ids) v) then raise exception 'Select distinct native UUID strings' using errcode='23514';end if;
  select coalesce(jsonb_agg(v::uuid order by v::uuid),'[]') into ids from jsonb_array_elements_text(ids) v;
  selection:=selection||jsonb_build_object(k,ids);
 end loop;
 rxids:=selection->'native_prescription_ids';fillids:=selection->'native_dispense_ids';older:=p_selection-'native_prescription_ids'-'native_dispense_ids';
 for k in select jsonb_object_keys(older) loop
  if jsonb_typeof(older->k) is distinct from 'array' then raise exception 'Source selections must be arrays' using errcode='23514';end if;
  count_old:=count_old+jsonb_array_length(older->k);
 end loop;
 if count_old+jsonb_array_length(rxids)+jsonb_array_length(fillids)=0 then raise exception 'Choose at least one source; nothing is included by default' using errcode='23514';end if;
 -- Immutable parent discovery, followed by a global sorted gate order BEFORE any inherited locks.
 for aid in select x::uuid from jsonb_array_elements_text(rxids) x union select v.authorization_id from public.native_dispenses v where v.id in(select x::uuid from jsonb_array_elements_text(fillids) x) order by 1 loop
  perform pg_advisory_xact_lock(hashtextextended('native-prescription-authorization:'||aid::text,0));
 end loop;
 if auth.role() is distinct from 'service_role' then perform public.clinical_require_staff();end if;
 if count_old=0 then
  perform pg_advisory_xact_lock(hashtextextended(p_pet_id::text,4700));
  result:=public.preview_record_release_v1(p_pet_id,p_client_id,p_channel,p_recipient,'{}');s:=result->'snapshot';
  foreach k in array array['dental_charts','qol_records','anesthesia_records','lesions','problems','weights','treatments','patient_summaries','lab_reports','external_records','imported_histories','problem_source_extractions','imported_vaccinations','imported_prescriptions','api_attachments'] loop s:=s||jsonb_build_object(k,'[]'::jsonb);end loop;
  -- Keep explicit empty inherited families; do not manufacture a selected source.
  foreach k in array array['encounter_ids','certificate_ids','lab_order_ids','document_ids','dental_ids','qol_ids','anesthesia_ids','lesion_ids','problem_ids','weight_ids','treatment_ids','patient_summary_ids','lab_report_ids','external_record_ids','imported_history_ids','imported_vaccination_ids','imported_prescription_ids','api_attachment_ids'] loop selection:=selection||jsonb_build_object(k,'[]'::jsonb);end loop;
 else result:=public.release_preview_v9_internal(p_pet_id,p_client_id,p_channel,p_recipient,older);s:=result->'snapshot';selection:=coalesce(s->'selection','{}')||selection;end if;
 for aid in select x::uuid from jsonb_array_elements_text(rxids) x order by 1 loop
  prescriptions:=prescriptions||jsonb_build_array(public.release_native_prescription(aid,p_pet_id,p_client_id));
 end loop;
 for did in select x::uuid from jsonb_array_elements_text(fillids) x order by 1 loop
  d:=public.native_fulfillment_verified_dispense(did);
  if d is null or d->>'pet_id' is distinct from p_pet_id::text or d->>'client_id' is distinct from p_client_id::text then raise exception 'Selected native dispense unavailable for patient household' using errcode='23514';end if;
  select jsonb_build_object('id',v.id,'picked_up_at',v.document->'picked_up_at','recipient_name',v.document->'recipient_name','actor_id',v.actor_id) into pickup from public.native_pickups v where v.dispense_id=did;
  dispenses:=dispenses||jsonb_build_array(jsonb_build_object('id',did,'artifact_hash',d->'artifact_hash','artifact',(d->'artifact')-'invoice_id',
   'prescription',public.release_native_prescription((d->>'authorization_id')::uuid,p_pet_id,p_client_id),'pickup',pickup));
 end loop;
 s:=s||jsonb_build_object('schema_version',10,'selection',selection,'native_prescriptions',prescriptions,'native_dispenses',dispenses);
 if octet_length(s::text)>1048576 then raise exception 'Release exceeds maximum reviewed snapshot size' using errcode='23514';end if;
 if auth.role() is distinct from 'service_role' then perform public.clinical_require_staff();end if;
 return jsonb_build_object('snapshot',s,'source_hash',encode(sha256(convert_to(s::text,'UTF8')),'hex'));
exception when invalid_text_representation then raise exception 'Source IDs must be valid UUIDs' using errcode='23514';end $$;

create function public.preview_record_release_v10(p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;begin perform public.clinical_require_staff();result:=public.release_preview_v10_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection);perform public.clinical_require_staff();return result;end $$;

-- Guard effective definitions instead of rewriting any prior migration or receipt.
do $$declare d text;needle text;name text;begin
 select pg_get_functiondef('public.confirm_record_release(uuid,uuid,uuid,text,text,jsonb,jsonb,text,boolean)'::regprocedure) into d;
 needle:='if (p_reviewed_snapshot->>''schema_version'')::integer=9 then';if strpos(d,needle)=0 then raise exception 'Expected schema9 confirmation dispatch missing';end if;
 d:=replace(d,needle,'if (p_reviewed_snapshot->>''schema_version'')::integer=10 then preview:=public.release_preview_v10_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection); elsif (p_reviewed_snapshot->>''schema_version'')::integer=9 then');
 d:=replace(d,'(''5'',''6'',''7'',''8'',''9'')','(''5'',''6'',''7'',''8'',''9'',''10'')');d:=replace(d,'(''6'',''7'',''8'',''9'')','(''6'',''7'',''8'',''9'',''10'')');
 needle:='''api_attachment_ids''] loop';if strpos(d,needle)=0 then raise exception 'Expected schema9 source registry missing';end if;
 d:=replace(d,needle,'''api_attachment_ids'',''native_prescription_ids'',''native_dispense_ids''] loop');
 needle:='when ''api_attachment_ids'' then ''api_attachment'' else';if strpos(d,needle)=0 then raise exception 'Expected schema9 source mapping missing';end if;
 d:=replace(d,needle,'when ''api_attachment_ids'' then ''api_attachment'' when ''native_prescription_ids'' then ''native_prescription'' when ''native_dispense_ids'' then ''native_dispense'' else');execute d;
 select pg_get_functiondef('public.release_read_internal(uuid)'::regprocedure) into d;
 needle:='if r.snapshot->>''schema_version''=''9'' then';if strpos(d,needle)=0 then raise exception 'Expected schema9 recovery dispatch missing';end if;
 d:=replace(d,needle,'if r.snapshot->>''schema_version''=''10'' then current_preview:=public.release_preview_v10_internal(r.pet_id,r.client_id,r.channel,r.recipient,r.selection); elsif r.snapshot->>''schema_version''=''9'' then');
 d:=replace(d,'(''5'',''6'',''7'',''8'',''9'')','(''5'',''6'',''7'',''8'',''9'',''10'')');d:=replace(d,'(''6'',''7'',''8'',''9'')','(''6'',''7'',''8'',''9'',''10'')');execute d;
 select pg_get_functiondef('public.verify_release_source_original_v5(jsonb,jsonb,bytea)'::regprocedure) into d;
 needle:='p_snapshot->>''schema_version'' is distinct from ''9''';if strpos(d,needle)=0 then raise exception 'Expected canonical schema9 original byte branch missing';end if;
 execute replace(d,needle,needle||' and p_snapshot->>''schema_version'' is distinct from ''10''');
 foreach name in array array['invalidate_release_source_provenance','release_weight_provenance_changed','release_weight_source_head_changed'] loop
  select pg_get_functiondef(oid) into d from pg_proc where pronamespace='public'::regnamespace and proname=name;
  needle:='''8'',''9'')';if d is null or strpos(d,needle)=0 then raise exception 'Expected inherited provenance guard missing: %',name;end if;
  execute replace(d,needle,'''8'',''9'',''10'')');
 end loop;
end $$;

create function public.invalidate_native_record_release() returns trigger language plpgsql security definer set search_path=public as $$
begin
 -- Append-only invalidation uses only compatible FK KEY SHARE on release rows.
 insert into public.record_release_events(id,release_id,kind,reason,created_by)
 select gen_random_uuid(),r.id,'source_changed','Native prescription or selected dispensing evidence changed; review a fresh package',coalesce(to_jsonb(NEW)->>'actor_id',to_jsonb(NEW)#>>'{document,actor_id}')::uuid
 from public.record_releases r where r.snapshot->>'schema_version'='10' and exists(
  select 1 from public.record_release_sources rs where rs.release_id=r.id and
   ((TG_TABLE_NAME<>'native_pickups' and rs.source_kind='native_prescription' and rs.source_id=NEW.authorization_id)
    or (rs.source_kind='native_dispense' and exists(select 1 from public.native_dispenses d where d.id=rs.source_id and d.authorization_id=NEW.authorization_id and (TG_TABLE_NAME<>'native_pickups' or d.id=(to_jsonb(NEW)->>'dispense_id')::uuid)))));
 return NEW;
end $$;
create trigger native_release_terminal after insert on public.native_prescription_authorization_events for each row execute function public.invalidate_native_record_release();
create trigger native_release_fulfillment after insert on public.native_fulfillment_events for each row execute function public.invalidate_native_record_release();
create trigger native_release_pickup after insert on public.native_pickups for each row execute function public.invalidate_native_record_release();

create function public.list_record_release_sources_v10(p_pet_id uuid,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;rows jsonb;more boolean;begin
 perform public.clinical_require_staff();if p_offset is null or p_offset<0 then raise exception 'Nonnegative source offset required' using errcode='23514';end if;
 result:=public.list_record_release_sources_v9(p_pet_id,p_offset);
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'version',1,'recorded_at',document->'signed_at','label',(document#>>'{artifact,medication,name}')||' · '||(document->>'signed_at'),'source_label','Living Room Vet · Signed prescription') order by (document->>'signed_at')::timestamptz desc,id desc),'[]') into rows from(select * from public.native_prescription_authorizations where pet_id=p_pet_id order by (document->>'signed_at')::timestamptz desc,id desc offset p_offset limit 101) a;
 more:=jsonb_array_length(rows)>100;if more then rows:=rows-100;end if;
 result:=result||jsonb_build_object('native_prescription_ids',rows,'has_more',result->'has_more'||jsonb_build_object('native_prescription_ids',more));
 select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'version',1,'recorded_at',v.dispensed_at,'label',(a.document#>>'{artifact,medication,name}')||' · '||v.dispensed_at::text,'source_label','Living Room Vet · Recorded dispense') order by v.dispensed_at desc,v.id desc),'[]') into rows from(select * from public.native_dispenses where pet_id=p_pet_id order by dispensed_at desc,id desc offset p_offset limit 101) v join public.native_prescription_authorizations a on a.id=v.authorization_id;
 more:=jsonb_array_length(rows)>100;if more then rows:=rows-100;end if;
 perform public.clinical_require_staff();return result||jsonb_build_object('native_dispense_ids',rows,'has_more',result->'has_more'||jsonb_build_object('native_dispense_ids',more),'policy_v10_accepted',exists(select 1 from public.record_release_policy where id and enabled and accepted_at<=now() and accepted_schema_version>=10));
end $$;
create function public.select_all_record_release_sources_v10(p_pet_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;rxids jsonb;fillids jsonb;begin
 perform public.clinical_require_staff();result:=public.select_all_record_release_sources_v9(p_pet_id);
 select coalesce(jsonb_agg(id order by id),'[]') into rxids from(select id from public.native_prescription_authorizations where pet_id=p_pet_id order by id limit 21) a;
 select coalesce(jsonb_agg(id order by id),'[]') into fillids from(select id from public.native_dispenses where pet_id=p_pet_id order by id limit 21) d;
 if jsonb_array_length(rxids)>20 or jsonb_array_length(fillids)>20 then raise exception 'More than20 native sources per family; split into explicit packages' using errcode='23514';end if;
 perform public.clinical_require_staff();return result||jsonb_build_object('selection',result->'selection'||jsonb_build_object('native_prescription_ids',rxids,'native_dispense_ids',fillids),'scope',coalesce(result->>'scope','')||'; schema10 explicitly selected native signed prescriptions and recorded dispenses');
end $$;
do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in('release_native_prescription','release_preview_v10_internal','preview_record_release_v10','invalidate_native_record_release','list_record_release_sources_v10','select_all_record_release_sources_v10') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in('preview_record_release_v10','list_record_release_sources_v10','select_all_record_release_sources_v10') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
