-- Fixed one-product genuine era188 recipe. No opening or controlled event.
begin;
set local timezone='UTC';
set local search_path=public,pg_temp;
do $identity$ begin
 if session_user<>'postgres' or current_user<>'postgres' or current_setting('role')<>'none'
 or current_setting('session_replication_role')<>'origin' or auth.uid() is not null
 or auth.role() is not null or auth.email() is not null
 or nullif(current_setting('request.jwt.claims',true),'') is not null
 or nullif(current_setting('request.jwt.claim.sub',true),'') is not null
 or nullif(current_setting('request.jwt.claim.role',true),'') is not null
 or nullif(current_setting('request.jwt.claim.email',true),'') is not null then
 raise exception 'Fixed188 initial session identity differs' using errcode='23514';end if;
 if to_regclass('public.stock_pickup_sources') is not null or to_regclass('public.stock_correction_sources') is not null
 or to_regclass('public.stock_movement_sources') is null or to_regclass('public.stock_custody_sources') is null
 or to_regclass('public.stock_discrepancy_sources') is null or to_regclass('public.controlled_stock_openings') is not null then
 raise exception 'Fixed188 exact source era required' using errcode='23514';end if;
end $identity$;
insert into auth.users(id,email,raw_user_meta_data) values
 ('a2180000-0000-4000-8000-000000000001','fixed188-synthetic@example.test','{}');
update public.profiles set is_active=true,full_name='Synthetic fixed188 prescriber'
 where id='a2180000-0000-4000-8000-000000000001';
insert into public.user_roles(user_id,role) values
 ('a2180000-0000-4000-8000-000000000001','STAFF'),
 ('a2180000-0000-4000-8000-000000000001','DVM'),
 ('a2180000-0000-4000-8000-000000000001','ADMIN');
create temp table fixed188_ids(k text primary key,id uuid not null unique);
create temp table fixed188_data(k text primary key,v jsonb not null);
grant select,insert,update on fixed188_ids,fixed188_data to authenticated;
insert into fixed188_ids values
 ('actor','a2180000-0000-4000-8000-000000000001'),
 ('config','a2180000-0000-4000-8000-000000000002'),
 ('draft','a2180000-0000-4000-8000-000000000003'),
 ('save','a2180000-0000-4000-8000-000000000004'),
 ('sign','a2180000-0000-4000-8000-000000000005'),
 ('invoice','a2180000-0000-4000-8000-000000000006'),
 ('dispense','a2180000-0000-4000-8000-000000000007'),
 ('correction','a2180000-0000-4000-8000-000000000008'),
 ('receive1','a2180000-0000-4000-8000-000000000009'),
 ('receive2','a2180000-0000-4000-8000-00000000000a'),
 ('lot1','b2180000-0000-4000-8000-000000000001'),
 ('lot2','b2180000-0000-4000-8000-000000000002');
create function pg_temp.fixed188_id(key text) returns uuid language sql stable as
 $$select id from pg_temp.fixed188_ids where k=key$$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a2180000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $identity$ begin
 if session_user<>'postgres' or current_user<>'authenticated' or current_setting('role')<>'authenticated'
 or current_setting('session_replication_role')<>'origin'
 or auth.uid() is distinct from 'a2180000-0000-4000-8000-000000000001'::uuid
 or auth.role() is distinct from 'authenticated' or auth.email() is not null
 or current_setting('request.jwt.claims')::jsonb is distinct from '{"sub":"a2180000-0000-4000-8000-000000000001","role":"authenticated"}'::jsonb
 or nullif(current_setting('request.jwt.claim.sub',true),'') is not null
 or nullif(current_setting('request.jwt.claim.role',true),'') is not null
 or nullif(current_setting('request.jwt.claim.email',true),'') is not null then
 raise exception 'Fixed188 authenticated writer identity differs' using errcode='23514';end if;
end $identity$;
insert into fixed188_ids select 'client',id from save_client(auth.uid(),null,null,'Fixed188','Synthetic','+13035559188','fixed188-client@example.test','EMAIL','Synthetic local fixture',null);
insert into fixed188_ids select 'pet',id from save_patient(null,pg_temp.fixed188_id('client'),null,'Fixed188 Synthetic Patient','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null);
insert into fixed188_ids select 'product',id from save_catalog_product(null,null,'Fixed188 synthetic medication','medication','','tablet',100,true);
select configure_native_prescriber(pg_temp.fixed188_id('config'),jsonb_build_object('user_id',auth.uid(),'expected_version',null,'attest_review',true,'fields',
 jsonb_build_object('active',true,'license_number','SYNTHETIC','license_state','CO','license_expires_on','2099-12-31',
 'practice_name','Synthetic fixture only','practice_address','Synthetic local fixture','practice_phone',null,'clinical_review_note','Synthetic engineering fixture only')));
select save_native_prescription_draft(pg_temp.fixed188_id('save'),jsonb_build_object('draft_id',pg_temp.fixed188_id('draft'),
 'pet_id',pg_temp.fixed188_id('pet'),'client_id',pg_temp.fixed188_id('client'),'expected_version',null,'fields',jsonb_build_object(
 'encounter_id',null,'medication',jsonb_build_object('name','Fixed188 synthetic medication','strength','Synthetic strength','form','Synthetic form',
 'directions','Synthetic directions only','route','Synthetic route'),'quantity_per_fill','2','unit','tablet','refills_authorized',0,
 'fulfillment_mode','practice_stock','product_id',pg_temp.fixed188_id('product'),'starts_on',(now() at time zone 'America/Denver')::date,'expires_on','2099-12-31')));
select sign_native_prescription(pg_temp.fixed188_id('sign'),jsonb_build_object('draft_id',pg_temp.fixed188_id('draft'),'pet_id',pg_temp.fixed188_id('pet'),
 'expected_version',1,'expected_context_hash',preview_native_prescription_sign(pg_temp.fixed188_id('draft'),1)->>'context_hash',
 'signature_name','Synthetic fixed188 prescriber','attest_review',true));
select receive_inventory(pg_temp.fixed188_id('receive1'),pg_temp.fixed188_id('lot1'),pg_temp.fixed188_id('product'),'FIXED188-1',current_date+365,'Synthetic local fixture',3.000,'Synthetic genuine188 receipt');
select receive_inventory(pg_temp.fixed188_id('receive2'),pg_temp.fixed188_id('lot2'),pg_temp.fixed188_id('product'),'FIXED188-2',current_date+365,'Synthetic local fixture',3.000,'Synthetic genuine188 receipt');
select create_billing_invoice(pg_temp.fixed188_id('invoice'),pg_temp.fixed188_id('client'));
insert into fixed188_data values('dispense',jsonb_build_object('authorization_id',pg_temp.fixed188_id('sign'),'pet_id',pg_temp.fixed188_id('pet'),
 'slot_index',0,'expected_slot_version',null,'invoice_id',pg_temp.fixed188_id('invoice'),'quantity','2.000',
 'allocations',jsonb_build_array(jsonb_build_object('lot_id',pg_temp.fixed188_id('lot1'),'quantity','1.000'),
 jsonb_build_object('lot_id',pg_temp.fixed188_id('lot2'),'quantity','1.000')),'refill',null));
select record_native_dispense(pg_temp.fixed188_id('dispense'),v||jsonb_build_object('expected_context_hash',preview_native_dispense(v)->>'context_hash',
 'reason','Synthetic genuine188 dispense','attest_alert_review',true,'attest_dispense_review',true)) from fixed188_data where k='dispense';
select append_native_dispense_correction(pg_temp.fixed188_id('correction'),jsonb_build_object('authorization_id',pg_temp.fixed188_id('sign'),
 'pet_id',pg_temp.fixed188_id('pet'),'dispense_id',pg_temp.fixed188_id('dispense'),'kind','clinical_annotation','expected_context_hash',p->>'context_hash',
 'expected_head',p#>'{context,head}','reason','Synthetic genuine188 retained annotation','note','Synthetic engineering only',
 'amends_event_id',null,'pickup_amendment',null,'attest_review',true))
 from(select preview_native_dispense_correction(pg_temp.fixed188_id('sign'),pg_temp.fixed188_id('pet'),pg_temp.fixed188_id('dispense'))p)q;
-- The writer body must return with the same ordinary role and four JWT GUCs.
do $identity$ begin
 if session_user<>'postgres' or current_user<>'authenticated' or current_setting('role')<>'authenticated'
 or current_setting('session_replication_role')<>'origin'
 or auth.uid() is distinct from 'a2180000-0000-4000-8000-000000000001'::uuid or auth.role() is distinct from 'authenticated' or auth.email() is not null
 or current_setting('request.jwt.claims')::jsonb is distinct from '{"sub":"a2180000-0000-4000-8000-000000000001","role":"authenticated"}'::jsonb
 or nullif(current_setting('request.jwt.claim.sub',true),'') is not null
 or nullif(current_setting('request.jwt.claim.role',true),'') is not null
 or nullif(current_setting('request.jwt.claim.email',true),'') is not null then
 raise exception 'Fixed188 final writer identity differs' using errcode='23514';end if;
end $identity$;
reset role;
do $identity$ begin
 if session_user<>'postgres' or current_user<>'postgres' or current_setting('role')<>'none'
 or current_setting('session_replication_role')<>'origin'
 or auth.uid() is distinct from 'a2180000-0000-4000-8000-000000000001'::uuid or auth.role() is distinct from 'authenticated'
 or current_setting('request.jwt.claims')::jsonb is distinct from '{"sub":"a2180000-0000-4000-8000-000000000001","role":"authenticated"}'::jsonb then
 raise exception 'Fixed188 role reset identity differs' using errcode='23514';end if;
end $identity$;
set constraints all immediate;
commit;
do $identity$ begin
 if session_user<>'postgres' or current_user<>'postgres' or current_setting('role')<>'none'
 or current_setting('session_replication_role')<>'origin' or auth.uid() is not null or auth.role() is not null or auth.email() is not null
 or nullif(current_setting('request.jwt.claims',true),'') is not null
 or nullif(current_setting('request.jwt.claim.sub',true),'') is not null
 or nullif(current_setting('request.jwt.claim.role',true),'') is not null
 or nullif(current_setting('request.jwt.claim.email',true),'') is not null then
 raise exception 'Fixed188 committed session identity differs' using errcode='23514';end if;
end $identity$;
select jsonb_build_object('kind','fixed188-genuine-fixture-v1','ids',(select jsonb_object_agg(k,id order by k collate "C")from fixed188_ids),
 'session_user',session_user,'current_user',current_user,'role',current_setting('role'),'replication_role',current_setting('session_replication_role'),
 'backend_pid',pg_backend_pid(),'backend_start',(select backend_start from pg_stat_activity where pid=pg_backend_pid()),
 'historical_rows_fabricated',false,'provenance_backfilled',false,'business_calls',4,'supporting_calls',7);
