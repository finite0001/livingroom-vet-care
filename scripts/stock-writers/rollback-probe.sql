-- Positive physical stock paths use synthetic fixtures inside ONE rollback-only
-- transaction. No provider request, actual drug classification or activation.
begin;
set local lock_timeout='2s';
set local statement_timeout='10s';
set local timezone='UTC';
create temp table stock_probe_count(value integer not null);
insert into stock_probe_count values(0);
create temp table stock_probe_ids(key text primary key,id uuid not null);
create temp table stock_probe_requests(key text primary key,request jsonb not null);
insert into stock_probe_ids select key,gen_random_uuid()from unnest(array['actor','session','product','lot','receive','adjust','invoice','treatment','anesthesia','anesthesia_drug'])key;
grant all on stock_probe_count,stock_probe_ids,stock_probe_requests to authenticated;
create function pg_temp.stock_require(ok boolean,label text)returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'Stock rollback probe failed: %',label;end if;
 update stock_probe_count set value=value+1;
end $$;
create function pg_temp.stock_reject(query text,expected text,label text)returns void language plpgsql as $$declare code text;begin
 begin execute query;raise exception 'Expected stock denial missing: %',label;
 exception when others then get stacked diagnostics code=returned_sqlstate;if code<>expected then raise;end if;end;
 perform pg_temp.stock_require(true,label);
end $$;

select pg_temp.stock_require((select count(*)=10 from stock_writer_manifests),'All ten outer writers');
select pg_temp.stock_require((select bool_and(definition_sha256=encode(sha256(convert_to(pg_get_functiondef(signature::regprocedure),'UTF8')),'hex'))from stock_writer_manifests),'Exact effective writer coverage');
select pg_temp.stock_require((select bool_and(prior_definition_sha256=encode(sha256(convert_to(replace(pg_get_functiondef(signature::regprocedure),chr(10)||format(' perform public.stock_writer_enter(%L,p_id);',writer),''),'UTF8')),'hex'))from stock_writer_manifests),'Only reviewed early entry added');
select pg_temp.stock_require((select count(*)=5 and bool_and(relrowsecurity and not has_table_privilege('anon',oid,'SELECT')and not has_table_privilege('authenticated',oid,'SELECT')and not has_table_privilege('service_role',oid,'INSERT'))from pg_class where relnamespace='public'::regnamespace and relname in('stock_writer_manifests','stock_writer_admissions','stock_movement_sources','stock_custody_sources','stock_discrepancy_sources')),'Five private RLS tables');
select pg_temp.stock_require((select count(*)=6 and bool_and(not has_function_privilege('anon',oid,'EXECUTE')and not has_function_privilege('authenticated',oid,'EXECUTE')and not has_function_privilege('service_role',oid,'EXECUTE'))from pg_proc where pronamespace='public'::regnamespace and proname in('stock_source_immutable','stock_writer_current','stock_writer_enter','stock_source_guard','stock_source_validate_movement','stock_source_consistency')),'Six private helpers');
create temp table stock_probe_baseline as select
 (select count(*)from communication_outbox)outbox,
 (select count(*)from payment_provider_profiles)payments,
 (select count(*)from controlled_draft_entries)drafts,
 (select count(*)from operational_task_generation_policy where enabled)generation,
 (select count(*)from operational_reconciliation_policy where enabled)reconciliation;
insert into auth.users(id,email,raw_user_meta_data)select id,'stock-rollback-'||id::text||'@example.test','{}'::jsonb from stock_probe_ids where key='actor';
update profiles set is_active=true,full_name='Synthetic stock rollback'where id=(select id from stock_probe_ids where key='actor');
insert into user_roles(user_id,role)select id,'STAFF'::public.user_role from stock_probe_ids where key='actor';
insert into auth.sessions(id,user_id,created_at,updated_at)values((select id from stock_probe_ids where key='session'),(select id from stock_probe_ids where key='actor'),clock_timestamp(),clock_timestamp());
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from stock_probe_ids where key='actor'),'role','authenticated','session_id',(select id from stock_probe_ids where key='session'))::text,true);
set local role authenticated;
select pg_temp.stock_reject($q$select stock_writer_enter('receive_inventory',gen_random_uuid())$q$,'42501','Caller cannot manufacture admission');
insert into stock_probe_ids select 'client',id from save_client(auth.uid(),null,null,'Synthetic','Stock rollback','+13035550195','stock-rollback@example.test','EMAIL','Synthetic address',null);
insert into stock_probe_ids select 'patient',id from save_patient(null,(select id from stock_probe_ids where key='client'),null,'Synthetic source patient','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null);
select create_inventory_product((select id from stock_probe_ids where key='product'),'Synthetic source medication','medication','Synthetic manufacturer','mL',100);
select pg_temp.stock_require((receive_inventory((select id from stock_probe_ids where key='receive'),(select id from stock_probe_ids where key='lot'),(select id from stock_probe_ids where key='product'),'SYNTHETIC-SOURCE','2099-12-31','Synthetic clinic',10,'Synthetic physical receipt')).quantity=10,'Physical receipt');
select pg_temp.stock_require((receive_inventory((select id from stock_probe_ids where key='receive'),(select id from stock_probe_ids where key='lot'),(select id from stock_probe_ids where key='product'),'SYNTHETIC-SOURCE','2099-12-31','Synthetic clinic',10,'Synthetic physical receipt')).quantity=10,'Receipt exact UUID replay');
select pg_temp.stock_require((adjust_inventory((select id from stock_probe_ids where key='adjust'),(select id from stock_probe_ids where key='lot'),-0.125,'Synthetic stock correction')).quantity=-0.125,'Fractional adjustment');
select pg_temp.stock_require((adjust_inventory((select id from stock_probe_ids where key='adjust'),(select id from stock_probe_ids where key='lot'),-0.125,'Synthetic stock correction')).quantity=-0.125,'Adjustment exact UUID replay');
select create_billing_invoice((select id from stock_probe_ids where key='invoice'),(select id from stock_probe_ids where key='client'));
insert into stock_probe_requests values('treatment',jsonb_build_object('pet_id',(select id from stock_probe_ids where key='patient'),'lot_id',(select id from stock_probe_ids where key='lot'),'invoice_id',(select id from stock_probe_ids where key='invoice'),'quantity',0.25,'dose','Synthetic observed dose','route','IV','site','','veterinarian','Synthetic veterinarian','veterinarian_license','SYNTHETIC','administered_at',clock_timestamp(),'next_due_on',null,'alert_review',jsonb_build_object('source_hash',read_patient_treatment_alerts((select id from stock_probe_ids where key='patient'))->>'source_hash','acknowledged',true)));
select pg_temp.stock_require((record_patient_treatment((select id from stock_probe_ids where key='treatment'),(select request from stock_probe_requests where key='treatment'))).quantity=0.25,'Patient treatment');
select pg_temp.stock_require((record_patient_treatment((select id from stock_probe_ids where key='treatment'),(select request from stock_probe_requests where key='treatment'))).quantity=0.25,'Treatment exact UUID replay');
select save_patient_anesthesia_record((select id from stock_probe_ids where key='anesthesia'),(select id from stock_probe_ids where key='patient'),null,jsonb_build_object('procedure_name','Synthetic procedure','started_at',clock_timestamp()-interval '1 hour','team','Synthetic team','source','manual','assessment','Synthetic assessment','plan','Synthetic plan'));
insert into stock_probe_requests values('anesthesia',jsonb_build_object('lot_id',(select id from stock_probe_ids where key='lot'),'invoice_id',(select id from stock_probe_ids where key='invoice'),'quantity',1.5,'dose','Synthetic observed dose','route','IV','site','','veterinarian','Synthetic veterinarian','veterinarian_license','SYNTHETIC','administered_at',clock_timestamp(),'alert_review',jsonb_build_object('source_hash',read_patient_treatment_alerts((select id from stock_probe_ids where key='patient'))->>'source_hash','acknowledged',true)));
select pg_temp.stock_require((record_anesthesia_drug_administration((select id from stock_probe_ids where key='anesthesia_drug'),(select id from stock_probe_ids where key='anesthesia'),(select id from stock_probe_ids where key='patient'),(select request from stock_probe_requests where key='anesthesia'))).quantity=1.5,'Anesthesia nested treatment');
select pg_temp.stock_require((record_anesthesia_drug_administration((select id from stock_probe_ids where key='anesthesia_drug'),(select id from stock_probe_ids where key='anesthesia'),(select id from stock_probe_ids where key='patient'),(select request from stock_probe_requests where key='anesthesia'))).quantity=1.5,'Anesthesia exact UUID replay');
reset role;
set constraints stock_source_required immediate;
set constraints stock_source_required deferred;
select pg_temp.stock_require((select sum(quantity)=8.125 from inventory_movements where lot_id=(select id from stock_probe_ids where key='lot')),'Exact stock conservation');
select pg_temp.stock_require((select count(*)=4 from stock_movement_sources s join inventory_movements m on m.id=s.movement_id where m.lot_id=(select id from stock_probe_ids where key='lot')),'One source per physical effect');
select pg_temp.stock_require((select writer='record_anesthesia_drug_administration'from stock_movement_sources where movement_id=(select id from stock_probe_ids where key='anesthesia_drug')),'Anesthesia keeps outer identity');
select pg_temp.stock_require((select count(*)=2 from billing_invoice_items where invoice_id=(select id from stock_probe_ids where key='invoice')),'One charge per clinical event');
select pg_temp.stock_reject(format('insert into inventory_movements(id,lot_id,quantity,kind,reason,created_by)values(gen_random_uuid(),%L::uuid,1,''adjust'',''Unadmitted'',auth.uid());set constraints stock_source_required immediate',(select id from stock_probe_ids where key='lot')),'23514','Unrelated raw stock cannot commit, including one query batch');
select pg_temp.stock_reject($q$update stock_movement_sources set writer='adjust_inventory'where movement_id=(select id from stock_probe_ids where key='receive')$q$,'23514','Source evidence immutable');
select pg_temp.stock_reject($q$delete from stock_movement_sources where movement_id=(select id from stock_probe_ids where key='receive')$q$,'23514','Source evidence undeletable');
select pg_temp.stock_require((select row(outbox,payments,drafts,generation,reconciliation)=row((select count(*)from communication_outbox),(select count(*)from payment_provider_profiles),(select count(*)from controlled_draft_entries),(select count(*)from operational_task_generation_policy where enabled),(select count(*)from operational_reconciliation_policy where enabled))from stock_probe_baseline),'No messaging/payment/classification/generation/reconciliation change');
select jsonb_build_object('checks',(select value from stock_probe_count),'provider_requests',0,'rollback_only',true)as proof;
rollback;
