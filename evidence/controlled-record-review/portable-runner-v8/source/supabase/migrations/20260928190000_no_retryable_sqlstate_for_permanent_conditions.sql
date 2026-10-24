-- 2026-09-28 production incident: PostgREST retried a permanent RPC failure forever.
--
-- PostgREST (every release before v16.0) runs each request inside hasql-transaction's
-- inRetryingTransaction, which re-runs the WHOLE transaction, without limit, whenever the
-- server reports SQLSTATE 40001 (serialization_failure) or 40P01 (deadlock_detected).
-- record_outbound_delivery_callback raised 40001 for a permanent condition (a Resend receipt
-- for another business on the shared, account-wide Resend webhook), so every such webhook
-- became a tight in-database loop: ~100M calls, ~4.16M errors/24h, CPU 100%.
-- See docs/postgrest-retryable-sqlstates.md for the mechanism and citations.
--
-- This migration redefines every current function that raised or caught 40001. Each body is
-- the live definition after all prior migrations (pg_get_functiondef), with ONLY:
--   * errcode/sqlstate '40001'  ->  'PT409'   ("state changed / not eligible; reload or review")
--   * record_outbound_delivery_callback: an unknown or ineligible delivery returns NULL
--     (acknowledged no-op) instead of raising.
-- 'PT409' is a PostgREST custom status code (PTxyz => HTTP xyz, i.e. 409 Conflict) and is never
-- retried by PostgREST, hasql-transaction or supabase-js. Other SQLSTATEs (23514, 42501, 23503,
-- 23505, ...) are unchanged. Detectors in src/ and supabase/functions/ were moved to 'PT409'.
-- Guard: supabase/tests/no_retryable_sqlstates.test.sql.
--
-- 151 functions, 234 occurrences.

-- acknowledge_external_record(uuid,uuid,uuid,text,integer,boolean)
CREATE OR REPLACE FUNCTION public.acknowledge_external_record(p_id uuid, p_record_id uuid, p_pet_id uuid, p_expected_capture_hash text, p_expected_document_version integer, p_attest boolean)
 RETURNS external_record_acknowledgments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid:=public.clinical_require_staff();a public.external_record_acknowledgments;r public.external_record_versions;
begin
 if not public.has_role(actor,'DVM') then raise exception 'Veterinarian acknowledgment required' using errcode='42501';end if;
 if p_id is null or p_attest is distinct from true then raise exception 'Explicit report acknowledgment required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,4202));
 select * into a from public.external_record_acknowledgments where id=p_id;
 if found then
 if row(a.actor_id,a.record_id,a.capture_hash,a.document_version) is distinct from row(actor,p_record_id,p_expected_capture_hash,p_expected_document_version) or not exists(select 1 from public.external_record_versions where id=a.record_id and pet_id=p_pet_id) then raise exception 'Acknowledgment UUID already used' using errcode='23505';end if;return a;end if;
 select * into r from public.external_record_versions where id=p_record_id and pet_id=p_pet_id;
 if not found or r.capture_hash is distinct from p_expected_capture_hash or r.document_version is distinct from p_expected_document_version then raise exception 'Exact report acknowledgment required' using errcode='42501';end if;
 perform 1 from public.ezyvet_record_links where id=r.animal_link_id for update; perform 1 from public.patient_documents where id=r.document_id and pet_id=r.pet_id and status='ready' and version=r.document_version for share;
 if not found then raise exception 'Reviewed report document unavailable' using errcode='PT409';end if;
 insert into public.external_record_acknowledgments(id,actor_id,record_id,capture_hash,document_version) values(p_id,actor,r.id,r.capture_hash,r.document_version) returning * into a;return a;
end $function$;

-- acknowledge_lab_report(uuid,uuid,uuid,text,integer,boolean)
CREATE OR REPLACE FUNCTION public.acknowledge_lab_report(p_id uuid, p_report_id uuid, p_pet_id uuid, p_expected_capture_hash text, p_expected_document_version integer, p_attest boolean)
 RETURNS lab_report_acknowledgments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid:=public.clinical_require_staff();a public.lab_report_acknowledgments;r public.lab_report_versions;
begin
 if not public.has_role(actor,'DVM') then raise exception 'Veterinarian acknowledgment required' using errcode='42501';end if;
 if p_id is null or p_attest is distinct from true then raise exception 'Explicit report acknowledgment required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,4104));
 select * into a from public.lab_report_acknowledgments where id=p_id;
 if found then
 if row(a.actor_id,a.report_id,a.capture_hash,a.document_version) is distinct from row(actor,p_report_id,p_expected_capture_hash,p_expected_document_version) or not exists(select 1 from public.lab_report_versions where id=a.report_id and pet_id=p_pet_id) then raise exception 'Acknowledgment UUID already used' using errcode='23505';end if;return a;end if;
 select * into r from public.lab_report_versions where id=p_report_id and pet_id=p_pet_id;
 if not found or r.capture_hash is distinct from p_expected_capture_hash or r.document_version is distinct from p_expected_document_version then raise exception 'Exact report acknowledgment required' using errcode='42501';end if;
 perform 1 from public.patient_lab_orders where id=r.order_id for update; perform 1 from public.patient_documents where id=r.document_id and pet_id=r.pet_id and status='ready' and version=r.document_version for share;
 if not found then raise exception 'Reviewed report document unavailable' using errcode='PT409';end if;
 insert into public.lab_report_acknowledgments(id,actor_id,report_id,capture_hash,document_version) values(p_id,actor,r.id,r.capture_hash,r.document_version) returning * into a;return a;
end $function$;

-- append_native_dispense_correction(uuid,jsonb)
CREATE OR REPLACE FUNCTION public.append_native_dispense_correction(p_id uuid, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a uuid:=public.clinical_require_staff();actor jsonb;aid uuid;pet uuid;did uuid;amends uuid;kind text;v jsonb;c jsonb;head jsonb;doc jsonb;pickup jsonb;assertion jsonb;stamp timestamptz;handoff_at timestamptz;seq integer;old public.native_dispense_correction_operations;reference public.native_dispense_correction_events;
begin
 if p_id is null then raise exception 'Stable correction ID required' using errcode='23514';end if;
 perform public.native_rx_keys(p_request,array['authorization_id','pet_id','dispense_id','kind','expected_context_hash','expected_head','reason','note','amends_event_id','pickup_amendment','attest_review']);
 aid:=public.native_correction_uuid(p_request->'authorization_id');pet:=public.native_correction_uuid(p_request->'pet_id');did:=public.native_correction_uuid(p_request->'dispense_id');amends:=public.native_correction_uuid(p_request->'amends_event_id',true);kind:=p_request->>'kind';
 perform public.native_rx_text(p_request->'reason',2000);perform public.native_rx_text(p_request->'note',4000);
 if kind is null or kind not in('clinical_annotation','operational_annotation','pickup_amendment') or p_request->'attest_review' is distinct from 'true'::jsonb or jsonb_typeof(p_request->'expected_context_hash') is distinct from 'string' or p_request->>'expected_context_hash' !~ '^[a-f0-9]{64}$' then raise exception 'Exact correction review required' using errcode='23514';end if;
 perform public.native_rx_keys(p_request->'expected_head',array['event_id','version','record_hash']);perform public.native_correction_uuid(p_request#>'{expected_head,event_id}',true);
 perform pg_advisory_xact_lock(hashtextextended('native-dispense-correction-operation:'||p_id::text,0));perform public.clinical_require_staff();
 select * into old from public.native_dispense_correction_operations where id=p_id;
 if found then
  if old.actor_id<>a or old.request is distinct from p_request then raise exception 'Correction identifier already used' using errcode='23514';end if;
  perform public.native_correction_verified(aid,pet,did);perform public.clinical_require_staff();return public.native_correction_receipt(old);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('native-prescription-authorization:'||aid::text,0));actor:=public.native_correction_actor(kind);
 v:=public.native_correction_verified(aid,pet,did);if v is null then raise exception 'Exact correction target required' using errcode='23514';end if;
 c:=v->'context';head:=c->'head';
 if p_request->>'expected_context_hash' is distinct from v->>'context_hash' or p_request->'expected_head' is distinct from head then raise exception 'Correction review context changed' using errcode='PT409';end if;
 if (head->>'version')::integer=2147483647 then raise exception 'Correction history version exhausted' using errcode='23514';end if;seq:=(head->>'version')::integer+1;
 if amends is not null then select * into reference from public.native_dispense_correction_events where id=amends;
  if reference.id is null or reference.dispense_id<>did or reference.kind<>kind then raise exception 'Exact same-kind correction amendment required' using errcode='23514';end if;
 end if;
 stamp:=clock_timestamp();
 if stamp<(c->>'dispensed_at')::timestamptz or (jsonb_array_length(v->'events')>0 and stamp<(v#>>'{events,-1,created_at}')::timestamptz) then raise exception 'Correction observation clock moved backwards' using errcode='PT409';end if;
 if kind='pickup_amendment' then
  pickup:=c->'original_pickup';assertion:=p_request->'pickup_amendment';perform public.native_rx_keys(assertion,array['original_pickup_id','disposition','handoff']);
  if pickup='null'::jsonb or pickup is null or public.native_correction_uuid(assertion->'original_pickup_id')::text is distinct from pickup->>'id' or amends::text is distinct from c#>>'{latest_pickup_amendment,event_id}' then raise exception 'Exact original pickup and latest amendment required' using errcode='23514';end if;
  if stamp<(pickup->>'picked_up_at')::timestamptz then raise exception 'Correction observation clock moved backwards' using errcode='PT409';end if;
  if assertion->>'disposition'='recorded_in_error' then
   if assertion->'handoff' is distinct from 'null'::jsonb then raise exception 'Disputed pickup must not assert replacement handoff' using errcode='23514';end if;
  elsif assertion->>'disposition'='corrected_handoff' then
   perform public.native_rx_keys(assertion->'handoff',array['picked_up_at','recipient_name','recipient_relationship']);perform public.native_rx_text(assertion#>'{handoff,recipient_name}',200);perform public.native_rx_text(assertion#>'{handoff,recipient_relationship}',200);
   handoff_at:=public.native_correction_instant(assertion#>'{handoff,picked_up_at}');if handoff_at<(c->>'dispensed_at')::timestamptz or handoff_at>stamp then raise exception 'Corrected handoff time outside recorded bounds' using errcode='23514';end if;
  else raise exception 'Pickup amendment disposition required' using errcode='23514';end if;
 elsif p_request->'pickup_amendment' is distinct from 'null'::jsonb then raise exception 'Annotation cannot replace pickup' using errcode='23514';end if;
 actor:=public.native_correction_actor(kind);
 doc:=jsonb_build_object('version',1,'id',p_id,'target',c->'target','authorization_hash',c->'authorization_hash','dispense_document_hash',c->'dispense_document_hash','sequence',seq,'prior_event_id',head->'event_id','prior_record_hash',head->'record_hash','actor',actor,'kind',kind,'reason',p_request->'reason','note',p_request->'note','amends_event_id',p_request->'amends_event_id','pickup_amendment',p_request->'pickup_amendment','reviewed_context_hash',v->'context_hash','created_at',stamp);
 doc:=doc||jsonb_build_object('record_hash',public.native_fulfillment_hash(doc));
 insert into public.native_dispense_correction_events values(p_id,aid,pet,did,seq,(head->>'event_id')::uuid,a,kind,stamp,doc->>'record_hash',c,doc);
 insert into public.native_dispense_correction_operations values(p_id,a,p_request,public.native_fulfillment_hash(jsonb_build_object('version',1,'actor_id',a,'operation','append_native_dispense_correction','request',p_request)),doc,stamp) returning * into old;
 perform public.native_correction_actor(kind);return public.native_correction_receipt(old);
end $function$;

-- approve_external_record_import(uuid,uuid,text,text,boolean)
CREATE OR REPLACE FUNCTION public.approve_external_record_import(p_id uuid, p_receipt_id uuid, p_expected_receipt_hash text, p_expected_capture_hash text, p_attest boolean)
 RETURNS external_record_versions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid:=public.clinical_require_staff();r public.external_record_versions;receipt public.external_record_receipts;capture public.external_record_byte_captures;prior public.external_record_versions;m public.ezyvet_record_links;
begin
 if not public.ezyvet_is_active_admin(actor) then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_attest is distinct from true then raise exception 'Explicit exact export review required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,4201));
 select * into r from public.external_record_versions where id=p_id;
 if found then if row(r.actor_id,r.receipt_id,r.receipt_hash,r.capture_hash) is distinct from row(actor,p_receipt_id,p_expected_receipt_hash,p_expected_capture_hash) then raise exception 'Approval UUID already used' using errcode='23505';end if;return r;end if;
 select * into receipt from public.external_record_receipts where id=p_receipt_id and actor_id=actor;
 if not found or receipt.receipt_hash is distinct from p_expected_receipt_hash then raise exception 'Owned exact receipt required' using errcode='42501';end if;
 select * into m from public.ezyvet_record_links where id=receipt.animal_link_id and resource='animal' for update;
 if not found or row(m.pet_id,m.source_origin,m.source_site_uid,m.external_id) is distinct from row(receipt.pet_id,receipt.source_origin,receipt.source_site_uid,receipt.source_animal_id) then raise exception 'Reviewed animal identity unavailable' using errcode='42501';end if;
 perform 1 from public.pets where id=receipt.pet_id and client_id=m.client_id and version=receipt.pet_version for share;
 if not found then raise exception 'Patient changed; stage a new reviewed receipt' using errcode='PT409';end if;
 select * into capture from public.external_record_byte_captures where receipt_id=receipt.id;
 if not found or capture.capture_hash is distinct from p_expected_capture_hash then raise exception 'Verified document bytes and explicit review required' using errcode='42501';end if;
 perform 1 from public.patient_documents where id=receipt.document_id and pet_id=receipt.pet_id and status='ready' and version=receipt.document_version for share;
 if not found then raise exception 'Document changed; review current document' using errcode='PT409';end if;
 select * into prior from public.external_record_versions where animal_link_id=m.id and export_reference=receipt.export_reference order by version desc limit 1;
 if prior.id is distinct from receipt.previous_record_id then raise exception 'External record history changed; review current version' using errcode='PT409';end if;
 insert into public.external_record_versions(id,actor_id,receipt_id,animal_link_id,pet_id,pet_version,document_id,document_version,receipt_hash,capture_hash,export_reference,previous_record_id,version,kind,review_reason) values(p_id,actor,receipt.id,m.id,receipt.pet_id,receipt.pet_version,receipt.document_id,receipt.document_version,receipt.receipt_hash,capture.capture_hash,receipt.export_reference,prior.id,coalesce(prior.version,0)+1,case when prior.id is null then 'original' else 'replacement' end,receipt.review_reason) returning * into r;return r;
end $function$;

-- approve_ezyvet_attachment_record_uncancelled(uuid,uuid,uuid,text,uuid,text,text,boolean)
CREATE OR REPLACE FUNCTION public.approve_ezyvet_attachment_record_uncancelled(p_id uuid, p_request_id uuid, p_pet_id uuid, p_capture_hash text, p_previous_record_id uuid, p_title text, p_review_reason text, p_attest boolean)
 RETURNS ezyvet_attachment_record_versions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare actor uuid:=auth.uid();r public.ezyvet_attachment_capture_requests;c public.ezyvet_attachment_original_captures;i public.ezyvet_attachment_original_intents;v public.ezyvet_attachment_record_versions;prior public.ezyvet_attachment_record_versions;context jsonb;m uuid;external_id text;record jsonb;
begin
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_request_id is null or p_pet_id is null or p_capture_hash is null or p_capture_hash !~ '^[a-f0-9]{64}$' or p_attest is distinct from true
  or p_title is null or p_title<>btrim(p_title) or length(p_title) not between 1 and 200 or p_review_reason is null or p_review_reason<>btrim(p_review_reason) or length(p_review_reason) not between 1 and 2000 then raise exception 'Exact capture and explicit original review required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,7300));
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into v from public.ezyvet_attachment_record_versions where id=p_id;
 if found then
  if row(v.actor_id,v.request_id,v.pet_id,v.capture_hash,v.previous_record_id,v.title,v.review_reason) is distinct from row(actor,p_request_id,p_pet_id,p_capture_hash,p_previous_record_id,p_title,p_review_reason) then raise exception 'Approval identity differs' using errcode='23505';end if;
  return v;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,7000));
 select * into r from public.ezyvet_attachment_capture_requests where id=p_request_id for share;
 select * into c from public.ezyvet_attachment_original_captures where request_id=p_request_id;
 select * into i from public.ezyvet_attachment_original_intents where request_id=p_request_id;
 if public.ezyvet_is_active_admin(actor) is not true or r.id is null or c.request_id is null or i.id is null
  or row(r.requested_by,r.pet_id,r.status,c.capture_hash,c.intent_id,c.content_sha256,c.mime_type,c.file_size)
   is distinct from row(actor,p_pet_id,'ready'::text,p_capture_hash,i.id,i.content_sha256,i.mime_type,i.file_size)
 then raise exception 'Owned ready original required' using errcode='42501';end if;
 perform public.ezyvet_attachment_capture_lock_source(r.id,false);
 context:=jsonb_build_object('capture_contract','canonical_api_original_v1','parent',r.parent_context,
  'run_id',r.run_id,'page',r.page,'ordinal',r.ordinal,'attachment_snapshot_id',r.snapshot_id,
  'attachment_observed_head_version',r.observed_head_version,'attachment_external_id',r.external_id,
  'file_id',r.file_id,'stable_metadata_sha256',r.stable_metadata_sha256,'raw_record_sha256',r.raw_record_sha256,
  'metadata',r.metadata);
 m:=r.animal_link_id;external_id:=r.external_id;
 perform pg_advisory_xact_lock(hashtextextended(m::text||':'||external_id,7301));
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into prior from public.ezyvet_attachment_record_versions where animal_link_id=m and attachment_external_id=external_id order by version desc limit 1;
 if prior.id is distinct from p_previous_record_id or (prior.id is not null and prior.pet_id<>p_pet_id) then raise exception 'Review latest attachment version before correction' using errcode='PT409';end if;
 perform 1 from storage.objects where id=c.storage_object_id and bucket_id=i.bucket_id and name=i.object_path and metadata->>'size'=i.file_size::text and metadata->>'mimetype'=i.mime_type for share;
 if not found then raise exception 'Captured original unavailable' using errcode='PT409';end if;
 record:=jsonb_build_object('id',p_id,'actor_id',actor,'request_id',r.id,'pet_id',p_pet_id,'animal_link_id',m,'source_context',context,'request_hash',r.request_hash,'capture_hash',c.capture_hash,'title',p_title,'review_reason',p_review_reason,'previous_record_id',prior.id,'version',coalesce(prior.version,0)+1,'entry_method','staff_reviewed_api_attachment_v2');
 insert into public.ezyvet_attachment_record_versions(id,actor_id,request_id,pet_id,animal_link_id,source_origin,source_site_uid,attachment_external_id,request_hash,capture_hash,source_context,title,review_reason,previous_record_id,version,record_hash)
 values(p_id,actor,r.id,p_pet_id,m,context->'parent'->>'source_origin',context->'parent'->>'source_site_uid',external_id,r.request_hash,c.capture_hash,context,p_title,p_review_reason,prior.id,coalesce(prior.version,0)+1,encode(digest(convert_to(record::text,'UTF8'),'sha256'),'hex')) returning * into v;
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return v;
end $function$;

-- approve_ezyvet_prescription_review(uuid,uuid,text,boolean)
CREATE OR REPLACE FUNCTION public.approve_ezyvet_prescription_review(p_id uuid, p_pet_id uuid, p_expected_hash text, p_confirmed boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare actor uuid:=public.ezyvet_prescription_require_dvm();r public.ezyvet_prescription_review_requests;
 context jsonb;old public.ezyvet_imported_prescriptions;record_id uuid;ih text;moment timestamptz:=clock_timestamp();begin
 if p_confirmed is distinct from true then raise exception 'Explicit veterinarian confirmation required' using errcode='23514';end if;
 if p_id is null or p_pet_id is null or p_expected_hash is null then raise exception 'Exact owned prepared review required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,5900));
 select * into r from public.ezyvet_prescription_review_requests where id=p_id for update;
 if not found or row(r.actor_id,r.pet_id,r.request_hash) is distinct from row(actor,p_pet_id,p_expected_hash) then
  raise exception 'Exact owned prepared review required' using errcode='42501';end if;
 if r.status='approved' then return public.ezyvet_prescription_review_projection(p_id);end if;
 if r.status<>'prepared' then raise exception 'Abandoned review cannot approve' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_pet_id::text,4700));
 context:=public.ezyvet_prescription_source_context(p_pet_id,(r.payload->>'item_run_id')::uuid);
 if not exists(select 1 from public.pets where id=p_pet_id and version::numeric=(r.payload->>'patient_version')::numeric) then
  raise exception 'Patient version changed' using errcode='PT409';end if;
 context:=public.ezyvet_prescription_interpretation_context(context,r.payload->'interpretation');
 context:=context||jsonb_build_object('patient_version',r.payload->'patient_version');
 if context is distinct from r.review_context then raise exception 'Prepared prescription context changed' using errcode='PT409';end if;
 old:=public.ezyvet_prescription_review_predecessor(context,r.payload->'interpretation');
 ih:=public.ezyvet_prescription_interpretation_hash(context);
 if old.id is not null and old.interpretation_hash=ih then record_id:=old.id;
 else
  record_id:=p_id;
  insert into public.ezyvet_imported_prescriptions(id,pet_id,client_id,animal_link_id,source_origin,source_site_uid,prescription_external_id,
   version,version_hash,interpretation_hash,context,reason,replaces_id,expected_predecessor_hash,approved_by,approved_at)
  values(p_id,p_pet_id,(context->>'client_id')::uuid,(context->>'animal_link_id')::uuid,context#>>'{source,origin}',context#>>'{source,site_uid}',context#>>'{parent,external_id}',
   coalesce(old.version,0)+1,encode(digest(jsonb_build_array(p_id,context,r.payload,actor,moment,old.id)::text,'sha256'),'hex'),ih,context,
   r.payload#>>'{interpretation,reason}',old.id,old.version_hash,actor,moment);
  insert into public.ezyvet_imported_prescription_items(prescription_id,ordinal,snapshot_id,evidence)
   select p_id,(ordinality-1)::integer,(value#>>'{source,snapshot_id}')::uuid,value from jsonb_array_elements(context->'selected_items') with ordinality;
 end if;
 update public.ezyvet_prescription_review_requests set status='approved',resolved_at=clock_timestamp(),approved_record_id=record_id where id=p_id;
 return public.ezyvet_prescription_review_projection(p_id);
end $function$;

-- approve_ezyvet_vaccination_review(uuid,uuid,text,boolean)
CREATE OR REPLACE FUNCTION public.approve_ezyvet_vaccination_review(p_id uuid, p_pet_id uuid, p_expected_hash text, p_confirmed boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare actor uuid:=public.ezyvet_vaccination_require_dvm();r public.ezyvet_vaccination_review_requests;context jsonb;old public.ezyvet_imported_vaccinations;record_id uuid;moment timestamptz:=clock_timestamp();ih text;begin
 if p_confirmed is distinct from true then raise exception 'Explicit veterinarian confirmation required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,5300));select * into r from public.ezyvet_vaccination_review_requests where id=p_id for update;
 if not found or row(r.actor_id,r.pet_id,r.request_hash) is distinct from row(actor,p_pet_id,p_expected_hash) then raise exception 'Exact owned prepared review required' using errcode='42501';end if;
 if r.status='approved' then return public.ezyvet_vaccination_review_projection(p_id);end if;
 if r.status<>'prepared' then raise exception 'Abandoned review cannot approve' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_pet_id::text,4700));
 context:=public.ezyvet_vaccination_review_context(p_pet_id,r.payload);
 if context is distinct from r.review_context then raise exception 'Prepared review context changed' using errcode='PT409';end if;
 old:=public.ezyvet_vaccination_review_predecessor(context,r.payload);ih:=encode(digest(context::text,'sha256'),'hex');
 if old.id is not null and old.interpretation_hash=ih then record_id:=old.id;
 else
  record_id:=p_id;
  insert into public.ezyvet_imported_vaccinations(id,pet_id,client_id,animal_link_id,source_origin,source_site_uid,animal_external_id,vaccination_external_id,version,version_hash,interpretation_hash,snapshot_id,payload_hash,observed_head_version,original,consult,reviewed,product,reason,replaces_id,expected_predecessor_hash,approved_by,approved_at)
  values(p_id,p_pet_id,(context->>'client_id')::uuid,(context->>'animal_link_id')::uuid,context#>>'{source,origin}',context#>>'{source,site_uid}',context#>>'{source,animal_id}',context#>>'{source,vaccination_id}',coalesce(old.version,0)+1,encode(digest(jsonb_build_array(p_id,context,r.payload,actor,moment,old.id)::text,'sha256'),'hex'),ih,(context->>'snapshot_id')::uuid,context->>'payload_hash',(context->>'observed_head_version')::integer,context->'original',context->'consult',context->'reviewed',nullif(context->'product','null'::jsonb),r.payload->>'reason',old.id,old.version_hash,actor,moment);
 end if;
 update public.ezyvet_vaccination_review_requests set status='approved',resolved_at=clock_timestamp(),approved_record_id=record_id where id=p_id;
 return public.ezyvet_vaccination_review_projection(p_id);
end $function$;

-- approve_ezyvet_weight(uuid,uuid,uuid,text,integer,uuid,integer,text,uuid,numeric,text,date,boolean,text)
CREATE OR REPLACE FUNCTION public.approve_ezyvet_weight(p_request_id uuid, p_actor_id uuid, p_snapshot_id uuid, p_expected_hash text, p_head_version integer, p_animal_link_id uuid, p_patient_version integer, p_action text, p_weight_id uuid, p_weight numeric, p_unit text, p_measured_at date, p_confirmed boolean, p_reason text)
 RETURNS ezyvet_weight_approvals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare actor uuid:=auth.uid();fingerprint text;s public.ezyvet_import_snapshots;h public.ezyvet_identity_heads;link public.ezyvet_record_links;w public.patient_weights;r public.ezyvet_weight_approvals;
begin
 if actor is distinct from p_actor_id or public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator actor required' using errcode='42501';end if;
 if p_request_id is null or p_confirmed is distinct from true or p_action is null or p_action not in ('create','link') or p_reason is null or length(trim(p_reason)) not between 5 and 2000 or p_weight is null or p_weight::text in ('NaN','Infinity','-Infinity') or p_weight<=0 or p_weight>10000 or p_unit is null or p_unit not in ('kg','lb') or p_measured_at is null or not isfinite(p_measured_at) or p_measured_at>(now() at time zone 'America/Denver')::date then raise exception 'Review finite weight, unit, date, identity and reason' using errcode='23514';end if;
 fingerprint:=encode(digest(jsonb_build_array(p_snapshot_id,p_expected_hash,p_head_version,p_animal_link_id,p_patient_version,p_action,p_weight_id,p_weight,p_unit,p_measured_at,p_reason)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('weight-approval:'||p_request_id::text,0));
 select * into r from ezyvet_weight_approvals where request_id=p_request_id;
 if found then if r.approved_by<>actor or r.request_hash<>fingerprint then raise exception 'Approval ID belongs to a different request' using errcode='42501';end if;return r;end if;
 if not exists(select 1 from ezyvet_weight_requests where request_id=p_request_id and actor_id=actor and snapshot_id=p_snapshot_id and status='prepared' and payload=jsonb_build_object('snapshot_id',p_snapshot_id,'expected_hash',p_expected_hash,'head_version',p_head_version,'animal_link_id',p_animal_link_id,'patient_version',p_patient_version,'action',p_action,'weight_id',p_weight_id,'weight',p_weight,'unit',p_unit,'measured_at',p_measured_at,'reason',p_reason)) then raise exception 'Exact prepared weight request required' using errcode='42501';end if;
 select * into strict s from ezyvet_import_snapshots where id=p_snapshot_id and resource='healthstatus';
 if coalesce(s.payload->>'active','') not in ('true','1') then raise exception 'Only an active source observation can create or link a weight' using errcode='23514';end if;
 select * into h from ezyvet_identity_heads where source_origin=s.source_origin and source_site_uid=s.source_site_uid and resource=s.resource and external_id=s.external_id for update;
 if h.snapshot_id is distinct from s.id or h.version is distinct from p_head_version or s.payload_hash is distinct from p_expected_hash then raise exception 'Source changed; review current observation' using errcode='PT409';end if;
 select * into link from ezyvet_record_links where id=p_animal_link_id and resource='animal' and source_origin=s.source_origin and source_site_uid=s.source_site_uid and external_id=s.payload->>'animal_id' for share;
 if not found then raise exception 'Source patient mapping mismatch' using errcode='42501';end if;
 perform 1 from pets where id=link.pet_id and client_id=link.client_id and version=p_patient_version for share;
 if not found then raise exception 'Patient changed; review mapping again' using errcode='PT409';end if;
 if exists(select 1 from ezyvet_weight_approvals where source_origin=s.source_origin and source_site_uid=s.source_site_uid and external_id=s.external_id) then raise exception 'Source already approved; review changes without replacing local history' using errcode='23505';end if;
 if p_action='create' then
  if p_weight_id is not null then raise exception 'New weight cannot specify existing target' using errcode='23514';end if;
  w:=public.record_patient_weight(link.pet_id,p_weight,p_unit,p_measured_at);
 else
  select * into w from patient_weights where id=p_weight_id and pet_id=link.pet_id and weight=p_weight and unit=p_unit and measured_at=p_measured_at for share;
  if not found then raise exception 'Existing weight must match reviewed patient and values exactly' using errcode='23514';end if;
 end if;
 insert into ezyvet_weight_approvals(request_id,request_hash,source_origin,source_site_uid,external_id,snapshot_id,head_version,animal_link_id,pet_id,patient_version,weight_id,action,reviewed_values,reason,approved_by)
 values(p_request_id,fingerprint,s.source_origin,s.source_site_uid,s.external_id,s.id,h.version,link.id,link.pet_id,p_patient_version,w.id,p_action,jsonb_build_object('weight',p_weight,'unit',p_unit,'measured_at',p_measured_at),trim(p_reason),actor) returning * into r;
 update ezyvet_weight_requests set status='completed' where request_id=p_request_id;
 return r;
end $function$;

-- assign_inbound_communication(uuid,uuid,integer,uuid,uuid,text)
CREATE OR REPLACE FUNCTION public.assign_inbound_communication(p_actor_id uuid, p_id uuid, p_expected_version integer, p_client_id uuid, p_conversation_id uuid, p_reason text)
 RETURNS communication_inbound
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid;result public.communication_inbound;message uuid;
begin
 actor:=public.clinical_require_staff();if actor is distinct from p_actor_id then raise exception 'Actor mismatch' using errcode='42501';end if;
 select * into result from public.communication_inbound where id=p_id for update;
 if not found or result.version is distinct from p_expected_version or result.message_id is not null then raise exception 'Inbound review changed; reload' using errcode='PT409';end if;
 if p_reason is null or length(trim(p_reason)) not between 5 and 1000 or not exists(select 1 from public.conversations where id=p_conversation_id and client_id=p_client_id) then raise exception 'Choose a conversation belonging to the selected household and provide a reason' using errcode='23514';end if;
 if result.provider='cloudtalk' then
  insert into public.messages(conversation_id,type,sender_type,content,is_internal,provider,provider_message_id,created_at)
  values(p_conversation_id,result.channel::public.message_type,case when result.direction='inbound' then 'CLIENT' else 'STAFF' end::public.sender_type,result.body,false,'cloudtalk',result.resource_id,result.occurred_at) returning id into message;
 else
  insert into public.messages(conversation_id,type,sender_type,content,is_internal) values(p_conversation_id,result.channel::public.message_type,'CLIENT',result.body,false) returning id into message;
 end if;
 update public.communication_inbound set client_id=p_client_id,conversation_id=p_conversation_id,message_id=message,review_reason=null,version=version+1 where id=p_id returning * into result;
 insert into public.communication_inbound_assignments(inbound_id,client_id,conversation_id,assigned_by,reason) values(p_id,p_client_id,p_conversation_id,actor,p_reason);
 update public.conversations set last_message_at=now(),is_read=false where id=p_conversation_id;
 return result;
end $function$;

-- authorize_website_inquiry_reply(uuid,uuid,integer)
CREATE OR REPLACE FUNCTION public.authorize_website_inquiry_reply(p_actor_id uuid, p_id uuid, p_expected_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid;review public.website_inquiry_triage;household public.clients;conversation public.conversations;
begin
 actor:=public.clinical_require_staff();if actor is distinct from p_actor_id then raise exception 'Actor mismatch' using errcode='42501';end if;
 select * into review from public.website_inquiry_triage where inquiry_id=p_id for update;
 if not found or review.version is distinct from p_expected_version then raise exception 'Inquiry changed; reload before replying' using errcode='PT409';end if;
 select * into household from public.clients where id=review.client_id;
 if review.status<>'in_progress' or review.reviewed_by is null or household.id is null or review.reply_recipient is distinct from public.communication_recipient(review.reply_channel,case when review.reply_channel='EMAIL' then household.primary_email else household.primary_phone end) or public.communication_is_suppressed(review.reply_channel,review.reply_recipient,household.id) then raise exception 'Review the current household destination and channel permission before replying' using errcode='42501';end if;
 conversation:=public.ensure_active_conversation(household.id);
 insert into public.website_inquiry_history(inquiry_id,actor_id,action,reason,after_value) values(p_id,actor,'reply_handoff','Authorized composer handoff; this does not send a message',jsonb_build_object('conversation_id',conversation.id,'client_id',household.id,'channel',review.reply_channel,'recipient',review.reply_recipient,'review_version',review.version));
 return jsonb_build_object('conversation_id',conversation.id,'client_id',household.id,'channel',review.reply_channel,'recipient',review.reply_recipient);
end $function$;

-- bind_ezyvet_migration_child(uuid,uuid,uuid,text,uuid)
CREATE OR REPLACE FUNCTION public.bind_ezyvet_migration_child(p_id uuid, p_scope_id uuid, p_child_run_id uuid, p_reason text, p_replaces_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a uuid:=auth.uid();s public.ezyvet_migration_scopes;r public.ezyvet_migration_runs;c public.ezyvet_import_runs;
 b public.ezyvet_migration_bindings;previous uuid;context jsonb;mapping public.ezyvet_record_links;descriptor jsonb;fidelity text;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_scope_id is null or p_child_run_id is null or p_reason is null or p_reason<>btrim(p_reason) or length(p_reason) not between 1 and 2000 then
  raise exception 'Invalid migration binding' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('ezyvet-migration-binding:'||p_id::text,0));
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into b from public.ezyvet_migration_bindings where id=p_id;
 if found then
  if row(b.actor_id,b.scope_id,b.child_run_id,b.reason,b.replaces_id) is distinct from row(a,p_scope_id,p_child_run_id,p_reason,p_replaces_id) then
   raise exception 'Migration binding identity cannot change' using errcode='42501';end if;
  return public.read_ezyvet_migration_binding(p_id);
 end if;
 -- Serialize only this new ledger's predecessor chain; no child/source claim locks.
 perform pg_advisory_xact_lock(hashtextextended('ezyvet-migration-scope-binding:'||p_scope_id::text,0));
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into s from public.ezyvet_migration_scopes where id=p_scope_id;
 select * into r from public.ezyvet_migration_runs where id=s.migration_run_id and actor_id=a;
 if r.id is null then raise exception 'Owned migration scope required' using errcode='42501';end if;
 if s.disposition<>'required' then raise exception 'Excluded or unsupported scope cannot acquire work' using errcode='23514';end if;
 select x.id into previous from public.ezyvet_migration_bindings x where x.scope_id=s.id
 and not exists(select 1 from public.ezyvet_migration_bindings n where n.replaces_id=x.id);
 if previous is distinct from p_replaces_id then raise exception 'Exact preceding binding required' using errcode='PT409';end if;
 if exists(select 1 from public.ezyvet_migration_bindings where scope_id=s.id and child_run_id=p_child_run_id) then
  raise exception 'Child already bound to this scope; recover its binding' using errcode='23514';end if;
 select * into c from public.ezyvet_import_runs where id=p_child_run_id;
 if c.id is null or row(c.requested_by,c.source_origin,c.source_site_uid,c.resource) is distinct from row(a,r.source_origin,r.source_site_uid,s.resource) then
  raise exception 'Child owner, site or resource mismatch' using errcode='42501';end if;
 select * into mapping from public.ezyvet_record_links where id=s.mapping_id;
 if s.resource in ('contact','animal') then
  -- An unscoped scan is filtered to this identity in reconciliation, never credited wholesale.
  context:=jsonb_build_object('selected_external_id',s.parent_external_id,'selected_snapshot_id',s.parent_snapshot_id,'selected_head_version',s.parent_head_version);
  fidelity:='selected_identity_filter';
 elsif s.resource='healthstatus' then
  select to_jsonb(x) into context from public.ezyvet_weight_runs x where x.run_id=c.id and x.animal_link_id=s.mapping_id;
  fidelity:='mapping_identity_only';
 elsif s.resource in ('consult','history') then
  select to_jsonb(x) into context from public.ezyvet_clinical_runs x where x.run_id=c.id;
  fidelity:='mapping_identity_only';
 elsif s.resource='prescription' then
  select to_jsonb(x) into context from public.ezyvet_prescription_runs x where x.run_id=c.id;
  fidelity:='mapping_identity_only';
 elsif s.resource='vaccination' then
  select to_jsonb(x) into context from public.ezyvet_vaccination_runs x where x.run_id=c.id;
  if row(context->>'consult_snapshot_id',context->>'consult_payload_hash',context->>'consult_observed_head_version',context->>'consult_external_id')
   is distinct from row(s.parent_snapshot_id::text,s.parent_payload_hash,s.parent_head_version::text,s.parent_external_id) then
   raise exception 'Exact child parent version required' using errcode='42501';end if;
  fidelity:='exact_parent_version';
 elsif s.resource='prescriptionitem' then
  select to_jsonb(x) into context from public.ezyvet_prescriptionitem_runs x where x.run_id=c.id;
  if row(context->>'prescription_snapshot_id',context->>'prescription_payload_hash',context->>'prescription_observed_head_version',context->>'prescription_external_id')
   is distinct from row(s.parent_snapshot_id::text,s.parent_payload_hash,s.parent_head_version::text,s.parent_external_id) then
   raise exception 'Exact child parent version required' using errcode='42501';end if;
  fidelity:='exact_parent_version';
 elsif s.resource='attachment' then
  select x.parent_context into context from public.ezyvet_attachment_runs x where x.run_id=c.id and x.actor_id=a and x.animal_link_id=s.mapping_id and x.pet_id=s.pet_id;
  if row(context->>'parent_snapshot_id',context->>'parent_payload_hash',context->>'parent_observed_head_version',context->>'parent_external_id',context->>'parent_type')
   is distinct from row(s.parent_snapshot_id::text,s.parent_payload_hash,s.parent_head_version::text,s.parent_external_id,'Animal'::text) then
   raise exception 'Exact child parent version required' using errcode='42501';end if;
  fidelity:='exact_parent_version';
 end if;
 if context is null then raise exception 'Scoped child evidence required' using errcode='42501';end if;
 if s.resource not in ('contact','animal','healthstatus') then
  if row(context->>'animal_link_id',context->>'pet_id',context->>'client_id',context->>'source_origin',context->>'source_site_uid',context->>'animal_external_id')
   is distinct from row(s.mapping_id::text,s.pet_id::text,s.client_id::text,r.source_origin,r.source_site_uid,mapping.external_id)
   or (s.resource<>'attachment' and row(context->>'actor_id',context->>'resource') is distinct from row(a::text,s.resource)) then
   raise exception 'Child patient or mapping mismatch' using errcode='42501';end if;
 end if;
 descriptor:=jsonb_build_object('version',1,'run_id',c.id,'owner',c.requested_by,'source_origin',c.source_origin,'source_site_uid',c.source_site_uid,
  'resource',c.resource,'parent_evidence',fidelity,'context',context);
 insert into public.ezyvet_migration_bindings(id,scope_id,child_run_id,actor_id,replaces_id,reason,child_context,context_hash)
 values(p_id,s.id,c.id,a,p_replaces_id,p_reason,descriptor,encode(sha256(convert_to(descriptor::text,'UTF8')),'hex'));
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return public.read_ezyvet_migration_binding(p_id);
end $function$;

-- cancel_appointment(uuid,integer)
CREATE OR REPLACE FUNCTION public.cancel_appointment(p_id uuid, p_expected_version integer)
 RETURNS appointments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result public.appointments;
  actor uuid;
begin
  actor := public.appointment_require_staff();

  if p_expected_version is null then
    raise exception 'Expected appointment version is required' using errcode = '23514';
  end if;

  update public.appointments
  set status = 'CANCELLED'::public.appointment_status,
    updated_by = actor
  where id = p_id
    and version = p_expected_version
  returning * into result;

  if not found then
    raise exception 'Appointment changed or no longer exists; reload before cancelling' using errcode = 'PT409';
  end if;

  return result;
end
$function$;

-- cancel_native_prescription(uuid,jsonb)
CREATE OR REPLACE FUNCTION public.cancel_native_prescription(p_id uuid, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r jsonb;preview jsonb;e jsonb;
begin
 r:=public.native_rx_begin(p_id,'cancel',p_request);if r is not null then return r;end if;
 perform public.native_rx_check_change_request(p_request,false);
 preview:=public.preview_native_prescription_cancel((p_request->>'authorization_id')::uuid,(p_request->>'pet_id')::uuid);
 perform public.native_rx_check_change_context(p_request,preview,false);
 e:=public.native_rx_append_event(p_id,p_request,preview);
 if preview#>'{context,prescriber}' is distinct from public.native_rx_require_dvm() then raise exception 'Prescriber configuration changed' using errcode='PT409';end if;
 return public.native_rx_finish(p_id,'cancel',(p_request->>'pet_id')::uuid,p_request,e);
end $function$;

-- cancel_outbound_delivery(uuid,timestamp with time zone,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.cancel_outbound_delivery(p_delivery_id uuid, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_requested_at timestamp with time zone DEFAULT now())
 RETURNS outbound_deliveries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor_id uuid := auth.uid();
  result public.outbound_deliveries;
begin
  if actor_id is null or not public.is_active_staff(actor_id) then
    raise exception 'Active staff access required' using errcode = '42501';
  end if;

  if p_delivery_id is null then
    raise exception 'Delivery id is required' using errcode = '23514';
  end if;

  if p_requested_at is null then
    raise exception 'Cancel timestamp is required' using errcode = '23514';
  end if;

  update public.outbound_deliveries od
  set status = 'CANCELED'::public.outbound_delivery_status,
    status_note = 'Manually canceled by staff',
    last_error_text = null,
    next_attempt_at = greatest(od.next_attempt_at, p_requested_at),
    leased_at = null,
    leased_until = null,
    lease_owner = null,
    canceled_at = p_requested_at
  where od.id = p_delivery_id
    and od.status in (
      'QUEUED'::public.outbound_delivery_status
    )
    and (
      p_expected_updated_at is null
      or od.updated_at = p_expected_updated_at
    )
  returning od.* into result;

  if not found then
    raise exception 'Outbound delivery is not cancelable' using errcode = 'PT409';
  end if;

  if result.appointment_reminder_id is not null then
    update public.appointment_reminders ar
    set status = 'SKIPPED'::public.reminder_status,
      error_message = 'Outbound delivery manually canceled by staff'
    where ar.id = result.appointment_reminder_id;
  end if;

  return result;
end
$function$;

-- capture_payment_reconciliation(uuid,uuid,jsonb)
CREATE OR REPLACE FUNCTION public.capture_payment_reconciliation(p_case_id uuid, p_reviewer_id uuid, p_provider_evidence jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare c public.payment_reconciliation_cases;p public.payment_reconciliation_captures;context jsonb;observed timestamptz;proof text;
begin
 select * into c from public.payment_reconciliation_cases where id=p_case_id and actor_id=p_reviewer_id for update;
 if not found or not public.is_active_staff(p_reviewer_id) or not public.has_role(p_reviewer_id,'ADMIN') then raise exception 'Reconciliation capture unavailable' using errcode='42501';end if;
 select * into p from public.payment_reconciliation_captures where case_id=c.id;
 if found then if p.evidence is distinct from p_provider_evidence then raise exception 'Captured proof is immutable; prepare another review' using errcode='23514';end if;return to_jsonb(p);end if;
 perform 1 from public.billing_invoices where id=c.invoice_id for update;
 if c.snapshot_hash is distinct from public.payment_reconciliation_hash_internal(c.invoice_id) then raise exception 'Reconciliation facts changed' using errcode='PT409';end if;
 context:=public.payment_reconciliation_target_internal(c.invoice_id,c.family,c.request_id,c.provider_object_id)->'context';
 if jsonb_typeof(p_provider_evidence) is distinct from 'object' or octet_length(p_provider_evidence::text)>4096 then raise exception 'Invalid verified proof' using errcode='23514';end if;
 if exists(select 1 from unnest(array['family','request_id','object_id','account_id','amount_cents','currency','provider_observed_at','status']) k where jsonb_typeof(p_provider_evidence->k) is distinct from 'string') or jsonb_typeof(p_provider_evidence->'livemode') is distinct from 'boolean' then raise exception 'Invalid verified proof types' using errcode='23514';end if;
 if row(p_provider_evidence->>'family',p_provider_evidence->>'request_id',p_provider_evidence->>'object_id',p_provider_evidence->>'account_id',p_provider_evidence->'livemode',p_provider_evidence->>'amount_cents',p_provider_evidence->>'currency') is distinct from row(c.family,c.request_id::text,c.provider_object_id,context->>'account_id',context->'livemode',context->>'amount_cents',context->>'currency') then raise exception 'Provider proof does not match immutable request' using errcode='23514';end if;
 observed:=(p_provider_evidence->>'provider_observed_at')::timestamptz;
 if not isfinite(observed) or observed>clock_timestamp() or observed<clock_timestamp()-interval '5 minutes' then raise exception 'Fresh provider proof required' using errcode='23514';end if;
 if c.family='checkout' then
 if (select count(*) from jsonb_object_keys(p_provider_evidence))<>11 or exists(select 1 from jsonb_object_keys(p_provider_evidence) k where k not in ('family','request_id','object_id','account_id','livemode','amount_cents','currency','provider_observed_at','status','payment_id','source_hash')) or p_provider_evidence->>'source_hash' is distinct from context->>'source_hash' or p_provider_evidence->>'status' not in ('session_open','session_expired','payment_succeeded') or jsonb_typeof(p_provider_evidence->'payment_id') not in ('null','string') then raise exception 'Invalid matching Checkout proof' using errcode='23514';end if;
 if (p_provider_evidence->>'status'='session_open' and exists(select 1 from public.invoice_payment_evidence where request_id=c.request_id and disposition='accepted' and kind='session_expired')) or
 (p_provider_evidence->>'status'<>'payment_succeeded' and exists(select 1 from public.invoice_payments where request_id=c.request_id)) then raise exception 'Provider proof conflicts with terminal financial evidence' using errcode='23514';end if;
 if p_provider_evidence->>'status'='payment_succeeded' and coalesce(p_provider_evidence->>'payment_id','') !~ '^pi_[A-Za-z0-9]+$' then raise exception 'Verified payment identifier required' using errcode='23514';end if;
 else
 if (select count(*) from jsonb_object_keys(p_provider_evidence))<>10 or exists(select 1 from jsonb_object_keys(p_provider_evidence) k where k not in ('family','request_id','object_id','account_id','livemode','amount_cents','currency','provider_observed_at','status','provider_payment_id')) or p_provider_evidence->>'provider_payment_id' is distinct from context->>'provider_payment_id' or p_provider_evidence->>'status' not in ('pending','failed','succeeded') then raise exception 'Invalid matching refund proof' using errcode='23514';end if;
 if p_provider_evidence->>'status'<>'succeeded' and exists(select 1 from public.invoice_refunds where request_id=c.request_id) then raise exception 'Provider proof conflicts with terminal financial evidence' using errcode='23514';end if;
 end if;
 proof:=encode(digest(jsonb_build_object('case_id',c.id,'snapshot_hash',c.snapshot_hash,'blockers',c.blocker_refs,'evidence',p_provider_evidence)::text,'sha256'),'hex');
 insert into public.payment_reconciliation_captures(case_id,evidence,proof_hash,provider_observed_at) values(c.id,p_provider_evidence,proof,observed) returning * into p;
 return to_jsonb(p);
end $function$;

-- claim_abandoned_attachment_cleanup(uuid,integer)
CREATE OR REPLACE FUNCTION public.claim_abandoned_attachment_cleanup(p_upload_id uuid, p_grace_hours integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare upload public.conversation_attachment_uploads;receipt public.abandoned_attachment_cleanup;object_row storage.objects;
begin
 perform public.communication_require_service();
 if p_grace_hours is null or p_grace_hours not between 24 and 720 then
  raise exception 'Explicit cleanup grace from 24 to 720 hours required' using errcode='23514';end if;
 select * into upload from public.conversation_attachment_uploads where id=p_upload_id for update;
 if not found or upload.status<>'abandoned' then raise exception 'Only abandoned uploads may be cleaned' using errcode='42501';end if;
 -- Defense in depth: no abandoned object may have entered a prepared message manifest.
 if exists(select 1 from public.conversation_email_artifacts a cross join lateral jsonb_array_elements(a.manifest) f where f->>'upload_id'=upload.id::text) then
  raise exception 'Referenced attachment evidence must be retained' using errcode='42501';end if;
 select * into object_row from storage.objects where bucket_id='conversation-attachment-uploads' and name=upload.storage_path for share;
 select * into receipt from public.abandoned_attachment_cleanup where upload_id=upload.id and state='claimed' order by created_at limit 1 for update;
 if receipt.id is not null then
  if object_row.id is not null and row(object_row.id,object_row.created_at) is distinct from row(receipt.object_id,receipt.object_created_at) then
   raise exception 'Cleanup object identity changed' using errcode='42501';end if;
  if receipt.expires_at>clock_timestamp() then raise exception 'Cleanup already in progress' using errcode='PT409';end if;
  update public.abandoned_attachment_cleanup set token=gen_random_uuid(),expires_at=clock_timestamp()+interval '2 minutes'
   where id=receipt.id returning * into receipt;
 else
  if object_row.id is null then return null;end if;
  if object_row.created_at>clock_timestamp()-make_interval(hours=>p_grace_hours)
   or upload.created_at>clock_timestamp()-make_interval(hours=>p_grace_hours) then return null;end if;
  if exists(select 1 from public.abandoned_attachment_cleanup where upload_id=upload.id and object_id=object_row.id) then
   raise exception 'Completed cleanup object unexpectedly exists' using errcode='23514';end if;
  insert into public.abandoned_attachment_cleanup(upload_id,object_id,object_created_at,storage_path,grace_hours,state,token,expires_at)
   values(upload.id,object_row.id,object_row.created_at,upload.storage_path,p_grace_hours,'claimed',gen_random_uuid(),clock_timestamp()+interval '2 minutes') returning * into receipt;
 end if;
 return public.abandoned_cleanup_lease(receipt,upload);
end $function$;

-- claim_ezyvet_attachment_import(uuid,uuid,text,text,uuid)
CREATE OR REPLACE FUNCTION public.claim_ezyvet_attachment_import(p_id uuid, p_actor uuid, p_site_uid text, p_source_origin text, p_animal_link_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c public.ezyvet_attachment_runs;r public.ezyvet_import_runs;context jsonb;
begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_animal_link_id is null or p_source_origin is null or p_site_uid is null then raise exception 'Exact attachment operation required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('attachment-run:'||p_id::text,0));
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into c from public.ezyvet_attachment_runs where run_id=p_id;select * into r from public.ezyvet_import_runs where id=p_id;
 if c.run_id is not null then
  if row(c.actor_id,c.animal_link_id,r.requested_by,r.resource,r.source_origin,r.source_site_uid) is distinct from row(p_actor,p_animal_link_id,p_actor,'attachment'::text,p_source_origin,p_site_uid) then raise exception 'Attachment operation identity changed' using errcode='42501';end if;
  if r.status<>'running' then if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return to_jsonb(r)||jsonb_build_object('scope','animal_attachment_metadata','parent_context',c.parent_context,'animal_link_id',c.animal_link_id,'animal_external_id',c.parent_context->'animal_external_id','pet_id',c.pet_id,'client_id',c.parent_context->'client_id');end if;
 elsif r.id is not null then raise exception 'ATTACHMENT_RUN_REQUIRES_NEW_CONTEXT' using errcode='22023';end if;
 context:=public.ezyvet_attachment_parent_context(p_animal_link_id,p_source_origin,p_site_uid);
 if c.run_id is not null and c.parent_context is distinct from context then raise exception 'SOURCE_ATTACHMENT_PARENT_STALE' using errcode='PT409';end if;
 perform public.ezyvet_attachment_original_source_gate(p_source_origin,p_site_uid,null);
 r:=public.claim_ezyvet_import_core(p_id,p_actor,p_site_uid,'attachment',p_source_origin);
 if r.lease_until<=clock_timestamp() then raise exception 'Attachment lease expired during claim' using errcode='PT409';end if;
 insert into public.ezyvet_attachment_runs(run_id,actor_id,animal_link_id,pet_id,parent_context) values(p_id,p_actor,p_animal_link_id,(context->>'pet_id')::uuid,context) on conflict(run_id) do nothing;
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return to_jsonb(r)||jsonb_build_object('scope','animal_attachment_metadata','parent_context',context,'animal_link_id',p_animal_link_id,'animal_external_id',context->'animal_external_id','pet_id',context->'pet_id','client_id',context->'client_id');
end $function$;

-- claim_ezyvet_clinical_import(uuid,uuid,text,text,text,uuid)
CREATE OR REPLACE FUNCTION public.claim_ezyvet_clinical_import(p_id uuid, p_actor uuid, p_site_uid text, p_resource text, p_source_origin text, p_animal_link_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare m public.ezyvet_record_links;c public.ezyvet_clinical_runs;r public.ezyvet_import_runs;
begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_resource is null or p_resource not in ('consult','history') then raise exception 'Supported clinical resource required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('clinical-run:'||p_id::text,0));
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into c from public.ezyvet_clinical_runs where run_id=p_id;
 if found then
  if row(c.actor_id,c.animal_link_id,c.source_origin,c.source_site_uid,c.resource) is distinct from row(p_actor,p_animal_link_id,p_source_origin,p_site_uid,p_resource) then raise exception 'Clinical import identity cannot change' using errcode='42501';end if;
 elsif exists(select 1 from public.ezyvet_import_runs where id=p_id) then
  raise exception 'CLINICAL_RUN_REQUIRES_NEW_MAPPING' using errcode='22023';
 end if;
 select * into r from public.ezyvet_import_runs where id=p_id;
 if c.run_id is not null and r.status<>'running' then
  if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return to_jsonb(r)||jsonb_build_object('animal_link_id',c.animal_link_id,'animal_external_id',c.animal_external_id,'pet_id',c.pet_id,'client_id',c.client_id);
 end if;
 select * into m from public.ezyvet_record_links where id=p_animal_link_id and resource='animal' and source_origin=p_source_origin and source_site_uid=p_site_uid for share;
 if not found or m.external_id !~ '^[0-9]+$' then raise exception 'Reviewed patient mapping required for this source site' using errcode='42501';end if;
 if c.run_id is not null and row(c.pet_id,c.client_id,c.animal_external_id) is distinct from row(m.pet_id,m.client_id,m.external_id) then raise exception 'Clinical patient mapping changed' using errcode='PT409';end if;
 -- Terminal exact runs recover without revalidating mutable household membership.
 select * into r from public.ezyvet_import_runs where id=p_id;
 if r.id is null or r.status='running' then
  perform 1 from public.pets where id=m.pet_id and client_id=m.client_id for share;
  if not found then raise exception 'Patient mapping changed; review before importing' using errcode='PT409';end if;
 end if;
 r:=public.claim_ezyvet_import_core(p_id,p_actor,p_site_uid,p_resource,p_source_origin);
 insert into public.ezyvet_clinical_runs(run_id,animal_link_id,actor_id,pet_id,client_id,source_origin,source_site_uid,resource,animal_external_id)
 values(p_id,m.id,p_actor,m.pet_id,m.client_id,p_source_origin,p_site_uid,p_resource,m.external_id) on conflict(run_id) do nothing;
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return to_jsonb(r)||jsonb_build_object('animal_link_id',m.id,'animal_external_id',m.external_id,'pet_id',m.pet_id,'client_id',m.client_id);
end $function$;

-- claim_ezyvet_prescription_import(uuid,uuid,text,text,text,uuid)
CREATE OR REPLACE FUNCTION public.claim_ezyvet_prescription_import(p_id uuid, p_actor uuid, p_site_uid text, p_resource text, p_source_origin text, p_animal_link_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare m public.ezyvet_record_links;c public.ezyvet_prescription_runs;r public.ezyvet_import_runs;
begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_resource is null or p_resource not in ('prescription') then raise exception 'Supported prescription resource required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('prescription-run:'||p_id::text,0));
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into c from public.ezyvet_prescription_runs where run_id=p_id;
 if found then
  if row(c.actor_id,c.animal_link_id,c.source_origin,c.source_site_uid,c.resource) is distinct from row(p_actor,p_animal_link_id,p_source_origin,p_site_uid,p_resource) then raise exception 'Prescription import identity cannot change' using errcode='42501';end if;
 elsif exists(select 1 from public.ezyvet_import_runs where id=p_id) then
  raise exception 'PRESCRIPTION_RUN_REQUIRES_NEW_MAPPING' using errcode='22023';
 end if;
 select * into r from public.ezyvet_import_runs where id=p_id;
 if c.run_id is not null and r.status<>'running' then
  if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return to_jsonb(r)||jsonb_build_object('animal_link_id',c.animal_link_id,'animal_external_id',c.animal_external_id,'pet_id',c.pet_id,'client_id',c.client_id);
 end if;
 select * into m from public.ezyvet_record_links where id=p_animal_link_id and resource='animal' and source_origin=p_source_origin and source_site_uid=p_site_uid for share;
 if not found or m.external_id !~ '^[0-9]+$' then raise exception 'Reviewed patient mapping required for this source site' using errcode='42501';end if;
 if c.run_id is not null and row(c.pet_id,c.client_id,c.animal_external_id) is distinct from row(m.pet_id,m.client_id,m.external_id) then raise exception 'Prescription patient mapping changed' using errcode='PT409';end if;
 -- Terminal exact runs recover without revalidating mutable household membership.
 select * into r from public.ezyvet_import_runs where id=p_id;
 if r.id is null or r.status='running' then
  perform 1 from public.pets where id=m.pet_id and client_id=m.client_id for share;
  if not found then raise exception 'Patient mapping changed; review before importing' using errcode='PT409';end if;
 end if;
 r:=public.claim_ezyvet_import_core(p_id,p_actor,p_site_uid,p_resource,p_source_origin);
 insert into public.ezyvet_prescription_runs(run_id,animal_link_id,actor_id,pet_id,client_id,source_origin,source_site_uid,resource,animal_external_id)
 values(p_id,m.id,p_actor,m.pet_id,m.client_id,p_source_origin,p_site_uid,p_resource,m.external_id) on conflict(run_id) do nothing;
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return to_jsonb(r)||jsonb_build_object('animal_link_id',m.id,'animal_external_id',m.external_id,'pet_id',m.pet_id,'client_id',m.client_id);
end $function$;

-- claim_ezyvet_prescriptionitem_import(uuid,uuid,text,text,text,uuid,uuid,text,integer)
CREATE OR REPLACE FUNCTION public.claim_ezyvet_prescriptionitem_import(p_id uuid, p_actor uuid, p_site_uid text, p_resource text, p_source_origin text, p_animal_link_id uuid, p_prescription_snapshot_id uuid, p_prescription_payload_hash text, p_prescription_observed_head_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare m public.ezyvet_record_links;c public.ezyvet_prescriptionitem_runs;r public.ezyvet_import_runs;s public.ezyvet_import_snapshots;
begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_prescription_snapshot_id is null or p_prescription_payload_hash is null or p_prescription_payload_hash !~ '^[a-f0-9]{64}$' or p_prescription_observed_head_version is null or p_prescription_observed_head_version<1 or p_resource is null or p_resource not in ('prescriptionitem') then raise exception 'Supported prescriptionitem resource required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('prescriptionitem-run:'||p_id::text,0));
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into c from public.ezyvet_prescriptionitem_runs where run_id=p_id;
 if found then
  if row(c.actor_id,c.animal_link_id,c.source_origin,c.source_site_uid,c.resource,c.prescription_snapshot_id,c.prescription_payload_hash,c.prescription_observed_head_version) is distinct from row(p_actor,p_animal_link_id,p_source_origin,p_site_uid,p_resource,p_prescription_snapshot_id,p_prescription_payload_hash,p_prescription_observed_head_version) then raise exception 'Prescription item import identity cannot change' using errcode='42501';end if;
 elsif exists(select 1 from public.ezyvet_import_runs where id=p_id) then
  raise exception 'PRESCRIPTIONITEM_RUN_REQUIRES_NEW_CONTEXT' using errcode='22023';
 end if;
 select * into r from public.ezyvet_import_runs where id=p_id;
 if c.run_id is not null and r.status<>'running' then
  if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return to_jsonb(r)||jsonb_build_object('animal_link_id',c.animal_link_id,'animal_external_id',c.animal_external_id,'pet_id',c.pet_id,'client_id',c.client_id,'prescription_snapshot_id',c.prescription_snapshot_id,'prescription_payload_hash',c.prescription_payload_hash,'prescription_observed_head_version',c.prescription_observed_head_version,'prescription_external_id',c.prescription_external_id);
 end if;
 select * into m from public.ezyvet_record_links where id=p_animal_link_id and resource='animal' and source_origin=p_source_origin and source_site_uid=p_site_uid for share;
 if not found or m.external_id !~ '^[0-9]+$' then raise exception 'Reviewed patient mapping required for this source site' using errcode='42501';end if;
 if c.run_id is not null and row(c.pet_id,c.client_id,c.animal_external_id) is distinct from row(m.pet_id,m.client_id,m.external_id) then raise exception 'Prescription item patient mapping changed' using errcode='PT409';end if;
 -- Terminal exact runs recover without revalidating mutable household membership.
 select * into r from public.ezyvet_import_runs where id=p_id;
 if r.id is null or r.status='running' then
  perform 1 from public.pets where id=m.pet_id and client_id=m.client_id for share;
  if not found then raise exception 'Patient mapping changed; review before importing' using errcode='PT409';end if;
 end if;
 s:=public.ezyvet_validate_prescriptionitem_prescription(p_animal_link_id,p_source_origin,p_site_uid,p_prescription_snapshot_id,p_prescription_payload_hash,p_prescription_observed_head_version);
 r:=public.claim_ezyvet_import_core(p_id,p_actor,p_site_uid,p_resource,p_source_origin);
 insert into public.ezyvet_prescriptionitem_runs(run_id,animal_link_id,actor_id,pet_id,client_id,source_origin,source_site_uid,resource,animal_external_id,prescription_snapshot_id,prescription_payload_hash,prescription_observed_head_version,prescription_external_id)
 values(p_id,m.id,p_actor,m.pet_id,m.client_id,p_source_origin,p_site_uid,p_resource,m.external_id,s.id,s.payload_hash,p_prescription_observed_head_version,s.external_id) on conflict(run_id) do nothing;
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return to_jsonb(r)||jsonb_build_object('animal_link_id',m.id,'animal_external_id',m.external_id,'pet_id',m.pet_id,'client_id',m.client_id,'prescription_snapshot_id',s.id,'prescription_payload_hash',s.payload_hash,'prescription_observed_head_version',p_prescription_observed_head_version,'prescription_external_id',s.external_id);
end $function$;

-- claim_ezyvet_vaccination_import(uuid,uuid,text,text,text,uuid,uuid,text,integer)
CREATE OR REPLACE FUNCTION public.claim_ezyvet_vaccination_import(p_id uuid, p_actor uuid, p_site_uid text, p_resource text, p_source_origin text, p_animal_link_id uuid, p_consult_snapshot_id uuid, p_consult_payload_hash text, p_consult_observed_head_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare m public.ezyvet_record_links;c public.ezyvet_vaccination_runs;r public.ezyvet_import_runs;s public.ezyvet_import_snapshots;
begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_consult_snapshot_id is null or p_consult_payload_hash is null or p_consult_payload_hash !~ '^[a-f0-9]{64}$' or p_consult_observed_head_version is null or p_consult_observed_head_version<1 or p_resource is null or p_resource not in ('vaccination') then raise exception 'Supported vaccination resource required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('vaccination-run:'||p_id::text,0));
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into c from public.ezyvet_vaccination_runs where run_id=p_id;
 if found then
  if row(c.actor_id,c.animal_link_id,c.source_origin,c.source_site_uid,c.resource,c.consult_snapshot_id,c.consult_payload_hash,c.consult_observed_head_version) is distinct from row(p_actor,p_animal_link_id,p_source_origin,p_site_uid,p_resource,p_consult_snapshot_id,p_consult_payload_hash,p_consult_observed_head_version) then raise exception 'Vaccination import identity cannot change' using errcode='42501';end if;
 elsif exists(select 1 from public.ezyvet_import_runs where id=p_id) then
  raise exception 'VACCINATION_RUN_REQUIRES_NEW_CONTEXT' using errcode='22023';
 end if;
 select * into r from public.ezyvet_import_runs where id=p_id;
 if c.run_id is not null and r.status<>'running' then
  if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return to_jsonb(r)||jsonb_build_object('animal_link_id',c.animal_link_id,'animal_external_id',c.animal_external_id,'pet_id',c.pet_id,'client_id',c.client_id,'consult_snapshot_id',c.consult_snapshot_id,'consult_payload_hash',c.consult_payload_hash,'consult_observed_head_version',c.consult_observed_head_version,'consult_external_id',c.consult_external_id);
 end if;
 select * into m from public.ezyvet_record_links where id=p_animal_link_id and resource='animal' and source_origin=p_source_origin and source_site_uid=p_site_uid for share;
 if not found or m.external_id !~ '^[0-9]+$' then raise exception 'Reviewed patient mapping required for this source site' using errcode='42501';end if;
 if c.run_id is not null and row(c.pet_id,c.client_id,c.animal_external_id) is distinct from row(m.pet_id,m.client_id,m.external_id) then raise exception 'Vaccination patient mapping changed' using errcode='PT409';end if;
 -- Terminal exact runs recover without revalidating mutable household membership.
 select * into r from public.ezyvet_import_runs where id=p_id;
 if r.id is null or r.status='running' then
  perform 1 from public.pets where id=m.pet_id and client_id=m.client_id for share;
  if not found then raise exception 'Patient mapping changed; review before importing' using errcode='PT409';end if;
 end if;
 s:=public.ezyvet_validate_vaccination_consult(p_animal_link_id,p_source_origin,p_site_uid,p_consult_snapshot_id,p_consult_payload_hash,p_consult_observed_head_version);
 r:=public.claim_ezyvet_import_core(p_id,p_actor,p_site_uid,p_resource,p_source_origin);
 insert into public.ezyvet_vaccination_runs(run_id,animal_link_id,actor_id,pet_id,client_id,source_origin,source_site_uid,resource,animal_external_id,consult_snapshot_id,consult_payload_hash,consult_observed_head_version,consult_external_id)
 values(p_id,m.id,p_actor,m.pet_id,m.client_id,p_source_origin,p_site_uid,p_resource,m.external_id,s.id,s.payload_hash,p_consult_observed_head_version,s.external_id) on conflict(run_id) do nothing;
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return to_jsonb(r)||jsonb_build_object('animal_link_id',m.id,'animal_external_id',m.external_id,'pet_id',m.pet_id,'client_id',m.client_id,'consult_snapshot_id',s.id,'consult_payload_hash',s.payload_hash,'consult_observed_head_version',p_consult_observed_head_version,'consult_external_id',s.external_id);
end $function$;

-- claim_inbound_attachment(uuid,uuid,integer,uuid)
CREATE OR REPLACE FUNCTION public.claim_inbound_attachment(p_inbound_id uuid, p_attachment_id uuid, p_version integer, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare incoming public.communication_inbound;capture public.inbound_attachment_captures;meta jsonb;matches integer;token uuid:=gen_random_uuid();receipt jsonb;
begin
 perform public.communication_require_service();
 if p_attachment_id is null or public.is_active_staff(p_actor_id) is not true then raise exception 'Active staff required' using errcode='42501';end if;
 select * into incoming from public.communication_inbound where id=p_inbound_id for update;
 if not found or incoming.version is distinct from p_version or incoming.provider not in ('resend','agentmail') or incoming.channel<>'EMAIL'
  or incoming.message_id is null or incoming.conversation_id is null or incoming.client_id is null
  or not exists(select 1 from public.messages m join public.conversations c on c.id=m.conversation_id where m.id=incoming.message_id
    and m.conversation_id=incoming.conversation_id and c.client_id=incoming.client_id and m.sender_type='CLIENT' and m.type='EMAIL' and not m.is_internal)
  or public.is_active_staff(p_actor_id) is not true then
  raise exception 'Reviewed inbound message changed or is unavailable' using errcode='42501';end if;
 if incoming.provider='agentmail' then
  select e.metadata into receipt from public.communication_provider_events e
   where e.id=incoming.event_id and e.provider='agentmail' and e.resource_id=incoming.resource_id and e.event_type='inbound';
  if receipt is null or jsonb_typeof(receipt->'message_id') is distinct from 'string' or jsonb_typeof(receipt->'inbox_id') is distinct from 'string' then
   raise exception 'Reviewed inbound message changed or is unavailable' using errcode='42501';end if;
 end if;
 select count(*),jsonb_agg(value)->0 into matches,meta from jsonb_array_elements(incoming.attachment_metadata) where value->>'id'=p_attachment_id::text;
 if matches<>1 or jsonb_typeof(meta->'size') is distinct from 'number' or (meta->>'size')::numeric not between 1 and 10485760
  or (meta->>'size')::numeric<>trunc((meta->>'size')::numeric)
  or jsonb_typeof(meta->'content_type') is distinct from 'string'
  or meta->'filename' is null or jsonb_typeof(meta->'filename') not in ('null','string')
  or (jsonb_typeof(meta->'filename')='string' and (length(trim(meta->>'filename')) not between 1 and 255 or meta->>'filename' ~ '[[:cntrl:]]'))
  or meta->>'content_type' not in ('application/pdf','image/png','image/jpeg') then
  raise exception 'Supported exact incoming attachment required' using errcode='23514';end if;
 meta:=jsonb_build_object('id',meta->>'id','filename',meta->'filename','content_type',meta->>'content_type','size',meta->'size');
 select * into capture from public.inbound_attachment_captures where inbound_id=p_inbound_id and attachment_id=p_attachment_id for update;
 if found then
  if row(capture.message_id,capture.inbound_version,capture.email_id,capture.metadata) is distinct from row(incoming.message_id,incoming.version,incoming.resource_id::uuid,meta) then
   raise exception 'Saved incoming capture identity changed' using errcode='42501';end if;
  if capture.status='ready' then return jsonb_build_object('ready',public.inbound_capture_receipt(capture),'lease',null);end if;
  if capture.lease_expires_at>clock_timestamp() then raise exception 'Incoming capture already in progress' using errcode='PT409';end if;
  update public.inbound_attachment_captures set actor_id=p_actor_id,lease_token=token,lease_expires_at=clock_timestamp()+interval '2 minutes',
   storage_path=p_inbound_id::text||'/'||p_attachment_id::text||'/'||token::text||'/original' where id=capture.id returning * into capture;
 else
  insert into public.inbound_attachment_captures(inbound_id,attachment_id,message_id,inbound_version,email_id,metadata,actor_id,status,lease_token,lease_expires_at,storage_path)
  values(p_inbound_id,p_attachment_id,incoming.message_id,incoming.version,incoming.resource_id::uuid,meta,p_actor_id,'capturing',token,clock_timestamp()+interval '2 minutes',
   p_inbound_id::text||'/'||p_attachment_id::text||'/'||token::text||'/original') returning * into capture;
 end if;
 return jsonb_build_object('ready',null,'lease',jsonb_build_object('id',capture.id,'inbound_id',capture.inbound_id,'attachment_id',capture.attachment_id,
 'message_id',capture.message_id,'inbound_version',capture.inbound_version,'actor_id',capture.actor_id,'email_id',capture.email_id,'token',capture.lease_token,'storage_path',capture.storage_path,'metadata',capture.metadata,
 'provider',incoming.provider,'provider_message_id',receipt->>'message_id','provider_inbox_id',receipt->>'inbox_id'));
end $function$;

-- close_native_fill_slot(uuid,jsonb)
CREATE OR REPLACE FUNCTION public.close_native_fill_slot(p_id uuid, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid:=public.clinical_require_staff();r jsonb;preview jsonb;c jsonb;d jsonb;aid uuid;petid uuid;idx integer;ev integer;s public.native_fill_slots;stamp timestamptz;
begin
 r:=public.native_fulfillment_begin(p_id,'close_slot',p_request);if r is not null then return r;end if;
 perform public.native_rx_keys(p_request,array['authorization_id','pet_id','slot_index','expected_slot_version','expected_context_hash','reason','attest_forfeit']);
 aid:=public.native_rx_uuid(p_request->'authorization_id');petid:=public.native_rx_uuid(p_request->'pet_id');idx:=public.native_fulfillment_index(p_request->'slot_index');ev:=public.native_rx_revision(p_request->'expected_slot_version');perform public.native_rx_text(p_request->'reason',2000);
 if ev is null or p_request->'attest_forfeit' is distinct from 'true'::jsonb then raise exception 'Explicit slot forfeiture review required' using errcode='23514';end if;
 preview:=public.preview_native_slot_close(aid,petid,idx);c:=preview->'context';if ev<>(c#>>'{slot,version}')::integer then raise exception 'Fill slot changed' using errcode='PT409';end if;
 perform public.native_fulfillment_review_hash(p_request->'expected_context_hash',preview->>'context_hash');stamp:=clock_timestamp();
 update public.native_fill_slots set version=version+1,remaining_quantity=0,state='closed',closure_kind='forfeited',closed_by=actor,closed_at=stamp,close_reason=p_request->>'reason' where id=(c#>>'{slot,id}')::uuid returning * into s;
 d:=jsonb_build_object('version',1,'id',p_id,'authorization_id',aid,'pet_id',petid,'slot_id',s.id,'actor_id',actor,'reason',p_request->>'reason','forfeited_quantity',c#>'{slot,remaining_quantity}','before',c->'slot','after',public.native_fulfillment_slot(s),'reviewed_context',c,'reviewed_context_hash',preview->>'context_hash','created_at',stamp);
 insert into public.native_slot_closures values(p_id,aid,petid,s.id,actor,stamp,d);
 insert into public.native_fulfillment_events values(p_id,aid,(c#>>'{usage,fulfillment_head,version}')::integer+1,'close_slot',d);
 return public.native_fulfillment_finish(p_id,'close_slot',p_request,d);
end $function$;

-- complete_communication_status(uuid,uuid)
CREATE OR REPLACE FUNCTION public.complete_communication_status(p_event_id uuid, p_lease_token uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare event public.communication_provider_events; outbound public.communication_outbox;
begin
 perform public.communication_require_service();select * into event from public.communication_provider_events where id=p_event_id for update;
 if not found or event.state<>'claimed' or event.lease_token is distinct from p_lease_token or event.lease_expires_at is null or event.lease_expires_at<=clock_timestamp() or event.event_type='inbound' then raise exception 'Provider event lease unavailable' using errcode='PT409';end if;
 select * into outbound from public.communication_outbox where provider=event.provider and provider_message_id=event.resource_id for update;
 if not found then raise exception 'Provider receipt not correlated' using errcode='23503';end if;
 if event.event_type='delivered' then perform public.record_communication_delivery(event.provider,event.event_id,event.resource_id,'delivered');
 elsif event.event_type in ('failed','undelivered','bounced','complained') then
  perform public.record_communication_delivery(event.provider,event.event_id,event.resource_id,'failed');
  if event.event_type in ('bounced','complained') then
   insert into public.communication_suppressions(channel,recipient,reason) values(outbound.channel,outbound.recipient,'provider_'||event.event_type) on conflict on constraint communication_suppressions_pkey do nothing;
   update public.communication_outbox set delivery_failure_kind=case when delivery_failure_kind='complained' then 'complained' else event.event_type end where id=outbound.id;
   update public.communication_outbox set state='failed',last_error='recipient_suppressed' where channel=outbound.channel and recipient=outbound.recipient and state='pending';
  end if;
 end if;
 update public.communication_provider_events set state='processed',lease_token=null,lease_expires_at=null where id=event.id;
end $function$;

-- complete_inbound_communication(uuid,uuid,text,text,text,text,text,text,text[],jsonb,timestamp with time zone,text)
CREATE OR REPLACE FUNCTION public.complete_inbound_communication(p_event_id uuid, p_lease_token uuid, p_sender text, p_recipient text, p_subject text, p_body text, p_html text, p_rfc_message_id text, p_reply_ids text[], p_attachments jsonb, p_occurred_at timestamp with time zone, p_opt_action text DEFAULT NULL::text)
 RETURNS communication_inbound
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare event public.communication_provider_events; result public.communication_inbound; channel text; sender text;recipient text;client uuid;conversation uuid;matches integer;message uuid;preference public.communication_phone_preferences;consent_watermark timestamptz;
begin
 perform public.communication_require_service();
 select * into event from public.communication_provider_events where id=p_event_id for update;
 if not found or event.state<>'claimed' or event.lease_token is distinct from p_lease_token or event.lease_expires_at is null or event.lease_expires_at<=clock_timestamp() or event.event_type<>'inbound' then raise exception 'Provider event lease unavailable' using errcode='PT409';end if;
 channel:=case when event.provider in ('resend','agentmail') then 'EMAIL' else 'SMS' end;
 sender:=public.communication_recipient(channel,p_sender);recipient:=public.communication_recipient(channel,p_recipient);
 if sender is null or recipient is null or p_body is null or length(p_body)>100000 or length(p_html)>500000 or length(p_subject)>500 or p_occurred_at is null or not isfinite(p_occurred_at) or p_occurred_at>now()+interval '5 minutes' or p_reply_ids is null or cardinality(p_reply_ids)>50 or p_attachments is null or jsonb_typeof(p_attachments)<>'array' or jsonb_array_length(p_attachments)>100 then raise exception 'Invalid inbound content' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(channel||':'||sender,936));
 select * into result from public.communication_inbound where provider=event.provider and resource_id=event.resource_id;
 if found then update public.communication_provider_events set state='processed',lease_token=null,lease_expires_at=null where id=event.id;return result;end if;
 -- Exact normalized household match only. Shared addresses stay in review; no pet is inferred.
 select count(*),(array_agg(c.id))[1] into matches,client from public.clients c where public.communication_recipient(channel,case when channel='EMAIL' then c.primary_email else c.primary_phone end)=sender;
 if matches<>1 then client:=null;end if;
 if client is not null then
  select count(distinct i.conversation_id),(array_agg(i.conversation_id))[1] into matches,conversation from public.communication_inbound i where i.rfc_message_id=any(p_reply_ids) and i.client_id=client and i.conversation_id is not null;
  if matches>1 then conversation:=null;
  elsif matches=0 then
   select count(*),(array_agg(c.id))[1] into matches,conversation from public.conversations c where c.client_id=client and c.status='ACTIVE';
   if matches>1 then conversation:=null;
   elsif matches=0 then insert into public.conversations(client_id) values(client) returning id into conversation;
   end if;
  end if;
 end if;
 if conversation is not null then
  insert into public.messages(conversation_id,type,sender_type,content,is_internal) values(conversation,channel::public.message_type,'CLIENT',p_body,false) returning id into message;
  update public.conversations set last_message_at=now(),is_read=false where id=conversation;
 end if;
 insert into public.communication_inbound(provider,resource_id,event_id,channel,sender,recipient,subject,body,html_body,rfc_message_id,reply_ids,attachment_metadata,occurred_at,client_id,conversation_id,message_id,review_reason)
 values(event.provider,event.resource_id,event.id,channel,sender,recipient,coalesce(p_subject,''),p_body,p_html,p_rfc_message_id,p_reply_ids,p_attachments,p_occurred_at,client,conversation,message,case when client is null then 'Unknown or shared sender' when conversation is null then 'Multiple possible conversation threads' end) returning * into result;
 -- Provider-fetched occurrence time makes older STOP/START deliveries unable to reverse newer consent.
 if channel='SMS' and p_opt_action in ('STOP','START') then
  select * into preference from public.communication_phone_preferences where phone=sender for update;
  -- Legacy/manual consent timestamps are also authoritative: an older START must
  -- not erase a later staff-recorded opt-out which predates this provider table.
  select max(greatest(opted_in_at,opted_out_at)) into consent_watermark from public.sms_consent where public.communication_recipient('SMS',phone_number)=sender;
  if (preference.phone is null or p_occurred_at>preference.occurred_at or (p_occurred_at=preference.occurred_at and p_opt_action='STOP'))
   and (consent_watermark is null or p_occurred_at>consent_watermark or (p_occurred_at=consent_watermark and p_opt_action='STOP')) then
   insert into public.communication_phone_preferences(phone,opted_in,occurred_at,resource_id,event_id) values(sender,p_opt_action='START',p_occurred_at,event.resource_id,event.id)
   on conflict(phone) do update set opted_in=excluded.opted_in,occurred_at=excluded.occurred_at,resource_id=excluded.resource_id,event_id=excluded.event_id,updated_at=now();
   if p_opt_action='STOP' then
    insert into public.communication_suppressions(channel,recipient,reason) values('SMS',sender,'provider_sms_stop') on conflict on constraint communication_suppressions_pkey do nothing;
    update public.sms_consent set opted_in=false,opted_out_at=p_occurred_at where public.communication_recipient('SMS',phone_number)=sender;
    update public.communication_outbox o set state='failed',last_error='recipient_suppressed' where o.channel='SMS' and o.recipient=sender and o.state='pending';
   else
    delete from public.communication_suppressions s where s.channel='SMS' and s.recipient=sender and s.reason in ('provider_sms_stop','staff_sms_opt_out');
    -- START applies only to an unambiguous household, without overriding other suppression reasons.
    if client is not null then
     update public.sms_consent set opted_in=true,opted_in_at=p_occurred_at,opted_out_at=null where client_id=client and public.communication_recipient('SMS',phone_number)=sender;
     if not found then insert into public.sms_consent(client_id,phone_number,opted_in,opted_in_at,consent_details) values(client,sender,true,p_occurred_at,'Provider-verified START');end if;
    end if;
   end if;
  end if;
 end if;
 update public.communication_provider_events set state='processed',lease_token=null,lease_expires_at=null,last_error=null where id=event.id;
 return result;
end $function$;

-- complete_payment_reconciliation(uuid,text,text,boolean)
CREATE OR REPLACE FUNCTION public.complete_payment_reconciliation(p_case_id uuid, p_reviewed_proof_hash text, p_expected_case_hash text, p_attest boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid:=public.payment_require_admin();c public.payment_reconciliation_cases;p public.payment_reconciliation_captures;r public.payment_reconciliation_resolutions;e jsonb;applied_id uuid;disposition text;target jsonb;
begin
 select * into c from public.payment_reconciliation_cases where id=p_case_id and actor_id=actor for update;
 if not found then raise exception 'Reconciliation review unavailable' using errcode='42501';end if;
 select * into p from public.payment_reconciliation_captures where case_id=c.id;
 if not found or p_attest is distinct from true or p.proof_hash is distinct from p_reviewed_proof_hash or c.snapshot_hash is distinct from p_expected_case_hash then raise exception 'Exact captured review required' using errcode='23514';end if;
 select * into r from public.payment_reconciliation_resolutions where case_id=c.id;
 if found then return public.read_payment_reconciliation(c.id);end if;
 perform 1 from public.billing_invoices where id=c.invoice_id for update;
 if c.snapshot_hash is distinct from public.payment_reconciliation_hash_internal(c.invoice_id) then raise exception 'Reconciliation facts changed' using errcode='PT409';end if;
 if p.provider_observed_at<clock_timestamp()-interval '5 minutes' then raise exception 'Provider proof expired; prepare another review' using errcode='23514';end if;
 target:=public.payment_reconciliation_target_internal(c.invoice_id,c.family,c.request_id,c.provider_object_id);
 if exists(select 1 from jsonb_array_elements(c.blocker_refs) ref where not (target->'blocker_refs') @> jsonb_build_array(ref)) then raise exception 'Reconciliation blockers changed' using errcode='PT409';end if;
 e:=p.evidence;
 if c.family='checkout' then
 select x.id,x.disposition into applied_id,disposition from public.apply_checkout_evidence('reconcile:'||c.id,c.request_id,e->>'account_id',(e->>'livemode')::boolean,e->>'status',e->>'object_id',e->>'payment_id',(e->>'amount_cents')::bigint,e->>'currency',e->>'source_hash') x;
 else
 select x.id,x.disposition into applied_id,disposition from public.apply_refund_evidence('reconcile:'||c.id,c.request_id,e->>'account_id',(e->>'livemode')::boolean,e->>'object_id',e->>'provider_payment_id',(e->>'amount_cents')::bigint,e->>'currency',e->>'status') x;
 end if;
 if disposition is distinct from 'accepted' then raise exception 'Financial evidence still requires separate review' using errcode='23514';end if;
 insert into public.payment_reconciliation_resolutions(case_id,actor_id,proof_hash,ledger_evidence_id) values(c.id,actor,p.proof_hash,applied_id);
 insert into public.payment_reconciliation_resolved_blockers(kind,blocker_id,case_id) select ref->>'kind',(ref->>'id')::uuid,c.id from jsonb_array_elements(c.blocker_refs) ref;
 return public.read_payment_reconciliation(c.id);
end $function$;

-- configure_native_prescriber(uuid,jsonb)
CREATE OR REPLACE FUNCTION public.configure_native_prescriber(p_id uuid, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a uuid:=public.native_rx_require_admin();u uuid;ev integer;c public.native_prescriber_configurations;f jsonb;r jsonb;k text;
begin
 r:=public.native_rx_begin(p_id,'configure_prescriber',p_request);if r is not null then return r;end if;
 perform public.native_rx_keys(p_request,array['user_id','expected_version','fields','attest_review']);
 u:=public.native_rx_uuid(p_request->'user_id');ev:=public.native_rx_revision(p_request->'expected_version');f:=p_request->'fields';
 perform public.native_rx_keys(f,array['active','license_number','license_state','license_expires_on','practice_name','practice_address','practice_phone','clinical_review_note']);
 if p_request->'attest_review' is distinct from 'true'::jsonb or jsonb_typeof(f->'active') is distinct from 'boolean' then raise exception 'Explicit commissioning review required' using errcode='23514';end if;
 foreach k in array array['license_number','license_state'] loop perform public.native_rx_text(f->k,100);end loop;
 perform public.native_rx_text(f->'practice_name',200);perform public.native_rx_text(f->'practice_address',1000);perform public.native_rx_text(f->'clinical_review_note',2000);
 if f->'practice_phone'<>'null'::jsonb then perform public.native_rx_text(f->'practice_phone',100);end if;perform public.native_rx_day(f->'license_expires_on');
 perform pg_advisory_xact_lock(hashtextextended('native-prescriber:'||u::text,0));perform public.native_rx_require_admin();
 if not exists(select 1 from public.profiles where id=u) or ((f->>'active')::boolean and not exists(select 1 from public.user_roles where user_id=u and role='DVM')) then raise exception 'Existing veterinarian required for commissioning' using errcode='23514';end if;
 select * into c from public.native_prescriber_configurations where user_id=u order by version desc limit 1;
 if c.version is distinct from ev then raise exception 'Prescriber configuration changed' using errcode='PT409';end if;
 insert into public.native_prescriber_configurations values(u,coalesce(ev,0)+1,f,a,clock_timestamp()) returning * into c;
 perform public.native_rx_require_admin();return public.native_rx_finish(p_id,'configure_prescriber',null,p_request,to_jsonb(c));
end $function$;

-- configure_native_return_policy(uuid,jsonb)
CREATE OR REPLACE FUNCTION public.configure_native_return_policy(p_id uuid, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a uuid:=public.clinical_require_staff();actor jsonb;d public.native_return_policy_decisions;s public.native_return_policy_state;doc jsonb;stamp timestamptz;begin
 if p_id is null then raise exception 'Stable policy ID required' using errcode='23514';end if;
 perform public.native_rx_keys(p_request,array['expected_version','enabled','review_reference','attest_review']);perform public.native_rx_text(p_request->'review_reference',2000);
 if jsonb_typeof(p_request->'expected_version') is distinct from 'number' or p_request->>'expected_version' !~ '^(0|[1-9][0-9]{0,9})$' or (p_request->>'expected_version')::numeric>2147483646 or jsonb_typeof(p_request->'enabled') is distinct from 'boolean' or p_request->'attest_review' is distinct from 'true'::jsonb then raise exception 'Exact policy review required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('native-return-policy-operation:'||p_id::text,0));perform public.clinical_require_staff();
 select * into d from public.native_return_policy_decisions where id=p_id;if found then
  if d.actor_id<>a or d.request is distinct from p_request then raise exception 'Policy identifier already used' using errcode='23514';end if;
  perform public.native_return_policy_verified(d.version);perform public.clinical_require_staff();return public.native_return_policy_receipt(d);
 end if;
 select * into s from public.native_return_policy_state where id for update;
 perform public.native_rx_require_admin();actor:=public.native_correction_actor('clinical_annotation');
 if s.version<>(p_request->>'expected_version')::integer then raise exception 'Return policy changed' using errcode='PT409';end if;
 stamp:=clock_timestamp();doc:=jsonb_build_object('version',s.version+1,'enabled',p_request->'enabled','review_reference',p_request->'review_reference','actor_id',a,'actor_name',actor->'name','reviewed_at',stamp);doc:=doc||jsonb_build_object('record_hash',public.native_fulfillment_hash(doc));
 insert into public.native_return_policy_decisions values(p_id,s.version+1,a,p_request,public.native_fulfillment_hash(jsonb_build_object('version',1,'actor_id',a,'operation','configure_native_return_policy','request',p_request)),doc,stamp) returning * into d;
 update public.native_return_policy_state set version=d.version,decision_id=p_id where id;
 perform public.native_rx_require_admin();perform public.native_correction_actor('clinical_annotation');return public.native_return_policy_receipt(d);
end $function$;

-- confirm_record_release(uuid,uuid,uuid,text,text,jsonb,jsonb,text,boolean)
CREATE OR REPLACE FUNCTION public.confirm_record_release(p_id uuid, p_pet_id uuid, p_client_id uuid, p_channel text, p_recipient text, p_selection jsonb, p_reviewed_snapshot jsonb, p_reviewed_hash text, p_attest_review boolean)
 RETURNS record_releases
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid:=public.clinical_require_staff(); result public.record_releases; preview jsonb; req jsonb; k text; source_type text;
begin
 if p_id is null or p_attest_review is distinct from true then raise exception 'Stable ID and explicit content/recipient review are required' using errcode='23514'; end if;
 req:=jsonb_build_object('pet_id',p_pet_id,'client_id',p_client_id,'channel',p_channel,'recipient',p_recipient,'selection',p_selection,'reviewed_snapshot',p_reviewed_snapshot,'reviewed_hash',p_reviewed_hash,'attest_review',p_attest_review);
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,13)); perform public.clinical_require_staff();
 select * into result from public.record_releases where id=p_id;
 if found then if result.created_by<>actor or result.request is distinct from req then raise exception 'Release identifier already used' using errcode='23514'; end if; perform public.clinical_require_staff(); return result; end if;
 perform 1 from public.record_release_policy where id and enabled and accepted_at<=now() and accepted_schema_version>=coalesce((p_reviewed_snapshot->>'schema_version')::integer,3) for share;
 if not found then raise exception 'Clinical acceptance of the release form and workflow is required before confirmation' using errcode='42501'; end if;
 if (p_reviewed_snapshot->>'schema_version')::integer=13 then preview:=public.release_preview_v13_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection); elsif (p_reviewed_snapshot->>'schema_version')::integer=12 then preview:=public.release_preview_v12_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection); elsif (p_reviewed_snapshot->>'schema_version')::integer=11 then preview:=public.release_preview_v11_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection); elsif (p_reviewed_snapshot->>'schema_version')::integer=10 then preview:=public.release_preview_v10_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection); elsif (p_reviewed_snapshot->>'schema_version')::integer=9 then preview:=public.release_preview_v9_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection); elsif (p_reviewed_snapshot->>'schema_version')::integer=8 then preview:=public.release_preview_v8_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection); elsif (p_reviewed_snapshot->>'schema_version')::integer=7 then preview:=public.release_preview_v7_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection); elsif (p_reviewed_snapshot->>'schema_version')::integer=6 then preview:=public.release_preview_v6_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection); elsif (p_reviewed_snapshot->>'schema_version')::integer=5 then preview:=public.release_preview_v5_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection); elsif (p_reviewed_snapshot->>'schema_version')::integer=4 then preview:=public.release_preview_internal(p_pet_id,p_client_id,p_channel,p_recipient,p_selection);
 else
  preview:=public.preview_record_release(p_pet_id,p_client_id,p_channel,p_recipient,p_selection);
  if exists(select 1 from public.ezyvet_weight_approvals where pet_id=p_pet_id and weight_id in(select v::uuid from jsonb_array_elements_text(coalesce(p_selection->'weight_ids','[]')) v)) then raise exception 'Preview and review weight provenance with release form version 4' using errcode='23514';end if;
 end if;
 if p_reviewed_snapshot->>'schema_version' not in ('5','6','7','8','9','10','11','12','13') and exists(select 1 from jsonb_array_elements_text(coalesce(p_selection->'document_ids','[]')) d where public.release_document_has_provenance(d::uuid)) then raise exception 'Review original provenance with release schema5' using errcode='23514';end if; if p_reviewed_snapshot->>'schema_version' not in ('6','7','8','9','10','11','12','13') and exists(select 1 from jsonb_array_elements_text(coalesce(p_selection->'problem_ids','[]')) v where public.release_problem_has_import_provenance(v::uuid)) then raise exception 'Review imported problem lineage with release schema6' using errcode='23514';end if; if preview->'snapshot' is distinct from p_reviewed_snapshot or preview->>'source_hash' is distinct from p_reviewed_hash then raise exception 'Release sources or recipient changed; preview and review again' using errcode='PT409'; end if;
 perform public.clinical_require_staff(); insert into public.record_releases(id,pet_id,client_id,channel,recipient,selection,snapshot,source_hash,request,created_by) values(p_id,p_pet_id,p_client_id,p_channel,preview#>>'{snapshot,recipient,address}',p_selection,p_reviewed_snapshot,p_reviewed_hash,req,actor) returning * into result;
 foreach k in array array['encounter_ids','certificate_ids','lab_order_ids','document_ids','dental_ids','qol_ids','anesthesia_ids','lesion_ids','problem_ids','weight_ids','treatment_ids','patient_summary_ids','lab_report_ids','external_record_ids','imported_history_ids','imported_vaccination_ids','imported_prescription_ids','api_attachment_ids','native_prescription_ids','native_dispense_ids'] loop
  source_type:=case k when 'encounter_ids' then 'encounter' when 'certificate_ids' then 'certificate' when 'lab_order_ids' then 'lab' when 'dental_ids' then 'dental' when 'qol_ids' then 'qol' when 'anesthesia_ids' then 'anesthesia' when 'lesion_ids' then 'lesion' when 'problem_ids' then 'problem' when 'weight_ids' then 'weight' when 'treatment_ids' then 'treatment' when 'patient_summary_ids' then 'patient_summary' when 'lab_report_ids' then 'lab_report' when 'external_record_ids' then 'external_record' when 'imported_history_ids' then 'imported_history' when 'imported_vaccination_ids' then 'imported_vaccination' when 'imported_prescription_ids' then 'imported_prescription' when 'api_attachment_ids' then 'api_attachment' when 'native_prescription_ids' then 'native_prescription' when 'native_dispense_ids' then 'native_dispense' else 'document' end;
  insert into public.record_release_sources(release_id,source_kind,source_id) select p_id,source_type,v::uuid from jsonb_array_elements_text(coalesce(p_selection->k,'[]')) v;
 end loop;
 perform public.clinical_require_staff(); return result;
end $function$;

-- conversation_email_delivery_context(uuid,uuid)
CREATE OR REPLACE FUNCTION public.conversation_email_delivery_context(p_outbox_id uuid, p_lease_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o public.communication_outbox;l public.conversation_email_outbox_links;
 a public.conversation_email_artifacts;r public.communication_prepared_requests;
begin
 perform public.communication_require_service();
 select * into o from public.communication_outbox where id=p_outbox_id for update;
 if not found or o.state<>'claimed' or o.lease_token is distinct from p_lease_token
  or o.lease_expires_at is null or o.lease_expires_at<=now() or o.attempt_started_at is not null then
  raise exception 'Outbox lease unavailable' using errcode='PT409';end if;
 select * into l from public.conversation_email_outbox_links where outbox_id=o.id;
 if not found then
  if exists(select 1 from public.conversation_email_artifacts where request_id=o.request_id) then
   raise exception 'Attachment email is missing its reviewed queue association' using errcode='23514';end if;
  return null;
 end if;
 if exists(select 1 from public.invoice_email_outbox_links where outbox_id=o.id)
  or exists(select 1 from public.release_email_outbox_links where outbox_id=o.id)
  or exists(select 1 from public.payment_delivery_outbox_links where outbox_id=o.id)
  or exists(select 1 from public.document_link_outbox_links where outbox_id=o.id)
  or exists(select 1 from public.reminder_outbox_links where outbox_id=o.id) then
  raise exception 'Ambiguous attachment email association' using errcode='23514';end if;
 select * into a from public.conversation_email_artifacts where request_id=l.request_id;
 select * into r from public.communication_prepared_requests where request_id=l.request_id;
 if a.payload_text is null or a.payload_hash is null or r.request_id is null or r.state='abandoned'
  or l.reviewed_payload_hash is distinct from a.payload_hash
  or a.payload_hash is distinct from encode(sha256(convert_to(a.payload_text,'UTF8')),'hex')
  or l.queued_by is distinct from r.actor_id
  or row(o.request_id,o.created_by,o.conversation_id,o.channel,o.recipient,o.subject,o.body) is distinct from
     row(r.request_id,r.actor_id,(r.payload->>'conversation_id')::uuid,'EMAIL'::text,
         public.communication_recipient('EMAIL',r.payload->>'to'),r.payload->>'subject',r.payload->>'body') then
  raise exception 'Reviewed attachment payload unavailable or changed' using errcode='23514';end if;
 return jsonb_build_object('payload_text',a.payload_text,'payload_hash',a.payload_hash,'artifact_kind','conversation');
end $function$;

-- create_native_refill(uuid,jsonb)
CREATE OR REPLACE FUNCTION public.create_native_refill(p_id uuid, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a uuid:=public.clinical_require_staff();r jsonb;ri uuid;pet uuid;client uuid;p public.pets;f public.native_refills;stamp timestamptz;
begin
 r:=public.native_refill_begin(p_id,'create',p_request);if r is not null then return r;end if;
 perform public.native_rx_keys(p_request,array['refill_id','pet_id','client_id','medication_requested','requester_note','channel','reason']);
 ri:=public.native_rx_uuid(p_request->'refill_id');pet:=public.native_rx_uuid(p_request->'pet_id');client:=public.native_rx_uuid(p_request->'client_id');
 perform public.native_rx_text(p_request->'medication_requested',500);if p_request->'requester_note' is distinct from 'null'::jsonb then perform public.native_rx_text(p_request->'requester_note',4000);end if;perform public.native_rx_text(p_request->'reason',2000);
 if p_request->>'channel' is null or p_request->>'channel' not in ('phone','email','text','in_person','other') then raise exception 'Invalid refill intake channel' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('native-refill:'||ri::text,0));perform public.clinical_require_staff();
 if exists(select 1 from public.native_refills where id=ri) then raise exception 'Refill changed' using errcode='PT409';end if;
 select * into p from public.pets where id=pet for share;
 if not found or p.client_id<>client or p.archived_at is not null or p.deceased_at is not null then raise exception 'Current active refill patient and household required' using errcode='23514';end if;
 stamp:=clock_timestamp();insert into public.native_refills values(ri,pet,client,1,'open',p_request->>'medication_requested',p_request->>'requester_note',p_request->>'channel',null,null,null,a,stamp,a,stamp) returning * into f;
 return public.native_refill_finish(p_id,'create',p_request,null,f,'create',null);
end $function$;

-- disable_reminder_automation_policy(uuid,integer,text)
CREATE OR REPLACE FUNCTION public.disable_reminder_automation_policy(p_id uuid, p_expected_version integer, p_review_note text)
 RETURNS reminder_automation_policies
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid:=public.care_require_admin();r public.reminder_automation_policies;
begin
 if p_id is null or p_expected_version is null or p_review_note is null or length(trim(p_review_note)) not between 1 and 2000 then
  raise exception 'Policy version and review reason are required' using errcode='23514';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,18));
 select * into r from public.reminder_automation_policies where id=p_id for update;
 if not found then raise exception 'Policy unavailable' using errcode='23514';end if;
 if r.approved_by=actor and r.version=p_expected_version+1 and not r.enabled and r.review_note=trim(p_review_note) then return r;end if;
 if r.version<>p_expected_version then raise exception 'Automation policy version conflict' using errcode='PT409';end if;
 update public.reminder_automation_policies set enabled=false,version=version+1,review_note=trim(p_review_note),approved_by=actor,approved_at=now() where id=p_id returning * into r;
 insert into public.reminder_automation_policy_history(policy_id,version,snapshot) values(r.id,r.version,to_jsonb(r));
 return r;
end $function$;

-- document_link_delivery_context(uuid,uuid)
CREATE OR REPLACE FUNCTION public.document_link_delivery_context(p_outbox_id uuid, p_lease_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o public.communication_outbox;l public.document_link_outbox_links;g public.document_link_grants;p public.document_link_payloads;
begin
 perform public.communication_require_service();
 select * into o from public.communication_outbox where id=p_outbox_id for update;
 if not found or o.state<>'claimed' or o.lease_token is distinct from p_lease_token or o.lease_expires_at<=now() or o.attempt_started_at is not null then raise exception 'Outbox lease unavailable' using errcode='PT409';end if;
 select * into l from public.document_link_outbox_links where outbox_id=o.id;
 if not found then return null;end if;
 select * into g from public.document_link_grants where id=l.grant_id for share;
 select * into p from public.document_link_payloads where grant_id=g.id;
 perform public.document_link_current(g.id);
 if not exists(select 1 from public.document_link_access_budget where grant_id=g.id and used<200) then raise exception 'Document retrieval budget exhausted' using errcode='42501';end if;
 if g.state<>'reviewed' or p.grant_id is null or p.artifact_hash is distinct from l.reviewed_artifact_hash or p.message_hash is distinct from l.reviewed_message_hash or p.artifact_hash<>encode(sha256(convert_to(p.payload_text,'UTF8')),'hex') or row(o.channel,o.recipient,o.body,o.created_by,o.client_id,o.conversation_id) is distinct from row('SMS'::text,g.recipient,g.message_template,g.actor_id,g.client_id,g.conversation_id) then raise exception 'Document link delivery unavailable' using errcode='42501';end if;
 return jsonb_build_object('grant',jsonb_build_object('id',g.id,'origin',g.origin,'key_version',g.key_version,'capability_context',g.capability_context,'message_template',g.message_template),'token_hash',p.token_hash,'message_hash',p.message_hash,'artifact_hash',p.artifact_hash);
end $function$;

-- enqueue_care_reminder(uuid,text,uuid,integer,uuid,integer)
CREATE OR REPLACE FUNCTION public.enqueue_care_reminder(p_id uuid, p_source_kind text, p_source_id uuid, p_expected_source_version integer, p_message_template_id uuid, p_expected_template_version integer)
 RETURNS care_reminder_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.care_reminder_jobs;t public.care_message_templates;p public.pets;v public.patient_vaccine_due_plans;l public.patient_lab_orders;patient_id uuid;due date;care_name text;snapshot jsonb;body text;part record;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service enqueue only' using errcode='42501';end if;
 if p_id is null then raise exception 'Stable job ID required' using errcode='23514';end if;
 if p_source_kind='vaccine' then select pet_id into patient_id from public.patient_vaccine_due_plans where id=p_source_id;
 elsif p_source_kind='lab' then select pet_id into patient_id from public.patient_lab_orders where id=p_source_id;
 else raise exception 'Unsupported reminder source' using errcode='23514';end if;
 select * into p from public.pets where id=patient_id and archived_at is null and deceased_at is null for share;if not found then raise exception 'Reminder requires an active patient' using errcode='23514';end if;
 if p_source_kind='vaccine' then
  select * into v from public.patient_vaccine_due_plans where id=p_source_id for share;
  if v.version is distinct from p_expected_source_version or v.status<>'current' or not v.reminders_enabled or exists(select 1 from public.patient_treatment_corrections where treatment_id=v.treatment_id) then raise exception 'Vaccine due source is not current or enabled' using errcode='PT409';end if;
  due=v.current_due_on;care_name=v.template_snapshot->>'name';snapshot=to_jsonb(v);
 else
  select * into l from public.patient_lab_orders where id=p_source_id for share;
  if l.version is distinct from p_expected_source_version or l.status not in ('planned','ordered') or not l.reminders_enabled or l.due_date is null then raise exception 'Lab due source is not current or enabled' using errcode='PT409';end if;
  due=l.due_date;care_name=l.test_name;snapshot=to_jsonb(l);
 end if;
 select * into t from public.care_message_templates where id=p_message_template_id for share;
 if t.id is null or not t.active or t.version is distinct from p_expected_template_version then raise exception 'Message template changed or retired' using errcode='PT409';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,16));
 select * into r from public.care_reminder_jobs where id=p_id;
 if found then if row(r.source_kind,r.source_id,r.source_version,r.message_template_id,r.message_template_version) is distinct from row(p_source_kind,p_source_id,p_expected_source_version,p_message_template_id,p_expected_template_version) then raise exception 'Job ID reused with changed request' using errcode='42501';end if;return r;end if;
 -- A separate stable request ID for the same source/template version still returns the one canonical job.
 perform pg_advisory_xact_lock(hashtextextended(p_source_kind||p_source_id::text||p_expected_source_version::text||p_message_template_id::text||p_expected_template_version::text,17));
 select * into r from public.care_reminder_jobs where source_kind=p_source_kind and source_id=p_source_id and source_version=p_expected_source_version and message_template_id=p_message_template_id and message_template_version=p_expected_template_version;if found then return r;end if;
 body='';for part in select m[1] as token from regexp_matches(t.body,'(\{\{patient_name\}\}|\{\{care_name\}\}|\{\{due_date\}\}|[^{}]+)','g') m loop body=body||case part.token when '{{patient_name}}' then p.name when '{{care_name}}' then care_name when '{{due_date}}' then due::text else part.token end;end loop;
 insert into public.care_reminder_jobs(id,source_kind,source_id,source_version,pet_id,client_id,message_template_id,message_template_version,channel,scheduled_on,due_on,rendered_body,source_snapshot,template_snapshot) values(p_id,p_source_kind,p_source_id,p_expected_source_version,p.id,p.client_id,t.id,t.version,t.channel,due-t.days_before,due,body,snapshot,to_jsonb(t)) returning * into r;return r;
end $function$;

-- external_record_capture_context(uuid,uuid)
CREATE OR REPLACE FUNCTION public.external_record_capture_context(p_receipt_id uuid, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.external_record_receipts;d public.patient_documents;
begin
 select * into r from public.external_record_receipts where id=p_receipt_id and actor_id=p_actor_id;
 if not found or not public.ezyvet_is_active_admin(p_actor_id) then raise exception 'Staged receipt actor unavailable' using errcode='42501';end if;
 select * into d from public.patient_documents where id=r.document_id and pet_id=r.pet_id and status='ready' and version=r.document_version for share;
 if not found then raise exception 'Original document no longer ready at staged version' using errcode='PT409';end if;
 return jsonb_build_object('receipt',to_jsonb(r),'document',jsonb_build_object('id',d.id,'version',d.version,'bucket','patient-documents','file_path',d.file_path,'mime_type',d.mime_type,'file_size',d.file_size),'capture',(select to_jsonb(c) from public.external_record_byte_captures c where receipt_id=r.id));
end $function$;

-- ezyvet_attachment_capture_lock_source(uuid,boolean)
CREATE OR REPLACE FUNCTION public.ezyvet_attachment_capture_lock_source(p_id uuid, p_claim_slot boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.ezyvet_attachment_capture_requests;context jsonb;h public.ezyvet_identity_heads;begin
 select * into strict r from public.ezyvet_attachment_capture_requests where id=p_id;
 perform pg_advisory_xact_lock(hashtextextended('attachment-run:'||r.run_id::text,0));
 context:=public.ezyvet_attachment_parent_context(r.animal_link_id,r.parent_context->>'source_origin',r.parent_context->>'source_site_uid');
 if context is distinct from r.parent_context then raise exception 'SOURCE_ATTACHMENT_PARENT_STALE' using errcode='PT409';end if;
 if p_claim_slot then perform public.ezyvet_attachment_original_source_gate(context->>'source_origin',context->>'source_site_uid',r.id);
 else perform pg_advisory_xact_lock(hashtextextended((context->>'source_origin')||':'||(context->>'source_site_uid')||':attachment',0));end if;
 select * into h from public.ezyvet_identity_heads where source_origin=context->>'source_origin' and source_site_uid=context->>'source_site_uid' and resource='attachment' and external_id=r.external_id for share;
 if h.snapshot_id is distinct from r.snapshot_id or h.version is distinct from r.observed_head_version then raise exception 'SOURCE_ATTACHMENT_STALE' using errcode='PT409';end if;
end $function$;

-- ezyvet_attachment_capture_require_lease(uuid,uuid,uuid)
CREATE OR REPLACE FUNCTION public.ezyvet_attachment_capture_require_lease(p_id uuid, p_actor uuid, p_lease_id uuid)
 RETURNS ezyvet_attachment_capture_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.ezyvet_attachment_capture_requests;begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into r from public.ezyvet_attachment_capture_requests where id=p_id for update;
 if r.id is null or r.requested_by is distinct from p_actor then raise exception 'Capture owner mismatch' using errcode='42501';end if;
 if r.status not in('prepared','reserved') or p_lease_id is null or r.lease_id is distinct from p_lease_id or r.lease_until<=clock_timestamp() then raise exception 'Capture lease changed or expired' using errcode='PT409';end if;
 return r;
end $function$;

-- ezyvet_attachment_parent_context(uuid,text,text)
CREATE OR REPLACE FUNCTION public.ezyvet_attachment_parent_context(p_animal_link_id uuid, p_origin text, p_site text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare m public.ezyvet_record_links;s public.ezyvet_import_snapshots;h public.ezyvet_identity_heads;
begin
 select * into m from public.ezyvet_record_links where id=p_animal_link_id and resource='animal' and source_origin=p_origin and source_site_uid=p_site for share;
 if not found then raise exception 'Reviewed patient mapping required' using errcode='42501';end if;
 perform 1 from public.pets where id=m.pet_id and client_id=m.client_id for share;
 if not found then raise exception 'SOURCE_ATTACHMENT_PARENT_STALE' using errcode='PT409';end if;
 select * into h from public.ezyvet_identity_heads where source_origin=p_origin and source_site_uid=p_site and resource='animal' and external_id=m.external_id for share;
 select * into s from public.ezyvet_import_snapshots where id=h.snapshot_id;
 if s.id is null or row(s.source_origin,s.source_site_uid,s.resource,s.external_id,s.payload->>'id') is distinct from row(p_origin,p_site,'animal'::text,m.external_id,m.external_id)
  or m.external_id !~ '^(0|[1-9][0-9]{0,15})$' then raise exception 'Current exact animal parent required' using errcode='23514';end if;
 if m.external_id::numeric>9007199254740991 then raise exception 'Invalid attachment animal ID' using errcode='23514';end if;
 return jsonb_build_object('animal_link_id',m.id,'pet_id',m.pet_id,'client_id',m.client_id,'animal_external_id',m.external_id,'source_origin',p_origin,'source_site_uid',p_site,'parent_type','Animal','parent_external_id',s.external_id,'parent_snapshot_id',s.id,'parent_payload_hash',s.payload_hash,'parent_observed_head_version',h.version);
end $function$;

-- ezyvet_history_review_context(uuid,text,jsonb)
CREATE OR REPLACE FUNCTION public.ezyvet_history_review_context(p_pet_id uuid, p_kind text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result jsonb:=jsonb_build_object('history_source',null,'histories','[]'::jsonb,'problem',null,'extraction',null);sources jsonb;fields jsonb;p public.patient_problems;e public.ezyvet_problem_extractions;x jsonb;oldh public.ezyvet_imported_histories;newh public.ezyvet_imported_histories;expected text[];begin
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or p_payload->>'reason' is null or length(trim(p_payload->>'reason')) not between 5 and 2000 then raise exception 'An explicit review reason is required' using errcode='23514';end if;
 if p_kind='history_approval' then
  expected:=array['animal_link_id','snapshot_id','payload_hash','observed_head_version','patient_version','consult_mode','consult_snapshot_id','consult_payload_hash','consult_head_version','reason'];
 elsif p_kind='problem_extraction' then expected:=array['sources','patient_version','action','problem_id','problem_version','fields','duplicate_decision','reason'];
 else expected:=array['extraction_id','reviewed_sources','reason'];end if;
 if (select count(*) from jsonb_object_keys(p_payload))<>cardinality(expected) or exists(select 1 from jsonb_object_keys(p_payload) k where not(k=any(expected))) then raise exception 'Exact prepared operation fields required' using errcode='23514';end if;
 if p_kind='history_approval' then return result||jsonb_build_object('history_source',public.ezyvet_history_source_context(p_pet_id,p_payload));end if;
 if p_kind='problem_extraction' then
  if not exists(select 1 from public.pets where id=p_pet_id and version=(p_payload->>'patient_version')::integer) then raise exception 'Patient changed; review again' using errcode='PT409';end if;
  sources:=public.ezyvet_validate_history_sources(p_pet_id,p_payload->'sources');fields:=p_payload->'fields';
  if fields is null or jsonb_typeof(fields)<>'object' or (select count(*) from jsonb_object_keys(fields))<>5 or exists(select 1 from jsonb_object_keys(fields) k where k not in ('title','notes','onset_date','status','importance')) or jsonb_typeof(fields->'title') is distinct from 'string' or length(fields->>'title') not between 1 and 250 or fields->>'title'<>trim(fields->>'title') or jsonb_typeof(fields->'notes') is distinct from 'string' or length(fields->>'notes')>10000 or fields->>'status' is null or fields->>'status' not in ('active','resolved') or fields->>'importance' is null or fields->>'importance' not in ('routine','high') or ((fields->>'onset_date') is not null and (jsonb_typeof(fields->'onset_date')<>'string' or fields->>'onset_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or fields->>'onset_date' is distinct from ((fields->>'onset_date')::date)::text or not isfinite((fields->>'onset_date')::date) or (fields->>'onset_date')::date>(now() at time zone 'America/Denver')::date)) then raise exception 'Review explicit valid native problem fields' using errcode='23514';end if;
  if p_payload->>'action'='link' then
   if p_payload->>'duplicate_decision' is distinct from 'link_existing' then raise exception 'Explicit existing-problem decision required' using errcode='23514';end if;
   select * into p from public.patient_problems where id=(p_payload->>'problem_id')::uuid and pet_id=p_pet_id for update;
   if not found or p.version is distinct from (p_payload->>'problem_version')::integer or public.ezyvet_problem_fields(p) is distinct from fields then raise exception 'Link must preserve exact current problem fields and version' using errcode='PT409';end if;
   result:=result||jsonb_build_object('problem',to_jsonb(p));
  elsif p_payload->>'action'='create' then
   if p_payload->>'problem_id' is not null or p_payload->>'problem_version' is not null or p_payload->>'duplicate_decision' is distinct from 'distinct_finding' then raise exception 'Explicit distinct-finding decision required' using errcode='23514';end if;
  else raise exception 'Explicit extraction action required' using errcode='23514';end if;
  return result||jsonb_build_object('histories',sources);
 end if;
 select * into e from public.ezyvet_problem_extractions where id=(p_payload->>'extraction_id')::uuid and pet_id=p_pet_id;
 if not found or p_payload->'reviewed_sources' is null or jsonb_typeof(p_payload->'reviewed_sources')<>'array' or jsonb_array_length(p_payload->'reviewed_sources')<>(select count(*) from public.ezyvet_problem_history_sources where extraction_id=e.id) or (select count(*)<>count(distinct (v->>'original_history_id')::uuid) from jsonb_array_elements(p_payload->'reviewed_sources') v) then raise exception 'Review every original extraction source identity' using errcode='23514';end if;
 for x in select value from jsonb_array_elements(p_payload->'reviewed_sources') loop
  select h.* into oldh from public.ezyvet_imported_histories h join public.ezyvet_problem_history_sources s on s.history_id=h.id where s.extraction_id=e.id and h.id=(x->>'original_history_id')::uuid;
  select * into newh from public.ezyvet_imported_histories where id=(x->>'reviewed_history_id')::uuid;
  if oldh.id is null or newh.id is null or row(oldh.animal_link_id,oldh.history_external_id,oldh.pet_id) is distinct from row(newh.animal_link_id,newh.history_external_id,newh.pet_id) then raise exception 'Discrepancy review source identity changed' using errcode='23514';end if;
 end loop;
 select jsonb_agg(jsonb_build_object('id',v->'reviewed_history_id','version_hash',v->'version_hash')) into sources from jsonb_array_elements(p_payload->'reviewed_sources') v;
 sources:=public.ezyvet_validate_history_sources(p_pet_id,sources);
 return result||jsonb_build_object('histories',sources,'extraction',public.ezyvet_extraction_projection(e.id));
end $function$;

-- ezyvet_history_source_context(uuid,jsonb)
CREATE OR REPLACE FUNCTION public.ezyvet_history_source_context(p_pet_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare m public.ezyvet_record_links;s public.ezyvet_import_snapshots;head public.ezyvet_identity_heads;cs public.ezyvet_import_snapshots;ch public.ezyvet_identity_heads;original jsonb;consult jsonb;ref text;mode text:=p_payload->>'consult_mode';begin
 select * into m from public.ezyvet_record_links where id=(p_payload->>'animal_link_id')::uuid and resource='animal' for share;
 if not found or m.pet_id is distinct from p_pet_id or not exists(select 1 from public.pets where id=p_pet_id and client_id=m.client_id and version=(p_payload->>'patient_version')::integer) then raise exception 'Current reviewed patient mapping required' using errcode='PT409';end if;
 select * into s from public.ezyvet_import_snapshots where id=(p_payload->>'snapshot_id')::uuid and resource='history' and source_origin=m.source_origin and source_site_uid=m.source_site_uid;
 if not found or s.payload_hash is distinct from p_payload->>'payload_hash' or s.payload->>'animal_id' is distinct from m.external_id then raise exception 'History source identity mismatch' using errcode='23514';end if;
 ref:=s.payload->>'consult_id';
 -- Consult sorts before history in all source lock paths.
 select * into ch from public.ezyvet_identity_heads where source_origin=m.source_origin and source_site_uid=m.source_site_uid and resource='consult' and external_id=ref for share;
 if found then select * into cs from public.ezyvet_import_snapshots where id=ch.snapshot_id;
  if cs.payload->>'animal_id' is distinct from m.external_id then raise exception 'Known consult conflicts with patient identity' using errcode='23514';end if;
 end if;
 select * into head from public.ezyvet_identity_heads where source_origin=s.source_origin and source_site_uid=s.source_site_uid and resource='history' and external_id=s.external_id for share;
 if head.snapshot_id is distinct from s.id or head.version is distinct from (p_payload->>'observed_head_version')::integer or not exists(select 1 from public.ezyvet_clinical_page_observations o join public.ezyvet_clinical_runs c on c.run_id=o.run_id where c.animal_link_id=m.id and o.snapshot_id=s.id and o.head_version=head.version) then raise exception 'Current scoped history observation required' using errcode='PT409';end if;
 if mode='verified' then
  if cs.id is distinct from (p_payload->>'consult_snapshot_id')::uuid or cs.payload_hash is distinct from p_payload->>'consult_payload_hash' or ch.version is distinct from (p_payload->>'consult_head_version')::integer or cs.id is null or not exists(select 1 from public.ezyvet_clinical_page_observations o join public.ezyvet_clinical_runs c on c.run_id=o.run_id where c.animal_link_id=m.id and o.snapshot_id=cs.id and o.head_version=ch.version) then raise exception 'Verified same-patient scoped consult required' using errcode='PT409';end if;
  consult:=jsonb_build_object('status','verified','snapshot_id',cs.id,'payload_hash',cs.payload_hash,'observed_head_version',ch.version,'external_id',cs.external_id);
 elsif mode in ('not_referenced','unresolved') then
  if (mode='not_referenced')<>(ref is null) or p_payload->>'consult_snapshot_id' is not null or p_payload->>'consult_payload_hash' is not null or p_payload->>'consult_head_version' is not null then raise exception 'Preserve the actual unresolved consult reference' using errcode='23514';end if;
  consult:=jsonb_build_object('status',mode);
 else raise exception 'Explicit consult context decision required' using errcode='23514';end if;
 original:=jsonb_build_object('comments',s.payload->'comments','history_system',s.payload->'history_system','chain',s.payload->'chain','timestamp',s.payload->'timestamp','vet_id',s.payload->'vet_id','active',s.payload->'active','consult_id',s.payload->'consult_id');
 if octet_length(original::text)>200000 then raise exception 'History original exceeds bounded clinical projection' using errcode='23514';end if;
 return jsonb_build_object('source',jsonb_build_object('origin',s.source_origin,'site_uid',s.source_site_uid,'animal_id',m.external_id,'history_id',s.external_id),'snapshot_id',s.id,'payload_hash',s.payload_hash,'observed_head_version',head.version,'original',original,'consult',consult);
end $function$;

-- ezyvet_prescription_interpretation_context(jsonb,jsonb)
CREATE OR REPLACE FUNCTION public.ezyvet_prescription_interpretation_context(p_source jsonb, p_review jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare keys text[]:=array['prescribed_on','prescription_date_status','status','outside_author','reason','completeness','partial_reason','items','replaces_id','expected_predecessor_hash'];
 item_keys text[]:=array['snapshot_id','start_on','start_date_status','product_id','product_version','note'];
 x jsonb;s jsonb;product public.catalog_products;products jsonb:='{}';selected jsonb:='[]';omitted jsonb;
 selected_ids uuid[]:='{}';product_ref record;
begin
 if p_review is null or jsonb_typeof(p_review)<>'object' then raise exception 'Exact prescription interpretation required' using errcode='23514';end if;
 if not(p_review ?& keys) or (p_review-keys)<>'{}'::jsonb then raise exception 'Exact prescription interpretation required' using errcode='23514';end if;
 if jsonb_typeof(p_review->'reason') is distinct from 'string' or length(btrim(p_review->>'reason')) not between 5 and 2000
  or p_review->>'reason'<>btrim(p_review->>'reason') then raise exception 'Prescription review rationale required' using errcode='23514';end if;
 if jsonb_typeof(p_review->'status') is distinct from 'string' or p_review->>'status' not in ('active','inactive','unknown') then
  raise exception 'Explicit historical prescription status required' using errcode='23514';end if;
 if p_review->'outside_author'<>'null'::jsonb and (jsonb_typeof(p_review->'outside_author')<>'string'
  or length(btrim(p_review->>'outside_author')) not between 1 and 500 or p_review->>'outside_author'<>btrim(p_review->>'outside_author')) then
  raise exception 'Invalid outside prescriber interpretation' using errcode='23514';end if;
 perform public.ezyvet_prescription_review_date(p_review->'prescribed_on',p_review->'prescription_date_status');
 if jsonb_typeof(p_review->'completeness') is distinct from 'string' or p_review->>'completeness' not in ('complete','partial') then
  raise exception 'Explicit historical completeness required' using errcode='23514';end if;
 if p_review->>'completeness'='partial' then
  if jsonb_typeof(p_review->'partial_reason') is distinct from 'string' or length(btrim(p_review->>'partial_reason')) not between 5 and 2000
   or p_review->>'partial_reason'<>btrim(p_review->>'partial_reason') then raise exception 'Partial prescription disclosure required' using errcode='23514';end if;
 elsif p_review->'partial_reason'<>'null'::jsonb then raise exception 'Complete prescription cannot carry partial disclosure' using errcode='23514';end if;
 if (p_review->'replaces_id'='null'::jsonb)<>(p_review->'expected_predecessor_hash'='null'::jsonb) then raise exception 'Complete prescription predecessor pair required' using errcode='23514';end if;
 if p_review->'replaces_id'<>'null'::jsonb and (jsonb_typeof(p_review->'replaces_id')<>'string'
  or p_review->>'replaces_id' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  or jsonb_typeof(p_review->'expected_predecessor_hash')<>'string' or p_review->>'expected_predecessor_hash' !~ '^[a-f0-9]{64}$') then
  raise exception 'Valid prescription predecessor required' using errcode='23514';end if;
 if p_source#>>'{consult,status}' is null or p_source#>>'{consult,status}' not in ('resolved','not_supplied') then
  raise exception 'Resolve supplied source consultation before review' using errcode='PT409';end if;
 if jsonb_typeof(p_review->'items') is distinct from 'array' then raise exception 'Selected prescription items required' using errcode='23514';end if;
 if jsonb_array_length(p_review->'items')>200 then raise exception 'Review at most 200 prescription items' using errcode='23514';end if;
 -- Validate identities before casts or catalog locks. Every selection must come
 -- from this exact scoped run; browser-supplied originals are never accepted.
 for x in select value from jsonb_array_elements(p_review->'items') loop
  if jsonb_typeof(x)<>'object' then raise exception 'Exact prescription item interpretation required' using errcode='23514';end if;
  if not(x ?& item_keys) or (x-item_keys)<>'{}'::jsonb or jsonb_typeof(x->'snapshot_id')<>'string'
   or x->>'snapshot_id' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then
   raise exception 'Exact prescription item interpretation required' using errcode='23514';end if;
  if (x->>'snapshot_id')::uuid=any(selected_ids) then raise exception 'Select each prescription item once' using errcode='23514';end if;
  selected_ids:=array_append(selected_ids,(x->>'snapshot_id')::uuid);
  select value into s from jsonb_array_elements(p_source->'items') where (value->>'snapshot_id')::uuid=(x->>'snapshot_id')::uuid limit 1;
  if not found then raise exception 'Selected item is outside scoped prescription evidence' using errcode='42501';end if;
  perform public.ezyvet_prescription_review_date(x->'start_on',x->'start_date_status');
  if x->'note'<>'null'::jsonb and (jsonb_typeof(x->'note')<>'string' or length(btrim(x->>'note')) not between 1 and 2000 or x->>'note'<>btrim(x->>'note')) then
   raise exception 'Invalid separate item interpretation' using errcode='23514';end if;
  if (x->'product_id'='null'::jsonb)<>(x->'product_version'='null'::jsonb) then raise exception 'Complete catalog match pair required' using errcode='23514';end if;
  if x->'product_id'<>'null'::jsonb then
   if jsonb_typeof(x->'product_id')<>'string' or x->>'product_id' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    or jsonb_typeof(x->'product_version')<>'number' or x->>'product_version' !~ '^[1-9][0-9]{0,9}$' then raise exception 'Valid catalog match required' using errcode='23514';end if;
  end if;
 end loop;
 -- All source heads are already held by the collector; product UUIDs lock in
 -- canonical order even when clinicians select medications in opposite orders.
 for product_ref in select distinct (value->>'product_id')::uuid id from jsonb_array_elements(p_review->'items') where value->>'product_id' is not null order by id loop
  select * into product from public.catalog_products where id=product_ref.id for share;
  if not found or not product.active or product.kind<>'medication' or exists(select 1 from jsonb_array_elements(p_review->'items') candidate(value)
   where (candidate.value->>'product_id')::uuid=product_ref.id and (candidate.value->>'product_version')::numeric<>product.version::numeric) then
   raise exception 'Catalog medication changed; review again' using errcode='PT409';end if;
  products:=products||jsonb_build_object(product.id::text,jsonb_build_object('id',product.id,'version',product.version,'name',product.name,'kind',product.kind,'unit',product.unit));
 end loop;
 for x in select value from jsonb_array_elements(p_review->'items') loop
  select value into s from jsonb_array_elements(p_source->'items') where (value->>'snapshot_id')::uuid=(x->>'snapshot_id')::uuid limit 1;
  selected:=selected||jsonb_build_array(jsonb_build_object('source',s,'reviewed',x-array['snapshot_id','product_id','product_version'],
   'product',products->((x->>'product_id')::uuid)::text));
 end loop;
 select coalesce(jsonb_agg(value order by value->>'external_id',value->>'snapshot_id'),'[]') into omitted
  from jsonb_array_elements(p_source->'items') where not((value->>'snapshot_id')::uuid=any(selected_ids));
 if p_review->>'completeness'='complete' and (p_source#>>'{reconciliation,status}' is distinct from 'matched' or jsonb_array_length(omitted)>0) then
  raise exception 'Complete account requires matched source list and every observed item' using errcode='23514';end if;
 return p_source||jsonb_build_object('reviewed',p_review-array['items','replaces_id','expected_predecessor_hash'],
  'selected_items',selected,'omitted_items',omitted);
end $function$;

-- ezyvet_prescription_review_predecessor(jsonb,jsonb)
CREATE OR REPLACE FUNCTION public.ezyvet_prescription_review_predecessor(p_context jsonb, p_review jsonb)
 RETURNS ezyvet_imported_prescriptions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare latest public.ezyvet_imported_prescriptions;ih text:=public.ezyvet_prescription_interpretation_hash(p_context);begin
 select * into latest from public.ezyvet_imported_prescriptions where animal_link_id=(p_context->>'animal_link_id')::uuid
  and source_origin=p_context#>>'{source,origin}' and source_site_uid=p_context#>>'{source,site_uid}'
  and prescription_external_id=p_context#>>'{parent,external_id}' order by version desc limit 1;
 if latest.id is not null and latest.interpretation_hash=ih then
  if p_review->>'replaces_id' is not null and row((p_review->>'replaces_id')::uuid,p_review->>'expected_predecessor_hash') is distinct from row(latest.id,latest.version_hash)
   and row((p_review->>'replaces_id')::uuid,p_review->>'expected_predecessor_hash') is distinct from row(latest.replaces_id,latest.expected_predecessor_hash) then
   raise exception 'Prescription predecessor identity mismatch' using errcode='PT409';end if;
  return latest;
 end if;
 if latest.id is null then
  if p_review->>'replaces_id' is not null then raise exception 'No predecessor for this prescription identity' using errcode='PT409';end if;
 elsif row(latest.id,latest.version_hash) is distinct from row((p_review->>'replaces_id')::uuid,p_review->>'expected_predecessor_hash') then
  raise exception 'Latest prescription predecessor and rationale required' using errcode='PT409';end if;
 return latest;
end $function$;

-- ezyvet_prescription_source_context(uuid,uuid)
CREATE OR REPLACE FUNCTION public.ezyvet_prescription_source_context(p_pet_id uuid, p_item_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.ezyvet_import_runs;c public.ezyvet_prescriptionitem_runs;
 parent public.ezyvet_import_snapshots;item record;head public.ezyvet_identity_heads;
 items jsonb:='[]';observed_ids jsonb:='[]';consult_context jsonb;
 consult_source public.ezyvet_import_snapshots;consult_head public.ezyvet_identity_heads;
begin
 if p_pet_id is null or p_item_run_id is null then raise exception 'Patient and item run required' using errcode='23514';end if;
 -- Match intake order: item run before mapping/parent/item heads. No fresh page
 -- can change the receipt set while the eventual review request is prepared.
 select * into r from public.ezyvet_import_runs where id=p_item_run_id for share;
 select * into c from public.ezyvet_prescriptionitem_runs where run_id=p_item_run_id;
 if r.id is null or c.run_id is null or c.pet_id is distinct from p_pet_id
  or row(r.resource,r.source_origin,r.source_site_uid,r.requested_by) is distinct from
   row('prescriptionitem'::text,c.source_origin,c.source_site_uid,c.actor_id) then
  raise exception 'Patient-scoped prescription item evidence required' using errcode='42501';
 end if;
 parent:=public.ezyvet_validate_prescriptionitem_prescription(c.animal_link_id,c.source_origin,c.source_site_uid,
  c.prescription_snapshot_id,c.prescription_payload_hash,c.prescription_observed_head_version);
 -- The upstream consult is optional. An unresolved nonempty reference remains
 -- explicit evidence; the future approval validator must not silently accept it.
 if parent.payload->>'consult_id' is null or parent.payload->>'consult_id'='' then
  consult_context:=jsonb_build_object('status','not_supplied','reference',parent.payload->'consult_id');
 else
  select * into consult_head from public.ezyvet_identity_heads where source_origin=c.source_origin
   and source_site_uid=c.source_site_uid and resource='consult' and external_id=parent.payload->>'consult_id' for share;
  select * into consult_source from public.ezyvet_import_snapshots where id=consult_head.snapshot_id;
  if consult_source.id is not null and consult_source.payload->>'animal_id'=c.animal_external_id and exists(
   select 1 from public.ezyvet_clinical_page_observations o join public.ezyvet_clinical_runs cr on cr.run_id=o.run_id
   where o.snapshot_id=consult_source.id and o.head_version=consult_head.version and cr.animal_link_id=c.animal_link_id
    and row(cr.pet_id,cr.client_id,cr.source_origin,cr.source_site_uid,cr.resource)=
     row(c.pet_id,c.client_id,c.source_origin,c.source_site_uid,'consult'::text)
  ) then
   consult_context:=jsonb_build_object('status','resolved','reference',parent.payload->'consult_id',
    'snapshot_id',consult_source.id,'payload_hash',consult_source.payload_hash,'observed_head_version',consult_head.version);
  else consult_context:=jsonb_build_object('status','unresolved','reference',parent.payload->'consult_id');end if;
 end if;
 -- Retain every page observation, including duplicate source IDs. Canonical
 -- external-ID order matches intake's head locking and is independent of UI order.
 for item in
  select s.*,o.head_version observed_version,o.page from public.ezyvet_prescriptionitem_page_observations o
  join public.ezyvet_import_snapshots s on s.id=o.snapshot_id
  where o.run_id=p_item_run_id order by s.external_id,o.page,s.id
 loop
  if row(item.source_origin,item.source_site_uid,item.resource,item.payload->>'prescription_id') is distinct from
   row(c.source_origin,c.source_site_uid,'prescriptionitem'::text,c.prescription_external_id) then
   raise exception 'Prescription item source association changed' using errcode='PT409';
  end if;
  select * into head from public.ezyvet_identity_heads where source_origin=item.source_origin and source_site_uid=item.source_site_uid
   and resource='prescriptionitem' and external_id=item.external_id for share;
  if head.snapshot_id is distinct from item.id or head.version is distinct from item.observed_version then
   raise exception 'SOURCE_PRESCRIPTION_ITEM_STALE' using errcode='PT409';
  end if;
  observed_ids:=observed_ids||jsonb_build_array(item.external_id);
  items:=items||jsonb_build_array(jsonb_build_object('snapshot_id',item.id,'payload_hash',item.payload_hash,
   'observed_head_version',item.observed_version,'external_id',item.external_id,'page',item.page,'original',item.payload));
 end loop;
 return jsonb_build_object('patient_id',c.pet_id,'client_id',c.client_id,'animal_link_id',c.animal_link_id,
  'source',jsonb_build_object('origin',c.source_origin,'site_uid',c.source_site_uid,'animal_id',c.animal_external_id),
  'parent',jsonb_build_object('snapshot_id',parent.id,'payload_hash',parent.payload_hash,
   'observed_head_version',c.prescription_observed_head_version,'external_id',parent.external_id,'original',parent.payload),
  'consult',consult_context,'item_run',jsonb_build_object('id',r.id,'status',r.status,'next_page',r.next_page),
  'items',items,'reconciliation',public.ezyvet_reconcile_prescription_items(parent.payload->'prescription_item_list',observed_ids,r.status='review_ready'));
end;
$function$;

-- ezyvet_vaccination_review_context(uuid,jsonb)
CREATE OR REPLACE FUNCTION public.ezyvet_vaccination_review_context(p_pet_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare m public.ezyvet_record_links;s public.ezyvet_import_snapshots;cs public.ezyvet_import_snapshots;h public.ezyvet_identity_heads;product public.catalog_products; k text;d text;st text;expected text[]:=array['animal_link_id','patient_version','snapshot_id','payload_hash','observed_head_version','consult_snapshot_id','consult_payload_hash','consult_observed_head_version','product_id','product_version','administered_on','administration_date_status','source_next_due_on','next_date_status','status','outside_author','reason','replaces_id','expected_predecessor_hash'];begin
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or (select count(*) from jsonb_object_keys(p_payload))<>cardinality(expected) or exists(select 1 from jsonb_object_keys(p_payload) x where not x=any(expected)) then raise exception 'Exact vaccination review fields required' using errcode='23514';end if;
 foreach k in array array['animal_link_id','snapshot_id','consult_snapshot_id'] loop
  if jsonb_typeof(p_payload->k) is distinct from 'string' or p_payload->>k !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' then raise exception 'Valid source UUID required' using errcode='23514';end if;
 end loop;
 foreach k in array array['payload_hash','consult_payload_hash'] loop
  if jsonb_typeof(p_payload->k) is distinct from 'string' or p_payload->>k !~ '^[a-f0-9]{64}$' then raise exception 'Valid source hash required' using errcode='23514';end if;
 end loop;
 foreach k in array array['patient_version','observed_head_version','consult_observed_head_version'] loop
  if jsonb_typeof(p_payload->k) is distinct from 'number' or p_payload->>k !~ '^[1-9][0-9]{0,9}$' or (p_payload->>k)::numeric>2147483647 then raise exception 'Positive source revision required' using errcode='23514';end if;
 end loop;
 if jsonb_typeof(p_payload->'reason') is distinct from 'string' or length(trim(p_payload->>'reason')) not between 5 and 2000 or p_payload->>'reason'<>trim(p_payload->>'reason') or p_payload->>'status' is null or p_payload->>'status' not in ('administered','not_administered','unknown') or jsonb_typeof(p_payload->'status')<>'string' then raise exception 'Explicit clinical interpretation and rationale required' using errcode='23514';end if;
 if p_payload->'outside_author'<>'null'::jsonb and (jsonb_typeof(p_payload->'outside_author')<>'string' or length(trim(p_payload->>'outside_author')) not between 1 and 500 or p_payload->>'outside_author'<>trim(p_payload->>'outside_author')) then raise exception 'Invalid outside author' using errcode='23514';end if;
 foreach k in array array['administered_on','source_next_due_on'] loop
  d:=p_payload->>k;st:=p_payload->>case when k='administered_on' then 'administration_date_status' else 'next_date_status' end;
  if st is null or st not in ('date','unknown','uninterpreted') or (st='date')<>(d is not null) then raise exception 'Explicit date precision required' using errcode='23514';end if;
  if d is not null then
   if jsonb_typeof(p_payload->k)<>'string' or d !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Date-only value required' using errcode='23514';end if;
   begin if d<>(d::date)::text or not isfinite(d::date) then raise exception 'Invalid date' using errcode='23514';end if;exception when datetime_field_overflow or invalid_datetime_format then raise exception 'Invalid date' using errcode='23514';end;
  end if;
 end loop;
 if (p_payload->>'product_id' is null)<>(p_payload->>'product_version' is null) or (p_payload->>'replaces_id' is null)<>(p_payload->>'expected_predecessor_hash' is null) then raise exception 'Complete product or predecessor pair required' using errcode='23514';end if;
 if p_payload->>'product_id' is not null then
  if jsonb_typeof(p_payload->'product_id')<>'string' or p_payload->>'product_id' !~ '^[a-fA-F0-9-]{36}$' or jsonb_typeof(p_payload->'product_version')<>'number' or p_payload->>'product_version' !~ '^[1-9][0-9]{0,9}$' or (p_payload->>'product_version')::numeric>2147483647 then raise exception 'Valid product version required' using errcode='23514';end if;
 end if;
 if p_payload->>'replaces_id' is not null and(jsonb_typeof(p_payload->'replaces_id')<>'string' or p_payload->>'replaces_id' !~ '^[a-fA-F0-9-]{36}$' or jsonb_typeof(p_payload->'expected_predecessor_hash')<>'string' or p_payload->>'expected_predecessor_hash' !~ '^[a-f0-9]{64}$') then raise exception 'Valid predecessor required' using errcode='23514';end if;
 select * into m from public.ezyvet_record_links where id=(p_payload->>'animal_link_id')::uuid and resource='animal' for share;
 if not found or m.pet_id is distinct from p_pet_id then raise exception 'Same-patient mapping required' using errcode='42501';end if;
 perform 1 from public.pets where id=p_pet_id and client_id=m.client_id and version=(p_payload->>'patient_version')::integer for share;
 if not found then raise exception 'Patient changed; review again' using errcode='PT409';end if;
 cs:=public.ezyvet_validate_vaccination_consult(m.id,m.source_origin,m.source_site_uid,(p_payload->>'consult_snapshot_id')::uuid,p_payload->>'consult_payload_hash',(p_payload->>'consult_observed_head_version')::integer);
 select * into s from public.ezyvet_import_snapshots where id=(p_payload->>'snapshot_id')::uuid;
 if s.id is null or row(s.resource,s.source_origin,s.source_site_uid,s.payload_hash,s.payload->>'consult_id') is distinct from row('vaccination'::text,m.source_origin,m.source_site_uid,p_payload->>'payload_hash',cs.external_id) then raise exception 'Vaccination source identity mismatch' using errcode='42501';end if;
 select * into h from public.ezyvet_identity_heads where source_origin=s.source_origin and source_site_uid=s.source_site_uid and resource='vaccination' and external_id=s.external_id for share;
 if h.snapshot_id is distinct from s.id or h.version is distinct from(p_payload->>'observed_head_version')::integer or not exists(select 1 from public.ezyvet_vaccination_page_observations o join public.ezyvet_vaccination_runs r on r.run_id=o.run_id where o.snapshot_id=s.id and o.head_version=h.version and row(r.animal_link_id,r.pet_id,r.client_id,r.source_origin,r.source_site_uid,r.animal_external_id,r.consult_snapshot_id,r.consult_payload_hash,r.consult_observed_head_version)=row(m.id,p_pet_id,m.client_id,m.source_origin,m.source_site_uid,m.external_id,cs.id,cs.payload_hash,(p_payload->>'consult_observed_head_version')::integer)) then raise exception 'Current scoped vaccination receipt required' using errcode='PT409';end if;
 if p_payload->>'product_id' is not null then select * into product from public.catalog_products where id=(p_payload->>'product_id')::uuid for share;
  if not found or product.version is distinct from(p_payload->>'product_version')::integer or product.kind<>'vaccine' or not product.active then raise exception 'Catalog product changed; review again' using errcode='PT409';end if;
 end if;
 return jsonb_build_object('pet_id',p_pet_id,'client_id',m.client_id,'animal_link_id',m.id,'source',jsonb_build_object('origin',m.source_origin,'site_uid',m.source_site_uid,'animal_id',m.external_id,'vaccination_id',s.external_id),'snapshot_id',s.id,'payload_hash',s.payload_hash,'observed_head_version',h.version,'original',s.payload,'consult',jsonb_build_object('snapshot_id',cs.id,'payload_hash',cs.payload_hash,'observed_head_version',(p_payload->>'consult_observed_head_version')::integer,'external_id',cs.external_id),'reviewed',jsonb_build_object('administered_on',p_payload->'administered_on','administration_date_status',p_payload->'administration_date_status','source_next_due_on',p_payload->'source_next_due_on','next_date_status',p_payload->'next_date_status','status',p_payload->'status','outside_author',p_payload->'outside_author'),'product',case when product.id is not null then jsonb_build_object('id',product.id,'version',product.version,'name',product.name,'kind',product.kind) end);
end $function$;

-- ezyvet_vaccination_review_predecessor(jsonb,jsonb)
CREATE OR REPLACE FUNCTION public.ezyvet_vaccination_review_predecessor(p_context jsonb, p_payload jsonb)
 RETURNS ezyvet_imported_vaccinations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare latest public.ezyvet_imported_vaccinations;interpretation text:=encode(digest(p_context::text,'sha256'),'hex');begin
 select * into latest from public.ezyvet_imported_vaccinations where animal_link_id=(p_context->>'animal_link_id')::uuid and source_origin=p_context#>>'{source,origin}' and source_site_uid=p_context#>>'{source,site_uid}' and vaccination_external_id=p_context#>>'{source,vaccination_id}' order by version desc limit 1;
 if latest.id is not null and latest.interpretation_hash=interpretation then
  if p_payload->>'replaces_id' is not null and row((p_payload->>'replaces_id')::uuid,p_payload->>'expected_predecessor_hash') is distinct from row(latest.id,latest.version_hash) and row((p_payload->>'replaces_id')::uuid,p_payload->>'expected_predecessor_hash') is distinct from row(latest.replaces_id,latest.expected_predecessor_hash) then raise exception 'Vaccination predecessor identity mismatch' using errcode='PT409';end if;
  return latest;end if;
 if latest.id is null then
  if p_payload->>'replaces_id' is not null then raise exception 'No predecessor for this vaccination identity' using errcode='PT409';end if;
 elsif row(latest.id,latest.version_hash) is distinct from row((p_payload->>'replaces_id')::uuid,p_payload->>'expected_predecessor_hash') then raise exception 'Latest vaccination predecessor and rationale required' using errcode='PT409';end if;
 return latest;
end $function$;

-- ezyvet_validate_history_sources(uuid,jsonb)
CREATE OR REPLACE FUNCTION public.ezyvet_validate_history_sources(p_pet_id uuid, p_sources jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare selected_history public.ezyvet_imported_histories;x jsonb;result jsonb:='[]';head record;begin
 if p_sources is null or jsonb_typeof(p_sources)<>'array' or jsonb_array_length(p_sources) not between 1 and 20 or (select count(*)<>count(distinct (v->>'id')::uuid) from jsonb_array_elements(p_sources) v) then raise exception 'Choose one to twenty distinct approved history versions' using errcode='23514';end if;
 if (select count(*)<>count(distinct row(h.animal_link_id,h.history_external_id)) from public.ezyvet_imported_histories h where h.id in(select (v->>'id')::uuid from jsonb_array_elements(p_sources) v)) then raise exception 'Choose one approved version per source history identity' using errcode='23514';end if;
 for head in select distinct sh.source_origin,sh.source_site_uid,sh.resource,sh.external_id from public.ezyvet_imported_histories h join public.ezyvet_identity_heads sh on sh.source_origin=h.source_origin and sh.source_site_uid=h.source_site_uid and ((sh.resource='history' and sh.external_id=h.history_external_id) or(sh.resource='consult' and sh.external_id=h.original->>'consult_id')) where h.id in(select (v->>'id')::uuid from jsonb_array_elements(p_sources) v) order by 1,2,3,4 loop
  perform 1 from public.ezyvet_identity_heads where source_origin=head.source_origin and source_site_uid=head.source_site_uid and resource=head.resource and external_id=head.external_id for share;
 end loop;
 for x in select value from jsonb_array_elements(p_sources) order by value->>'id' loop
  select * into selected_history from public.ezyvet_imported_histories where id=(x->>'id')::uuid;
  if not found or selected_history.pet_id is distinct from p_pet_id or selected_history.version_hash is distinct from x->>'version_hash' or public.ezyvet_history_current(selected_history.id)->>'is_current' is distinct from 'true' then raise exception 'Current approved same-patient history required' using errcode='PT409';end if;
  result:=result||jsonb_build_array(public.ezyvet_imported_history_projection(selected_history.id));
 end loop;return result;
end $function$;

-- ezyvet_validate_prescriptionitem_prescription(uuid,text,text,uuid,text,integer)
CREATE OR REPLACE FUNCTION public.ezyvet_validate_prescriptionitem_prescription(p_animal_link_id uuid, p_source_origin text, p_site_uid text, p_prescription_snapshot_id uuid, p_prescription_payload_hash text, p_prescription_observed_head_version integer)
 RETURNS ezyvet_import_snapshots
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare m public.ezyvet_record_links;s public.ezyvet_import_snapshots;h public.ezyvet_identity_heads;
begin
 select * into m from public.ezyvet_record_links where id=p_animal_link_id and resource='animal' and source_origin=p_source_origin and source_site_uid=p_site_uid for share;
 if not found then raise exception 'Reviewed patient mapping required for this source site' using errcode='42501';end if;
 perform 1 from public.pets where id=m.pet_id and client_id=m.client_id for share;
 if not found then raise exception 'Prescription item patient mapping changed' using errcode='PT409';end if;
 select * into s from public.ezyvet_import_snapshots where id=p_prescription_snapshot_id;
 if s.id is null or row(s.source_origin,s.source_site_uid,s.resource,s.payload_hash,s.payload->>'animal_id') is distinct from row(p_source_origin,p_site_uid,'prescription'::text,p_prescription_payload_hash,m.external_id) then raise exception 'Scoped prescription identity mismatch' using errcode='42501';end if;
 if s.external_id !~ '^(0|[1-9][0-9]{0,15})$' or s.external_id::numeric>9007199254740991 then raise exception 'Invalid prescription external ID' using errcode='23514';end if;
 -- SHARE is compatible across prescriptionitem readers, but blocks prescription observations until commit.
 select * into h from public.ezyvet_identity_heads where source_origin=s.source_origin and source_site_uid=s.source_site_uid and resource='prescription' and external_id=s.external_id for share;
 if h.snapshot_id is distinct from s.id or h.version is distinct from p_prescription_observed_head_version or not exists(
  select 1 from public.ezyvet_prescription_page_observations o join public.ezyvet_prescription_runs c on c.run_id=o.run_id
  where o.snapshot_id=s.id and o.head_version=p_prescription_observed_head_version and c.animal_link_id=m.id
   and row(c.resource,c.source_origin,c.source_site_uid,c.animal_external_id,c.pet_id,c.client_id)=row('prescription'::text,m.source_origin,m.source_site_uid,m.external_id,m.pet_id,m.client_id)
 ) then raise exception 'SOURCE_PRESCRIPTION_STALE' using errcode='PT409';end if;
 return s;
end $function$;

-- ezyvet_validate_release_attachments(uuid,jsonb)
CREATE OR REPLACE FUNCTION public.ezyvet_validate_release_attachments(p_pet_id uuid, p_sources jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v public.ezyvet_attachment_record_versions;r public.ezyvet_attachment_capture_requests;
 c public.ezyvet_attachment_original_captures;i public.ezyvet_attachment_original_intents;
 ref jsonb;parent jsonb;context jsonb;locked record;result jsonb:='[]';
begin
 if auth.role() is distinct from 'service_role' then perform public.clinical_require_staff();end if;
 if p_pet_id is null or p_sources is null or jsonb_typeof(p_sources) is distinct from 'array' then raise exception 'Choose exact reviewed API attachments' using errcode='23514';end if;
 if jsonb_array_length(p_sources) not between 1 and 20 then raise exception 'Choose between1 and20 reviewed API attachments' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_sources) x where jsonb_typeof(x) is distinct from 'object'
  or not(x ?& array['id','record_hash']) or x-array['id','record_hash']<>'{}'
  or jsonb_typeof(x->'id') is distinct from 'string' or x->>'id' !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'
  or jsonb_typeof(x->'record_hash') is distinct from 'string' or x->>'record_hash' !~ '^[a-f0-9]{64}$') then raise exception 'Exact API approval references required' using errcode='23514';end if;
 if(select count(*)<>count(distinct(x->>'id')::uuid) from jsonb_array_elements(p_sources) x) then raise exception 'Distinct API approval references required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_pet_id::text,4700));
 for locked in select distinct animal_link_id from public.ezyvet_attachment_record_versions where pet_id=p_pet_id and id in(select(x->>'id')::uuid from jsonb_array_elements(p_sources) x) order by animal_link_id loop
  perform 1 from public.ezyvet_record_links where id=locked.animal_link_id for share;
 end loop;
 perform 1 from public.pets where id=p_pet_id for share;
 for v in select * from public.ezyvet_attachment_record_versions where pet_id=p_pet_id and id in(select(x->>'id')::uuid from jsonb_array_elements(p_sources) x) order by source_origin,source_site_uid,source_context#>>'{parent,animal_external_id}',id loop
  parent:=public.ezyvet_attachment_parent_context(v.animal_link_id,v.source_origin,v.source_site_uid);
  if parent is distinct from v.source_context->'parent' then raise exception 'Selected API attachment parent changed' using errcode='PT409';end if;
 end loop;
 for locked in select distinct source_origin,source_site_uid,attachment_external_id from public.ezyvet_attachment_record_versions where pet_id=p_pet_id and id in(select(x->>'id')::uuid from jsonb_array_elements(p_sources) x) order by source_origin,source_site_uid,attachment_external_id loop
  perform 1 from public.ezyvet_identity_heads where source_origin=locked.source_origin and source_site_uid=locked.source_site_uid and resource='attachment' and external_id=locked.attachment_external_id for share;
 end loop;
 for locked in select distinct animal_link_id,attachment_external_id from public.ezyvet_attachment_record_versions where pet_id=p_pet_id and id in(select(x->>'id')::uuid from jsonb_array_elements(p_sources) x) order by animal_link_id,attachment_external_id loop
  perform pg_advisory_xact_lock(hashtextextended(locked.animal_link_id::text||':'||locked.attachment_external_id,7301));
 end loop;
 for locked in select distinct cap.storage_object_id from public.ezyvet_attachment_original_captures cap join public.ezyvet_attachment_record_versions approval on approval.request_id=cap.request_id where approval.pet_id=p_pet_id and approval.id in(select(x->>'id')::uuid from jsonb_array_elements(p_sources) x) order by cap.storage_object_id loop
  perform 1 from storage.objects where id=locked.storage_object_id for share;
 end loop;
 if auth.role() is distinct from 'service_role' then perform public.clinical_require_staff();end if;
 for ref in select value from jsonb_array_elements(p_sources) order by(value->>'id')::uuid loop
  select * into v from public.ezyvet_attachment_record_versions where id=(ref->>'id')::uuid;
  if not found or v.pet_id is distinct from p_pet_id or v.record_hash is distinct from ref->>'record_hash'
   or exists(select 1 from public.ezyvet_attachment_record_versions newer where newer.animal_link_id=v.animal_link_id and newer.attachment_external_id=v.attachment_external_id and newer.version>v.version)
   or public.ezyvet_attachment_capture_current(v.request_id) is not true
  then raise exception 'Current latest same-patient API approval required' using errcode='PT409';end if;
  select * into r from public.ezyvet_attachment_capture_requests where id=v.request_id;
  select * into c from public.ezyvet_attachment_original_captures where request_id=v.request_id;
  select * into i from public.ezyvet_attachment_original_intents where id=c.intent_id and request_id=v.request_id;
  context:=jsonb_build_object('capture_contract','canonical_api_original_v1','parent',r.parent_context,
   'run_id',r.run_id,'page',r.page,'ordinal',r.ordinal,'attachment_snapshot_id',r.snapshot_id,
   'attachment_observed_head_version',r.observed_head_version,'attachment_external_id',r.external_id,
   'file_id',r.file_id,'stable_metadata_sha256',r.stable_metadata_sha256,'raw_record_sha256',r.raw_record_sha256,'metadata',r.metadata);
  if r.id is null or c.request_id is null or i.id is null or v.source_context is distinct from context
   or row(r.requested_by,r.pet_id,r.animal_link_id,r.request_hash,r.status,c.capture_hash,c.content_sha256,c.mime_type,c.file_size)
    is distinct from row(v.actor_id,p_pet_id,v.animal_link_id,v.request_hash,'ready'::text,v.capture_hash,i.content_sha256,i.mime_type,i.file_size)
   or not exists(select 1 from storage.objects o where o.id=c.storage_object_id and o.bucket_id=i.bucket_id and o.name=i.object_path and o.metadata->>'size'=i.file_size::text and o.metadata->>'mimetype'=i.mime_type)
  then raise exception 'Exact captured API original unavailable' using errcode='PT409';end if;
  result:=result||jsonb_build_array(jsonb_build_object(
   'record',to_jsonb(v)-'source_context'||jsonb_build_object('source_context',v.source_context-'metadata'),
   'capture',jsonb_build_object('request_id',r.id,'actor_id',r.requested_by,'pet_id',r.pet_id,'capture_hash',c.capture_hash,
    'intent_id',i.id,'storage_object_id',c.storage_object_id,'bucket_id',i.bucket_id,'object_path',i.object_path,
    'content_sha256',c.content_sha256,'file_size',c.file_size,'mime_type',c.mime_type,'entry_method',c.entry_method,'captured_at',c.captured_at)));
 end loop;
 if auth.role() is distinct from 'service_role' then perform public.clinical_require_staff();end if;
 return result;
end $function$;

-- ezyvet_validate_reviewed_prescriptions(uuid,jsonb)
CREATE OR REPLACE FUNCTION public.ezyvet_validate_reviewed_prescriptions(p_pet_id uuid, p_sources jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare rowrecord record;x jsonb;selected_prescription public.ezyvet_imported_prescriptions;result jsonb:='[]';begin
 -- Validate shape before any UUID cast; JSON nulls must fail explicitly.
 if p_pet_id is null or p_sources is null or jsonb_typeof(p_sources)<>'array' then raise exception 'Choose distinct reviewed prescriptions' using errcode='23514';end if;
 if jsonb_array_length(p_sources) not between 1 and 20 then raise exception 'Choose distinct reviewed prescriptions' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_sources) ref where jsonb_typeof(ref) is distinct from 'object' or not(ref ?& array['id','version_hash']) or (ref-'id'-'version_hash')<>'{}'::jsonb or jsonb_typeof(ref->'id') is distinct from 'string' or ref->>'id' !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' or jsonb_typeof(ref->'version_hash') is distinct from 'string' or ref->>'version_hash' !~ '^[a-f0-9]{64}$') then raise exception 'Exact prescription version references required' using errcode='23514';end if;
 if(select count(*)<>count(distinct(value->>'id')::uuid) from jsonb_array_elements(p_sources)) then raise exception 'Choose distinct reviewed prescriptions' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_pet_id::text,4700));
 for rowrecord in select distinct m.id from public.ezyvet_imported_prescriptions v join public.ezyvet_record_links m on m.id=v.animal_link_id where v.pet_id=p_pet_id and v.id in(select(value->>'id')::uuid from jsonb_array_elements(p_sources)) order by m.id loop perform 1 from public.ezyvet_record_links where id=rowrecord.id for share;end loop;
 perform 1 from public.pets where id=p_pet_id for share;
 for rowrecord in select distinct h.source_origin,h.source_site_uid,h.resource,h.external_id from public.ezyvet_imported_prescriptions v join public.ezyvet_identity_heads h on h.source_origin=v.source_origin and h.source_site_uid=v.source_site_uid and((h.resource='consult' and h.external_id=v.context#>>'{consult,reference}') or(h.resource='prescription' and h.external_id=v.prescription_external_id) or(h.resource='prescriptionitem' and exists(select 1 from jsonb_array_elements(v.context->'items') i where i->>'external_id'=h.external_id))) where v.pet_id=p_pet_id and v.id in(select(value->>'id')::uuid from jsonb_array_elements(p_sources)) order by 1,2,3,4 loop
  perform 1 from public.ezyvet_identity_heads where source_origin=rowrecord.source_origin and source_site_uid=rowrecord.source_site_uid and resource=rowrecord.resource and external_id=rowrecord.external_id for share;
 end loop;
 for x in select value from jsonb_array_elements(p_sources) order by value->>'id' loop
  select * into selected_prescription from public.ezyvet_imported_prescriptions where id=(x->>'id')::uuid;
  if not found or selected_prescription.pet_id is distinct from p_pet_id or selected_prescription.version_hash is distinct from x->>'version_hash' or public.ezyvet_prescription_current(selected_prescription.id)->>'is_current' is distinct from 'true' or public.ezyvet_prescription_current(selected_prescription.id)->>'is_latest' is distinct from 'true' then raise exception 'Current latest same-patient reviewed prescription required' using errcode='PT409';end if;
  result:=result||jsonb_build_array(public.ezyvet_imported_prescription_projection(selected_prescription.id));
 end loop;return result;end $function$;

-- ezyvet_validate_reviewed_vaccinations(uuid,jsonb)
CREATE OR REPLACE FUNCTION public.ezyvet_validate_reviewed_vaccinations(p_pet_id uuid, p_sources jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare rowrecord record;x jsonb;selected_vaccination public.ezyvet_imported_vaccinations;result jsonb:='[]';begin
 if p_sources is null or jsonb_typeof(p_sources)<>'array' or jsonb_array_length(p_sources) not between 1 and 20 or(select count(*)<>count(distinct(value->>'id')::uuid) from jsonb_array_elements(p_sources)) then raise exception 'Choose distinct reviewed vaccinations' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_sources) ref where jsonb_typeof(ref)<>'object' or not(ref ?& array['id','version_hash']) or (ref-'id'-'version_hash')<>'{}'::jsonb or jsonb_typeof(ref->'id') is distinct from 'string' or ref->>'id' !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' or jsonb_typeof(ref->'version_hash') is distinct from 'string' or ref->>'version_hash' !~ '^[a-f0-9]{64}$') then raise exception 'Exact vaccination version references required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_pet_id::text,4700));
 for rowrecord in select distinct m.id from public.ezyvet_imported_vaccinations v join public.ezyvet_record_links m on m.id=v.animal_link_id where v.id in(select(value->>'id')::uuid from jsonb_array_elements(p_sources)) order by m.id loop perform 1 from public.ezyvet_record_links where id=rowrecord.id for share;end loop;
 perform 1 from public.pets where id=p_pet_id for share;
 for rowrecord in select distinct h.source_origin,h.source_site_uid,h.resource,h.external_id from public.ezyvet_imported_vaccinations v join public.ezyvet_identity_heads h on h.source_origin=v.source_origin and h.source_site_uid=v.source_site_uid and((h.resource='consult' and h.external_id=v.consult->>'external_id') or(h.resource='vaccination' and h.external_id=v.vaccination_external_id)) where v.id in(select(value->>'id')::uuid from jsonb_array_elements(p_sources)) order by 1,2,3,4 loop
  perform 1 from public.ezyvet_identity_heads where source_origin=rowrecord.source_origin and source_site_uid=rowrecord.source_site_uid and resource=rowrecord.resource and external_id=rowrecord.external_id for share;
 end loop;
 for x in select value from jsonb_array_elements(p_sources) order by value->>'id' loop
  select * into selected_vaccination from public.ezyvet_imported_vaccinations where id=(x->>'id')::uuid;
  if not found or selected_vaccination.pet_id is distinct from p_pet_id or selected_vaccination.version_hash is distinct from x->>'version_hash' or public.ezyvet_vaccination_current(selected_vaccination.id)->>'is_current' is distinct from 'true' or public.ezyvet_vaccination_current(selected_vaccination.id)->>'is_latest' is distinct from 'true' then raise exception 'Current latest same-patient reviewed vaccination required' using errcode='PT409';end if;
  result:=result||jsonb_build_array(public.ezyvet_imported_vaccination_projection(selected_vaccination.id));
 end loop;return result;end $function$;

-- ezyvet_validate_vaccination_consult(uuid,text,text,uuid,text,integer)
CREATE OR REPLACE FUNCTION public.ezyvet_validate_vaccination_consult(p_animal_link_id uuid, p_source_origin text, p_site_uid text, p_consult_snapshot_id uuid, p_consult_payload_hash text, p_consult_observed_head_version integer)
 RETURNS ezyvet_import_snapshots
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare m public.ezyvet_record_links;s public.ezyvet_import_snapshots;h public.ezyvet_identity_heads;
begin
 select * into m from public.ezyvet_record_links where id=p_animal_link_id and resource='animal' and source_origin=p_source_origin and source_site_uid=p_site_uid for share;
 if not found then raise exception 'Reviewed patient mapping required for this source site' using errcode='42501';end if;
 perform 1 from public.pets where id=m.pet_id and client_id=m.client_id for share;
 if not found then raise exception 'Vaccination patient mapping changed' using errcode='PT409';end if;
 select * into s from public.ezyvet_import_snapshots where id=p_consult_snapshot_id;
 if s.id is null or row(s.source_origin,s.source_site_uid,s.resource,s.payload_hash,s.payload->>'animal_id') is distinct from row(p_source_origin,p_site_uid,'consult'::text,p_consult_payload_hash,m.external_id) then raise exception 'Scoped consult identity mismatch' using errcode='42501';end if;
 if s.external_id !~ '^(0|[1-9][0-9]{0,15})$' or s.external_id::numeric>9007199254740991 then raise exception 'Invalid consult external ID' using errcode='23514';end if;
 -- SHARE is compatible across vaccination readers, but blocks consult observations until commit.
 select * into h from public.ezyvet_identity_heads where source_origin=s.source_origin and source_site_uid=s.source_site_uid and resource='consult' and external_id=s.external_id for share;
 if h.snapshot_id is distinct from s.id or h.version is distinct from p_consult_observed_head_version or not exists(
  select 1 from public.ezyvet_clinical_page_observations o join public.ezyvet_clinical_runs c on c.run_id=o.run_id
  where o.snapshot_id=s.id and o.head_version=p_consult_observed_head_version and c.animal_link_id=m.id
   and row(c.resource,c.source_origin,c.source_site_uid,c.animal_external_id,c.pet_id,c.client_id)=row('consult'::text,m.source_origin,m.source_site_uid,m.external_id,m.pet_id,m.client_id)
 ) then raise exception 'SOURCE_CONSULT_STALE' using errcode='PT409';end if;
 return s;
end $function$;

-- fail_ezyvet_attachment_capture(uuid,uuid,uuid,text,integer,boolean)
CREATE OR REPLACE FUNCTION public.fail_ezyvet_attachment_capture(p_id uuid, p_actor uuid, p_lease_id uuid, p_code text, p_retry_seconds integer, p_terminal boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.ezyvet_attachment_capture_requests;f public.ezyvet_attachment_capture_failures;begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_code is null or p_code not in('UPSTREAM_UNAVAILABLE','RATE_LIMITED','UPSTREAM_AUTH_FAILED','UPSTREAM_SCOPE_DENIED','SOURCE_ATTACHMENT_PARENT_STALE','SOURCE_ATTACHMENT_STALE','SOURCE_ATTACHMENT_METADATA_CHANGED','ATTACHMENT_UNSUPPORTED_TYPE','ATTACHMENT_INVALID_CONTENT','ATTACHMENT_TOO_LARGE','STORAGE_UNAVAILABLE','STORAGE_OBJECT_CHANGED','CAPTURE_UNAVAILABLE') or p_terminal is null or p_retry_seconds is null or(p_terminal and p_retry_seconds<>0) or(not p_terminal and p_retry_seconds not between 1 and 3600) then raise exception 'Bounded safe capture failure required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,7000));
 select * into r from public.ezyvet_attachment_capture_requests where id=p_id for update;
 if r.id is null or r.requested_by is distinct from p_actor then raise exception 'Capture owner mismatch' using errcode='42501';end if;
 select * into f from public.ezyvet_attachment_capture_failures where lease_id=p_lease_id;
 if found then
  if row(f.request_id,f.code,f.retry_seconds,f.terminal) is distinct from row(p_id,p_code,p_retry_seconds,p_terminal) then raise exception 'Recorded failure is immutable' using errcode='23514';end if;
  return public.ezyvet_attachment_capture_private(p_id);
 end if;
 if r.status not in('prepared','reserved') or p_lease_id is null or r.lease_id is distinct from p_lease_id then raise exception 'Capture worker superseded' using errcode='PT409';end if;
 perform pg_advisory_xact_lock(hashtextextended((r.parent_context->>'source_origin')||':'||(r.parent_context->>'source_site_uid')||':attachment',0));
 insert into public.ezyvet_attachment_capture_failures(lease_id,request_id,code,retry_seconds,terminal) values(p_lease_id,p_id,p_code,p_retry_seconds,p_terminal);
 update public.ezyvet_attachment_capture_requests set status=case when p_terminal then 'blocked' else status end,lease_id=null,lease_until=null,retry_after=case when p_terminal then null else clock_timestamp()+make_interval(secs=>p_retry_seconds) end,last_error_code=p_code,updated_at=clock_timestamp() where id=p_id and requested_by=p_actor;
 return public.ezyvet_attachment_capture_private(p_id);
end $function$;

-- finalize_inbound_attachment(uuid,uuid,uuid,text,bigint,text)
CREATE OR REPLACE FUNCTION public.finalize_inbound_attachment(p_id uuid, p_actor_id uuid, p_token uuid, p_sha256 text, p_byte_length bigint, p_mime_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare capture public.inbound_attachment_captures;incoming public.communication_inbound;object_meta jsonb;
begin
 perform public.communication_require_service();
 select * into capture from public.inbound_attachment_captures where id=p_id;
 if not found then raise exception 'Capture unavailable' using errcode='42501';end if;
 -- Consistent lock order with claim and inbound assignment.
 select * into incoming from public.communication_inbound where id=capture.inbound_id for update;
 select * into capture from public.inbound_attachment_captures where id=p_id for update;
 if incoming.provider not in ('resend','agentmail') or incoming.channel<>'EMAIL' or incoming.message_id is null
  or not exists(select 1 from public.messages m join public.conversations c on c.id=m.conversation_id where m.id=incoming.message_id and m.conversation_id=incoming.conversation_id and c.client_id=incoming.client_id and m.sender_type='CLIENT' and m.type='EMAIL' and not m.is_internal)
  or public.is_active_staff(p_actor_id) is not true or capture.actor_id is distinct from p_actor_id or capture.lease_token is distinct from p_token
  or row(capture.message_id,capture.inbound_version,capture.email_id) is distinct from row(incoming.message_id,incoming.version,incoming.resource_id::uuid)
  or not exists(select 1 from jsonb_array_elements(incoming.attachment_metadata) item where
    jsonb_build_object('id',item->>'id','filename',item->'filename','content_type',item->>'content_type','size',item->'size')=capture.metadata) then
  raise exception 'Incoming capture association or lease changed' using errcode='42501';end if;
 if p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$' or p_byte_length is distinct from (capture.metadata->>'size')::bigint
  or p_mime_type is distinct from capture.metadata->>'content_type' then
  raise exception 'Incoming captured bytes differ' using errcode='23514';end if;
 if capture.status='ready' then
  if capture.sha256 is distinct from p_sha256 then raise exception 'Incoming captured bytes changed' using errcode='23514';end if;
  return public.inbound_capture_receipt(capture);
 end if;
 if capture.lease_expires_at<=clock_timestamp() then raise exception 'Capture lease expired' using errcode='PT409';end if;
 select metadata into object_meta from storage.objects where bucket_id='inbound-attachment-originals' and name=capture.storage_path for share;
 if not found or object_meta->>'size' is distinct from p_byte_length::text or object_meta->>'mimetype' is distinct from p_mime_type then
  raise exception 'Stored incoming original does not match' using errcode='23514';end if;
 update public.inbound_attachment_captures set status='ready',sha256=p_sha256,captured_at=clock_timestamp(),lease_expires_at=null where id=p_id returning * into capture;
 return public.inbound_capture_receipt(capture);
end $function$;

-- finish_communication_attempt(uuid,uuid,text,text,text)
CREATE OR REPLACE FUNCTION public.finish_communication_attempt(p_id uuid, p_lease_token uuid, p_outcome text, p_provider_message_id text, p_error_code text)
 RETURNS communication_outbox
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result public.communication_outbox;
begin
 perform public.communication_require_service();
 if p_outcome is null or p_outcome not in ('accepted','failed','uncertain') or (p_outcome='accepted' and (p_provider_message_id is null or length(p_provider_message_id) not between 1 and 200)) or length(p_error_code)>200 then raise exception 'Invalid provider outcome' using errcode='23514'; end if;
 select * into result from public.communication_outbox where id=p_id for update;
 if not found or result.state<>'claimed' or result.lease_token is distinct from p_lease_token or result.attempt_started_at is null then raise exception 'Outbox attempt is unavailable; reconcile provider outcome' using errcode='PT409'; end if;
 update public.communication_attempts set outcome=p_outcome,finished_at=now(),provider_message_id=p_provider_message_id,error_code=p_error_code where lease_token=p_lease_token;
 update public.communication_outbox set state=p_outcome,provider_message_id=p_provider_message_id,last_error=p_error_code,accepted_at=case when p_outcome='accepted' then now() else accepted_at end,lease_token=null,lease_expires_at=null,updated_at=now() where id=p_id returning * into result;
 return result;
end $function$;

-- get_ezyvet_prescription_review_candidate(uuid,uuid)
CREATE OR REPLACE FUNCTION public.get_ezyvet_prescription_review_candidate(p_pet_id uuid, p_item_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.ezyvet_import_runs;c public.ezyvet_prescriptionitem_runs;parent public.ezyvet_import_snapshots;
 context jsonb;items jsonb;observed_ids jsonb;patient_version integer;eligible boolean:=true;unavailable text;
begin
 perform public.ezyvet_prescription_require_dvm();
 if p_pet_id is null or p_item_run_id is null then raise exception 'Patient and scoped item run required' using errcode='23514';end if;
 -- Match the collector/intake lock order. Saved observations cannot change
 -- midway through the preview, including when current eligibility has failed.
 select * into r from public.ezyvet_import_runs where id=p_item_run_id for share;
 select * into c from public.ezyvet_prescriptionitem_runs where run_id=p_item_run_id;
 if r.id is null or c.run_id is null or c.pet_id is distinct from p_pet_id
  or row(r.resource,r.source_origin,r.source_site_uid,r.requested_by) is distinct from row('prescriptionitem'::text,c.source_origin,c.source_site_uid,c.actor_id) then
  raise exception 'Patient-scoped prescription item evidence required' using errcode='42501';end if;
 begin
  context:=public.ezyvet_prescription_source_context(p_pet_id,p_item_run_id);
  if context#>>'{consult,status}'='unresolved' then eligible:=false;unavailable:='SOURCE_CONSULT_UNRESOLVED';end if;
 exception when sqlstate 'PT409' or sqlstate '42501' then
  -- Only expected stale/association failures become inspectable unavailability.
  -- Operational errors still propagate; no stale preview is eligible to prepare.
  eligible:=false;unavailable:='SOURCE_CONTEXT_CHANGED';
 end;
 if context is null then
  select * into parent from public.ezyvet_import_snapshots where id=c.prescription_snapshot_id;
  select coalesce(jsonb_agg(jsonb_build_object('snapshot_id',s.id,'payload_hash',s.payload_hash,'observed_head_version',o.head_version,
   'external_id',s.external_id,'page',o.page,'original',s.payload) order by s.external_id,o.page,s.id),'[]'),
   coalesce(jsonb_agg(to_jsonb(s.external_id) order by s.external_id,o.page,s.id),'[]') into items,observed_ids
   from public.ezyvet_prescriptionitem_page_observations o join public.ezyvet_import_snapshots s on s.id=o.snapshot_id where o.run_id=p_item_run_id;
  context:=jsonb_build_object('patient_id',c.pet_id,'client_id',c.client_id,'animal_link_id',c.animal_link_id,
   'source',jsonb_build_object('origin',c.source_origin,'site_uid',c.source_site_uid,'animal_id',c.animal_external_id),
   'parent',jsonb_build_object('snapshot_id',parent.id,'payload_hash',parent.payload_hash,'observed_head_version',c.prescription_observed_head_version,
    'external_id',c.prescription_external_id,'original',parent.payload),
   'consult',jsonb_build_object('status','not_checked','reference',parent.payload->'consult_id'),
   'item_run',jsonb_build_object('id',r.id,'status',r.status,'next_page',r.next_page),'items',items,
   'reconciliation',public.ezyvet_reconcile_prescription_items(parent.payload->'prescription_item_list',observed_ids,r.status='review_ready'));
 end if;
 select version into patient_version from public.pets where id=p_pet_id;
 return jsonb_build_object('run',public.ezyvet_prescriptionitem_run_projection(p_item_run_id),'patient_version',patient_version,
  'source_context',context,'eligible_for_review',eligible,'unavailable_reason',unavailable);
end $function$;

-- issue_billing_invoice(uuid,integer)
CREATE OR REPLACE FUNCTION public.issue_billing_invoice(p_id uuid, p_expected_version integer)
 RETURNS billing_invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result public.billing_invoices;
begin
 perform public.clinical_require_staff();
 select * into result from public.billing_invoices where id=p_id for update;
 if not found or result.version<>p_expected_version or result.status<>'draft' then raise exception 'Invoice changed; reload before issuing' using errcode='PT409'; end if;
 if not exists(select 1 from public.billing_invoice_items where invoice_id=p_id) then raise exception 'Invoice requires at least one item' using errcode='23514'; end if;
 update public.billing_invoices set status='issued',issued_at=now(),total_cents=(select sum(amount_cents) from public.billing_invoice_items where invoice_id=p_id) where id=p_id returning * into result;
 return result;
end $function$;

-- issue_vaccine_certificate(uuid,uuid,text,uuid,jsonb,jsonb,text,boolean,uuid,text)
CREATE OR REPLACE FUNCTION public.issue_vaccine_certificate(p_id uuid, p_pet_id uuid, p_kind text, p_rabies_treatment_id uuid, p_details jsonb, p_reviewed_snapshot jsonb, p_signature_name text, p_attest_review boolean, p_replaces_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text)
 RETURNS vaccine_certificates
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare issuer public.certificate_issuers:=public.certificate_require_issuer(); result public.vaccine_certificates; expected jsonb; request_data jsonb; prior public.vaccine_certificates;
begin
 if p_id is null or p_attest_review is distinct from true or p_signature_name is distinct from issuer.full_name then raise exception 'Explicit review and matching typed veterinarian signature are required' using errcode='23514'; end if;
 request_data:=jsonb_build_object('pet_id',p_pet_id,'kind',p_kind,'rabies_treatment_id',p_rabies_treatment_id,'details',p_details,'reviewed_snapshot',p_reviewed_snapshot,'signature_name',p_signature_name,'attest_review',p_attest_review,'replaces_id',p_replaces_id,'reason',p_reason);
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,8));
 select * into result from public.vaccine_certificates where id=p_id;
 if found then
  if result.issued_by<>auth.uid() or result.request is distinct from request_data then raise exception 'Certificate identifier already used' using errcode='23514'; end if;
  return result;
 end if;
 expected:=public.preview_vaccine_certificate(p_pet_id,p_kind,p_rabies_treatment_id,p_details);
 if expected is distinct from p_reviewed_snapshot then raise exception 'Certificate details changed; reload and review before issuing' using errcode='PT409'; end if;
 if p_replaces_id is not null then
  select * into prior from public.vaccine_certificates where id=p_replaces_id for update;
  if not found or prior.pet_id<>p_pet_id or prior.kind<>p_kind or length(trim(coalesce(p_reason,''))) not between 1 and 2000 then raise exception 'Reissue requires matching patient, certificate type and reason' using errcode='23514'; end if;
  if exists(select 1 from public.vaccine_certificate_events where certificate_id=p_replaces_id and kind='superseded') then raise exception 'Certificate already reissued; reload its successor' using errcode='PT409'; end if;
 elsif p_reason is not null then raise exception 'Reason requires a certificate being replaced' using errcode='23514'; end if;
 insert into public.vaccine_certificates(id,pet_id,kind,snapshot,request,replaces_id,issued_by,signature_name,attestation) values(p_id,p_pet_id,p_kind,expected,request_data,p_replaces_id,auth.uid(),p_signature_name,case when p_kind='rabies' then 'I reviewed this complete certificate and its due date, confirm this was a rabies vaccine administered by me or under my supervision by the named administrator trained in vaccine storage, handling, administration and adverse-event management, and explicitly sign this certificate.' else 'I reviewed the patient identity, included vaccination history and the patient due-plan snapshot, including any plans awaiting review, and explicitly sign this certificate. The reviewed plan dates apply to this snapshot at issuance; no vaccine equivalence or due date was inferred. This is not a rabies certificate.' end) returning * into result;
 insert into public.vaccine_certificate_treatments(certificate_id,treatment_id) select p_id,(v->>'treatment_id')::uuid from jsonb_array_elements(expected->'vaccinations') v;
 if p_replaces_id is not null then insert into public.vaccine_certificate_events(id,certificate_id,kind,reason,replacement_id,created_by) values(p_id,p_replaces_id,'superseded',trim(p_reason),p_id,auth.uid()); end if;
 return result;
end $function$;

-- lab_report_capture_context(uuid,uuid)
CREATE OR REPLACE FUNCTION public.lab_report_capture_context(p_receipt_id uuid, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.lab_report_receipts;d public.patient_documents;
begin
 select * into r from public.lab_report_receipts where id=p_receipt_id and actor_id=p_actor_id;
 if not found or not public.is_active_staff(p_actor_id) then raise exception 'Staged receipt actor unavailable' using errcode='42501';end if;
 select * into d from public.patient_documents where id=r.document_id and pet_id=r.pet_id and status='ready' and version=r.document_version for share;
 if not found then raise exception 'Original document no longer ready at staged version' using errcode='PT409';end if;
 return jsonb_build_object('receipt',to_jsonb(r),'document',jsonb_build_object('id',d.id,'version',d.version,'bucket','patient-documents','file_path',d.file_path,'mime_type',d.mime_type,'file_size',d.file_size),'capture',(select to_jsonb(c) from public.lab_report_byte_captures c where receipt_id=r.id));
end $function$;

-- link_lab_report_version(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,text,text,boolean)
CREATE OR REPLACE FUNCTION public.link_lab_report_version(p_id uuid, p_receipt_id uuid, p_expected_receipt_hash text, p_expected_capture_hash text, p_order_id uuid, p_pet_id uuid, p_expected_order_version integer, p_source_review_id uuid, p_previous_report_id uuid, p_kind text, p_review_reason text, p_attest boolean)
 RETURNS lab_report_versions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid:=public.clinical_require_staff();r public.lab_report_versions;o public.patient_lab_orders;s public.lab_order_source_reviews;receipt public.lab_report_receipts;capture public.lab_report_byte_captures;prior public.lab_report_versions;
begin
 if p_id is null or p_attest is distinct from true or p_kind is null or p_kind not in ('original','corrected') or p_review_reason is null or length(trim(p_review_reason)) not between 1 and 2000 then raise exception 'Explicit report provenance review required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,4103));
 select * into r from public.lab_report_versions where id=p_id;
 if found then if row(r.actor_id,r.receipt_id,r.receipt_hash,r.capture_hash,r.order_id,r.pet_id,r.order_version,r.source_review_id,r.previous_report_id,r.kind,r.review_reason) is distinct from row(actor,p_receipt_id,p_expected_receipt_hash,p_expected_capture_hash,p_order_id,p_pet_id,p_expected_order_version,p_source_review_id,p_previous_report_id,p_kind,p_review_reason) then raise exception 'Report review UUID already used' using errcode='23505';end if;return r;end if;
 select * into o from public.patient_lab_orders where id=p_order_id and pet_id=p_pet_id for update;
 if not found then raise exception 'Lab order belongs to another patient or is unavailable' using errcode='42501';end if;
 if o.version is distinct from p_expected_order_version then raise exception 'Lab order changed' using errcode='PT409';end if;
 select * into s from public.lab_order_source_reviews where order_id=o.id order by revision desc limit 1;
 if s.id is null or s.id is distinct from p_source_review_id then raise exception 'Review current source identity mapping' using errcode='PT409';end if;
 select * into receipt from public.lab_report_receipts where id=p_receipt_id;
 if receipt.id is null or receipt.receipt_hash is distinct from p_expected_receipt_hash or row(receipt.pet_id,receipt.source_account_id,receipt.source_patient_reference,receipt.source_order_reference) is distinct from row(o.pet_id,s.source_account_id,s.source_patient_reference,s.source_order_reference) then raise exception 'Report patient or source identity does not match reviewed order' using errcode='42501';end if;
 select * into capture from public.lab_report_byte_captures where receipt_id=receipt.id;
 if capture.receipt_id is null or capture.capture_hash is distinct from p_expected_capture_hash then raise exception 'Verified original byte capture and explicit review required' using errcode='42501';end if;
 perform 1 from public.patient_documents where id=receipt.document_id and pet_id=o.pet_id and status='ready' and version=receipt.document_version for share;
 if not found then raise exception 'Report document is no longer ready at reviewed version' using errcode='PT409';end if;
 select * into prior from public.lab_report_versions where order_id=o.id order by version desc limit 1;
 if prior.id is distinct from p_previous_report_id then raise exception 'Report history changed; review the current version' using errcode='PT409';end if;
 if (prior.id is null and p_kind<>'original') or (prior.id is not null and (p_kind<>'corrected' or prior.document_id=receipt.document_id or (select source_account_id from public.lab_report_receipts where id=prior.receipt_id)<>receipt.source_account_id)) then raise exception 'Corrected report requires a new document within the same source account' using errcode='23514';end if;
 insert into public.lab_report_versions(id,actor_id,order_id,pet_id,order_version,source_review_id,receipt_id,receipt_hash,capture_hash,document_id,document_version,previous_report_id,version,kind,review_reason) values(p_id,actor,o.id,o.pet_id,o.version,s.id,receipt.id,receipt.receipt_hash,capture.capture_hash,receipt.document_id,receipt.document_version,prior.id,coalesce(prior.version,0)+1,p_kind,p_review_reason) returning * into r;return r;
end $function$;

-- native_estdec_access(uuid,text,text,text,boolean)
CREATE OR REPLACE FUNCTION public.native_estdec_access(p_grant_id uuid, p_token_hash text, p_origin text, p_key_version text, p_current boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare g jsonb:=public.native_estdec_verified_grant(p_grant_id); c public.native_estimate_decision_grant_captures; life jsonb;
begin
  select * into c from public.native_estimate_decision_grant_captures where grant_id=p_grant_id;
  if g is null or c.grant_id is null or p_token_hash is null or c.token_hash is distinct from p_token_hash
    or c.origin is distinct from p_origin or c.key_version is distinct from p_key_version
    or g->>'state'<>'active' or not public.is_active_staff((g->>'actor_id')::uuid)
    or clock_timestamp()>=(g#>>'{request,expires_at}')::timestamptz then
    raise exception 'Estimate access unavailable' using errcode='42501'; end if;
  if p_current then
    life:=public.native_estpub_lifecycle((g#>>'{request,binding,target,estimate_id}')::uuid);
    if life#>'{current,id}' is distinct from g#>'{request,binding,publication_id}' then raise exception 'Estimate publication changed' using errcode='PT409'; end if;
  end if;
  return g;
end $function$;

-- native_estdec_current(jsonb,jsonb)
CREATE OR REPLACE FUNCTION public.native_estdec_current(p_binding jsonb, p_head jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare life jsonb:=public.native_estpub_lifecycle((p_binding#>>'{target,estimate_id}')::uuid); pub jsonb;
begin
  pub:=public.native_estdec_publication(p_binding,life);
  if life->'head' is distinct from p_head or life#>'{current,id}' is distinct from p_binding->'publication_id' then raise exception 'Estimate publication changed' using errcode='PT409'; end if;
  if clock_timestamp()>=(pub->>'expires_at')::timestamptz then raise exception 'Estimate deadline expired' using errcode='23514'; end if;
  if exists(select 1 from public.native_estimate_decisions d where d.publication_id=(pub->>'id')::uuid) then
    perform public.native_estdec_verified_state((p_binding#>>'{target,estimate_id}')::uuid);
    raise exception 'Estimate already decided' using errcode='23514';
  end if;
  return pub;
end $function$;

-- native_estpub_context(uuid,uuid,integer)
CREATE OR REPLACE FUNCTION public.native_estpub_context(p_estimate_id uuid, p_client_id uuid, p_draft_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d jsonb;
  l jsonb;
  c public.clients;
  p public.pets;
  v integer;
begin
  perform
    pg_advisory_xact_lock(hashtextextended('native-estimate:' || p_estimate_id::text, 0));
  perform
    public.clinical_require_staff ();
  l := public.native_estpub_lifecycle (p_estimate_id);
  if p_client_id is null or l #>> '{target,client_id}' is distinct from p_client_id::text then
    raise exception 'Publication household mismatch'
      using errcode = '23514';
  end if;
  select
    max(r.version)
  into
    v
  from
    public.native_estimate_draft_revisions r
  where
    r.estimate_id = p_estimate_id;
  if p_draft_version is distinct from v then
    raise exception 'Estimate draft changed'
      using errcode = 'PT409';
  end if;
  d := public.native_estimate_verified_revision (p_estimate_id, v);
  select
    *
  into
    c
  from
    public.clients cl
  where
    cl.id = p_client_id for share;
  select
    *
  into
    p
  from
    public.pets pt
  where
    pt.id = (d ->> 'pet_id')::uuid for share;
  perform
    public.clinical_require_staff ();
  if c.id is null or p.id is null or p.client_id <> c.id then
    raise exception 'Current publication household and patient mismatch'
      using errcode = '23514';
  end if;
  return jsonb_build_object('target', l -> 'target', 'draft', d, 'draft_record_hash', (
      select
        r.record_hash
      from public.native_estimate_draft_revisions r
      where
        r.estimate_id = p_estimate_id
        and r.version = v), 'publication_head', l -> 'head', 'current_publication_id', l #> '{current,id}', 'practice', public.native_estpub_practice (), 'client', jsonb_build_object('id', c.id, 'version', c.version, 'name', c.full_name, 'mailing_address', nullif (btrim(c.mailing_address), '')),'patient',jsonb_build_object('id',p.id,'version',p.version,'name',p.name,'species',p.species,'breed',nullif(btrim(p.breed),'')));
end
$function$;

-- native_estpub_record(uuid,jsonb)
CREATE OR REPLACE FUNCTION public.native_estpub_record(p_id uuid, p_mutation jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := public.clinical_require_staff ();
  q jsonb := p_mutation -> 'request';
  l jsonb;
  p jsonb;
  c jsonb;
  d jsonb;
  pub jsonb;
  old jsonb;
  root_id uuid;
  stamp timestamptz;
  ver integer;
begin
  if p_id is null then
    raise exception 'Publication operation id required'
      using errcode = '23514';
  end if;
  perform
    public.native_estpub_mutation (p_mutation);
  perform
    pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  perform
    public.clinical_require_staff ();
  old := public.native_estpub_receipt (p_id);
  if old is not null then
    if old ->> 'actor_id' <> actor::text then
      raise exception 'Publication receipt unavailable'
        using errcode = '42501';
    end if;
    if old -> 'mutation' is distinct from p_mutation then
      raise exception 'Publication operation id already used'
        using errcode = '23514';
    end if;
    return old;
  end if;
  old := public.native_estpub_closure (p_id);
  if old is not null then
    if old ->> 'actor_id' <> actor::text then
      raise exception 'Publication closure unavailable'
        using errcode = '42501';
    end if;
    raise exception 'Publication operation permanently closed'
      using errcode = '23514';
  end if;
  root_id := (q #>> '{target,estimate_id}')::uuid;
  perform
    pg_advisory_xact_lock(hashtextextended('native-estimate:' || root_id::text, 0));
  perform
    public.clinical_require_staff ();
  l := public.native_estpub_lifecycle (root_id);
  if q -> 'target' is distinct from l -> 'target' then
    raise exception 'Publication target mismatch'
      using errcode = '23514';
  end if;
  if q -> 'expected_publication_head' is distinct from l -> 'head' then
    raise exception 'Publication lifecycle changed'
      using errcode = 'PT409';
  end if;
  if l #>> '{head,version}' = '2147483647' then
    raise exception 'Publication history version limit'
      using errcode = '23514';
  end if;
  ver := (l #>> '{head,version}')::integer + 1;
  if p_mutation ->> 'kind' = 'publish' then
    p := public.native_estpub_preparation ((q ->> 'preparation_id')::uuid);
    if p is null or p ->> 'actor_id' <> actor::text then
      raise exception 'Publication preparation unavailable'
        using errcode = '42501';
    end if;
    if p #> '{request,target}' is distinct from q -> 'target' or p #> '{request,draft_version}' is distinct from q -> 'expected_draft_version' or p -> 'content_hash' is distinct from q -> 'expected_content_hash' or p #> '{artifact,sha256}' is distinct from q -> 'expected_artifact_hash' then
      raise exception 'Exact captured preparation required'
        using errcode = '23514';
    end if;
    c := public.native_estpub_context (root_id, (q #>> '{target,client_id}')::uuid, (q ->> 'expected_draft_version')::integer);
    if c is distinct from p -> 'context' or q -> 'replaces_publication_id' is distinct from coalesce(l #> '{current,id}', 'null'::jsonb) then
      raise exception 'Prepared publication source changed'
        using errcode = 'PT409';
    end if;
    stamp := greatest (clock_timestamp(), (
      select
        max(ev.created_at)
      from public.native_estimate_publication_events ev
      where
        ev.estimate_id = root_id), (
        select
          a.captured_at
        from public.native_estimate_publication_artifacts a
        where
          a.id = (p ->> 'id')::uuid));
    if stamp >= (p #>> '{snapshot,acceptance,expires_at}')::timestamptz then
      raise exception 'Estimate acceptance deadline expired'
        using errcode = '23514';
    end if;
    pub := jsonb_build_object('id', p_id, 'target', q -> 'target', 'preparation_id', q -> 'preparation_id', 'draft_version', q -> 'expected_draft_version', 'draft_record_hash', p #> '{snapshot,draft_record_hash}', 'content_hash', p -> 'content_hash', 'artifact', p -> 'artifact', 'accept_by', p #> '{snapshot,acceptance,accept_by}', 'expires_at', p #> '{snapshot,acceptance,expires_at}', 'published_by', actor, 'published_at', stamp, 'replaces_publication_id', q -> 'replaces_publication_id');
    d := jsonb_build_object('id', p_id, 'target', q -> 'target', 'version', ver, 'previous_hash', l #> '{head,record_hash}', 'kind', 'published', 'actor_id', actor, 'created_at', stamp, 'publication_id', p_id, 'publication', pub, 'reason', null);
  else
    if l -> 'current' = 'null'::jsonb or l #> '{current,id}' is distinct from q -> 'publication_id' then
      raise exception 'Current publication changed'
        using errcode = 'PT409';
    end if;
    stamp := greatest (clock_timestamp(), (
      select
        max(ev.created_at)
      from public.native_estimate_publication_events ev
      where
        ev.estimate_id = root_id));
    d := jsonb_build_object('id', p_id, 'target', q -> 'target', 'version', ver, 'previous_hash', l #> '{head,record_hash}', 'kind', 'withdrawn', 'actor_id', actor, 'created_at', stamp, 'publication_id', q -> 'publication_id', 'publication', null, 'reason', q -> 'reason');
  end if;
  d := d || jsonb_build_object('record_hash', public.native_fulfillment_hash (d));
  perform
    public.clinical_require_staff ();
  insert into public.native_estimate_publication_events
    values (p_id, root_id, ver, actor, p_mutation, public.native_fulfillment_hash (jsonb_build_object('version', 1, 'actor_id', actor, 'operation', 'record_estimate_publication', 'mutation', p_mutation)), d, stamp);
  return public.native_estpub_receipt (p_id);
end
$function$;

-- native_fulfillment_refill(jsonb,jsonb)
CREATE OR REPLACE FUNCTION public.native_fulfillment_refill(p_target jsonb, p_document jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$declare f public.native_refills;rid uuid;ev integer;head uuid;begin
 if p_target='null'::jsonb then return null;end if;
 perform public.native_rx_keys(p_target,array['id','expected_version']);rid:=public.native_rx_uuid(p_target->'id');ev:=public.native_rx_revision(p_target->'expected_version');
 select * into f from public.native_refills where id=rid for update;
 if not found or ev is null or f.version<>ev then raise exception 'Linked refill changed' using errcode='PT409';end if;
 if f.state<>'open' or f.pet_id::text<>p_document->>'pet_id' or f.client_id::text<>p_document->>'client_id' or f.authorization_id::text is distinct from p_document->>'id' or f.authorization_hash is distinct from p_document->>'authorization_hash' then raise exception 'Exact current open refill authorization required' using errcode='23514';end if;
 select id into head from public.native_refill_events where refill_id=f.id and revision=f.version;
 return jsonb_build_object('refill',to_jsonb(f),'head_id',head);
end $function$;

-- native_fulfillment_refill_event(jsonb,uuid,text,uuid,text)
CREATE OR REPLACE FUNCTION public.native_fulfillment_refill_event(p_context jsonb, p_operation_id uuid, p_kind text, p_dispense_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a uuid:=public.clinical_require_staff();f public.native_refills;e public.native_refill_events;begin
 if p_context is null then return null;end if;
 update public.native_refills set version=version+1,state=case when p_kind='pickup' then 'closed' else 'open' end,updated_by=a,updated_at=clock_timestamp() where id=(p_context#>>'{refill,id}')::uuid and version=(p_context#>>'{refill,version}')::integer returning * into f;
 if not found then raise exception 'Linked refill changed' using errcode='PT409';end if;
 insert into public.native_refill_events(id,refill_id,revision,action,actor_id,reason,prior_event_id,before_snapshot,after_snapshot,link_context,created_at,fulfillment_reference)
 values(gen_random_uuid(),f.id,f.version,p_kind,a,p_reason,(p_context->>'head_id')::uuid,p_context->'refill',to_jsonb(f),null,clock_timestamp(),jsonb_build_object('kind',p_kind,'id',p_operation_id,'dispense_id',p_dispense_id,'authorization_id',f.authorization_id)) returning * into e;
 return public.native_refill_event(e);
end $function$;

-- native_fulfillment_review_hash(jsonb,text)
CREATE OR REPLACE FUNCTION public.native_fulfillment_review_hash(p_expected jsonb, p_actual text)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$begin
 if jsonb_typeof(p_expected) is distinct from 'string' or p_expected#>>'{}' !~ '^[a-f0-9]{64}$' then raise exception 'Exact fulfillment review hash required' using errcode='23514';end if;
 if p_expected#>>'{}' is distinct from p_actual then raise exception 'Fulfillment review context changed' using errcode='PT409';end if;
end $function$;

-- native_rx_check_change_context(jsonb,jsonb,boolean)
CREATE OR REPLACE FUNCTION public.native_rx_check_change_context(p_request jsonb, p_preview jsonb, p_replace boolean)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare prior jsonb;begin
 prior:=case when p_replace then p_preview#>'{context,prior}' else p_preview->'context' end;
 if p_request->'expected_event_id' is distinct from prior#>'{head,id}' or p_request->>'expected_context_hash' is distinct from p_preview->>'context_hash' then raise exception 'Authorization change context changed' using errcode='PT409';end if;
 if prior#>>'{head,state}' in ('cancelled','replaced') then raise exception 'Authorization already has a terminal event' using errcode='23514';end if;
end $function$;

-- native_rx_materialize_authorization(uuid,jsonb)
CREATE OR REPLACE FUNCTION public.native_rx_materialize_authorization(p_id uuid, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a uuid:=public.clinical_require_staff();di uuid;pet uuid;ev integer;preview jsonb;ctx jsonb;r jsonb;stamp timestamptz;h text;artifact jsonb;document jsonb;
begin
 perform public.native_rx_keys(p_request,array['draft_id','pet_id','expected_version','expected_context_hash','signature_name','attest_review']);
 di:=public.native_rx_uuid(p_request->'draft_id');pet:=public.native_rx_uuid(p_request->'pet_id');ev:=public.native_rx_revision(p_request->'expected_version');
 perform public.native_rx_text(p_request->'signature_name',200);
 if ev is null or p_request->'attest_review' is distinct from 'true'::jsonb or jsonb_typeof(p_request->'expected_context_hash') is distinct from 'string' or (p_request->>'expected_context_hash') !~ '^[a-f0-9]{64}$' then raise exception 'Exact signing review required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('native-prescriber:'||a::text,0));perform public.native_rx_require_dvm();
 perform pg_advisory_xact_lock(hashtextextended('native-prescription-draft:'||di::text,0));perform 1 from public.native_prescription_drafts where id=di for update;
 preview:=public.preview_native_prescription_sign(di,ev);ctx:=preview->'context';
 if (preview->>'pet_id')::uuid<>pet then raise exception 'Prescription patient mismatch' using errcode='23514';end if;
 if preview->>'context_hash'<>p_request->>'expected_context_hash' then raise exception 'Prescription signing context changed' using errcode='PT409';end if;
 if p_request->>'signature_name'<>ctx#>>'{prescriber,name}' then raise exception 'Signature must match reviewed veterinarian identity' using errcode='23514';end if;
 stamp:=clock_timestamp();h:=encode(sha256(convert_to(jsonb_build_object('version',1,'id',p_id,'draft_id',di,'draft_version',ev,'actor_id',a,'context_hash',preview->>'context_hash','signature_name',p_request->>'signature_name','signed_at',stamp)::text,'UTF8')),'hex');
 artifact:=jsonb_build_object('schema_version',1,'authorization_id',p_id,'authorization_hash',h,'signed_at',stamp,'signature_name',p_request->>'signature_name',
 'patient',(ctx->'patient')-'version','household',(ctx->'household')-'version',
 'prescriber',jsonb_build_object('user_id',a,'name',ctx#>>'{prescriber,name}','license_number',ctx#>>'{prescriber,configuration,fields,license_number}','license_state',ctx#>>'{prescriber,configuration,fields,license_state}','practice_name',ctx#>>'{prescriber,configuration,fields,practice_name}','practice_address',ctx#>>'{prescriber,configuration,fields,practice_address}','practice_phone',ctx#>'{prescriber,configuration,fields,practice_phone}'),
 'medication',ctx#>'{draft,fields,medication}','quantity_per_fill',ctx#>'{draft,fields,quantity_per_fill}','unit',ctx#>'{draft,fields,unit}','refills_authorized',ctx#>'{draft,fields,refills_authorized}','fulfillment_mode',ctx#>'{draft,fields,fulfillment_mode}','starts_on',ctx#>'{draft,fields,starts_on}','expires_on',ctx#>'{draft,fields,expires_on}');
 document:=jsonb_build_object('id',p_id,'pet_id',pet,'client_id',ctx#>'{household,id}','draft_id',di,'draft_version',ev,'signed_by',a,'signed_at',stamp,'context_hash',preview->>'context_hash','context',ctx,'authorization_hash',h,'artifact',artifact);
 insert into public.native_prescription_authorizations values(p_id,pet,(ctx#>>'{household,id}')::uuid,di,document);
 update public.native_prescription_drafts set status='signed',authorization_id=p_id,updated_by=a,updated_at=stamp where id=di;
 if ctx->'prescriber' is distinct from public.native_rx_require_dvm() then raise exception 'Prescriber configuration changed' using errcode='PT409';end if;
 return document;
end $function$;

-- outbound_delivery_sms_permitted(uuid,text)
CREATE OR REPLACE FUNCTION public.outbound_delivery_sms_permitted(p_delivery_id uuid, p_lease_owner text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d public.outbound_deliveries;recipient text;
begin
 perform public.communication_require_service();
 select * into d from public.outbound_deliveries where id=p_delivery_id;
 if not found or d.status<>'LEASED'::public.outbound_delivery_status or d.lease_owner is distinct from nullif(btrim(p_lease_owner),'') or d.leased_until<=now() then
  raise exception 'Outbound delivery is not actively leased to this worker' using errcode='PT409';
 end if;
 if d.channel<>'SMS'::public.channel_type or d.client_id is null then return false; end if;
 recipient:=public.communication_recipient('SMS',d.recipient);
 return recipient is not null and not public.communication_is_suppressed('SMS',recipient,d.client_id);
end $function$;

-- payment_delivery_context(uuid,uuid)
CREATE OR REPLACE FUNCTION public.payment_delivery_context(p_outbox_id uuid, p_lease_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o public.communication_outbox;l public.payment_delivery_outbox_links;r public.payment_delivery_requests;p public.payment_delivery_captures;context jsonb;
begin perform public.communication_require_service();
 select * into o from public.communication_outbox where id=p_outbox_id for update;
 if not found or o.state<>'claimed' or o.lease_token is distinct from p_lease_token or o.lease_expires_at<=now() or o.attempt_started_at is not null then raise exception 'Outbox lease unavailable' using errcode='PT409';end if;
 select * into l from public.payment_delivery_outbox_links where outbox_id=o.id;
 if not found then return null;end if;
 select * into r from public.payment_delivery_requests where id=l.request_id;
 select * into p from public.payment_delivery_captures where request_id=r.id;
 context:=public.payment_delivery_current(r.id);
 if row(o.channel,o.recipient,o.subject,o.body,o.created_by,o.client_id,o.conversation_id) is distinct from row(r.channel,r.recipient,r.subject,r.body_template,r.actor_id,r.client_id,r.conversation_id) or row(p.message_hash,p.payload_hash) is distinct from row(l.reviewed_message_hash,l.reviewed_payload_hash) then raise exception 'Payment delivery review unavailable' using errcode='42501';end if;
 return context||jsonb_build_object('capture',to_jsonb(p));
end $function$;

-- prepare_ezyvet_migration_run(uuid,text,text,jsonb)
CREATE OR REPLACE FUNCTION public.prepare_ezyvet_migration_run(p_id uuid, p_source_origin text, p_source_site_uid text, p_scopes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a uuid:=auth.uid();normalized jsonb;intent jsonb;digest text;r public.ezyvet_migration_runs;
 item jsonb;m public.ezyvet_record_links;s public.ezyvet_import_snapshots;h public.ezyvet_identity_heads;
 scope_id uuid;mapping_id uuid;parent_id uuid;observed integer;resource text;parent text;disposition text;reason text;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_source_origin is null or p_source_origin not in ('https://api.trial.ezyvet.com','https://api.ezyvet.com')
  or p_source_site_uid is null or p_source_site_uid<>btrim(p_source_site_uid) or length(p_source_site_uid) not between 1 and 4096
  or p_scopes is null or jsonb_typeof(p_scopes)<>'array' then raise exception 'Invalid migration manifest' using errcode='23514';end if;
 if jsonb_array_length(p_scopes) not between 1 and 100 or octet_length(p_scopes::text)>524288 then raise exception 'Use a bounded migration manifest' using errcode='23514';end if;
 for item in select value from jsonb_array_elements(p_scopes) loop
  if jsonb_typeof(item)<>'object' or not item ?& array['id','mapping_id','resource','parent_type','parent_snapshot_id','parent_head_version','disposition','reason'] then
   raise exception 'Incomplete migration scope' using errcode='23514';end if;
  if (select count(*) from jsonb_object_keys(item))<>8 or exists(select 1 from jsonb_each(item) e where e.key<>'parent_head_version' and jsonb_typeof(e.value)<>'string')
   or jsonb_typeof(item->'parent_head_version')<>'number' or (item->>'parent_head_version') !~ '^[1-9][0-9]{0,8}$' then
   raise exception 'Invalid migration scope fields' using errcode='23514';end if;
  scope_id:=(item->>'id')::uuid;mapping_id:=(item->>'mapping_id')::uuid;parent_id:=(item->>'parent_snapshot_id')::uuid;
 end loop;
 if (select count(distinct (value->>'id')::uuid) from jsonb_array_elements(p_scopes))<>jsonb_array_length(p_scopes) then
  raise exception 'Duplicate migration scope identity' using errcode='23514';end if;
 select jsonb_agg(value order by (value->>'id')::uuid) into normalized from jsonb_array_elements(p_scopes);
 intent:=jsonb_build_object('version',1,'source_origin',p_source_origin,'source_site_uid',p_source_site_uid,'scopes',normalized);
 digest:=encode(sha256(convert_to(intent::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('ezyvet-migration:'||p_id::text,0));
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into r from public.ezyvet_migration_runs where id=p_id;
 if found then
  if r.actor_id<>a or r.intent is distinct from intent or r.intent_hash<>digest then raise exception 'Migration request identity cannot change' using errcode='42501';end if;
  return public.read_ezyvet_migration_run(p_id);
 end if;
 insert into public.ezyvet_migration_runs(id,actor_id,source_origin,source_site_uid,intent,intent_hash)
 values(p_id,a,p_source_origin,p_source_site_uid,intent,digest);
 for item in select value from jsonb_array_elements(normalized) order by (value->>'mapping_id')::uuid,(value->>'parent_snapshot_id')::uuid,(value->>'id')::uuid loop
  scope_id:=(item->>'id')::uuid;mapping_id:=(item->>'mapping_id')::uuid;parent_id:=(item->>'parent_snapshot_id')::uuid;
  observed:=(item->>'parent_head_version')::integer;resource:=item->>'resource';parent:=item->>'parent_type';disposition:=item->>'disposition';reason:=item->>'reason';
  if resource not in ('contact','animal','healthstatus','consult','history','vaccination','prescription','prescriptionitem','attachment')
   or parent not in ('contact','animal','consult','prescription') or disposition not in ('required','excluded','unsupported')
   or reason<>btrim(reason) or length(reason) not between 1 and 2000 then raise exception 'Unsupported migration scope' using errcode='23514';end if;
  if not ((resource='contact' and parent='contact') or (resource in ('animal','healthstatus','consult','history','prescription') and parent='animal')
   or (resource='vaccination' and parent='consult') or (resource='prescriptionitem' and parent='prescription')
   or (resource='attachment' and (parent='animal' or (parent in ('contact','consult') and disposition<>'required')))) then
   raise exception 'Resource parent contract unavailable' using errcode='23514';end if;
  select * into m from public.ezyvet_record_links where id=mapping_id and source_origin=p_source_origin and source_site_uid=p_source_site_uid for share;
  if m.id is null or m.resource<>(case when parent='contact' then 'contact' else 'animal' end) then raise exception 'Exact approved mapping required' using errcode='42501';end if;
  if m.pet_id is not null then
   perform 1 from public.pets where id=m.pet_id and client_id=m.client_id for share;
   if not found then raise exception 'Patient household changed' using errcode='PT409';end if;
  end if;
  select * into s from public.ezyvet_import_snapshots where id=parent_id;
  if s.id is null or row(s.source_origin,s.source_site_uid,s.resource) is distinct from row(p_source_origin,p_source_site_uid,parent)
   or (parent in ('contact','animal') and s.external_id<>m.external_id)
   or (parent in ('consult','prescription') and s.payload->>'animal_id' is distinct from m.external_id) then
   raise exception 'Parent source identity mismatch' using errcode='42501';end if;
  select hh.* into h from public.ezyvet_identity_heads hh where hh.source_origin=p_source_origin and hh.source_site_uid=p_source_site_uid and hh.resource=parent and hh.external_id=s.external_id for share;
  if h.snapshot_id is distinct from s.id or h.version is distinct from observed then raise exception 'Parent source changed; review scope again' using errcode='PT409';end if;
  if parent='consult' then perform public.ezyvet_validate_vaccination_consult(m.id,p_source_origin,p_source_site_uid,s.id,s.payload_hash,observed);end if;
  if parent='prescription' then perform public.ezyvet_validate_prescriptionitem_prescription(m.id,p_source_origin,p_source_site_uid,s.id,s.payload_hash,observed);end if;
  insert into public.ezyvet_migration_scopes values(scope_id,p_id,m.id,m.snapshot_id,m.head_version,m.client_id,m.pet_id,resource,parent,s.id,observed,s.external_id,s.payload_hash,disposition,reason);
 end loop;
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return public.read_ezyvet_migration_run(p_id);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'Invalid migration scope value' using errcode='23514';
end $function$;

-- prepare_ezyvet_prescription_review(uuid,uuid,jsonb)
CREATE OR REPLACE FUNCTION public.prepare_ezyvet_prescription_review(p_id uuid, p_pet_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare actor uuid:=public.ezyvet_prescription_require_dvm();r public.ezyvet_prescription_review_requests;context jsonb;begin
 if p_id is null or p_pet_id is null then raise exception 'Durable operation and patient required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,5900));
 select * into r from public.ezyvet_prescription_review_requests where id=p_id;
 if found then
  if row(r.actor_id,r.pet_id,r.payload) is distinct from row(actor,p_pet_id,p_payload) or r.status='abandoned' then
   raise exception 'Review request identity cannot change or revive' using errcode='42501';end if;
  return public.ezyvet_prescription_review_projection(p_id);
 end if;
 -- Preparation validates interpretation; explicit approval still remains separate.
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>262144
  or not(p_payload ?& array['item_run_id','patient_version','interpretation'])
  or (p_payload-array['item_run_id','patient_version','interpretation'])<>'{}'::jsonb
  or jsonb_typeof(p_payload->'interpretation') is distinct from 'object'
  or jsonb_typeof(p_payload->'item_run_id') is distinct from 'string'
  or coalesce(p_payload->>'item_run_id','') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  or jsonb_typeof(p_payload->'patient_version') is distinct from 'number'
  or coalesce(p_payload->>'patient_version','') !~ '^[1-9][0-9]{0,9}$'
  then raise exception 'Patient version, item run and draft interpretation required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_pet_id::text,4700));
 -- Collector locks run, then mapping/patient and source heads. Do not acquire
 -- a patient row lock before the run: intake uses run-before-patient order.
 context:=public.ezyvet_prescription_source_context(p_pet_id,(p_payload->>'item_run_id')::uuid);
 if not exists(select 1 from public.pets where id=p_pet_id and version::numeric=(p_payload->>'patient_version')::numeric) then
  raise exception 'Patient version changed' using errcode='PT409';end if;
 context:=public.ezyvet_prescription_interpretation_context(context,p_payload->'interpretation');
 context:=context||jsonb_build_object('patient_version',p_payload->'patient_version');
 perform public.ezyvet_prescription_review_predecessor(context,p_payload->'interpretation');
 insert into public.ezyvet_prescription_review_requests(id,actor_id,pet_id,status,payload,request_hash,review_context)
 values(p_id,actor,p_pet_id,'prepared',p_payload,encode(digest(jsonb_build_array(p_payload,context)::text,'sha256'),'hex'),context);
 return public.ezyvet_prescription_review_projection(p_id);
end $function$;

-- prepare_invoice_checkout(uuid,uuid,uuid,text,bigint,text,boolean,text,text)
CREATE OR REPLACE FUNCTION public.prepare_invoice_checkout(p_request_id uuid, p_invoice_id uuid, p_client_id uuid, p_source_hash text, p_amount_cents bigint, p_account_id text, p_livemode boolean, p_success_url text, p_cancel_url text)
 RETURNS invoice_checkout_attempts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid:=public.clinical_require_staff(); a public.invoice_checkout_attempts; i public.billing_invoices;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,3000));
 select * into a from public.invoice_checkout_attempts where id=p_request_id;
 if found then
 if row(a.actor_id,a.invoice_id,a.client_id,a.source_hash,a.amount_cents,a.account_id,a.livemode,a.success_url,a.cancel_url) is distinct from row(actor,p_invoice_id,p_client_id,p_source_hash,p_amount_cents,p_account_id,p_livemode,p_success_url,p_cancel_url) then raise exception 'Checkout identifier already used' using errcode='23514';end if;
 return a;end if;
 if not exists(select 1 from public.payment_provider_profiles where account_id=p_account_id and livemode=p_livemode and p_success_url=return_origin||'/payment/return' and p_cancel_url=return_origin||'/payment/cancel') then raise exception 'Payment provider or return destination not configured' using errcode='23514';end if;
 select * into i from public.billing_invoices where id=p_invoice_id and client_id=p_client_id for update;
 if not found or i.status<>'issued' then raise exception 'Issued invoice required' using errcode='23514';end if;
 if exists(select 1 from public.invoice_checkout_attempts where invoice_id=i.id and public.checkout_state_internal(id) not in ('paid','expired')) then raise exception 'Resolve existing checkout first' using errcode='23514';end if;
 if exists(select 1 from public.invoice_refund_requests where invoice_id=i.id and public.refund_state_internal(id) in ('pending','reconciliation')) then raise exception 'Resolve existing refund first' using errcode='23514';end if;
 if p_source_hash is distinct from public.payment_source_hash_internal(i.id,i.client_id) or p_amount_cents is distinct from (public.payment_balance_internal(i.id)->>'outstanding_cents')::bigint then raise exception 'Invoice payment balance changed' using errcode='PT409';end if;
 insert into public.invoice_checkout_attempts(id,invoice_id,client_id,actor_id,source_hash,amount_cents,account_id,livemode,success_url,cancel_url,idempotency_key)
 values(p_request_id,i.id,i.client_id,actor,p_source_hash,p_amount_cents,p_account_id,p_livemode,p_success_url,p_cancel_url,'lrv-checkout-'||p_request_id) returning * into a;
 return a;
end $function$;

-- prepare_native_estimate_publication(uuid,jsonb)
CREATE OR REPLACE FUNCTION public.prepare_native_estimate_publication(p_id uuid, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := public.clinical_require_staff ();
  p jsonb;
  c jsonb;
  s jsonb;
  stamp timestamptz;
begin
  if p_id is null then
    raise exception 'Preparation operation id required'
      using errcode = '23514';
  end if;
  perform
    public.native_estpub_prepare_request (p_request);
  perform
    pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  perform
    public.clinical_require_staff ();
  p := public.native_estpub_preparation (p_id);
  if p is not null then
    if p ->> 'actor_id' <> actor::text then
      raise exception 'Preparation unavailable'
        using errcode = '42501';
    end if;
    if p -> 'request' is distinct from p_request then
      raise exception 'Preparation id already used'
        using errcode = '23514';
    end if;
    perform
      public.native_estpub_lifecycle ((p_request #>> '{target,estimate_id}')::uuid);
    return p;
  end if;
  c := public.native_estpub_context ((p_request #>> '{target,estimate_id}')::uuid, (p_request #>> '{target,client_id}')::uuid, (p_request ->> 'draft_version')::integer);
  if c -> 'target' is distinct from p_request -> 'target' then
    raise exception 'Preparation target mismatch'
      using errcode = '23514';
  end if;
  if public.native_fulfillment_hash (c) is distinct from p_request ->> 'expected_source_hash' or c -> 'publication_head' is distinct from p_request -> 'expected_publication_head' or c -> 'current_publication_id' is distinct from p_request -> 'replaces_publication_id' then
    raise exception 'Publication preparation review changed'
      using errcode = 'PT409';
  end if;
  stamp := clock_timestamp();
  s := public.native_estpub_snapshot (p_id, c, stamp);
  if stamp >= (s #>> '{acceptance,expires_at}')::timestamptz then
    raise exception 'Estimate acceptance deadline expired'
      using errcode = '23514';
  end if;
  insert into public.native_estimate_publication_preparations
    values (p_id, actor, p_request, public.native_fulfillment_hash (jsonb_build_object('version', 1, 'actor_id', actor, 'operation', 'prepare_estimate_publication', 'request', p_request)), c, public.native_fulfillment_hash (c), s, public.native_fulfillment_hash (s), stamp);
  perform
    public.clinical_require_staff ();
  return public.native_estpub_preparation (p_id);
end
$function$;

-- prepare_payment_collection(uuid,uuid,uuid,text,bigint,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.prepare_payment_collection(p_request_id uuid, p_invoice_id uuid, p_client_id uuid, p_source_hash text, p_amount_cents bigint, p_expires_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid:=public.clinical_require_staff();g public.payment_collection_grants;i public.billing_invoices;
begin
 perform pg_advisory_xact_lock(hashtextextended('payment-collection:'||p_request_id::text,3400));
 select * into g from public.payment_collection_grants where id=p_request_id;
 if found then
 if row(g.actor_id,g.invoice_id,g.client_id,g.source_hash,g.amount_cents,g.expires_at) is distinct from row(actor,p_invoice_id,p_client_id,p_source_hash,p_amount_cents,p_expires_at) then raise exception 'Immutable payment collection intent differs' using errcode='23505';end if;
 return public.payment_collection_read_internal(g.id);end if;
 if p_expires_at is null or not isfinite(p_expires_at) or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '7 days' then raise exception 'Expiry must be within seven days' using errcode='23514';end if;
 -- Serialize preparation only for this brief transaction, never for the link lifetime.
 select * into i from public.billing_invoices where id=p_invoice_id and client_id=p_client_id for update;
 if not found or i.status<>'issued' then raise exception 'Issued invoice unavailable' using errcode='42501';end if;
 if exists(select 1 from public.payment_collection_grants where actor_id=actor and invoice_id=p_invoice_id and public.payment_collection_state_internal(id) in ('preparing','captured')) then raise exception 'Recover existing payment collection draft' using errcode='23514';end if;
 if p_source_hash is distinct from public.payment_source_hash_internal(i.id,i.client_id) or p_amount_cents is distinct from (public.payment_balance_internal(i.id)->>'outstanding_cents')::bigint then raise exception 'Invoice payment balance changed' using errcode='PT409';end if;
 insert into public.payment_collection_grants(id,invoice_id,client_id,actor_id,source_hash,amount_cents,expires_at,status_expires_at)
 values(p_request_id,i.id,i.client_id,actor,p_source_hash,p_amount_cents,p_expires_at,p_expires_at+interval '30 days');
 return public.payment_collection_read_internal(p_request_id);
end $function$;

-- prepare_payment_reconciliation(uuid,uuid,text,uuid,text,jsonb,text)
CREATE OR REPLACE FUNCTION public.prepare_payment_reconciliation(p_case_id uuid, p_invoice_id uuid, p_family text, p_request_id uuid, p_provider_object_id text, p_blocker_refs jsonb, p_expected_case_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid:=public.payment_require_admin();c public.payment_reconciliation_cases;target jsonb;refs jsonb;
begin
 if jsonb_typeof(p_blocker_refs) is distinct from 'array' or jsonb_array_length(p_blocker_refs) not between 1 and 100 then raise exception 'Explicit bounded blocker review required' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_blocker_refs) r where jsonb_typeof(r)<>'object' or (select count(*) from jsonb_object_keys(r))<>2 or not r ?& array['kind','id'] or r->>'kind' not in ('observation','checkout_evidence','refund_evidence') or r->>'id' !~ '^[a-f0-9-]{36}$') then raise exception 'Invalid blocker references' using errcode='23514';end if;
 select jsonb_agg(r order by r->>'kind',r->>'id') into refs from jsonb_array_elements(p_blocker_refs) r;
 if (select count(distinct r) from jsonb_array_elements(refs) r)<>jsonb_array_length(refs) then raise exception 'Duplicate blocker reference' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_case_id::text,3500));
 select * into c from public.payment_reconciliation_cases where id=p_case_id;
 if found then
 if row(c.actor_id,c.invoice_id,c.family,c.request_id,c.provider_object_id,c.blocker_refs,c.snapshot_hash) is distinct from row(actor,p_invoice_id,p_family,p_request_id,p_provider_object_id,refs,p_expected_case_hash) then raise exception 'Reconciliation review identifier already used' using errcode='23514';end if;return public.read_payment_reconciliation(c.id);end if;
 perform 1 from public.billing_invoices where id=p_invoice_id for update;
 if not found then raise exception 'Invoice unavailable' using errcode='42501';end if;
 target:=public.payment_reconciliation_target_internal(p_invoice_id,p_family,p_request_id,p_provider_object_id);
 if p_expected_case_hash is distinct from target->>'snapshot_hash' then raise exception 'Reconciliation facts changed' using errcode='PT409';end if;
 if exists(select 1 from jsonb_array_elements(refs) r where not (target->'blocker_refs') @> jsonb_build_array(r)) then raise exception 'Blocker is not eligible for this review' using errcode='23514';end if;
 insert into public.payment_reconciliation_cases(id,invoice_id,actor_id,family,request_id,provider_object_id,blocker_refs,snapshot_hash) values(p_case_id,p_invoice_id,actor,p_family,p_request_id,p_provider_object_id,refs,p_expected_case_hash);
 return public.read_payment_reconciliation(p_case_id);
end $function$;

-- preview_native_dispense(jsonb)
CREATE OR REPLACE FUNCTION public.preview_native_dispense(p_target jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid:=public.clinical_require_staff();aid uuid;petid uuid;iid uuid;rid uuid;idx integer;ev integer;quantity numeric;total numeric:=0;entry jsonb;last_lot uuid;lid uuid;allocation_quantity numeric;d jsonb;head jsonb;alerts jsonb;usage jsonb;refill jsonb;context jsonb;s public.native_fill_slots;previous public.native_fill_slots;p public.pets;house public.clients;inv public.billing_invoices;product public.catalog_products;lot public.inventory_lots;lots jsonb:='[]';balance numeric;items jsonb;item_total numeric;amount numeric;today date;stamp timestamptz;
begin
 perform public.native_rx_keys(p_target,array['authorization_id','pet_id','slot_index','expected_slot_version','invoice_id','quantity','allocations','refill']);
 aid:=public.native_rx_uuid(p_target->'authorization_id');petid:=public.native_rx_uuid(p_target->'pet_id');iid:=public.native_rx_uuid(p_target->'invoice_id');idx:=public.native_fulfillment_index(p_target->'slot_index');ev:=public.native_rx_revision(p_target->'expected_slot_version');quantity:=public.native_fulfillment_quantity(p_target->'quantity');
 if jsonb_typeof(p_target->'allocations') is distinct from 'array' or jsonb_array_length(p_target->'allocations') not between 1 and 100 then raise exception 'Bounded lot allocations required' using errcode='23514';end if;
 for entry in select value from jsonb_array_elements(p_target->'allocations') loop
 perform public.native_rx_keys(entry,array['lot_id','quantity']);lid:=public.native_rx_uuid(entry->'lot_id');allocation_quantity:=public.native_fulfillment_quantity(entry->'quantity');
 if last_lot is not null and lid<=last_lot then raise exception 'Sorted unique lot allocations required' using errcode='23514';end if;last_lot:=lid;total:=total+allocation_quantity;
 end loop;
 if total<>quantity then raise exception 'Lot allocations must exactly equal dispense quantity' using errcode='23514';end if;
 if p_target->'refill' is distinct from 'null'::jsonb then
 perform public.native_rx_keys(p_target->'refill',array['id','expected_version']);rid:=public.native_rx_uuid(p_target#>'{refill,id}');perform public.native_rx_revision(p_target#>'{refill,expected_version}');
 perform pg_advisory_xact_lock(hashtextextended('native-refill:'||rid::text,0));end if;
 perform pg_advisory_xact_lock(hashtextextended('native-prescription-authorization:'||aid::text,0));perform public.clinical_require_staff();
 d:=public.native_rx_verified_authorization(aid);
 if d is null or d->>'pet_id'<>petid::text then raise exception 'Exact native authorization patient required' using errcode='23514';end if;
 head:=public.native_fulfillment_head(aid);
 if head->>'state'<>'active' or d#>>'{artifact,fulfillment_mode}'<>'practice_stock' then raise exception 'Active practice-stock authorization required' using errcode='23514';end if;
 select * into s from public.native_fill_slots where authorization_id=aid and slot_index=idx for update;
 usage:=public.native_rx_usage_context(aid);
 if idx>(d#>>'{artifact,refills_authorized}')::integer then raise exception 'Authorized fill slot limit exceeded' using errcode='23514';end if;
 if s.id is not null then
 if ev is null or ev<>s.version then raise exception 'Fill slot changed' using errcode='PT409';end if;
 if s.state<>'open' or quantity>s.remaining_quantity then raise exception 'Open slot quantity allowance exceeded' using errcode='23514';end if;
 else
 if ev is not null or idx<>(usage->>'used_fill_slots')::integer then raise exception 'Fill slot changed' using errcode='PT409';end if;
 if usage->'open_slot'<>'null'::jsonb or quantity>(d#>>'{artifact,quantity_per_fill}')::numeric then raise exception 'Previous slot must close and quantity must fit signed allowance' using errcode='23514';end if;
 if idx>0 then select * into previous from public.native_fill_slots where authorization_id=aid and slot_index=idx-1;if previous.id is null or previous.state<>'closed' then raise exception 'Closed preceding fill slot required' using errcode='23514';end if;end if;
 end if;
 alerts:=public.read_patient_treatment_alerts(petid);select * into p from public.pets where id=petid for share;
 if p.client_id::text<>d->>'client_id' or p.archived_at is not null or p.deceased_at is not null then raise exception 'Current active prescription patient and household required' using errcode='23514';end if;
 select * into house from public.clients where id=p.client_id for share;
 select * into inv from public.billing_invoices where id=iid for update;
 if not found or inv.status<>'draft' or inv.client_id<>p.client_id then raise exception 'Same-household draft invoice required' using errcode='23514';end if;
 select * into product from public.catalog_products where id=(d#>>'{context,draft,fields,product_id}')::uuid for share;
 if not found or not product.active or product.kind<>'medication' or product.unit<>d#>>'{artifact,unit}' then raise exception 'Exact active signed medication product and unit required' using errcode='23514';end if;
 perform public.native_rx_text(to_jsonb(product.name),200);
 for entry in select value from jsonb_array_elements(p_target->'allocations') loop
 lid:=(entry->>'lot_id')::uuid;allocation_quantity:=public.native_fulfillment_quantity(entry->'quantity');select * into lot from public.inventory_lots where id=lid for update;
 if not found or lot.product_id<>product.id then raise exception 'Exact signed product lot required' using errcode='23514';end if;
 select coalesce(sum(m.quantity),0) into balance from public.inventory_movements m where m.lot_id=lid;
 if balance<allocation_quantity or balance>99999999999.999 then raise exception 'Insufficient or unsupported lot balance' using errcode='23514';end if;
 perform public.native_rx_text(to_jsonb(lot.lot_number),200);perform public.native_rx_text(to_jsonb(lot.location),200);
 lots:=lots||jsonb_build_array(jsonb_build_object('id',lot.id,'product_id',lot.product_id,'lot_number',lot.lot_number,'expires_on',lot.expires_on,'location',lot.location,'balance',public.native_fulfillment_decimal(balance),'quantity',public.native_fulfillment_decimal(allocation_quantity)));
 end loop;
 -- Date is observed after every potentially blocking ledger lock.
 stamp:=clock_timestamp();today:=(stamp at time zone 'America/Denver')::date;
 if today<(d#>>'{artifact,starts_on}')::date or today>(d#>>'{artifact,expires_on}')::date or exists(select 1 from jsonb_array_elements(lots) x where (x->>'expires_on')::date<today) then raise exception 'Prescription or allocated lot is not valid on dispensing date' using errcode='23514';end if;
 select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'),coalesce(sum(i.amount_cents),0) into items,item_total from public.billing_invoice_items i where i.invoice_id=iid;
 amount:=round(quantity*product.unit_price_cents);
 if amount<0 or amount>9223372036854775807 or item_total+amount>9223372036854775807 or item_total<0 then raise exception 'Invoice money bound exceeded' using errcode='23514';end if;
 refill:=public.native_fulfillment_refill(p_target->'refill',d);perform public.clinical_require_staff();
 context:=jsonb_build_object('version',1,'target',p_target,'denver_date',today,'authorization',head,'signed_artifact',d->'artifact',
 'patient',jsonb_build_object('id',p.id,'version',p.version,'client_id',p.client_id,'archived_at',p.archived_at,'deceased_at',p.deceased_at),'household',jsonb_build_object('id',house.id,'version',house.version),'alerts',alerts,'slot',public.native_fulfillment_slot(s),'previous_slot',public.native_fulfillment_slot(previous),'usage',usage,
 'invoice',jsonb_build_object('id',inv.id,'client_id',inv.client_id,'version',inv.version,'status',inv.status,'currency',inv.currency,'existing_items_hash',public.native_fulfillment_hash(items),'existing_items_total_cents',item_total::text),
 'product',jsonb_build_object('id',product.id,'version',product.version,'active',product.active,'kind',product.kind,'name',product.name,'unit',product.unit,'unit_price_cents',product.unit_price_cents::text),'lots',lots,'refill',refill,
 'charge',jsonb_build_object('quantity',public.native_fulfillment_decimal(quantity),'unit_price_cents',product.unit_price_cents::text,'amount_cents',amount::text,'projected_invoice_total_cents',(item_total+amount)::text));
 return jsonb_build_object('version',1,'actor_id',actor,'context',context,'context_hash',public.native_fulfillment_hash(context),'observed_at',clock_timestamp());
end $function$;

-- preview_native_prescription_cancel(uuid,uuid)
CREATE OR REPLACE FUNCTION public.preview_native_prescription_cancel(p_authorization_id uuid, p_pet_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a uuid:=public.clinical_require_staff();c jsonb;
begin
 if p_authorization_id is null then raise exception 'Exact authorization required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('native-prescriber:'||a::text,0));perform public.native_rx_require_dvm();
 perform pg_advisory_xact_lock(hashtextextended('native-prescription-authorization:'||p_authorization_id::text,0));
 c:=public.native_rx_change_context(p_authorization_id,p_pet_id);
 if c->'prescriber' is distinct from public.native_rx_require_dvm() then raise exception 'Prescriber configuration changed' using errcode='PT409';end if;
 return jsonb_build_object('version',1,'actor_id',a,'pet_id',p_pet_id,'context',c,'context_hash',encode(sha256(convert_to(c::text,'UTF8')),'hex'),'observed_at',statement_timestamp());
end $function$;

-- preview_native_prescription_sign(uuid,integer)
CREATE OR REPLACE FUNCTION public.preview_native_prescription_sign(p_draft_id uuid, p_expected_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a uuid:=public.clinical_require_staff();d public.native_prescription_drafts;pet public.pets;client public.clients;product public.catalog_products;prescriber jsonb;alerts jsonb;ctx jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('native-prescriber:'||a::text,0));prescriber:=public.native_rx_require_dvm();
 select * into d from public.native_prescription_drafts where id=p_draft_id for share;
 if d.id is null or d.version is distinct from p_expected_version or d.status<>'draft' then raise exception 'Prescription draft changed' using errcode='PT409';end if;
 alerts:=public.read_patient_treatment_alerts(d.pet_id);
 perform public.native_rx_validate_fields(d.fields,d.pet_id,d.client_id);
 select * into pet from public.pets where id=d.pet_id for share;select * into client from public.clients where id=d.client_id for share;
 if (d.fields->>'expires_on')::date<(now() at time zone 'America/Denver')::date then raise exception 'Prescription order has expired' using errcode='23514';end if;
 if nullif(btrim(concat_ws(' ',client.first_name,client.last_name)),'') is null or coalesce(nullif(btrim(client.mailing_address),''),nullif(btrim(client.housecall_address),'')) is null then raise exception 'Household name and address required for signing' using errcode='23514';end if;
 select * into product from public.catalog_products where id=(d.fields->>'product_id')::uuid for share;
 ctx:=jsonb_build_object('version',1,'draft',to_jsonb(d),'patient',jsonb_build_object('id',pet.id,'version',pet.version,'name',pet.name,'species',pet.species),
 'household',jsonb_build_object('id',client.id,'version',client.version,'name',concat_ws(' ',client.first_name,client.last_name),'address',coalesce(nullif(btrim(client.mailing_address),''),nullif(btrim(client.housecall_address),''))),
 'prescriber',prescriber,'product',case when product.id is null then null else jsonb_build_object('id',product.id,'version',product.version,'name',product.name,'unit',product.unit) end,'alerts',alerts);
 if prescriber is distinct from public.native_rx_require_dvm() then raise exception 'Prescriber configuration changed' using errcode='PT409';end if;
 return jsonb_build_object('version',1,'actor_id',a,'draft_id',d.id,'pet_id',d.pet_id,'context',ctx,'context_hash',encode(sha256(convert_to(ctx::text,'UTF8')),'hex'),'observed_at',statement_timestamp());
end $function$;

-- promote_ezyvet_identity(uuid,uuid,text,integer,text,uuid,uuid,integer,jsonb,text)
CREATE OR REPLACE FUNCTION public.promote_ezyvet_identity(p_request_id uuid, p_snapshot_id uuid, p_expected_hash text, p_head_version integer, p_action text, p_client_id uuid, p_pet_id uuid, p_expected_local_version integer, p_values jsonb, p_reason text)
 RETURNS ezyvet_record_links
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare actor uuid:=auth.uid(); s public.ezyvet_import_snapshots; h public.ezyvet_identity_heads; result public.ezyvet_record_links; c public.clients; p public.pets; owner_id uuid; fingerprint text; allowed text[];
begin
 if public.ezyvet_is_active_admin(actor) is not true then raise exception 'Active administrator required' using errcode='42501'; end if;
 if p_request_id is null or p_values is null or jsonb_typeof(p_values)<>'object' or p_action is null or p_action not in ('create','link') or nullif(trim(p_reason),'') is null or length(p_reason)>2000 then raise exception 'Invalid reviewed import' using errcode='23514'; end if;
 fingerprint=encode(digest(jsonb_build_array(p_snapshot_id,p_expected_hash,p_head_version,p_action,p_client_id,p_pet_id,p_expected_local_version,p_values,p_reason)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,1));
 select * into result from public.ezyvet_record_links where request_id=p_request_id;
 if found then
  if result.approved_by<>actor or result.request_hash<>fingerprint then raise exception 'Approval request identity mismatch' using errcode='42501'; end if;
  return result;
 end if;
 select * into strict s from public.ezyvet_import_snapshots where id=p_snapshot_id;
 if s.resource not in ('contact','animal') then raise exception 'Only reviewed contacts and animals can be promoted' using errcode='23514'; end if;
 select * into h from public.ezyvet_identity_heads where source_origin=s.source_origin and source_site_uid=s.source_site_uid and resource=s.resource and external_id=s.external_id for update;
 if not found or h.snapshot_id<>s.id or h.version is distinct from p_head_version or s.payload_hash is distinct from p_expected_hash then raise exception 'Source changed; reload and review again' using errcode='PT409'; end if;
 if exists(select 1 from public.ezyvet_record_links where source_origin=s.source_origin and source_site_uid=s.source_site_uid and resource=s.resource and external_id=s.external_id) then raise exception 'Source identity already linked; local record will not be overwritten' using errcode='23505'; end if;
 if p_action='link' and p_values<>'{}'::jsonb then raise exception 'Linking cannot change local values' using errcode='23514'; end if;
 if s.resource='contact' then
  if p_pet_id is not null then raise exception 'Contact cannot target a patient' using errcode='23514'; end if;
  if p_action='create' then
   if p_client_id is not null or p_expected_local_version is not null then raise exception 'New household cannot target existing records' using errcode='23514'; end if;
   allowed=array['first_name','last_name','primary_phone','primary_email','mailing_address','housecall_address'];
   if exists(select 1 from jsonb_object_keys(p_values) k where not k=any(allowed)) then raise exception 'Unsupported household fields' using errcode='23514'; end if;
   c=public.save_client(actor,null,null,p_values->>'first_name',p_values->>'last_name',p_values->>'primary_phone',p_values->>'primary_email','EMAIL',p_values->>'mailing_address',p_values->>'housecall_address');
  else
   select * into c from public.clients where id=p_client_id for share;
   if not found or c.version is distinct from p_expected_local_version then raise exception 'Local record changed; reload before linking' using errcode='PT409'; end if;
  end if;
 else
  select client_id into owner_id from public.ezyvet_record_links where source_origin=s.source_origin and source_site_uid=s.source_site_uid and resource='contact' and external_id=s.payload->>'contact_id';
  if owner_id is null then raise exception 'Review and link the source household first' using errcode='23514'; end if;
  if p_client_id is distinct from owner_id then raise exception 'Animal household does not match source household link' using errcode='23514'; end if;
  if p_action='create' then
   if p_pet_id is not null or p_expected_local_version is not null then raise exception 'New patient cannot target existing records' using errcode='23514'; end if;
   allowed=array['name','species','breed','dob','birth_date_precision','color','sex','neuter_status','microchip_id','deceased_at'];
   if exists(select 1 from jsonb_object_keys(p_values) k where not k=any(allowed)) then raise exception 'Unsupported patient fields' using errcode='23514'; end if;
   p=public.save_patient(null,owner_id,null,p_values->>'name',p_values->>'species',nullif(p_values->>'breed',''),nullif(p_values->>'dob','')::date,coalesce(p_values->>'birth_date_precision','unknown'),nullif(p_values->>'color',''),coalesce(p_values->>'sex','unknown'),coalesce(p_values->>'neuter_status','unknown'),nullif(p_values->>'microchip_id',''),null,nullif(p_values->>'deceased_at','')::date);
  else
   select * into p from public.pets where id=p_pet_id for share;
   if not found or p.version is distinct from p_expected_local_version then raise exception 'Local record changed; reload before linking' using errcode='PT409'; end if;
   if p.client_id<>owner_id then raise exception 'Existing patient ownership cannot change through import' using errcode='23514'; end if;
  end if;
 end if;
 insert into public.ezyvet_record_links(request_id,request_hash,source_origin,source_site_uid,resource,external_id,snapshot_id,head_version,client_id,pet_id,local_version,action,reason,approved_by)
 values(p_request_id,fingerprint,s.source_origin,s.source_site_uid,s.resource,s.external_id,s.id,h.version,case when s.resource='contact' then c.id else owner_id end,case when s.resource='animal' then p.id else null end,case when s.resource='contact' then c.version else p.version end,p_action,trim(p_reason),actor) returning * into result;
 return result;
end $function$;

-- queue_due_reminders(integer)
CREATE OR REPLACE FUNCTION public.queue_due_reminders(p_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare candidate record;job public.care_reminder_jobs;link public.reminder_outbox_links;queued integer=0;blocked integer=0;skipped integer=0;
begin perform public.communication_require_service();if p_limit is null or p_limit not between 1 and 100 then raise exception 'Queue limit must be 1 to 100' using errcode='23514';end if;
 for candidate in
 select * from public.reminder_scheduler_candidates_internal() order by job_kind,source_kind,source_id limit p_limit
 loop
  begin
   if candidate.job_kind='care' then job=public.enqueue_care_reminder(coalesce(candidate.job_id,gen_random_uuid()),candidate.source_kind,candidate.source_id,candidate.source_version,candidate.template_id,candidate.template_version);candidate.job_id=job.id;end if;
   link=public.queue_reminder_outbox(candidate.job_kind,candidate.job_id,candidate.policy_id);
   if link.state='queued' then queued=queued+1;else blocked=blocked+1;end if;
  exception when sqlstate 'PT409' or sqlstate '23514' or sqlstate '42501' then skipped=skipped+1;end;
 end loop;return jsonb_build_object('queued',queued,'blocked',blocked,'skipped',skipped,'dispatched',false);
end $function$;

-- read_invoice_email_payload(uuid,uuid)
CREATE OR REPLACE FUNCTION public.read_invoice_email_payload(p_outbox_id uuid, p_lease_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o public.communication_outbox;l public.invoice_email_outbox_links;p public.invoice_email_payloads;
begin perform public.communication_require_service();select * into o from public.communication_outbox where id=p_outbox_id;
 if not found or o.state<>'claimed' or o.lease_token is distinct from p_lease_token or o.lease_expires_at<=now() or o.attempt_started_at is not null then raise exception 'Outbox lease unavailable' using errcode='PT409';end if;
 select * into l from public.invoice_email_outbox_links where outbox_id=o.id;
 if not found then return null;end if;
 perform public.invoice_email_context(l.request_id);
 select * into p from public.invoice_email_payloads where request_id=l.request_id;
 if not found or p.payload_text is null or l.reviewed_payload_hash<>p.payload_hash then raise exception 'Frozen invoice payload unavailable' using errcode='23514';end if;
 return jsonb_build_object('payload_text',p.payload_text,'payload_hash',p.payload_hash);
end $function$;

-- read_release_email_payload(uuid,uuid)
CREATE OR REPLACE FUNCTION public.read_release_email_payload(p_outbox_id uuid, p_lease_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o public.communication_outbox;l public.release_email_outbox_links;p public.release_email_payloads;
begin perform public.communication_require_service();select * into o from public.communication_outbox where id=p_outbox_id;
 if not found or o.state<>'claimed' or o.lease_token is distinct from p_lease_token or o.lease_expires_at<=now() or o.attempt_started_at is not null then raise exception 'Outbox lease unavailable' using errcode='PT409';end if;
 select * into l from public.release_email_outbox_links where outbox_id=o.id;
 if not found then return null;end if;
 perform public.release_email_context(l.request_id);
 select * into p from public.release_email_payloads where request_id=l.request_id;
 if not found or p.payload_text is null or l.reviewed_payload_hash<>p.payload_hash then raise exception 'Frozen release payload unavailable' using errcode='23514';end if;
 return jsonb_build_object('payload_text',p.payload_text,'payload_hash',p.payload_hash);
end $function$;

-- record_lesion_observation(uuid,uuid,uuid,integer,timestamp with time zone,text,text,numeric,numeric,numeric,numeric,numeric,text,uuid)
CREATE OR REPLACE FUNCTION public.record_lesion_observation(p_id uuid, p_lesion_id uuid, p_pet_id uuid, p_expected_version integer, p_observed_at timestamp with time zone, p_label text, p_body_view text, p_x numeric, p_y numeric, p_length_mm numeric, p_width_mm numeric, p_depth_mm numeric, p_notes text, p_photo_document_id uuid)
 RETURNS patient_lesion_observations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid:=public.clinical_require_staff(); result public.patient_lesion_observations; lesion public.patient_lesions; fingerprint jsonb;
begin
 fingerprint:=jsonb_build_object('lesion_id',p_lesion_id,'pet_id',p_pet_id,'expected_version',p_expected_version,'observed_at',p_observed_at,'label',p_label,'body_view',p_body_view,'x',p_x,'y',p_y,'length_mm',p_length_mm,'width_mm',p_width_mm,'depth_mm',p_depth_mm,'notes',p_notes,'photo_document_id',p_photo_document_id);
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into result from public.patient_lesion_observations where id=p_id;
 if found then if result.created_by<>actor or result.request<>fingerprint then raise exception 'Observation identifier already used' using errcode='23514'; end if; return result; end if;
 if p_observed_at is null or not isfinite(p_observed_at) or p_observed_at>now()+interval '5 minutes' then raise exception 'Invalid observation time' using errcode='23514'; end if;
 if p_photo_document_id is not null and not exists(select 1 from public.patient_documents where id=p_photo_document_id and pet_id=p_pet_id and status='ready' and mime_type in ('image/png','image/jpeg')) then raise exception 'Photo must be a ready image belonging to this patient' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_lesion_id::text,1));
 select * into lesion from public.patient_lesions where id=p_lesion_id for update;
 if found then
  if lesion.pet_id<>p_pet_id then raise exception 'Lesion does not belong to patient' using errcode='23514'; end if;
  if lesion.version is distinct from p_expected_version then raise exception 'Body map changed; reload before saving' using errcode='PT409'; end if;
  update public.patient_lesions set label=p_label,body_view=p_body_view,x=p_x,y=p_y where id=p_lesion_id;
 else
  if p_expected_version is not null then raise exception 'Lesion no longer exists' using errcode='PT409'; end if;
  insert into public.patient_lesions(id,pet_id,label,body_view,x,y,created_by,updated_by) values(p_lesion_id,p_pet_id,p_label,p_body_view,p_x,p_y,actor,actor);
 end if;
 insert into public.patient_lesion_observations(id,lesion_id,observed_at,label,body_view,x,y,length_mm,width_mm,depth_mm,notes,photo_document_id,request,created_by) values(p_id,p_lesion_id,p_observed_at,p_label,p_body_view,p_x,p_y,p_length_mm,p_width_mm,p_depth_mm,p_notes,p_photo_document_id,fingerprint,actor) returning * into result;
 return result;
end $function$;

-- record_native_dispense(uuid,jsonb)
CREATE OR REPLACE FUNCTION public.record_native_dispense(p_id uuid, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid:=public.clinical_require_staff();r jsonb;preview jsonb;c jsonb;target jsonb;aid uuid;petid uuid;sid uuid;iid uuid;itemid uuid:=gen_random_uuid();mid uuid;stamp timestamptz;quantity numeric;maximum numeric;next_quantity numeric;s public.native_fill_slots;entry jsonb;allocations jsonb:='[]';artifact_lots jsonb:='[]';artifact jsonb;document jsonb;refill_event jsonb;head_version integer;invoice_version integer;actor_name text;
begin
 r:=public.native_fulfillment_begin(p_id,'dispense',p_request);if r is not null then return r;end if;
 perform public.native_rx_keys(p_request,array['authorization_id','pet_id','slot_index','expected_slot_version','invoice_id','quantity','allocations','refill','expected_context_hash','reason','attest_alert_review','attest_dispense_review']);perform public.native_rx_text(p_request->'reason',2000);
 if p_request->'attest_alert_review' is distinct from 'true'::jsonb or p_request->'attest_dispense_review' is distinct from 'true'::jsonb then raise exception 'Explicit alert and dispense review required' using errcode='23514';end if;
 target:=p_request-array['expected_context_hash','reason','attest_alert_review','attest_dispense_review'];preview:=public.preview_native_dispense(target);c:=preview->'context';perform public.native_fulfillment_review_hash(p_request->'expected_context_hash',preview->>'context_hash');
 aid:=(target->>'authorization_id')::uuid;petid:=(target->>'pet_id')::uuid;iid:=(target->>'invoice_id')::uuid;quantity:=public.native_fulfillment_quantity(target->'quantity');maximum:=(c#>>'{signed_artifact,quantity_per_fill}')::numeric;
 select full_name into actor_name from public.profiles where id=actor;perform public.native_rx_text(to_jsonb(actor_name),200);
 stamp:=clock_timestamp();if (stamp at time zone 'America/Denver')::date<>(c->>'denver_date')::date then raise exception 'Dispensing date changed; review again' using errcode='PT409';end if;
 if c->'slot'='null'::jsonb then
 sid:=gen_random_uuid();insert into public.native_fill_slots values(sid,aid,(target->>'slot_index')::integer,1,maximum,quantity,maximum-quantity,case when quantity=maximum then 'closed' else 'open' end,case when quantity=maximum then 'filled' else null end,actor,stamp,case when quantity=maximum then actor else null end,case when quantity=maximum then stamp else null end,null) returning * into s;
 else
 sid:=(c#>>'{slot,id}')::uuid;next_quantity:=(c#>>'{slot,dispensed_quantity}')::numeric+quantity;
 update public.native_fill_slots set version=version+1,dispensed_quantity=next_quantity,remaining_quantity=maximum-next_quantity,state=case when next_quantity=maximum then 'closed' else 'open' end,closure_kind=case when next_quantity=maximum then 'filled' else null end,closed_by=case when next_quantity=maximum then actor else null end,closed_at=case when next_quantity=maximum then stamp else null end where id=sid returning * into s;
 end if;
 for entry in select value from jsonb_array_elements(c->'lots') loop
 mid:=gen_random_uuid();insert into public.inventory_movements(id,lot_id,quantity,kind,reason,created_by) values(mid,(entry->>'id')::uuid,-(entry->>'quantity')::numeric,'dispense','Native prescription dispense '||p_id::text,actor);
 allocations:=allocations||jsonb_build_array(jsonb_build_object('lot_id',entry->'id','quantity',entry->'quantity','movement_id',mid));artifact_lots:=artifact_lots||jsonb_build_array(jsonb_build_object('id',entry->'id','number',entry->'lot_number','expires_on',entry->'expires_on','quantity',entry->'quantity'));
 end loop;
 insert into public.billing_invoice_items(id,invoice_id,pet_id,product_id,description,quantity,unit_price_cents,created_by) values(itemid,iid,petid,(c#>>'{product,id}')::uuid,c#>>'{product,name}',quantity,(c#>>'{product,unit_price_cents}')::bigint,actor);
 update public.billing_invoices set version=version+1 where id=iid returning version into invoice_version;
 refill_event:=public.native_fulfillment_refill_event(nullif(c->'refill','null'::jsonb),p_id,'dispense',p_id,p_request->>'reason');
 artifact:=jsonb_build_object('id',p_id,'authorization_id',aid,'authorization_hash',c#>'{authorization,hash}','fill_index',s.slot_index,'quantity',public.native_fulfillment_decimal(quantity),'unit',c#>'{signed_artifact,unit}','dispensed_at',stamp,'recorded_by',jsonb_build_object('user_id',actor,'name',actor_name),'invoice_id',iid,'lots',artifact_lots);
 document:=jsonb_build_object('version',1,'id',p_id,'authorization_id',aid,'authorization_hash',c#>'{authorization,hash}','pet_id',petid,'client_id',c#>'{household,id}','slot_id',sid,'slot_index',s.slot_index,'slot_version_before',target->'expected_slot_version','slot_version_after',s.version,'actor_id',actor,'quantity',public.native_fulfillment_decimal(quantity),'unit',c#>'{signed_artifact,unit}','reason',p_request->>'reason','dispensed_at',stamp,'reviewed_context',c,'reviewed_context_hash',preview->>'context_hash','allocations',allocations,'invoice_id',iid,'invoice_item_id',itemid,'invoice_version_before',c#>'{invoice,version}','invoice_version_after',invoice_version,'amount_cents',c#>'{charge,amount_cents}','refill_id',target#>'{refill,id}','refill_event_id',refill_event->'id','artifact',artifact,'artifact_hash',public.native_fulfillment_hash(artifact));
 insert into public.native_dispenses values(p_id,aid,petid,sid,iid,itemid,quantity,actor,stamp,document);
 for entry in select value from jsonb_array_elements(allocations) loop insert into public.native_dispense_allocations values(gen_random_uuid(),p_id,(entry->>'lot_id')::uuid,(entry->>'movement_id')::uuid,(entry->>'quantity')::numeric);end loop;
 head_version:=coalesce((c#>>'{usage,fulfillment_head,version}')::integer,0)+1;insert into public.native_fulfillment_events values(p_id,aid,head_version,'dispense',document);
 return public.native_fulfillment_finish(p_id,'dispense',p_request,jsonb_build_object('dispense',document,'slot',public.native_fulfillment_slot(s),'refill_event',refill_event));
end $function$;

-- record_native_dispense_finance(uuid,jsonb)
CREATE OR REPLACE FUNCTION public.record_native_dispense_finance(p_id uuid, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid:=public.clinical_require_staff();existing public.native_dispense_finance_operations;intent jsonb;preview jsonb;context jsonb;snapshot jsonb;document jsonb;credit_row public.billing_credits;refund_row public.invoice_refund_requests;ledger_stamp timestamptz;authorization_id uuid;pet_id uuid;dispense_id uuid;invoice_id uuid;item_id uuid;begin
 if p_id is null then raise exception 'Stable financial operation id required' using errcode='23514';end if;
 perform public.native_rx_keys(p_request,array['intent','expected_context_hash','attest_review']);intent:=p_request->'intent';perform public.native_finance_validate_intent(intent);
 if p_request->'attest_review' is distinct from 'true'::jsonb or jsonb_typeof(p_request->'expected_context_hash') is distinct from 'string' or p_request->>'expected_context_hash' !~ '^[0-9a-f]{64}$' then raise exception 'Explicit financial review and source hash required' using errcode='23514';end if;
 -- Both ledger operation locks precede the native authorization gate, including
 -- credit requests: a generic refund may otherwise win the same UUID concurrently.
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));perform pg_advisory_xact_lock(hashtextextended(p_id::text,3003));perform public.clinical_require_staff();
 select * into existing from public.native_dispense_finance_operations op where op.id=p_id;
 if found then
  if existing.actor_id<>actor then raise exception 'Financial receipt unavailable' using errcode='42501';end if;
  if existing.request is distinct from p_request then raise exception 'Financial operation identifier already used' using errcode='23514';end if;
  return public.native_finance_verified_operation(p_id);
 end if;
 document:=public.native_finance_verified_closure(p_id);
 if document is not null then
  if document->>'actor_id'<>actor::text then raise exception 'Financial closure unavailable' using errcode='42501';end if;
  raise exception 'Financial operation permanently closed without native record' using errcode='23514';
 end if;
 if exists(select 1 from public.billing_credits cr where cr.id=p_id) or exists(select 1 from public.invoice_refund_requests rr where rr.id=p_id) then raise exception 'Existing generic financial history cannot be adopted' using errcode='23514';end if;
 preview:=public.native_finance_review(intent);context:=preview->'context';snapshot:=context->'snapshot';
 if p_request->>'expected_context_hash' is distinct from preview->>'context_hash' then raise exception 'Financial or clinical review changed; review again' using errcode='PT409';end if;
 if preview->'allowed' is distinct from 'true'::jsonb then raise exception 'Financial operation blocked: %',preview->'blockers' using errcode='23514';end if;
 perform public.clinical_require_staff();authorization_id:=(intent#>>'{target,authorization_id}')::uuid;pet_id:=(intent#>>'{target,pet_id}')::uuid;dispense_id:=(intent#>>'{target,dispense_id}')::uuid;invoice_id:=(snapshot#>>'{invoice,id}')::uuid;item_id:=(snapshot#>>'{invoice,item_id}')::uuid;
 if intent->>'action'='credit' then
  credit_row:=public.credit_billing_invoice(p_id,invoice_id,(intent->>'amount_cents')::bigint,intent->>'reason');ledger_stamp:=credit_row.created_at;
  insert into public.native_dispense_credit_links(id,authorization_id,pet_id,dispense_id,invoice_id,invoice_item_id) values(p_id,authorization_id,pet_id,dispense_id,invoice_id,item_id);
 else
  refund_row:=public.prepare_invoice_refund(p_id,invoice_id,(intent->>'payment_id')::uuid,(intent->>'amount_cents')::bigint,intent->>'reason');ledger_stamp:=refund_row.created_at;
  insert into public.native_dispense_refund_links(id,authorization_id,pet_id,dispense_id,invoice_id,invoice_item_id,credit_id,payment_id) values(p_id,authorization_id,pet_id,dispense_id,invoice_id,item_id,(intent->>'credit_id')::uuid,(intent->>'payment_id')::uuid);
 end if;
 document:=jsonb_build_object('id',p_id,'target',intent->'target','action',intent->'action','actor_id',actor,'created_at',ledger_stamp,'invoice_id',invoice_id,'invoice_item_id',item_id,'credit_id',case when intent->>'action'='credit' then p_id else(intent->>'credit_id')::uuid end,'refund_request_id',case when intent->>'action'='refund' then p_id else null end,'payment_id',intent->'payment_id','amount_cents',intent->'amount_cents','currency','usd','reason',intent->'reason','reviewed_context',context,'reviewed_context_hash',preview->'context_hash');document:=document||jsonb_build_object('record_hash',public.native_fulfillment_hash(document));
 insert into public.native_dispense_finance_operations values(p_id,actor,p_request,public.native_fulfillment_hash(jsonb_build_object('version',1,'actor_id',actor,'operation','record_native_dispense_finance','request',p_request)),document,ledger_stamp);
 perform public.clinical_require_staff();return public.native_finance_verified_operation(p_id);
end $function$;

-- record_native_dispense_return(uuid,jsonb)
CREATE OR REPLACE FUNCTION public.record_native_dispense_return(p_id uuid, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a uuid:=public.clinical_require_staff();o public.native_return_operations;intent jsonb;preview jsonb;c jsonb;head jsonb;doc jsonb;actor jsonb;aid uuid;pet uuid;did uuid;action text;stamp timestamptz;x jsonb;alloc public.native_dispense_allocations;mid uuid;lines jsonb:='[]';n numeric;begin
 if p_id is null then raise exception 'Stable return ID required' using errcode='23514';end if;
 perform public.native_rx_keys(p_request,array['intent','expected_context_hash','expected_head','attest_review','attest_restock']);intent:=p_request->'intent';perform public.native_return_validate_intent(intent);action:=intent->>'action';
 perform public.native_rx_keys(p_request->'expected_head',array['event_id','version','record_hash']);perform public.native_correction_uuid(p_request#>'{expected_head,event_id}',true);
 if p_request->'attest_review' is distinct from 'true'::jsonb or p_request->'attest_restock' is distinct from to_jsonb(action='restock') or jsonb_typeof(p_request->'expected_context_hash') is distinct from 'string' or p_request->>'expected_context_hash' !~ '^[a-f0-9]{64}$' then raise exception 'Explicit reviewed return attestations required' using errcode='23514';end if;
 aid:=(intent#>>'{target,authorization_id}')::uuid;pet:=(intent#>>'{target,pet_id}')::uuid;did:=(intent#>>'{target,dispense_id}')::uuid;
 perform pg_advisory_xact_lock(hashtextextended('native-return-operation:'||p_id::text,0));perform public.clinical_require_staff();
 select * into o from public.native_return_operations where id=p_id;if found then
  if o.actor_id<>a or o.request is distinct from p_request then raise exception 'Return identifier already used' using errcode='23514';end if;
  perform public.native_reconciliation_verified(aid,pet,did);perform public.clinical_require_staff();return public.native_return_receipt(o);
 end if;
 preview:=public.preview_native_dispense_return(intent);c:=preview->'context';head:=c->'head';
 if p_request->>'expected_context_hash' is distinct from preview->>'context_hash' or p_request->'expected_head' is distinct from head then raise exception 'Return review context changed' using errcode='PT409';end if;
 if preview->'allowed' is distinct from 'true'::jsonb then raise exception 'Restock is blocked by reviewed safeguards' using errcode='42501';end if;
 actor:=public.native_correction_actor(case when action='restock' then 'clinical_annotation' else 'operational_annotation' end);
 if (head->>'version')::integer=2147483647 then raise exception 'Return history version exhausted' using errcode='23514';end if;
 stamp:=clock_timestamp();
 if stamp<(c->>'dispensed_at')::timestamptz or exists(select 1 from public.native_return_events where dispense_id=did and created_at>stamp) then raise exception 'Return observation clock moved backwards' using errcode='PT409';end if;
 if action='restock' and (c#>>'{policy,reviewed_at}')::timestamptz>stamp then raise exception 'Return observation clock moved backwards' using errcode='PT409';end if;
 if action='restock' and c#>>'{stock_review,practice_date}' is distinct from (stamp at time zone 'America/Denver')::date::text then raise exception 'Return practice date changed' using errcode='PT409';end if;
 for x in select value from jsonb_array_elements(intent->'allocations') loop
  select * into alloc from public.native_dispense_allocations where id=(x->>'allocation_id')::uuid and dispense_id=did;n:=public.native_fulfillment_quantity(x->'quantity');mid:=null;
  if action='restock' then mid:=gen_random_uuid();insert into public.inventory_movements(id,lot_id,quantity,kind,reason,created_by,created_at) values(mid,alloc.lot_id,n,'native_return',intent->>'reason',a,stamp);end if;
  lines:=lines||jsonb_build_array(jsonb_build_object('allocation_id',alloc.id,'lot_id',alloc.lot_id,'quantity',public.native_fulfillment_decimal(n),'movement_id',mid));
 end loop;
 doc:=jsonb_build_object('version',1,'id',p_id,'target',c->'target','authorization_hash',c->'authorization_hash','dispense_document_hash',c->'dispense_document_hash','sequence',(head->>'version')::integer+1,'prior_event_id',head->'event_id','prior_record_hash',head->'record_hash','actor',actor,'action',action,'intake_id',intent->'intake_id','allocations',lines,'custody',intent->'custody','package_condition',intent->'package_condition','storage_history',intent->'storage_history','reason',intent->'reason','note',intent->'note','policy',c->'policy','reviewed_context_hash',preview->'context_hash','created_at',stamp);
 doc:=doc||jsonb_build_object('record_hash',public.native_fulfillment_hash(doc));
 insert into public.native_return_events values(p_id,aid,pet,did,(head->>'version')::integer+1,(head->>'event_id')::uuid,a,action,(intent->>'intake_id')::uuid,stamp,doc->>'record_hash',c,doc);
 if action='restock' then insert into public.native_return_stock_links select gen_random_uuid(),p_id,(z->>'allocation_id')::uuid,(z->>'lot_id')::uuid,(z->>'movement_id')::uuid,(z->>'quantity')::numeric from jsonb_array_elements(lines)z;end if;
 insert into public.native_return_operations values(p_id,a,p_request,public.native_fulfillment_hash(jsonb_build_object('version',1,'actor_id',a,'operation','record_native_dispense_return','request',p_request)),doc,stamp) returning * into o;
 perform public.native_correction_actor(case when action='restock' then 'clinical_annotation' else 'operational_annotation' end);return public.native_return_receipt(o);
end $function$;

-- record_native_dispense_return_v2(uuid,jsonb)
CREATE OR REPLACE FUNCTION public.record_native_dispense_return_v2(p_id uuid, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a uuid:=public.clinical_require_staff();o public.native_return_operations;preview jsonb;c jsonb;intent jsonb;head jsonb;actor jsonb;act text;aid uuid;pet uuid;did uuid;stamp timestamptz;x jsonb;alloc public.native_dispense_allocations;n numeric;mid uuid;lines jsonb:='[]';doc jsonb;begin
 if p_id is null then raise exception 'Stable operation id required' using errcode='23514';end if;perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into o from public.native_return_operations where id=p_id;
 if found then if o.actor_id<>a or o.request is distinct from p_request or o.result->'version' is distinct from '2'::jsonb then raise exception 'Return operation id already used' using errcode='23514';end if;return public.recover_native_dispense_return_v2(p_id);end if;
 perform public.native_rx_keys(p_request,array['intent','expected_context_hash','expected_head','expected_discrepancy_head','attest_review','attest_restock','physical_attestations']);intent:=p_request->'intent';perform public.native_reconciliation_validate_intent(intent);act:=intent->>'action';
 if p_request->'attest_review' is distinct from 'true'::jsonb or p_request->'attest_restock' is distinct from to_jsonb(act='restock') or p_request->'physical_attestations' is distinct from public.native_reconciliation_attestations(act) then raise exception 'Action-specific physical fact review required' using errcode='23514';end if;
 preview:=public.preview_native_dispense_return_v2(intent);c:=preview->'context';head:=c->'head';actor:=public.native_correction_actor(case when act in('intake','dispose') then 'operational_annotation' else 'clinical_annotation' end);
 if preview->'allowed' is distinct from 'true'::jsonb then raise exception 'Reconciliation has unresolved blockers: %',preview->'blockers' using errcode='23514';end if;
 if p_request->>'expected_context_hash' is distinct from preview->>'context_hash' or p_request->'expected_head' is distinct from head or p_request->'expected_discrepancy_head' is distinct from c->'discrepancy_head' then raise exception 'Reconciliation changed; review again' using errcode='PT409';end if;
 aid:=(c#>>'{target,authorization_id}')::uuid;pet:=(c#>>'{target,pet_id}')::uuid;did:=(c#>>'{target,dispense_id}')::uuid;stamp:=clock_timestamp();
 if (head->>'version')::integer=2147483647 or stamp<(c->>'dispensed_at')::timestamptz or exists(select 1 from public.native_return_events where dispense_id=did and created_at>stamp) or exists(select 1 from public.native_return_discrepancy_events where dispense_id=did and created_at>stamp) then raise exception 'Reconciliation chronology unavailable' using errcode='PT409';end if;
 if act='restock' and((c#>>'{policy,reviewed_at}')::timestamptz>stamp or c#>>'{stock_review,practice_date}' is distinct from (stamp at time zone 'America/Denver')::date::text) then raise exception 'Restock observation changed' using errcode='PT409';end if;
 for x in select value from jsonb_array_elements(intent->'allocations') loop
  select * into alloc from public.native_dispense_allocations where id=(x->>'allocation_id')::uuid and dispense_id=did;n:=public.native_fulfillment_quantity(x->'quantity');mid:=null;
  if act in('restock','retract_restock') then mid:=gen_random_uuid();insert into public.inventory_movements(id,lot_id,quantity,kind,reason,created_by,created_at) values(mid,alloc.lot_id,case act when 'restock' then n else -n end,case act when 'restock' then 'native_return' else 'native_return_compensation' end,intent->>'reason',a,stamp);end if;
  lines:=lines||jsonb_build_array(jsonb_build_object('allocation_id',alloc.id,'lot_id',alloc.lot_id,'quantity',public.native_fulfillment_decimal(n),'movement_id',mid));
 end loop;
 doc:=jsonb_build_object('version',2,'id',p_id,'target',c->'target','authorization_hash',c->'authorization_hash','dispense_document_hash',c->'dispense_document_hash','sequence',(head->>'version')::integer+1,'prior_event_id',head->'event_id','prior_record_hash',head->'record_hash','actor',actor,'action',act,'intake_id',intent->'intake_id','allocations',lines,'custody',intent->'custody','package_condition',intent->'package_condition','storage_history',intent->'storage_history','reason',intent->'reason','note',intent->'note','policy',c->'policy','correction_target',intent->'correction_target','discrepancy_id',intent->'discrepancy_id','physical_attestations',p_request->'physical_attestations','reviewed_context_hash',preview->'context_hash','created_at',stamp);doc:=doc||jsonb_build_object('record_hash',public.native_fulfillment_hash(doc));
 insert into public.native_return_events values(p_id,aid,pet,did,(head->>'version')::integer+1,(head->>'event_id')::uuid,a,act,(intent->>'intake_id')::uuid,stamp,doc->>'record_hash',c,doc);
 if act='restock' then insert into public.native_return_stock_links select gen_random_uuid(),p_id,(q->>'allocation_id')::uuid,(q->>'lot_id')::uuid,(q->>'movement_id')::uuid,(q->>'quantity')::numeric from jsonb_array_elements(lines)q;end if;
 if act='retract_restock' then insert into public.native_return_compensation_links select gen_random_uuid(),p_id,(intent#>>'{correction_target,event_id}')::uuid,(q->>'allocation_id')::uuid,(q->>'lot_id')::uuid,s.movement_id,(q->>'movement_id')::uuid,(q->>'quantity')::numeric from jsonb_array_elements(lines)q join public.native_return_stock_links s on s.event_id=(intent#>>'{correction_target,event_id}')::uuid and s.allocation_id=(q->>'allocation_id')::uuid;end if;
 insert into public.native_return_operations values(p_id,a,p_request,public.native_fulfillment_hash(jsonb_build_object('version',2,'actor_id',a,'operation','record_native_dispense_return_v2','request',p_request)),doc,stamp) returning * into o;
 perform public.native_correction_actor(case when act in('intake','dispose') then 'operational_annotation' else 'clinical_annotation' end);
 return jsonb_build_object('version',2,'id',o.id,'actor_id',o.actor_id,'request',o.request,'request_hash',o.request_hash,'result',o.result,'created_at',o.created_at);
end $function$;

-- record_native_estimate_decision_grant(uuid,jsonb)
CREATE OR REPLACE FUNCTION public.record_native_estimate_decision_grant(p_id uuid, p_mutation jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'UTC'
AS $function$
declare actor uuid:=public.clinical_require_staff(); principal jsonb; b jsonb; previous jsonb;
  q jsonb:=p_mutation->'request'; g jsonb; gid uuid; root_id uuid; stamp timestamptz;
  seq integer; ver integer; d jsonb; receipt jsonb; rh text; old jsonb; kind text:=p_mutation->>'kind';
begin
  principal:=jsonb_build_object('kind','staff','id',actor);
  b:=public.native_estdec_lock(p_id,'grant',p_mutation); root_id:=(b#>>'{target,estimate_id}')::uuid;
  perform public.native_estdec_authorize(principal,null);
  old:=public.native_estdec_existing(p_id,'grant',principal,p_mutation);
  if old->>'status'='recorded' then return old->'receipt'; end if;
  if old->>'status'='closed_unrecorded' then raise exception 'Operation permanently closed' using errcode='23514'; end if;
  rh:=public.native_estdec_request_hash('grant',principal,p_mutation);
  select coalesce(max(e.sequence),0)+1 into seq from public.native_estimate_decision_grant_events e where e.estimate_id=root_id;
  stamp:=clock_timestamp();
  if kind='issue' then
    perform public.native_estdec_current(b,q->'expected_publication_head');
    if (q->>'expires_at')::timestamptz<=stamp or (q->>'expires_at')::timestamptz>(public.native_estdec_publication(b,public.native_estpub_lifecycle(root_id))->>'expires_at')::timestamptz then
      raise exception 'Grant deadline invalid' using errcode='23514'; end if;
    gid:=p_id; ver:=1; previous:=public.native_estpub_empty_head();
    g:=jsonb_build_object('version',1,'id',gid,'actor_id',actor,'request',q,'request_hash',rh,'created_at',public.native_estdec_time(stamp),
      'capability',null,'capture',null,'head',previous,'state','preparing','activation',null,'revocation',null);
  else
    gid:=(q->>'grant_id')::uuid; g:=public.native_estdec_verified_grant(gid); previous:=g->'head';
    if previous is distinct from q->'expected_grant_head' then raise exception 'Grant review changed' using errcode='PT409'; end if;
    ver:=(previous->>'version')::integer+1;
    if kind='activate' then
      perform public.native_estdec_current(b,q->'expected_publication_head');
      if g->>'state'<>'captured' or not public.is_active_staff((g->>'actor_id')::uuid)
        or g#>'{capability,context_hash}' is distinct from q->'expected_context_hash' or stamp>=(g#>>'{request,expires_at}')::timestamptz then
        raise exception 'Captured grant unavailable for activation' using errcode='23514'; end if;
      g:=g||jsonb_build_object('state','active','activation',jsonb_build_object('id',p_id,'actor_id',actor,'created_at',public.native_estdec_time(stamp)));
    else
      if g->>'state'='revoked' then raise exception 'Grant already revoked' using errcode='23514'; end if;
      g:=g||jsonb_build_object('state','revoked','revocation',jsonb_build_object('id',p_id,'actor_id',actor,'reason',q->'reason','created_at',public.native_estdec_time(stamp)));
    end if;
  end if;
  d:=jsonb_build_object('id',p_id,'grant_id',gid,'target',b->'target','sequence',seq,'grant_version',ver,'previous_hash',previous->'record_hash',
    'kind',case kind when 'issue' then 'issued' when 'activate' then 'activated' else 'revoked' end,'actor_id',actor,'created_at',public.native_estdec_time(stamp),'request',q);
  d:=d||jsonb_build_object('record_hash',public.native_fulfillment_hash(d));
  g:=jsonb_set(g,'{head}',jsonb_build_object('event_id',p_id,'version',ver,'record_hash',d->'record_hash'));
  receipt:=jsonb_build_object('version',1,'id',p_id,'actor_id',actor,'mutation',p_mutation,'request_hash',rh,'result',public.native_estdec_grant_view(g),'created_at',public.native_estdec_time(stamp));
  perform public.native_estdec_authorize(principal,null);
  if kind='issue' then
    insert into public.native_estimate_decision_grants values(gid,actor,root_id,(b->>'publication_id')::uuid,q,rh,(q->>'expires_at')::timestamptz,stamp);
  end if;
  insert into public.native_estimate_decision_grant_events values(p_id,gid,root_id,seq,ver,previous->>'record_hash',d,stamp);
  insert into public.native_estimate_decision_operations values(p_id,'grant',principal,p_mutation,rh,receipt,stamp);
  return public.native_estdec_verified_operation(p_id);
end $function$;

-- record_native_return_discrepancy(uuid,jsonb)
CREATE OR REPLACE FUNCTION public.record_native_return_discrepancy(p_id uuid, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a uuid:=public.clinical_require_staff();o public.native_return_discrepancy_operations;preview jsonb;c jsonb;intent jsonb;h jsonb;actor jsonb;doc jsonb;stamp timestamptz;act text;did uuid;case_id uuid;lines jsonb;begin
 if p_id is null then raise exception 'Stable discrepancy operation required' using errcode='23514';end if;perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));select * into o from public.native_return_discrepancy_operations where id=p_id;
 if found then if o.actor_id<>a or o.request is distinct from p_request then raise exception 'Discrepancy operation already used' using errcode='23514';end if;return public.recover_native_return_discrepancy(p_id);end if;
 perform public.native_rx_keys(p_request,array['intent','expected_context_hash','expected_return_head','expected_discrepancy_head','attest_physical_review','attest_original_quantities_custody_and_stock_accurate']);intent:=p_request->'intent';act:=intent->>'action';
 if p_request->'attest_physical_review' is distinct from 'true'::jsonb or p_request->'attest_original_quantities_custody_and_stock_accurate' is distinct from to_jsonb(act='resolve_confirmed_original') then raise exception 'Explicit discrepancy factual review required' using errcode='23514';end if;
 preview:=public.preview_native_return_discrepancy(intent);c:=preview->'context';h:=c->'discrepancy_head';actor:=public.native_correction_actor(case when act like 'resolve_%' then 'clinical_annotation' else 'operational_annotation' end);
 if preview->'allowed' is distinct from 'true'::jsonb then raise exception 'Discrepancy decision has blockers' using errcode='23514';end if;
 if p_request->>'expected_context_hash' is distinct from preview->>'context_hash' or p_request->'expected_return_head' is distinct from c->'return_head' or p_request->'expected_discrepancy_head' is distinct from h then raise exception 'Discrepancy context changed; review again' using errcode='PT409';end if;
 did:=(c#>>'{target,dispense_id}')::uuid;stamp:=clock_timestamp();case_id:=case act when 'report' then p_id else (intent->>'case_id')::uuid end;
 if (h->>'version')::integer=2147483647 or exists(select 1 from public.native_return_events where dispense_id=did and created_at>stamp) or exists(select 1 from public.native_return_discrepancy_events where dispense_id=did and created_at>stamp) then raise exception 'Discrepancy chronology unavailable' using errcode='PT409';end if;
 select jsonb_agg(jsonb_build_object('allocation_id',q->'allocation_id','lot_id',s->'lot_id','quantity',public.native_fulfillment_decimal(public.native_fulfillment_quantity(q->'quantity'))) order by q->>'allocation_id') into lines from jsonb_array_elements(intent->'allocations')q join jsonb_array_elements(c#>'{source,allocations}')s on s->'allocation_id'=q->'allocation_id';
 doc:=jsonb_build_object('version',1,'id',p_id,'target',c->'target','sequence',(h->>'version')::integer+1,'prior_event_id',h->'event_id','prior_record_hash',h->'record_hash','actor',actor,'action',act,'case_id',case_id,'source',intent->'source','allocations',lines,'observation',intent->'observation','correction_ids',intent->'correction_ids','return_head',c->'return_head','reviewed_context_hash',preview->'context_hash','created_at',stamp);doc:=doc||jsonb_build_object('record_hash',public.native_fulfillment_hash(doc));
 insert into public.native_return_discrepancy_events values(p_id,(c#>>'{target,authorization_id}')::uuid,(c#>>'{target,pet_id}')::uuid,did,(h->>'version')::integer+1,(h->>'event_id')::uuid,a,case_id,act,stamp,doc->>'record_hash',c,doc);
 if act='resolve_corrected' then insert into public.native_return_discrepancy_correction_links(case_id,correction_id,resolution_id) select case_id,value::uuid,p_id from jsonb_array_elements_text(intent->'correction_ids');end if;
 insert into public.native_return_discrepancy_operations values(p_id,a,p_request,public.native_fulfillment_hash(jsonb_build_object('version',1,'actor_id',a,'operation','record_native_return_discrepancy','request',p_request)),doc,stamp) returning * into o;
 perform public.native_correction_actor(case when act like 'resolve_%' then 'clinical_annotation' else 'operational_annotation' end);
 return jsonb_build_object('version',1,'id',o.id,'actor_id',o.actor_id,'request',o.request,'request_hash',o.request_hash,'result',o.result,'created_at',o.created_at);
end $function$;

-- record_outbound_delivery_callback(text,text,outbound_delivery_status,text,text,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.record_outbound_delivery_callback(p_provider text, p_provider_message_id text, p_status outbound_delivery_status, p_status_note text DEFAULT NULL::text, p_error_text text DEFAULT NULL::text, p_recorded_at timestamp with time zone DEFAULT now())
 RETURNS outbound_deliveries
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  normalized_provider text := nullif(btrim(coalesce(p_provider, '')), '');
  normalized_provider_message_id text := nullif(btrim(coalesce(p_provider_message_id, '')), '');
  normalized_note text := nullif(btrim(coalesce(p_status_note, '')), '');
  normalized_error text := nullif(btrim(coalesce(p_error_text, '')), '');
  result public.outbound_deliveries;
begin
  if normalized_provider is null or length(normalized_provider) > 128 then
    raise exception 'Provider is required' using errcode = '23514';
  end if;

  if normalized_provider_message_id is null or length(normalized_provider_message_id) > 256 then
    raise exception 'Provider message id is required' using errcode = '23514';
  end if;

  if p_recorded_at is null then
    raise exception 'Callback timestamp is required' using errcode = '23514';
  end if;

  if p_status not in (
    'DELIVERED'::public.outbound_delivery_status,
    'FAILED'::public.outbound_delivery_status,
    'UNKNOWN'::public.outbound_delivery_status
  ) then
    raise exception 'Unsupported outbound delivery callback status' using errcode = '23514';
  end if;

  update public.outbound_deliveries od
  set status = p_status,
    status_note = normalized_note,
    last_error_text = normalized_error,
    delivered_at = case
      when p_status = 'DELIVERED'::public.outbound_delivery_status then coalesce(od.delivered_at, p_recorded_at)
      else od.delivered_at
    end,
    failed_at = case
      when p_status = 'FAILED'::public.outbound_delivery_status then coalesce(od.failed_at, p_recorded_at)
      else od.failed_at
    end,
    unknown_at = case
      when p_status = 'UNKNOWN'::public.outbound_delivery_status then coalesce(od.unknown_at, p_recorded_at)
      else od.unknown_at
    end
  where od.provider = normalized_provider
    and od.provider_message_id = normalized_provider_message_id
    and (
      od.status in ('ACCEPTED'::public.outbound_delivery_status, 'UNKNOWN'::public.outbound_delivery_status)
      or od.status = p_status
    )
  returning od.* into result;

  if not found then
    -- Unknown or ineligible provider message (e.g. a receipt for another sender on a shared
    -- provider account): acknowledge as a no-op. Never raise a retryable SQLSTATE here.
    return null;
  end if;

  if result.appointment_reminder_id is not null then
    update public.appointment_reminders ar
    set status = case
        when p_status = 'DELIVERED'::public.outbound_delivery_status then 'SENT'::public.reminder_status
        when p_status in ('FAILED'::public.outbound_delivery_status, 'UNKNOWN'::public.outbound_delivery_status) then 'FAILED'::public.reminder_status
        else ar.status
      end,
      sent_at = case
        when p_status = 'DELIVERED'::public.outbound_delivery_status then coalesce(ar.sent_at, p_recorded_at)
        else ar.sent_at
      end,
      error_message = case
        when p_status in ('FAILED'::public.outbound_delivery_status, 'UNKNOWN'::public.outbound_delivery_status) then coalesce(normalized_error, normalized_note, 'Outbound delivery callback did not confirm delivery')
        when p_status = 'DELIVERED'::public.outbound_delivery_status then null
        else ar.error_message
      end
    where ar.id = result.appointment_reminder_id;
  end if;

  return result;
end
$function$;

-- record_outbound_delivery_result(uuid,text,outbound_delivery_status,text,text,text,text,timestamp with time zone,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.record_outbound_delivery_result(p_delivery_id uuid, p_lease_owner text, p_status outbound_delivery_status, p_provider text DEFAULT NULL::text, p_provider_message_id text DEFAULT NULL::text, p_status_note text DEFAULT NULL::text, p_error_text text DEFAULT NULL::text, p_next_attempt_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_recorded_at timestamp with time zone DEFAULT now())
 RETURNS outbound_deliveries
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  normalized_lease_owner text := nullif(btrim(p_lease_owner), '');
  normalized_provider text := nullif(btrim(coalesce(p_provider, '')), '');
  normalized_provider_message_id text := nullif(btrim(coalesce(p_provider_message_id, '')), '');
  normalized_note text := nullif(btrim(coalesce(p_status_note, '')), '');
  normalized_error text := nullif(btrim(coalesce(p_error_text, '')), '');
  result public.outbound_deliveries;
begin
  if p_delivery_id is null then
    raise exception 'Delivery id is required' using errcode = '23514';
  end if;

  if normalized_lease_owner is null or length(normalized_lease_owner) > 128 then
    raise exception 'Lease owner is required' using errcode = '23514';
  end if;

  if p_recorded_at is null then
    raise exception 'Result timestamp is required' using errcode = '23514';
  end if;

  if p_status not in (
    'QUEUED'::public.outbound_delivery_status,
    'ACCEPTED'::public.outbound_delivery_status,
    'DELIVERED'::public.outbound_delivery_status,
    'FAILED'::public.outbound_delivery_status,
    'UNKNOWN'::public.outbound_delivery_status
  ) then
    raise exception 'Unsupported outbound delivery result status' using errcode = '23514';
  end if;

  if p_status = 'QUEUED'::public.outbound_delivery_status then
    if p_next_attempt_at is null or p_next_attempt_at <= p_recorded_at then
      raise exception 'Retry results require a future next attempt timestamp' using errcode = '23514';
    end if;
  elsif p_next_attempt_at is not null then
    raise exception 'Terminal delivery results cannot set a retry timestamp' using errcode = '23514';
  end if;

  update public.outbound_deliveries od
  set status = p_status,
    provider = coalesce(normalized_provider, od.provider),
    provider_message_id = coalesce(normalized_provider_message_id, od.provider_message_id),
    status_note = normalized_note,
    last_error_text = normalized_error,
    next_attempt_at = case
      when p_status = 'QUEUED'::public.outbound_delivery_status then p_next_attempt_at
      else od.next_attempt_at
    end,
    leased_at = null,
    leased_until = null,
    lease_owner = null,
    accepted_at = case when p_status = 'ACCEPTED'::public.outbound_delivery_status then p_recorded_at else od.accepted_at end,
    delivered_at = case when p_status = 'DELIVERED'::public.outbound_delivery_status then p_recorded_at else od.delivered_at end,
    failed_at = case when p_status = 'FAILED'::public.outbound_delivery_status then p_recorded_at else od.failed_at end,
    unknown_at = case when p_status = 'UNKNOWN'::public.outbound_delivery_status then p_recorded_at else od.unknown_at end
  where od.id = p_delivery_id
    and od.status = 'LEASED'::public.outbound_delivery_status
    and od.lease_owner = normalized_lease_owner
    and od.leased_until > p_recorded_at
    and (
      p_status <> 'QUEUED'::public.outbound_delivery_status
      or od.attempt_count < od.max_attempts
    )
  returning od.* into result;

  if not found then
    raise exception 'Outbound delivery is not actively leased to this worker' using errcode = 'PT409';
  end if;

  if result.appointment_reminder_id is not null then
    update public.appointment_reminders ar
    set status = case
        when p_status in ('ACCEPTED'::public.outbound_delivery_status, 'DELIVERED'::public.outbound_delivery_status) then 'SENT'::public.reminder_status
        when p_status in ('FAILED'::public.outbound_delivery_status, 'UNKNOWN'::public.outbound_delivery_status) then 'FAILED'::public.reminder_status
        else ar.status
      end,
      sent_at = case
        when p_status in ('ACCEPTED'::public.outbound_delivery_status, 'DELIVERED'::public.outbound_delivery_status) then p_recorded_at
        else ar.sent_at
      end,
      error_message = case
        when p_status in ('FAILED'::public.outbound_delivery_status, 'UNKNOWN'::public.outbound_delivery_status) then coalesce(normalized_error, normalized_note, 'Outbound delivery did not complete')
        when p_status in ('ACCEPTED'::public.outbound_delivery_status, 'DELIVERED'::public.outbound_delivery_status) then null
        else ar.error_message
      end
    where ar.id = result.appointment_reminder_id;
  end if;

  return result;
end
$function$;

-- record_patient_treatment(uuid,jsonb)
CREATE OR REPLACE FUNCTION public.record_patient_treatment(p_id uuid, p_request jsonb)
 RETURNS patient_treatments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid:=public.clinical_require_staff(); result public.patient_treatments; lot public.inventory_lots; product public.catalog_products; inv public.billing_invoices; historical boolean; pet uuid; qty numeric; admin_at timestamptz; alert_bundle jsonb;
begin
 if p_request is null or jsonb_typeof(p_request)<>'object' or exists(select 1 from jsonb_object_keys(p_request) k where k not in ('pet_id','lot_id','invoice_id','quantity','dose','route','site','veterinarian','veterinarian_license','administered_at','next_due_on','historical','product_name','manufacturer','lot_number','expires_on','source','kind','alert_review')) then raise exception 'Invalid treatment request fields' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 perform public.clinical_require_staff();
 select * into result from public.patient_treatments where id=p_id;
 if found then if result.created_by<>actor or result.request<>p_request then raise exception 'Treatment identifier already used' using errcode='23514'; end if; return result; end if;
 historical:=coalesce((p_request->>'historical')::boolean,false); pet:=(p_request->>'pet_id')::uuid; qty:=(p_request->>'quantity')::numeric; admin_at:=(p_request->>'administered_at')::timestamptz;
 if qty is null or qty::text in ('NaN','Infinity','-Infinity') or qty<=0 or qty<>round(qty,3) or admin_at is null or not isfinite(admin_at) or admin_at>now()+interval '5 minutes' then raise exception 'Invalid quantity or administration time' using errcode='23514'; end if;
 if historical then
  if p_request ? 'alert_review' then raise exception 'Historical transcription cannot claim a current-care alert review' using errcode='23514';end if;
 else
  alert_bundle:=public.read_patient_treatment_alerts(pet);
  if jsonb_typeof(p_request->'alert_review') is distinct from 'object' or (p_request->'alert_review')-array['source_hash','acknowledged']<>'{}' or p_request#>'{alert_review,acknowledged}' is distinct from 'true'::jsonb then raise exception 'Review the current patient alerts and explicitly acknowledge them before recording treatment' using errcode='23514';end if;
  if p_request#>>'{alert_review,source_hash}' is distinct from alert_bundle->>'source_hash' then raise exception 'Patient alerts changed; reload and review the current alerts before recording treatment' using errcode='PT409';end if;
 end if;
 if historical then
  if p_request->>'lot_id' is not null or p_request->>'invoice_id' is not null or length(trim(coalesce(p_request->>'source','')))=0 then raise exception 'Historical records require source and cannot bill or debit stock' using errcode='23514'; end if;
  insert into public.patient_treatments(id,pet_id,kind,historical,product_name,manufacturer,lot_number,expires_on,quantity,dose,route,site,veterinarian,veterinarian_license,administered_at,next_due_on,source,request,created_by)
  values(p_id,pet,coalesce(p_request->>'kind','vaccine'),true,p_request->>'product_name',coalesce(p_request->>'manufacturer',''),coalesce(p_request->>'lot_number',''),(p_request->>'expires_on')::date,qty,p_request->>'dose',p_request->>'route',coalesce(p_request->>'site',''),p_request->>'veterinarian',coalesce(p_request->>'veterinarian_license',''),admin_at,(p_request->>'next_due_on')::date,p_request->>'source',p_request,actor) returning * into result;
 else
  select * into inv from public.billing_invoices where id=(p_request->>'invoice_id')::uuid for update;
  if not found or inv.status<>'draft' then raise exception 'A draft invoice is required' using errcode='23514'; end if;
  perform 1 from public.pets where id=pet and client_id=inv.client_id and archived_at is null and deceased_at is null for share;
  if not found then raise exception 'Invoice patient mismatch or inactive patient' using errcode='23514'; end if;
  select * into lot from public.inventory_lots where id=(p_request->>'lot_id')::uuid;
  if not found then raise exception 'Lot not found' using errcode='23514'; end if;
  select * into product from public.catalog_products where id=lot.product_id for share;
  select * into lot from public.inventory_lots where id=(p_request->>'lot_id')::uuid for update;
  if not found or lot.product_id is distinct from product.id then raise exception 'Lot identity changed' using errcode='PT409';end if;
  if not product.active then raise exception 'Product is inactive' using errcode='23514'; end if;
  if lot.expires_on<(now() at time zone 'America/Denver')::date or lot.expires_on<(admin_at at time zone 'America/Denver')::date then raise exception 'Expired stock cannot be administered or dispensed' using errcode='23514'; end if;
  if (select coalesce(sum(quantity),0) from public.inventory_movements where lot_id=lot.id)<qty then raise exception 'Insufficient stock' using errcode='23514'; end if;
  insert into public.patient_treatments(id,pet_id,product_id,lot_id,invoice_id,kind,historical,product_name,manufacturer,lot_number,expires_on,quantity,dose,route,site,veterinarian,veterinarian_license,administered_at,next_due_on,source,request,created_by)
  values(p_id,pet,product.id,lot.id,inv.id,product.kind,false,product.name,product.manufacturer,lot.lot_number,lot.expires_on,qty,p_request->>'dose',p_request->>'route',coalesce(p_request->>'site',''),p_request->>'veterinarian',coalesce(p_request->>'veterinarian_license',''),admin_at,(p_request->>'next_due_on')::date,coalesce(p_request->>'source','Practice administration'),p_request,actor) returning * into result;
  insert into public.inventory_movements(id,lot_id,quantity,kind,reason,created_by) values(p_id,lot.id,-qty,'dispense','Patient treatment '||p_id::text,actor);
  insert into public.billing_invoice_items(id,invoice_id,pet_id,product_id,description,quantity,unit_price_cents,created_by) values(p_id,inv.id,pet,product.id,product.name,qty,product.unit_price_cents,actor);
  update public.billing_invoices set version=version+1 where id=inv.id;
 end if;
 if not historical then
  insert into public.treatment_alert_reviews(treatment_id,pet_id,snapshot,source_hash,reviewed_by) values(result.id,pet,alert_bundle->'snapshot',alert_bundle->>'source_hash',actor);
 end if;
 return result;
end $function$;

-- record_sms_consent(uuid,uuid,text,boolean,consent_method,text,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.record_sms_consent(p_actor_id uuid, p_client_id uuid, p_phone text, p_opted_in boolean, p_method consent_method, p_details text, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS sms_consent
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid;normalized_phone text;latest timestamptz;result public.sms_consent;
begin
 actor:=public.clinical_require_staff();if actor is distinct from p_actor_id then raise exception 'Actor mismatch' using errcode='42501';end if;
 normalized_phone:=public.communication_recipient('SMS',p_phone);
 if normalized_phone is null or p_opted_in is null or p_method is null or p_method not in ('VERBAL','WRITTEN','WEB_FORM') or p_details is null or length(trim(p_details)) not between 5 and 1000 or not exists(select 1 from public.clients where id=p_client_id and public.communication_recipient('SMS',primary_phone)=normalized_phone) then raise exception 'Matching household number and documented consent method required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('SMS:'||normalized_phone,936));
 if p_opted_in and (select count(*) from public.clients where public.communication_recipient('SMS',primary_phone)=normalized_phone)<>1 then raise exception 'Shared phone numbers require separate consent review' using errcode='23514';end if;
 select max(updated_at) into latest from public.sms_consent where client_id=p_client_id and public.communication_recipient('SMS',phone_number)=normalized_phone;
 if latest is distinct from p_expected_updated_at then raise exception 'Consent changed; reload before saving' using errcode='PT409';end if;
 insert into public.sms_consent(client_id,phone_number,opted_in,opted_in_at,opted_out_at,consent_method,consent_details)
 values(p_client_id,normalized_phone,p_opted_in,case when p_opted_in then now() else null end,case when not p_opted_in then now() else null end,p_method,trim(p_details))
 on conflict(client_id,phone_number) do update set opted_in=excluded.opted_in,opted_in_at=excluded.opted_in_at,opted_out_at=excluded.opted_out_at,consent_method=excluded.consent_method,consent_details=excluded.consent_details;
 update public.sms_consent set opted_in=p_opted_in,opted_in_at=case when p_opted_in then now() else null end,opted_out_at=case when not p_opted_in then now() else null end,consent_method=p_method,consent_details=trim(p_details)
 where client_id=p_client_id and public.communication_recipient('SMS',phone_number)=normalized_phone;
 if p_opted_in then
  delete from public.communication_suppressions where channel='SMS' and communication_suppressions.recipient=normalized_phone and reason='staff_sms_opt_out';
 else
  insert into public.communication_suppressions(channel,recipient,reason,created_by) values('SMS',normalized_phone,'staff_sms_opt_out',actor) on conflict(channel,recipient) do nothing;
  update public.communication_outbox set state='failed',last_error='recipient_suppressed' where channel='SMS' and communication_outbox.recipient=normalized_phone and state='pending';
 end if;
 select * into result from public.sms_consent where client_id=p_client_id and phone_number=normalized_phone;
 return result;
end $function$;

-- release_communication_claim(uuid,uuid,text)
CREATE OR REPLACE FUNCTION public.release_communication_claim(p_id uuid, p_lease_token uuid, p_error_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 perform public.communication_require_service();
 update public.communication_outbox set state='failed',last_error=left(p_error_code,200),lease_token=null,lease_expires_at=null,updated_at=now() where id=p_id and state='claimed' and lease_token=p_lease_token and attempt_started_at is null;
 if not found then raise exception 'Outbox claim unavailable' using errcode='PT409'; end if;
end $function$;

-- release_communication_event(uuid,uuid,text,boolean)
CREATE OR REPLACE FUNCTION public.release_communication_event(p_id uuid, p_lease_token uuid, p_error text, p_review boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 perform public.communication_require_service();
 if p_error is null or p_error not in ('provider_content_requires_review','provider_fetch_or_persistence_retry') or p_review is null or (p_error='provider_content_requires_review') is distinct from p_review then raise exception 'Typed processing failure required' using errcode='23514';end if;
 update public.communication_provider_events set state=case when p_review or cycle_attempts>=10 then 'review' else 'pending' end,available_at=clock_timestamp()+make_interval(secs=>least(3600,power(2,least(cycle_attempts,10))::integer*30)),last_error=p_error,lease_token=null,lease_expires_at=null where id=p_id and state='claimed' and lease_token=p_lease_token and lease_expires_at>clock_timestamp();
 if not found then raise exception 'Provider event lease unavailable' using errcode='PT409';end if;
end $function$;

-- release_read_internal(uuid)
CREATE OR REPLACE FUNCTION public.release_read_internal(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.record_releases; events jsonb; eligible boolean:=true; why text; current_preview jsonb;
begin
 
 select * into r from public.record_releases where id=p_id for share;
 if not found then raise exception 'Release not found' using errcode='23514'; end if;
 select coalesce(jsonb_agg(to_jsonb(e) order by created_at,id),'[]') into events from public.record_release_events e where release_id=p_id;
 if jsonb_array_length(events)>0 then eligible:=false;why:='Withdrawn or a reviewed source changed';
 else
  begin
   if r.snapshot->>'schema_version'='13' then current_preview:=public.release_preview_v13_internal(r.pet_id,r.client_id,r.channel,r.recipient,r.selection); elsif r.snapshot->>'schema_version'='12' then current_preview:=public.release_preview_v12_internal(r.pet_id,r.client_id,r.channel,r.recipient,r.selection); elsif r.snapshot->>'schema_version'='11' then current_preview:=public.release_preview_v11_internal(r.pet_id,r.client_id,r.channel,r.recipient,r.selection); elsif r.snapshot->>'schema_version'='10' then current_preview:=public.release_preview_v10_internal(r.pet_id,r.client_id,r.channel,r.recipient,r.selection); elsif r.snapshot->>'schema_version'='9' then current_preview:=public.release_preview_v9_internal(r.pet_id,r.client_id,r.channel,r.recipient,r.selection); elsif r.snapshot->>'schema_version'='8' then current_preview:=public.release_preview_v8_internal(r.pet_id,r.client_id,r.channel,r.recipient,r.selection); elsif r.snapshot->>'schema_version'='7' then current_preview:=public.release_preview_v7_internal(r.pet_id,r.client_id,r.channel,r.recipient,r.selection); elsif r.snapshot->>'schema_version'='6' then current_preview:=public.release_preview_v6_internal(r.pet_id,r.client_id,r.channel,r.recipient,r.selection); elsif r.snapshot->>'schema_version'='5' then current_preview:=public.release_preview_v5_internal(r.pet_id,r.client_id,r.channel,r.recipient,r.selection); elsif r.snapshot->>'schema_version'='1' then current_preview:=public.preview_record_release_v1(r.pet_id,r.client_id,r.channel,r.recipient,r.selection); elsif r.snapshot->>'schema_version'='2' then current_preview:=public.preview_record_release_v2(r.pet_id,r.client_id,r.channel,r.recipient,r.selection); elsif r.snapshot->>'schema_version'='3' then current_preview:=public.release_preview_v3_internal(r.pet_id,r.client_id,r.channel,r.recipient,r.selection); else current_preview:=public.release_preview_internal(r.pet_id,r.client_id,r.channel,r.recipient,r.selection);end if;
   if current_preview->>'source_hash'<>r.source_hash then eligible:=false;why:='Current source snapshot differs';end if;
  exception when sqlstate '23514' or sqlstate '42501' or sqlstate 'PT409' then eligible:=false;why:='Source or recipient is no longer eligible';end;
 end if;
 if r.snapshot->>'schema_version' not in ('5','6','7','8','9','10','11','12','13') and exists(select 1 from public.record_release_sources s where s.release_id=r.id and s.source_kind='document' and public.release_document_has_provenance(s.source_id)) then eligible:=false;why:='Selected original now requires source provenance review';end if; if r.snapshot->>'schema_version' not in ('6','7','8','9','10','11','12','13') and exists(select 1 from public.record_release_sources s where s.release_id=r.id and s.source_kind='problem' and public.release_problem_has_import_provenance(s.source_id)) then eligible:=false;why:='Selected problem now requires imported source lineage review';end if; return jsonb_build_object('release',to_jsonb(r)-'request','events',events,'eligible',eligible,'ineligibility_reason',why);
end $function$;

-- replace_native_prescription(uuid,jsonb)
CREATE OR REPLACE FUNCTION public.replace_native_prescription(p_id uuid, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a uuid:=public.clinical_require_staff();r jsonb;preview jsonb;auth_doc jsonb;e jsonb;di uuid;ev integer;recon jsonb;k text;
begin
 r:=public.native_rx_begin(p_id,'replace',p_request);if r is not null then return r;end if;
 perform public.native_rx_check_change_request(p_request,true);
 di:=public.native_rx_uuid(p_request->'draft_id');ev:=public.native_rx_revision(p_request->'expected_version');perform public.native_rx_text(p_request->'signature_name',200);recon:=p_request->'reconciliation';
 perform public.native_rx_keys(recon,array['native_use_note','external_use_status','external_use_note','remaining_allowance_note','attest_review']);
 foreach k in array array['native_use_note','external_use_note','remaining_allowance_note'] loop perform public.native_rx_text(recon->k,2000);end loop;
 if ev is null or recon->'attest_review' is distinct from 'true'::jsonb or recon->>'external_use_status' is null or recon->>'external_use_status' not in ('unknown','reconciled') then raise exception 'Explicit replacement use reconciliation required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('native-prescriber:'||a::text,0));perform public.native_rx_require_dvm();
 perform pg_advisory_xact_lock(hashtextextended('native-prescription-authorization:'||(p_request->>'authorization_id')::uuid::text,0));
 perform pg_advisory_xact_lock(hashtextextended('native-prescription-draft:'||di::text,0));perform 1 from public.native_prescription_drafts where id=di for update;
 preview:=public.preview_native_prescription_replacement((p_request->>'authorization_id')::uuid,(p_request->>'pet_id')::uuid,di,ev);
 perform public.native_rx_check_change_context(p_request,preview,true);
 if preview#>>'{context,prior,authorization,artifact,fulfillment_mode}'='external_pharmacy' and recon->>'external_use_status'<>'reconciled' then raise exception 'Unknown external fulfillment must be reconciled before replacement' using errcode='23514';end if;
 auth_doc:=public.native_rx_materialize_authorization(p_id,jsonb_build_object('draft_id',di,'pet_id',p_request->'pet_id','expected_version',ev,'expected_context_hash',preview#>>'{context,new_sign_context_hash}','signature_name',p_request->>'signature_name','attest_review',true));
 e:=public.native_rx_append_event(p_id,p_request,preview,p_id);
 if preview#>'{context,prior,prescriber}' is distinct from public.native_rx_require_dvm() then raise exception 'Prescriber configuration changed' using errcode='PT409';end if;
 return public.native_rx_finish(p_id,'replace',(p_request->>'pet_id')::uuid,p_request,jsonb_build_object('authorization',auth_doc,'event',e));
end $function$;

-- requeue_communication_event(uuid,uuid,text,text,boolean)
CREATE OR REPLACE FUNCTION public.requeue_communication_event(p_id uuid, p_event_id uuid, p_expected_work_hash text, p_reason text, p_attest boolean)
 RETURNS communication_event_retry_actions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid:=public.clinical_require_staff();r public.communication_provider_events;a public.communication_event_retry_actions;
begin
 if not public.has_role(actor,'ADMIN') then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_attest is distinct from true or p_expected_work_hash is null or p_expected_work_hash!~'^[a-f0-9]{64}$' or p_reason is null or p_reason not in ('provider_recovered','configuration_repaired','processor_repaired') then raise exception 'Explicit reviewed processing retry required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,4300));
 select * into a from public.communication_event_retry_actions where id=p_id;
 if found then if row(a.actor_id,a.event_id,a.expected_work_hash,a.reason) is distinct from row(actor,p_event_id,p_expected_work_hash,p_reason) then raise exception 'Retry UUID already used' using errcode='23505';end if;return a;end if;
 select * into r from public.communication_provider_events where id=p_event_id for update;
 if not found then raise exception 'Processing event unavailable' using errcode='42501';end if;
 if public.communication_retry_hash(r) is distinct from p_expected_work_hash then raise exception 'Processing work changed; review again' using errcode='PT409';end if;
 if public.communication_retry_eligible(r) is distinct from true then raise exception 'Processing failure requires separate review; retry unavailable' using errcode='23514';end if;
 insert into public.communication_event_retry_actions(id,actor_id,event_id,expected_work_hash,reason,previous_cycle_no,cycle_no,lifetime_attempts) values(p_id,actor,r.id,p_expected_work_hash,p_reason,r.cycle_no,r.cycle_no+1,r.attempts) returning * into a;
 update public.communication_provider_events set state='pending',cycle_no=cycle_no+1,cycle_attempts=0,available_at=clock_timestamp(),last_error=null where id=r.id;
 return a;
end $function$;

-- requeue_outbox_retry(uuid,uuid,text,text,boolean)
CREATE OR REPLACE FUNCTION public.requeue_outbox_retry(p_id uuid, p_outbox_id uuid, p_expected_work_hash text, p_reason text, p_attest boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid:=public.operations_require_admin();a public.outbox_retry_actions;preview jsonb;o public.communication_outbox;
begin
 if p_id is null or p_outbox_id is null or p_expected_work_hash is null or p_expected_work_hash !~ '^[a-f0-9]{64}$' or p_reason is null or p_reason not in ('configuration_repaired','recipient_reverified','source_reverified') or p_attest is distinct from true then raise exception 'Exact reviewed retry and attestation required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,945));
 select * into a from public.outbox_retry_actions where id=p_id;
 if found then
  if row(a.actor_id,a.outbox_id,a.expected_work_hash,a.reason) is distinct from row(actor,p_outbox_id,p_expected_work_hash,p_reason) then raise exception 'Retry request ID is already bound' using errcode='23505';end if;
  return to_jsonb(a);
 end if;
 preview:=public.outbox_retry_preview_internal(p_outbox_id);
 if preview is null or preview->>'expected_work_hash' is distinct from p_expected_work_hash then raise exception 'Retry work changed; review again' using errcode='PT409';end if;
 if (preview->>'eligible')::boolean is distinct from true then raise exception 'Outbox is not eligible for reviewed retry' using errcode='42501';end if;
 select * into o from public.communication_outbox where id=p_outbox_id;
 insert into public.outbox_retry_actions(id,actor_id,outbox_id,expected_work_hash,reason,previous_revision,queued_revision) values(p_id,actor,p_outbox_id,p_expected_work_hash,p_reason,o.revision,o.revision+1) returning * into a;
 insert into public.communication_retry_audit(outbox_id,requested_by,previous_state) values(o.id,actor,o.state);
 update public.communication_outbox set state='pending',updated_at=now() where id=o.id;
 return to_jsonb(a);
end $function$;

-- requeue_stripe_event(uuid,uuid,text,text,boolean)
CREATE OR REPLACE FUNCTION public.requeue_stripe_event(p_resolution_id uuid, p_receipt_id uuid, p_expected_work_hash text, p_reason text, p_attest boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid:=public.payment_require_admin();saved public.stripe_event_retry_cycles;w public.stripe_event_work;target jsonb;
begin
 if p_resolution_id is null or p_attest is distinct from true or p_expected_work_hash is null or p_expected_work_hash !~ '^[a-f0-9]{64}$' or p_reason is null or p_reason not in ('provider_recovered','rate_limit_resolved','processor_repaired') then raise exception 'Exact administrator retry review required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_resolution_id::text,4000));
 select * into saved from public.stripe_event_retry_cycles where id=p_resolution_id;
 if found then
 if row(saved.receipt_id,saved.actor_id,saved.expected_work_hash,saved.reason) is distinct from row(p_receipt_id,actor,p_expected_work_hash,p_reason) then raise exception 'Retry review identifier already used' using errcode='23505';end if;
 return to_jsonb(saved);end if;
 select * into w from public.stripe_event_work where receipt_id=p_receipt_id for update;
 if not found then raise exception 'Receipt unavailable' using errcode='42501';end if;
 target:=public.stripe_event_retry_target(p_receipt_id);
 perform 1 from public.billing_invoices where id=(target->>'invoice_id')::uuid for update;
 if public.stripe_event_retry_hash(p_receipt_id) is distinct from p_expected_work_hash then raise exception 'Retry work or financial context changed' using errcode='PT409';end if;
 perform public.stripe_event_retry_target(p_receipt_id);
 insert into public.stripe_event_retry_cycles(id,receipt_id,actor_id,cycle_no,expected_work_hash,reason,previous_attempt_count,previous_cycle_attempt_count) values(p_resolution_id,p_receipt_id,actor,w.cycle_no+1,p_expected_work_hash,p_reason,w.attempt_count,w.cycle_attempt_count) returning * into saved;
 update public.stripe_event_work set state='queued',cycle_no=w.cycle_no+1,cycle_attempt_count=0,available_at=clock_timestamp(),reason='',lease_token=null,lease_expires_at=null,updated_at=clock_timestamp() where receipt_id=p_receipt_id;
 return to_jsonb(saved);
end $function$;

-- retry_outbound_delivery(uuid,timestamp with time zone,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.retry_outbound_delivery(p_delivery_id uuid, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_requested_at timestamp with time zone DEFAULT now())
 RETURNS outbound_deliveries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor_id uuid := auth.uid();
  result public.outbound_deliveries;
begin
  if actor_id is null or not public.is_active_staff(actor_id) then
    raise exception 'Active staff access required' using errcode = '42501';
  end if;

  if p_delivery_id is null then
    raise exception 'Delivery id is required' using errcode = '23514';
  end if;

  if p_requested_at is null then
    raise exception 'Retry timestamp is required' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.outbound_deliveries od
    where od.id = p_delivery_id
      and od.status in (
        'FAILED'::public.outbound_delivery_status,
        'UNKNOWN'::public.outbound_delivery_status
      )
      and od.attempt_count >= 25
  ) then
    raise exception 'Outbound delivery has reached the manual retry limit' using errcode = '23514';
  end if;

  update public.outbound_deliveries od
  set status = 'QUEUED'::public.outbound_delivery_status,
    status_note = 'Manually requeued by staff',
    last_error_text = null,
    provider = null,
    provider_message_id = null,
    next_attempt_at = p_requested_at,
    leased_at = null,
    leased_until = null,
    lease_owner = null,
    max_attempts = greatest(od.max_attempts, od.attempt_count + 1),
    accepted_at = null,
    delivered_at = null,
    failed_at = null,
    canceled_at = null,
    unknown_at = null
  where od.id = p_delivery_id
    and od.status in (
      'FAILED'::public.outbound_delivery_status,
      'UNKNOWN'::public.outbound_delivery_status
    )
    and (
      p_expected_updated_at is null
      or od.updated_at = p_expected_updated_at
    )
  returning od.* into result;

  if not found then
    raise exception 'Outbound delivery is not retryable' using errcode = 'PT409';
  end if;

  if result.appointment_reminder_id is not null then
    update public.appointment_reminders ar
    set status = 'QUEUED'::public.reminder_status,
      error_message = null,
      sent_at = null
    where ar.id = result.appointment_reminder_id;
  end if;

  return result;
end
$function$;

-- revalidate_abandoned_attachment_cleanup(uuid,uuid)
CREATE OR REPLACE FUNCTION public.revalidate_abandoned_attachment_cleanup(p_id uuid, p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare receipt public.abandoned_attachment_cleanup;upload public.conversation_attachment_uploads;object_row storage.objects;
begin
 perform public.communication_require_service();
 select * into receipt from public.abandoned_attachment_cleanup where id=p_id;
 if not found then raise exception 'Cleanup unavailable' using errcode='42501';end if;
 select * into upload from public.conversation_attachment_uploads where id=receipt.upload_id for update;
 select * into receipt from public.abandoned_attachment_cleanup where id=p_id for update;
 if upload.status<>'abandoned' or upload.storage_path is distinct from receipt.storage_path or receipt.state<>'claimed'
  or receipt.token is distinct from p_token then raise exception 'Cleanup lease or eligibility changed' using errcode='42501';end if;
 if receipt.expires_at<=clock_timestamp() then raise exception 'Cleanup lease expired' using errcode='PT409';end if;
 if exists(select 1 from public.conversation_email_artifacts a cross join lateral jsonb_array_elements(a.manifest) f where f->>'upload_id'=upload.id::text) then
  raise exception 'Referenced attachment evidence must be retained' using errcode='42501';end if;
 select * into object_row from storage.objects where bucket_id='conversation-attachment-uploads' and name=receipt.storage_path for share;
 if object_row.id is not null and row(object_row.id,object_row.created_at) is distinct from row(receipt.object_id,receipt.object_created_at) then
  raise exception 'Cleanup object identity changed' using errcode='42501';end if;
 return public.abandoned_cleanup_lease(receipt,upload);
end $function$;

-- review_ezyvet_weight_change(uuid,uuid,uuid,integer,text)
CREATE OR REPLACE FUNCTION public.review_ezyvet_weight_change(p_request_id uuid, p_approval_id uuid, p_snapshot_id uuid, p_head_version integer, p_reason text)
 RETURNS ezyvet_weight_source_reviews
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a public.ezyvet_weight_approvals;s public.ezyvet_import_snapshots;h public.ezyvet_identity_heads;r public.ezyvet_weight_source_reviews;
begin
 if public.ezyvet_is_active_admin(auth.uid()) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('weight-change:'||p_request_id::text,0));
 select * into r from ezyvet_weight_source_reviews where request_id=p_request_id;
 if found then if row(r.approval_id,r.snapshot_id,r.head_version,r.reason,r.reviewed_by) is distinct from row(p_approval_id,p_snapshot_id,p_head_version,trim(p_reason),auth.uid()) then raise exception 'Review ID mismatch' using errcode='42501';end if;return r;end if;
 select * into strict a from ezyvet_weight_approvals where request_id=p_approval_id;
 select * into strict s from ezyvet_import_snapshots where id=p_snapshot_id and resource='healthstatus' and source_origin=a.source_origin and source_site_uid=a.source_site_uid and external_id=a.external_id;
 select * into h from ezyvet_identity_heads where source_origin=s.source_origin and source_site_uid=s.source_site_uid and resource=s.resource and external_id=s.external_id for share;
 if h.snapshot_id is distinct from s.id or h.version is distinct from p_head_version then raise exception 'Source changed; review current observation' using errcode='PT409';end if;
 insert into ezyvet_weight_source_reviews(request_id,approval_id,snapshot_id,head_version,reason,reviewed_by) values(p_request_id,a.request_id,s.id,h.version,trim(p_reason),auth.uid()) returning * into r;return r;
end $function$;

-- review_lab_order_source(uuid,uuid,uuid,integer,uuid,text,text,uuid,text,boolean)
CREATE OR REPLACE FUNCTION public.review_lab_order_source(p_id uuid, p_order_id uuid, p_pet_id uuid, p_expected_order_version integer, p_source_account_id uuid, p_source_patient_reference text, p_source_order_reference text, p_previous_review_id uuid, p_review_reason text, p_attest boolean)
 RETURNS lab_order_source_reviews
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid:=public.clinical_require_staff();r public.lab_order_source_reviews;o public.patient_lab_orders;prior public.lab_order_source_reviews;
begin
 if p_id is null or p_attest is distinct from true or p_review_reason is null or length(trim(p_review_reason)) not between 1 and 2000 or exists(select 1 from unnest(array[p_source_patient_reference,p_source_order_reference]) v where v is null or length(trim(v)) not between 1 and 500) then raise exception 'Explicit source identity review required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,4102));
 select * into r from public.lab_order_source_reviews where id=p_id;
 if found then if row(r.actor_id,r.order_id,r.pet_id,r.order_version,r.source_account_id,r.source_patient_reference,r.source_order_reference,r.previous_review_id,r.review_reason) is distinct from row(actor,p_order_id,p_pet_id,p_expected_order_version,p_source_account_id,p_source_patient_reference,p_source_order_reference,p_previous_review_id,p_review_reason) then raise exception 'Source mapping UUID already used' using errcode='23505';end if;return r;end if;
 select * into o from public.patient_lab_orders where id=p_order_id and pet_id=p_pet_id for update;
 if not found then raise exception 'Lab order belongs to another patient or is unavailable' using errcode='42501';end if;
 if o.version is distinct from p_expected_order_version then raise exception 'Lab order changed' using errcode='PT409';end if;
 perform 1 from public.lab_source_accounts where id=p_source_account_id and manual_import_enabled;
 if not found then raise exception 'Reviewed source account required' using errcode='42501';end if;
 select * into prior from public.lab_order_source_reviews where order_id=o.id order by revision desc limit 1;
 if prior.id is distinct from p_previous_review_id then raise exception 'Source identity mapping changed' using errcode='PT409';end if;
 insert into public.lab_order_source_reviews(id,actor_id,order_id,pet_id,order_version,source_account_id,source_patient_reference,source_order_reference,previous_review_id,revision,review_reason) values(p_id,actor,o.id,o.pet_id,o.version,p_source_account_id,p_source_patient_reference,p_source_order_reference,prior.id,coalesce(prior.revision,0)+1,p_review_reason) returning * into r;return r;
end $function$;

-- review_website_inquiry_household(uuid,uuid,integer,uuid,text,text,boolean,text)
CREATE OR REPLACE FUNCTION public.review_website_inquiry_household(p_actor_id uuid, p_id uuid, p_expected_version integer, p_client_id uuid, p_channel text, p_recipient text, p_confirmed boolean, p_evidence text)
 RETURNS website_inquiry_triage
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid;original public.website_inquiry_triage;result public.website_inquiry_triage;recipient text;household public.clients;
begin
 actor:=public.clinical_require_staff();if actor is distinct from p_actor_id then raise exception 'Actor mismatch' using errcode='42501';end if;
 select * into original from public.website_inquiry_triage where inquiry_id=p_id for update;
 if not found or original.version is distinct from p_expected_version then raise exception 'Inquiry changed; reload before linking' using errcode='PT409';end if;
 recipient:=public.communication_recipient(p_channel,p_recipient);
 select * into household from public.clients where id=p_client_id;
 if not found or p_confirmed is distinct from true or p_evidence is null or length(trim(p_evidence)) not between 5 and 1000 or recipient is null or recipient is distinct from public.communication_recipient(p_channel,case when p_channel='EMAIL' then household.primary_email else household.primary_phone end) then raise exception 'Independently confirm the household and its current reply destination' using errcode='23514';end if;
 update public.website_inquiry_triage set status='in_progress',client_id=p_client_id,reply_channel=p_channel,reply_recipient=recipient,reviewed_by=actor,reviewed_at=now(),version=version+1,updated_at=now() where inquiry_id=p_id returning * into result;
 insert into public.website_inquiry_history(inquiry_id,actor_id,action,reason,before_value,after_value) values(p_id,actor,'household_review',trim(p_evidence),to_jsonb(original),to_jsonb(result)||jsonb_build_object('household_name',household.full_name));
 return result;
end $function$;

-- save_appointment(uuid,uuid,integer,uuid,uuid,timestamp with time zone,integer,text,appointment_status,uuid,text,text,integer,integer,text,text,integer[])
CREATE OR REPLACE FUNCTION public.save_appointment(p_actor_id uuid, p_id uuid, p_expected_version integer, p_client_id uuid, p_pet_id uuid, p_scheduled_at timestamp with time zone, p_duration_minutes integer, p_appointment_type text, p_status appointment_status, p_assigned_dvm_id uuid, p_visit_type text, p_address_snapshot text, p_travel_before_minutes integer, p_travel_after_minutes integer, p_resource_name text, p_notes text, p_reminder_offsets integer[])
 RETURNS appointments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid; result public.appointments; previous public.appointments; offset_hours integer; busy_start timestamptz; busy_end timestamptz; reminder_channel text;
begin
 actor := public.clinical_require_staff();
 if p_actor_id is distinct from actor then raise exception 'Actor mismatch' using errcode='42501'; end if;
 -- A transaction-scoped schedule lock also covers clinician reassignment and shared rooms.
 perform pg_advisory_xact_lock(73260123);
 if p_id is not null then
  select * into previous from public.appointments where id=p_id for update;
  if not found or previous.version is distinct from p_expected_version then raise exception 'Appointment changed; reload before saving' using errcode='PT409'; end if;
 end if;
 if p_client_id is null or p_pet_id is null or not exists(select 1 from public.pets where id=p_pet_id and client_id=p_client_id and ((archived_at is null and deceased_at is null) or (p_status='CANCELLED' and previous.pet_id=p_pet_id and previous.client_id=p_client_id))) then raise exception 'Select an active patient belonging to this household' using errcode='23514'; end if;
 if p_assigned_dvm_id is null or (not public.is_active_staff(p_assigned_dvm_id) and not coalesce(p_status='CANCELLED' and previous.assigned_dvm_id=p_assigned_dvm_id,false)) then raise exception 'Select an active staff clinician' using errcode='23514'; end if;
 if p_scheduled_at is null or not isfinite(p_scheduled_at) or p_duration_minutes is null or p_duration_minutes not between 5 and 480 or p_visit_type is null or p_visit_type not in ('clinic','housecall') or p_status is null or p_travel_before_minutes is null or p_travel_before_minutes not between 0 and 240 or p_travel_after_minutes is null or p_travel_after_minutes not between 0 and 240 then raise exception 'Invalid appointment time or duration' using errcode='23514'; end if;
 if p_appointment_type is null or length(trim(p_appointment_type)) not between 1 and 150 or p_address_snapshot is null or length(trim(p_address_snapshot)) not between 1 and 1000 or length(p_notes)>10000 or length(p_resource_name)>150 then raise exception 'Appointment fields are missing or too long' using errcode='23514'; end if;
 if p_reminder_offsets is null or cardinality(p_reminder_offsets)>5 or exists(select 1 from unnest(p_reminder_offsets) h where h is null or h not between 1 and 720) or cardinality(p_reminder_offsets)<>(select count(distinct h) from unnest(p_reminder_offsets) h) then raise exception 'Use up to five distinct reminder offsets between 1 and 720 hours' using errcode='23514'; end if;
 busy_start := p_scheduled_at - make_interval(mins=>p_travel_before_minutes);
 busy_end := p_scheduled_at + make_interval(mins=>p_duration_minutes+p_travel_after_minutes);
 if p_status in ('SCHEDULED','CONFIRMED') and exists (
  select 1 from public.appointments a where a.id is distinct from p_id and a.status in ('SCHEDULED','CONFIRMED')
  and (a.assigned_dvm_id=p_assigned_dvm_id or (nullif(trim(p_resource_name),'') is not null and lower(a.resource_name)=lower(trim(p_resource_name))))
  and a.scheduled_at-make_interval(mins=>a.travel_before_minutes)<busy_end
  and a.scheduled_at+make_interval(mins=>a.duration_minutes+a.travel_after_minutes)>busy_start
 ) then raise exception 'Clinician or room is already booked, including travel buffers' using errcode='23P01'; end if;
 if p_id is null then
  insert into public.appointments(client_id,pet_id,scheduled_at,duration_minutes,appointment_type,status,assigned_dvm_id,visit_type,address_snapshot,travel_before_minutes,travel_after_minutes,resource_name,notes,reminder_offsets,updated_by)
  values(p_client_id,p_pet_id,p_scheduled_at,p_duration_minutes,trim(p_appointment_type),p_status,p_assigned_dvm_id,p_visit_type,case when p_visit_type='clinic' then '2619 Spruce Street, Boulder, CO' else trim(p_address_snapshot) end,p_travel_before_minutes,p_travel_after_minutes,nullif(trim(p_resource_name),''),p_notes,p_reminder_offsets,actor) returning * into result;
 else
  update public.appointments set client_id=p_client_id,pet_id=p_pet_id,scheduled_at=p_scheduled_at,duration_minutes=p_duration_minutes,appointment_type=trim(p_appointment_type),status=p_status,assigned_dvm_id=p_assigned_dvm_id,visit_type=p_visit_type,address_snapshot=case when p_visit_type='clinic' then '2619 Spruce Street, Boulder, CO' else trim(p_address_snapshot) end,travel_before_minutes=p_travel_before_minutes,travel_after_minutes=p_travel_after_minutes,resource_name=nullif(trim(p_resource_name),''),notes=p_notes,reminder_offsets=p_reminder_offsets,updated_by=actor,version=version+1 where id=p_id returning * into result;
 end if;
 update public.appointment_reminders set status='SKIPPED',error_message='Appointment revised' where appointment_id=result.id and status='PENDING';
 if result.status in ('SCHEDULED','CONFIRMED') then
  -- Chosen per appointment revision; a household change takes effect on the next save.
  -- With no consented channel yet, keep the preferred one: consent given before the
  -- reminder is due still lets it send, and the queue preflight blocks it otherwise.
  select coalesce(public.appointment_reminder_channel(c.id),case when c.preferred_channel::text='EMAIL' then 'EMAIL' else 'SMS' end) into reminder_channel from public.clients c where c.id=result.client_id;
  foreach offset_hours in array result.reminder_offsets loop
   insert into public.appointment_reminders(appointment_id,appointment_version,remind_at,channel,status)
   values(result.id,result.version,result.scheduled_at-make_interval(hours=>offset_hours),reminder_channel,case when result.scheduled_at-make_interval(hours=>offset_hours)>now() then 'PENDING'::public.reminder_status else 'SKIPPED'::public.reminder_status end);
  end loop;
 end if;
 return result;
end $function$;

-- save_care_message_template(uuid,integer,text,text,integer,text,boolean,text)
CREATE OR REPLACE FUNCTION public.save_care_message_template(p_id uuid, p_expected_version integer, p_name text, p_channel text, p_days_before integer, p_body text, p_active boolean, p_review_note text)
 RETURNS care_message_templates
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid;r public.care_message_templates;remainder text;
begin actor=public.care_require_admin();if p_id is null then raise exception 'Stable ID required' using errcode='23514';end if;
 remainder=replace(replace(replace(p_body,'{{patient_name}}',''),'{{care_name}}',''),'{{due_date}}','');if remainder~'[{}]' then raise exception 'Only patient_name, care_name and due_date placeholders are supported' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,15));select * into r from public.care_message_templates where id=p_id for update;
 if found then
  if r.updated_by=actor and r.version=coalesce(p_expected_version,0)+1 and row(r.name,r.channel,r.days_before,r.body,r.active,r.review_note) is not distinct from row(trim(p_name),p_channel,p_days_before,p_body,p_active,trim(p_review_note)) then return r;end if;
  if r.version is distinct from p_expected_version then raise exception 'Message template version conflict' using errcode='PT409';end if;
 elsif p_expected_version is not null then raise exception 'Message template version conflict' using errcode='PT409';end if;
 if r.id is null then insert into public.care_message_templates(id,name,channel,days_before,body,active,review_note,updated_by) values(p_id,trim(p_name),p_channel,p_days_before,p_body,p_active,trim(p_review_note),actor) returning * into r;
 else update public.care_message_templates set name=trim(p_name),channel=p_channel,days_before=p_days_before,body=p_body,active=p_active,review_note=trim(p_review_note),version=version+1,updated_by=actor,updated_at=now() where id=p_id returning * into r;end if;return r;
end $function$;

-- save_catalog_product(uuid,integer,text,text,text,text,bigint,boolean)
CREATE OR REPLACE FUNCTION public.save_catalog_product(p_id uuid, p_expected_version integer, p_name text, p_kind text, p_manufacturer text, p_unit text, p_unit_price_cents bigint, p_active boolean)
 RETURNS catalog_products
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result public.catalog_products; actor uuid:=public.clinical_require_staff();
begin
 if p_id is null then insert into public.catalog_products(name,kind,manufacturer,unit,unit_price_cents,active,created_by) values(trim(p_name),p_kind,coalesce(p_manufacturer,''),p_unit,p_unit_price_cents,p_active,actor) returning * into result;
 else update public.catalog_products set name=trim(p_name),kind=p_kind,manufacturer=coalesce(p_manufacturer,''),unit=p_unit,unit_price_cents=p_unit_price_cents,active=p_active where id=p_id and version=p_expected_version returning * into result;
 if not found then raise exception 'Product changed; reload before saving' using errcode='PT409'; end if; end if;
 return result;
end $function$;

-- save_catalog_vaccine_profile(uuid,integer,text,text[],text,text,integer,text)
CREATE OR REPLACE FUNCTION public.save_catalog_vaccine_profile(p_product_id uuid, p_expected_version integer, p_group_key text, p_species text[], p_vaccine_type text, p_labeled_duration text, p_default_booster_interval_days integer, p_review_note text)
 RETURNS catalog_vaccine_profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid:=public.clinical_require_staff(); r public.catalog_vaccine_profiles; g text; s text[]; vt text;
begin
 if not exists(select 1 from public.user_roles where user_id=actor and role in ('ADMIN','DVM')) then raise exception 'Veterinarian or administrator required for vaccine catalog metadata' using errcode='42501'; end if;
 if p_product_id is null then raise exception 'Vaccine product required' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_product_id::text,28120));
 perform 1 from public.catalog_products where id=p_product_id and kind='vaccine' for share;
 if not found then raise exception 'Vaccine metadata applies only to vaccine products' using errcode='23514'; end if;
 g:=nullif(lower(trim(coalesce(p_group_key,''))),'');
 if g is not null and g!~'^[a-z0-9][a-z0-9_-]{0,79}$' then raise exception 'Vaccine group key uses lowercase letters, digits, hyphen or underscore' using errcode='23514'; end if;
 if p_species is null or cardinality(p_species)>10 or exists(select 1 from unnest(p_species) x where x is null or length(trim(x)) not between 1 and 80) then raise exception 'List up to 10 species labels of 1-80 characters' using errcode='23514'; end if;
 select coalesce(array_agg(distinct lower(trim(x)) order by lower(trim(x))),'{}') into s from unnest(p_species) x;
 vt:=nullif(trim(coalesce(p_vaccine_type,'')),'');
 if vt is not null and length(vt)>200 then raise exception 'Vaccine type is too long' using errcode='23514'; end if;
 if p_labeled_duration is not null and p_labeled_duration not in ('1 year','3 years','other licensed duration') then raise exception 'Labeled duration must match the product label choices' using errcode='23514'; end if;
 if p_default_booster_interval_days is not null and p_default_booster_interval_days not between 1 and 36500 then raise exception 'Booster interval must be between 1 and 36500 days' using errcode='23514'; end if;
 if length(trim(coalesce(p_review_note,''))) not between 1 and 2000 then raise exception 'Record the label source or reviewer for this metadata' using errcode='23514'; end if;
 select * into r from public.catalog_vaccine_profiles where product_id=p_product_id for update;
 if found then
  -- A lost response retried by the same reviewer returns the saved row instead of conflicting.
  if r.updated_by=actor and r.version=coalesce(p_expected_version,0)+1 and row(r.group_key,r.species,r.vaccine_type,r.labeled_duration,r.default_booster_interval_days,r.review_note) is not distinct from row(g,s,vt,p_labeled_duration,p_default_booster_interval_days,trim(p_review_note)) then return r; end if;
  if r.version is distinct from p_expected_version then raise exception 'Vaccine profile changed; reload before saving' using errcode='PT409'; end if;
  update public.catalog_vaccine_profiles set group_key=g,species=s,vaccine_type=vt,labeled_duration=p_labeled_duration,default_booster_interval_days=p_default_booster_interval_days,review_note=trim(p_review_note),version=version+1,updated_by=actor,updated_at=now() where product_id=p_product_id returning * into r;
 else
  if p_expected_version is not null then raise exception 'Vaccine profile changed; reload before saving' using errcode='PT409'; end if;
  insert into public.catalog_vaccine_profiles(product_id,group_key,species,vaccine_type,labeled_duration,default_booster_interval_days,review_note,updated_by) values(p_product_id,g,s,vt,p_labeled_duration,p_default_booster_interval_days,trim(p_review_note),actor) returning * into r;
 end if;
 return r;
end $function$;

-- save_client(uuid,uuid,integer,text,text,text,text,channel_type,text,text)
CREATE OR REPLACE FUNCTION public.save_client(p_actor_id uuid, p_client_id uuid, p_expected_version integer, p_first_name text, p_last_name text, p_primary_phone text, p_primary_email text, p_preferred_channel channel_type, p_mailing_address text, p_housecall_address text)
 RETURNS clients
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result public.clients; actor uuid;
begin
 actor := public.clinical_require_staff();
 if p_actor_id is distinct from actor then raise exception 'Actor does not match signed-in staff' using errcode='42501'; end if;
 if p_first_name is null or length(trim(p_first_name)) not between 1 and 150 or p_last_name is null or length(trim(p_last_name)) not between 1 and 150 or length(p_primary_phone)>50 or length(p_primary_email)>254 or length(p_mailing_address)>1000 or length(p_housecall_address)>1000 then raise exception 'Client fields are missing or too long' using errcode='23514'; end if;
 if nullif(trim(p_primary_email),'') is not null and p_primary_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Client email is invalid' using errcode='23514'; end if;
 if p_client_id is null then
  insert into public.clients(first_name,last_name,full_name,primary_phone,primary_email,preferred_channel,mailing_address,housecall_address) values(trim(p_first_name),trim(p_last_name),trim(p_first_name)||' '||trim(p_last_name),nullif(trim(p_primary_phone),''),nullif(trim(p_primary_email),''),p_preferred_channel,nullif(trim(p_mailing_address),''),nullif(trim(p_housecall_address),'')) returning * into result;
 else
  update public.clients set first_name=trim(p_first_name),last_name=trim(p_last_name),full_name=trim(p_first_name)||' '||trim(p_last_name),primary_phone=nullif(trim(p_primary_phone),''),primary_email=nullif(trim(p_primary_email),''),preferred_channel=p_preferred_channel,mailing_address=nullif(trim(p_mailing_address),''),housecall_address=nullif(trim(p_housecall_address),'') where id=p_client_id and version=p_expected_version returning * into result;
  if not found then raise exception 'Record changed or no longer exists; reload before saving' using errcode='PT409'; end if;
 end if;
 return result;
end $function$;

-- save_clinical_encounter(uuid,uuid,integer,timestamp with time zone,text,text,text,text,text,text)
CREATE OR REPLACE FUNCTION public.save_clinical_encounter(p_id uuid, p_pet_id uuid, p_expected_version integer, p_visit_at timestamp with time zone, p_visit_type text, p_location text, p_subjective text, p_objective text, p_assessment text, p_plan text)
 RETURNS clinical_encounters
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result public.clinical_encounters; actor uuid;
begin
 actor := public.clinical_require_staff();
 if p_visit_at is null or p_visit_at > now() + interval '5 minutes' then raise exception 'Encounter date cannot exceed the current time by more than five minutes' using errcode = '23514'; end if;
 if p_id is null then
  perform 1 from public.pets where id=p_pet_id and archived_at is null and deceased_at is null for share;
  if not found then raise exception 'New encounters require an active patient' using errcode='23514'; end if;
  insert into public.clinical_encounters(pet_id,visit_at,visit_type,location,subjective,objective,assessment,plan,created_by,updated_by) values(p_pet_id,p_visit_at,p_visit_type,coalesce(p_location,''),coalesce(p_subjective,''),coalesce(p_objective,''),coalesce(p_assessment,''),coalesce(p_plan,''),actor,actor) returning * into result;
 else
  update public.clinical_encounters set visit_at=p_visit_at,visit_type=p_visit_type,location=coalesce(p_location,''),subjective=coalesce(p_subjective,''),objective=coalesce(p_objective,''),assessment=coalesce(p_assessment,''),plan=coalesce(p_plan,'') where id=p_id and pet_id=p_pet_id and version=p_expected_version returning * into result;
  if not found then raise exception 'Record changed or no longer exists; reload before saving' using errcode='PT409'; end if;
 end if;
 return result;
end $function$;

-- save_dental_chart(uuid,uuid,integer,text,timestamp with time zone,text,jsonb)
CREATE OR REPLACE FUNCTION public.save_dental_chart(p_id uuid, p_pet_id uuid, p_expected_version integer, p_dentition text, p_visit_at timestamp with time zone, p_notes text, p_teeth jsonb)
 RETURNS dental_charts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid;r public.dental_charts;family text;pet public.pets;
begin
 actor=public.clinical_require_staff();if p_id is null then raise exception 'Stable chart ID required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,5));
 select * into pet from public.pets where id=p_pet_id and archived_at is null and deceased_at is null for share;if not found then raise exception 'Dental drafts require an active patient' using errcode='23514';end if;
 select * into r from public.dental_charts where id=p_id for update;
 if found then
  if r.pet_id<>p_pet_id then raise exception 'Chart does not belong to patient' using errcode='42501';end if;
  if r.status<>'draft' then raise exception 'Signed chart is immutable; add a correction instead' using errcode='23514';end if;
  if r.dentition<>p_dentition then raise exception 'Saved chart dentition cannot change' using errcode='23514';end if;
  if r.updated_by=actor and r.visit_at=p_visit_at and r.notes=p_notes and r.teeth=p_teeth and ((p_expected_version is null and r.version=1)or r.version=p_expected_version+1) then return r;end if;
  if r.version is distinct from p_expected_version then raise exception 'Dental chart changed; reload before saving' using errcode='PT409';end if;
  perform public.dental_validate_data(r.species_family,r.dentition,p_teeth,p_notes,p_visit_at);
  update public.dental_charts set visit_at=p_visit_at,notes=p_notes,teeth=p_teeth,version=version+1,updated_by=actor,updated_at=now() where id=p_id returning * into r;
 else
  if p_expected_version is not null then raise exception 'Dental chart no longer exists' using errcode='PT409';end if;
  family=case when lower(trim(pet.species)) in ('dog','canine') then 'dog' when lower(trim(pet.species)) in ('cat','feline') then 'cat' else 'manual' end;
  if p_dentition is null or p_dentition not in ('adult','deciduous','manual') or(family='manual' and p_dentition<>'manual') then raise exception 'Select an appropriate dentition' using errcode='23514';end if;
  perform public.dental_validate_data(family,p_dentition,p_teeth,p_notes,p_visit_at);
  insert into public.dental_charts(id,pet_id,species_family,dentition,visit_at,notes,teeth,created_by,updated_by) values(p_id,p_pet_id,family,p_dentition,p_visit_at,p_notes,p_teeth,actor,actor) returning * into r;
 end if;return r;
end $function$;

-- save_ezyvet_migration_resolution(uuid,uuid,jsonb,text,text,text,uuid)
CREATE OR REPLACE FUNCTION public.save_ezyvet_migration_resolution(p_id uuid, p_scope_id uuid, p_target jsonb, p_action text, p_reason text, p_expected_context_hash text, p_replaces_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a uuid:=auth.uid();t jsonb;key text;request_hash text;previous public.ezyvet_migration_resolutions;existing public.ezyvet_migration_resolutions;stamp timestamptz;ver integer;
begin
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_scope_id is null or p_action is null or p_action not in ('exclude','reopen') or p_reason is null or p_reason<>btrim(p_reason) or length(p_reason) not between 1 and 2000 or p_expected_context_hash is null or p_expected_context_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid operational resolution' using errcode='23514';end if;
 t:=public.ezyvet_migration_resolution_target(p_target);key:=encode(sha256(convert_to(jsonb_build_object('version',1,'scope_id',p_scope_id,'target',t)::text,'UTF8')),'hex');
 request_hash:=encode(sha256(convert_to(jsonb_build_object('version',1,'actor_id',a,'scope_id',p_scope_id,'target',t,'action',p_action,'reason',p_reason,'expected_context_hash',p_expected_context_hash,'replaces_id',p_replaces_id)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('ezyvet-migration-resolution:'||p_id::text,0));
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into existing from public.ezyvet_migration_resolutions where id=p_id;
 if found then
  if existing.actor_id<>a or existing.request_hash<>request_hash then raise exception 'Resolution request identity cannot change' using errcode='42501';end if;
  return public.read_ezyvet_migration_resolution(p_id);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('ezyvet-migration-scope-binding:'||p_scope_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('ezyvet-migration-resolution-target:'||key,0));
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if not exists(select 1 from public.ezyvet_migration_scopes s join public.ezyvet_migration_runs r on r.id=s.migration_run_id where s.id=p_scope_id and r.actor_id=a) then raise exception 'Owned migration scope required' using errcode='42501';end if;
 select * into previous from public.ezyvet_migration_resolutions d where d.target_key=key and not exists(select 1 from public.ezyvet_migration_resolutions n where n.replaces_id=d.id);
 if previous.id is distinct from p_replaces_id then raise exception 'Exact preceding resolution required' using errcode='PT409';end if;
 if p_action='reopen' and (previous.id is null or previous.action<>'exclude') then raise exception 'Reopen requires a preceding exclusion' using errcode='23514';end if;
 ver:=coalesce(previous.version,0)+1;stamp:=clock_timestamp();
 -- Compare and append share one post-wait statement snapshot. Later source commits can stale the receipt.
 with context as materialized (select public.ezyvet_migration_resolution_context(p_scope_id,t) value),
 hashed as materialized (select value,encode(sha256(convert_to(value::text,'UTF8')),'hex') hash from context)
 insert into public.ezyvet_migration_resolutions(id,actor_id,migration_run_id,scope_id,target_kind,target,target_key,action,reason,request_hash,reviewed_context,reviewed_context_hash,replaces_id,version,record_hash,created_at)
 select p_id,a,(value#>>'{scope,migration_run_id}')::uuid,p_scope_id,t->>'kind',t,key,p_action,p_reason,request_hash,value,hash,p_replaces_id,ver,
  encode(sha256(convert_to(jsonb_build_object('version',1,'id',p_id,'actor_id',a,'scope_id',p_scope_id,'target',t,'target_key',key,'action',p_action,'reason',p_reason,'request_hash',request_hash,
   'reviewed_context_hash',hash,'replaces_id',p_replaces_id,'resolution_version',ver,'created_at',stamp)::text,'UTF8')),'hex'),stamp from hashed where hash=p_expected_context_hash;
 if not found then raise exception 'Operational evidence changed; review again' using errcode='PT409';end if;
 if public.ezyvet_is_active_admin(a) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return public.read_ezyvet_migration_resolution(p_id);
end $function$;

-- save_lab_due_template(uuid,integer,text,integer,boolean,text)
CREATE OR REPLACE FUNCTION public.save_lab_due_template(p_id uuid, p_expected_version integer, p_name text, p_interval_days integer, p_active boolean, p_review_note text)
 RETURNS lab_due_templates
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid;r public.lab_due_templates;
begin
 actor=public.clinical_require_staff();
 if not exists(select 1 from public.user_roles where user_id=actor and role='ADMIN') then raise exception 'Active administrator required to review standard settings' using errcode='42501';end if;
 if p_id is null then raise exception 'Stable request ID required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,10));
 select * into r from public.lab_due_templates where id=p_id for update;
 if found then
  if r.updated_by=actor and r.name=trim(p_name) and r.interval_days=p_interval_days and r.active=p_active and r.review_note=trim(p_review_note) and r.version=coalesce(p_expected_version,0)+1 then return r;end if;
  if r.version is distinct from p_expected_version then raise exception 'Template version conflict; reload' using errcode='PT409';end if;
  update public.lab_due_templates set name=trim(p_name),interval_days=p_interval_days,active=p_active,review_note=trim(p_review_note),version=version+1,updated_by=actor,updated_at=now() where id=p_id returning * into r;
 else
  if p_expected_version is not null then raise exception 'Template version conflict' using errcode='PT409';end if;
  insert into public.lab_due_templates(id,name,interval_days,active,review_note,updated_by) values(p_id,trim(p_name),p_interval_days,p_active,trim(p_review_note),actor) returning * into r;
 end if;
 insert into public.lab_work_revisions(entity,entity_id,version,snapshot,reason,actor_id) values('template',r.id,r.version,to_jsonb(r),r.review_note,actor);
 return r;
end $function$;

-- save_native_estimate_draft(uuid,jsonb)
CREATE OR REPLACE FUNCTION public.save_native_estimate_draft(p_id uuid, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid:=public.clinical_require_staff();root public.native_estimate_drafts;product public.catalog_products;doc jsonb;receipt jsonb;catalog jsonb:='{}';line jsonb;root_id uuid;target_client_id uuid;target_pet_id uuid;version_now integer;version_next integer;stamp timestamptz;total text;prior_hash text;request_digest text;begin
 if p_id is null then raise exception 'Stable estimate operation id required' using errcode='23514';end if;perform public.native_estimate_validate_request(p_request);
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));perform public.clinical_require_staff();receipt:=public.native_estimate_verified_operation(p_id);
 if receipt is not null then if receipt->>'actor_id'<>actor::text then raise exception 'Estimate receipt unavailable' using errcode='42501';end if;if receipt->'request' is distinct from p_request then raise exception 'Estimate operation identifier already used' using errcode='23514';end if;return receipt;end if;
 doc:=public.native_estimate_verified_closure(p_id);if doc is not null then if doc->>'actor_id'<>actor::text then raise exception 'Estimate closure unavailable' using errcode='42501';end if;raise exception 'Estimate operation permanently closed' using errcode='23514';end if;
 root_id:=(p_request->>'estimate_id')::uuid;target_client_id:=(p_request->>'client_id')::uuid;target_pet_id:=(p_request->>'pet_id')::uuid;
 perform pg_advisory_xact_lock(hashtextextended('native-estimate:'||root_id::text,0));perform public.clinical_require_staff();
 select * into root from public.native_estimate_drafts d where d.id=root_id;select max(r.version) into version_now from public.native_estimate_draft_revisions r where r.estimate_id=root_id;
 if root.id is not null then
  perform public.native_estimate_verified_revision(root_id,version_now);if root.client_id<>target_client_id or root.pet_id<>target_pet_id then raise exception 'Estimate household and patient cannot change' using errcode='23514';end if;
 end if;
 if p_request->'expected_version' is distinct from coalesce(to_jsonb(version_now),'null'::jsonb) then raise exception 'Estimate draft changed; compare current version' using errcode='PT409';end if;
 perform 1 from public.clients c where c.id=target_client_id for share;if not found then raise exception 'Estimate household not found' using errcode='23514';end if;
 perform 1 from public.pets p where p.id=target_pet_id and p.client_id=target_client_id for share;if not found then raise exception 'Estimate patient must belong to household' using errcode='23514';end if;
 for product in select p.* from public.catalog_products p where p.id in(select(value->>'product_id')::uuid from jsonb_array_elements(p_request#>'{fields,lines}')) order by p.id for share loop
  if not product.active then raise exception 'Estimate catalog changed' using errcode='PT409';end if;
  catalog:=catalog||jsonb_build_object(product.id::text,jsonb_build_object('id',product.id,'version',product.version,'kind',product.kind,'unit',product.unit,'unit_price_cents',product.unit_price_cents::text,'active',product.active));
 end loop;
 perform public.clinical_require_staff();
 for line in select value from jsonb_array_elements(p_request#>'{fields,lines}') loop
  if catalog->(line->>'product_id') is null or catalog#>array[line->>'product_id','version'] is distinct from line->'product_version' then raise exception 'Estimate catalog changed; review current product' using errcode='PT409';end if;
 end loop;
 total:=public.native_estimate_fields_total(p_request->'fields',catalog);
 if version_now=2147483647 then raise exception 'Estimate revision limit reached' using errcode='23514';end if;
 stamp:=greatest(clock_timestamp(),(select o.created_at from public.native_estimate_draft_operations o where o.estimate_id=root_id and o.version=version_now));version_next:=coalesce(version_now,0)+1;
 if root.id is null then insert into public.native_estimate_drafts values(root_id,target_client_id,target_pet_id,actor,stamp) returning * into root;end if;
 select r.record_hash into prior_hash from public.native_estimate_draft_revisions r where r.estimate_id=root_id and r.version=version_now;
 doc:=jsonb_build_object('id',root_id,'client_id',target_client_id,'pet_id',target_pet_id,'version',version_next,'fields',p_request->'fields','total_cents',total,'created_by',root.created_by,'created_at',root.created_at,'updated_by',actor,'updated_at',stamp);
 request_digest:=public.native_fulfillment_hash(jsonb_build_object('version',1,'actor_id',actor,'operation','save_estimate_draft','request',p_request));
 insert into public.native_estimate_draft_operations values(p_id,actor,p_request,request_digest,root_id,version_next,stamp);
 insert into public.native_estimate_draft_revisions values(root_id,version_next,p_id,doc,catalog,prior_hash,public.native_fulfillment_hash(jsonb_build_object('document',doc,'catalog',catalog,'previous_hash',prior_hash,'operation_id',p_id,'request_hash',request_digest)));
 perform public.clinical_require_staff();return public.native_estimate_verified_operation(p_id);
end $function$;

-- save_native_prescription_draft(uuid,jsonb)
CREATE OR REPLACE FUNCTION public.save_native_prescription_draft(p_id uuid, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a uuid:=public.clinical_require_staff();d public.native_prescription_drafts;di uuid;pet uuid;client uuid;ev integer;f jsonb;r jsonb;stamp timestamptz:=clock_timestamp();
begin
 r:=public.native_rx_begin(p_id,'save_draft',p_request);if r is not null then return r;end if;
 perform public.native_rx_keys(p_request,array['draft_id','pet_id','client_id','expected_version','fields']);
 di:=public.native_rx_uuid(p_request->'draft_id');pet:=public.native_rx_uuid(p_request->'pet_id');client:=public.native_rx_uuid(p_request->'client_id');ev:=public.native_rx_revision(p_request->'expected_version');
 perform pg_advisory_xact_lock(hashtextextended('native-prescription-draft:'||di::text,0));perform public.clinical_require_staff();
 select * into d from public.native_prescription_drafts where id=di for update;
 if d.version is distinct from ev then raise exception 'Prescription draft changed' using errcode='PT409';end if;
 if d.id is not null and (d.pet_id<>pet or d.client_id<>client or d.status<>'draft') then raise exception 'Signed draft or patient identity cannot change' using errcode='23514';end if;
 f:=public.native_rx_validate_fields(p_request->'fields',pet,client);
 if d.id is null then insert into public.native_prescription_drafts values(di,pet,client,1,f,'draft',null,a,a,stamp,stamp) returning * into d;
 else update public.native_prescription_drafts set fields=f,version=version+1,updated_by=a,updated_at=stamp where id=di returning * into d;end if;
 r:=public.native_rx_finish(p_id,'save_draft',pet,p_request,to_jsonb(d));
 insert into public.native_prescription_draft_revisions values(p_id,d.id,d.version,to_jsonb(d));return r;
end $function$;

-- save_patient(uuid,uuid,integer,text,text,text,date,text,text,text,text,text,timestamp with time zone,date)
CREATE OR REPLACE FUNCTION public.save_patient(p_id uuid, p_client_id uuid, p_expected_version integer, p_name text, p_species text, p_breed text, p_dob date, p_birth_date_precision text, p_color text, p_sex text, p_neuter_status text, p_microchip_id text, p_archived_at timestamp with time zone, p_deceased_at date)
 RETURNS pets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result public.pets;
begin
 perform public.clinical_require_staff();
 if p_name is null or length(trim(p_name)) not between 1 and 150 or p_species is null or length(trim(p_species)) not between 1 and 100 or length(p_breed)>150 or length(p_color)>150 or length(p_microchip_id)>100 then raise exception 'Patient fields are missing or too long' using errcode='23514'; end if;
 if p_dob>(now() at time zone 'America/Denver')::date or p_deceased_at>(now() at time zone 'America/Denver')::date or p_deceased_at<p_dob or (p_birth_date_precision in ('exact','estimated') and p_dob is null) then raise exception 'Patient dates are invalid' using errcode='23514'; end if;
 if p_id is null then
  insert into public.pets(client_id,name,species,breed,dob,birth_date_precision,color,sex,neuter_status,microchip_id,archived_at,deceased_at) values(p_client_id,trim(p_name),trim(p_species),p_breed,p_dob,p_birth_date_precision,p_color,p_sex,p_neuter_status,p_microchip_id,p_archived_at,p_deceased_at) returning * into result;
 else
  update public.pets set name=trim(p_name),species=trim(p_species),breed=p_breed,dob=p_dob,birth_date_precision=p_birth_date_precision,color=p_color,sex=p_sex,neuter_status=p_neuter_status,microchip_id=p_microchip_id,archived_at=p_archived_at,deceased_at=p_deceased_at where id=p_id and client_id=p_client_id and version=p_expected_version returning * into result;
  if not found then raise exception 'Record changed or no longer exists; reload before saving' using errcode='PT409'; end if;
 end if;
 return result;
end $function$;

-- save_patient_anesthesia_record(uuid,uuid,integer,jsonb)
CREATE OR REPLACE FUNCTION public.save_patient_anesthesia_record(p_id uuid, p_pet_id uuid, p_expected_version integer, p_values jsonb)
 RETURNS patient_anesthesia_records
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid;r public.patient_anesthesia_records;n public.patient_anesthesia_records;existed boolean;
begin
 actor=public.clinical_require_staff();
 if p_id is null or p_values is null or jsonb_typeof(p_values)<>'object' or exists(select 1 from jsonb_object_keys(p_values) k where k not in ('procedure_name','started_at','ended_at','team','assessment','plan','recovery_notes','observations','events','source','source_description','original_document_id')) then raise exception 'Invalid anesthesia record fields' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,12));
 select * into r from public.patient_anesthesia_records where id=p_id for update;existed=found;
 if existed and r.pet_id<>p_pet_id then raise exception 'Anesthesia record belongs to another patient' using errcode='42501';end if;
 if existed and r.status<>'draft' then raise exception 'Signed anesthesia records are immutable; append a correction' using errcode='23514';end if;
 n=jsonb_populate_record(null::public.patient_anesthesia_records,p_values);
 n.procedure_name=trim(n.procedure_name);n.team=trim(n.team);n.assessment=coalesce(n.assessment,'');n.plan=coalesce(n.plan,'');n.recovery_notes=coalesce(n.recovery_notes,'');n.source_description=coalesce(n.source_description,'');n.observations=coalesce(n.observations,'[]');n.events=coalesce(n.events,'[]');
 if existed and r.updated_by=actor and r.version=coalesce(p_expected_version,0)+1 and (to_jsonb(r)-array['id','pet_id','status','version','created_by','updated_by','created_at','updated_at','signed_by','signed_at'])=(to_jsonb(n)-array['id','pet_id','status','version','created_by','updated_by','created_at','updated_at','signed_by','signed_at']) then return r;end if;
 if existed and r.version is distinct from p_expected_version or not existed and p_expected_version is not null then raise exception 'Anesthesia record version conflict; reload' using errcode='PT409';end if;
 if not exists(select 1 from public.pets where id=p_pet_id and (existed or (archived_at is null and deceased_at is null))) then raise exception 'New records require an active patient' using errcode='23514';end if;
 perform public.anesthesia_validate(n);
 if n.original_document_id is not null then perform 1 from public.patient_documents where id=n.original_document_id and pet_id=p_pet_id and status='ready' for share;if not found then raise exception 'Original file must be a ready document for this patient' using errcode='42501';end if;end if;
 if existed then
 update public.patient_anesthesia_records set procedure_name=n.procedure_name,started_at=n.started_at,ended_at=n.ended_at,team=n.team,assessment=n.assessment,plan=n.plan,recovery_notes=n.recovery_notes,observations=n.observations,events=n.events,source=n.source,source_description=n.source_description,original_document_id=n.original_document_id,version=version+1,updated_by=actor,updated_at=now() where id=p_id returning * into r;
 else
 insert into public.patient_anesthesia_records(id,pet_id,procedure_name,started_at,ended_at,team,assessment,plan,recovery_notes,observations,events,source,source_description,original_document_id,created_by,updated_by) values(p_id,p_pet_id,n.procedure_name,n.started_at,n.ended_at,n.team,n.assessment,n.plan,n.recovery_notes,n.observations,n.events,n.source,n.source_description,n.original_document_id,actor,actor) returning * into r;
 end if;return r;
end $function$;

-- save_patient_lab_order(uuid,uuid,integer,jsonb,text)
CREATE OR REPLACE FUNCTION public.save_patient_lab_order(p_id uuid, p_pet_id uuid, p_expected_version integer, p_values jsonb, p_correction_reason text)
 RETURNS patient_lab_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid;r public.patient_lab_orders;n public.patient_lab_orders;t public.lab_due_templates;existed boolean;
begin
 actor=public.clinical_require_staff();
 if p_id is null or p_values is null or jsonb_typeof(p_values)<>'object' or exists(select 1 from jsonb_object_keys(p_values) k where k not in ('test_name','status','due_date','collected_date','result_date','accession','notes','result_document_id','template_id','template_version','interval_days','interval_anchor','override_reason','reminders_enabled')) then raise exception 'Invalid lab order fields' using errcode='23514';end if;
 if p_values ? 'reminders_enabled' and jsonb_typeof(p_values->'reminders_enabled')<>'boolean' then raise exception 'Invalid lab order fields' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,11));
 select * into r from public.patient_lab_orders where id=p_id for update;existed=found;
 if existed and r.pet_id<>p_pet_id then raise exception 'Order belongs to another patient' using errcode='42501';end if;
 n=jsonb_populate_record(null::public.patient_lab_orders,p_values);
 n.test_name=trim(n.test_name);n.notes=coalesce(n.notes,'');n.accession=coalesce(n.accession,'');n.override_reason=coalesce(n.override_reason,'');
 -- Callers that omit the switch keep the stored choice; only open orders can remind.
 n.reminders_enabled=case when p_values ? 'reminders_enabled' then (p_values->>'reminders_enabled')::boolean else coalesce(r.reminders_enabled,false) end;
 if n.status is null or n.status not in ('planned','ordered') then n.reminders_enabled=false;end if;
 -- Exact retry after an uncertain response returns its prior version without creating history twice.
 if existed and r.updated_by=actor and r.version=coalesce(p_expected_version,0)+1 and exists(select 1 from public.lab_work_revisions where entity='order' and entity_id=r.id and version=r.version and reason=coalesce(trim(p_correction_reason),'')) and
  (to_jsonb(r)-array['id','pet_id','version','created_by','updated_by','created_at','updated_at'])=(to_jsonb(n)-array['id','pet_id','version','created_by','updated_by','created_at','updated_at']) then return r;end if;
 if existed and r.version is distinct from p_expected_version or not existed and p_expected_version is not null then raise exception 'Lab order version conflict; reload before saving' using errcode='PT409';end if;
 if not exists(select 1 from public.pets where id=p_pet_id) then raise exception 'Patient not found' using errcode='23514';end if;
 if not existed and not exists(select 1 from public.pets where id=p_pet_id and archived_at is null and deceased_at is null) then raise exception 'New orders require an active patient' using errcode='23514';end if;
 if existed and (r.status in ('resulted','cancelled') or r.result_date is not null or r.result_document_id is not null) and nullif(trim(p_correction_reason),'') is null then raise exception 'Historical result changes require a correction reason' using errcode='23514';end if;
 if length(coalesce(p_correction_reason,''))>2000 then raise exception 'Correction reason too long' using errcode='23514';end if;
 if n.status in ('collected','resulted') and n.collected_date is null or n.status='resulted' and n.result_date is null then raise exception 'Record collection and result dates for this status' using errcode='23514';end if;
 if n.collected_date>(now() at time zone 'America/Denver')::date or n.result_date>(now() at time zone 'America/Denver')::date then raise exception 'Collection and result dates cannot be in the future' using errcode='23514';end if;
 if n.reminders_enabled and n.due_date is null then raise exception 'Set a lab due date before enabling reminders' using errcode='23514';end if;
 if n.result_document_id is not null then
  perform 1 from public.patient_documents where id=n.result_document_id and pet_id=p_pet_id and status='ready' for share;
  if not found then raise exception 'Choose a ready document belonging to this patient' using errcode='42501';end if;
 end if;
 if n.template_id is not null then
  select * into t from public.lab_due_templates where id=n.template_id for share;
  -- Existing provenance remains valid when a reusable template is later revised/retired.
  if not (existed and row(r.template_id,r.template_version,r.interval_days,r.interval_anchor,r.due_date,r.override_reason) is not distinct from row(n.template_id,n.template_version,n.interval_days,n.interval_anchor,n.due_date,n.override_reason)) then
   if t.id is null or not t.active or t.version is distinct from n.template_version then raise exception 'Template changed or retired; review current settings' using errcode='PT409';end if;
   if n.interval_days is distinct from t.interval_days and nullif(trim(n.override_reason),'') is null then raise exception 'Patient interval override requires a reason' using errcode='23514';end if;
  end if;
 elsif n.template_version is not null then raise exception 'Template version requires a template' using errcode='23514';end if;
 if n.interval_days is not null then
  if n.interval_anchor is null or not isfinite(n.interval_anchor) or n.due_date is distinct from n.interval_anchor+n.interval_days then raise exception 'Review interval anchor and due date' using errcode='23514';end if;
 elsif n.interval_anchor is not null or n.template_id is not null then raise exception 'Interval required' using errcode='23514';end if;
 if existed then
  update public.patient_lab_orders set test_name=n.test_name,status=n.status,due_date=n.due_date,collected_date=n.collected_date,result_date=n.result_date,accession=n.accession,notes=n.notes,result_document_id=n.result_document_id,template_id=n.template_id,template_version=n.template_version,interval_days=n.interval_days,interval_anchor=n.interval_anchor,override_reason=n.override_reason,reminders_enabled=n.reminders_enabled,version=version+1,updated_by=actor,updated_at=now() where id=p_id returning * into r;
 else
  insert into public.patient_lab_orders(id,pet_id,test_name,status,due_date,collected_date,result_date,accession,notes,result_document_id,template_id,template_version,interval_days,interval_anchor,override_reason,reminders_enabled,created_by,updated_by) values(p_id,p_pet_id,n.test_name,n.status,n.due_date,n.collected_date,n.result_date,n.accession,n.notes,n.result_document_id,n.template_id,n.template_version,n.interval_days,n.interval_anchor,n.override_reason,n.reminders_enabled,actor,actor) returning * into r;
 end if;
 insert into public.lab_work_revisions(entity,entity_id,version,snapshot,reason,actor_id) values('order',r.id,r.version,to_jsonb(r),coalesce(trim(p_correction_reason),''),actor);return r;
end $function$;

-- save_patient_problem(uuid,uuid,integer,text,text,date,text,text)
CREATE OR REPLACE FUNCTION public.save_patient_problem(p_id uuid, p_pet_id uuid, p_expected_version integer, p_title text, p_notes text, p_onset_date date, p_status text, p_importance text)
 RETURNS patient_problems
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result public.patient_problems; actor uuid;
begin
 actor := public.clinical_require_staff();
 perform pg_advisory_xact_lock(hashtextextended(p_pet_id::text,4700));
 perform 1 from public.pets where id=p_pet_id for update;
 if p_id is null then
  insert into public.patient_problems(pet_id,title,notes,onset_date,status,importance,created_by,updated_by) values(p_pet_id,trim(p_title),coalesce(p_notes,''),p_onset_date,p_status,p_importance,actor,actor) returning * into result;
 else
  update public.patient_problems set title=trim(p_title),notes=coalesce(p_notes,''),onset_date=p_onset_date,status=p_status,importance=p_importance where id=p_id and pet_id=p_pet_id and version=p_expected_version returning * into result;
  if not found then raise exception 'Record changed or no longer exists; reload before saving' using errcode='PT409'; end if;
 end if;
 return result;
end $function$;

-- save_patient_qol(uuid,uuid,integer,timestamp with time zone,text,text,text,text,text,text,text,text)
CREATE OR REPLACE FUNCTION public.save_patient_qol(p_id uuid, p_pet_id uuid, p_expected_version integer, p_observed_at timestamp with time zone, p_observer text, p_appetite text, p_drinking text, p_mobility text, p_comfort text, p_social_engagement text, p_good_days text, p_notes text)
 RETURNS patient_qol_records
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid:=public.clinical_require_staff(); result public.patient_qol_records;
begin
 if p_observed_at is null or not isfinite(p_observed_at) or p_observed_at>now()+interval '5 minutes' then raise exception 'Invalid observation time' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into result from public.patient_qol_records where id=p_id for update;
 if found then
  if result.pet_id<>p_pet_id then raise exception 'Patient does not match chart' using errcode='23514'; end if;
  if (case when p_expected_version is null then result.created_by else result.updated_by end)=actor and result.version=coalesce(p_expected_version+1,1) and row(result.observed_at,result.observer,result.appetite,result.drinking,result.mobility,result.comfort,result.social_engagement,result.good_days,result.notes) is not distinct from row(p_observed_at,p_observer,p_appetite,p_drinking,p_mobility,p_comfort,p_social_engagement,p_good_days,p_notes) then return result; end if;
  if result.version is distinct from p_expected_version then raise exception 'Chart changed; reload before saving' using errcode='PT409'; end if;
  update public.patient_qol_records set observed_at=p_observed_at,observer=p_observer,appetite=p_appetite,drinking=p_drinking,mobility=p_mobility,comfort=p_comfort,social_engagement=p_social_engagement,good_days=p_good_days,notes=p_notes where id=p_id returning * into result;
 else
  if p_expected_version is not null then raise exception 'Chart no longer exists' using errcode='PT409'; end if;
  insert into public.patient_qol_records(id,pet_id,observed_at,observer,appetite,drinking,mobility,comfort,social_engagement,good_days,notes,created_by,updated_by) values(p_id,p_pet_id,p_observed_at,p_observer,p_appetite,p_drinking,p_mobility,p_comfort,p_social_engagement,p_good_days,p_notes,actor,actor) returning * into result;
 end if;
 return result;
end $function$;

-- save_patient_qol_scale(uuid,uuid,integer,timestamp with time zone,text,integer,integer,integer,integer,integer,integer,integer,text,text,text,text,text,text,text,text)
CREATE OR REPLACE FUNCTION public.save_patient_qol_scale(p_id uuid, p_pet_id uuid, p_expected_version integer, p_assessed_at timestamp with time zone, p_assessor text, p_hurt integer, p_hunger integer, p_hydration integer, p_hygiene integer, p_happiness integer, p_mobility integer, p_more_good_days integer, p_hurt_note text, p_hunger_note text, p_hydration_note text, p_hygiene_note text, p_happiness_note text, p_mobility_note text, p_more_good_days_note text, p_notes text)
 RETURNS patient_qol_scale_assessments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid:=public.clinical_require_staff(); result public.patient_qol_scale_assessments;
begin
 if p_id is null or p_pet_id is null then raise exception 'Stable assessment and patient IDs required' using errcode='23514'; end if;
 if p_assessed_at is null or not isfinite(p_assessed_at) or p_assessed_at>now()+interval '5 minutes' then raise exception 'Invalid assessment time' using errcode='23514'; end if;
 if exists(select 1 from unnest(array[p_hurt,p_hunger,p_hydration,p_hygiene,p_happiness,p_mobility,p_more_good_days]) s where s not between 0 and 10) then raise exception 'Each category score must be a whole number from 0 to 10' using errcode='23514'; end if;
 if num_nulls(p_hurt_note,p_hunger_note,p_hydration_note,p_hygiene_note,p_happiness_note,p_mobility_note,p_more_good_days_note,p_notes)>0 then raise exception 'Notes must be text (use an empty string when blank)' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into result from public.patient_qol_scale_assessments where id=p_id for update;
 if found then
  if result.pet_id<>p_pet_id then raise exception 'Patient does not match assessment' using errcode='23514'; end if;
  if (case when p_expected_version is null then result.created_by else result.updated_by end)=actor and result.version=coalesce(p_expected_version+1,1)
   and row(result.assessed_at,result.assessor,result.hurt,result.hunger,result.hydration,result.hygiene,result.happiness,result.mobility,result.more_good_days,result.hurt_note,result.hunger_note,result.hydration_note,result.hygiene_note,result.happiness_note,result.mobility_note,result.more_good_days_note,result.notes)
   is not distinct from row(p_assessed_at,p_assessor,p_hurt::smallint,p_hunger::smallint,p_hydration::smallint,p_hygiene::smallint,p_happiness::smallint,p_mobility::smallint,p_more_good_days::smallint,p_hurt_note,p_hunger_note,p_hydration_note,p_hygiene_note,p_happiness_note,p_mobility_note,p_more_good_days_note,p_notes) then return result; end if;
  if result.version is distinct from p_expected_version then raise exception 'Assessment changed; reload before saving' using errcode='PT409'; end if;
  update public.patient_qol_scale_assessments set assessed_at=p_assessed_at,assessor=p_assessor,hurt=p_hurt,hunger=p_hunger,hydration=p_hydration,hygiene=p_hygiene,happiness=p_happiness,mobility=p_mobility,more_good_days=p_more_good_days,
   hurt_note=p_hurt_note,hunger_note=p_hunger_note,hydration_note=p_hydration_note,hygiene_note=p_hygiene_note,happiness_note=p_happiness_note,mobility_note=p_mobility_note,more_good_days_note=p_more_good_days_note,notes=p_notes where id=p_id returning * into result;
 else
  if p_expected_version is not null then raise exception 'Assessment no longer exists' using errcode='PT409'; end if;
  insert into public.patient_qol_scale_assessments(id,pet_id,assessed_at,assessor,hurt,hunger,hydration,hygiene,happiness,mobility,more_good_days,hurt_note,hunger_note,hydration_note,hygiene_note,happiness_note,mobility_note,more_good_days_note,notes,created_by,updated_by)
   values(p_id,p_pet_id,p_assessed_at,p_assessor,p_hurt,p_hunger,p_hydration,p_hygiene,p_happiness,p_mobility,p_more_good_days,p_hurt_note,p_hunger_note,p_hydration_note,p_hygiene_note,p_happiness_note,p_mobility_note,p_more_good_days_note,p_notes,actor,actor) returning * into result;
 end if;
 return result;
end $function$;

-- save_patient_vaccine_due_plan(uuid,uuid,integer,uuid,integer,uuid,uuid,date,text,integer,date,text,boolean,text,text)
CREATE OR REPLACE FUNCTION public.save_patient_vaccine_due_plan(p_id uuid, p_pet_id uuid, p_expected_version integer, p_template_id uuid, p_template_version integer, p_product_id uuid, p_treatment_id uuid, p_last_administered_on date, p_anchor_source text, p_interval_days integer, p_current_due_on date, p_status text, p_reminders_enabled boolean, p_override_reason text, p_review_note text)
 RETURNS patient_vaccine_due_plans
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid;r public.patient_vaccine_due_plans;t public.vaccine_due_templates;admin_date date;proposed date;reviewed_snapshot jsonb;
begin actor=public.clinical_require_staff();if p_id is null then raise exception 'Stable ID required' using errcode='23514';end if;
 -- Patient lock serializes canonical-plan creation, archival, and service enqueue.
 perform 1 from public.pets where id=p_pet_id and archived_at is null and deceased_at is null for update;if not found then raise exception 'Due plans require an active patient' using errcode='23514';end if;
 select * into r from public.patient_vaccine_due_plans where id=p_id for update;
 if r.id is not null and r.pet_id<>p_pet_id then raise exception 'Due plan belongs to another patient' using errcode='42501';end if;
 if r.id is not null and r.updated_by=actor and r.version=coalesce(p_expected_version,0)+1 and row(r.template_id,r.template_version,r.product_id,r.treatment_id,r.last_administered_on,r.anchor_source,r.interval_days,r.current_due_on,r.status,r.reminders_enabled,r.override_reason,r.review_note) is not distinct from row(p_template_id,p_template_version,p_product_id,p_treatment_id,p_last_administered_on,trim(p_anchor_source),p_interval_days,p_current_due_on,p_status,p_reminders_enabled,coalesce(trim(p_override_reason),''),trim(p_review_note)) then return r;end if;
 if r.id is not null and r.version is distinct from p_expected_version or r.id is null and p_expected_version is not null then raise exception 'Due plan version conflict' using errcode='PT409';end if;
 if r.status='retired' then raise exception 'Retired plan is immutable; create a new reviewed plan' using errcode='23514';end if;
 select * into t from public.vaccine_due_templates where id=p_template_id for share;
 -- Existing reviewed snapshots survive later template changes. Reapplying settings needs the latest active version.
 if r.id is not null and row(r.template_id,r.template_version) is not distinct from row(p_template_id,p_template_version) then reviewed_snapshot=r.template_snapshot;
 else if t.id is null or not t.active or t.version is distinct from p_template_version then raise exception 'Template changed or retired; review current settings' using errcode='PT409';end if;reviewed_snapshot=to_jsonb(t);end if;
 if r.id is not null and r.group_key<>t.group_key then raise exception 'Plan cannot change canonical vaccine group' using errcode='23514';end if;
 if not exists(select 1 from jsonb_array_elements_text(reviewed_snapshot->'product_ids') item where item::uuid=p_product_id) then raise exception 'Product is not explicitly mapped to this reviewed group' using errcode='23514';end if;
 if p_treatment_id is not null then
  select (administered_at at time zone 'America/Denver')::date into admin_date from public.patient_treatments where id=p_treatment_id and pet_id=p_pet_id and kind='vaccine' and product_id=p_product_id for share;
  if not found or exists(select 1 from public.patient_treatment_corrections where treatment_id=p_treatment_id) then raise exception 'Select an uncorrected vaccine administration for this patient and product' using errcode='42501';end if;
  if admin_date is distinct from p_last_administered_on then raise exception 'Last-administered date must match the selected administration in Denver' using errcode='23514';end if;
 end if;
 if p_last_administered_on is null or not isfinite(p_last_administered_on) or p_last_administered_on>(now() at time zone 'America/Denver')::date or p_current_due_on is null or not isfinite(p_current_due_on) then raise exception 'Record finite dates and a nonfuture administration date' using errcode='23514';end if;
 proposed=p_last_administered_on+(reviewed_snapshot->>'interval_days')::integer;
 if (p_interval_days is distinct from (reviewed_snapshot->>'interval_days')::integer or p_current_due_on is distinct from p_last_administered_on+p_interval_days) and nullif(trim(p_override_reason),'') is null then raise exception 'Patient due/interval override requires a reason' using errcode='23514';end if;
 if r.id is null then insert into public.patient_vaccine_due_plans(id,pet_id,template_id,template_version,template_snapshot,group_key,product_id,treatment_id,last_administered_on,anchor_source,interval_days,proposed_due_on,current_due_on,status,reminders_enabled,override_reason,review_note,created_by,updated_by) values(p_id,p_pet_id,p_template_id,p_template_version,reviewed_snapshot,t.group_key,p_product_id,p_treatment_id,p_last_administered_on,trim(p_anchor_source),p_interval_days,proposed,p_current_due_on,p_status,p_reminders_enabled,coalesce(trim(p_override_reason),''),trim(p_review_note),actor,actor) returning * into r;
 else update public.patient_vaccine_due_plans set template_id=p_template_id,template_version=p_template_version,template_snapshot=reviewed_snapshot,product_id=p_product_id,treatment_id=p_treatment_id,last_administered_on=p_last_administered_on,anchor_source=trim(p_anchor_source),interval_days=p_interval_days,proposed_due_on=proposed,current_due_on=p_current_due_on,status=p_status,reminders_enabled=p_reminders_enabled,override_reason=coalesce(trim(p_override_reason),''),review_note=trim(p_review_note),version=version+1,updated_by=actor,updated_at=now() where id=p_id returning * into r;end if;return r;
end $function$;

-- save_qol_scale_reference(integer,boolean,integer,text,text)
CREATE OR REPLACE FUNCTION public.save_qol_scale_reference(p_expected_version integer, p_enabled boolean, p_reference_total integer, p_reference_label text, p_review_note text)
 RETURNS qol_scale_reference_settings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid:=public.care_require_admin(); result public.qol_scale_reference_settings;
begin
 select * into result from public.qol_scale_reference_settings where id='00000000-0000-4000-8000-000000000070' for update;
 if result.updated_by=actor and result.version=p_expected_version+1 and row(result.enabled,result.reference_total,result.reference_label,result.review_note) is not distinct from row(p_enabled,p_reference_total::smallint,trim(coalesce(p_reference_label,'')),trim(coalesce(p_review_note,''))) then return result; end if;
 if result.version is distinct from p_expected_version then raise exception 'Reference setting changed; reload before saving' using errcode='PT409'; end if;
 if p_enabled is null then raise exception 'Choose whether the reference is shown' using errcode='23514'; end if;
 if p_reference_total is not null and p_reference_total not between 0 and 70 then raise exception 'Reference total must be between 0 and 70' using errcode='23514'; end if;
 if p_enabled and (p_reference_total is null or length(trim(coalesce(p_reference_label,'')))=0 or length(trim(coalesce(p_review_note,'')))=0) then raise exception 'An enabled reference needs a total, wording and review note' using errcode='23514'; end if;
 update public.qol_scale_reference_settings set enabled=p_enabled,reference_total=p_reference_total,reference_label=trim(coalesce(p_reference_label,'')),review_note=trim(coalesce(p_review_note,'')) where id='00000000-0000-4000-8000-000000000070' returning * into result;
 return result;
end $function$;

-- save_reminder_automation_policy(uuid,integer,text,text,uuid,integer,text,boolean,text)
CREATE OR REPLACE FUNCTION public.save_reminder_automation_policy(p_id uuid, p_expected_version integer, p_source_kind text, p_channel text, p_message_template_id uuid, p_message_template_version integer, p_subject text, p_enabled boolean, p_review_note text)
 RETURNS reminder_automation_policies
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid;r public.reminder_automation_policies;t public.care_message_templates;
begin actor=public.care_require_admin();if p_id is null then raise exception 'Stable policy ID required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,18));select * into r from public.reminder_automation_policies where id=p_id for update;
 if found then
  if r.approved_by=actor and r.version=coalesce(p_expected_version,0)+1 and row(r.source_kind,r.channel,r.message_template_id,r.message_template_version,r.subject,r.enabled,r.review_note) is not distinct from row(p_source_kind,p_channel,p_message_template_id,p_message_template_version,coalesce(p_subject,''),p_enabled,trim(p_review_note)) then return r;end if;
  if r.version is distinct from p_expected_version then raise exception 'Automation policy version conflict' using errcode='PT409';end if;
  if row(r.source_kind,r.channel) is distinct from row(p_source_kind,p_channel) then raise exception 'Policy source and channel are immutable' using errcode='23514';end if;
 elsif p_expected_version is not null then raise exception 'Automation policy version conflict' using errcode='PT409';end if;
 select * into t from public.care_message_templates where id=p_message_template_id for share;
 if t.id is null or not t.active or t.version is distinct from p_message_template_version or upper(t.channel) is distinct from p_channel then raise exception 'Select current reviewed wording for the policy channel' using errcode='23514';end if;
 if r.id is null then insert into public.reminder_automation_policies(id,source_kind,channel,message_template_id,message_template_version,subject,enabled,review_note,approved_by) values(p_id,p_source_kind,p_channel,t.id,t.version,coalesce(p_subject,''),p_enabled,trim(p_review_note),actor) returning * into r;
 else update public.reminder_automation_policies set message_template_id=t.id,message_template_version=t.version,subject=coalesce(p_subject,''),enabled=p_enabled,review_note=trim(p_review_note),version=version+1,approved_by=actor,approved_at=now() where id=p_id returning * into r;end if;
 insert into public.reminder_automation_policy_history(policy_id,version,snapshot) values(r.id,r.version,to_jsonb(r));return r;
end $function$;

-- save_vaccine_due_template(uuid,integer,text,text,uuid[],integer,boolean,text)
CREATE OR REPLACE FUNCTION public.save_vaccine_due_template(p_id uuid, p_expected_version integer, p_group_key text, p_name text, p_product_ids uuid[], p_interval_days integer, p_active boolean, p_review_note text)
 RETURNS vaccine_due_templates
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid;r public.vaccine_due_templates;
begin actor=public.care_require_admin();if p_id is null then raise exception 'Stable ID required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,14));select * into r from public.vaccine_due_templates where id=p_id for update;
 if found then
  if r.updated_by=actor and r.version=coalesce(p_expected_version,0)+1 and row(r.group_key,r.name,r.product_ids,r.interval_days,r.active,r.review_note) is not distinct from row(lower(trim(p_group_key)),trim(p_name),p_product_ids,p_interval_days,p_active,trim(p_review_note)) then return r;end if;
  if r.version is distinct from p_expected_version then raise exception 'Vaccine template version conflict' using errcode='PT409';end if;
  if r.group_key<>lower(trim(p_group_key)) then raise exception 'Canonical group key is immutable' using errcode='23514';end if;
 elsif p_expected_version is not null then raise exception 'Vaccine template version conflict' using errcode='PT409';end if;
 if p_product_ids is null or exists(select 1 from unnest(p_product_ids) id where not exists(select 1 from public.catalog_products p where p.id=id and p.kind='vaccine')) or cardinality(p_product_ids)<>(select count(distinct id) from unnest(p_product_ids) id) then raise exception 'Choose distinct explicit vaccine products' using errcode='23514';end if;
 if r.id is null then insert into public.vaccine_due_templates(id,group_key,name,product_ids,interval_days,active,review_note,updated_by) values(p_id,lower(trim(p_group_key)),trim(p_name),p_product_ids,p_interval_days,p_active,trim(p_review_note),actor) returning * into r;
 else update public.vaccine_due_templates set name=trim(p_name),product_ids=p_product_ids,interval_days=p_interval_days,active=p_active,review_note=trim(p_review_note),version=version+1,updated_by=actor,updated_at=now() where id=p_id returning * into r;end if;return r;
end $function$;

-- sign_clinical_encounter(uuid,integer)
CREATE OR REPLACE FUNCTION public.sign_clinical_encounter(p_id uuid, p_expected_version integer)
 RETURNS clinical_encounters
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result public.clinical_encounters;
begin
 perform public.clinical_require_staff();
 update public.clinical_encounters set status='signed' where id=p_id and version=p_expected_version returning * into result;
 if not found then raise exception 'Record changed or no longer exists; reload before signing' using errcode='PT409'; end if;
 return result;
end $function$;

-- sign_dental_chart(uuid,uuid,integer)
CREATE OR REPLACE FUNCTION public.sign_dental_chart(p_id uuid, p_pet_id uuid, p_expected_version integer)
 RETURNS dental_charts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid;r public.dental_charts;
begin actor=public.clinical_require_staff();select * into strict r from public.dental_charts where id=p_id for update;
 if r.pet_id<>p_pet_id then raise exception 'Chart does not belong to patient' using errcode='42501';end if;
 if r.status='signed' and r.signed_by=actor and r.version=p_expected_version+1 then return r;end if;
 if r.version is distinct from p_expected_version then raise exception 'Dental chart changed; reload before signing' using errcode='PT409';end if;
 if r.status<>'draft' then raise exception 'Chart already signed' using errcode='23514';end if;
 if nullif(trim(r.notes),'') is null and not exists(select 1 from jsonb_each(r.teeth) e where e.value->>'presence'<>'not_recorded' or nullif(trim(e.value->>'findings'),'') is not null or nullif(trim(e.value->>'planned'),'') is not null or nullif(trim(e.value->>'performed'),'') is not null or jsonb_array_length(e.value->'measurements')>0) then raise exception 'Record observations or notes before signing' using errcode='23514';end if;
 update public.dental_charts set status='signed',signed_by=actor,signed_at=now(),version=version+1,updated_by=actor,updated_at=now() where id=p_id returning * into r;return r;
end $function$;

-- sign_patient_anesthesia_record(uuid,uuid,integer)
CREATE OR REPLACE FUNCTION public.sign_patient_anesthesia_record(p_id uuid, p_pet_id uuid, p_expected_version integer)
 RETURNS patient_anesthesia_records
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid;r public.patient_anesthesia_records;
begin actor=public.clinical_require_staff();select * into strict r from public.patient_anesthesia_records where id=p_id for update;
 if r.pet_id<>p_pet_id then raise exception 'Anesthesia record belongs to another patient' using errcode='42501';end if;
 if r.status='signed' and r.signed_by=actor and r.version=p_expected_version+1 then return r;end if;
 if r.version is distinct from p_expected_version then raise exception 'Anesthesia record version conflict; reload' using errcode='PT409';end if;
 if r.status<>'draft' then raise exception 'Record already signed' using errcode='23514';end if;
 if r.ended_at is null or nullif(trim(r.assessment),'') is null or nullif(trim(r.plan),'') is null then raise exception 'Record end time, assessment and plan before signing' using errcode='23514';end if;
 update public.patient_anesthesia_records set status='signed',signed_by=actor,signed_at=now(),version=version+1,updated_by=actor,updated_at=now() where id=p_id returning * into r;return r;
end $function$;

-- sign_patient_qol(uuid,integer)
CREATE OR REPLACE FUNCTION public.sign_patient_qol(p_id uuid, p_expected_version integer)
 RETURNS patient_qol_records
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result public.patient_qol_records; actor uuid:=public.clinical_require_staff();
begin
 select * into result from public.patient_qol_records where id=p_id for update;
 if found and result.status='signed' and result.signed_by=actor and result.version=p_expected_version+1 then return result; end if;
 update public.patient_qol_records set status='signed' where id=p_id and version=p_expected_version returning * into result;
 if not found then raise exception 'Chart changed; reload before signing' using errcode='PT409'; end if; return result;
end $function$;

-- sign_patient_qol_scale(uuid,integer)
CREATE OR REPLACE FUNCTION public.sign_patient_qol_scale(p_id uuid, p_expected_version integer)
 RETURNS patient_qol_scale_assessments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result public.patient_qol_scale_assessments; actor uuid:=public.clinical_require_staff();
begin
 select * into result from public.patient_qol_scale_assessments where id=p_id for update;
 if found and result.status='signed' and result.signed_by=actor and result.version=p_expected_version+1 then return result; end if;
 update public.patient_qol_scale_assessments set status='signed' where id=p_id and version=p_expected_version returning * into result;
 if not found then raise exception 'Assessment changed; reload before signing' using errcode='PT409'; end if; return result;
end $function$;

-- stage_external_record_receipt(uuid,uuid,integer,uuid,integer,text,timestamp with time zone,uuid,text)
CREATE OR REPLACE FUNCTION public.stage_external_record_receipt(p_id uuid, p_animal_link_id uuid, p_expected_pet_version integer, p_document_id uuid, p_document_version integer, p_export_reference text, p_received_at timestamp with time zone, p_previous_record_id uuid, p_review_reason text)
 RETURNS external_record_receipts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare actor uuid:=public.clinical_require_staff();r public.external_record_receipts;m public.ezyvet_record_links;d public.patient_documents;p public.pets;prior uuid;fingerprint text;
begin
 if not public.ezyvet_is_active_admin(actor) then raise exception 'Active administrator required' using errcode='42501';end if;
 if p_id is null or p_export_reference is null or length(trim(p_export_reference)) not between 1 and 500 or p_review_reason is null or length(trim(p_review_reason)) not between 1 and 2000 or p_received_at is null or not isfinite(p_received_at) or p_received_at>clock_timestamp() then raise exception 'Explicit manual export provenance required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,4200));
 select * into r from public.external_record_receipts where id=p_id;
 if found then
 if row(r.actor_id,r.animal_link_id,r.pet_version,r.document_id,r.document_version,r.export_reference,r.received_at,r.previous_record_id,r.review_reason) is distinct from row(actor,p_animal_link_id,p_expected_pet_version,p_document_id,p_document_version,p_export_reference,p_received_at,p_previous_record_id,p_review_reason) then raise exception 'Receipt UUID already used' using errcode='23505';end if;return r;end if;
 select * into m from public.ezyvet_record_links where id=p_animal_link_id and resource='animal' for update;
 if not found then raise exception 'Approved ezyVet animal mapping required' using errcode='42501';end if;
 select * into p from public.pets where id=m.pet_id and client_id=m.client_id for share;
 if not found or p.version is distinct from p_expected_pet_version then raise exception 'Mapped patient changed; review again' using errcode='PT409';end if;
 select * into d from public.patient_documents where id=p_document_id and pet_id=p.id and status='ready' and version=p_document_version and category='medical_record' for share;
 if not found then raise exception 'Same-patient ready medical record and exact version required' using errcode='42501';end if;
 select id into prior from public.external_record_versions where animal_link_id=m.id and export_reference=p_export_reference order by version desc limit 1;
 if prior is distinct from p_previous_record_id then raise exception 'External record history changed' using errcode='PT409';end if;
 if exists(select 1 from public.external_record_versions where document_id=d.id) then raise exception 'Document already preserved; select original receipt' using errcode='23505';end if;
 fingerprint:=encode(digest(jsonb_build_array(p_id,actor,m.id,p.id,p.version,m.source_origin,m.source_site_uid,m.external_id,d.id,d.version,d.mime_type,d.file_size,p_export_reference,p_received_at,p_previous_record_id,p_review_reason,'staff_reviewed_manual_export_v1')::text,'sha256'),'hex');
 insert into public.external_record_receipts(id,actor_id,animal_link_id,pet_id,pet_version,source_origin,source_site_uid,source_animal_id,document_id,document_version,mime_type,file_size,export_reference,received_at,previous_record_id,review_reason,receipt_hash) values(p_id,actor,m.id,p.id,p.version,m.source_origin,m.source_site_uid,m.external_id,d.id,d.version,d.mime_type,d.file_size,p_export_reference,p_received_at,p_previous_record_id,p_review_reason,fingerprint) returning * into r;return r;
end $function$;

-- stage_ezyvet_attachment_page(uuid,uuid,uuid,jsonb)
CREATE OR REPLACE FUNCTION public.stage_ezyvet_attachment_page(p_run_id uuid, p_actor uuid, p_lease_id uuid, p_page jsonb)
 RETURNS ezyvet_import_runs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare r public.ezyvet_import_runs;c public.ezyvet_attachment_runs;context jsonb;fingerprint text;previous text;items jsonb;page_no integer;rowrecord record;
begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('attachment-run:'||p_run_id::text,0));
 select * into r from public.ezyvet_import_runs where id=p_run_id for update;
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 select * into c from public.ezyvet_attachment_runs where run_id=p_run_id;
 if c.run_id is null or row(r.requested_by,r.resource,c.actor_id) is distinct from row(p_actor,'attachment'::text,p_actor) then raise exception 'Owned attachment run required' using errcode='42501';end if;
 perform public.ezyvet_attachment_validate_page(p_page,c.parent_context->>'animal_external_id');
 page_no:=(p_page->>'page')::integer;fingerprint:=encode(digest(p_page::text,'sha256'),'hex');
 select request_hash into previous from public.ezyvet_attachment_pages where run_id=p_run_id and page=page_no;
 if found then if previous<>fingerprint then raise exception 'Committed attachment page changed' using errcode='PT409';end if;if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return r;end if;
 if r.status<>'running' or p_lease_id is null or r.lease_id is distinct from p_lease_id or r.lease_until is null or r.lease_until<=clock_timestamp() or page_no is distinct from r.next_page then raise exception 'Attachment lease or cursor changed' using errcode='PT409';end if;
 context:=public.ezyvet_attachment_parent_context(c.animal_link_id,r.source_origin,r.source_site_uid);
 if context is distinct from c.parent_context then raise exception 'SOURCE_ATTACHMENT_PARENT_STALE' using errcode='PT409';end if;
 -- Serialize fresh attachment stages with competing source claims before head locks.
 perform pg_advisory_xact_lock(hashtextextended(r.source_origin||':'||r.source_site_uid||':attachment',0));
 for rowrecord in select distinct value->>'external_id' external_id from jsonb_array_elements(p_page->'observations') order by 1 loop
  perform 1 from public.ezyvet_identity_heads where source_origin=r.source_origin and source_site_uid=r.source_site_uid and resource='attachment' and external_id=rowrecord.external_id for update;
 end loop;
 if r.lease_until<=clock_timestamp() then raise exception 'Attachment lease expired during source lock wait' using errcode='PT409';end if;
 select coalesce(jsonb_agg(jsonb_build_object('external_id',external_id,'payload',metadata||jsonb_build_object('representation','sanitized_attachment_metadata_v1')) order by external_id),'[]') into items
 from(select distinct value->>'external_id' external_id,value->'metadata' metadata from jsonb_array_elements(p_page->'observations')) s;
 r:=public.stage_ezyvet_import_page_core(p_run_id,p_actor,p_lease_id,page_no,(p_page->>'complete')::boolean,items);
 insert into public.ezyvet_attachment_pages(run_id,page,request_hash,page_sha256,pagination,complete,observed_count,staged_count)
 values(p_run_id,page_no,fingerprint,p_page->>'page_sha256',p_page->'pagination',(p_page->>'complete')::boolean,jsonb_array_length(p_page->'observations'),jsonb_array_length(items));
 insert into public.ezyvet_attachment_page_observations(run_id,page,ordinal,external_id,file_id,snapshot_id,head_version,raw_record_sha256,stable_metadata_sha256)
 select p_run_id,page_no,x.ordinality::integer,x.value->>'external_id',x.value->>'file_id',s.id,h.version,x.value->>'raw_record_sha256',x.value->>'stable_metadata_sha256'
 from jsonb_array_elements(p_page->'observations') with ordinality x
 join public.ezyvet_import_page_items i on i.run_id=p_run_id and i.page=page_no
 join public.ezyvet_import_snapshots s on s.id=i.snapshot_id and s.external_id=x.value->>'external_id'
 join public.ezyvet_identity_heads h on h.source_origin=s.source_origin and h.source_site_uid=s.source_site_uid and h.resource=s.resource and h.external_id=s.external_id;
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return r;
end $function$;

-- stage_ezyvet_import_page_core(uuid,uuid,uuid,integer,boolean,jsonb)
CREATE OR REPLACE FUNCTION public.stage_ezyvet_import_page_core(p_id uuid, p_actor uuid, p_lease_id uuid, p_page integer, p_complete boolean, p_items jsonb)
 RETURNS ezyvet_import_runs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare r public.ezyvet_import_runs; item jsonb; snapshot_id uuid; item_hash text;
begin
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501'; end if;
 select * into strict r from public.ezyvet_import_runs where id=p_id for update;
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 if r.requested_by<>p_actor then raise exception 'Import owner mismatch' using errcode='42501'; end if;
 -- Retried committed page is a no-op, including a response lost after successful staging.
 if exists(select 1 from public.ezyvet_import_pages where run_id=p_id and page=p_page) then if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return r; end if;
 if r.status<>'running' or r.lease_id is distinct from p_lease_id or r.lease_until<=now() or p_page<>r.next_page then raise exception 'Import lease or cursor changed' using errcode='PT409'; end if;
 if p_complete is null or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>50 or octet_length(p_items::text)>2097152 then raise exception 'Invalid import page' using errcode='23514'; end if;
 if not p_complete and jsonb_array_length(p_items)=0 then raise exception 'Empty intermediate page' using errcode='23514'; end if;
 if (select count(*) from jsonb_array_elements(p_items))<>(select count(distinct value->>'external_id') from jsonb_array_elements(p_items)) then raise exception 'Duplicate external IDs' using errcode='23514'; end if;
 insert into public.ezyvet_import_pages(run_id,page,item_count) values(p_id,p_page,jsonb_array_length(p_items));
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item->'payload') is distinct from 'object' or item->>'external_id' is null or item->>'external_id' !~ '^[A-Za-z0-9_-]{1,128}$' then raise exception 'Invalid imported entity' using errcode='23514'; end if;
  item_hash=encode(digest((item->'payload')::text,'sha256'),'hex');
  insert into public.ezyvet_import_snapshots(source_origin,source_site_uid,resource,external_id,payload,payload_hash,first_seen_by)
  values(r.source_origin,r.source_site_uid,r.resource,item->>'external_id',item->'payload',item_hash,p_actor) on conflict(source_origin,source_site_uid,resource,external_id,payload_hash) do nothing;
  select id into strict snapshot_id from public.ezyvet_import_snapshots where source_origin=r.source_origin and source_site_uid=r.source_site_uid and resource=r.resource and external_id=item->>'external_id' and payload_hash=item_hash;
  insert into public.ezyvet_import_page_items(run_id,page,snapshot_id) values(p_id,p_page,snapshot_id);
 end loop;
 update public.ezyvet_import_runs set next_page=p_page+1,status=case when p_complete then 'review_ready' when p_page=1000 then 'page_limit_reached' else 'running' end,lease_id=null,lease_until=null,retry_after=now()+interval '2 seconds',last_error_code=null,updated_at=now() where id=p_id returning * into r;
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return r;
end $function$;

-- stage_ezyvet_import_page_pre_attachment(uuid,uuid,uuid,integer,boolean,jsonb)
CREATE OR REPLACE FUNCTION public.stage_ezyvet_import_page_pre_attachment(p_id uuid, p_actor uuid, p_lease_id uuid, p_page integer, p_complete boolean, p_items jsonb)
 RETURNS ezyvet_import_runs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare r public.ezyvet_import_runs;c public.ezyvet_prescriptionitem_runs;m public.ezyvet_record_links;fingerprint text;previous text;ordered_items jsonb;
begin
 -- Serialize claim and stage before either holds the run or prescription head lock.
 -- This also excludes a queued prescription writer from forming a three-way lock cycle.
 if exists(select 1 from public.ezyvet_import_runs where id=p_id and resource='prescriptionitem') then
  perform pg_advisory_xact_lock(hashtextextended('prescriptionitem-run:'||p_id::text,0));
 end if;
 select * into strict r from public.ezyvet_import_runs where id=p_id;
 if r.resource not in ('prescriptionitem') then
  return public.stage_ezyvet_import_page_pre_prescriptionitem(p_id,p_actor,p_lease_id,p_page,p_complete,p_items);
 end if;
 select * into strict r from public.ezyvet_import_runs where id=p_id for update;
 if public.ezyvet_is_active_admin(p_actor) is not true or r.requested_by is distinct from p_actor then raise exception 'Active import owner required' using errcode='42501';end if;
 select * into c from public.ezyvet_prescriptionitem_runs where run_id=p_id;
 if not found then raise exception 'PRESCRIPTIONITEM_RUN_REQUIRES_NEW_CONTEXT' using errcode='22023';end if;
 if row(c.actor_id,c.resource,c.source_origin,c.source_site_uid) is distinct from row(p_actor,r.resource,r.source_origin,r.source_site_uid) then raise exception 'Prescription item import context mismatch' using errcode='42501';end if;
 if p_complete is null or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>10 or octet_length(p_items::text)>2097152 then raise exception 'Invalid patient-scoped prescriptionitem page' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x)<>'object' or jsonb_typeof(x->'payload') is distinct from 'object' or x->>'external_id' is null or x->>'external_id' !~ '^(0|[1-9][0-9]{0,15})$' or coalesce(jsonb_typeof(x#>'{payload,id}'),'null') not in ('number','string') or x#>>'{payload,id}' is distinct from x->>'external_id' or coalesce(jsonb_typeof(x#>'{payload,prescription_id}'),'null') not in ('number','string') or x#>>'{payload,prescription_id}' is distinct from c.prescription_external_id) then raise exception 'Prescription item source identity mismatch' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where (x->>'external_id')::numeric>9007199254740991 or (x#>'{payload,product_id}' is not null and x#>'{payload,product_id}'<>'null'::jsonb and (jsonb_typeof(x#>'{payload,product_id}') not in ('number','string') or x#>>'{payload,product_id}' !~ '^(0|[1-9][0-9]{0,15})$'))) then raise exception 'Invalid prescriptionitem source reference' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x#>'{payload,product_id}') in ('number','string') and (x#>>'{payload,product_id}')::numeric>9007199254740991) then raise exception 'Invalid prescriptionitem product reference' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x cross join unnest(array['qty','remaining','date_start','serial_number','created_at','modified_at']) field where x->'payload' ? field and jsonb_typeof(x->'payload'->field) not in ('null','string','number'))
 or exists(select 1 from jsonb_array_elements(p_items) x cross join unnest(array['instructions']) field where x->'payload' ? field and jsonb_typeof(x->'payload'->field) not in ('null','string'))
 or exists(select 1 from jsonb_array_elements(p_items) x where x->'payload' ? 'active' and jsonb_typeof(x#>'{payload,active}') not in ('null','string','number','boolean')) then raise exception 'Invalid prescriptionitem source values' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x cross join unnest(array['qty','remaining','date_start','serial_number','created_at','modified_at']) field where case when jsonb_typeof(x->'payload'->field)='number' then abs((x->'payload'->>field)::numeric)>1.7976931348623157e308::numeric else false end) then raise exception 'Nonfinite prescriptionitem source number' using errcode='23514';end if;
 fingerprint:=encode(digest(jsonb_build_array(p_complete,p_items)::text,'sha256'),'hex');
 select request_hash into previous from public.ezyvet_prescriptionitem_pages where run_id=p_id and page=p_page;
 if found then
  if previous<>fingerprint then raise exception 'Committed prescriptionitem page request changed' using errcode='PT409';end if;
  if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return r;
 end if;
 if r.status<>'running' or p_lease_id is null or r.lease_id is null or r.lease_id<>p_lease_id or r.lease_until is null or r.lease_until<=now() or p_page is distinct from r.next_page then raise exception 'Import lease or cursor changed' using errcode='PT409';end if;
 select * into m from public.ezyvet_record_links where id=c.animal_link_id for share;
 if row(m.resource,m.source_origin,m.source_site_uid,m.external_id,m.pet_id,m.client_id) is distinct from row('animal'::text,c.source_origin,c.source_site_uid,c.animal_external_id,c.pet_id,c.client_id) then raise exception 'Prescription item patient mapping changed' using errcode='PT409';end if;
 perform 1 from public.pets where id=c.pet_id and client_id=c.client_id for share;
 if not found then raise exception 'Prescription item patient mapping changed' using errcode='PT409';end if;
 perform public.ezyvet_validate_prescriptionitem_prescription(c.animal_link_id,c.source_origin,c.source_site_uid,c.prescription_snapshot_id,c.prescription_payload_hash,c.prescription_observed_head_version);
 -- Existing core preserves source/resource lease, cooldown, cursor and identity-head semantics.
 select coalesce(jsonb_agg(value order by value->>'external_id'),'[]') into ordered_items from jsonb_array_elements(p_items);
 r:=public.stage_ezyvet_import_page_core(p_id,p_actor,p_lease_id,p_page,p_complete,ordered_items);
 insert into public.ezyvet_prescriptionitem_pages(run_id,page,request_hash) values(p_id,p_page,fingerprint);
 insert into public.ezyvet_prescriptionitem_page_observations(run_id,page,snapshot_id,head_version)
 select i.run_id,i.page,i.snapshot_id,h.version from public.ezyvet_import_page_items i join public.ezyvet_import_snapshots s on s.id=i.snapshot_id join public.ezyvet_identity_heads h using(source_origin,source_site_uid,resource,external_id) where i.run_id=p_id and i.page=p_page;
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return r;
end $function$;

-- stage_ezyvet_import_page_pre_prescription(uuid,uuid,uuid,integer,boolean,jsonb)
CREATE OR REPLACE FUNCTION public.stage_ezyvet_import_page_pre_prescription(p_id uuid, p_actor uuid, p_lease_id uuid, p_page integer, p_complete boolean, p_items jsonb)
 RETURNS ezyvet_import_runs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare r public.ezyvet_import_runs;c public.ezyvet_vaccination_runs;m public.ezyvet_record_links;fingerprint text;previous text;ordered_items jsonb;
begin
 -- Serialize claim and stage before either holds the run or consult head lock.
 -- This also excludes a queued consult writer from forming a three-way lock cycle.
 if exists(select 1 from public.ezyvet_import_runs where id=p_id and resource='vaccination') then
  perform pg_advisory_xact_lock(hashtextextended('vaccination-run:'||p_id::text,0));
 end if;
 select * into strict r from public.ezyvet_import_runs where id=p_id for update;
 if r.resource not in ('vaccination') then
  return public.stage_ezyvet_import_page_pre_vaccination(p_id,p_actor,p_lease_id,p_page,p_complete,p_items);
 end if;
 if public.ezyvet_is_active_admin(p_actor) is not true or r.requested_by is distinct from p_actor then raise exception 'Active import owner required' using errcode='42501';end if;
 select * into c from public.ezyvet_vaccination_runs where run_id=p_id;
 if not found then raise exception 'VACCINATION_RUN_REQUIRES_NEW_CONTEXT' using errcode='22023';end if;
 if row(c.actor_id,c.resource,c.source_origin,c.source_site_uid) is distinct from row(p_actor,r.resource,r.source_origin,r.source_site_uid) then raise exception 'Vaccination import context mismatch' using errcode='42501';end if;
 if p_complete is null or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>10 or octet_length(p_items::text)>2097152 then raise exception 'Invalid patient-scoped vaccination page' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x)<>'object' or jsonb_typeof(x->'payload') is distinct from 'object' or x->>'external_id' is null or x->>'external_id' !~ '^(0|[1-9][0-9]{0,15})$' or coalesce(jsonb_typeof(x#>'{payload,id}'),'null') not in ('number','string') or x#>>'{payload,id}' is distinct from x->>'external_id' or coalesce(jsonb_typeof(x#>'{payload,consult_id}'),'null') not in ('number','string') or x#>>'{payload,consult_id}' is distinct from c.consult_external_id) then raise exception 'Vaccination source identity mismatch' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where (x->>'external_id')::numeric>9007199254740991 or (x#>'{payload,product_id}' is not null and x#>'{payload,product_id}'<>'null'::jsonb and (jsonb_typeof(x#>'{payload,product_id}') not in ('number','string') or x#>>'{payload,product_id}' !~ '^(0|[1-9][0-9]{0,15})$'))) then raise exception 'Invalid vaccination source reference' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x#>'{payload,product_id}') in ('number','string') and (x#>>'{payload,product_id}')::numeric>9007199254740991) then raise exception 'Invalid vaccination product reference' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x cross join unnest(array['qty','date_of_administration','date_of_next_administration','vet_id','created_at','modified_at']) field where x->'payload' ? field and jsonb_typeof(x->'payload'->field) not in ('null','string','number'))
 or exists(select 1 from jsonb_array_elements(p_items) x cross join unnest(array['description','notes']) field where x->'payload' ? field and jsonb_typeof(x->'payload'->field) not in ('null','string'))
 or exists(select 1 from jsonb_array_elements(p_items) x where x->'payload' ? 'active' and jsonb_typeof(x#>'{payload,active}') not in ('null','string','number','boolean')) then raise exception 'Invalid vaccination source values' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x cross join unnest(array['qty','date_of_administration','date_of_next_administration','vet_id','created_at','modified_at']) field where case when jsonb_typeof(x->'payload'->field)='number' then abs((x->'payload'->>field)::numeric)>1.7976931348623157e308::numeric else false end) then raise exception 'Nonfinite vaccination source number' using errcode='23514';end if;
 fingerprint:=encode(digest(jsonb_build_array(p_complete,p_items)::text,'sha256'),'hex');
 select request_hash into previous from public.ezyvet_vaccination_pages where run_id=p_id and page=p_page;
 if found then
  if previous<>fingerprint then raise exception 'Committed vaccination page request changed' using errcode='PT409';end if;
  if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return r;
 end if;
 if r.status<>'running' or p_lease_id is null or r.lease_id is null or r.lease_id<>p_lease_id or r.lease_until is null or r.lease_until<=now() or p_page is distinct from r.next_page then raise exception 'Import lease or cursor changed' using errcode='PT409';end if;
 select * into m from public.ezyvet_record_links where id=c.animal_link_id for share;
 if row(m.resource,m.source_origin,m.source_site_uid,m.external_id,m.pet_id,m.client_id) is distinct from row('animal'::text,c.source_origin,c.source_site_uid,c.animal_external_id,c.pet_id,c.client_id) then raise exception 'Vaccination patient mapping changed' using errcode='PT409';end if;
 perform 1 from public.pets where id=c.pet_id and client_id=c.client_id for share;
 if not found then raise exception 'Vaccination patient mapping changed' using errcode='PT409';end if;
 perform public.ezyvet_validate_vaccination_consult(c.animal_link_id,c.source_origin,c.source_site_uid,c.consult_snapshot_id,c.consult_payload_hash,c.consult_observed_head_version);
 -- Existing core preserves source/resource lease, cooldown, cursor and identity-head semantics.
 select coalesce(jsonb_agg(value order by value->>'external_id'),'[]') into ordered_items from jsonb_array_elements(p_items);
 r:=public.stage_ezyvet_import_page_core(p_id,p_actor,p_lease_id,p_page,p_complete,ordered_items);
 insert into public.ezyvet_vaccination_pages(run_id,page,request_hash) values(p_id,p_page,fingerprint);
 insert into public.ezyvet_vaccination_page_observations(run_id,page,snapshot_id,head_version)
 select i.run_id,i.page,i.snapshot_id,h.version from public.ezyvet_import_page_items i join public.ezyvet_import_snapshots s on s.id=i.snapshot_id join public.ezyvet_identity_heads h using(source_origin,source_site_uid,resource,external_id) where i.run_id=p_id and i.page=p_page;
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return r;
end $function$;

-- stage_ezyvet_import_page_pre_prescriptionitem(uuid,uuid,uuid,integer,boolean,jsonb)
CREATE OR REPLACE FUNCTION public.stage_ezyvet_import_page_pre_prescriptionitem(p_id uuid, p_actor uuid, p_lease_id uuid, p_page integer, p_complete boolean, p_items jsonb)
 RETURNS ezyvet_import_runs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare r public.ezyvet_import_runs;c public.ezyvet_prescription_runs;m public.ezyvet_record_links;fingerprint text;previous text;ordered_items jsonb;
begin
 -- Delegate unrelated resources before taking their locks: their wrappers own
 -- canonical lock ordering. Prescription items require a separate parent context.
 select * into strict r from public.ezyvet_import_runs where id=p_id;
 if r.resource='prescriptionitem' then raise exception 'PRESCRIPTION_ITEM_CONTEXT_REQUIRED' using errcode='22023';end if;
 if r.resource<>'prescription' then
  return public.stage_ezyvet_import_page_pre_prescription(p_id,p_actor,p_lease_id,p_page,p_complete,p_items);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('prescription-run:'||p_id::text,0));
 select * into strict r from public.ezyvet_import_runs where id=p_id for update;
 if public.ezyvet_is_active_admin(p_actor) is not true or r.requested_by is distinct from p_actor then raise exception 'Active import owner required' using errcode='42501';end if;
 select * into c from public.ezyvet_prescription_runs where run_id=p_id;
 if not found then raise exception 'PRESCRIPTION_RUN_REQUIRES_NEW_MAPPING' using errcode='22023';end if;
 if row(c.actor_id,c.resource,c.source_origin,c.source_site_uid) is distinct from row(p_actor,r.resource,r.source_origin,r.source_site_uid) then raise exception 'Prescription import context mismatch' using errcode='42501';end if;
 if p_complete is null or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>10 or octet_length(p_items::text)>2097152 then raise exception 'Invalid patient-scoped prescription page' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x)<>'object' or jsonb_typeof(x->'payload') is distinct from 'object' or x->>'external_id' is null or x->>'external_id' !~ '^[0-9]+$' or x#>>'{payload,id}' is distinct from x->>'external_id' or x#>>'{payload,animal_id}' is distinct from c.animal_external_id) then raise exception 'Prescription source identity mismatch' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where
  jsonb_typeof(x#>'{payload,id}') not in ('string','number') or jsonb_typeof(x#>'{payload,animal_id}') not in ('string','number')
  or x->>'external_id' !~ '^(0|[1-9][0-9]{0,15})$') then raise exception 'Invalid prescription source identity' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where (x->>'external_id')::numeric>9007199254740991) then raise exception 'Invalid prescription source identity' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x cross join unnest(array['consult_id','prescribing_vet_user_id','date_of_prescription','created_at','modified_at']) field
  where x->'payload' ? field and jsonb_typeof(x->'payload'->field) not in ('null','string','number')) then raise exception 'Invalid prescription source values' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x cross join unnest(array['consult_id','prescribing_vet_user_id','date_of_prescription','created_at','modified_at']) field
  where case when jsonb_typeof(x->'payload'->field)='number' then abs((x->'payload'->>field)::numeric)>1.7976931348623157e308::numeric else false end) then raise exception 'Nonfinite prescription source number' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where x->'payload' ? 'active' and jsonb_typeof(x#>'{payload,active}') not in ('null','string','number','boolean')) then raise exception 'Invalid prescription source status' using errcode='23514';end if;
 -- Item-list anomalies remain source evidence for whole-prescription review.
 fingerprint:=encode(digest(jsonb_build_array(p_complete,p_items)::text,'sha256'),'hex');
 select request_hash into previous from public.ezyvet_prescription_pages where run_id=p_id and page=p_page;
 if found then
  if previous<>fingerprint then raise exception 'Committed prescription page request changed' using errcode='PT409';end if;
  if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return r;
 end if;
 if r.status<>'running' or p_lease_id is null or r.lease_id is null or r.lease_id<>p_lease_id or r.lease_until is null or r.lease_until<=now() or p_page is distinct from r.next_page then raise exception 'Import lease or cursor changed' using errcode='PT409';end if;
 select * into m from public.ezyvet_record_links where id=c.animal_link_id for share;
 if row(m.resource,m.source_origin,m.source_site_uid,m.external_id,m.pet_id,m.client_id) is distinct from row('animal'::text,c.source_origin,c.source_site_uid,c.animal_external_id,c.pet_id,c.client_id) then raise exception 'Prescription patient mapping changed' using errcode='PT409';end if;
 perform 1 from public.pets where id=c.pet_id and client_id=c.client_id for share;
 if not found then raise exception 'Prescription patient mapping changed' using errcode='PT409';end if;
 -- Existing core preserves source/resource lease, cooldown, cursor and identity-head semantics.
 select coalesce(jsonb_agg(value order by value->>'external_id'),'[]') into ordered_items from jsonb_array_elements(p_items);
 r:=public.stage_ezyvet_import_page_core(p_id,p_actor,p_lease_id,p_page,p_complete,ordered_items);
 insert into public.ezyvet_prescription_pages(run_id,page,request_hash) values(p_id,p_page,fingerprint);
 insert into public.ezyvet_prescription_page_observations(run_id,page,snapshot_id,head_version)
 select i.run_id,i.page,i.snapshot_id,h.version from public.ezyvet_import_page_items i join public.ezyvet_import_snapshots s on s.id=i.snapshot_id join public.ezyvet_identity_heads h using(source_origin,source_site_uid,resource,external_id) where i.run_id=p_id and i.page=p_page;
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return r;
end $function$;

-- stage_ezyvet_import_page_pre_vaccination(uuid,uuid,uuid,integer,boolean,jsonb)
CREATE OR REPLACE FUNCTION public.stage_ezyvet_import_page_pre_vaccination(p_id uuid, p_actor uuid, p_lease_id uuid, p_page integer, p_complete boolean, p_items jsonb)
 RETURNS ezyvet_import_runs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare r public.ezyvet_import_runs;c public.ezyvet_clinical_runs;m public.ezyvet_record_links;fingerprint text;previous text;ordered_items jsonb;
begin
 select * into strict r from public.ezyvet_import_runs where id=p_id for update;
 if r.resource not in ('consult','history') then
  if public.ezyvet_is_active_admin(p_actor) is not true or r.requested_by is distinct from p_actor then raise exception 'Active import owner required' using errcode='42501';end if;
  -- Preserve existing committed recovery; never let SQL NULL comparisons authorize a fresh page.
  if not exists(select 1 from public.ezyvet_import_pages where run_id=p_id and page=p_page) and (r.status<>'running' or p_lease_id is null or r.lease_id is null or r.lease_id<>p_lease_id or r.lease_until is null or r.lease_until<=now() or p_page is distinct from r.next_page) then raise exception 'Import lease or cursor changed' using errcode='PT409';end if;
  return public.stage_ezyvet_import_page_pre_clinical(p_id,p_actor,p_lease_id,p_page,p_complete,p_items);
 end if;
 if public.ezyvet_is_active_admin(p_actor) is not true or r.requested_by is distinct from p_actor then raise exception 'Active import owner required' using errcode='42501';end if;
 select * into c from public.ezyvet_clinical_runs where run_id=p_id;
 if not found then raise exception 'CLINICAL_RUN_REQUIRES_NEW_MAPPING' using errcode='22023';end if;
 if row(c.actor_id,c.resource,c.source_origin,c.source_site_uid) is distinct from row(p_actor,r.resource,r.source_origin,r.source_site_uid) then raise exception 'Clinical import context mismatch' using errcode='42501';end if;
 if p_complete is null or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>10 or octet_length(p_items::text)>2097152 then raise exception 'Invalid patient-scoped clinical page' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x)<>'object' or jsonb_typeof(x->'payload') is distinct from 'object' or x->>'external_id' is null or x->>'external_id' !~ '^[0-9]+$' or x#>>'{payload,id}' is distinct from x->>'external_id' or x#>>'{payload,animal_id}' is distinct from c.animal_external_id) then raise exception 'Clinical source identity mismatch' using errcode='23514';end if;
 fingerprint:=encode(digest(jsonb_build_array(p_complete,p_items)::text,'sha256'),'hex');
 select request_hash into previous from public.ezyvet_clinical_pages where run_id=p_id and page=p_page;
 if found then
  if previous<>fingerprint then raise exception 'Committed clinical page request changed' using errcode='PT409';end if;
  if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return r;
 end if;
 if r.status<>'running' or p_lease_id is null or r.lease_id is null or r.lease_id<>p_lease_id or r.lease_until is null or r.lease_until<=now() or p_page is distinct from r.next_page then raise exception 'Import lease or cursor changed' using errcode='PT409';end if;
 select * into m from public.ezyvet_record_links where id=c.animal_link_id for share;
 if row(m.resource,m.source_origin,m.source_site_uid,m.external_id,m.pet_id,m.client_id) is distinct from row('animal'::text,c.source_origin,c.source_site_uid,c.animal_external_id,c.pet_id,c.client_id) then raise exception 'Clinical patient mapping changed' using errcode='PT409';end if;
 perform 1 from public.pets where id=c.pet_id and client_id=c.client_id for share;
 if not found then raise exception 'Clinical patient mapping changed' using errcode='PT409';end if;
 -- Existing core preserves source/resource lease, cooldown, cursor and identity-head semantics.
 select coalesce(jsonb_agg(value order by value->>'external_id'),'[]') into ordered_items from jsonb_array_elements(p_items);
 r:=public.stage_ezyvet_import_page_core(p_id,p_actor,p_lease_id,p_page,p_complete,ordered_items);
 insert into public.ezyvet_clinical_pages(run_id,page,request_hash) values(p_id,p_page,fingerprint);
 insert into public.ezyvet_clinical_page_observations(run_id,page,snapshot_id,head_version)
 select i.run_id,i.page,i.snapshot_id,h.version from public.ezyvet_import_page_items i join public.ezyvet_import_snapshots s on s.id=i.snapshot_id join public.ezyvet_identity_heads h using(source_origin,source_site_uid,resource,external_id) where i.run_id=p_id and i.page=p_page;
 if public.ezyvet_is_active_admin(p_actor) is not true then raise exception 'Active administrator required' using errcode='42501';end if;
 return r;
end $function$;

-- start_communication_attempt(uuid,uuid,jsonb)
CREATE OR REPLACE FUNCTION public.start_communication_attempt(p_id uuid, p_lease_token uuid, p_provider_config jsonb)
 RETURNS communication_outbox
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o public.communication_outbox;context jsonb;payload jsonb;valid boolean:=true;
begin
 perform public.communication_require_service();
 select * into o from public.communication_outbox where id=p_id for update;
 if not found or o.state<>'claimed' or o.lease_token is distinct from p_lease_token
  or o.lease_expires_at is null or o.lease_expires_at<=now() or o.attempt_started_at is not null then
  raise exception 'Outbox lease unavailable' using errcode='PT409';end if;
 begin
  context:=public.conversation_email_delivery_context(p_id,p_lease_token);
  if context is not null then
   payload:=(context->>'payload_text')::jsonb;
   valid:=p_provider_config->>'conversation_payload_hash'=context->>'payload_hash'
    and payload->>'from'=p_provider_config->>'from' and payload->>'reply_to'=p_provider_config->>'reply_to';
  elsif p_provider_config ? 'conversation_payload_hash' then valid:=false;
  end if;
 exception when sqlstate '23514' or sqlstate '42501' then valid:=false;
 end;
 if valid is distinct from true then
  update public.communication_outbox set state='failed',last_error='conversation_payload_ineligible',lease_token=null,
   lease_expires_at=null,updated_at=now() where id=o.id returning * into o;return o;
 end if;
 return public.start_communication_attempt_without_conversation(p_id,p_lease_token,p_provider_config-'conversation_payload_hash');
end $function$;

-- start_communication_attempt_without_conversation(uuid,uuid,jsonb)
CREATE OR REPLACE FUNCTION public.start_communication_attempt_without_conversation(p_id uuid, p_lease_token uuid, p_provider_config jsonb)
 RETURNS communication_outbox
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o public.communication_outbox;context jsonb;valid boolean;
begin perform public.communication_require_service();
 select * into o from public.communication_outbox where id=p_id for update;
 if not found or o.state<>'claimed' or o.lease_token is distinct from p_lease_token or o.lease_expires_at<=now() or o.attempt_started_at is not null then raise exception 'Outbox lease unavailable' using errcode='PT409';end if;
 if exists(select 1 from public.payment_delivery_outbox_links where outbox_id=o.id) then
 begin
 context:=public.payment_delivery_context(p_id,p_lease_token);
 valid:=p_provider_config->>'payment_delivery_message_hash'=context#>>'{capture,message_hash}' and p_provider_config->>'payment_delivery_payload_hash'=context#>>'{capture,payload_hash}' and p_provider_config-array['payment_delivery_message_hash','payment_delivery_payload_hash']=context#>'{capture,sender_config}';
 exception when sqlstate '42501' or sqlstate '23514' then valid:=false;end;
 if valid is distinct from true then update public.communication_outbox set state='failed',last_error='payment_delivery_source_or_materialization_ineligible',lease_token=null,lease_expires_at=null,updated_at=now() where id=o.id returning * into o;return o;end if;
 return public.start_communication_attempt_without_payment_delivery_guard(p_id,p_lease_token,p_provider_config-array['payment_delivery_message_hash','payment_delivery_payload_hash']);
 end if;
 return public.start_communication_attempt_without_payment_delivery_guard(p_id,p_lease_token,p_provider_config);
end $function$;

-- start_communication_attempt_without_document_link_guard(uuid,uuid,jsonb)
CREATE OR REPLACE FUNCTION public.start_communication_attempt_without_document_link_guard(p_id uuid, p_lease_token uuid, p_provider_config jsonb)
 RETURNS communication_outbox
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o public.communication_outbox;l public.invoice_email_outbox_links;p public.invoice_email_payloads;payload jsonb;valid boolean:=true;
begin perform public.communication_require_service();select * into o from public.communication_outbox where id=p_id for update;
 if not found or o.state<>'claimed' or o.lease_token is distinct from p_lease_token or o.lease_expires_at<=now() or o.attempt_started_at is not null then raise exception 'Outbox lease unavailable' using errcode='PT409';end if;
 select * into l from public.invoice_email_outbox_links where outbox_id=o.id;
 if found then
  begin
   perform public.invoice_email_context(l.request_id);
   select * into p from public.invoice_email_payloads where request_id=l.request_id;
   payload:=p.payload_text::jsonb;
   valid:=p.request_id is not null and p.payload_hash=l.reviewed_payload_hash and p.payload_hash=encode(sha256(convert_to(p.payload_text,'UTF8')),'hex') and p_provider_config->>'invoice_payload_hash'=p.payload_hash and payload->>'from'=p_provider_config->>'from' and payload->>'reply_to'=p_provider_config->>'reply_to';
  exception when sqlstate '23514' or sqlstate '42501' then valid:=false;end;
  if valid is distinct from true then update public.communication_outbox set state='failed',last_error='invoice_source_or_payload_ineligible',lease_token=null,lease_expires_at=null,updated_at=now() where id=o.id returning * into o;return o;end if;
  return public.start_communication_attempt_without_invoice_guard(p_id,p_lease_token,p_provider_config-'invoice_payload_hash');
 end if;
 return public.start_communication_attempt_without_invoice_guard(p_id,p_lease_token,p_provider_config);
end $function$;

-- start_communication_attempt_without_invoice_guard(uuid,uuid,jsonb)
CREATE OR REPLACE FUNCTION public.start_communication_attempt_without_invoice_guard(p_id uuid, p_lease_token uuid, p_provider_config jsonb)
 RETURNS communication_outbox
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o public.communication_outbox;l public.release_email_outbox_links;p public.release_email_payloads;payload jsonb;valid boolean:=true;
begin perform public.communication_require_service();select * into o from public.communication_outbox where id=p_id for update;
 if not found or o.state<>'claimed' or o.lease_token is distinct from p_lease_token or o.lease_expires_at<=now() or o.attempt_started_at is not null then raise exception 'Outbox lease unavailable' using errcode='PT409';end if;
 select * into l from public.release_email_outbox_links where outbox_id=o.id;
 if found then
  begin
   perform public.release_email_context(l.request_id);
   select * into p from public.release_email_payloads where request_id=l.request_id;
   payload:=p.payload_text::jsonb;
   valid:=p.request_id is not null and p.payload_hash=l.reviewed_payload_hash and p.payload_hash=encode(sha256(convert_to(p.payload_text,'UTF8')),'hex') and payload->>'from'=p_provider_config->>'from' and payload->>'reply_to'=p_provider_config->>'reply_to';
  exception when sqlstate '23514' or sqlstate '42501' then valid:=false;end;
  if valid is distinct from true then update public.communication_outbox set state='failed',last_error='release_source_or_payload_ineligible',lease_token=null,lease_expires_at=null,updated_at=now() where id=o.id returning * into o;return o;end if;
 end if;
 return public.start_communication_attempt_without_release_guard(p_id,p_lease_token,p_provider_config);
end $function$;

-- start_communication_attempt_without_payment_delivery_guard(uuid,uuid,jsonb)
CREATE OR REPLACE FUNCTION public.start_communication_attempt_without_payment_delivery_guard(p_id uuid, p_lease_token uuid, p_provider_config jsonb)
 RETURNS communication_outbox
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o public.communication_outbox;context jsonb;valid boolean:=true;
begin
 perform public.communication_require_service();
 select * into o from public.communication_outbox where id=p_id for update;
 if not found or o.state<>'claimed' or o.lease_token is distinct from p_lease_token or o.lease_expires_at<=now() or o.attempt_started_at is not null then raise exception 'Outbox lease unavailable' using errcode='PT409';end if;
 if exists(select 1 from public.document_link_outbox_links where outbox_id=o.id) then
  begin
   context:=public.document_link_delivery_context(p_id,p_lease_token);
   valid:=context is not null and p_provider_config->>'document_link_message_hash'=context->>'message_hash' and p_provider_config->>'document_link_token_hash'=context->>'token_hash' and p_provider_config->>'document_link_artifact_hash'=context->>'artifact_hash';
  exception when sqlstate '42501' or sqlstate '23514' then valid:=false;end;
  if valid is distinct from true then update public.communication_outbox set state='failed',last_error='document_link_source_or_materialization_ineligible',lease_token=null,lease_expires_at=null,updated_at=now() where id=o.id returning * into o;return o;end if;
  return public.start_communication_attempt_without_document_link_guard(p_id,p_lease_token,p_provider_config-array['document_link_message_hash','document_link_token_hash','document_link_artifact_hash']);
 end if;
 return public.start_communication_attempt_without_document_link_guard(p_id,p_lease_token,p_provider_config);
end $function$;

-- start_communication_attempt_without_release_guard(uuid,uuid,jsonb)
CREATE OR REPLACE FUNCTION public.start_communication_attempt_without_release_guard(p_id uuid, p_lease_token uuid, p_provider_config jsonb)
 RETURNS communication_outbox
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.communication_outbox;link public.reminder_outbox_links;context jsonb;
begin perform public.communication_require_service();select * into r from public.communication_outbox where id=p_id for update;
 if r.id is null or r.state<>'claimed' or r.lease_token is distinct from p_lease_token or r.lease_expires_at<=now() or r.attempt_started_at is not null then raise exception 'Outbox lease is unavailable' using errcode='PT409';end if;
 select * into link from public.reminder_outbox_links where outbox_id=p_id for update;
 if found then
  if link.invalidated_at is null then context=public.reminder_delivery_context(link.job_kind,link.job_id,link.policy_id);end if;
  if context is null or context is distinct from link.frozen_context then
   update public.reminder_outbox_links set invalidated_at=coalesce(invalidated_at,now()),reason='final_preflight_source_or_recipient_ineligible' where outbox_id=p_id;
   perform public.block_reminder_job(link.job_kind,link.job_id,'Reminder invalidated before provider attempt');
   update public.communication_outbox set state='failed',last_error='reminder_source_or_recipient_ineligible',lease_token=null,lease_expires_at=null,updated_at=now() where id=p_id returning * into r;return r;
  end if;
 end if;
 r=public.start_communication_attempt_without_reminder_guard(p_id,p_lease_token,p_provider_config);
 if link.outbox_id is not null and r.state='failed' and r.last_error='recipient_or_actor_ineligible' then
  update public.reminder_outbox_links set invalidated_at=coalesce(invalidated_at,now()),reason='final_preflight_recipient_or_actor_ineligible' where outbox_id=p_id;
  perform public.block_reminder_job(link.job_kind,link.job_id,'Reminder invalidated by final recipient or actor check');
 end if;
 return r;
end $function$;

-- start_communication_attempt_without_reminder_guard(uuid,uuid,jsonb)
CREATE OR REPLACE FUNCTION public.start_communication_attempt_without_reminder_guard(p_id uuid, p_lease_token uuid, p_provider_config jsonb)
 RETURNS communication_outbox
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result public.communication_outbox;
begin
 perform public.communication_require_service();
 select * into result from public.communication_outbox where id=p_id for update;
 if not found or result.state<>'claimed' or result.lease_token is distinct from p_lease_token or result.lease_expires_at<=now() or result.attempt_started_at is not null then raise exception 'Outbox lease is unavailable' using errcode='PT409'; end if;
 -- Re-check immediately before the external request, including actor revocation and contact changes.
 if not public.is_active_staff(result.created_by) or public.communication_is_suppressed(result.channel,result.recipient,result.client_id)
 or not exists(select 1 from public.clients c where c.id=result.client_id and public.communication_recipient(result.channel,case when result.channel='EMAIL' then c.primary_email else c.primary_phone end)=result.recipient) then
  update public.communication_outbox set state='failed',last_error='recipient_or_actor_ineligible',lease_token=null,lease_expires_at=null,updated_at=now() where id=p_id returning * into result;
  return result;
 end if;
 if result.channel='SMS' and result.provider is distinct from public.communication_sms_provider() then
  update public.communication_outbox set state='failed',last_error='sms_provider_mismatch',lease_token=null,lease_expires_at=null,updated_at=now() where id=p_id returning * into result;
  return result;
 end if;
 if p_provider_config is null or jsonb_typeof(p_provider_config)<>'object' or (result.provider='resend' and (not(p_provider_config ?& array['from','reply_to']) or p_provider_config-array['from','reply_to']<>'{}'::jsonb)) or (result.provider='twilio' and (not(p_provider_config ?& array['from','account_sid']) or p_provider_config-array['from','account_sid']<>'{}'::jsonb))
 or (result.provider='cloudtalk' and (not(p_provider_config ?& array['from','provider']) or p_provider_config-array['from','provider']<>'{}'::jsonb or p_provider_config->>'provider'<>'cloudtalk' or jsonb_typeof(p_provider_config->'from')<>'string' or public.communication_recipient('SMS',p_provider_config->>'from') is distinct from p_provider_config->>'from')) then raise exception 'Invalid provider metadata' using errcode='23514'; end if;
 if result.provider_config is not null and result.provider_config<>p_provider_config then raise exception 'Provider sender metadata changed; reconcile before sending' using errcode='23514'; end if;
 if result.first_attempt_at is not null and result.provider='resend' and result.first_attempt_at<=now()-interval '23 hours' then
  update public.communication_outbox set state='uncertain',last_error='idempotency_window_expired',lease_token=null,lease_expires_at=null,updated_at=now() where id=p_id returning * into result; return result;
 end if;
 update public.communication_outbox set provider_config=coalesce(provider_config,p_provider_config),first_attempt_at=coalesce(first_attempt_at,now()),attempt_started_at=now(),attempt_count=attempt_count+1,updated_at=now() where id=p_id returning * into result;
 insert into public.communication_attempts(outbox_id,lease_token,attempt_number) values(result.id,p_lease_token,result.attempt_count);
 return result;
end $function$;

-- transition_native_refill(uuid,jsonb)
CREATE OR REPLACE FUNCTION public.transition_native_refill(p_id uuid, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a uuid:=public.clinical_require_staff();r jsonb;ri uuid;pet uuid;ev integer;assignee uuid;linked_auth uuid;f public.native_refills;p public.pets;before_doc jsonb;action text;preview jsonb;link jsonb;
begin
 r:=public.native_refill_begin(p_id,'transition',p_request);if r is not null then return r;end if;
 perform public.native_rx_keys(p_request,array['refill_id','pet_id','expected_version','action','reason','assigned_to','authorization_id','expected_link_context_hash']);
 ri:=public.native_rx_uuid(p_request->'refill_id');pet:=public.native_rx_uuid(p_request->'pet_id');ev:=public.native_rx_revision(p_request->'expected_version');assignee:=public.native_rx_uuid(p_request->'assigned_to',true);linked_auth:=public.native_rx_uuid(p_request->'authorization_id',true);perform public.native_rx_text(p_request->'reason',2000);action:=p_request->>'action';
 if ev is null or action is null or action not in ('assign','link','close','deny') or (action<>'assign' and assignee is not null) or (action='link' and (linked_auth is null or jsonb_typeof(p_request->'expected_link_context_hash') is distinct from 'string' or p_request->>'expected_link_context_hash' !~ '^[a-f0-9]{64}$')) or (action<>'link' and (linked_auth is not null or p_request->'expected_link_context_hash' is distinct from 'null'::jsonb)) then raise exception 'Exact operational refill transition required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('native-refill:'||ri::text,0));perform public.clinical_require_staff();
 select * into f from public.native_refills where id=ri and pet_id=pet for update;
 if not found or f.version<>ev then raise exception 'Refill changed' using errcode='PT409';end if;
 if f.state<>'open' then raise exception 'Refill is already terminal' using errcode='23514';end if;
 before_doc:=to_jsonb(f);
 if action='link' then
 preview:=public.preview_native_refill_link(ri,pet,linked_auth);link:=preview->'context';
 if preview->>'context_hash' is distinct from p_request->>'expected_link_context_hash' then raise exception 'Refill authorization context changed' using errcode='PT409';end if;
 if link->>'authorization_state'<>'active' then raise exception 'Active authorization required for new refill link' using errcode='23514';end if;
 f.authorization_id:=linked_auth;f.authorization_hash:=link->>'authorization_hash';
 elsif action='assign' then
 select * into p from public.pets where id=pet for share;
 if p.client_id<>f.client_id or p.archived_at is not null or p.deceased_at is not null then raise exception 'Current open refill patient and household required' using errcode='23514';end if;
 if assignee is not null and not public.is_active_staff(assignee) then raise exception 'Active staff assignee required' using errcode='23514';end if;
 f.assigned_to:=assignee;
 else f.state:=case action when 'close' then 'closed' else 'denied' end;
 end if;
 perform public.clinical_require_staff();
 if action='assign' and assignee is not null and not public.is_active_staff(assignee) then raise exception 'Active staff assignee required' using errcode='23514';end if;
 update public.native_refills set version=version+1,state=f.state,assigned_to=f.assigned_to,authorization_id=f.authorization_id,authorization_hash=f.authorization_hash,updated_by=a,updated_at=clock_timestamp() where id=ri returning * into f;
 return public.native_refill_finish(p_id,'transition',p_request,before_doc,f,action,link);
end $function$;

-- update_conversation_metadata(uuid,uuid,integer,conversation_status,uuid,conversation_priority,text[])
CREATE OR REPLACE FUNCTION public.update_conversation_metadata(p_actor_id uuid, p_conversation_id uuid, p_expected_revision integer, p_status conversation_status, p_assigned_to_id uuid, p_priority conversation_priority, p_tags text[])
 RETURNS conversations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid; original public.conversations; result public.conversations;
begin
 actor:=public.clinical_require_staff();
 if actor is distinct from p_actor_id then raise exception 'Actor mismatch' using errcode='42501';end if;
 select * into original from public.conversations where id=p_conversation_id;
 perform pg_advisory_xact_lock(hashtextextended('conversation:'||original.client_id::text,950));
 select * into original from public.conversations where id=p_conversation_id for update;
 if not found then raise exception 'Conversation not found' using errcode='23503';end if;
 if original.revision is distinct from p_expected_revision then raise exception 'Conversation changed; reload' using errcode='PT409';end if;
 if p_status is null or p_priority is null or p_tags is null or cardinality(p_tags)>20 or exists(select 1 from unnest(p_tags)t where t is null or length(trim(t)) not between 1 and 40) then raise exception 'Invalid conversation metadata' using errcode='23514';end if;
 if p_assigned_to_id is not null and not public.is_active_staff(p_assigned_to_id) then raise exception 'Assignee must be active staff' using errcode='23514';end if;
 update public.conversations set status=p_status,assigned_to_id=p_assigned_to_id,priority=p_priority,
 tags=array(select distinct trim(t) from unnest(p_tags)t order by 1),revision=revision+1,
 archived_at=case when p_status='ARCHIVED' then coalesce(archived_at,now()) else null end
 where id=p_conversation_id returning * into result;
 insert into public.conversation_activity_audit(conversation_id,actor_id,action,before_value,after_value) values(result.id,actor,'metadata',to_jsonb(original),to_jsonb(result));
 return result;
end $function$;

-- update_website_inquiry(uuid,uuid,integer,text,uuid,text)
CREATE OR REPLACE FUNCTION public.update_website_inquiry(p_actor_id uuid, p_id uuid, p_expected_version integer, p_status text, p_assigned_to_id uuid, p_reason text)
 RETURNS website_inquiry_triage
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid;original public.website_inquiry_triage;result public.website_inquiry_triage;
begin
 actor:=public.clinical_require_staff();if actor is distinct from p_actor_id then raise exception 'Actor mismatch' using errcode='42501';end if;
 select * into original from public.website_inquiry_triage where inquiry_id=p_id for update;
 if not found or original.version is distinct from p_expected_version then raise exception 'Inquiry changed; reload before saving' using errcode='PT409';end if;
 if p_status is null or p_status not in ('new','in_progress','resolved','spam') or p_reason is null or length(trim(p_reason)) not between 5 and 1000 or (p_assigned_to_id is not null and not public.is_active_staff(p_assigned_to_id)) then raise exception 'Valid status, active assignee and review reason required' using errcode='23514';end if;
 update public.website_inquiry_triage set status=p_status,assigned_to_id=p_assigned_to_id,version=version+1,updated_at=now() where inquiry_id=p_id returning * into result;
 insert into public.website_inquiry_history(inquiry_id,actor_id,action,reason,before_value,after_value) values(p_id,actor,'triage',trim(p_reason),to_jsonb(original),to_jsonb(result));
 return result;
end $function$;

-- void_billing_invoice(uuid,integer,text)
CREATE OR REPLACE FUNCTION public.void_billing_invoice(p_id uuid, p_expected_version integer, p_reason text)
 RETURNS billing_invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result public.billing_invoices;
begin
 perform public.clinical_require_staff();
 if p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Void reason is required' using errcode='23514'; end if;
 select * into result from public.billing_invoices where id=p_id for update;
 if not found or result.version<>p_expected_version or result.status<>'issued' then raise exception 'Invoice changed; reload before voiding' using errcode='PT409'; end if;
 if exists(select 1 from public.billing_credits where invoice_id=p_id) then raise exception 'Credited invoices cannot be voided; credit the remaining balance' using errcode='23514'; end if;
 update public.billing_invoices set status='void',voided_at=now(),void_reason=trim(p_reason) where id=p_id returning * into result; return result;
end $function$;

-- void_patient_document(uuid,integer,text)
CREATE OR REPLACE FUNCTION public.void_patient_document(p_id uuid, p_expected_version integer, p_reason text)
 RETURNS patient_documents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result public.patient_documents;
begin
 perform public.clinical_require_staff();
 if p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'A void reason is required (maximum 2000 characters)' using errcode='23514'; end if;
 update public.patient_documents set status='void',void_reason=trim(p_reason) where id=p_id and version=p_expected_version and status='ready' returning * into result;
 if not found then raise exception 'Record changed or no longer exists; reload before voiding' using errcode='PT409'; end if;
 return result;
end $function$;

-- Deploy-time guard: no function in the public schema may raise or catch a SQLSTATE that
-- PostgREST retries automatically.
do $guard$
declare offenders text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by 1) into offenders
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosrc ~ '40001|40P01';
  if offenders is not null then
    raise exception 'Functions still use a PostgREST-retryable SQLSTATE (40001/40P01): %', offenders;
  end if;
end
$guard$;
