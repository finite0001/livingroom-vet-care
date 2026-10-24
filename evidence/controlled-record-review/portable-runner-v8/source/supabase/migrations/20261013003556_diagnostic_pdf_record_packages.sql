-- 3A2b: numbered diagnostic disclosure. No clinical acceptance or provider activation.
create or replace function public.record_request_families() returns text[] language sql immutable set search_path=public as $$
 select array['problem_ids','patient_summary_ids','weight_ids','treatment_ids','encounter_ids','certificate_ids','lab_order_ids','lab_report_ids','native_prescription_ids','native_dispense_ids','imported_prescription_ids','imported_vaccination_ids','imported_history_ids','external_record_ids','api_attachment_ids','document_ids','dental_ids','qol_ids','anesthesia_ids','lesion_ids','diagnostic_pdf_ids','diagnostic_pdf_historical_ids']::text[]
$$;
-- Freeze inherited discovery mappings; new families must never fall through to lesions.
do $$declare d text;needle text:='foreach k in array public.record_request_families() loop';begin
 select pg_get_functiondef('public.record_request_inventory_before_diagnostics(uuid)'::regprocedure) into d;
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>2 then raise exception 'Expected both inherited inventory loops';end if;
 execute replace(d,needle,needle||' if k in (''diagnostic_pdf_ids'',''diagnostic_pdf_historical_ids'') then continue;end if;');
end $$;

create function public.diagnostic_pdf_release_record(p_job uuid,p_pet uuid,p_mode text) returns jsonb language plpgsql security definer set search_path=public as $$
declare b jsonb;heads jsonb;begin
 b:=public.diagnostic_pdf_release_binding(p_job,p_pet,p_mode);
 -- Correction context is separate from immutable artifact identity. Every embedded root
 -- is already SHARE locked. A later correction requires fresh disclosure review in either mode.
 select jsonb_agg(jsonb_build_object('panel_id',p.id,'head_id',p.current_finalized_id,'version',p.version) order by p.id) into heads
 from public.diagnostic_panels p where p.id in(select (x->>'panel_id')::uuid from jsonb_array_elements(b->'embedded_versions') x);
 return jsonb_build_object('binding',b,'binding_hash',public.native_fulfillment_hash(b),'review_context',heads);
end $$;
create function public.diagnostic_pdf_release_document(p_record jsonb) returns jsonb language plpgsql immutable set search_path=public as $$
declare b jsonb:=p_record->'binding';begin
 if b->>'bucket' is distinct from 'diagnostic-pdfs' or p_record->>'binding_hash' is distinct from public.native_fulfillment_hash(b)
  or b->>'mode' not in('current','historical') or (b->>'byte_length')::integer not between 1 and 3145728 then
  raise exception 'Exact diagnostic package binding required' using errcode='23514';end if;
 return jsonb_build_object('id',b->'job_id','version',b->'version','file_name','diagnostic-'||(b->>'job_id')||'.pdf',
  'file_path',b->'object_path','bucket','diagnostic-pdfs','mime_type','application/pdf','file_size',b->'byte_length','content_sha256',b->'sha256',
  'document_date',((b->>'reviewed_at')::timestamptz at time zone 'America/Denver')::date,'category','diagnostic_pdf',
  'diagnostic_pdf_ref',jsonb_build_object('job_id',b->'job_id','mode',b->'mode','binding_hash',p_record->'binding_hash'));
end $$;

create function public.release_preview_v14_internal(p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare k text;ids jsonb;selection jsonb:='{}';older jsonb;old_count integer:=0;total integer:=0;aid uuid;root uuid;job uuid;r jsonb;s jsonb;item jsonb;pdfs jsonb:='[]';docs jsonb;mode text;
begin
 if auth.role() is distinct from 'service_role' then perform public.clinical_require_staff();end if;
 if p_selection is null or jsonb_typeof(p_selection) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_selection) f where f<>all(public.record_request_families())) then raise exception 'Known explicit release sources required' using errcode='23514';end if;
 foreach k in array array['diagnostic_pdf_ids','diagnostic_pdf_historical_ids'] loop
  ids:=coalesce(p_selection->k,'[]');
  if jsonb_typeof(ids) is distinct from 'array' or jsonb_array_length(ids)>24 or exists(select 1 from jsonb_array_elements(ids) x where jsonb_typeof(x)<>'string') or (select count(*)<>count(distinct x::uuid) from jsonb_array_elements_text(ids) x) then raise exception 'Select at most24 distinct diagnostic UUIDs per family' using errcode='23514';end if;
  select coalesce(jsonb_agg(x::uuid order by x::uuid),'[]') into ids from jsonb_array_elements_text(ids) x;
  selection:=selection||jsonb_build_object(k,ids);total:=total+jsonb_array_length(ids);
 end loop;
 if exists(select 1 from jsonb_array_elements_text(selection->'diagnostic_pdf_ids') a join jsonb_array_elements_text(selection->'diagnostic_pdf_historical_ids') b on a.value=b.value) then raise exception 'A diagnostic PDF cannot be selected in both modes' using errcode='23514';end if;
 older:=p_selection-array['diagnostic_pdf_ids','diagnostic_pdf_historical_ids'];
 if total=0 then return public.release_preview_v13_internal(p_pet_id,p_client_id,p_channel,p_recipient,older);end if;
 if total+jsonb_array_length(coalesce(older->'document_ids','[]'))+jsonb_array_length(coalesce(older->'api_attachment_ids','[]'))>24 then raise exception 'Distinct originals within24-file limit required' using errcode='23514';end if;
 -- Match inherited native and per-patient serialization before diagnostic/source locks.
 for aid in select x::uuid from jsonb_array_elements_text(coalesce(older->'native_prescription_ids','[]')) x union select d.authorization_id from public.native_dispenses d where d.id in(select x::uuid from jsonb_array_elements_text(coalesce(older->'native_dispense_ids','[]')) x) order by 1 loop
  perform pg_advisory_xact_lock(hashtextextended('native-prescription-authorization:'||aid::text,0));
 end loop;
 perform pg_advisory_xact_lock(hashtextextended(p_pet_id::text,4700));
 -- Imported source writers lock mapping before patient; acquire their common parents first.
 perform 1 from public.ezyvet_record_links where pet_id=p_pet_id order by id for share;
 perform 1 from public.pets where id=p_pet_id and client_id=p_client_id for share;if not found then raise exception 'Patient household differs' using errcode='42501';end if;
 -- Discover immutable manifests, then lock the union (not one report at a time).
 for root in select distinct (x->>'panel_id')::uuid from public.diagnostic_pdf_manifests m cross join lateral jsonb_array_elements(m.source->'panels') x where m.job_id in(select x::uuid from jsonb_array_elements_text(selection->'diagnostic_pdf_ids') x union select x::uuid from jsonb_array_elements_text(selection->'diagnostic_pdf_historical_ids') x) order by 1 loop
  perform 1 from public.diagnostic_panels where id=root and pet_id=p_pet_id for share;if not found then raise exception 'Embedded diagnostic root unavailable' using errcode='23514';end if;
 end loop;
 for k in select jsonb_object_keys(older) loop if jsonb_typeof(older->k) is distinct from 'array' then raise exception 'Source selections must be arrays' using errcode='23514';end if;old_count:=old_count+jsonb_array_length(older->k);end loop;
 if old_count=0 then
  r:=public.preview_record_release_v1(p_pet_id,p_client_id,p_channel,p_recipient,'{}');s:=r->'snapshot';
  foreach k in array array['dental_charts','qol_records','anesthesia_records','lesions','problems','weights','treatments','patient_summaries','lab_reports','external_records','imported_histories','problem_source_extractions','imported_vaccinations','imported_prescriptions','api_attachments','native_prescriptions','native_dispenses'] loop s:=s||jsonb_build_object(k,'[]'::jsonb);end loop;
  foreach k in array public.record_request_families() loop if k not in('diagnostic_pdf_ids','diagnostic_pdf_historical_ids') then selection:=selection||jsonb_build_object(k,'[]'::jsonb);end if;end loop;
 else r:=public.release_preview_v13_internal(p_pet_id,p_client_id,p_channel,p_recipient,older);s:=r->'snapshot';selection:=coalesce(s->'selection','{}')||selection;end if;
 docs:=s->'attachments';
 foreach k in array array['diagnostic_pdf_ids','diagnostic_pdf_historical_ids'] loop
  mode:=case k when 'diagnostic_pdf_ids' then 'current' else 'historical' end;
  for job in select x::uuid from jsonb_array_elements_text(selection->k) x order by 1 loop
   item:=public.diagnostic_pdf_release_record(job,p_pet_id,mode);pdfs:=pdfs||jsonb_build_array(item);docs:=docs||jsonb_build_array(public.diagnostic_pdf_release_document(item));
  end loop;
 end loop;
 if (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(docs) x) then raise exception 'Distinct selected originals required' using errcode='23514';end if;
 s:=s||jsonb_build_object('schema_version',14,'selection',selection,'diagnostic_pdfs',pdfs,'attachments',docs);
 if octet_length(s::text)>1048576 then raise exception 'Release exceeds maximum reviewed snapshot size' using errcode='23514';end if;
 if auth.role() is distinct from 'service_role' then perform public.clinical_require_staff();end if;
 return jsonb_build_object('snapshot',s,'source_hash',public.native_fulfillment_hash(s));
exception when invalid_text_representation then raise exception 'Source IDs must be valid UUIDs' using errcode='23514';end $$;

create or replace function public.record_request_inventory(p_pet_id uuid) returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare r jsonb;v public.diagnostic_panel_versions;p public.diagnostic_panels;b jsonb;family text;mode text;count_rows integer:=0;nodes jsonb;excluded jsonb;
begin
 perform public.clinical_require_staff();
 if (select count(*) from public.diagnostic_panels where pet_id=p_pet_id)>10000 or (select count(*) from public.diagnostic_panel_versions where pet_id=p_pet_id)>10000 then raise exception 'Diagnostic census exceeds complete-capture capacity' using errcode='23514';end if;
 r:=public.record_request_inventory_before_diagnostics(p_pet_id);nodes:=r->'nodes';excluded:=r->'exclusions';
 -- Root union precedes artifact locks; inventory includes precise unavailable/current exclusions.
 perform 1 from public.diagnostic_panels where pet_id=p_pet_id order by id for share;
 for v in select * from public.diagnostic_panel_versions where pet_id=p_pet_id order by panel_id,number loop
  count_rows:=count_rows+1;if count_rows>10000 then raise exception 'Diagnostic census exceeds complete-capture capacity' using errcode='23514';end if;
  select * into strict p from public.diagnostic_panels where id=v.panel_id;
  mode:=case when p.current_finalized_id=v.id then 'current' else 'historical' end;
  family:=case mode when 'current' then 'diagnostic_pdf_ids' else 'diagnostic_pdf_historical_ids' end;
  begin
   b:=public.diagnostic_pdf_release_record(v.id,p_pet_id,mode);
   nodes:=nodes||jsonb_build_object(family||':'||v.id,jsonb_build_object('family',family,'id',v.id,'version',v.number,'label',v.snapshot->>'panel_name','recorded_at',v.reviewed_at,'diagnostic_category',v.snapshot->>'category','requires','[]'::jsonb,'diagnostic_pdf',b,'scope_expansion',jsonb_array_length(b#>'{binding,embedded_versions}')>1));
  exception when sqlstate 'PT409' or sqlstate '42501' then
   excluded:=excluded||jsonb_build_array(jsonb_build_object('family',family,'id',v.id,'label',v.snapshot->>'panel_name','reason',case mode when 'current' then 'Current reviewed PDF is unregistered, unavailable or replaced; historical PDFs are never substituted' else 'Historical PDF is unregistered, unavailable or replaced' end));
  end;
 end loop;
 for p in select * from public.diagnostic_panels where pet_id=p_pet_id and current_finalized_id is null order by id loop
  excluded:=excluded||jsonb_build_array(jsonb_build_object('family','diagnostic_pdf_ids','id',p.id,'label',p.draft->>'panel_name','reason','Diagnostic panel is not finalized; no current reviewed PDF exists'));
 end loop;
 if (select count(*) from jsonb_each(nodes))>10000 then raise exception 'Chart exceeds complete-capture capacity; no partial manifest was created' using errcode='23514';end if;
 perform public.clinical_require_staff();return r||jsonb_build_object('nodes',nodes,'exclusions',excluded);
end $$;

alter table public.record_release_policy drop constraint record_release_policy_accepted_schema_version_check;
alter table public.record_release_policy add constraint record_release_policy_accepted_schema_version_check check(accepted_schema_version between 1 and 14);
alter table public.record_release_sources drop constraint record_release_sources_source_kind_check;
alter table public.record_release_sources add constraint record_release_sources_source_kind_check check(source_kind in('encounter','certificate','lab','document','dental','qol','anesthesia','lesion','problem','weight','treatment','patient_summary','lab_report','external_record','imported_history','imported_vaccination','imported_prescription','api_attachment','native_prescription','native_dispense','diagnostic_pdf'));

-- Patch the effective renamed cores, leaving recipient-current outer wrappers intact.
do $$declare d text;needle text;f text;begin
 select pg_get_functiondef('public.confirm_record_release_without_record_request(uuid,uuid,uuid,text,text,jsonb,jsonb,text,boolean)'::regprocedure) into d;
 needle:='if (p_reviewed_snapshot->>''schema_version'')::integer=13 then';if position(needle in d)=0 then raise exception 'Expected schema13 confirmation core';end if;
 d:=replace(d,needle,'if (p_reviewed_snapshot->>''schema_version'')::integer=14 then preview:=public.release_preview_v14_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection); els'||needle);
 needle:='''native_prescription_ids'',''native_dispense_ids''] loop';if position(needle in d)=0 then raise exception 'Expected source registry loop';end if;
 d:=replace(d,needle,'''native_prescription_ids'',''native_dispense_ids'',''diagnostic_pdf_ids'',''diagnostic_pdf_historical_ids''] loop');
 d:=replace(d,'else ''document'' end;','when ''diagnostic_pdf_ids'' then ''diagnostic_pdf'' when ''diagnostic_pdf_historical_ids'' then ''diagnostic_pdf'' else ''document'' end;');
 d:=replace(d,'''11'',''12'',''13'')','''11'',''12'',''13'',''14'')');execute d;
 select pg_get_functiondef('public.release_read_internal_without_record_request(uuid)'::regprocedure) into d;
 needle:='if r.snapshot->>''schema_version''=''13'' then';if position(needle in d)=0 then raise exception 'Expected schema13 read core';end if;
 d:=replace(d,needle,'if r.snapshot->>''schema_version''=''14'' then current_preview:=public.release_preview_v14_internal(r.pet_id,r.client_id,r.channel,r.recipient,r.selection); els'||needle);
 d:=replace(d,'''11'',''12'',''13'')','''11'',''12'',''13'',''14'')');execute d;
 select pg_get_functiondef('public.confirm_record_release(uuid,uuid,uuid,text,text,jsonb,jsonb,text,boolean)'::regprocedure) into d;
 needle:='select * into p from public.record_request_packages where release_id=p_id;';if position(needle in d)=0 then raise exception 'Expected numbered confirmation wrapper';end if;
 execute replace(d,needle,'if p_reviewed_snapshot->>''schema_version''=''14'' then raise exception ''Diagnostic PDFs require numbered records-request confirmation'' using errcode=''42501'';end if; '||needle);
 foreach f in array array['invalidate_release_source_provenance','release_weight_provenance_changed','release_weight_source_head_changed','invalidate_native_record_release','invalidate_native_correction_release'] loop
  select pg_get_functiondef(oid) into d from pg_proc where pronamespace='public'::regnamespace and proname=f;
  needle:='''10'',''11'',''12'',''13'')';if d is null or position(needle in d)=0 then raise exception 'Expected schema13 invalidator %',f;end if;
  execute replace(d,needle,'''10'',''11'',''12'',''13'',''14'')');
 end loop;
 select pg_get_functiondef('public.record_request_bounded_preview(public.record_requests,jsonb)'::regprocedure) into d;
 d:=replace(d,'''document_ids'',''[]''))+jsonb_array_length(coalesce(selection->''api_attachment_ids'',''[]''))>24','''document_ids'',''[]''))+jsonb_array_length(coalesce(selection->''api_attachment_ids'',''[]''))+jsonb_array_length(coalesce(selection->''diagnostic_pdf_ids'',''[]''))+jsonb_array_length(coalesce(selection->''diagnostic_pdf_historical_ids'',''[]''))>24');
 needle:='preview:=public.preview_record_release_v13(p_request.pet_id,p_request.client_id,p_request.channel,p_request.recipient,selection);';if position(needle in d)=0 then raise exception 'Expected numbered preview';end if;
 d:=replace(d,needle,'preview:=public.release_preview_v14_internal(p_request.pet_id,p_request.client_id,p_request.channel,p_request.recipient,selection);');execute d;
 select pg_get_functiondef('public.prepare_record_request_manifest(uuid,uuid,integer,jsonb)'::regprocedure) into d;
 needle:='if r.subset=''full'' or (r.subset=''labs'' and source.value->>''family'' in (''lab_order_ids'',''lab_report_ids''))';if position(needle in d)=0 then raise exception 'Expected preset scope';end if;
 d:=replace(d,needle,'if (r.subset=''full'' and source.value->>''family''<>''diagnostic_pdf_historical_ids'') or (r.subset=''labs'' and source.value->>''family'' in (''lab_order_ids'',''lab_report_ids'')) or (r.subset=''labs'' and source.value->>''family''=''diagnostic_pdf_ids'' and source.value->>''diagnostic_category''=''laboratory'')');
 needle:='scoped_expansion:=r.subset=''labs'' and exists';if (length(d)-length(replace(d,needle,'')))/length(needle)<>2 then raise exception 'Expected both package scope checks';end if;
 d:=replace(d,needle,'scoped_expansion:=exists(select 1 from jsonb_each(current_nodes) n where n.value->>''scope_expansion''=''true'') or r.subset=''labs'' and exists');execute d;
end $$;

-- New corrections append invalidation evidence without request locks or release lock upgrades.
create function public.invalidate_diagnostic_pdf_release() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.record_release_events(id,release_id,kind,reason,created_by)
 select gen_random_uuid(),r.id,'source_changed','Included diagnostic history was corrected; review a fresh numbered package',auth.uid()
 from public.record_releases r where r.snapshot->>'schema_version'='14' and exists(
  select 1 from jsonb_array_elements(r.snapshot->'diagnostic_pdfs') d cross join lateral jsonb_array_elements(d#>'{binding,embedded_versions}') v where v->>'panel_id'=NEW.panel_id::text and v->>'id'<>NEW.id::text);
 return NEW;
end $$;
create trigger diagnostic_release_correction after insert on public.diagnostic_panel_versions for each row execute function public.invalidate_diagnostic_pdf_release();

alter function public.verify_release_source_original_v5(jsonb,jsonb,bytea) rename to verify_release_source_original_before_diagnostics;
create function public.verify_release_source_original_v5(p_snapshot jsonb,p_document jsonb,p_bytes bytea) returns void language plpgsql security definer set search_path=public as $$
declare item jsonb;expected jsonb;seen uuid[]:='{}';mode text;selected jsonb;actual jsonb;local_snapshot jsonb;
begin
 if p_snapshot->>'schema_version' is distinct from '14' then
  if p_document ? 'diagnostic_pdf_ref' or p_document->>'bucket'='diagnostic-pdfs' then raise exception 'Diagnostic attachment requires schema14' using errcode='23514';end if;
  perform public.verify_release_source_original_before_diagnostics(p_snapshot,p_document,p_bytes);return;
 end if;
 if jsonb_typeof(p_snapshot->'diagnostic_pdfs') is distinct from 'array' or jsonb_typeof(p_snapshot->'attachments') is distinct from 'array'
  or jsonb_typeof(p_snapshot#>'{selection,diagnostic_pdf_ids}') is distinct from 'array' or jsonb_typeof(p_snapshot#>'{selection,diagnostic_pdf_historical_ids}') is distinct from 'array'
  or jsonb_array_length(p_snapshot->'attachments')>24 or (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(p_snapshot->'attachments') x)
 then raise exception 'Exact diagnostic package selection required' using errcode='23514';end if;
 for item in select value from jsonb_array_elements(p_snapshot->'diagnostic_pdfs') loop
  if (item#>>'{binding,job_id}')::uuid=any(seen) or item#>>'{binding,pet_id}' is distinct from p_snapshot#>>'{patient,id}' then raise exception 'Distinct patient diagnostic sources required' using errcode='23514';end if;
  seen:=array_append(seen,(item#>>'{binding,job_id}')::uuid);
  if item is distinct from public.diagnostic_pdf_release_record((item#>>'{binding,job_id}')::uuid,(p_snapshot#>>'{patient,id}')::uuid,item#>>'{binding,mode}') then raise exception 'Diagnostic disclosure review context changed' using errcode='PT409';end if;
  expected:=public.diagnostic_pdf_release_document(item);
  if (select count(*) from jsonb_array_elements(p_snapshot->'attachments') where value=expected)<>1 then raise exception 'Exact diagnostic original missing' using errcode='23514';end if;
 end loop;
 foreach mode in array array['current','historical'] loop
  select coalesce(jsonb_agg(x::uuid order by x::uuid),'[]') into selected from jsonb_array_elements_text(p_snapshot#>array['selection',case mode when 'current' then 'diagnostic_pdf_ids' else 'diagnostic_pdf_historical_ids' end]) x;
  select coalesce(jsonb_agg((x#>>'{binding,job_id}')::uuid order by (x#>>'{binding,job_id}')::uuid),'[]') into actual from jsonb_array_elements(p_snapshot->'diagnostic_pdfs') x where x#>>'{binding,mode}'=mode;
  if actual is distinct from selected then raise exception 'Diagnostic modes differ from reviewed selection' using errcode='23514';end if;
 end loop;
 if (select count(*) from jsonb_array_elements(p_snapshot->'attachments') where value=p_document)<>1 then raise exception 'Exact selected original required' using errcode='23514';end if;
 if p_document->>'bucket'='diagnostic-pdfs' then
  select value into item from jsonb_array_elements(p_snapshot->'diagnostic_pdfs') where value#>>'{binding,job_id}'=p_document->>'id';
  if item is null or p_document is distinct from public.diagnostic_pdf_release_document(item) then raise exception 'Exact selected diagnostic reference required' using errcode='23514';end if;
  perform public.verify_diagnostic_pdf_release_bytes(item->'binding',p_bytes);
 else
  if p_document ? 'diagnostic_pdf_ref' or p_document->>'id'=any(select unnest(seen)::text) then raise exception 'Diagnostic original cannot be downgraded' using errcode='23514';end if;
  local_snapshot:=jsonb_set(p_snapshot,'{schema_version}','13');
  select coalesce(jsonb_agg(x),'[]') into actual from jsonb_array_elements(p_snapshot->'attachments') x where x->>'bucket'<>'diagnostic-pdfs';
  local_snapshot:=jsonb_set(local_snapshot,'{attachments}',actual);
  perform public.verify_release_source_original_before_diagnostics(local_snapshot,p_document,p_bytes);
 end if;
end $$;
do $$declare f record;begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in('diagnostic_pdf_release_record','diagnostic_pdf_release_document','release_preview_v14_internal','invalidate_diagnostic_pdf_release','verify_release_source_original_before_diagnostics','verify_release_source_original_v5') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
end $$;
