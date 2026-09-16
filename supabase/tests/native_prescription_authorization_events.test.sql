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

insert into data select 'config-receipt',configure_native_prescriber((select id from fx where k='config'),(select v from data where k='config-request'));
select save_native_prescription_draft((select id from fx where k='save'),(select v from data where k='save-request'));
insert into data select 'sign-request',jsonb_build_object('draft_id',(select id from fx where k='draft'),'pet_id',(select id from fx where k='pet'),'expected_version',1,'expected_context_hash',preview_native_prescription_sign((select id from fx where k='draft'),1)->>'context_hash','signature_name','Synthetic prescriber','attest_review',true);
-- Same SQL statement must never stamp current status before signing.
do $$declare r jsonb;p jsonb;begin
 r:=sign_native_prescription((select id from fx where k='sign'),(select v from data where k='sign-request'));
 insert into data values('sign-receipt',r);
 p:=read_native_prescription_print((select id from fx where k='sign'));
 insert into data values('same-statement-print',p);
end $$;
select ok((select (v#>>'{status,checked_at}')::timestamptz >= (v#>>'{prescription,signed_at}')::timestamptz from data where k='same-statement-print'),'Print observation occurs after same-statement signature');
select is(sign_native_prescription((select id from fx where k='sign'),(select v from data where k='sign-request')),(select v from data where k='sign-receipt'),'Initial signing exact retry preserved');
select is(read_native_prescription_print((select id from fx where k='sign'))->'prescription',(select v#>'{result,artifact}' from data where k='sign-receipt'),'Print uses exact immutable artifact');
select is(read_native_prescription_status((select id from fx where k='sign'),(select id from fx where k='pet'))#>>'{status,state}','active','Initial status active');
select is(read_native_prescription_status((select id from fx where k='sign'),gen_random_uuid()),null::jsonb,'Wrong patient status absent');
select is(read_native_prescription_status((select id from fx where k='sign'),(select id from fx where k='pet'))->'usage','{"version":1,"native_fill_accounting":"not_implemented","dispensed_quantity":null,"used_fill_slots":null,"remaining_quantity":null,"external_fulfillment":"unknown"}'::jsonb,'Unknown usage remains explicit and never zero');
select throws_ok($$select read_native_prescription_print((select id from fx where k='sign'),gen_random_uuid())$$,'23514','Native dispensing is not implemented','No fabricated dispense print');
insert into fx values('cancel',gen_random_uuid()),('replace',gen_random_uuid()),('external-draft',gen_random_uuid()),('external-sign',gen_random_uuid());
insert into data select 'cancel-request',jsonb_build_object('authorization_id',(select id from fx where k='sign'),'pet_id',(select id from fx where k='pet'),'expected_event_id',null,'expected_context_hash',preview_native_prescription_cancel((select id from fx where k='sign'),(select id from fx where k='pet'))->>'context_hash','reason','Synthetic cancellation','attest_review',true);
select set_config('request.jwt.claims','{"sub":"a5510000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select cancel_native_prescription((select id from fx where k='cancel'),(select v from data where k='cancel-request'))$$,'42501','Configured veterinarian required','Staff cannot cancel');
select set_config('request.jwt.claims','{"sub":"a5510000-0000-4000-8000-000000000001","role":"authenticated"}',true);
reset role;update pets set archived_at=clock_timestamp(),deceased_at=current_date where id=(select id from fx where k='pet');set local role authenticated;
select throws_ok($$select cancel_native_prescription((select id from fx where k='cancel'),(select v from data where k='cancel-request'))$$,'40001','Authorization change context changed','Patient drift invalidates review');
select is(recover_native_prescription_operation((select id from fx where k='cancel')),null::jsonb,'Failed cancellation leaves no receipt');
update data set v=jsonb_set(v,'{expected_context_hash}',preview_native_prescription_cancel((select id from fx where k='sign'),(select id from fx where k='pet'))->'context_hash') where k='cancel-request';
insert into data select 'cancel-receipt',cancel_native_prescription((select id from fx where k='cancel'),(select v from data where k='cancel-request'));
select is(read_native_prescription_status((select id from fx where k='sign'),(select id from fx where k='pet'))#>>'{status,state}','cancelled','Historical deceased archived patient can be cancelled');
select is(cancel_native_prescription((select id from fx where k='cancel'),(select v from data where k='cancel-request')),(select v from data where k='cancel-receipt'),'Cancellation exact retry');
select is(recover_native_prescription_operation((select id from fx where k='cancel')),(select v from data where k='cancel-receipt'),'Cancellation exact recovery');
select throws_ok($$select cancel_native_prescription((select id from fx where k='cancel'),(select v||'{"reason":"Changed reason"}' from data where k='cancel-request'))$$,'23514','Prescription operation identity cannot change','Cancellation UUID cannot substitute reason');
select is(read_native_prescription_print((select id from fx where k='sign'))->'prescription',(select v#>'{result,artifact}' from data where k='sign-receipt'),'Cancellation preserves original signed artifact');
insert into data select 'terminal-request',v||jsonb_build_object('expected_event_id',(select id from fx where k='cancel'),'expected_context_hash',preview_native_prescription_cancel((select id from fx where k='sign'),(select id from fx where k='pet'))->>'context_hash') from data where k='cancel-request';
select throws_ok($$select cancel_native_prescription(gen_random_uuid(),(select v from data where k='terminal-request'))$$,'23514','Authorization already has a terminal event','Cancellation cannot reopen terminal authorization');
select is(jsonb_array_length(list_native_prescription_events((select id from fx where k='sign'),(select id from fx where k='pet'))->'events'),1,'History retains cancellation');
select is(jsonb_array_length(list_native_prescription_events((select id from fx where k='sign'),(select id from fx where k='pet'),(select (v#>>'{result,created_at}')::timestamptz from data where k='cancel-receipt'),(select id from fx where k='cancel'),1)->'events'),0,'History keyset excludes cursor event');
select throws_ok($$select list_native_prescription_events((select id from fx where k='sign'),(select id from fx where k='pet'),now(),null)$$,'23514','Invalid authorization history cursor','Half history cursor denied');
select throws_ok($$select list_native_prescription_events((select id from fx where k='sign'),gen_random_uuid())$$,'23514','Exact native authorization patient required','Wrong patient history denied');
reset role;update pets set archived_at=null,deceased_at=null where id=(select id from fx where k='pet');set local role authenticated;
-- Prior external authorization requires explicit attributed reconciliation.
select save_native_prescription_draft(gen_random_uuid(),(select jsonb_set(jsonb_set(v||jsonb_build_object('draft_id',(select id from fx where k='external-draft')),'{fields,fulfillment_mode}','"external_pharmacy"'),'{fields,product_id}','null') from data where k='save-request'));
insert into data select 'external-sign-request',jsonb_build_object('draft_id',(select id from fx where k='external-draft'),'pet_id',(select id from fx where k='pet'),'expected_version',1,'expected_context_hash',preview_native_prescription_sign((select id from fx where k='external-draft'),1)->>'context_hash','signature_name','Synthetic prescriber','attest_review',true);
insert into data select 'external-receipt',sign_native_prescription((select id from fx where k='external-sign'),(select v from data where k='external-sign-request'));
select save_native_prescription_draft((select id from fx where k='save2'),(select v||jsonb_build_object('draft_id',(select id from fx where k='draft2')) from data where k='save-request'));
insert into data select 'replace-request',jsonb_build_object('authorization_id',(select id from fx where k='external-sign'),'pet_id',(select id from fx where k='pet'),'expected_event_id',null,'expected_context_hash',preview_native_prescription_replacement((select id from fx where k='external-sign'),(select id from fx where k='pet'),(select id from fx where k='draft2'),1)->>'context_hash','reason','Synthetic replacement','attest_review',true,'draft_id',(select id from fx where k='draft2'),'expected_version',1,'signature_name','Synthetic prescriber','reconciliation',jsonb_build_object('native_use_note','Native accounting not implemented; reviewed manually','external_use_status','unknown','external_use_note','External use unknown','remaining_allowance_note','Allowance reviewed manually','attest_review',true));
select throws_ok($$select replace_native_prescription((select id from fx where k='replace'),(select v from data where k='replace-request'))$$,'23514','Unknown external fulfillment must be reconciled before replacement','Unknown external fulfillment blocks replacement');
select is(recover_native_prescription_operation((select id from fx where k='replace')),null::jsonb,'Failed replacement leaves no receipt');
select is(read_native_prescription_draft((select id from fx where k='draft2'),(select id from fx where k='pet'))->>'status','draft','Failed replacement leaves new draft unsigned');
select is(read_native_prescription_status((select id from fx where k='external-sign'),(select id from fx where k='pet'))#>>'{status,state}','active','Failed replacement leaves prior active');
update data set v=jsonb_set(jsonb_set(v,'{reconciliation,external_use_status}','"reconciled"'),'{reconciliation,external_use_note}','"Manual veterinarian reconciliation; no server verification"') where k='replace-request';
insert into data select 'replace-receipt',replace_native_prescription((select id from fx where k='replace'),(select v from data where k='replace-request'));
select is(read_native_prescription_status((select id from fx where k='external-sign'),(select id from fx where k='pet'))#>>'{status,state}','replaced','Atomic replacement retires prior');
select is(read_native_prescription_status((select id from fx where k='replace'),(select id from fx where k='pet'))#>>'{status,state}','active','Atomic replacement signs fresh authorization');
select is((select v#>>'{result,event,replacement_id}' from data where k='replace-receipt'),(select id::text from fx where k='replace'),'Replacement is one outer operation identity');
select is((select v#>>'{result,event,reviewed_context,prior,usage,external_fulfillment}' from data where k='replace-receipt'),'unknown','Manual reconciliation never upgrades observed external fact');
select is(read_native_prescription_print((select id from fx where k='external-sign'))->'prescription',(select v#>'{result,artifact}' from data where k='external-receipt'),'Replacement preserves prior artifact');
select is(read_native_prescription_print((select id from fx where k='replace'))->'prescription',(select v#>'{result,authorization,artifact}' from data where k='replace-receipt'),'Replacement print uses new frozen artifact');
select is(replace_native_prescription((select id from fx where k='replace'),(select v from data where k='replace-request')),(select v from data where k='replace-receipt'),'Replacement exact retry after draft signed and old head changed');
select is(recover_native_prescription_operation((select id from fx where k='replace')),(select v from data where k='replace-receipt'),'Replacement UUID recovery');
select throws_ok($$select sign_native_prescription((select id from fx where k='replace'),(select v from data where k='external-sign-request'))$$,'23514','Prescription operation identity cannot change','Replacement UUID cannot masquerade as child signature');
select throws_ok($$select replace_native_prescription(gen_random_uuid(),(select v from data where k='replace-request'))$$,'40001','Prescription draft changed','Different operation cannot adopt already signed draft');
select configure_native_prescriber(gen_random_uuid(),(select jsonb_set(v||'{"expected_version":1}','{fields,active}','false') from data where k='config-request'));
select is(replace_native_prescription((select id from fx where k='replace'),(select v from data where k='replace-request')),(select v from data where k='replace-receipt'),'Historical replacement recovery survives decommissioning');
select throws_ok($$select preview_native_prescription_cancel((select id from fx where k='replace'),(select id from fx where k='pet'))$$,'42501','Current native prescriber commissioning required','New cancellation requires current commissioning');
select throws_ok($$select * from native_prescription_authorization_events$$,'42501',null,'Raw event ledger denied');
reset role;
select is((select count(*) from native_prescription_operations where id=(select id from fx where k='replace') and operation='replace'),1::bigint,'One replacement receipt and no child receipt');
select is((select count(*) from native_prescription_authorizations where pet_id=(select id from fx where k='pet')),3::bigint,'Exactly three fixture authorizations');
select is((select count(*) from native_prescription_authorization_events where pet_id=(select id from fx where k='pet')),2::bigint,'Exactly two terminal events');
select throws_ok($$update native_prescription_authorization_events set reason='Mutated' where pet_id=(select id from fx where k='pet')$$,'23514',null,'Privileged history rewrite denied');
select is((select count(*) from inventory_movements where created_by='a5510000-0000-4000-8000-000000000001'),0::bigint,'Changes create no stock movement');
select is((select count(*) from billing_invoice_items where created_by='a5510000-0000-4000-8000-000000000001'),0::bigint,'Changes create no charge');
select is((select count(*) from patient_treatments where pet_id=(select id from fx where k='pet')),0::bigint,'Changes fabricate no administration');
select ok(not has_function_privilege('authenticated','native_rx_materialize_authorization(uuid,jsonb)','execute'),'Private materializer inaccessible');
select ok(not has_function_privilege('service_role','replace_native_prescription(uuid,jsonb)','execute'),'Worker cannot replace');
select ok(not has_function_privilege('anon','cancel_native_prescription(uuid,jsonb)','execute'),'Anonymous cannot cancel');
select * from finish();rollback;
