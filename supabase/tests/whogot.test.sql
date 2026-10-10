begin;create extension if not exists pgtap with schema extensions;set local search_path=public,extensions;select no_plan();
-- FIXTURE_BEGIN
insert into auth.users(id,email,raw_user_meta_data) values
 ('a5510000-0000-4000-8000-000000000001','native-rx-dvm@example.test','{}'),
 ('a5510000-0000-4000-8000-000000000002','native-rx-staff@example.test','{}'),
 ('a5510000-0000-4000-8000-000000000003','native-rx-uncommissioned@example.test','{}'),
 ('a5510000-0000-4000-8000-000000000004','native-rx-admin@example.test','{}');
update public.profiles set is_active = true where id in ('a5510000-0000-4000-8000-000000000001','a5510000-0000-4000-8000-000000000002','a5510000-0000-4000-8000-000000000003','a5510000-0000-4000-8000-000000000004');
insert into public.user_roles (user_id, role) values ('a5510000-0000-4000-8000-000000000001','STAFF'),('a5510000-0000-4000-8000-000000000002','STAFF'),('a5510000-0000-4000-8000-000000000003','STAFF'),('a5510000-0000-4000-8000-000000000004','STAFF');

update profiles set full_name='Synthetic prescriber' where id='a5510000-0000-4000-8000-000000000001';
insert into user_roles(user_id,role) values('a5510000-0000-4000-8000-000000000001','DVM'),('a5510000-0000-4000-8000-000000000001','ADMIN'),('a5510000-0000-4000-8000-000000000003','DVM'),('a5510000-0000-4000-8000-000000000004','ADMIN');
create temp table fx(k text primary key,id uuid);create temp table data(k text primary key,v jsonb);grant all on fx,data to authenticated;
set local role authenticated;select set_config('request.jwt.claims','{"sub":"a5510000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into fx select 'client',id from save_client(auth.uid(),null,null,'Native','Household','+13035559015','fixture-9015@example.test','EMAIL','2619 Synthetic Street',null);
insert into fx select 'pet',id from save_patient(null,(select id from fx where k='client'),null,'Native Patient','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null);
insert into fx select 'product',id from save_catalog_product(null,null,'Synthetic medication','medication','','tablet',100,true);
insert into fx select k,gen_random_uuid() from unnest(array['config','save','draft','sign','save2','draft2']) k;
insert into data values('config-request',jsonb_build_object('user_id',auth.uid(),'expected_version',null,'attest_review',true,'fields',jsonb_build_object('active',true,'license_number','SYNTHETIC','license_state','CO','license_expires_on','2099-12-31','practice_name','Synthetic practice','practice_address','2619 Synthetic Street','practice_phone',null,'clinical_review_note','Synthetic fixture only')));
insert into data select 'fields',jsonb_build_object('encounter_id',null,'medication',jsonb_build_object('name','Synthetic medication','strength','Synthetic strength','form','Synthetic form','directions','Synthetic directions only','route','Synthetic route'),'quantity_per_fill','30','unit','tablet','refills_authorized',2,'fulfillment_mode','practice_stock','product_id',(select id from fx where k='product'),'starts_on',(now() at time zone 'America/Denver')::date,'expires_on','2099-12-31');
insert into data select 'save-request',jsonb_build_object('draft_id',(select id from fx where k='draft'),'pet_id',(select id from fx where k='pet'),'client_id',(select id from fx where k='client'),'expected_version',null,'fields',v) from data where k='fields';



insert into fx select k,gen_random_uuid() from unnest(array['invoice','dispense','dispense2','dispense3','close','close3','pickup','pickup2','refill','refill-create','refill-link']) k;
insert into fx values('lot1','b5510000-0000-4000-8000-000000000001'),('lot2','b5510000-0000-4000-8000-000000000002');
select configure_native_prescriber((select id from fx where k='config'),(select v from data where k='config-request'));
select save_native_prescription_draft((select id from fx where k='save'),(select v from data where k='save-request'));
insert into data select 'sign-request',jsonb_build_object('draft_id',(select id from fx where k='draft'),'pet_id',(select id from fx where k='pet'),'expected_version',1,'expected_context_hash',preview_native_prescription_sign((select id from fx where k='draft'),1)->>'context_hash','signature_name','Synthetic prescriber','attest_review',true);
insert into data select 'sign-receipt',sign_native_prescription((select id from fx where k='sign'),(select v from data where k='sign-request'));
select receive_inventory(gen_random_uuid(),(select id from fx where k='lot1'),(select id from fx where k='product'),'FULFILL-1',current_date+365,'Synthetic clinic',20,'Synthetic opening stock');
select receive_inventory(gen_random_uuid(),(select id from fx where k='lot2'),(select id from fx where k='product'),'FULFILL-2',current_date+365,'Synthetic clinic',100,'Synthetic opening stock');
select create_billing_invoice((select id from fx where k='invoice'),(select id from fx where k='client'));
select create_native_refill((select id from fx where k='refill-create'),jsonb_build_object('refill_id',(select id from fx where k='refill'),'pet_id',(select id from fx where k='pet'),'client_id',(select id from fx where k='client'),'medication_requested','Synthetic request','requester_note',null,'channel','phone','reason','Synthetic intake'));
select transition_native_refill((select id from fx where k='refill-link'),jsonb_build_object('refill_id',(select id from fx where k='refill'),'pet_id',(select id from fx where k='pet'),'expected_version',1,'action','link','reason','Exact order','assigned_to',null,'authorization_id',(select id from fx where k='sign'),'expected_link_context_hash',preview_native_refill_link((select id from fx where k='refill'),(select id from fx where k='pet'),(select id from fx where k='sign'))->>'context_hash'));
insert into data select 'target',jsonb_build_object('authorization_id',(select id from fx where k='sign'),'pet_id',(select id from fx where k='pet'),'slot_index',0,'expected_slot_version',null,'invoice_id',(select id from fx where k='invoice'),'quantity','10','allocations',jsonb_build_array(jsonb_build_object('lot_id',(select id from fx where k='lot1'),'quantity','4'),jsonb_build_object('lot_id',(select id from fx where k='lot2'),'quantity','6')),'refill',jsonb_build_object('id',(select id from fx where k='refill'),'expected_version',2));

select is(jsonb_array_length(search_whogot()->'rows'),0,'Signed prescription and service charges alone are not received care');
insert into fx select 'service',id from save_catalog_product(null,null,'Exam original','service','','visit',1000,true);
select add_invoice_service(gen_random_uuid(),(select id from fx where k='invoice'),(select id from fx where k='pet'),(select id from fx where k='service'),1);
select is(jsonb_array_length(search_whogot(p_event_type=>'performed')->'rows'),0,'Billing service alone does not count as performed');
insert into fx select 'encounter',id from save_clinical_encounter(null,(select id from fx where k='pet'),null,now()-interval '1 day','clinic','','','','Assessment','Plan');
insert into fx select 'other',id from save_patient(null,(select id from fx where k='client'),null,'Other cat','Cat',null,null,'unknown',null,'unknown','unknown',null,null,null);
insert into fx select 'other_encounter',id from save_clinical_encounter(null,(select id from fx where k='other'),null,now()-interval '1 day','clinic','','','','Assessment','Plan');
insert into fx select k,gen_random_uuid() from unnest(array['service_event','service_event2','service_correction']) k;
insert into data select 'service_request',jsonb_build_object('pet_id',(select id from fx where k='pet'),'encounter_id',(select id from fx where k='encounter'),'product_id',(select id from fx where k='service'),'clinician_id',auth.uid(),'performed_at',now()-interval '1 hour','notes','Completed exam','invoice_id',null);
select lives_ok($$select record_patient_service((select id from fx where k='service_event'),(select v from data where k='service_request'))$$,'Explicit service is recorded');
select lives_ok($$select record_patient_service((select id from fx where k='service_event'),(select v from data where k='service_request'))$$,'Lost response retry returns same service');
select is((select count(*) from patient_service_events),1::bigint,'Retry adds no duplicate');
select is((select count(*) from billing_invoice_items),1::bigint,'Recording service creates no charge');
select throws_ok($$select record_patient_service((select id from fx where k='service_event'),(select v||'{"notes":"changed"}' from data where k='service_request'))$$,'23505',null,'Event UUID cannot change request');
select throws_ok($$select record_patient_service(gen_random_uuid(),(select jsonb_set(v,'{encounter_id}',to_jsonb((select id from fx where k='other_encounter'))) from data where k='service_request'))$$,'23514',null,'Wrong-patient encounter denied');
select throws_ok($$select record_patient_service(gen_random_uuid(),(select jsonb_set(v,'{product_id}',to_jsonb((select id from fx where k='product'))) from data where k='service_request'))$$,'23514',null,'Medication cannot be a service');
select throws_ok($$select record_patient_service(gen_random_uuid(),(select v||jsonb_build_object('performed_at',now()+interval '1 day') from data where k='service_request'))$$,'23514',null,'Future performance denied');
select throws_ok($$select record_patient_service(gen_random_uuid(),(select v||jsonb_build_object('performed_at',now()-interval '2 days') from data where k='service_request'))$$,'23514',null,'Performance before encounter denied');
select is(search_whogot(p_product_id=>(select id from fx where k='service'))#>>'{rows,0,product_name}','Exam original','Stable catalog service identity returned');
select is(jsonb_array_length(search_whogot(p_species=>'Cat')->'rows'),0,'Species applied on server');
select is(jsonb_array_length(search_whogot(p_clinician=>'Synthetic prescriber')->'rows'),1,'Clinician snapshot filtered');
select save_catalog_product((select id from fx where k='service'),1,'Exam renamed','service','','visit',1000,false);
select is(search_whogot_products('Exam original')#>>'{0,id}',(select id from fx where k='service')::text,'Old snapshot name resolves exact stable product');
select is(search_whogot(p_product_id=>(select id from fx where k='service'))#>>'{rows,0,product_name}','Exam original','Historical event name survives rename and inactive catalog');
select throws_ok($$select record_patient_service(gen_random_uuid(),(select v from data where k='service_request'))$$,'23514',null,'Inactive service cannot record new performance');
select save_catalog_product((select id from fx where k='service'),2,'Exam renamed','service','','visit',1000,true);
select record_patient_service((select id from fx where k='service_event2'),(select v from data where k='service_request'));
insert into data select 'page1',search_whogot(p_limit=>1);
select is(jsonb_array_length((select v->'rows' from data where k='page1')),1,'Bounded first page');
select ok((select v->'next'<>'null'::jsonb from data where k='page1'),'Tied event timestamp has stable keyset cursor');
insert into data select 'page2',search_whogot(p_before=>(select v->'next' from data where k='page1'),p_as_of=>(select (v->>'as_of')::timestamptz from data where k='page1'),p_limit=>1);
select isnt((select v#>>'{rows,0,id}' from data where k='page1'),(select v#>>'{rows,0,id}' from data where k='page2'),'No duplicate when timestamps tie');
select is((select v->'next' from data where k='page2'),'null'::jsonb,'No omitted final event');
select throws_ok($$select search_whogot(p_before=>(select v->'next' from data where k='page1'))$$,'23514',null,'Cursor requires original snapshot');
select lives_ok($$select correct_patient_service((select id from fx where k='service_correction'),(select id from fx where k='pet'),(select id from fx where k='service_event'),'Entered in error',(select id from fx where k='service_event2'))$$,'Explicit attributed correction');
select lives_ok($$select correct_patient_service((select id from fx where k='service_correction'),(select id from fx where k='pet'),(select id from fx where k='service_event'),'Entered in error',(select id from fx where k='service_event2'))$$,'Correction replay creates no duplicate');
select is(jsonb_array_length(search_whogot(p_event_type=>'performed')->'rows'),1,'Corrected original excluded by default');
select is(jsonb_array_length(search_whogot(p_event_type=>'performed',p_include_corrected=>true)->'rows'),2,'Audit filter shows original and replacement');
select is(jsonb_array_length(search_whogot(p_as_of=>(select (v->>'as_of')::timestamptz from data where k='page1'))->'rows'),2,'Earlier search remains as-of correction history');
select is(jsonb_array_length(list_patient_services((select id from fx where k='pet'))),2,'Patient history retains original and correction');
select is(read_whogot_source((select id from fx where k='other'),'performed',(select id from fx where k='service_event')),null::jsonb,'Source access checks exact patient');
select is(read_whogot_source((select id from fx where k='pet'),'performed',(select id from fx where k='service_event'))#>>'{corrections,0,reason}','Entered in error','Direct source exposes current correction');
select throws_ok($$insert into patient_service_events(id) values(gen_random_uuid())$$,'42501',null,'Staff cannot bypass service write boundary');
select throws_ok($$delete from patient_service_events$$,'42501',null,'Service history cannot be erased by staff');
select throws_ok($$select correct_patient_service(gen_random_uuid(),(select id from fx where k='other'),(select id from fx where k='service_event2'),'wrong pet',null)$$,'23514',null,'Cross-patient correction refused');
-- Actual native dispensing is one event even with two lots.
insert into data select 'dispense_request',v||jsonb_build_object('expected_context_hash',preview_native_dispense(v)->>'context_hash','reason','Whogot synthetic dispensing','attest_alert_review',true,'attest_dispense_review',true) from data where k='target';
select record_native_dispense((select id from fx where k='dispense'),(select v from data where k='dispense_request'));
select is(jsonb_array_length(search_whogot(p_event_type=>'dispensed')->'rows'),1,'Two-lot dispensing appears once');
select is(jsonb_array_length(search_whogot(p_lot=>'FULFILL-1')->'rows'),1,'First allocated lot finds dispensing');
select is(jsonb_array_length(search_whogot(p_lot=>'FULFILL-2')->'rows'),1,'Second allocated lot finds same dispensing');
select is(jsonb_array_length(search_whogot(p_lot=>'FULFILL')->'rows'),0,'Lot search is exact');
select is(jsonb_array_length(search_whogot(p_event_type=>'administered')->'rows'),0,'Dispensing does not imply administration');
select is(read_whogot_source((select id from fx where k='pet'),'dispensed',(select id from fx where k='dispense'))#>>'{record,id}',(select id from fx where k='dispense')::text,'Direct dispense source uses verified original');
-- A dispensing annotation does not cancel the physical event.
select append_native_dispense_correction(gen_random_uuid(),jsonb_build_object('authorization_id',(select id from fx where k='sign'),'pet_id',(select id from fx where k='pet'),'dispense_id',(select id from fx where k='dispense'),'kind','operational_annotation','expected_context_hash',v->>'context_hash','expected_head',v#>'{context,head}','reason','Reviewed operational note','note','No change to physical dispensing','amends_event_id',null,'pickup_amendment',null,'attest_review',true))
 from(select preview_native_dispense_correction((select id from fx where k='sign'),(select id from fx where k='pet'),(select id from fx where k='dispense')) v) c;
select is(search_whogot(p_event_type=>'dispensed')#>>'{rows,0,correction_status}','annotated','Annotated dispensing still qualifies with explicit status');
select is(read_whogot_source((select id from fx where k='pet'),'dispensed',(select id from fx where k='dispense'))#>>'{corrections,0,document,note}','No change to physical dispensing','Dispense source retains annotation text');
-- An unlinked historical administration is never guessed into the selected product.
insert into data select 'historical_request',jsonb_build_object('pet_id',(select id from fx where k='pet'),'historical',true,'kind','vaccine','product_name','Unknown outside rabies','manufacturer','','lot_number','OUTSIDE','expires_on',null,'quantity',1,'dose','1 mL','route','SC','site','','veterinarian','Outside DVM','veterinarian_license','','administered_at',now()-interval '2 days','next_due_on',null,'source','Owner supplied vaccination record');
insert into fx select 'historical',gen_random_uuid();
select record_patient_treatment((select id from fx where k='historical'),(select v from data where k='historical_request'));
select is(jsonb_array_length(search_whogot(p_event_type=>'administered')->'rows'),0,'Historical evidence opt-in');
select is(jsonb_array_length(search_whogot(p_event_type=>'administered',p_include_historical=>true)->'rows'),1,'Historical entry included and labelled');
select is(jsonb_array_length(search_whogot(p_product_id=>(select id from fx where k='product'),p_event_type=>'administered',p_include_historical=>true)->'rows'),0,'Unknown historical product not assigned by name');
select correct_patient_treatment(gen_random_uuid(),(select id from fx where k='historical'),'Outside entry withdrawn',null);
select is(jsonb_array_length(search_whogot(p_event_type=>'administered',p_include_historical=>true)->'rows'),0,'Voided historical administration excluded');
select is(jsonb_array_length(search_whogot(p_event_type=>'administered',p_include_historical=>true,p_include_corrected=>true)->'rows'),1,'Historical correction visible under audit filter');
select throws_ok($$select search_whogot(p_from=>'2026-02-02',p_to=>'2026-02-01')$$,'23514',null,'Reversed dates refused');
select throws_ok($$select search_whogot(p_from=>'infinity')$$,'23514',null,'Infinite date refused');
select throws_ok($$select search_whogot(p_limit=>201)$$,'23514',null,'Unbounded query refused');
select throws_ok($$select search_whogot(p_event_type=>'prescribed')$$,'23514',null,'Prescribing is not a received-care event');
select is(jsonb_array_length(search_whogot(p_from=>current_date+1)->'rows'),0,'Date filtering is applied by server');
-- Denver spring-forward day is 23 hours; both calendar boundaries are exact.
select record_patient_treatment(gen_random_uuid(),(select v||jsonb_build_object('administered_at',stamp) from data where k='historical_request'))
 from unnest(array['2026-03-08T06:59:59Z','2026-03-08T07:00:00Z','2026-03-09T05:59:59Z','2026-03-09T06:00:00Z']) stamp;
select is(jsonb_array_length(search_whogot(p_event_type=>'administered',p_include_historical=>true,p_from=>'2026-03-08',p_to=>'2026-03-08')->'rows'),2,'Inclusive Denver date crosses spring-forward with exact boundaries');
select is(jsonb_array_length(search_whogot(p_event_type=>'administered',p_include_historical=>true,p_from=>'2026-03-07',p_to=>'2026-03-07')->'rows'),1,'Prior local day excludes boundary event');
-- Active staff share practice evidence; no client profile gains staff authority.
select set_config('request.jwt.claims','{"sub":"a5510000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select lives_ok($$select search_whogot()$$,'Another active staff member can search practice evidence');
select throws_ok($$select record_patient_service((select id from fx where k='service_event2'),(select v from data where k='service_request'))$$,'23505',null,'Actor-scoped service retry refuses another staff identity');
reset role;select set_config('request.jwt.claims','{"sub":"a5510000-0000-4000-8000-000000000001","role":"authenticated"}',true);update profiles set is_active=false where id='a5510000-0000-4000-8000-000000000002';set local role authenticated;select set_config('request.jwt.claims','{"sub":"a5510000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select search_whogot()$$,'42501',null,'Inactive staff denied');
select throws_ok($$select list_patient_services((select id from fx where k='pet'))$$,'42501',null,'Inactive staff cannot read services');
select is((select count(*) from patient_service_events),0::bigint,'Service RLS denies inactive staff');
set local role anon;
select throws_ok($$select search_whogot()$$,'42501',null,'Anonymous search denied');
select throws_ok($$select read_whogot_source(null,'performed',null)$$,'42501',null,'Anonymous source denied');
reset role;
select ok(exists(select 1 from audit_logs where table_name='patient_service_events'),'Service creation is audited');
select ok(exists(select 1 from audit_logs where table_name='patient_service_corrections'),'Correction is audited');
select throws_ok($$update patient_service_events set notes='rewrite'$$,'23514',null,'Privileged updates cannot erase service history');
select * from finish();rollback;
