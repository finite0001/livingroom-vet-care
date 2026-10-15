begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

select is((select count(*)::int from stock_writer_manifests where writer in('record_native_pickup','append_native_dispense_correction')),2,'Both handoff producers have reviewed coverage');
select ok((select bool_and(relrowsecurity)from pg_class where oid in('stock_pickup_sources'::regclass,'stock_correction_sources'::regclass)),'Both handoff source families use RLS');
select ok(not exists(select 1 from unnest(array['stock_pickup_sources','stock_correction_sources'])t
 cross join unnest(array['anon','authenticated','service_role'])r
 cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'])p
 where has_table_privilege(r,t,p)),'No client or worker role can read or manufacture handoff evidence');
select ok(not exists(select 1 from pg_class c cross join lateral aclexplode(c.relacl)a
 where c.oid in('stock_pickup_sources'::regclass,'stock_correction_sources'::regclass)and a.grantee=0),'PUBLIC has no inherited table access');
select ok(not exists(select 1 from unnest(array['stock_handoff_guard()','stock_handoff_consistency()'])f
 cross join unnest(array['anon','authenticated','service_role'])r where has_function_privilege(r,f,'EXECUTE')),'Handoff internals cannot be called as RPCs');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=public, pg_temp'])from pg_proc
 where oid in('stock_handoff_guard()'::regprocedure,'stock_handoff_consistency()'::regprocedure)),'Private trigger helpers have a fixed search path');
select ok((select bool_and(has_function_privilege('authenticated',f,'EXECUTE')and not has_function_privilege('anon',f,'EXECUTE')and not has_function_privilege('service_role',f,'EXECUTE'))
 from unnest(array['record_native_pickup(uuid,jsonb)','append_native_dispense_correction(uuid,jsonb)'])f),'Canonical staff API grants stay narrow');
select is((select count(*)::int from pg_trigger where tgname='stock_handoff_required'and not tgisinternal and tgdeferrable and tginitdeferred and tgenabled='O'),6,'Events, reverse sources and operation receipts all require deferred matching evidence');
select is((select count(*)::int from pg_trigger where tgrelid in('native_pickups'::regclass,'native_dispense_correction_events'::regclass)
 and tgname in('stock_handoff_admission','aaa_stock_handoff_capture')and tgenabled='O'),4,'Both native event families capture their exact early admission');
select is((select count(*)::int from pg_trigger where tgrelid in('stock_pickup_sources'::regclass,'stock_correction_sources'::regclass)
 and tgname in('immutable','no_truncate')and tgenabled='O'),4,'Both provenance families reject rewriting, deletion and truncation');
select ok(not exists(select 1 from pg_constraint c where c.conrelid in('stock_pickup_sources'::regclass,'stock_correction_sources'::regclass)
 and c.contype='f'and not exists(select 1 from pg_index i where i.indrelid=c.conrelid and i.indisvalid and i.indkey[0]=c.conkey[1])),'All new source foreign keys have an index');
set local role authenticated;
select throws_ok($$select stock_handoff_consistency()$$,'42501',null,'Staff cannot directly invoke the consistency helper');
select * from finish();
rollback;
