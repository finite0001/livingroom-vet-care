-- Version5 freezes selected verified originals and local review provenance.
-- Existing release snapshots and acceptance remain untouched.
alter table public.record_release_policy drop constraint record_release_policy_accepted_schema_version_check;
alter table public.record_release_policy add check(accepted_schema_version in (1,2,3,4,5));
alter table public.record_release_sources drop constraint record_release_sources_source_kind_check;
alter table public.record_release_sources add check(source_kind in ('encounter','certificate','lab','document','dental','qol','anesthesia','lesion','problem','weight','treatment','patient_summary','lab_report','external_record'));

create function public.release_document_has_provenance(p_document_id uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.lab_report_versions where document_id=p_document_id) or exists(select 1 from public.external_record_versions where document_id=p_document_id)
$$;

-- Whitelisted immutable facts only. Caller locks series anchors before using this helper.
create function public.release_source_provenance_internal(p_family text,p_id uuid,p_pet_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v record;r record;c record;source jsonb;acknowledgments jsonb;latest uuid;extra jsonb;head_review public.lab_order_source_reviews;
begin
 if p_family='lab_report' then
  select * into v from public.lab_report_versions where id=p_id and pet_id=p_pet_id;
  if not found then raise exception 'Selected lab report is not available for this patient' using errcode='23514';end if;
  select * into r from public.lab_report_receipts where id=v.receipt_id;
  select * into c from public.lab_report_byte_captures where receipt_id=v.receipt_id;
  select * into head_review from public.lab_order_source_reviews where order_id=v.order_id order by revision desc limit 1;
  if head_review.id is null or row(head_review.source_account_id,head_review.source_patient_reference,head_review.source_order_reference) is distinct from row(r.source_account_id,r.source_patient_reference,r.source_order_reference) then raise exception 'Current lab source identity differs; review the patient mapping before release' using errcode='23514';end if;
  select jsonb_build_object('provider_label',a.provider_label,'account_reference',a.account_reference,'environment_label',a.environment_label,'entry_method',r.entry_method,'source_patient_reference',r.source_patient_reference,'source_order_reference',r.source_order_reference,'source_report_reference',r.source_report_reference) into source from public.lab_source_accounts a where id=r.source_account_id;
  select id into latest from public.lab_report_versions where order_id=v.order_id order by version desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'acknowledged_by',a.actor_id,'acknowledged_at',a.created_at,'capture_hash',a.capture_hash,'document_version',a.document_version) order by a.created_at,a.id),'[]') into acknowledgments from public.lab_report_acknowledgments a where report_id=v.id;
  extra:=jsonb_build_object('order_id',v.order_id,'source_account_id',r.source_account_id,'source_review_id',v.source_review_id,'latest_source_review_id',head_review.id,'previous_version_id',v.previous_report_id);
 elsif p_family='external_record' then
  select * into v from public.external_record_versions where id=p_id and pet_id=p_pet_id;
  if not found then raise exception 'Selected external original is not available for this patient' using errcode='23514';end if;
  select * into r from public.external_record_receipts where id=v.receipt_id;
  select * into c from public.external_record_byte_captures where receipt_id=v.receipt_id;
  source:=jsonb_build_object('provider_label','ezyVet','source_origin',r.source_origin,'source_site_uid',r.source_site_uid,'source_animal_id',r.source_animal_id,'entry_method',r.entry_method,'export_reference',r.export_reference);
  select id into latest from public.external_record_versions where animal_link_id=v.animal_link_id and export_reference=v.export_reference order by version desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'acknowledged_by',a.actor_id,'acknowledged_at',a.created_at,'capture_hash',a.capture_hash,'document_version',a.document_version) order by a.created_at,a.id),'[]') into acknowledgments from public.external_record_acknowledgments a where record_id=v.id;
  extra:=jsonb_build_object('animal_link_id',v.animal_link_id,'previous_version_id',v.previous_record_id);
 else raise exception 'Unsupported release provenance family' using errcode='23514';end if;
 if c.receipt_id is null or row(v.receipt_hash,v.capture_hash,v.document_version) is distinct from row(c.receipt_hash,c.capture_hash,c.document_version)
 or row(r.receipt_hash,r.document_id,r.document_version,r.pet_id,r.mime_type,r.file_size) is distinct from row(v.receipt_hash,v.document_id,v.document_version,p_pet_id,c.mime_type,c.file_size)
 or not exists(select 1 from public.patient_documents d join storage.objects o on o.bucket_id='patient-documents' and o.name=d.file_path and o.metadata->>'size'=d.file_size::text and o.metadata->>'mimetype'=d.mime_type where d.id=v.document_id and d.pet_id=p_pet_id and d.status='ready' and d.visibility='client_shareable' and row(d.version,d.mime_type,d.file_size) is not distinct from row(v.document_version,c.mime_type,c.file_size)) then raise exception 'Exact verified shareable original is unavailable' using errcode='23514';end if;
 return jsonb_build_object('id',v.id,'version',v.version,'kind',v.kind,'latest_version_id',latest,'historical',v.id<>latest,'document_id',v.document_id,'document_version',v.document_version,'receipt_id',v.receipt_id,'receipt_hash',v.receipt_hash,'capture_hash',v.capture_hash,'content_sha256',c.content_sha256,'mime_type',c.mime_type,'file_size',c.file_size,'received_at',r.received_at,'reviewed_by',v.actor_id,'reviewed_at',v.created_at,'acknowledgments',acknowledgments,'source',source)||extra;
end $$;

create function public.release_preview_v5_internal(p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare result jsonb;s jsonb;k text;ids jsonb;selected uuid;anchor uuid;item jsonb;lab_reports jsonb:='[]';external_records jsonb:='[]';attachments jsonb:='[]';attachment jsonb;proofs jsonb;digest text;families text[]:=array['encounter_ids','certificate_ids','lab_order_ids','document_ids','dental_ids','qol_ids','anesthesia_ids','lesion_ids','problem_ids','weight_ids','treatment_ids','patient_summary_ids','lab_report_ids','external_record_ids'];
begin
 perform pg_advisory_xact_lock(hashtextextended(p_pet_id::text,4700));
 if p_selection is null or jsonb_typeof(p_selection)<>'object' or exists(select 1 from jsonb_object_keys(p_selection) f where not(f=any(families))) then raise exception 'Choose explicit release sources' using errcode='23514';end if;
 foreach k in array families loop
  ids:=coalesce(p_selection->k,'[]');
  if jsonb_typeof(ids)<>'array' or jsonb_array_length(ids)>100 then raise exception 'Release source selections must be arrays of at most100 IDs' using errcode='23514';end if;
  if exists(select 1 from jsonb_array_elements(ids) v where jsonb_typeof(v)<>'string') or (select count(*)<>count(distinct v::uuid) from jsonb_array_elements_text(ids) v) then raise exception 'Unique source IDs required' using errcode='23514';end if;
  perform v::uuid from jsonb_array_elements_text(ids) v;
 end loop;
 -- Serialize provenance writers before taking document locks in existing preview cores.
 for anchor in select distinct id from (select order_id id from public.lab_report_versions where id in(select v::uuid from jsonb_array_elements_text(coalesce(p_selection->'lab_report_ids','[]')) v) union all select v::uuid from jsonb_array_elements_text(coalesce(p_selection->'lab_order_ids','[]')) v) orders order by id loop
  perform 1 from public.patient_lab_orders where id=anchor for update;
 end loop;
 for anchor in select distinct animal_link_id from public.external_record_versions where id in(select v::uuid from jsonb_array_elements_text(coalesce(p_selection->'external_record_ids','[]')) v) order by animal_link_id loop
  perform 1 from public.ezyvet_record_links where id=anchor for share;
 end loop;
 result:=public.release_preview_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection-array['lab_report_ids','external_record_ids']);
 for selected in select v::uuid from jsonb_array_elements_text(coalesce(p_selection->'lab_report_ids','[]')) v order by v loop
  item:=public.release_source_provenance_internal('lab_report',selected,p_pet_id);
  if not coalesce(p_selection->'document_ids','[]') @> jsonb_build_array(item->>'document_id') then raise exception 'Select each report original explicitly' using errcode='23514';end if;
  lab_reports:=lab_reports||jsonb_build_array(item);
 end loop;
 for selected in select v::uuid from jsonb_array_elements_text(coalesce(p_selection->'external_record_ids','[]')) v order by v loop
  item:=public.release_source_provenance_internal('external_record',selected,p_pet_id);
  if not coalesce(p_selection->'document_ids','[]') @> jsonb_build_array(item->>'document_id') then raise exception 'Select each external original explicitly' using errcode='23514';end if;
  external_records:=external_records||jsonb_build_array(item);
 end loop;
 -- Approved associations cannot be concealed by selecting just the document.
 if exists(select 1 from public.lab_report_versions v where v.document_id in(select x::uuid from jsonb_array_elements_text(coalesce(p_selection->'document_ids','[]')) x) and not coalesce(p_selection->'lab_report_ids','[]') @> jsonb_build_array(v.id::text))
 or exists(select 1 from public.external_record_versions v where v.document_id in(select x::uuid from jsonb_array_elements_text(coalesce(p_selection->'document_ids','[]')) x) and not coalesce(p_selection->'external_record_ids','[]') @> jsonb_build_array(v.id::text)) then raise exception 'Select and review every approved source associated with the original' using errcode='23514';end if;
 for attachment in select value from jsonb_array_elements(result#>'{snapshot,attachments}') loop
  select jsonb_agg(jsonb_build_object('family',family,'version_id',v->>'id','receipt_id',v->>'receipt_id','receipt_hash',v->>'receipt_hash','capture_hash',v->>'capture_hash') order by family,v->>'id'),min(v->>'content_sha256') into proofs,digest from(
   select 'lab_report' family,value v from jsonb_array_elements(lab_reports) union all select 'external_record',value from jsonb_array_elements(external_records)) x where v->>'document_id'=attachment->>'id';
  if proofs is not null then
   if exists(select 1 from (select value v from jsonb_array_elements(lab_reports) union all select value from jsonb_array_elements(external_records)) x where v->>'document_id'=attachment->>'id' and row(v->>'document_version',v->>'mime_type',v->>'file_size',v->>'content_sha256') is distinct from row(attachment->>'version',attachment->>'mime_type',attachment->>'file_size',digest)) then raise exception 'Selected source captures disagree about the original' using errcode='23514';end if;
   attachment:=attachment||jsonb_build_object('content_sha256',digest,'provenance_captures',proofs);
  end if;
  attachments:=attachments||jsonb_build_array(attachment);
 end loop;
 s:=result->'snapshot';
 foreach k in array array['dental_charts','qol_records','anesthesia_records','lesions','problems','weights','treatments','patient_summaries'] loop
  if not(s ? k) then s:=s||jsonb_build_object(k,'[]'::jsonb);end if;
 end loop;
 s:=s||jsonb_build_object('schema_version',5,'lab_reports',lab_reports,'external_records',external_records,'attachments',attachments);
 if octet_length(s::text)>1048576 then raise exception 'Release exceeds the reviewed snapshot limit; split into smaller packages' using errcode='23514';end if;
 return jsonb_build_object('snapshot',s,'source_hash',encode(sha256(convert_to(s::text,'UTF8')),'hex'));
exception when invalid_text_representation then raise exception 'Source IDs must be valid UUIDs' using errcode='23514';end $$;
create function public.preview_record_release_v5(p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
begin perform public.clinical_require_staff();return public.release_preview_v5_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection);end $$;

-- Preserve existing exact request recovery and old-schema snapshots. Only new
-- confirmations and current eligibility gain the provenance disclosure guard.
do $$declare definition text;old text;begin
 select pg_get_functiondef('public.confirm_record_release(uuid,uuid,uuid,text,text,jsonb,jsonb,text,boolean)'::regprocedure) into definition;
 old:='if (p_reviewed_snapshot->>''schema_version'')::integer=4 then';
 if strpos(definition,old)=0 then raise exception 'Expected release v4 confirmation dispatch missing';end if;
 definition:=replace(definition,old,'if (p_reviewed_snapshot->>''schema_version'')::integer=5 then preview:=public.release_preview_v5_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection); elsif (p_reviewed_snapshot->>''schema_version'')::integer=4 then');
 old:='if preview->''snapshot'' is distinct from p_reviewed_snapshot';
 if strpos(definition,old)=0 then raise exception 'Expected exact release comparison missing';end if;
 definition:=replace(definition,old,'if p_reviewed_snapshot->>''schema_version''<>''5'' and exists(select 1 from jsonb_array_elements_text(coalesce(p_selection->''document_ids'',''[]'')) d where public.release_document_has_provenance(d::uuid)) then raise exception ''Review original provenance with release schema5'' using errcode=''23514'';end if; '||old);
 old:='''treatment_ids'',''patient_summary_ids''] loop';
 if strpos(definition,old)=0 then raise exception 'Expected release source registration missing';end if;
 definition:=replace(definition,old,'''treatment_ids'',''patient_summary_ids'',''lab_report_ids'',''external_record_ids''] loop');
 definition:=replace(definition,'else ''document'' end;','when ''lab_report_ids'' then ''lab_report'' when ''external_record_ids'' then ''external_record'' else ''document'' end;');
 execute definition;
 select pg_get_functiondef('public.release_read_internal(uuid)'::regprocedure) into definition;
 old:='if r.snapshot->>''schema_version''=''1'' then';
 if strpos(definition,old)=0 then raise exception 'Expected legacy release read dispatch missing';end if;
 definition:=replace(definition,old,'if r.snapshot->>''schema_version''=''5'' then current_preview:=public.release_preview_v5_internal(r.pet_id,r.client_id,r.channel,r.recipient,r.selection); elsif r.snapshot->>''schema_version''=''1'' then');
 old:='return jsonb_build_object(''release''';
 if strpos(definition,old)=0 then raise exception 'Expected release read envelope missing';end if;
 definition:=replace(definition,old,'if r.snapshot->>''schema_version''<>''5'' and exists(select 1 from public.record_release_sources s where s.release_id=r.id and s.source_kind=''document'' and public.release_document_has_provenance(s.source_id)) then eligible:=false;why:=''Selected original now requires source provenance review'';end if; '||old);
 execute definition;
end $$;

-- Acknowledgment must acquire the same series anchor BEFORE its document lock.
-- Receipt-first retries remain above these locks and retain their exact behavior.
do $$declare signature text;definition text;expected text;anchor text;begin
 foreach signature in array array['public.acknowledge_lab_report(uuid,uuid,uuid,text,integer,boolean)','public.acknowledge_external_record(uuid,uuid,uuid,text,integer,boolean)'] loop
  select pg_get_functiondef(signature::regprocedure) into definition;
  expected:='perform 1 from public.patient_documents where id=r.document_id';
  if strpos(definition,expected)=0 then raise exception 'Expected acknowledgment document lock missing: %',signature;end if;
  anchor:=case when signature like '%acknowledge_lab_report%' then 'perform 1 from public.patient_lab_orders where id=r.order_id for update; ' else 'perform 1 from public.ezyvet_record_links where id=r.animal_link_id for update; ' end;
  execute replace(definition,expected,anchor||expected);
 end loop;
end $$;
create function public.invalidate_release_source_provenance() returns trigger language plpgsql security definer set search_path=public as $$
declare family text;anchor uuid;version_id uuid;document_id uuid;series text;
begin
 if TG_TABLE_NAME='lab_report_versions' then family:='lab_report';anchor:=NEW.order_id;document_id:=NEW.document_id;
 elsif TG_TABLE_NAME='external_record_versions' then family:='external_record';anchor:=NEW.animal_link_id;series:=NEW.export_reference;document_id:=NEW.document_id;
 elsif TG_TABLE_NAME='lab_order_source_reviews' then family:='lab_report';anchor:=NEW.order_id;
 elsif TG_TABLE_NAME='lab_report_acknowledgments' then family:='lab_report';version_id:=NEW.report_id;
 elsif TG_TABLE_NAME='external_record_acknowledgments' then family:='external_record';version_id:=NEW.record_id;
 end if;
 -- Writer RPCs already hold their order/link and exact-document locks. Do not
 -- introduce reverse document→anchor locking in this append-only event trigger.
 insert into public.record_release_events(id,release_id,kind,reason,created_by)
 select gen_random_uuid(),r.id,'source_changed','Selected original provenance changed; review a fresh package',auth.uid()
 from public.record_releases r where exists(
  select 1 from public.record_release_sources s where s.release_id=r.id and(
   (document_id is not null and s.source_kind='document' and s.source_id=document_id)
   or (r.snapshot->>'schema_version'='5' and s.source_kind=family and(
    s.source_id=version_id
    or(family='lab_report' and exists(select 1 from public.lab_report_versions v where v.id=s.source_id and v.order_id=anchor))
    or(family='external_record' and exists(select 1 from public.external_record_versions v where v.id=s.source_id and v.animal_link_id=anchor and v.export_reference=series))
   ))));
 return NEW;
end $$;
create trigger release_provenance_changed after insert on public.lab_report_versions for each row execute function public.invalidate_release_source_provenance();
create trigger release_provenance_changed after insert on public.external_record_versions for each row execute function public.invalidate_release_source_provenance();
create trigger release_provenance_changed after insert on public.lab_order_source_reviews for each row execute function public.invalidate_release_source_provenance();
create trigger release_provenance_changed after insert on public.lab_report_acknowledgments for each row execute function public.invalidate_release_source_provenance();
create trigger release_provenance_changed after insert on public.external_record_acknowledgments for each row execute function public.invalidate_release_source_provenance();
-- Serialize mixed legacy/v5 previews per patient before any chart/order locks.
-- Writers remain anchor→document; no invalidator upgrades a release-row lock.
do $$declare name text;definition text;begin
 foreach name in array array['preview_record_release_v1','preview_record_release_v2','release_preview_v3_internal','release_preview_internal'] loop
  select pg_get_functiondef(oid) into definition from pg_proc where pronamespace='public'::regnamespace and proname=name;
  if definition is null or strpos(definition,E'begin\n')=0 then raise exception 'Expected release preview entry missing: %',name;end if;
  execute replace(definition,E'begin\n',E'begin\n perform pg_advisory_xact_lock(hashtextextended(p_pet_id::text,4700));\n');
 end loop;
end $$;

create function public.release_provenance_candidates_internal(p_pet_id uuid,p_family text,p_offset integer,p_limit integer) returns setof jsonb language plpgsql stable security definer set search_path=public as $$
declare selected record;item jsonb;label text;
begin
 if p_family not in ('lab_report','external_record') then raise exception 'Invalid release provenance family' using errcode='23514';end if;
 for selected in
  select v.id,v.version,v.created_at from(
   select id,version,created_at,document_id,document_version,receipt_id from public.lab_report_versions where p_family='lab_report' and pet_id=p_pet_id
   union all select id,version,created_at,document_id,document_version,receipt_id from public.external_record_versions where p_family='external_record' and pet_id=p_pet_id) v
  join public.patient_documents d on d.id=v.document_id and d.pet_id=p_pet_id and d.status='ready' and d.visibility='client_shareable' and d.version=v.document_version
  join(select receipt_id,document_version,mime_type,file_size from public.lab_report_byte_captures where p_family='lab_report' union all select receipt_id,document_version,mime_type,file_size from public.external_record_byte_captures where p_family='external_record') c on c.receipt_id=v.receipt_id and c.document_version=d.version and c.mime_type=d.mime_type and c.file_size=d.file_size
  where (p_family='external_record' or exists(select 1 from public.lab_report_versions lv join public.lab_report_receipts lr on lr.id=lv.receipt_id join lateral(select * from public.lab_order_source_reviews where order_id=lv.order_id order by revision desc limit 1) head on true where lv.id=v.id and row(head.source_account_id,head.source_patient_reference,head.source_order_reference) is not distinct from row(lr.source_account_id,lr.source_patient_reference,lr.source_order_reference)))
  and exists(select 1 from storage.objects o where o.bucket_id='patient-documents' and o.name=d.file_path and o.metadata->>'size'=d.file_size::text and o.metadata->>'mimetype'=d.mime_type)
  order by v.created_at desc,v.id limit p_limit offset p_offset
 loop
  item:=public.release_source_provenance_internal(p_family,selected.id,p_pet_id);
  label:=case when p_family='lab_report' then item#>>'{source,provider_label}'||' · '||(item#>>'{source,source_report_reference}') else 'ezyVet · '||(item#>>'{source,export_reference}') end;
  return next jsonb_build_object('id',selected.id,'version',selected.version,'recorded_at',selected.created_at,'label',label,'required_document_id',item->'document_id','required_document_version',item->'document_version','mime_type',item->'mime_type','file_size',item->'file_size','kind',item->'kind','historical',item->'historical','source_label',case when p_family='lab_report' then item#>>'{source,provider_label}'||' · '||(item#>>'{source,account_reference}')||' · '||(item#>>'{source,environment_label}') else 'ezyVet · '||(item#>>'{source,source_origin}')||' · '||(item#>>'{source,source_site_uid}') end,'acknowledgment_count',jsonb_array_length(item->'acknowledgments'));
 end loop;
end $$;
create function public.list_record_release_sources_v5(p_pet_id uuid,p_offset integer default 0) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;next_page jsonb;more jsonb:='{}';rows jsonb;k text;documents jsonb:='[]';document jsonb;
begin
 perform public.clinical_require_staff();
 if p_offset is null or p_offset<0 or p_offset>100000 then raise exception 'Invalid release page offset' using errcode='23514';end if;
 result:=public.list_record_release_sources(p_pet_id,p_offset);next_page:=public.list_record_release_sources(p_pet_id,p_offset+100);
 foreach k in array array['encounter_ids','certificate_ids','lab_order_ids','document_ids','dental_ids','qol_ids','anesthesia_ids','lesion_ids','problem_ids','weight_ids','treatment_ids','patient_summary_ids'] loop
  more:=more||jsonb_build_object(k,jsonb_array_length(next_page->k)>0);
 end loop;
 foreach k in array array['lab_report','external_record'] loop
  select coalesce(jsonb_agg(v),'[]') into rows from public.release_provenance_candidates_internal(p_pet_id,k,p_offset,101) v;
  more:=more||jsonb_build_object(k||'_ids',jsonb_array_length(rows)>100);
  result:=result||jsonb_build_object(k||'_ids',(select coalesce(jsonb_agg(value order by ordinality),'[]') from jsonb_array_elements(rows) with ordinality where ordinality<=100));
 end loop;
 for document in select value from jsonb_array_elements(result->'document_ids') loop
  document:=document||jsonb_build_object('required_lab_report_ids',(select coalesce(jsonb_agg(id order by id),'[]') from public.lab_report_versions where document_id=(document->>'id')::uuid),'required_external_record_ids',(select coalesce(jsonb_agg(id order by id),'[]') from public.external_record_versions where document_id=(document->>'id')::uuid));
  documents:=documents||jsonb_build_array(document);
 end loop;
 return result||jsonb_build_object('document_ids',documents,'has_more',more,'policy_v5_accepted',exists(select 1 from public.record_release_policy where id and enabled and accepted_at<=now() and accepted_schema_version>=5));
end $$;
create function public.select_all_record_release_sources_v5(p_pet_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;selection jsonb;k text;rows jsonb;docs jsonb;old_docs jsonb;labs jsonb;
begin
 perform public.clinical_require_staff();result:=public.select_all_record_release_sources(p_pet_id);selection:=result->'selection';
 foreach k in array array['encounter_ids','certificate_ids','lab_order_ids','document_ids','dental_ids','qol_ids','anesthesia_ids','lesion_ids','problem_ids','weight_ids','treatment_ids','patient_summary_ids','lab_report_ids','external_record_ids'] loop
  selection:=selection||jsonb_build_object(k,coalesce(selection->k,'[]'::jsonb));
 end loop;
 foreach k in array array['lab_report','external_record'] loop
  select coalesce(jsonb_agg(v),'[]') into rows from public.release_provenance_candidates_internal(p_pet_id,k,0,101) v;
  if jsonb_array_length(rows)>100 then raise exception 'More than100 provenance versions; split into explicitly reviewed packages' using errcode='23514';end if;
  selection:=selection||jsonb_build_object(k||'_ids',(select coalesce(jsonb_agg(value->'id' order by value->>'id'),'[]') from jsonb_array_elements(rows)));
 end loop;
 -- Do not silently classify a stale captured original as an ordinary document.
 old_docs:=coalesce(selection->'document_ids','[]');
 select coalesce(jsonb_agg(value order by value),'[]') into docs from jsonb_array_elements(old_docs) d(value)
 where not exists(select 1 from public.lab_report_versions v where v.document_id=(d.value#>>'{}')::uuid and not coalesce(selection->'lab_report_ids','[]') @> jsonb_build_array(v.id::text))
 and not exists(select 1 from public.external_record_versions v where v.document_id=(d.value#>>'{}')::uuid and not coalesce(selection->'external_record_ids','[]') @> jsonb_build_array(v.id::text));
 foreach k in array array['lab_report','external_record'] loop
  if k='lab_report' then select coalesce(jsonb_agg(v.id order by v.id),'[]') into rows from public.lab_report_versions v where coalesce(selection->'lab_report_ids','[]') @> jsonb_build_array(v.id::text) and docs @> jsonb_build_array(v.document_id::text);
  else select coalesce(jsonb_agg(v.id order by v.id),'[]') into rows from public.external_record_versions v where coalesce(selection->'external_record_ids','[]') @> jsonb_build_array(v.id::text) and docs @> jsonb_build_array(v.document_id::text);end if;
  selection:=selection||jsonb_build_object(k||'_ids',rows);
 end loop;
 select coalesce(jsonb_agg(v.id order by v.id),'[]') into labs from public.patient_lab_orders v where coalesce(selection->'lab_order_ids','[]') @> jsonb_build_array(v.id::text) and docs @> jsonb_build_array(v.result_document_id::text);
 return result||jsonb_build_object('selection',selection||jsonb_build_object('document_ids',docs,'lab_order_ids',labs),'excluded_unavailable_originals',(result->>'excluded_unavailable_originals')::integer+jsonb_array_length(old_docs)-jsonb_array_length(docs),'excluded_labs_without_shareable_original',(result->>'excluded_labs_without_shareable_original')::integer+jsonb_array_length(coalesce(selection->'lab_order_ids','[]'))-jsonb_array_length(labs),'scope','All currently eligible native records, verified selected-source versions and exact shareable originals within100 per family. Selection is fixed now; review the exact schema5 snapshot before confirming.');
end $$;
do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in ('release_document_has_provenance','release_source_provenance_internal','release_preview_v5_internal','preview_record_release_v5','invalidate_release_source_provenance','release_provenance_candidates_internal','list_record_release_sources_v5','select_all_record_release_sources_v5') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in ('preview_record_release_v5','list_record_release_sources_v5','select_all_record_release_sources_v5') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
