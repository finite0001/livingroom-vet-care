-- Exercise the actual canonical writers through the owned C1b wrapper.
create function pg_temp.clinical_request(q numeric)returns jsonb language sql volatile as $$
 select jsonb_build_object('pet_id',pg_temp.eid('pet'),'lot_id',pg_temp.eid('lot1'),'invoice_id',pg_temp.eid('invoice'),'quantity',q,
  'dose','Synthetic recorded dose only','route','Synthetic route','site','','veterinarian','Synthetic veterinarian','veterinarian_license','SYNTHETIC',
  'administered_at',to_char(clock_timestamp(),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'next_due_on',null,
  'alert_review',jsonb_build_object('source_hash',read_patient_treatment_alerts(pg_temp.eid('pet'))->>'source_hash','acknowledged',true))
$$;
select pg_temp.engine_native_call('treatment','record_patient_treatment',pg_temp.eid('engine_treatment'),jsonb_build_object('request',pg_temp.clinical_request(0.250)));
select save_patient_anesthesia_record(pg_temp.eid('engine_record'),pg_temp.eid('pet'),null,jsonb_build_object('procedure_name','Synthetic procedure',
 'started_at',to_char(clock_timestamp()-interval '1 hour','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'team','Synthetic team','source','manual','assessment','Synthetic assessment','plan','Synthetic plan'));
select pg_temp.engine_native_call('anesthesia','record_anesthesia_drug_administration',pg_temp.eid('engine_anesthesia'),jsonb_build_object('record_id',pg_temp.eid('engine_record'),
 'pet_id',pg_temp.eid('pet'),'request',pg_temp.clinical_request(1.500)-'pet_id'-'next_due_on'));
select pg_temp.engine_native_call('adjust','adjust_inventory',pg_temp.eid('engine_adjust'),jsonb_build_object('lot_id',pg_temp.eid('lot1'),'quantity','-0.125','reason','Synthetic physical count adjustment'));
create function pg_temp.fill_request(slot_version integer,q text,q1 text,q2 text)returns jsonb language sql volatile as $$
 select t||jsonb_build_object('expected_context_hash',preview_native_dispense(t)->>'context_hash',
  'reason','Synthetic managed filling','attest_alert_review',true,'attest_dispense_review',true)
 from(select jsonb_build_object('authorization_id',pg_temp.eid('sign'),'pet_id',pg_temp.eid('pet'),'slot_index',0,'expected_slot_version',slot_version,
  'invoice_id',pg_temp.eid('invoice'),'quantity',q,'allocations',jsonb_build_array(jsonb_build_object('lot_id',pg_temp.eid('lot1'),'quantity',q1),
   jsonb_build_object('lot_id',pg_temp.eid('lot2'),'quantity',q2)),'refill',null)t)source
$$;
select pg_temp.engine_native_call('fill_a','record_native_dispense',pg_temp.eid('dispense'),jsonb_build_object('request',pg_temp.fill_request(null,'10','4','6')));
select pg_temp.engine_native_call('fill_b','record_native_dispense',pg_temp.eid('dispense2'),jsonb_build_object('request',pg_temp.fill_request(1,'8','4','4')));
select pg_temp.engine_native_call('pickup','record_native_pickup',pg_temp.eid('engine_pickup'),jsonb_build_object('request',jsonb_build_object(
 'authorization_id',upper(pg_temp.eid('sign')::text),'pet_id',upper(pg_temp.eid('pet')::text),'dispense_id',upper(pg_temp.eid('dispense')::text),
 'expected_context_hash',preview_native_pickup(pg_temp.eid('dispense'),pg_temp.eid('pet'),null)->>'context_hash','recipient_name','Synthetic recipient',
 'recipient_relationship','Owner','reason','Synthetic complete handoff','attest_handoff',true,'refill_close',null)));
create function pg_temp.annotation_request(kind text)returns jsonb language sql volatile as $$
 select jsonb_build_object('authorization_id',pg_temp.eid('sign'),'pet_id',pg_temp.eid('pet'),'dispense_id',pg_temp.eid('dispense'),'kind',kind,
  'expected_context_hash',p->>'context_hash','expected_head',p#>'{context,head}','reason','Synthetic annotation','note','Synthetic assertion, not a new physical event',
  'amends_event_id',null,'pickup_amendment',case kind when 'pickup_amendment'then jsonb_build_object('original_pickup_id',pg_temp.eid('engine_pickup'),
   'disposition','recorded_in_error','handoff',null)else null end,'attest_review',true)
 from(select preview_native_dispense_correction(pg_temp.eid('sign'),pg_temp.eid('pet'),pg_temp.eid('dispense'))p)source
$$;
select pg_temp.engine_native_call('annotation','append_native_dispense_correction',pg_temp.eid('engine_annotation'),jsonb_build_object('request',pg_temp.annotation_request('clinical_annotation')));
select pg_temp.engine_native_call('operational','append_native_dispense_correction',pg_temp.eid('engine_operational'),jsonb_build_object('request',pg_temp.annotation_request('operational_annotation')));
select pg_temp.engine_native_call('pickup_assertion','append_native_dispense_correction',pg_temp.eid('engine_amendment'),jsonb_build_object('request',pg_temp.annotation_request('pickup_amendment')));
create function pg_temp.return_intent(action text,intake_key text,q text,target_key text default null,case_key text default null)returns jsonb language sql volatile as $$
 select jsonb_build_object('target',jsonb_build_object('authorization_id',pg_temp.eid('sign'),'pet_id',pg_temp.eid('pet'),'dispense_id',pg_temp.eid('dispense2')),
  'action',action,'intake_id',pg_temp.eid(intake_key),'allocations',(select jsonb_agg(jsonb_build_object('allocation_id',a.id,'quantity',q)order by a.id)from native_dispense_allocations a where a.dispense_id=pg_temp.eid('dispense2')),
  'custody',case when action='intake'then 'clinic_retained'else null end,'package_condition',case when action='intake'then 'sealed_intact'else null end,
  'storage_history',case when action='intake'then 'controlled'else null end,'reason','Synthetic clinic-retained custody','note','Synthetic record only')||
  case when target_key is not null or case_key is not null then jsonb_build_object('correction_target',case when target_key is not null then
   (select jsonb_build_object('event_id',e.id,'record_hash',e.record_hash)from native_return_events e where e.id=pg_temp.eid(target_key))else null end,
   'discrepancy_id',pg_temp.eid(case_key))else '{}'::jsonb end
$$;
create function pg_temp.return_request(version integer,intent jsonb)returns jsonb language plpgsql volatile as $$declare p jsonb;begin
 if version=1 then
  p:=preview_native_dispense_return(intent);
  return jsonb_build_object('intent',intent,'expected_context_hash',p->>'context_hash','expected_head',p#>'{context,head}','attest_review',true,'attest_restock',intent->>'action'='restock');
 end if;
 intent:=intent||jsonb_build_object('correction_target',intent->'correction_target','discrepancy_id',intent->'discrepancy_id');
 p:=preview_native_dispense_return_v2(intent);
 return jsonb_build_object('intent',intent,'expected_context_hash',p->>'context_hash','expected_head',p#>'{context,head}',
  'expected_discrepancy_head',p#>'{context,discrepancy_head}','attest_review',true,'attest_restock',intent->>'action'='restock',
  'physical_attestations',native_reconciliation_attestations(intent->>'action'));
end $$;
select pg_temp.engine_native_call('intake_v1','record_native_dispense_return',pg_temp.eid('engine_intake1'),jsonb_build_object('request',
 pg_temp.return_request(1,pg_temp.return_intent('intake',null,'2'))));
select pg_temp.engine_native_call('dispose_v1','record_native_dispense_return',pg_temp.eid('engine_dispose1'),jsonb_build_object('request',
 pg_temp.return_request(1,pg_temp.return_intent('dispose','engine_intake1','0.500'))));
select configure_native_return_policy(gen_random_uuid(),'{"expected_version":0,"enabled":true,"review_reference":"SYNTHETIC ONLY","attest_review":true}');
select pg_temp.engine_native_call('restock_v1','record_native_dispense_return',pg_temp.eid('engine_restock1'),jsonb_build_object('request',
 pg_temp.return_request(1,pg_temp.return_intent('restock','engine_intake1','0.500'))));
select pg_temp.engine_native_call('retract_disposal','record_native_dispense_return_v2',pg_temp.eid('engine_retract_dispose1'),jsonb_build_object('request',
 pg_temp.return_request(2,pg_temp.return_intent('retract_disposal','engine_intake1','0.250','engine_dispose1'))));
select pg_temp.engine_native_call('retract_restock','record_native_dispense_return_v2',pg_temp.eid('engine_retract_restock1'),jsonb_build_object('request',
 pg_temp.return_request(2,pg_temp.return_intent('retract_restock','engine_intake1','0.250','engine_restock1'))));
select pg_temp.engine_native_call('retract_intake','record_native_dispense_return_v2',pg_temp.eid('engine_retract_intake1'),jsonb_build_object('request',
 pg_temp.return_request(2,pg_temp.return_intent('retract_intake','engine_intake1','0.500','engine_intake1'))));
select pg_temp.engine_native_call('intake_v2','record_native_dispense_return_v2',pg_temp.eid('engine_intake2'),jsonb_build_object('request',
 pg_temp.return_request(2,pg_temp.return_intent('intake',null,'0.250'))));
select pg_temp.engine_native_call('dispose_v2','record_native_dispense_return_v2',pg_temp.eid('engine_dispose2'),jsonb_build_object('request',
 pg_temp.return_request(2,pg_temp.return_intent('dispose','engine_intake2','0.125'))));
select pg_temp.engine_native_call('restock_v2','record_native_dispense_return_v2',pg_temp.eid('engine_restock2'),jsonb_build_object('request',
 pg_temp.return_request(2,pg_temp.return_intent('restock','engine_intake2','0.125'))));
create function pg_temp.discrepancy_request(action text,case_key text,correction_key text default null)returns jsonb language sql volatile as $$
 select jsonb_build_object('intent',intent,'expected_context_hash',p->>'context_hash','expected_return_head',p#>'{context,return_head}',
  'expected_discrepancy_head',p#>'{context,discrepancy_head}','attest_physical_review',true,'attest_original_quantities_custody_and_stock_accurate',action='resolve_confirmed_original')
 from(select intent,preview_native_return_discrepancy(intent)p from(select jsonb_build_object(
  'target',jsonb_build_object('authorization_id',pg_temp.eid('sign'),'pet_id',pg_temp.eid('pet'),'dispense_id',pg_temp.eid('dispense2')),
  'action',action,'case_id',pg_temp.eid(case_key),'source',(select jsonb_build_object('event_id',id,'record_hash',record_hash)from native_return_events where id=pg_temp.eid('engine_dispose2')),
  'allocations',(select jsonb_agg(jsonb_build_object('allocation_id',a.id,'quantity','0.050')order by a.id)from native_dispense_allocations a where a.dispense_id=pg_temp.eid('dispense2')),
  'observation','Synthetic source review, not a new quantity','correction_ids',case when correction_key is null then '[]'::jsonb else jsonb_build_array(pg_temp.eid(correction_key))end)intent)source)preview
$$;
select pg_temp.engine_native_call('report_1','record_native_return_discrepancy',pg_temp.eid('engine_report1'),jsonb_build_object('request',pg_temp.discrepancy_request('report',null)));
select pg_temp.engine_native_call('note_1','record_native_return_discrepancy',pg_temp.eid('engine_note1'),jsonb_build_object('request',pg_temp.discrepancy_request('note','engine_report1')));
select pg_temp.engine_native_call('confirm_1','record_native_return_discrepancy',pg_temp.eid('engine_resolve1'),jsonb_build_object('request',pg_temp.discrepancy_request('resolve_confirmed_original','engine_report1')));
select pg_temp.engine_native_call('report_2','record_native_return_discrepancy',pg_temp.eid('engine_report2'),jsonb_build_object('request',pg_temp.discrepancy_request('report',null)));
select pg_temp.engine_native_call('case_retract','record_native_dispense_return_v2',pg_temp.eid('engine_case_retract'),jsonb_build_object('request',
 pg_temp.return_request(2,pg_temp.return_intent('retract_disposal','engine_intake2','0.050','engine_dispose2','engine_report2'))));
select pg_temp.engine_native_call('corrected_2','record_native_return_discrepancy',pg_temp.eid('engine_resolve2'),jsonb_build_object('request',pg_temp.discrepancy_request('resolve_corrected','engine_report2','engine_case_retract')));

do $$declare receipt jsonb;expected_total numeric;begin
 if(select sum(quantity)from inventory_movements m join inventory_lots l on l.id=m.lot_id where l.product_id=pg_temp.eid('product'))<>100.875 then
  raise exception 'Canonical final available quantity mismatch';end if;
 if(select sum(p.quantity)from controlled_stock_positions p join controlled_stock_cells c on c.id=p.cell_id where c.channel='available')<>100.875
  or(select sum(p.quantity)from controlled_stock_positions p join controlled_stock_cells c on c.id=p.cell_id where c.channel='prepared')<>4.500
  or(select sum(p.quantity)from controlled_stock_positions p join controlled_stock_cells c on c.id=p.cell_id where c.channel='return_held')<>2.100 then
  raise exception 'Independent final available/prepared/held quantities do not reconcile';end if;
 if(select count(*)from billing_invoice_items)<>4 or(select sum(amount_cents)from billing_invoice_items)<>1975 then
  raise exception 'Controlled clinical/fill actions must charge once; custody/corrections must not charge';end if;
 if(select count(*)from inventory_movements where id=pg_temp.eid('engine_anesthesia'))<>1
  or(select writer from stock_movement_sources where movement_id=pg_temp.eid('engine_anesthesia'))<>'record_anesthesia_drug_administration'
  or(select count(*)from billing_invoice_items where id=pg_temp.eid('engine_anesthesia'))<>1 then
  raise exception 'Nested anesthesia must retain one treatment, debit, source and charge';end if;
 select result into receipt from engine_native_results where k='anesthesia';
 if receipt->'canonical_result'is distinct from(select to_jsonb(t)from patient_treatments t where t.id=pg_temp.eid('engine_anesthesia'))then
  raise exception 'Anesthesia did not preserve actual treatment receipt';end if;
 if not exists(select 1 from controlled_stock_container_heads where container_id=pg_temp.eid('engine_box1')and status='handed_off'and location_id is null and custodian_id is null)
  or exists(select 1 from controlled_stock_positions p join controlled_stock_cells c on c.id=p.cell_id where c.container_id=pg_temp.eid('engine_box1')and p.quantity<>0)then
  raise exception 'Handoff or disputed amendment changed physical custody incorrectly';end if;
 if native_reconciliation_lot_held(pg_temp.eid('lot1'))or native_reconciliation_lot_held(pg_temp.eid('lot2'))then raise exception 'Resolved native holds unexpectedly remained';end if;
 if(read_native_fulfillment(pg_temp.eid('sign'),pg_temp.eid('pet'))#>>'{usage,dispensed_quantity}')::numeric<>18 then
  raise exception 'Returns or corrections changed native allowance consumption';end if;
 if exists(select 1 from controlled_stock_execution_contexts)then raise exception 'Owned execution context leaked';end if;
 if(select count(distinct writer)from engine_native_results)<>9 then raise exception 'Nine managed producers required in this fixture (receiving is tested separately)';end if;
end $$;
select controlled_stock_validate_event(id)from controlled_stock_events order by sequence;
select controlled_stock_validate_product(pg_temp.eid('product'));
set constraints all immediate;
select jsonb_build_object('synthetic_only',true,'sql_only',true,'managed_canonical_actions',(select count(*)from engine_native_results),
 'managed_producers',9,'all_six_return_actions',true,'all_four_discrepancy_actions',true,'all_three_correction_kinds',true,
 'available','100.875','prepared','4.500','return_held','2.100','billing_items',4,'billing_cents',1975,
 'anesthesia_one_treatment_debit_charge',true,'mixed_case_pickup_uuid_preserved',true,'pickup_amendment_did_not_restore_custody',true,
 'native_holds_resolved_without_quantity_change',true,'private_context_cleared',true,'provider_requests',0);
commit;
