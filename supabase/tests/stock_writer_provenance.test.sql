begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data) values
 ('bc410000-0000-4000-8000-000000000001','stock-source@example.test','{}');
update profiles set is_active=true,full_name='Synthetic stock source' where id='bc410000-0000-4000-8000-000000000001';
insert into user_roles(user_id,role) values('bc410000-0000-4000-8000-000000000001','STAFF');
select set_config('request.jwt.claims','{"sub":"bc410000-0000-4000-8000-000000000001","role":"authenticated"}',true);

select is((select count(*)::int from stock_writer_manifests),8,'All eight outer stock/custody/hold writers covered');
select ok((select bool_and(definition_sha256=encode(sha256(convert_to(pg_get_functiondef(signature::regprocedure),'UTF8')),'hex'))from stock_writer_manifests),'Manifest matches complete effective function definitions');
select ok((select bool_and(prior_definition_sha256<>definition_sha256)from stock_writer_manifests),'Coverage history preserves a distinct pre-migration definition');
select ok((select bool_and(prior_definition_sha256=encode(sha256(convert_to(replace(pg_get_functiondef(signature::regprocedure),chr(10)||format(' perform public.stock_writer_enter(%L,p_id);',writer),''),'UTF8')),'hex'))from stock_writer_manifests),'Removing only the inserted entry exactly reconstructs all eight prior function definitions');
select ok((select bool_and(relrowsecurity and not has_table_privilege('anon',oid,'SELECT') and not has_table_privilege('authenticated',oid,'SELECT') and not has_table_privilege('service_role',oid,'INSERT'))from pg_class where relnamespace='public'::regnamespace and relname in('stock_writer_manifests','stock_writer_admissions','stock_movement_sources','stock_custody_sources','stock_discrepancy_sources')),'All five source/admission tables private with RLS');
select ok((select bool_and(not has_function_privilege('anon',oid,'EXECUTE')and not has_function_privilege('authenticated',oid,'EXECUTE')and not has_function_privilege('service_role',oid,'EXECUTE'))from pg_proc where pronamespace='public'::regnamespace and proname in('stock_source_immutable','stock_writer_current','stock_writer_enter','stock_source_guard','stock_source_validate_movement','stock_source_consistency')),'All six helpers private');
set local role authenticated;
select throws_ok($$select stock_writer_enter('receive_inventory',gen_random_uuid())$$,'42501',null,'Staff cannot manufacture admission through RPC');
select throws_ok($$select * from stock_writer_admissions$$,'42501',null,'Staff cannot reuse private admission data');
select create_inventory_product('bc420000-0000-4000-8000-000000000001','Synthetic provenance medication','medication','Synthetic source','mL',100);
select lives_ok($$select receive_inventory('bc430000-0000-4000-8000-000000000001','bc440000-0000-4000-8000-000000000001','bc420000-0000-4000-8000-000000000001','SYNTHETIC',current_date+365,'Synthetic clinic',10,'Synthetic provenance receipt')$$,'Canonical receiving remains usable');
select lives_ok($$select adjust_inventory('bc430000-0000-4000-8000-000000000002','bc440000-0000-4000-8000-000000000001',-1,'Synthetic observed damage')$$,'Canonical adjustment remains usable');
select lives_ok($$select adjust_inventory('bc430000-0000-4000-8000-000000000002','bc440000-0000-4000-8000-000000000001',-1,'Synthetic observed damage')$$,'Exact old UUID recovers without a second stock effect');
reset role;
set constraints all immediate;
set constraints all deferred;
select is((select sum(quantity)from inventory_movements where lot_id='bc440000-0000-4000-8000-000000000001'),9::numeric,'Receiving and repeated adjustment have one net effect');
select is((select count(*)::int from stock_movement_sources),2,'Exactly one source per new movement, no replay duplication');
select is((select writer from stock_movement_sources where movement_id='bc430000-0000-4000-8000-000000000001'),'receive_inventory','Receipt source identifies canonical writer');
select is((select source_id from stock_movement_sources where movement_id='bc430000-0000-4000-8000-000000000002'),'bc430000-0000-4000-8000-000000000002'::uuid,'Adjustment source preserves original operation identity');
select throws_ok($$insert into inventory_movements(id,lot_id,quantity,kind,reason,created_by)values(gen_random_uuid(),'bc440000-0000-4000-8000-000000000001',1,'adjust','Unadmitted raw insert',auth.uid())$$,'23514','Stock writer admission required','Earlier legitimate call in same transaction cannot admit a later raw statement');
select set_config('app.stock_writer_admitted','true',true);
select set_config('app.controlled_bypass','true',true);
select throws_ok($$insert into inventory_movements(id,lot_id,quantity,kind,reason,created_by)values(gen_random_uuid(),'bc440000-0000-4000-8000-000000000001',1,'adjust','Caller GUC attempt',auth.uid())$$,'23514','Stock writer admission required','Caller-controlled session settings confer no admission');

-- A legitimate call and a second unrelated insert share ONE outer statement.
-- Admission alone would accept both; deferred canonical-source proof rejects it.
select throws_ok($test$do $body$begin
 perform adjust_inventory('bc430000-0000-4000-8000-000000000003','bc440000-0000-4000-8000-000000000001',-0.125,'Synthetic legitimate first operation');
 insert into inventory_movements(id,lot_id,quantity,kind,reason,created_by)values(gen_random_uuid(),'bc440000-0000-4000-8000-000000000001',1,'adjust','Unrelated same-statement insert',auth.uid());
 set constraints stock_source_required immediate;
end$body$$test$,'23514','Canonical stock source does not match movement','Unrelated same-statement stock cannot borrow a legitimate operation');
select is((select sum(quantity)from inventory_movements where lot_id='bc440000-0000-4000-8000-000000000001'),9::numeric,'Both attempted effects roll back atomically');
select is((select count(*)::int from stock_movement_sources),2,'Failed transaction leaves no source evidence');
select throws_ok($test$do $body$begin
 insert into stock_movement_sources values(gen_random_uuid(),'receive_inventory',gen_random_uuid(),auth.uid());
 set constraints stock_source_required immediate;
end$body$$test$,'23514','Stock movement source mismatch','Orphan reverse source cannot commit');

-- Simulate a future migration that leaves entry instrumentation but changes the
-- reviewed effective writer. The failure rolls its DDL back with the statement.
select throws_ok($test$do $body$declare definition text;begin
 definition:=pg_get_functiondef('adjust_inventory(uuid,uuid,numeric,text)'::regprocedure);
 execute replace(definition,'perform public.stock_writer_enter','/* unreviewed source change */ perform public.stock_writer_enter');
 perform adjust_inventory(gen_random_uuid(),'bc440000-0000-4000-8000-000000000001',1,'Unreviewed writer');
end$body$$test$,'23514','Stock writer coverage changed; reviewed manifest required','Unreviewed effective function drift fails closed');
select ok((select bool_and(definition_sha256=encode(sha256(convert_to(pg_get_functiondef(signature::regprocedure),'UTF8')),'hex'))from stock_writer_manifests),'Failed source-drift attempt restores exact reviewed definitions');
select throws_ok($test$do $body$declare definition text;begin
 definition:=pg_get_functiondef('receive_inventory(uuid,uuid,uuid,text,date,text,numeric,text)'::regprocedure);
 execute replace(definition,'perform public.stock_writer_enter(''receive_inventory'',p_id);','');
 perform receive_inventory(gen_random_uuid(),gen_random_uuid(),'bc420000-0000-4000-8000-000000000001','UNINSTRUMENTED',current_date+365,'Synthetic clinic',1,'Uninstrumented writer');
end$body$$test$,'23514','Stock writer admission required','A future writer without early admission cannot post stock');
select is((select count(*)::int from inventory_lots where lot_number='UNINSTRUMENTED'),0,'Failed uninstrumented receipt also rolls back its new lot');
select throws_ok($$update stock_movement_sources set writer='adjust_inventory'$$,'23514','Stock source evidence is immutable','Original source cannot be rewritten');
select throws_ok($$delete from stock_movement_sources$$,'23514','Stock source evidence is immutable','Source history cannot be deleted');
select throws_ok($$truncate stock_movement_sources$$,'23514','Stock source evidence is immutable','Source history cannot be truncated');
select throws_ok($$update stock_writer_manifests set definition_sha256=repeat('0',64)$$,'23514','Stock source evidence is immutable','Coverage history cannot be silently replaced');
select is((select count(*)::int from controlled_draft_entries where product_id='bc420000-0000-4000-8000-000000000001'),0,'Ordinary stock never infers or seeds controlled classification');
select * from finish();
rollback;
