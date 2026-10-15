-- Real canonical pickup/correction paths, entirely inside ROLLBACK. No provider
-- request, actual controlled configuration, opening or clinical approval.
begin;
set local lock_timeout='2s';set local statement_timeout='10s';set local timezone='UTC';
create temp table handoff_probe_ids(key text primary key,id uuid not null);
create temp table handoff_probe_data(key text primary key,value jsonb not null);
create temp table handoff_probe_count(value integer not null);
insert into handoff_probe_count values(0);
insert into handoff_probe_ids select key,gen_random_uuid()from unnest(array[
 'actor','config','draft','save','sign','product','lot','receive','invoice','dispense','pickup','correction'])key;
grant all on handoff_probe_ids,handoff_probe_data,handoff_probe_count to authenticated;
create function pg_temp.handoff_require(ok boolean,label text)returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'Handoff rollback probe failed: %',label;end if;
 update handoff_probe_count set value=value+1;
end $$;
create temp table handoff_probe_baseline as select
 (select count(*)from communication_outbox)outbox,(select count(*)from payment_provider_profiles)payments,
 (select count(*)from controlled_draft_entries)drafts,
 (select count(*)from operational_task_generation_policy where enabled)generation,
 (select count(*)from operational_reconciliation_policy where enabled)reconciliation;
select pg_temp.handoff_require((select count(*)=10 and bool_and(definition_sha256=encode(sha256(convert_to(pg_get_functiondef(signature::regprocedure),'UTF8')),'hex'))from stock_writer_manifests),'Ten exact reviewed writers');
select pg_temp.handoff_require((select count(*)=2 and bool_and(relrowsecurity and not has_table_privilege('anon',oid,'SELECT')and not has_table_privilege('authenticated',oid,'SELECT')and not has_table_privilege('service_role',oid,'INSERT'))from pg_class where oid in('stock_pickup_sources'::regclass,'stock_correction_sources'::regclass)),'Two private source families');
select pg_temp.handoff_require((select count(*)=2 and bool_and(not has_function_privilege('anon',oid,'EXECUTE')and not has_function_privilege('authenticated',oid,'EXECUTE')and not has_function_privilege('service_role',oid,'EXECUTE'))from pg_proc where oid in('stock_handoff_guard()'::regprocedure,'stock_handoff_consistency()'::regprocedure)),'Two private helpers');
insert into auth.users(id,email,raw_user_meta_data)select id,'handoff-rollback-'||id::text||'@example.test','{}'::jsonb from handoff_probe_ids where key='actor';
update profiles set is_active=true,full_name='Synthetic handoff rollback'where id=(select id from handoff_probe_ids where key='actor');
insert into user_roles(user_id,role)select id,role::public.user_role from handoff_probe_ids cross join unnest(array['ADMIN','DVM'])role where key='actor';
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from handoff_probe_ids where key='actor'),'role','authenticated')::text,true);
set local role authenticated;
insert into handoff_probe_ids select 'client',id from save_client(auth.uid(),null,null,'Synthetic','Handoff rollback','+13035550196','handoff-rollback@example.test','EMAIL','Synthetic address',null);
insert into handoff_probe_ids select 'pet',id from save_patient(null,(select id from handoff_probe_ids where key='client'),null,'Synthetic handoff patient','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null);
select create_inventory_product((select id from handoff_probe_ids where key='product'),'Synthetic handoff medication','medication','Synthetic manufacturer','tablet',100);
select receive_inventory((select id from handoff_probe_ids where key='receive'),(select id from handoff_probe_ids where key='lot'),(select id from handoff_probe_ids where key='product'),'SYNTHETIC-HANDOFF','2099-12-31','Synthetic clinic',5,'Synthetic physical receipt');
select create_billing_invoice((select id from handoff_probe_ids where key='invoice'),(select id from handoff_probe_ids where key='client'));
select configure_native_prescriber((select id from handoff_probe_ids where key='config'),jsonb_build_object('user_id',auth.uid(),'expected_version',null,'attest_review',true,'fields',jsonb_build_object('active',true,'license_number','SYNTHETIC','license_state','CO','license_expires_on','2099-12-31','practice_name','Synthetic practice','practice_address','Synthetic address','practice_phone',null,'clinical_review_note','Rollback-only synthetic fixture')));
select save_native_prescription_draft((select id from handoff_probe_ids where key='save'),jsonb_build_object('draft_id',(select id from handoff_probe_ids where key='draft'),'pet_id',(select id from handoff_probe_ids where key='pet'),'client_id',(select id from handoff_probe_ids where key='client'),'expected_version',null,'fields',jsonb_build_object('encounter_id',null,'medication',jsonb_build_object('name','Synthetic medication','strength','Synthetic strength','form','Synthetic form','directions','Synthetic directions','route','Synthetic route'),'quantity_per_fill','2','unit','tablet','refills_authorized',0,'fulfillment_mode','practice_stock','product_id',(select id from handoff_probe_ids where key='product'),'starts_on',(now()at time zone 'America/Denver')::date,'expires_on','2099-12-31')));
select sign_native_prescription((select id from handoff_probe_ids where key='sign'),jsonb_build_object('draft_id',(select id from handoff_probe_ids where key='draft'),'pet_id',(select id from handoff_probe_ids where key='pet'),'expected_version',1,'expected_context_hash',preview_native_prescription_sign((select id from handoff_probe_ids where key='draft'),1)->>'context_hash','signature_name','Synthetic handoff rollback','attest_review',true));
insert into handoff_probe_data select 'dispense',jsonb_build_object('authorization_id',(select id from handoff_probe_ids where key='sign'),'pet_id',(select id from handoff_probe_ids where key='pet'),'slot_index',0,'expected_slot_version',null,'invoice_id',(select id from handoff_probe_ids where key='invoice'),'quantity','2','allocations',jsonb_build_array(jsonb_build_object('lot_id',(select id from handoff_probe_ids where key='lot'),'quantity','2')),'refill',null);
select record_native_dispense((select id from handoff_probe_ids where key='dispense'),value||jsonb_build_object('expected_context_hash',preview_native_dispense(value)->>'context_hash','reason','Synthetic prepared package','attest_alert_review',true,'attest_dispense_review',true))from handoff_probe_data where key='dispense';
insert into handoff_probe_data select 'pickup',jsonb_build_object('authorization_id',(select id from handoff_probe_ids where key='sign'),'pet_id',(select id from handoff_probe_ids where key='pet'),'dispense_id',(select id from handoff_probe_ids where key='dispense'),'expected_context_hash',preview_native_pickup((select id from handoff_probe_ids where key='dispense'),(select id from handoff_probe_ids where key='pet'),null)->>'context_hash','recipient_name','Synthetic recipient','recipient_relationship','Owner','reason','Synthetic observed handoff','attest_handoff',true,'refill_close',null);
update handoff_probe_data set value=value||jsonb_build_object('authorization_id',upper(value->>'authorization_id'),'pet_id',upper(value->>'pet_id'),'dispense_id',upper(value->>'dispense_id'))where key='pickup';
insert into handoff_probe_data select 'pickup-receipt',record_native_pickup((select id from handoff_probe_ids where key='pickup'),value)from handoff_probe_data where key='pickup';
select pg_temp.handoff_require(record_native_pickup((select id from handoff_probe_ids where key='pickup'),(select value from handoff_probe_data where key='pickup'))=(select value from handoff_probe_data where key='pickup-receipt'),'Exact pickup replay');
insert into handoff_probe_data select 'preview',preview_native_dispense_correction((select id from handoff_probe_ids where key='sign'),(select id from handoff_probe_ids where key='pet'),(select id from handoff_probe_ids where key='dispense'));
insert into handoff_probe_data select 'correction',jsonb_build_object('authorization_id',(select id from handoff_probe_ids where key='sign'),'pet_id',(select id from handoff_probe_ids where key='pet'),'dispense_id',(select id from handoff_probe_ids where key='dispense'),'kind','pickup_amendment','expected_context_hash',value->>'context_hash','expected_head',value#>'{context,head}','reason','Synthetic disputed original handoff','note','This assertion does not prove medication returned','amends_event_id',null,'pickup_amendment',jsonb_build_object('original_pickup_id',(select id from handoff_probe_ids where key='pickup'),'disposition','recorded_in_error','handoff',null),'attest_review',true)from handoff_probe_data where key='preview';
insert into handoff_probe_data select 'correction-receipt',append_native_dispense_correction((select id from handoff_probe_ids where key='correction'),value)from handoff_probe_data where key='correction';
select pg_temp.handoff_require(append_native_dispense_correction((select id from handoff_probe_ids where key='correction'),(select value from handoff_probe_data where key='correction'))=(select value from handoff_probe_data where key='correction-receipt'),'Exact pickup-amendment replay');
reset role;
set constraints all immediate;set constraints all deferred;
select pg_temp.handoff_require((select count(*)=1 from stock_pickup_sources where event_id=(select id from handoff_probe_ids where key='pickup')and actor_id=(select id from handoff_probe_ids where key='actor')),'One attributed pickup source');
select pg_temp.handoff_require((select count(*)=1 from stock_correction_sources where event_id=(select id from handoff_probe_ids where key='correction')and actor_id=(select id from handoff_probe_ids where key='actor')),'One attributed amendment source');
select pg_temp.handoff_require((select sum(quantity)=3 and count(*)=2 from inventory_movements where lot_id=(select id from handoff_probe_ids where key='lot')),'Pickup and dispute create no second inventory debit or refund');
select pg_temp.handoff_require((select count(*)=1 from billing_invoice_items where invoice_id=(select id from handoff_probe_ids where key='invoice')),'Pickup and dispute create no second charge');
select pg_temp.handoff_require((select count(*)=1 from native_pickups where dispense_id=(select id from handoff_probe_ids where key='dispense')),'Dispute preserves original pickup');
do $$begin
 begin
  insert into stock_pickup_sources values(gen_random_uuid(),auth.uid());
  set constraints stock_handoff_required immediate;
  raise exception 'Expected orphan source denial missing';
 exception when check_violation then null;end;
 perform pg_temp.handoff_require(true,'Orphan reverse source rejected');
end $$;
select pg_temp.handoff_require((select outbox=(select count(*)from communication_outbox)and payments=(select count(*)from payment_provider_profiles)and drafts=(select count(*)from controlled_draft_entries)and generation=(select count(*)from operational_task_generation_policy where enabled)and reconciliation=(select count(*)from operational_reconciliation_policy where enabled)from handoff_probe_baseline),'Unrelated delivery/payment/control gates unchanged');
select jsonb_build_object('checks',value,'rollback_only',true,'canonical_pickup_and_amendment',true,'single_inventory_debit',true,'provider_requests',0)as proof from handoff_probe_count;
rollback;
