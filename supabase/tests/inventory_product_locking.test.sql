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
insert into fx select 'client',id from save_client(auth.uid(),null,null,'Native','Household',null,null,'EMAIL','2619 Synthetic Street',null);
insert into fx select 'pet',id from save_patient(null,(select id from fx where k='client'),null,'Native Patient','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null);
insert into fx select 'product',id from save_catalog_product(null,null,'Synthetic medication','medication','','tablet',100,true);
insert into fx select k,gen_random_uuid() from unnest(array['config','save','draft','sign','save2','draft2']) k;
insert into data values('config-request',jsonb_build_object('user_id',auth.uid(),'expected_version',null,'attest_review',true,'fields',jsonb_build_object('active',true,'license_number','SYNTHETIC','license_state','CO','license_expires_on','2099-12-31','practice_name','Synthetic practice','practice_address','2619 Synthetic Street','practice_phone',null,'clinical_review_note','Synthetic fixture only')));
insert into data select 'fields',jsonb_build_object('encounter_id',null,'medication',jsonb_build_object('name','Synthetic medication','strength','Synthetic strength','form','Synthetic form','directions','Synthetic directions only','route','Synthetic route'),'quantity_per_fill','30','unit','tablet','refills_authorized',2,'fulfillment_mode','practice_stock','product_id',(select id from fx where k='product'),'starts_on',(now() at time zone 'America/Denver')::date,'expires_on','2099-12-31');
insert into data select 'save-request',jsonb_build_object('draft_id',(select id from fx where k='draft'),'pet_id',(select id from fx where k='pet'),'client_id',(select id from fx where k='client'),'expected_version',null,'fields',v) from data where k='fields';
-- FIXTURE_END

insert into fx select k,gen_random_uuid() from unnest(array['lot','receive','invoice','treatment','adjust']) k;
select receive_inventory((select id from fx where k='receive'),(select id from fx where k='lot'),(select id from fx where k='product'),'TEST-LOCK',current_date+365,'Synthetic clinic',10,'Synthetic opening stock');
select create_billing_invoice((select id from fx where k='invoice'),(select id from fx where k='client'));
insert into data select 'treatment-request',jsonb_build_object('pet_id',(select id from fx where k='pet'),'lot_id',(select id from fx where k='lot'),'invoice_id',(select id from fx where k='invoice'),'quantity',1,'dose','Synthetic dose','route','Synthetic route','site','','veterinarian','Synthetic prescriber','veterinarian_license','TEST','administered_at',clock_timestamp(),'next_due_on',null,'alert_review',jsonb_build_object('source_hash',read_patient_treatment_alerts((select id from fx where k='pet'))->>'source_hash','acknowledged',true));
insert into data select 'treatment-result',to_jsonb(record_patient_treatment((select id from fx where k='treatment'),(select v from data where k='treatment-request')));
select is((select sum(quantity) from inventory_movements where lot_id=(select id from fx where k='lot')),9::numeric,'Treatment debits exactly once under reordered locks');
select is((select count(*) from billing_invoice_items where invoice_id=(select id from fx where k='invoice')),1::bigint,'Treatment charges once');
select is((select count(*) from treatment_alert_reviews where treatment_id=(select id from fx where k='treatment')),1::bigint,'Exact clinical alert history retained');
select is((select version from billing_invoices where id=(select id from fx where k='invoice')),2,'Treatment advances invoice exactly once');
select save_catalog_product((select id from fx where k='product'),1,'Synthetic medication','medication','','tablet',200,false);
select is(to_jsonb(record_patient_treatment((select id from fx where k='treatment'),(select v from data where k='treatment-request'))),(select v from data where k='treatment-result'),'Committed treatment exact retry survives later product deactivation');
select lives_ok($$select receive_inventory((select id from fx where k='receive'),(select id from fx where k='lot'),(select id from fx where k='product'),'TEST-LOCK',current_date+365,'Synthetic clinic',10,'Synthetic opening stock')$$,'Committed receive retry survives later deactivation');
select lives_ok($$select adjust_inventory((select id from fx where k='adjust'),(select id from fx where k='lot'),-1,'Synthetic inactive-product adjustment')$$,'Inactive stock adjustment remains supported');
select lives_ok($$select adjust_inventory((select id from fx where k='adjust'),(select id from fx where k='lot'),-1,'Synthetic inactive-product adjustment')$$,'Adjustment exact retry preserved');
select is((select sum(quantity) from inventory_movements where lot_id=(select id from fx where k='lot')),8::numeric,'Retries add no extra movements');
select throws_ok($$select record_patient_treatment(gen_random_uuid(),(select v from data where k='treatment-request'))$$,'23514','Product is inactive','New treatment refuses inactive product');
select throws_ok($$select record_patient_treatment((select id from fx where k='treatment'),(select v||'{"quantity":2}' from data where k='treatment-request'))$$,'23514','Treatment identifier already used','Same treatment UUID payload cannot change');
select save_catalog_product((select id from fx where k='product'),2,'Synthetic medication','medication','','tablet',200,true);
select save_patient_problem(null,(select id from fx where k='pet'),null,'Synthetic important alert','Synthetic review change',null,'active','high');
select throws_ok($$select record_patient_treatment(gen_random_uuid(),(select v from data where k='treatment-request'))$$,'40001','Patient alerts changed; reload and review the current alerts before recording treatment','Patient alert protection unchanged');
select is(to_jsonb(record_patient_treatment((select id from fx where k='treatment'),(select v from data where k='treatment-request'))),(select v from data where k='treatment-result'),'Exact historical retry remains before current alert validation');
select is((select count(*) from patient_treatments where pet_id=(select id from fx where k='pet')),1::bigint,'Rejected new writes leave no treatment');
reset role;
select ok(not has_function_privilege('service_role','record_patient_treatment(uuid,jsonb)','execute'),'No new service-role authority');
select ok(not has_function_privilege('anon','receive_inventory(uuid,uuid,uuid,text,date,text,numeric,text)','execute'),'Anonymous authority unchanged');
select * from finish();rollback;
