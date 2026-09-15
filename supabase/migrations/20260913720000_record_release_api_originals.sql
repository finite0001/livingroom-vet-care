-- Explicit, acknowledged API originals are a distinct schema9 release source.
alter table public.record_release_policy drop constraint record_release_policy_accepted_schema_version_check;
alter table public.record_release_policy add check(accepted_schema_version in(1,2,3,4,5,6,7,8,9));
alter table public.record_release_sources drop constraint record_release_sources_source_kind_check;
alter table public.record_release_sources add check(source_kind in('encounter','certificate','lab','document','dental','qol','anesthesia','lesion','problem','weight','treatment','patient_summary','lab_report','external_record','imported_history','imported_vaccination','imported_prescription','api_original'));
-- Exact replay and scoped abandonment must remain ahead of mutable release gates.
do $$declare name text;d text;needle text;begin
 foreach name in array array['ezyvet_attachment_original_approve_core','ezyvet_attachment_original_record_action_core'] loop
  select pg_get_functiondef(oid) into d from pg_proc where pronamespace='public'::regnamespace and proname=name;
  needle:=case when name='ezyvet_attachment_original_approve_core' then ' select * into m from public.ezyvet_record_links where id=r.animal_link_id for share;' else ' perform public.ezyvet_attachment_review_series_lock(v.source_origin,v.source_site_uid,v.source_animal_id,v.source_attachment_id);' end;
  if d is null or strpos(d,needle)=0 then raise exception 'Expected original review mutable lock missing: %',name;end if;
  execute replace(d,needle,' perform pg_advisory_xact_lock(hashtextextended(p_pet_id::text,4700));'||needle);
 end loop;
end $$;

-- This predicate intentionally ignores provider heads: admission already disclosed
-- historical evidence. It checks membership, immutable bytes, and the admitted head.
create function public.release_api_original_eligible(p_id uuid,p_pet_id uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.ezyvet_attachment_review_records v
 join public.ezyvet_attachment_original_captures c on c.id=v.capture_id and c.request_id=v.capture_request_id and c.capture_hash=v.capture_hash and c.content_sha256=v.content_sha256 and c.mime_type=v.mime_type and c.file_size=v.file_size
 join public.ezyvet_attachment_capture_requests r on r.id=c.request_id and r.status='ready' and r.pet_id=v.pet_id and r.client_id=v.client_id
 join public.ezyvet_attachment_original_intents i on i.id=c.intent_id and i.request_id=r.id and i.content_sha256=c.content_sha256 and i.mime_type=c.mime_type and i.file_size=c.file_size
 join storage.objects o on o.id=c.storage_object_id and o.bucket_id=i.bucket_id and o.name=i.object_path and o.metadata->>'size'=c.file_size::text and o.metadata->>'mimetype'=c.mime_type
 where v.id=p_id and v.pet_id=p_pet_id and public.ezyvet_attachment_review_mapping_current(r.id)
 and (public.ezyvet_attachment_review_latest(v.source_origin,v.source_site_uid,v.source_animal_id,v.source_attachment_id)).id=v.id
 and not exists(select 1 from public.ezyvet_attachment_review_withdrawals w where w.record_id=v.id)
 and exists(select 1 from public.ezyvet_attachment_review_acknowledgments a where a.record_id=v.id and a.pet_id=v.pet_id and a.record_hash=v.record_hash and a.capture_hash=v.capture_hash))
$$;
create function public.release_api_original_entry(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('record',to_jsonb(v),'acknowledgment',(select to_jsonb(a) from public.ezyvet_attachment_review_acknowledgments a where a.record_id=v.id and a.pet_id=v.pet_id and a.record_hash=v.record_hash and a.capture_hash=v.capture_hash order by a.created_at,a.id limit 1)) from public.ezyvet_attachment_review_records v where v.id=p_id
$$;
create function public.release_preview_v9_internal(p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare result jsonb;s jsonb;ids jsonb;older jsonb;k text;n integer:=0;v public.ezyvet_attachment_review_records;entry jsonb;originals jsonb:='[]';locked record;begin
 perform pg_advisory_xact_lock(hashtextextended(p_pet_id::text,4700));
 if p_selection is null or jsonb_typeof(p_selection) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_selection) f where f not in('encounter_ids','certificate_ids','lab_order_ids','document_ids','dental_ids','qol_ids','anesthesia_ids','lesion_ids','problem_ids','weight_ids','treatment_ids','patient_summary_ids','lab_report_ids','external_record_ids','imported_history_ids','imported_vaccination_ids','imported_prescription_ids','api_original_ids')) then raise exception 'Choose explicit release sources' using errcode='23514';end if;
 ids:=coalesce(p_selection->'api_original_ids','[]');
 if jsonb_typeof(ids) is distinct from 'array' or jsonb_array_length(ids)>20 or exists(select 1 from jsonb_array_elements(ids) x where jsonb_typeof(x) is distinct from 'string') or(select count(*)<>count(distinct x::uuid) from jsonb_array_elements_text(ids) x) then raise exception 'Select at most20 distinct API originals' using errcode='23514';end if;
 select coalesce(jsonb_agg(x::uuid order by x::uuid),'[]') into ids from jsonb_array_elements_text(ids) x;
 older:=p_selection-'api_original_ids';
 for k in select jsonb_object_keys(older) loop if jsonb_typeof(older->k) is distinct from 'array' then raise exception 'Source selections must be arrays' using errcode='23514';end if;n:=n+jsonb_array_length(older->k);end loop;
 -- Mapping locks precede patient and series locks; preview and review writers
 -- serialize under4700 without introducing a post-write reverse lock.
 for locked in select distinct animal_link_id from public.ezyvet_attachment_review_records where id in(select x::uuid from jsonb_array_elements_text(ids) x) order by animal_link_id loop perform 1 from public.ezyvet_record_links where id=locked.animal_link_id for share;end loop;
 perform 1 from public.pets where id=p_pet_id for share;
 if n=0 and jsonb_array_length(ids)>0 then
  result:=public.preview_record_release_v1(p_pet_id,p_client_id,p_channel,p_recipient,'{}');s:=result->'snapshot';
  foreach k in array array['encounter_ids','certificate_ids','lab_order_ids','document_ids','dental_ids','qol_ids','anesthesia_ids','lesion_ids','problem_ids','weight_ids','treatment_ids','patient_summary_ids','lab_report_ids','external_record_ids','imported_history_ids','imported_vaccination_ids','imported_prescription_ids'] loop s:=jsonb_set(s,'{selection}',coalesce(s->'selection','{}')||jsonb_build_object(k,'[]'::jsonb));end loop;
  foreach k in array array['dental_charts','qol_records','anesthesia_records','lesions','problems','weights','treatments','patient_summaries','lab_reports','external_records','imported_histories','imported_vaccinations','imported_prescriptions','problem_source_extractions'] loop s:=s||jsonb_build_object(k,'[]'::jsonb);end loop;
 else result:=public.release_preview_v8_internal(p_pet_id,p_client_id,p_channel,p_recipient,older);s:=result->'snapshot';end if;
 for v in select * from public.ezyvet_attachment_review_records where id in(select x::uuid from jsonb_array_elements_text(ids) x) order by source_origin,source_site_uid,source_animal_id,source_attachment_id loop perform public.ezyvet_attachment_review_series_lock(v.source_origin,v.source_site_uid,v.source_animal_id,v.source_attachment_id);end loop;
 for k in select jsonb_array_elements_text(ids) loop
  select * into v from public.ezyvet_attachment_review_records where id=k::uuid;
  if v.id is null or not public.release_api_original_eligible(v.id,p_pet_id) or v.client_id is distinct from p_client_id then raise exception 'Current acknowledged same-patient API original required' using errcode='40001';end if;
  perform public.ezyvet_attachment_review_original(v.capture_id);
  entry:=public.release_api_original_entry(v.id);originals:=originals||jsonb_build_array(entry);
 end loop;
 s:=s||jsonb_build_object('schema_version',9,'selection',coalesce(s->'selection','{}')||jsonb_build_object('api_original_ids',ids),'api_originals',originals);
 if jsonb_array_length(coalesce(s->'attachments','[]'))+jsonb_array_length(originals)>24 then raise exception 'At most24 originals per release' using errcode='23514';end if;
 if octet_length(s::text)>1048576 then raise exception 'Release exceeds maximum reviewed snapshot size' using errcode='23514';end if;
 return jsonb_build_object('snapshot',s,'source_hash',encode(sha256(convert_to(s::text,'UTF8')),'hex'));
exception when invalid_text_representation then raise exception 'Source IDs must be valid UUIDs' using errcode='23514';end $$;
create function public.preview_record_release_v9(p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb) returns jsonb language plpgsql security definer set search_path=public as $$ begin perform public.clinical_require_staff();return public.release_preview_v9_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection);end $$;
create function public.list_record_release_sources_v9(p_pet_id uuid,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;rows jsonb;more boolean;begin
 perform public.clinical_require_staff();result:=public.list_record_release_sources_v8(p_pet_id,p_offset);
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'version',version,'version_hash',record_hash,'recorded_at',approved_at,'label','Outside original '||source_attachment_id||' · admitted version '||version,'source_label','ezyVet · '||source_site_uid,'mime_type',mime_type,'file_size',file_size,'capture_hash',capture_hash,'content_sha256',content_sha256,'acknowledgment_count',(select count(*) from public.ezyvet_attachment_review_acknowledgments a where a.record_id=selected.id and a.record_hash=selected.record_hash and a.capture_hash=selected.capture_hash),'historical_source',not source_current_at_review) order by approved_at desc,id desc),'[]') into rows from(select * from public.ezyvet_attachment_review_records v where public.release_api_original_eligible(v.id,p_pet_id) order by approved_at desc,id desc offset p_offset limit 101) selected;
 more:=jsonb_array_length(rows)>100;if more then rows:=rows-100;end if;
 return result||jsonb_build_object('api_original_ids',rows,'has_more',result->'has_more'||jsonb_build_object('api_original_ids',more),'policy_v9_accepted',exists(select 1 from public.record_release_policy where id and enabled and accepted_at<=now() and accepted_schema_version>=9));
end $$;
create function public.select_all_record_release_sources_v9(p_pet_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;ids jsonb;begin
 perform public.clinical_require_staff();result:=public.select_all_record_release_sources_v8(p_pet_id);
 select coalesce(jsonb_agg(id order by id),'[]') into ids from public.ezyvet_attachment_review_records v where public.release_api_original_eligible(v.id,p_pet_id);
 if jsonb_array_length(ids)>20 then raise exception 'More than20 API originals; split explicit packages' using errcode='23514';end if;
 return result||jsonb_build_object('selection',result->'selection'||jsonb_build_object('api_original_ids',ids));
end $$;
-- Extend dispatch/registry while preserving all prior schema branches.
do $$declare d text;needle text;name text;begin
 select pg_get_functiondef('public.confirm_record_release(uuid,uuid,uuid,text,text,jsonb,jsonb,text,boolean)'::regprocedure) into d;
 needle:='if (p_reviewed_snapshot->>''schema_version'')::integer=8 then';
 if strpos(d,needle)=0 then raise exception 'Expected schema8 confirmation dispatch missing';end if;
 d:=replace(d,needle,'if (p_reviewed_snapshot->>''schema_version'')::integer=9 then preview:=public.release_preview_v9_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection); elsif (p_reviewed_snapshot->>''schema_version'')::integer=8 then');
 d:=replace(d,'''7'',''8'')','''7'',''8'',''9'')');
 needle:='''imported_prescription_ids''] loop';if strpos(d,needle)=0 then raise exception 'Expected prescription source registry missing';end if;
 d:=replace(d,needle,'''imported_prescription_ids'',''api_original_ids''] loop');
 d:=replace(d,'when ''imported_prescription_ids'' then ''imported_prescription'' else','when ''imported_prescription_ids'' then ''imported_prescription'' when ''api_original_ids'' then ''api_original'' else');execute d;
 select pg_get_functiondef('public.release_read_internal(uuid)'::regprocedure) into d;
 needle:='if r.snapshot->>''schema_version''=''8'' then';if strpos(d,needle)=0 then raise exception 'Expected schema8 recovery dispatch missing';end if;
 d:=replace(d,needle,'if r.snapshot->>''schema_version''=''9'' then current_preview:=public.release_preview_v9_internal(r.pet_id,r.client_id,r.channel,r.recipient,r.selection); elsif r.snapshot->>''schema_version''=''8'' then');
 d:=replace(d,'''7'',''8'')','''7'',''8'',''9'')');
 needle:='exception when sqlstate ''23514'' or sqlstate ''42501'' then';if strpos(d,needle)=0 then raise exception 'Expected source-read recovery boundary missing';end if;
 d:=replace(d,needle,'exception when sqlstate ''40001'' then if r.snapshot->>''schema_version''<>''9'' then raise;end if;eligible:=false;why:=''API original eligibility changed''; when sqlstate ''23514'' or sqlstate ''42501'' then');execute d;
 select pg_get_functiondef(oid) into d from pg_proc where pronamespace='public'::regnamespace and proname='verify_release_source_original_v5';
 needle:='p_snapshot->>''schema_version'' is distinct from ''8''';if d is null or strpos(d,needle)=0 then raise exception 'Expected schema8 byte verification guard missing';end if;
 execute replace(d,needle,needle||' and p_snapshot->>''schema_version'' is distinct from ''9''');
 foreach name in array array['invalidate_release_source_provenance','release_weight_provenance_changed','release_weight_source_head_changed'] loop
  select pg_get_functiondef(oid) into d from pg_proc where pronamespace='public'::regnamespace and proname=name;
  needle:='''7'',''8'')';if d is null or strpos(d,needle)=0 then raise exception 'Expected inherited provenance guard missing: %',name;end if;
  execute replace(d,needle,'''7'',''8'',''9'')');
 end loop;
end $$;
create function public.invalidate_release_api_original() returns trigger language plpgsql security definer set search_path=public as $$
declare changed_id uuid;begin
 if TG_TABLE_NAME='ezyvet_attachment_review_records' then changed_id:=NEW.previous_record_id;else changed_id:=NEW.record_id;end if;
 -- Mutation cores hold4700 before7101. Append events, never reverse-lock releases.
 insert into public.record_release_events(id,release_id,kind,reason,created_by)
 select gen_random_uuid(),s.release_id,'source_changed','Admitted API original superseded or withdrawn; prepare a fresh package',auth.uid() from public.record_release_sources s where s.source_kind='api_original' and s.source_id=changed_id;
 return NEW;
end $$;
create trigger release_api_original_replacement after insert on public.ezyvet_attachment_review_records for each row execute function public.invalidate_release_api_original();
create trigger release_api_original_withdrawal after insert on public.ezyvet_attachment_review_withdrawals for each row execute function public.invalidate_release_api_original();

-- Mapping identity changes permanently invalidate pending packages even if a
-- later repair restores the same identity. No provider-head or acknowledgment trigger.
create function public.invalidate_release_api_original_mapping() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if row(NEW.source_origin,NEW.source_site_uid,NEW.resource,NEW.external_id,NEW.pet_id,NEW.client_id) is not distinct from row(OLD.source_origin,OLD.source_site_uid,OLD.resource,OLD.external_id,OLD.pet_id,OLD.client_id) then return NEW;end if;
 insert into public.record_release_events(id,release_id,kind,reason,created_by)
 select gen_random_uuid(),s.release_id,'source_changed','API original patient mapping changed; prepare a fresh package',auth.uid() from public.record_release_sources s join public.ezyvet_attachment_review_records v on v.id=s.source_id where s.source_kind='api_original' and v.animal_link_id=NEW.id;
 return NEW;
end $$;
create trigger release_api_original_mapping after update on public.ezyvet_record_links for each row execute function public.invalidate_release_api_original_mapping();

create function public.get_release_api_original_context(p_family text,p_id uuid,p_actor_id uuid,p_record_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare b jsonb;entry jsonb;v public.ezyvet_attachment_review_records;o jsonb;actor uuid;begin
 perform public.communication_require_service();
 if p_family='release_email' then
  select actor_id into actor from public.release_email_requests where id=p_id;
  if actor is distinct from p_actor_id then raise exception 'Unavailable' using errcode='42501';end if;
  b:=public.release_email_context(p_id);
 elsif p_family='document_link' then
  select actor_id into actor from public.document_link_grants where id=p_id and family='record_release';
  if actor is distinct from p_actor_id then raise exception 'Unavailable' using errcode='42501';end if;
  b:=public.document_link_current(p_id)->'bundle';
 else raise exception 'Unavailable' using errcode='42501';end if;
 if actor is null or not public.is_active_staff(actor) or b#>>'{release,snapshot,schema_version}' is distinct from '9' then raise exception 'Unavailable' using errcode='42501';end if;
 select x into entry from jsonb_array_elements(b#>'{release,snapshot,api_originals}') x where x#>>'{record,id}'=p_record_id::text;
 select * into v from public.ezyvet_attachment_review_records where id=p_record_id;
 if entry is null or entry->'record' is distinct from to_jsonb(v) or not public.release_api_original_eligible(v.id,(b#>>'{release,pet_id}')::uuid) then raise exception 'Selected original unavailable' using errcode='42501';end if;
 o:=public.ezyvet_attachment_review_original(v.capture_id);
 return jsonb_build_object('record_id',v.id,'record_hash',v.record_hash,'capture_hash',v.capture_hash,'content_sha256',v.content_sha256,'mime_type',v.mime_type,'file_size',v.file_size,'bucket_id',o->'bucket_id','object_path',o->'object_path','storage_object_id',o->'storage_object_id');
end $$;
create function public.verify_release_api_original(p_entry jsonb,p_filename text,p_mime text,p_bytes bytea,p_index integer) returns void language plpgsql security definer set search_path=public as $$
declare v jsonb:=p_entry->'record';a jsonb:=p_entry->'acknowledgment';filename text;begin
 filename:=p_index::text||'-ezyvet-original-'||(v->>'source_attachment_id')||case v->>'mime_type' when 'application/pdf' then '.pdf' when 'image/png' then '.png' when 'image/jpeg' then '.jpg' end;
 if p_entry is null or v is null or a is null or row(a->>'record_id',a->>'record_hash',a->>'capture_hash') is distinct from row(v->>'id',v->>'record_hash',v->>'capture_hash') or p_filename is distinct from filename or p_mime is distinct from v->>'mime_type' or octet_length(p_bytes) not between 1 and 20971520 or octet_length(p_bytes)::bigint is distinct from (v->>'file_size')::bigint or encode(sha256(p_bytes),'hex') is distinct from v->>'content_sha256' then raise exception 'API original differs from frozen acknowledged capture' using errcode='23514';end if;
 if (p_mime='application/pdf' and substring(p_bytes from 1 for 5)<>convert_to('%PDF-','UTF8')) or(p_mime='image/png' and substring(p_bytes from 1 for 8)<>decode('89504e470d0a1a0a','hex')) or(p_mime='image/jpeg' and substring(p_bytes from 1 for 3)<>decode('ffd8ff','hex')) or p_mime not in('application/pdf','image/png','image/jpeg') then raise exception 'API original signature differs' using errcode='23514';end if;
end $$;

-- Exact captured email replay precedes fresh source inspection.
create or replace function public.capture_release_email_payload(p_request_id uuid,p_actor_id uuid,p_payload_text text) returns void language plpgsql security definer set search_path=public as $$
declare r public.release_email_requests;existing public.release_email_payloads;b jsonb;payload jsonb;a jsonb;doc jsonb;decoded bytea;manifest jsonb:='[]';i integer:=0;hash text;filename text;api_entry jsonb;ordinary_count integer;api_count integer;
begin
 perform public.communication_require_service();
 if p_payload_text is null or octet_length(p_payload_text) not between 1 and 33554432 then raise exception 'Encoded email exceeds application limits' using errcode='23514';end if;
 select * into r from public.release_email_requests where id=p_request_id for update;
 if not found or r.actor_id is distinct from p_actor_id or r.state='abandoned' or not public.is_active_staff(r.actor_id) then raise exception 'Request ownership mismatch or abandoned' using errcode='42501';end if;
 hash:=encode(sha256(convert_to(p_payload_text,'UTF8')),'hex');
 select * into existing from public.release_email_payloads where request_id=p_request_id;
 if found then if existing.payload_text is distinct from p_payload_text then raise exception 'Captured provider payload is immutable' using errcode='23505';end if;return;end if;
 b:=public.release_email_context(p_request_id);payload:=p_payload_text::jsonb;
 ordinary_count:=jsonb_array_length(b#>'{release,snapshot,attachments}');api_count:=case when b#>>'{release,snapshot,schema_version}'='9' then jsonb_array_length(b#>'{release,snapshot,api_originals}') else 0 end;
 if jsonb_typeof(payload)<>'object' or payload-array['from','reply_to','to','subject','text','attachments']<>'{}' or payload->'to' is distinct from jsonb_build_array(r.recipient) or payload->>'subject' is distinct from r.subject or payload->>'text' is distinct from r.body or public.communication_recipient('EMAIL',payload->>'reply_to') is null or jsonb_typeof(payload->'from') is distinct from 'string' or length(payload->>'from') not between 1 and 500 or public.communication_recipient('EMAIL',coalesce(substring(payload->>'from' from '<([^<>]+)>$'),payload->>'from')) is null then raise exception 'Provider payload differs from reviewed email intent' using errcode='23514';end if;
 if jsonb_typeof(payload->'attachments') is distinct from 'array' then raise exception 'Frozen attachments are required' using errcode='23514';end if;
 if jsonb_array_length(payload->'attachments')<>ordinary_count+api_count+1 or jsonb_array_length(payload->'attachments')>25 then raise exception 'Attachment manifest must exactly match the release and report within 25 files' using errcode='23514';end if;
 for a in select value from jsonb_array_elements(payload->'attachments') loop
  if jsonb_typeof(a)<>'object' or a-array['filename','content_type','content']<>'{}' or jsonb_typeof(a->'filename') is distinct from 'string' or jsonb_typeof(a->'content') is distinct from 'string' or a->>'filename' ~ '[[:cntrl:]/\\]' or length(a->>'filename') not between 1 and 180 or a->>'content' !~ '^[A-Za-z0-9+/]*={0,2}$' then raise exception 'Attachment metadata is invalid' using errcode='23514';end if;
  decoded:=decode(a->>'content','base64');
  if octet_length(decoded)<1 then raise exception 'Empty attachment rejected' using errcode='23514';end if;
  if i=0 then
   if a->>'filename' is distinct from 'medical-records-'||r.release_id::text||'.html' or a->>'content_type' is distinct from 'text/html' then raise exception 'Rendered report must be a truthful HTML attachment' using errcode='23514';end if;
   perform convert_from(decoded,'UTF8');
  elsif i>ordinary_count then
   api_entry:=(b#>'{release,snapshot,api_originals}')->(i-ordinary_count-1);
   perform public.verify_release_api_original(api_entry,a->>'filename',a->>'content_type',decoded,i);
  else
   doc:=(b#>'{release,snapshot,attachments}')->(i-1);
   filename:=i::text||'-'||coalesce(nullif(left(trim(both ' .' from regexp_replace(regexp_replace(doc->>'file_name','\.[^.]*$',''),'[^A-Za-z0-9 _.-]','_','g')),100),''),'record')||case doc->>'mime_type' when 'application/pdf' then '.pdf' when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else null end;
   if a->>'filename' is distinct from filename or a->>'content_type' is distinct from doc->>'mime_type' or octet_length(decoded)::bigint is distinct from (doc->>'file_size')::bigint then raise exception 'Original attachment metadata differs from release' using errcode='23514';end if;
   perform public.verify_release_source_original_v5(b#>'{release,snapshot}',doc,decoded);
  end if;
  manifest:=manifest||jsonb_build_array(jsonb_build_object('filename',a->>'filename','mime_type',a->>'content_type','file_size',octet_length(decoded),'sha256',encode(sha256(decoded),'hex'),'document_id',case when i>0 and i<=ordinary_count then doc->'id' else null end)||case when i>ordinary_count then jsonb_build_object('api_original_id',api_entry#>'{record,id}') else '{}'::jsonb end);i:=i+1;
 end loop;
 insert into public.release_email_payloads(request_id,payload_text,payload_hash,manifest) values(p_request_id,p_payload_text,hash,manifest);
 update public.release_email_requests set state='ready' where id=p_request_id;
exception when invalid_text_representation or character_not_in_repertoire then raise exception 'Malformed frozen email payload' using errcode='23514';
end $$;

create or replace function public.capture_document_link(p_id uuid,p_actor_id uuid,p_payload_text text,p_token_hash text,p_message_hash text) returns void language plpgsql security definer set search_path=public,extensions as $$
declare g public.document_link_grants;old public.document_link_payloads;payload jsonb;a jsonb;d jsonb;bytes bytea;manifest jsonb:='[]';n integer:=0;expected_count integer;ordinary_count integer;api_count integer;api_entry jsonb;is_api boolean;
begin
 select * into g from public.document_link_grants where id=p_id for update;
 if not found or g.actor_id<>p_actor_id then raise exception 'Unavailable' using errcode='42501';end if;
 select * into old from public.document_link_payloads where grant_id=p_id;
 if found then
  if old.payload_text<>p_payload_text or old.token_hash<>p_token_hash or old.message_hash<>p_message_hash then raise exception 'Captured bytes differ' using errcode='23505';end if;return;
 end if;
 perform public.document_link_current(p_id);
 if g.state<>'preparing' or p_payload_text is null or octet_length(p_payload_text)>33554432 or p_token_hash !~ '^[a-f0-9]{64}$' or p_message_hash !~ '^[a-f0-9]{64}$' then raise exception 'Capture invalid' using errcode='23514';end if;
 payload:=p_payload_text::jsonb;
 ordinary_count:=case when g.family='invoice' then 0 else jsonb_array_length(g.source_bundle#>'{release,snapshot,attachments}') end;
 api_count:=case when g.family='record_release' and g.source_bundle#>>'{release,snapshot,schema_version}'='9' then jsonb_array_length(g.source_bundle#>'{release,snapshot,api_originals}') else 0 end;
 expected_count:=1+ordinary_count+api_count;
 if jsonb_typeof(payload) is distinct from 'object' or (select count(*) from jsonb_object_keys(payload))<>1 or jsonb_typeof(payload->'artifacts') is distinct from 'array' or jsonb_array_length(payload->'artifacts')<>expected_count or expected_count>25 then raise exception 'Artifact count invalid' using errcode='23514';end if;
 for a in select value from jsonb_array_elements(payload->'artifacts') loop
  is_api:=n>ordinary_count and n>0;
  if jsonb_typeof(a) is distinct from 'object' or (select count(*) from jsonb_object_keys(a))<>(case when is_api then 5 else 4 end) or (is_api and (a-array['filename','mime_type','document_id','api_original_id','content']<>'{}' or a->'document_id' is distinct from 'null'::jsonb)) or jsonb_typeof(a->'content') is distinct from 'string' or jsonb_typeof(a->'mime_type') is distinct from 'string' or jsonb_typeof(a->'filename') is distinct from 'string' or a->>'filename' !~ '^[A-Za-z0-9 _.-]{1,180}$' then raise exception 'Artifact invalid' using errcode='23514';end if;
  bytes:=decode(a->>'content','base64');
  if octet_length(bytes)<1 then raise exception 'Empty artifact' using errcode='23514';end if;
  if n=0 then
   if a->>'mime_type'<>'text/html' or a->>'document_id' is not null or octet_length(bytes)>20971520 then raise exception 'Report invalid' using errcode='23514';end if;
  elsif is_api then
   api_entry:=(g.source_bundle#>'{release,snapshot,api_originals}')->(n-ordinary_count-1);
   if a->>'api_original_id' is distinct from api_entry#>>'{record,id}' then raise exception 'Selected API original identity differs' using errcode='23514';end if;
   perform public.verify_release_api_original(api_entry,a->>'filename',a->>'mime_type',bytes,n);
  else
   d:=g.source_bundle#>array['release','snapshot','attachments',(n-1)::text];
   if a->>'document_id' is distinct from d->>'id' or a->>'mime_type' is distinct from d->>'mime_type' or octet_length(bytes)<>(d->>'file_size')::bigint or octet_length(bytes)>20971520 then raise exception 'Original differs' using errcode='23514';end if;
   perform public.verify_release_source_original_v5(g.source_bundle#>'{release,snapshot}',d,bytes);
   if (a->>'mime_type'='application/pdf' and substring(bytes from 1 for 5)<>convert_to('%PDF-','UTF8')) or (a->>'mime_type'='image/png' and substring(bytes from 1 for 8)<>decode('89504e470d0a1a0a','hex')) or (a->>'mime_type'='image/jpeg' and substring(bytes from 1 for 3)<>decode('ffd8ff','hex')) or a->>'mime_type' not in ('application/pdf','image/png','image/jpeg') then raise exception 'Original signature differs' using errcode='23514';end if;
  end if;
  manifest:=manifest||jsonb_build_array(jsonb_build_object('index',n,'filename',a->>'filename','mime_type',a->>'mime_type','file_size',octet_length(bytes),'sha256',encode(digest(bytes,'sha256'),'hex'))||case when is_api then jsonb_build_object('api_original_id',api_entry#>'{record,id}') else '{}'::jsonb end);n:=n+1;
 end loop;
 insert into public.document_link_payloads(grant_id,payload_text,artifact_hash,token_hash,message_hash,manifest) values(g.id,p_payload_text,encode(digest(p_payload_text,'sha256'),'hex'),p_token_hash,p_message_hash,manifest);
 update public.document_link_grants set state='captured' where id=g.id;
end $$;

-- No direct table grants; all helpers remain private. Existing capture RPC grants
-- are retained by CREATE OR REPLACE, and context is service-only.
do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in('release_api_original_eligible','release_api_original_entry','release_preview_v9_internal','preview_record_release_v9','list_record_release_sources_v9','select_all_record_release_sources_v9','invalidate_release_api_original','invalidate_release_api_original_mapping','get_release_api_original_context','verify_release_api_original') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in('preview_record_release_v9','list_record_release_sources_v9','select_all_record_release_sources_v9') then execute format('grant execute on function %s to authenticated',f.signature);end if;
  if f.proname='get_release_api_original_context' then execute format('grant execute on function %s to service_role',f.signature);end if;
 end loop;
end $$;
