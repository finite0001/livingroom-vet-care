-- SYNTHETIC OWNED LOCAL ONLY. Run after unchanged native-config/native-operations
-- in the same psql connection, with the separately reviewed A1 adapter installed.
-- No controlled event or immutable source is inserted directly here. Every new
-- event goes through the existing owned prepare/execute and canonical writer.
begin;
set local timezone='UTC';
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated',
 'sub','a5510000-0000-4000-8000-000000000001','session_id',pg_temp.eid('engine_session'))::text,true);

insert into fx select key,gen_random_uuid() from unnest(array[
 'review_receive','review_receive_container','review_adjust_positive','review_retract_intake2','review_retract_disposal2',
 'review_retract_restock2','review_annotation_amended','review_pickup_amended',
 'review_report_v1_confirm','review_note_v1','review_confirm_v1','review_report_v1_correct',
 'review_correct_v1_first','review_correct_v1_second','review_resolve_v1'])key;

-- These associations are fixture intent, not values copied from adapter output.
-- All existing native fixture events use the one synthetic site and tablet unit.
create temp table review_v3_fixture_cases(
 label text primary key, event_key text not null unique, event_kind text not null,
 clock_basis text not null, family_key text, variant text not null
);
insert into review_v3_fixture_cases values
 ('receive','review_receive','receive_inventory','physical_record',null,'fractional_positive_receive'),
 ('adjust_negative','engine_adjust','adjust_inventory','physical_record',null,'negative_adjustment'),
 ('adjust_positive','review_adjust_positive','adjust_inventory','physical_record',null,'positive_adjustment'),
 ('treatment','engine_treatment','record_patient_treatment','physical_record',null,'fractional_0.250_single_charge'),
 ('anesthesia','engine_anesthesia','record_anesthesia_drug_administration','physical_record',null,'fractional_1.500_single_debit_charge'),
 ('dispense_a','dispense','record_native_dispense','physical_record','dispense','two_lots_4_and_6'),
 ('dispense_b','dispense2','record_native_dispense','physical_record','dispense2','two_lots_4_and_4'),
 ('pickup','engine_pickup','record_native_pickup','physical_record','dispense','complete_package_no_charge'),
 ('intake_v1','engine_intake1','record_native_dispense_return:intake','physical_record',null,'v1'),
 ('dispose_v1','engine_dispose1','record_native_dispense_return:dispose','physical_record',null,'v1'),
 ('restock_v1','engine_restock1','record_native_dispense_return:restock','physical_record',null,'v1'),
 ('intake_v2','engine_intake2','record_native_dispense_return_v2:intake','physical_record',null,'v2'),
 ('dispose_v2','engine_dispose2','record_native_dispense_return_v2:dispose','physical_record',null,'v2'),
 ('restock_v2','engine_restock2','record_native_dispense_return_v2:restock','physical_record',null,'v2'),
 ('retract_intake_v1','engine_retract_intake1','record_native_dispense_return_v2:retract_intake','correction_assertion',null,'v1_target_partial'),
 ('retract_disposal_v1','engine_retract_dispose1','record_native_dispense_return_v2:retract_disposal','correction_assertion',null,'v1_target_partial'),
 ('retract_restock_v1','engine_retract_restock1','record_native_dispense_return_v2:retract_restock','correction_assertion',null,'v1_target_partial'),
 ('retract_intake_v2','review_retract_intake2','record_native_dispense_return_v2:retract_intake','correction_assertion',null,'v2_target_partial'),
 ('retract_disposal_v2','review_retract_disposal2','record_native_dispense_return_v2:retract_disposal','correction_assertion',null,'v2_target_partial'),
 ('retract_restock_v2','review_retract_restock2','record_native_dispense_return_v2:retract_restock','correction_assertion',null,'v2_target_partial'),
 ('report_v2','engine_report1','record_native_return_discrepancy:report','discrepancy_assertion',null,'v2_source'),
 ('note_v2','engine_note1','record_native_return_discrepancy:note','discrepancy_assertion',null,'v2_source'),
 ('confirm_v2','engine_resolve1','record_native_return_discrepancy:resolve_confirmed_original','discrepancy_assertion',null,'v2_source'),
 ('corrected_v2','engine_resolve2','record_native_return_discrepancy:resolve_corrected','discrepancy_assertion',null,'v2_source_one_correction'),
 ('report_v1','review_report_v1_confirm','record_native_return_discrepancy:report','discrepancy_assertion',null,'v1_source'),
 ('note_v1','review_note_v1','record_native_return_discrepancy:note','discrepancy_assertion',null,'v1_source'),
 ('confirm_v1','review_confirm_v1','record_native_return_discrepancy:resolve_confirmed_original','discrepancy_assertion',null,'v1_source'),
 ('corrected_v1','review_resolve_v1','record_native_return_discrepancy:resolve_corrected','discrepancy_assertion',null,'v1_source_two_corrections'),
 ('clinical_annotation','engine_annotation','append_native_dispense_correction:clinical_annotation','annotation',null,'original'),
 ('operational_annotation','engine_operational','append_native_dispense_correction:operational_annotation','annotation',null,'original'),
 ('pickup_amendment','engine_amendment','append_native_dispense_correction:pickup_amendment','annotation',null,'original'),
 ('clinical_amended','review_annotation_amended','append_native_dispense_correction:clinical_annotation','annotation',null,'same_kind_amendment'),
 ('pickup_amended','review_pickup_amended','append_native_dispense_correction:pickup_amendment','annotation',null,'second_pickup_amendment');

-- Retain a read of existing targets before later legitimate appends. This is a
-- stability comparison only; it does not create expected metadata or provenance.
create temp table review_v3_before_append(event_id uuid primary key, collected jsonb not null);
insert into review_v3_before_append
 select e.id,controlled_review_v3.collect_event_sources(e.id)
 from public.controlled_stock_events e where e.product_id=pg_temp.eid('product');

-- A receipt adds a new actual stock container, even for an existing lot.
-- The general native helper intentionally routes available changes to existing
-- containers, so use the canonical prepare/execute path with explicit custody.
do $$declare args jsonb;context jsonb;receipt jsonb;begin
 select jsonb_build_object('lot_id',l.id,'product_id',pg_temp.eid('product'),'lot_number',l.lot_number,
  'expires_on',l.expires_on::text,'location',l.location,'quantity','1.125','reason','Synthetic A1 fractional receipt')
 into strict args from public.inventory_lots l where l.id=pg_temp.eid('lot1');
 if exists(select 1 from public.controlled_stock_containers where id=pg_temp.eid('review_receive_container'))then
  raise exception 'A1 receive fixture container must be new';end if;
 context:=jsonb_build_object('version',1,'product_id',pg_temp.eid('product'),
  'policy_version_id',pg_temp.eid('engine_policy'),'state_head_id',pg_temp.eid('engine_active'),
  'opening_id',pg_temp.eid('engine_opening'),
  'basis',jsonb_build_object('kind','physical_record','observed_at',to_char(clock_timestamp(),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'note','Synthetic A1 physical receipt'),
  'containers',jsonb_build_array(jsonb_build_object('id',pg_temp.eid('review_receive_container'),'expected_version',null,
   'create',jsonb_build_object('kind','stock','label','Synthetic A1 received bottle','stock_lot_id',pg_temp.eid('lot1'),
    'site_id',pg_temp.eid('engine_site'),'location_id',pg_temp.eid('engine_location'),'custodian_id',auth.uid()),
   'after',jsonb_build_object('status','onsite','location_id',pg_temp.eid('engine_location'),'custodian_id',auth.uid()),
   'lines',jsonb_build_array(jsonb_build_object('lot_id',pg_temp.eid('lot1'),'channel','available',
    'dispense_id',null,'intake_id',null,'quantity_delta','1.125')))));
 perform public.prepare_controlled_stock_action(auth.uid(),pg_temp.eid('review_receive'),'receive_inventory',args,context);
 receipt:=public.execute_controlled_stock_action(auth.uid(),pg_temp.eid('review_receive'));
 insert into engine_native_results values('review_receive','receive_inventory',pg_temp.eid('review_receive'),receipt);
 if(select count(*)from public.controlled_stock_containers where id=pg_temp.eid('review_receive_container')
   and kind='stock'and stock_lot_id=pg_temp.eid('lot1')and controlling_site_id=pg_temp.eid('engine_site'))<>1
  or(select sum(p.quantity)from public.controlled_stock_positions p join public.controlled_stock_cells c on c.id=p.cell_id
   where c.container_id=pg_temp.eid('review_receive_container')and c.channel='available')is distinct from 1.125 then
  raise exception 'A1 receipt did not create its declared physical stock container';end if;
end $$;
select pg_temp.engine_native_call('review_adjust_positive','adjust_inventory',pg_temp.eid('review_adjust_positive'),
 jsonb_build_object('lot_id',pg_temp.eid('lot1'),'quantity','0.125','reason','Synthetic A1 positive adjustment'));

-- Genuine correction targets in version2; old fixture already covers all v1
-- targets and one v2 disposal correction. Quantities remain within original
-- remaining reversible custody, independently declared as0.025 per allocation.
select pg_temp.engine_native_call('review_retract_intake2','record_native_dispense_return_v2',pg_temp.eid('review_retract_intake2'),
 jsonb_build_object('request',pg_temp.return_request(2,pg_temp.return_intent('retract_intake','engine_intake2','0.025','engine_intake2'))));
select pg_temp.engine_native_call('review_retract_disposal2','record_native_dispense_return_v2',pg_temp.eid('review_retract_disposal2'),
 jsonb_build_object('request',pg_temp.return_request(2,pg_temp.return_intent('retract_disposal','engine_intake2','0.025','engine_dispose2'))));
select pg_temp.engine_native_call('review_retract_restock2','record_native_dispense_return_v2',pg_temp.eid('review_retract_restock2'),
 jsonb_build_object('request',pg_temp.return_request(2,pg_temp.return_intent('retract_restock','engine_intake2','0.025','engine_restock2'))));

select pg_temp.engine_native_call('review_annotation_amended','append_native_dispense_correction',pg_temp.eid('review_annotation_amended'),
 jsonb_build_object('request',pg_temp.annotation_request('clinical_annotation')||jsonb_build_object('amends_event_id',pg_temp.eid('engine_annotation'))));
select pg_temp.engine_native_call('review_pickup_amended','append_native_dispense_correction',pg_temp.eid('review_pickup_amended'),
 jsonb_build_object('request',pg_temp.annotation_request('pickup_amendment')||jsonb_build_object('amends_event_id',pg_temp.eid('engine_amendment'))));

create function pg_temp.review_v3_discrepancy_request(action text,case_key text,correction_keys text[] default array[]::text[])
 returns jsonb language sql volatile as $$
 select jsonb_build_object('intent',intent,'expected_context_hash',p->>'context_hash',
  'expected_return_head',p#>'{context,return_head}','expected_discrepancy_head',p#>'{context,discrepancy_head}',
  'attest_physical_review',true,'attest_original_quantities_custody_and_stock_accurate',action='resolve_confirmed_original')
 from(select intent,preview_native_return_discrepancy(intent)p from(select jsonb_build_object(
  'target',jsonb_build_object('authorization_id',pg_temp.eid('sign'),'pet_id',pg_temp.eid('pet'),'dispense_id',pg_temp.eid('dispense2')),
  'action',action,'case_id',pg_temp.eid(case_key),
  'source',(select jsonb_build_object('event_id',id,'record_hash',record_hash)from public.native_return_events where id=pg_temp.eid('engine_dispose1')),
  'allocations',(select jsonb_agg(jsonb_build_object('allocation_id',a.id,'quantity','0.100')order by a.id)
   from public.native_dispense_allocations a where a.dispense_id=pg_temp.eid('dispense2')),
  'observation','Synthetic A1 v1 source review; no new quantity',
  'correction_ids',(select coalesce(jsonb_agg(pg_temp.eid(k)order by pg_temp.eid(k)),'[]'::jsonb)from unnest(correction_keys)k))intent)source)preview
$$;
select pg_temp.engine_native_call('review_report_v1_confirm','record_native_return_discrepancy',pg_temp.eid('review_report_v1_confirm'),
 jsonb_build_object('request',pg_temp.review_v3_discrepancy_request('report',null)));
select pg_temp.engine_native_call('review_note_v1','record_native_return_discrepancy',pg_temp.eid('review_note_v1'),
 jsonb_build_object('request',pg_temp.review_v3_discrepancy_request('note','review_report_v1_confirm')));
select pg_temp.engine_native_call('review_confirm_v1','record_native_return_discrepancy',pg_temp.eid('review_confirm_v1'),
 jsonb_build_object('request',pg_temp.review_v3_discrepancy_request('resolve_confirmed_original','review_report_v1_confirm')));
select pg_temp.engine_native_call('review_report_v1_correct','record_native_return_discrepancy',pg_temp.eid('review_report_v1_correct'),
 jsonb_build_object('request',pg_temp.review_v3_discrepancy_request('report',null)));
select pg_temp.engine_native_call('review_correct_v1_first','record_native_dispense_return_v2',pg_temp.eid('review_correct_v1_first'),
 jsonb_build_object('request',pg_temp.return_request(2,pg_temp.return_intent('retract_disposal','engine_intake1','0.040','engine_dispose1','review_report_v1_correct'))));
select pg_temp.engine_native_call('review_correct_v1_second','record_native_dispense_return_v2',pg_temp.eid('review_correct_v1_second'),
 jsonb_build_object('request',pg_temp.return_request(2,pg_temp.return_intent('retract_disposal','engine_intake1','0.060','engine_dispose1','review_report_v1_correct'))));
select pg_temp.engine_native_call('review_resolve_v1','record_native_return_discrepancy',pg_temp.eid('review_resolve_v1'),
 jsonb_build_object('request',pg_temp.review_v3_discrepancy_request('resolve_corrected','review_report_v1_correct',
  array['review_correct_v1_second','review_correct_v1_first'])));

-- Independent intent totals, including the old fixture's100.875/4.500/2.100.
-- Receive+adjust add1.250 available; restock retraction subtracts0.050 available.
-- Intake retraction adds0.050 prepared; net held adds0.250 across all corrections.
do $$declare f record;e public.controlled_stock_events%rowtype;collected jsonb;adapter jsonb;expected_target jsonb;expected_site_basis text;begin
 if(select sum(p.quantity)from public.controlled_stock_positions p join public.controlled_stock_cells c on c.id=p.cell_id
    join public.controlled_stock_containers b on b.id=c.container_id where b.product_id=pg_temp.eid('product')and c.channel='available')is distinct from 102.075
  or(select sum(p.quantity)from public.controlled_stock_positions p join public.controlled_stock_cells c on c.id=p.cell_id
    join public.controlled_stock_containers b on b.id=c.container_id where b.product_id=pg_temp.eid('product')and c.channel='prepared')is distinct from 4.550
  or(select sum(p.quantity)from public.controlled_stock_positions p join public.controlled_stock_cells c on c.id=p.cell_id
    join public.controlled_stock_containers b on b.id=c.container_id where b.product_id=pg_temp.eid('product')and c.channel='return_held')is distinct from 2.350 then
  raise exception 'A1 independent fixture quantities differ';end if;
 if(select count(*)from public.billing_invoice_items where invoice_id=pg_temp.eid('invoice'))<>4 then
  raise exception 'A1 receipt, custody and corrections must not add charges';end if;
 if(select count(distinct event_kind)from review_v3_fixture_cases)<>22 then
  raise exception 'A1 fixture literal-kind set incomplete';end if;
 for f in select * from review_v3_fixture_cases order by label loop
  select * into strict e from public.controlled_stock_events where id=pg_temp.eid(f.event_key);
  if e.event_kind<>f.event_kind or e.basis<>f.clock_basis
   or e.product_id<>pg_temp.eid('product')or e.actor_id<>'a5510000-0000-4000-8000-000000000001'::uuid
   or e.policy_version_id<>pg_temp.eid('engine_policy')or e.opening_id<>pg_temp.eid('engine_opening')or e.engine_revision<>1 then
   raise exception 'A1 genuine writer result disagrees with fixture intent';end if;
  collected:=controlled_review_v3.collect_event_sources(e.id);adapter:=collected->'adapter';
  if(select array_agg(k order by k)from jsonb_object_keys(collected)k)is distinct from array['adapter','source_rows']
   or(select array_agg(k order by k)from jsonb_object_keys(adapter)k)is distinct from
    array['adapter_id','event_kind','native_family_dispense_id','provenance_state','reason','site_basis','site_id','source_refs','target','version']then
   raise exception 'A1 collector envelope keys differ';end if;
  expected_target:=jsonb_build_object('event_id',pg_temp.eid(f.event_key),'product_id',pg_temp.eid('product'),
   'sequence',e.sequence,'record_hash',e.record_hash,'original_actor_id','a5510000-0000-4000-8000-000000000001'::uuid,
   'policy_version_id',pg_temp.eid('engine_policy'),'opening_id',pg_temp.eid('engine_opening'),'engine_revision',1);
  expected_site_basis:=case f.clock_basis when 'annotation'then 'managed_dispense'
   when 'discrepancy_assertion'then 'managed_return'else 'event_transitions'end;
  if adapter is distinct from controlled_review_v3.adapt_event(e.id)
   or adapter->'target'is distinct from expected_target
   or adapter->'version'is distinct from '1'::jsonb or adapter->>'event_kind'is distinct from f.event_kind
   or adapter->>'provenance_state'is distinct from 'supported' or adapter->'reason'is distinct from 'null'::jsonb
   or adapter->>'site_basis'is distinct from expected_site_basis or adapter->>'site_id'is distinct from pg_temp.eid('engine_site')::text
   or adapter->'native_family_dispense_id'is distinct from coalesce(to_jsonb(pg_temp.eid(f.family_key)),'null'::jsonb)
   or jsonb_typeof(adapter->'source_refs')is distinct from 'array'
   or jsonb_typeof(collected->'source_rows')is distinct from 'array'
   or jsonb_array_length(adapter->'source_refs')not between 1 and 512
   or jsonb_array_length(adapter->'source_refs')<>jsonb_array_length(collected->'source_rows')then
   raise exception 'A1 adapter target/site/family differs from independent fixture intent';end if;
 end loop;
 if exists(select 1 from review_v3_before_append b
   where controlled_review_v3.collect_event_sources(b.event_id)is distinct from b.collected)then
  raise exception 'A1 later genuine appends changed earlier collected evidence';end if;
end $$;
select public.controlled_stock_validate_event(id)from public.controlled_stock_events where product_id=pg_temp.eid('product')order by sequence;
select public.controlled_stock_validate_product(pg_temp.eid('product'));
set constraints all immediate;
commit;
