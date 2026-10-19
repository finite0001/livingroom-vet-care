-- OWNED LOCAL ONLY. Runner prepends the canonical native_fulfillment.test.sql
-- prefix before `insert into data select 'target',` in this SAME transaction.
-- All clinical/stock records are created through the original era's real RPCs.
set local timezone='UTC';
reset role;
create temp table native_history_input(era integer not null check(era in(187,188)));
insert into native_history_input values(:'era'::integer);
create temp table native_history_cases(name text primary key,dispense_id uuid not null,return_version integer not null,
 correction_version integer not null,discrepancy_version integer not null,pickup_id uuid,expected_outcome text not null,expected_error text);
create function pg_temp.history_id(key text)returns uuid language sql stable as $$select id from fx where k=key$$;
do $$declare era integer:=(select i.era from native_history_input i);begin
 if(select count(*)from supabase_migrations.schema_migrations)<>era then raise exception 'Genuine seed requires its exact original migration era';end if;
 if era=187 and to_regclass('public.stock_movement_sources')is not null then raise exception '187 seed must precede movement provenance';end if;
 if era=188 and(to_regclass('public.stock_movement_sources')is null or to_regclass('public.stock_pickup_sources')is not null)then
 raise exception '188 seed must have movement provenance and precede handoff provenance';end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'and left(c.relname,17)='controlled_stock_')then
 raise exception 'Historical records must precede candidate installation';end if;
end$$;
grant all on native_history_input,native_history_cases to authenticated;
set local role authenticated;
-- Genuine generic-only stock is independent of the native product and its holds.
-- These are the original era's public writers, not hand-built historical rows.
insert into fx select k,gen_random_uuid()from unnest(array['history_generic_lot','history_generic_receive','history_generic_adjust'])k;
insert into fx select 'history_generic_product',id from save_catalog_product(null,null,'Synthetic genuine-era generic stock','medication','','tablet',100,true);
select receive_inventory(pg_temp.history_id('history_generic_receive'),pg_temp.history_id('history_generic_lot'),pg_temp.history_id('history_generic_product'),
 'SYNTHETIC-GENERIC-HISTORY',current_date+365,'Synthetic clinic',3.000,'Synthetic genuine-era generic receipt');
select adjust_inventory(pg_temp.history_id('history_generic_adjust'),pg_temp.history_id('history_generic_lot'),-0.500,'Synthetic genuine-era fractional adjustment');
insert into fx select k,gen_random_uuid()from unnest(array['history_prepared','history_clinical','history_operational','history_pickup_dispense',
 'history_amendment_dispense','history_hold_dispense','history_pickup','history_amendment_pickup','history_clinical_event',
 'history_operational_event','history_amendment_event','history_hold_intake','history_hold_report'])k;

create function pg_temp.history_fill(version integer)returns jsonb language sql volatile as $$
 select t||jsonb_build_object('expected_context_hash',preview_native_dispense(t)->>'context_hash','reason','Synthetic genuine-era history fixture',
 'attest_alert_review',true,'attest_dispense_review',true)from(select jsonb_build_object('authorization_id',pg_temp.history_id('sign'),'pet_id',pg_temp.history_id('pet'),
 'slot_index',0,'expected_slot_version',version,'invoice_id',pg_temp.history_id('invoice'),'quantity','2',
 'allocations',jsonb_build_array(jsonb_build_object('lot_id',pg_temp.history_id('lot1'),'quantity','1'),jsonb_build_object('lot_id',pg_temp.history_id('lot2'),'quantity','1')),'refill',null)t)s
$$;
create function pg_temp.history_pickup_request(did uuid)returns jsonb language sql volatile as $$
 select jsonb_build_object('authorization_id',pg_temp.history_id('sign'),'pet_id',pg_temp.history_id('pet'),'dispense_id',did,
 'expected_context_hash',preview_native_pickup(did,pg_temp.history_id('pet'),null)->>'context_hash','recipient_name','Synthetic historical recipient',
 'recipient_relationship','Owner','reason','Synthetic original-era pickup','attest_handoff',true,'refill_close',null)
$$;
create function pg_temp.history_correction_request(did uuid,kind text,pickup uuid default null)returns jsonb language sql volatile as $$
 select jsonb_build_object('authorization_id',pg_temp.history_id('sign'),'pet_id',pg_temp.history_id('pet'),'dispense_id',did,'kind',kind,
 'expected_context_hash',p->>'context_hash','expected_head',p#>'{context,head}','reason','Synthetic original-era correction',
 'note','Synthetic source evidence only; no practice rule','amends_event_id',null,
 'pickup_amendment',case when kind='pickup_amendment'then jsonb_build_object('original_pickup_id',pickup,'disposition','recorded_in_error','handoff',null)else null end,
 'attest_review',true)from(select preview_native_dispense_correction(pg_temp.history_id('sign'),pg_temp.history_id('pet'),did)p)s
$$;
select record_native_dispense(pg_temp.history_id('history_prepared'),pg_temp.history_fill(null));
do $$declare era integer:=(select i.era from native_history_input i);key text;version integer:=1;intent jsonb;p jsonb;allocations jsonb;intake_receipt jsonb;begin
 if era=187 then
  insert into native_history_cases values('187_prepared_native',pg_temp.history_id('history_prepared'),0,0,0,null,'refused','Stock movement source required');
  return;
 end if;
 foreach key in array array['history_clinical','history_operational','history_pickup_dispense','history_amendment_dispense','history_hold_dispense']loop
  perform record_native_dispense(pg_temp.history_id(key),pg_temp.history_fill(version));version:=version+1;
 end loop;
 perform append_native_dispense_correction(pg_temp.history_id('history_clinical_event'),pg_temp.history_correction_request(pg_temp.history_id('history_clinical'),'clinical_annotation'));
 perform append_native_dispense_correction(pg_temp.history_id('history_operational_event'),pg_temp.history_correction_request(pg_temp.history_id('history_operational'),'operational_annotation'));
 perform record_native_pickup(pg_temp.history_id('history_pickup'),pg_temp.history_pickup_request(pg_temp.history_id('history_pickup_dispense')));
 perform record_native_pickup(pg_temp.history_id('history_amendment_pickup'),pg_temp.history_pickup_request(pg_temp.history_id('history_amendment_dispense')));
 perform append_native_dispense_correction(pg_temp.history_id('history_amendment_event'),pg_temp.history_correction_request(pg_temp.history_id('history_amendment_dispense'),'pickup_amendment',pg_temp.history_id('history_amendment_pickup')));
 -- Seed the actual unresolved lot hold LAST, after every other stock writer.
 allocations:=read_native_dispense_returns_v2(pg_temp.history_id('sign'),pg_temp.history_id('pet'),pg_temp.history_id('history_hold_dispense'))->'allocations';
 if(case when jsonb_typeof(allocations)='array'then jsonb_array_length(allocations)else null end)is distinct from 2 then
 raise exception 'Authorized historical return read must expose both original allocations';end if;
 intent:=jsonb_build_object('target',jsonb_build_object('authorization_id',pg_temp.history_id('sign'),'pet_id',pg_temp.history_id('pet'),'dispense_id',pg_temp.history_id('history_hold_dispense')),
 'action','intake','intake_id',null,'allocations',(select jsonb_agg(jsonb_build_object('allocation_id',a->'allocation_id','quantity','0.250')order by a->>'allocation_id')from jsonb_array_elements(allocations)a),
 'custody','clinic_retained','package_condition','sealed_intact','storage_history','controlled','reason','Synthetic original retained intake','note','Synthetic observed custody only');
 p:=preview_native_dispense_return(intent);
 intake_receipt:=record_native_dispense_return(pg_temp.history_id('history_hold_intake'),jsonb_build_object('intent',intent,'expected_context_hash',p->>'context_hash',
 'expected_head',p#>'{context,head}','attest_review',true,'attest_restock',false));
 if intake_receipt#>>'{result,id}'is distinct from pg_temp.history_id('history_hold_intake')::text
 or coalesce(intake_receipt#>>'{result,record_hash}','')!~'^[0-9a-f]{64}$'then raise exception 'Canonical intake receipt must retain its exact source identity and hash';end if;
 intent:=jsonb_build_object('target',jsonb_build_object('authorization_id',pg_temp.history_id('sign'),'pet_id',pg_temp.history_id('pet'),'dispense_id',pg_temp.history_id('history_hold_dispense')),
 'action','report','case_id',null,'source',jsonb_build_object('event_id',intake_receipt#>'{result,id}','record_hash',intake_receipt#>'{result,record_hash}'),
 'allocations',(select jsonb_agg(jsonb_build_object('allocation_id',a->'allocation_id','quantity','0.050')order by a->>'allocation_id')from jsonb_array_elements(allocations)a),
 'observation','Synthetic unresolved discrepancy; no clinical decision','correction_ids','[]'::jsonb);
 p:=preview_native_return_discrepancy(intent);
 perform record_native_return_discrepancy(pg_temp.history_id('history_hold_report'),jsonb_build_object('intent',intent,'expected_context_hash',p->>'context_hash',
 'expected_return_head',p#>'{context,return_head}','expected_discrepancy_head',p#>'{context,discrepancy_head}',
 'attest_physical_review',true,'attest_original_quantities_custody_and_stock_accurate',false));
 insert into native_history_cases values
 ('188_prepared_native',pg_temp.history_id('history_prepared'),0,0,0,null,'accepted_projection',null),
 ('188_clinical_annotation',pg_temp.history_id('history_clinical'),0,1,0,null,'accepted_projection',null),
 ('188_operational_annotation',pg_temp.history_id('history_operational'),0,1,0,null,'accepted_projection',null),
 ('188_pickup',pg_temp.history_id('history_pickup_dispense'),0,0,0,pg_temp.history_id('history_pickup'),'refused','Verified original pickup row, operation and provenance required'),
 ('188_pickup_amendment',pg_temp.history_id('history_amendment_dispense'),0,1,0,pg_temp.history_id('history_amendment_pickup'),'refused','Verified original pickup row, operation and provenance required'),
 ('188_unresolved_discrepancy',pg_temp.history_id('history_hold_dispense'),1,0,1,null,'refused','Unresolved cutover discrepancy requires an unavailable exception workflow');
end$$;
-- This is an old-era seed proof, not a new policy or opening assertion.
set constraints all immediate;
reset role;
commit;
select jsonb_build_object('kind','controlled-native-history-seed-v1','era',(select era from native_history_input),
 'ids',(select jsonb_object_agg(k,id)from fx),'cases',(select jsonb_agg(to_jsonb(c)order by name)from native_history_cases c),
 'generic_stock',jsonb_build_object('product_id',pg_temp.history_id('history_generic_product'),'lot_id',pg_temp.history_id('history_generic_lot'),
 'receive_id',pg_temp.history_id('history_generic_receive'),'adjust_id',pg_temp.history_id('history_generic_adjust'),
 'received_quantity','3.000','adjustment_quantity','-0.500','available_quantity','2.500','movement_count',2),
 'actual_canonical_dispense_count',(select count(*)from native_dispenses),'actual_canonical_correction_count',(select count(*)from native_dispense_correction_events),
 'actual_canonical_pickup_count',(select count(*)from native_pickups),'actual_canonical_return_count',(select count(*)from native_return_events),
 'actual_canonical_discrepancy_count',(select count(*)from native_return_discrepancy_events),'historical_rows_fabricated',false,'provenance_backfilled',false);
