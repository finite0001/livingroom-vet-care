begin;create extension if not exists pgtap with schema extensions;set local search_path=public,extensions;select no_plan();
-- FIXTURE_BEGIN
insert into auth.users(id,email,raw_user_meta_data) values
 ('a5510000-0000-4000-8000-000000000001','native-rx-dvm@example.test','{}'),
 ('a5510000-0000-4000-8000-000000000002','native-rx-staff@example.test','{}'),
 ('a5510000-0000-4000-8000-000000000003','native-rx-uncommissioned@example.test','{}'),
 ('a5510000-0000-4000-8000-000000000004','native-rx-admin@example.test','{}');
update profiles set full_name='Synthetic prescriber' where id='a5510000-0000-4000-8000-000000000001';
insert into user_roles(user_id,role) values('a5510000-0000-4000-8000-000000000001','DVM'),('a5510000-0000-4000-8000-000000000001','ADMIN'),('a5510000-0000-4000-8000-000000000003','DVM'),('a5510000-0000-4000-8000-000000000004','ADMIN');
create temp table fx(k text primary key,id uuid);create temp table data(k text primary key,v jsonb);grant all on fx,data to authenticated;
set local role authenticated;select set_config('request.jwt.claims','{"sub":"a5510000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into fx select 'client',id from save_client(auth.uid(),null,null,'Native','Household','+13035550123','native-release@example.test','EMAIL','2619 Synthetic Street',null);
insert into fx select 'pet',id from save_patient(null,(select id from fx where k='client'),null,'Native Patient','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null);
insert into fx select 'product',id from save_catalog_product(null,null,'Synthetic medication','medication','','tablet',100,true);
insert into fx select k,gen_random_uuid() from unnest(array['config','save','draft','sign','save2','draft2']) k;
insert into data values('config-request',jsonb_build_object('user_id',auth.uid(),'expected_version',null,'attest_review',true,'fields',jsonb_build_object('active',true,'license_number','SYNTHETIC','license_state','CO','license_expires_on','2099-12-31','practice_name','Synthetic practice','practice_address','2619 Synthetic Street','practice_phone',null,'clinical_review_note','Synthetic fixture only')));
insert into data select 'fields',jsonb_build_object('encounter_id',null,'medication',jsonb_build_object('name','Synthetic medication','strength','Synthetic strength','form','Synthetic form','directions','Synthetic directions only','route','Synthetic route'),'quantity_per_fill','30','unit','tablet','refills_authorized',2,'fulfillment_mode','practice_stock','product_id',(select id from fx where k='product'),'starts_on',(now() at time zone 'America/Denver')::date,'expires_on','2099-12-31');
insert into data select 'save-request',jsonb_build_object('draft_id',(select id from fx where k='draft'),'pet_id',(select id from fx where k='pet'),'client_id',(select id from fx where k='client'),'expected_version',null,'fields',v) from data where k='fields';
-- FIXTURE_END
select configure_native_prescriber((select id from fx where k='config'),(select v from data where k='config-request'));
select save_native_prescription_draft((select id from fx where k='save'),(select v from data where k='save-request'));
insert into data select 'sign-request',jsonb_build_object('draft_id',(select id from fx where k='draft'),'pet_id',(select id from fx where k='pet'),'expected_version',1,'expected_context_hash',preview_native_prescription_sign((select id from fx where k='draft'),1)->>'context_hash','signature_name','Synthetic prescriber','attest_review',true);
insert into data select 'sign-receipt',sign_native_prescription((select id from fx where k='sign'),(select v from data where k='sign-request'));
insert into fx select k,gen_random_uuid() from unnest(array['release','release-fill','release-pickup','release-cancel','stale','invoice','lot','dispense','pickup','cancel']) k;
create function pg_temp.preview_native_release(selection jsonb) returns jsonb language sql as $$select preview_record_release_v10((select id from fx where k='pet'),(select id from fx where k='client'),'EMAIL','native-release@example.test',selection)$$;
create function pg_temp.confirm_native_release(id uuid,selection jsonb,preview jsonb) returns public.record_releases language sql as $$select confirm_record_release(id,(select id from fx where k='pet'),(select id from fx where k='client'),'EMAIL','native-release@example.test',selection,preview->'snapshot',preview->>'source_hash',true)$$;
insert into data select 'selection',jsonb_build_object('native_prescription_ids',jsonb_build_array(id)) from fx where k='sign';
insert into data select 'preview',pg_temp.preview_native_release(v) from data where k='selection';
select receive_inventory(gen_random_uuid(),(select id from fx where k='lot'),(select id from fx where k='product'),'CORRECTION-TEST',current_date+365,'Synthetic clinic',100,'Synthetic opening stock');
select create_billing_invoice((select id from fx where k='invoice'),(select id from fx where k='client'));
insert into data select 'target',jsonb_build_object('authorization_id',(select id from fx where k='sign'),'pet_id',(select id from fx where k='pet'),'slot_index',0,'expected_slot_version',null,'invoice_id',(select id from fx where k='invoice'),'quantity','10','allocations',jsonb_build_array(jsonb_build_object('lot_id',(select id from fx where k='lot'),'quantity','10')),'refill',null);
insert into data select 'dispense',record_native_dispense((select id from fx where k='dispense'),v||jsonb_build_object('expected_context_hash',preview_native_dispense(v)->>'context_hash','reason','Synthetic dispensing','attest_alert_review',true,'attest_dispense_review',true)) from data where k='target';
insert into data select 'fill-selection',jsonb_build_object('native_dispense_ids',jsonb_build_array(id)) from fx where k='dispense';
insert into data select 'before-correction10',pg_temp.preview_native_release(v) from data where k='fill-selection';
reset role;
insert into record_release_policy(id,enabled,accepted_schema_version,accepted_by,accepted_at,acceptance_reference) values(true,true,10,'Synthetic reviewer',now(),'TEST ONLY') on conflict(id) do update set enabled=true,accepted_schema_version=10,accepted_by=excluded.accepted_by,accepted_at=excluded.accepted_at,acceptance_reference=excluded.acceptance_reference;
set local role authenticated;
insert into data select 'release10',to_jsonb(pg_temp.confirm_native_release((select id from fx where k='release'),(select v from data where k='fill-selection'),(select v from data where k='before-correction10')));
create function pg_temp.correction_preview() returns jsonb language sql as $$select preview_native_dispense_correction((select id from fx where k='sign'),(select id from fx where k='pet'),(select id from fx where k='dispense'))$$;
create function pg_temp.correction_request(kind text) returns jsonb language sql as $$select jsonb_build_object('authorization_id',(select id from fx where k='sign'),'pet_id',(select id from fx where k='pet'),'dispense_id',(select id from fx where k='dispense'),'kind',kind,'expected_context_hash',p->>'context_hash','expected_head',p#>'{context,head}','reason','Synthetic reviewed correction','note','Synthetic client-shareable correction note','amends_event_id',null,'pickup_amendment',null,'attest_review',true) from(select pg_temp.correction_preview() p) q$$;
create function pg_temp.release11() returns jsonb language sql as $$select preview_record_release_v11((select id from fx where k='pet'),(select id from fx where k='client'),'EMAIL','native-release@example.test',(select v from data where k='fill-selection'))$$;
insert into fx select k,gen_random_uuid() from unnest(array['annotation','operational','amend1','amend2','release11','stale-correction']) k;
reset role;
insert into data select 'untouched',jsonb_build_object('dispense',(select document from native_dispenses where id=(select id from fx where k='dispense')),'usage',native_rx_usage_context((select id from fx where k='sign')),'movements',(select jsonb_agg(to_jsonb(m) order by id) from inventory_movements m where lot_id=(select id from fx where k='lot')),'items',(select jsonb_agg(to_jsonb(i) order by id) from billing_invoice_items i where invoice_id=(select id from fx where k='invoice')),'invoice',(select to_jsonb(i) from billing_invoices i where id=(select id from fx where k='invoice')));
set local role authenticated;
select is(pg_temp.correction_preview()#>>'{context,head,version}','0','Initial correction head empty');
select is(read_native_prescription_print_v2((select id from fx where k='sign'),(select id from fx where k='dispense'))#>>'{correction_summary,heads_hash}',encode(sha256(convert_to('[]','UTF8')),'hex'),'Empty summary hash canonical');
select lives_ok($$select read_native_prescription_print((select id from fx where k='sign'),(select id from fx where k='dispense'))$$,'Unaffected legacy print remains available');
select is(read_native_dispense_corrections((select id from fx where k='sign'),gen_random_uuid(),(select id from fx where k='dispense')),null::jsonb,'Read denies wrong patient');
select is(list_native_dispense_corrections(gen_random_uuid(),(select id from fx where k='pet'),(select id from fx where k='dispense')),null::jsonb,'History denies wrong authorization');
select throws_ok($$select list_native_dispense_corrections((select id from fx where k='sign'),(select id from fx where k='pet'),(select id from fx where k='dispense'),0,25)$$,'23514',null,'Invalid cursor rejected');
select throws_ok($$select append_native_dispense_correction(null,pg_temp.correction_request('clinical_annotation'))$$,'23514',null,'Stable correction ID required');
select throws_ok($$select append_native_dispense_correction(gen_random_uuid(),pg_temp.correction_request('clinical_annotation')||'{"unknown":1}')$$,'23514',null,'Closed request enforced');
select throws_ok($$select append_native_dispense_correction(gen_random_uuid(),pg_temp.correction_request('clinical_annotation')||'{"attest_review":false}')$$,'23514',null,'Client-shareable review attestation required');
insert into data select 'clinical-request',pg_temp.correction_request('clinical_annotation');
-- ADMIN alone cannot create a clinical annotation.
reset role;delete from user_roles where user_id='a5510000-0000-4000-8000-000000000001' and role='DVM';set local role authenticated;
select throws_ok($$select append_native_dispense_correction((select id from fx where k='annotation'),(select v from data where k='clinical-request'))$$,'42501','Active veterinarian required for clinical annotation','ADMIN without DVM cannot annotate clinically');
reset role;insert into user_roles(user_id,role) values('a5510000-0000-4000-8000-000000000001','DVM');
-- Signing commissioning is separate; removing its availability must not remove historical annotation authority.
set local role authenticated;
select configure_native_prescriber(gen_random_uuid(),(select jsonb_set(jsonb_set(v,'{expected_version}','1'),'{fields,active}','false') from data where k='config-request'));
insert into data select 'clinical-receipt',append_native_dispense_correction((select id from fx where k='annotation'),(select v from data where k='clinical-request'));
select is((select v#>>'{result,actor,authority}' from data where k='clinical-receipt'),'active_dvm','Clinical entry records DVM authority without prescribing');
select is((select v#>>'{result,sequence}' from data where k='clinical-receipt'),'1','First immutable root sequence1');
select is(append_native_dispense_correction((select id from fx where k='annotation'),(select v from data where k='clinical-request')),(select v from data where k='clinical-receipt'),'Exact append retry returns same receipt');
select is(recover_native_dispense_correction((select id from fx where k='annotation')),(select v from data where k='clinical-receipt'),'Same actor exact recovery');
select throws_ok($$select append_native_dispense_correction((select id from fx where k='annotation'),(select v||'{"note":"Different"}' from data where k='clinical-request'))$$,'23514','Correction identifier already used','Changed content cannot reuse operation');
select throws_ok($$select append_native_dispense_correction((select id from fx where k='stale-correction'),(select v from data where k='clinical-request'))$$,'40001','Correction review context changed','Competing first-root review stale');
select throws_ok($$select read_native_prescription_print((select id from fx where k='sign'),(select id from fx where k='dispense'))$$,'23514','Prescription has correction history; use version2 print disclosure','Legacy print cannot omit correction history');
select is(read_record_release((select id from fx where k='release'))->>'eligible','false','Correction invalidates existing schema10');
select throws_ok($$select pg_temp.preview_native_release((select v from data where k='fill-selection'))$$,'23514','Native correction history requires release schema11','Fresh schema10 cannot hide corrections');
select is(to_jsonb(pg_temp.confirm_native_release((select id from fx where k='release'),(select v from data where k='fill-selection'),(select v from data where k='before-correction10'))),(select v from data where k='release10'),'Frozen schema10 exact confirmation recovery unchanged');
insert into data select 'preview11',pg_temp.release11();
select is((select v#>>'{snapshot,native_dispenses,0,corrections,head,version}' from data where k='preview11'),'1','Schema11 includes exact correction head');
select is((select v#>>'{snapshot,native_dispenses,0,prescription,corrections,event_count}' from data where k='preview11'),'1','Embedded authorization includes summary');
select throws_ok($$select pg_temp.confirm_native_release((select id from fx where k='release11'),(select v from data where k='fill-selection'),(select v from data where k='preview11'))$$,'42501',null,'Policy10 cannot authorize11');
reset role;update record_release_policy set accepted_schema_version=11;set local role authenticated;
select lives_ok($$select pg_temp.confirm_native_release((select id from fx where k='release11'),(select v from data where k='fill-selection'),(select v from data where k='preview11'))$$,'Explicit acceptance11 permits reviewed disclosure');
select is(read_native_prescription_print_v2((select id from fx where k='sign'),(select id from fx where k='dispense'))#>'{dispense_corrections,events,0}',(select v->'result' from data where k='clinical-receipt'),'PrintV2 preserves exact attributed clinical event');
-- DVM removed: historical receipt remains recoverable; no new clinical entry.
reset role;delete from user_roles where user_id='a5510000-0000-4000-8000-000000000001' and role='DVM';set local role authenticated;
select is(recover_native_dispense_correction((select id from fx where k='annotation')),(select v from data where k='clinical-receipt'),'Historical recovery survives clinical role removal');
select throws_ok($$select append_native_dispense_correction(gen_random_uuid(),pg_temp.correction_request('clinical_annotation'))$$,'42501',null,'Removed clinical role cannot append');
insert into data select 'operational-request',pg_temp.correction_request('operational_annotation');
insert into data select 'operational-receipt',append_native_dispense_correction((select id from fx where k='operational'),(select v from data where k='operational-request'));
select is((select v#>>'{result,actor,authority}' from data where k='operational-receipt'),'active_staff','Operational note attributed as staff');
select is((select v#>>'{result,prior_record_hash}' from data where k='operational-receipt'),(select v#>>'{result,record_hash}' from data where k='clinical-receipt'),'Canonical predecessor hash linked');
select is(read_record_release((select id from fx where k='release11'))->>'eligible','false','Further annotation invalidates saved11');
select throws_ok($$select append_native_dispense_correction(gen_random_uuid(),pg_temp.correction_request('operational_annotation')||jsonb_build_object('amends_event_id',(select id from fx where k='annotation')))$$,'23514','Exact same-kind correction amendment required','Staff note cannot amend clinical entry');
select throws_ok($$select append_native_dispense_correction(gen_random_uuid(),pg_temp.correction_request('pickup_amendment')||jsonb_build_object('pickup_amendment',jsonb_build_object('original_pickup_id',gen_random_uuid(),'disposition','recorded_in_error','handoff',null)))$$,'23514',null,'Pickup amendment requires original pickup');
insert into data select 'pre-pickup-context',pg_temp.correction_request('operational_annotation');
insert into data select 'pickup',record_native_pickup((select id from fx where k='pickup'),jsonb_build_object('authorization_id',(select id from fx where k='sign'),'pet_id',(select id from fx where k='pet'),'dispense_id',(select id from fx where k='dispense'),'expected_context_hash',preview_native_pickup((select id from fx where k='dispense'),(select id from fx where k='pet'),null)->>'context_hash','recipient_name','Original recipient','recipient_relationship','Original relationship','reason','Synthetic handoff','attest_handoff',true,'refill_close',null));
select throws_ok($$select append_native_dispense_correction(gen_random_uuid(),(select v from data where k='pre-pickup-context'))$$,'40001','Correction review context changed','Pickup appearing during review invalidates context');
-- Rollback-only clock regression probe: replace only the private pickup projection
-- inside the failing subtransaction. Original rows and function definition survive unchanged.
reset role;
select throws_ok($probe$do $body$declare definition text;request jsonb;begin
 select pg_get_functiondef('public.native_correction_pickup(uuid)'::regprocedure) into definition;
 if position('p.document->''picked_up_at''' in definition)=0 then raise exception 'Expected pickup projection missing';end if;
 execute replace(definition,'p.document->''picked_up_at''','to_jsonb(''2099-01-01T00:00:00Z''::text)');
 request:=pg_temp.correction_request('pickup_amendment')||jsonb_build_object('pickup_amendment',jsonb_build_object('original_pickup_id',(select id from fx where k='pickup'),'disposition','recorded_in_error','handoff',null));
 perform append_native_dispense_correction(gen_random_uuid(),request);
 end $body$;$probe$,'40001','Correction observation clock moved backwards','Pickup amendment rejects clock earlier than original handoff');
select ok(position('2099-01-01T00:00:00Z' in pg_get_functiondef('public.native_correction_pickup(uuid)'::regprocedure))=0,'Synthetic clock projection rolled back');
set local role authenticated;
insert into data select 'amend1-request',pg_temp.correction_request('pickup_amendment')||jsonb_build_object('pickup_amendment',jsonb_build_object('original_pickup_id',(select id from fx where k='pickup'),'disposition','recorded_in_error','handoff',null));
insert into data select 'amend1',append_native_dispense_correction((select id from fx where k='amend1'),(select v from data where k='amend1-request'));
select is(pg_temp.correction_preview()#>>'{context,latest_pickup_amendment,value,disposition}','recorded_in_error','Disputed pickup is not a new handoff');
select is(read_native_prescription_print_v2((select id from fx where k='sign'),(select id from fx where k='dispense'))#>>'{original_pickup,recipient_name}','Original recipient','Original pickup stays visible');
insert into data select 'amend2-request',pg_temp.correction_request('pickup_amendment')||jsonb_build_object('amends_event_id',(select id from fx where k='amend1'),'pickup_amendment',jsonb_build_object('original_pickup_id',(select id from fx where k='pickup'),'disposition','corrected_handoff','handoff',jsonb_build_object('picked_up_at',(select v#>'{result,picked_up_at}' from data where k='pickup'),'recipient_name','Corrected recipient','recipient_relationship','Corrected relationship')));
select throws_ok($$select append_native_dispense_correction(gen_random_uuid(),(select jsonb_set(v,'{pickup_amendment,handoff,picked_up_at}',to_jsonb('2099-01-01T00:00:00Z'::text)) from data where k='amend2-request'))$$,'23514','Corrected handoff time outside recorded bounds','Future claimed handoff denied');
select throws_ok($$select append_native_dispense_correction(gen_random_uuid(),(select jsonb_set(v,'{pickup_amendment,handoff,picked_up_at}',to_jsonb('2000-01-01T00:00:00Z'::text)) from data where k='amend2-request'))$$,'23514','Corrected handoff time outside recorded bounds','Predispense claimed handoff denied');
insert into data select 'amend2',append_native_dispense_correction((select id from fx where k='amend2'),(select v from data where k='amend2-request'));
select is(pg_temp.correction_preview()#>>'{context,latest_pickup_amendment,value,handoff,recipient_name}','Corrected recipient','Latest corrected handoff is attributed separately');
select is(jsonb_array_length(list_native_dispense_corrections((select id from fx where k='sign'),(select id from fx where k='pet'),(select id from fx where k='dispense'),null,2)->'events'),2,'History page bounded');
select is(list_native_dispense_corrections((select id from fx where k='sign'),(select id from fx where k='pet'),(select id from fx where k='dispense'),null,2)->>'next_before_version','3','Exclusive next sequence cursor');
select is(list_native_dispense_corrections((select id from fx where k='sign'),(select id from fx where k='pet'),(select id from fx where k='dispense'),3,2)#>>'{events,0,sequence}','2','Next page excludes cursor event');
select is(list_native_dispense_corrections((select id from fx where k='sign'),(select id from fx where k='pet'),(select id from fx where k='dispense'),3,2)->'next_before_version','null'::jsonb,'No false next page');
select is(jsonb_array_length(pg_temp.release11()#>'{snapshot,native_dispenses,0,corrections,events}'),4,'Client package includes complete ascending history');
select is(pg_temp.release11()#>>'{snapshot,native_dispenses,0,pickup,recipient_name}','Original recipient','Client package does not rewrite original pickup');
reset role;
select is(jsonb_build_object('dispense',(select document from native_dispenses where id=(select id from fx where k='dispense')),'usage',native_rx_usage_context((select id from fx where k='sign')),'movements',(select jsonb_agg(to_jsonb(m) order by id) from inventory_movements m where lot_id=(select id from fx where k='lot')),'items',(select jsonb_agg(to_jsonb(i) order by id) from billing_invoice_items i where invoice_id=(select id from fx where k='invoice')),'invoice',(select to_jsonb(i) from billing_invoices i where id=(select id from fx where k='invoice'))),(select v from data where k='untouched'),'Corrections preserve original dispense, allowance, stock and invoice exactly');
select is((select count(*)::int from native_pickups where dispense_id=(select id from fx where k='dispense')),1,'Amendments never create second pickup');
select throws_ok($$update native_dispense_correction_events set record_hash=repeat('a',64)$$,'23514','Native correction history is immutable','Events immutable even privileged direct update');
select throws_ok($$truncate native_dispense_correction_operations$$,'23514','Native correction history is immutable','Operation truncation forbidden');
select ok(not has_table_privilege('authenticated','native_dispense_correction_events','insert'),'No authenticated direct append');
select ok(not has_table_privilege('service_role','native_dispense_correction_events','insert'),'No service direct append');
select ok(not has_function_privilege('service_role','native_correction_verified(uuid,uuid,uuid)','execute'),'Private verifier not worker-exposed');
select throws_ok($$select verify_release_source_original_v5('{"schema_version":11,"api_attachments":[],"attachments":[],"selection":{"api_attachment_ids":[]}}','{}',decode('00','hex'))$$,'23514','Original is not an exact selected package file','Schema11 preserves canonical original byte verification');
-- Request references are canonical, preventing successful but unrenderable mixed-case links.
set local role authenticated;
insert into data select 'uppercase-request',pg_temp.correction_request('operational_annotation')||jsonb_build_object('authorization_id','DEADBEEF-0000-4000-8000-000000000001'::text);
insert into fx values('uppercase-operation',gen_random_uuid());
select throws_ok($$select append_native_dispense_correction((select id from fx where k='uppercase-operation'),(select v from data where k='uppercase-request'))$$,'23514','Canonical lowercase correction identity required','Noncanonical JSON UUID rejected before successful append');
select is(recover_native_dispense_correction((select id from fx where k='uppercase-operation')),null::jsonb,'Rejected noncanonical request leaves no receipt');
reset role;
-- Synthetic corruption stays entirely inside the expected failing subtransaction.
-- Rehashing a forged predecessor cannot make the verified chain acceptable.
select throws_ok($probe$do $body$declare forged jsonb;begin
 alter table public.native_dispense_correction_events disable trigger native_correction_immutable;
 alter table public.native_dispense_correction_operations disable trigger native_correction_immutable;
 select jsonb_set(document-'record_hash','{prior_record_hash}',to_jsonb(repeat('f',64))) into forged from native_dispense_correction_events where id=(select id from fx where k='operational');
 forged:=forged||jsonb_build_object('record_hash',native_fulfillment_hash(forged));
 update native_dispense_correction_events set document=forged,record_hash=forged->>'record_hash' where id=(select id from fx where k='operational');
 update native_dispense_correction_operations set result=forged where id=(select id from fx where k='operational');
 alter table public.native_dispense_correction_events enable trigger native_correction_immutable;
 alter table public.native_dispense_correction_operations enable trigger native_correction_immutable;
 perform native_correction_verified((select id from fx where k='sign'),(select id from fx where k='pet'),(select id from fx where k='dispense'));
 end $body$;$probe$,'23514','Native correction integrity mismatch','Server rejects rehashed forged predecessor');
select ok((select bool_and(tgenabled='O') from pg_trigger where tgrelid in('native_dispense_correction_events'::regclass,'native_dispense_correction_operations'::regclass) and tgname='native_correction_immutable'),'Immutable guards restored after corruption probe');
set local role authenticated;
do $$declare i integer;begin
 for i in (pg_temp.correction_preview()#>>'{context,head,version}')::integer+1..100 loop
  perform append_native_dispense_correction(gen_random_uuid(),pg_temp.correction_request('operational_annotation'));
 end loop;
end $$;
select is(jsonb_array_length(pg_temp.release11()#>'{snapshot,native_dispenses,0,corrections,events}'),100,'Exactly100 events disclosed without truncation');
select is(jsonb_array_length(read_native_prescription_print_v2((select id from fx where k='sign'),(select id from fx where k='dispense'))#>'{dispense_corrections,events}'),100,'Print includes all100 events');
select append_native_dispense_correction(gen_random_uuid(),pg_temp.correction_request('operational_annotation'));
select throws_ok($$select pg_temp.release11()$$,'23514','More than100 correction events; use complete paginated history instead of this package','Schema11 fails closed at101 rather than omit notes');
select throws_ok($$select read_native_prescription_print_v2((select id from fx where k='sign'),(select id from fx where k='dispense'))$$,'23514',null,'Selected print fails closed at101');
select is(jsonb_array_length(list_native_dispense_corrections((select id from fx where k='sign'),(select id from fx where k='pet'),(select id from fx where k='dispense'),null,100)->'events'),100,'History remains available beyond package bound');
select is(list_native_dispense_corrections((select id from fx where k='sign'),(select id from fx where k='pet'),(select id from fx where k='dispense'),null,100)->>'next_before_version','2','History cursor reveals remaining101st event');
select is(read_native_prescription_print_v2((select id from fx where k='sign'),null)#>>'{correction_summary,event_count}','101','Order-only print honestly discloses aggregate without selecting fill history');
reset role;
select set_config('request.jwt.claims','{"sub":"a5510000-0000-4000-8000-000000000002","role":"authenticated"}',true);set local role authenticated;
select throws_ok($$select recover_native_dispense_correction((select id from fx where k='annotation'))$$,'42501','Correction receipt unavailable','Wrong actor cannot recover receipt');
select is(recover_native_dispense_correction(gen_random_uuid()),null::jsonb,'Absent UUID recovery explicit null');
reset role;select set_config('request.jwt.claims','{"sub":"a5510000-0000-4000-8000-000000000001","role":"authenticated"}',true);update profiles set is_active=false where id='a5510000-0000-4000-8000-000000000002';select set_config('request.jwt.claims','{"sub":"a5510000-0000-4000-8000-000000000002","role":"authenticated"}',true);set local role authenticated;
select throws_ok($$select pg_temp.correction_preview()$$,'42501',null,'Inactive staff denied');
select * from finish();rollback;
