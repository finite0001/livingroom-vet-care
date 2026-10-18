-- OWNED CLONE ONLY. Historical records below use the real canonical writers.
-- They precede synthetic controlled configuration; no historical row is fabricated.
begin;set local timezone='UTC';
select set_config('request.jwt.claims','{"role":"authenticated","sub":"a5510000-0000-4000-8000-000000000001"}',true);
create function pg_temp.oid(key text)returns uuid language sql stable as $$select id from fx where k=key$$;
insert into fx select key,gen_random_uuid()from unnest(array['opening_pickup','opening_intake_zero','opening_dispose_zero',
 'opening_intake_held','opening_restock','opening_intake_retracted','opening_retract','opening_annotation','opening_discrepancy_report','opening_discrepancy_resolve','opening_split_package'])key;
create function pg_temp.opening_fill(version integer)returns jsonb language sql volatile as $$
 select t||jsonb_build_object('expected_context_hash',preview_native_dispense(t)->>'context_hash','reason','Synthetic pre-opening legacy fill',
 'attest_alert_review',true,'attest_dispense_review',true)from(select jsonb_build_object('authorization_id',pg_temp.oid('sign'),
 'pet_id',pg_temp.oid('pet'),'slot_index',0,'expected_slot_version',version,'invoice_id',pg_temp.oid('invoice'),'quantity','10',
 'allocations',jsonb_build_array(jsonb_build_object('lot_id',pg_temp.oid('lot1'),'quantity','4'),jsonb_build_object('lot_id',pg_temp.oid('lot2'),'quantity','6')),'refill',null)t)s
$$;
select record_native_dispense(pg_temp.oid('dispense'),pg_temp.opening_fill(null));
select record_native_dispense(pg_temp.oid('dispense2'),pg_temp.opening_fill(1));
select record_native_dispense(pg_temp.oid('dispense3'),pg_temp.opening_fill(2));
select record_native_pickup(pg_temp.oid('opening_pickup'),jsonb_build_object('authorization_id',pg_temp.oid('sign'),'pet_id',pg_temp.oid('pet'),
 'dispense_id',pg_temp.oid('dispense3'),'expected_context_hash',preview_native_pickup(pg_temp.oid('dispense3'),pg_temp.oid('pet'),null)->>'context_hash',
 'recipient_name','Synthetic legacy recipient','recipient_relationship','Owner','reason','Synthetic pre-opening handoff','attest_handoff',true,'refill_close',null));
create function pg_temp.opening_intent(action text,intake uuid,q text,target uuid default null)returns jsonb language sql volatile as $$
 select jsonb_build_object('target',jsonb_build_object('authorization_id',pg_temp.oid('sign'),'pet_id',pg_temp.oid('pet'),'dispense_id',pg_temp.oid('dispense2')),
 'action',action,'intake_id',intake,'allocations',(select jsonb_agg(jsonb_build_object('allocation_id',a.id,'quantity',q)order by a.id)from native_dispense_allocations a where a.dispense_id=pg_temp.oid('dispense2')),
 'custody',case when action='intake'then 'clinic_retained'else null end,'package_condition',case when action='intake'then 'sealed_intact'else null end,
 'storage_history',case when action='intake'then 'controlled'else null end,'reason','Synthetic pre-opening custody','note','Synthetic engineering record only')||
 case when target is null then '{}'::jsonb else jsonb_build_object('correction_target',(select jsonb_build_object('event_id',id,'record_hash',record_hash)from native_return_events where id=target),'discrepancy_id',null)end
$$;
create function pg_temp.opening_return_request(version integer,intent jsonb)returns jsonb language plpgsql volatile as $$declare p jsonb;begin
 if version=1 then p:=preview_native_dispense_return(intent);return jsonb_build_object('intent',intent,'expected_context_hash',p->>'context_hash','expected_head',p#>'{context,head}',
 'attest_review',true,'attest_restock',intent->>'action'='restock');end if;
 intent:=intent||jsonb_build_object('correction_target',intent->'correction_target','discrepancy_id',intent->'discrepancy_id');
 p:=preview_native_dispense_return_v2(intent);return jsonb_build_object('intent',intent,'expected_context_hash',p->>'context_hash','expected_head',p#>'{context,head}',
 'expected_discrepancy_head',p#>'{context,discrepancy_head}','attest_review',true,'attest_restock',intent->>'action'='restock','physical_attestations',native_reconciliation_attestations(intent->>'action'));
end$$;
select record_native_dispense_return(pg_temp.oid('opening_intake_zero'),pg_temp.opening_return_request(1,pg_temp.opening_intent('intake',null,'1')));
select record_native_dispense_return(pg_temp.oid('opening_dispose_zero'),pg_temp.opening_return_request(1,pg_temp.opening_intent('dispose',pg_temp.oid('opening_intake_zero'),'1')));
select record_native_dispense_return(pg_temp.oid('opening_intake_held'),pg_temp.opening_return_request(1,pg_temp.opening_intent('intake',null,'0.5')));
select configure_native_return_policy(gen_random_uuid(),'{"expected_version":0,"enabled":true,"review_reference":"SYNTHETIC PRE-OPENING ONLY","attest_review":true}');
select record_native_dispense_return(pg_temp.oid('opening_restock'),pg_temp.opening_return_request(1,pg_temp.opening_intent('restock',pg_temp.oid('opening_intake_held'),'0.125')));
select record_native_dispense_return(pg_temp.oid('opening_intake_retracted'),pg_temp.opening_return_request(1,pg_temp.opening_intent('intake',null,'0.25')));
select record_native_dispense_return_v2(pg_temp.oid('opening_retract'),pg_temp.opening_return_request(2,pg_temp.opening_intent('retract_intake',pg_temp.oid('opening_intake_retracted'),'0.25',pg_temp.oid('opening_intake_retracted'))));
select append_native_dispense_correction(pg_temp.oid('opening_annotation'),jsonb_build_object('authorization_id',pg_temp.oid('sign'),'pet_id',pg_temp.oid('pet'),
 'dispense_id',pg_temp.oid('dispense2'),'kind','clinical_annotation','expected_context_hash',p->>'context_hash','expected_head',p#>'{context,head}',
 'reason','Synthetic pre-opening annotation','note','Synthetic engineering annotation','amends_event_id',null,'pickup_amendment',null,'attest_review',true))
 from(select preview_native_dispense_correction(pg_temp.oid('sign'),pg_temp.oid('pet'),pg_temp.oid('dispense2'))p)q;
create function pg_temp.opening_discrepancy(action text,case_id uuid)returns jsonb language sql volatile as $$
 select jsonb_build_object('intent',intent,'expected_context_hash',p->>'context_hash','expected_return_head',p#>'{context,return_head}',
 'expected_discrepancy_head',p#>'{context,discrepancy_head}','attest_physical_review',true,'attest_original_quantities_custody_and_stock_accurate',action='resolve_confirmed_original')
 from(select intent,preview_native_return_discrepancy(intent)p from(select jsonb_build_object('target',jsonb_build_object('authorization_id',pg_temp.oid('sign'),'pet_id',pg_temp.oid('pet'),'dispense_id',pg_temp.oid('dispense2')),
 'action',action,'case_id',case_id,'source',(select jsonb_build_object('event_id',id,'record_hash',record_hash)from native_return_events where id=pg_temp.oid('opening_dispose_zero')),
 'allocations',(select jsonb_agg(jsonb_build_object('allocation_id',a.id,'quantity','0.050')order by a.id)from native_dispense_allocations a where a.dispense_id=pg_temp.oid('dispense2')),
 'observation','Synthetic pre-opening source review','correction_ids','[]'::jsonb)intent)source)preview
$$;
select record_native_return_discrepancy(pg_temp.oid('opening_discrepancy_report'),pg_temp.opening_discrepancy('report',null));
select record_native_return_discrepancy(pg_temp.oid('opening_discrepancy_resolve'),pg_temp.opening_discrepancy('resolve_confirmed_original',pg_temp.oid('opening_discrepancy_report')));
commit;

-- The Python owner substitutes only the existing private configuration prefix.
-- OWNED_PRIVATE_CONFIGURATION --
create temp table opening_fixture_boundary(value jsonb);
insert into opening_fixture_boundary select jsonb_agg(controlled_stock_opening_native_entry_for_product(pg_temp.oid('product'),'tablet',d.id,
 (select count(*)::integer from native_return_events e where e.dispense_id=d.id),(select count(*)::integer from native_dispense_correction_events e where e.dispense_id=d.id),
 (select count(*)::integer from native_return_discrepancy_events e where e.dispense_id=d.id),(select id from native_pickups p where p.dispense_id=d.id))order by d.id)
 from native_dispenses d where d.id in(pg_temp.oid('dispense'),pg_temp.oid('dispense2'),pg_temp.oid('dispense3'));
insert into controlled_stock_openings(id,product_id,policy_version_id,observed_at,count_evidence,native_custody_boundary,actor_id,session_id)
 select pg_temp.oid('engine_opening'),pg_temp.oid('product'),pg_temp.oid('engine_policy'),clock_timestamp(),'{"synthetic":true,"not_practice_physical_count":true}',value,auth.uid(),pg_temp.oid('engine_session')from opening_fixture_boundary;
insert into controlled_stock_opening_movements(opening_id,movement_id,lot_id,quantity,source_snapshot)
 select pg_temp.oid('engine_opening'),m.id,m.lot_id,m.quantity,to_jsonb(m)from inventory_movements m join inventory_lots l on l.id=m.lot_id where l.product_id=pg_temp.oid('product');
insert into controlled_stock_containers(id,product_id,stock_unit,label,kind,stock_lot_id,controlling_site_id,initial_location_id,initial_custodian_id,opening_id,actor_id,session_id)
 select pg_temp.oid('engine_stock'||n),pg_temp.oid('product'),'tablet','Synthetic opening stock '||n,'stock',pg_temp.oid('lot'||n),pg_temp.oid('engine_site'),pg_temp.oid('engine_location'),auth.uid(),pg_temp.oid('engine_opening'),auth.uid(),pg_temp.oid('engine_session')from generate_series(1,2)n;
create temp table opening_packages(dispense_id uuid primary key,container_id uuid not null);
insert into opening_packages values(pg_temp.oid('dispense'),pg_temp.oid('engine_box1')),(pg_temp.oid('dispense2'),pg_temp.oid('engine_box2'));
insert into controlled_stock_containers(id,product_id,stock_unit,label,kind,stock_lot_id,controlling_site_id,initial_location_id,initial_custodian_id,opening_id,actor_id,session_id)
 select p.container_id,pg_temp.oid('product'),'tablet','Synthetic legacy package','prepared',null,pg_temp.oid('engine_site'),pg_temp.oid('engine_location'),auth.uid(),pg_temp.oid('engine_opening'),auth.uid(),pg_temp.oid('engine_session')from opening_packages p;
-- Split exactly one B allocation between two real opening containers.
-- Both containers/cells are constructed before the immutable opening commits.
insert into controlled_stock_containers(id,product_id,stock_unit,label,kind,stock_lot_id,controlling_site_id,initial_location_id,initial_custodian_id,opening_id,actor_id,session_id)
 values(pg_temp.oid('opening_split_package'),pg_temp.oid('product'),'tablet','Synthetic split legacy B package','prepared',null,
 pg_temp.oid('engine_site'),pg_temp.oid('engine_location'),auth.uid(),pg_temp.oid('engine_opening'),auth.uid(),pg_temp.oid('engine_session'));
insert into controlled_stock_container_heads(container_id,version,location_id,custodian_id,status)
 select id,0,initial_location_id,initial_custodian_id,'onsite'from controlled_stock_containers where opening_id=pg_temp.oid('engine_opening');
insert into controlled_stock_cells(id,container_id,lot_id,channel,opening_id,opening_quantity)
 select gen_random_uuid(),pg_temp.oid('engine_stock'||n),pg_temp.oid('lot'||n),'available',pg_temp.oid('engine_opening'),
 (select sum(quantity)from inventory_movements where lot_id=pg_temp.oid('lot'||n))from generate_series(1,2)n;
insert into controlled_stock_cells(id,container_id,lot_id,channel,dispense_id,allocation_id,opening_id,opening_quantity)
 select gen_random_uuid(),p.container_id,(a->>'lot_id')::uuid,'prepared',p.dispense_id,(a->>'allocation_id')::uuid,pg_temp.oid('engine_opening'),(a->>'prepared_quantity')::numeric/case when p.dispense_id=pg_temp.oid('dispense2')and(a->>'lot_id')::uuid=pg_temp.oid('lot1')then 2 else 1 end
 from opening_fixture_boundary b cross join lateral jsonb_array_elements(b.value)e join opening_packages p on p.dispense_id=(e->>'dispense_id')::uuid cross join lateral jsonb_array_elements(e->'allocations')a;
insert into controlled_stock_cells(id,container_id,lot_id,channel,dispense_id,allocation_id,opening_id,opening_quantity)
 select gen_random_uuid(),pg_temp.oid('opening_split_package'),(a->>'lot_id')::uuid,'prepared',pg_temp.oid('dispense2'),(a->>'allocation_id')::uuid,
 pg_temp.oid('engine_opening'),(a->>'prepared_quantity')::numeric/2
 from opening_fixture_boundary b cross join lateral jsonb_array_elements(b.value)e cross join lateral jsonb_array_elements(e->'allocations')a
 where(e->>'dispense_id')::uuid=pg_temp.oid('dispense2')and(a->>'lot_id')::uuid=pg_temp.oid('lot1');
insert into controlled_stock_cells(id,container_id,lot_id,channel,dispense_id,allocation_id,intake_id,opening_id,opening_quantity)
 select gen_random_uuid(),p.container_id,(a->>'lot_id')::uuid,'return_held',p.dispense_id,(a->>'allocation_id')::uuid,(h->>'intake_id')::uuid,pg_temp.oid('engine_opening'),(h->>'quantity')::numeric
 from opening_fixture_boundary b cross join lateral jsonb_array_elements(b.value)e join opening_packages p on p.dispense_id=(e->>'dispense_id')::uuid cross join lateral jsonb_array_elements(e->'allocations')a cross join lateral jsonb_array_elements(a->'held')h;
insert into controlled_stock_positions select id,opening_quantity from controlled_stock_cells where opening_id=pg_temp.oid('engine_opening');
select controlled_stock_validate_opening(pg_temp.oid('engine_opening'));
select controlled_stock_validate_product(pg_temp.oid('product'));
set constraints all immediate;
commit;

begin;set local timezone='UTC';
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub','a5510000-0000-4000-8000-000000000001','session_id',pg_temp.oid('engine_session'))::text,true);
select controlled_stock_exclusive();
create function pg_temp.opening_snapshot()returns jsonb language plpgsql volatile as $$declare r record;v jsonb;result jsonb:='{}';begin
 for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','auth','storage','extensions')and c.relkind in('r','p')order by 1,2 loop
 execute format('select jsonb_build_object(''count'',count(*),''hash'',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,''|''order by to_jsonb(t)::text),''''),''UTF8'')),''hex''))from %I.%I t',r.nspname,r.relname)into v;
 result:=result||jsonb_build_object(r.nspname||'.'||r.relname,v);end loop;return result;end$$;
create temp table opening_rejections(label text primary key,failure_detail text not null);
create temp table opening_assertions(label text primary key);
create function pg_temp.opening_assert(value boolean,label text)returns void language plpgsql as $$begin if value is distinct from true then raise exception 'Opening assertion failed: %',label;end if;insert into opening_assertions values(label);end$$;
create function pg_temp.opening_reject(label text,command text)returns void language plpgsql volatile as $$declare before_value jsonb:=pg_temp.opening_snapshot();manifest jsonb:=controlled_stock_manifest_snapshot();armed boolean:=false;failure text;begin
 begin
 execute command;armed:=true;perform controlled_stock_validate_opening(pg_temp.oid('engine_opening'));set constraints all immediate;
 raise exception 'Invalid opening % unexpectedly accepted',label using errcode='P0002';
 exception when check_violation then if not armed then raise exception 'Mutation blocked before independent opening validation: %',label using errcode='P0003';end if;get stacked diagnostics failure=MESSAGE_TEXT;end;
 if before_value is distinct from pg_temp.opening_snapshot()or manifest is distinct from controlled_stock_manifest_snapshot()then raise exception 'Opening corruption probe % did not roll back exactly',label;end if;
 insert into opening_rejections values(label,failure);
end$$;
-- These privileged corruption attempts exist only inside exception subtransactions.
select pg_temp.opening_reject('omitted_dispense',$q$alter table controlled_stock_openings disable trigger immutable;update controlled_stock_openings set native_custody_boundary=native_custody_boundary-0$q$);
select pg_temp.opening_reject('duplicate_dispense',$q$alter table controlled_stock_openings disable trigger immutable;update controlled_stock_openings set native_custody_boundary=native_custody_boundary||jsonb_build_array(native_custody_boundary->0)$q$);
select pg_temp.opening_reject('forged_dispense_hash',$q$alter table controlled_stock_openings disable trigger immutable;update controlled_stock_openings set native_custody_boundary=jsonb_set(native_custody_boundary,'{0,dispense_document_hash}',to_jsonb(repeat('0',64)))$q$);
select pg_temp.opening_reject('extra_boundary_key',$q$alter table controlled_stock_openings disable trigger immutable;update controlled_stock_openings set native_custody_boundary=jsonb_set(native_custody_boundary,'{0,unexpected}','true')$q$);
select pg_temp.opening_reject('forged_prefix_head',$q$alter table controlled_stock_openings disable trigger immutable;update controlled_stock_openings set native_custody_boundary=(select jsonb_agg(case when e->>'dispense_id'=pg_temp.oid('dispense2')::text then jsonb_set(e,'{return_head,record_hash}',to_jsonb(repeat('0',64)))else e end order by e->>'dispense_id')from jsonb_array_elements(native_custody_boundary)e)$q$);
select pg_temp.opening_reject('missing_zero_intake_history',$q$alter table controlled_stock_openings disable trigger immutable;update controlled_stock_openings set native_custody_boundary=(select jsonb_agg(case when e->>'dispense_id'=pg_temp.oid('dispense2')::text then jsonb_set(e,'{allocations,0,held}',(e#>'{allocations,0,held}')-0)else e end order by e->>'dispense_id')from jsonb_array_elements(native_custody_boundary)e)$q$);
select pg_temp.opening_reject('missing_original_movement',$q$alter table controlled_stock_opening_movements disable trigger immutable;delete from controlled_stock_opening_movements where movement_id=(select movement_id from native_dispense_allocations where dispense_id=pg_temp.oid('dispense')limit 1)$q$);
select pg_temp.opening_reject('changed_original_movement_snapshot',$q$alter table controlled_stock_opening_movements disable trigger immutable;update controlled_stock_opening_movements set source_snapshot=source_snapshot||'{"forged":true}'where movement_id=(select movement_id from native_dispense_allocations where dispense_id=pg_temp.oid('dispense')limit 1)$q$);
select pg_temp.opening_reject('prepared_quantity_too_high',$q$alter table controlled_stock_cells disable trigger immutable;update controlled_stock_cells set opening_quantity=opening_quantity+0.125 where id=(select id from controlled_stock_cells where channel='prepared'limit 1)$q$);
select pg_temp.opening_reject('prepared_quantity_too_low',$q$alter table controlled_stock_cells disable trigger immutable;update controlled_stock_cells set opening_quantity=opening_quantity-0.125 where id=(select id from controlled_stock_cells where channel='prepared'and opening_quantity>0 limit 1)$q$);
select pg_temp.opening_reject('held_quantity_too_high',$q$alter table controlled_stock_cells disable trigger immutable;update controlled_stock_cells set opening_quantity=opening_quantity+0.125 where id=(select id from controlled_stock_cells where channel='return_held'and opening_quantity>0 limit 1)$q$);
select pg_temp.opening_reject('held_quantity_too_low',$q$alter table controlled_stock_cells disable trigger immutable;update controlled_stock_cells set opening_quantity=opening_quantity-0.125 where id=(select id from controlled_stock_cells where channel='return_held'and opening_quantity>0 limit 1)$q$);
select pg_temp.opening_reject('missing_prepared_cell',$q$alter table controlled_stock_positions disable trigger controlled_guard;alter table controlled_stock_cells disable trigger immutable;delete from controlled_stock_positions where cell_id=(select id from controlled_stock_cells where channel='prepared'limit 1);delete from controlled_stock_cells where id=(select id from controlled_stock_cells where channel='prepared'limit 1)$q$);
select pg_temp.opening_reject('handed_off_custody_claimed_onsite',$q$alter table controlled_stock_openings disable trigger immutable;update controlled_stock_openings set native_custody_boundary=(select jsonb_agg(case when e->>'dispense_id'=pg_temp.oid('dispense3')::text then jsonb_set(e,'{pickup}','null')else e end order by e->>'dispense_id')from jsonb_array_elements(native_custody_boundary)e)$q$);
select pg_temp.opening_reject('pickup_document_hash_forged',$q$alter table controlled_stock_openings disable trigger immutable;update controlled_stock_openings set native_custody_boundary=(select jsonb_agg(case when e->>'dispense_id'=pg_temp.oid('dispense3')::text then jsonb_set(e,'{pickup,document_hash}',to_jsonb(repeat('0',64)))else e end order by e->>'dispense_id')from jsonb_array_elements(native_custody_boundary)e)$q$);
select pg_temp.opening_reject('foreign_boundary_dispense',$q$alter table controlled_stock_openings disable trigger immutable;update controlled_stock_openings set native_custody_boundary=jsonb_set(native_custody_boundary,'{0,dispense_id}',to_jsonb(gen_random_uuid()::text))$q$);
select pg_temp.opening_reject('pickup_operation_request_forged',$q$alter table native_fulfillment_operations disable trigger native_fulfillment_immutable;update native_fulfillment_operations set request=request||'{"reason":"forged historical pickup"}',request_hash=native_fulfillment_hash(jsonb_build_object('version',1,'actor_id',actor_id,'operation',operation,'request',request||'{"reason":"forged historical pickup"}'))where id=pg_temp.oid('opening_pickup')$q$);
select pg_temp.opening_reject('pickup_operation_result_forged',$q$alter table native_fulfillment_operations disable trigger native_fulfillment_immutable;update native_fulfillment_operations set result=result||'{"forged":true}'where id=pg_temp.oid('opening_pickup')$q$);
select pg_temp.opening_reject('pickup_original_row_forged',$q$alter table native_pickups disable trigger native_fulfillment_immutable;update native_pickups set picked_up_at=picked_up_at-interval '1 second'where id=pg_temp.oid('opening_pickup')$q$);
select pg_temp.opening_reject('return_prefix_zero_over_nonzero_legacy',$q$alter table controlled_stock_openings disable trigger immutable;update controlled_stock_openings set native_custody_boundary=(select jsonb_agg(case when e->>'dispense_id'=pg_temp.oid('dispense2')::text then e||jsonb_build_object('return_head',jsonb_build_object('event_id',null,'version',0,'record_hash',null))else e end order by e->>'dispense_id')from jsonb_array_elements(native_custody_boundary)e)$q$);
select pg_temp.opening_reject('dispense_operation_quantity_forged_rehashed',$q$alter table native_fulfillment_operations disable trigger native_fulfillment_immutable;update native_fulfillment_operations set request=jsonb_set(request,'{quantity}','"11"'),request_hash=native_fulfillment_hash(jsonb_build_object('version',1,'actor_id',actor_id,'operation',operation,'request',jsonb_set(request,'{quantity}','"11"')))where id=pg_temp.oid('dispense')$q$);
-- Numerically identical valid request, rehashed correctly AFTER opening binding.
-- Exact original request/target binding rejects this before receipt-hash comparison.
select pg_temp.opening_reject('dispense_operation_equivalent_decimal_changed_after_boundary',$q$alter table native_fulfillment_operations disable trigger native_fulfillment_immutable;update native_fulfillment_operations set request=jsonb_set(request,'{quantity}','"10.0"'),request_hash=native_fulfillment_hash(jsonb_build_object('version',1,'actor_id',actor_id,'operation',operation,'request',jsonb_set(request,'{quantity}','"10.0"')))where id=pg_temp.oid('dispense')$q$);
select pg_temp.opening_reject('foreign_allocation_identity',$q$alter table controlled_stock_openings disable trigger immutable;update controlled_stock_openings set native_custody_boundary=jsonb_set(native_custody_boundary,'{0,allocations,0,allocation_id}',to_jsonb(gen_random_uuid()::text))$q$);
select pg_temp.opening_reject('missing_current_pickup_provenance',$q$alter table stock_pickup_sources disable trigger immutable;delete from stock_pickup_sources where event_id=pg_temp.oid('opening_pickup')$q$);
select pg_temp.opening_reject('missing_current_movement_provenance',$q$alter table stock_movement_sources disable trigger immutable;delete from stock_movement_sources where movement_id=(select movement_id from native_dispense_allocations where dispense_id=pg_temp.oid('dispense')limit 1)$q$);
select pg_temp.opening_reject('unresolved_discrepancy_at_prefix',$q$alter table controlled_stock_openings disable trigger immutable;update controlled_stock_openings set native_custody_boundary=(select jsonb_agg(case when e->>'dispense_id'=pg_temp.oid('dispense2')::text then e||jsonb_build_object('discrepancy_head',(select jsonb_build_object('event_id',id,'version',sequence,'record_hash',record_hash)from native_return_discrepancy_events where id=pg_temp.oid('opening_discrepancy_report')))else e end order by e->>'dispense_id')from jsonb_array_elements(native_custody_boundary)e)$q$);
select pg_temp.opening_reject('discrepancy_source_beyond_retained_return_prefix',$q$alter table controlled_stock_openings disable trigger immutable;update controlled_stock_openings set native_custody_boundary=(select jsonb_agg(case when e->>'dispense_id'=pg_temp.oid('dispense2')::text then e||jsonb_build_object('return_head',(select jsonb_build_object('event_id',id,'version',sequence,'record_hash',record_hash)from native_return_events where id=pg_temp.oid('opening_intake_zero')))else e end order by e->>'dispense_id')from jsonb_array_elements(native_custody_boundary)e)$q$);
select pg_temp.opening_assert((select state from controlled_stock_state_events where id=(select head_id from controlled_stock_states where product_id=pg_temp.oid('product')))='opening_frozen','validates before active attachment');
select pg_temp.opening_assert((select count(*)from native_dispenses)=3,'three actual canonical legacy dispenses');
select pg_temp.opening_assert((select count(*)from native_return_events)=6,'six actual canonical legacy return records');
select pg_temp.opening_assert((select sum(opening_quantity)from controlled_stock_cells where channel='available'and lot_id=pg_temp.oid('lot1'))=8.125,'lot1 available independently20 minus12 plus0.125');
select pg_temp.opening_assert((select sum(opening_quantity)from controlled_stock_cells where channel='available'and lot_id=pg_temp.oid('lot2'))=82.125,'lot2 available independently100 minus18 plus0.125');
select pg_temp.opening_assert((select sum(opening_quantity)from controlled_stock_cells where channel='prepared')=17.000,'prepared independently10 plus10 minus2 minus1 plus0');
select pg_temp.opening_assert((select count(distinct container_id)from controlled_stock_cells where channel='prepared'and dispense_id=pg_temp.oid('dispense2')and lot_id=pg_temp.oid('lot1'))=2,'one legacy B allocation physically split between two opening containers');
select pg_temp.opening_assert((select sum(opening_quantity)=2.500 and min(opening_quantity)=1.250 and max(opening_quantity)=1.250 from controlled_stock_cells where channel='prepared'and dispense_id=pg_temp.oid('dispense2')and lot_id=pg_temp.oid('lot1')),'split B lot1 independently4 minus1 minus0.5 equals two1.25 cells');
select pg_temp.opening_assert((select sum(opening_quantity)from controlled_stock_cells where channel='return_held')=0.750,'held independently two times0.5 minus0.125');
select pg_temp.opening_assert((select count(*)from controlled_stock_cells where channel='return_held'and opening_quantity=0)=4,'completed and retracted zero-held evidence retained');
select pg_temp.opening_assert((select count(*)from jsonb_array_elements((select native_custody_boundary from controlled_stock_openings))e where e->>'dispense_id'=pg_temp.oid('dispense3')::text and e#>>'{allocations,0,prepared_quantity}'='0.000'and e#>>'{allocations,1,prepared_quantity}'='0.000')=1,'original pickup yields no onsite prepared amount');
select pg_temp.opening_assert((select count(*)from controlled_stock_cells where dispense_id=pg_temp.oid('dispense3'))=0,'handedoff package creates no onsite cells');
select pg_temp.opening_assert((select e#>>'{return_head,version}'='6'and e#>>'{correction_head,version}'='1'and e#>>'{discrepancy_head,version}'='2'from controlled_stock_openings o cross join lateral jsonb_array_elements(o.native_custody_boundary)e where e->>'dispense_id'=pg_temp.oid('dispense2')::text),'explicit retained full prefix6 correction1 resolveddiscrepancy2');
select pg_temp.opening_assert((select e#>>'{return_head,version}'='0'and e#>>'{correction_head,version}'='0'and e#>>'{discrepancy_head,version}'='0'from controlled_stock_openings o cross join lateral jsonb_array_elements(o.native_custody_boundary)e where e->>'dispense_id'=pg_temp.oid('dispense')::text),'explicit original prepared zero prefixes');
select controlled_stock_validate_opening(pg_temp.oid('engine_opening'));set constraints all immediate;
select jsonb_build_object('kind','controlled-opening-boundary-acceptance','real_canonical_legacy_dispenses',3,'real_canonical_legacy_return_events',6,
 'real_canonical_preopening_pickups',1,'real_canonical_preopening_annotations',1,'real_canonical_preopening_discrepancy_events',2,'rejected_cases',(select count(*)from opening_rejections),'positive_sql_assertions',(select count(*)from opening_assertions),
 'independent_validator_failure_details',(select jsonb_object_agg(label,failure_detail)from opening_rejections),
 'each_rejection_all_relation_and_manifest_rollback',true,'valid_opening_committed_while_unattached',true,'zero_held_intake_entries_preserved',true,'native_available_not_double_counted',true);
commit;

-- COMMIT_REFUSAL_BEGIN
begin;set local timezone='UTC';
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor_id,'session_id',session_id)::text,true)from controlled_stock_openings;
select controlled_stock_exclusive();
create temp table invalid_opening_fixture(container_id uuid,cell_id uuid);
insert into invalid_opening_fixture values(gen_random_uuid(),gen_random_uuid());
insert into controlled_stock_containers(id,product_id,stock_unit,label,kind,stock_lot_id,controlling_site_id,initial_location_id,initial_custodian_id,opening_id,actor_id,session_id)
 select f.container_id,c.product_id,c.stock_unit,'INVALID COMMIT ONLY','stock',c.stock_lot_id,c.controlling_site_id,c.initial_location_id,c.initial_custodian_id,c.opening_id,c.actor_id,c.session_id
 from invalid_opening_fixture f cross join lateral(select *from controlled_stock_containers where kind='stock'order by id limit 1)c;
insert into controlled_stock_container_heads(container_id,version,location_id,custodian_id,status)
 select c.id,0,c.initial_location_id,c.initial_custodian_id,'onsite'from controlled_stock_containers c join invalid_opening_fixture f on f.container_id=c.id;
insert into controlled_stock_cells(id,container_id,lot_id,channel,opening_id,opening_quantity)
 select f.cell_id,c.id,c.stock_lot_id,'available',c.opening_id,1 from controlled_stock_containers c join invalid_opening_fixture f on f.container_id=c.id;
insert into controlled_stock_positions select cell_id,1 from invalid_opening_fixture;
-- No explicit validator or SET CONSTRAINTS: deferred COMMIT itself must reject.
\echo OWNED_INVALID_FIXTURE_READY_FOR_COMMIT
commit;
-- COMMIT_REFUSAL_END

-- MANAGED_APPEND_BEGIN
begin;set local timezone='UTC';
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor_id,'session_id',session_id)::text,true)from controlled_stock_openings;
select controlled_stock_exclusive();
insert into controlled_stock_state_events(id,product_id,version,prior_event_id,state,policy_version_id,opening_id,actor_id,session_id,reason)
 select gen_random_uuid(),o.product_id,2,s.head_id,'active',o.policy_version_id,o.id,o.actor_id,o.session_id,'SYNTHETIC OWNED LOCAL activation only'
 from controlled_stock_openings o join controlled_stock_states s on s.product_id=o.product_id;
update controlled_stock_states s set head_id=e.id from controlled_stock_state_events e where e.product_id=s.product_id and e.version=2;
commit;
begin;set local timezone='UTC';
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor_id,'session_id',session_id)::text,true)from controlled_stock_openings;
create temp table opening_managed_proof(label text primary key);
create temp table opening_retained_boundary(value jsonb);
insert into opening_retained_boundary select native_custody_boundary from controlled_stock_openings;
do $$declare opening controlled_stock_openings;did uuid;d native_dispenses;root uuid:=gen_random_uuid();request jsonb;args jsonb;context jsonb;containers jsonb;result jsonb;observed text;
begin
 select *into opening from controlled_stock_openings;
 select n.*into d from native_dispenses n where not exists(select 1 from native_pickups where dispense_id=n.id)
 and not exists(select 1 from native_return_events where dispense_id=n.id)order by n.id limit 1;did:=d.id;
 if did is null then raise exception 'Exact pre-opening prepared package required';end if;
 request:=jsonb_build_object('authorization_id',d.authorization_id,'pet_id',d.pet_id,'dispense_id',did,
 'expected_context_hash',preview_native_pickup(did,d.pet_id,null)->>'context_hash','recipient_name','Synthetic managed recipient','recipient_relationship','Owner',
 'reason','Synthetic managed post-opening pickup','attest_handoff',true,'refill_close',null);
 args:=jsonb_build_object('request',request);
 select jsonb_agg(jsonb_build_object('id',c.id,'expected_version',h.version,'create',null,
 'after',jsonb_build_object('status','handed_off','location_id',null,'custodian_id',null),
 'lines',(select jsonb_agg(line order by line->>'lot_id')from jsonb_array_elements(controlled_stock_expected(root,'record_native_pickup',args))line
 where(line->>'dispense_id')::uuid=did))order by c.id)into containers
 from controlled_stock_containers c join controlled_stock_container_heads h on h.container_id=c.id
 where exists(select 1 from controlled_stock_cells x where x.container_id=c.id and x.dispense_id=did);
 observed:=to_char(clock_timestamp(),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
 context:=jsonb_build_object('version',1,'product_id',opening.product_id,'policy_version_id',opening.policy_version_id,
 'state_head_id',(select head_id from controlled_stock_states where product_id=opening.product_id),'opening_id',opening.id,
 'basis',jsonb_build_object('kind','physical_record','observed_at',observed,'note','Synthetic managed pickup observation'),'containers',containers);
 perform prepare_controlled_stock_action(auth.uid(),root,'record_native_pickup',args,context);
 result:=execute_controlled_stock_action(auth.uid(),root);
 if not exists(select 1 from controlled_stock_source_links where event_id=root and pickup_id=root)then raise exception 'Post-opening pickup must own exact controlled source';end if;
 if exists(select 1 from controlled_stock_cells c join controlled_stock_positions p on p.cell_id=c.id where c.dispense_id=did and p.quantity<>0)then raise exception 'Managed complete pickup must empty exact package';end if;
 insert into opening_managed_proof values('canonical pickup committed through controlled wrapper');
 if(select e->'pickup'from jsonb_array_elements(opening.native_custody_boundary)e where(e->>'dispense_id')::uuid=did)is distinct from 'null'::jsonb then raise exception 'Retained pre-pickup boundary changed';end if;
 perform controlled_stock_validate_opening(opening.id);
 insert into opening_managed_proof values('retained pickup-null prefix validates against later linked pickup');
end$$;
commit;
begin;set local timezone='UTC';
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor_id,'session_id',session_id)::text,true)from controlled_stock_openings;
do $$declare opening controlled_stock_openings;d native_dispenses;root uuid:=gen_random_uuid();request jsonb;args jsonb;context jsonb;p jsonb;begin
 select *into opening from controlled_stock_openings;
 select n.*into d from native_dispenses n where exists(select 1 from native_return_events where dispense_id=n.id)limit 1;
 p:=preview_native_dispense_correction(d.authorization_id,d.pet_id,d.id);
 request:=jsonb_build_object('authorization_id',d.authorization_id,'pet_id',d.pet_id,'dispense_id',d.id,'kind','clinical_annotation',
 'expected_context_hash',p->>'context_hash','expected_head',p#>'{context,head}','reason','Synthetic managed later annotation',
 'note','Synthetic post-opening annotation','amends_event_id',null,'pickup_amendment',null,'attest_review',true);
 args:=jsonb_build_object('request',request);
 context:=jsonb_build_object('version',1,'product_id',opening.product_id,'policy_version_id',opening.policy_version_id,
 'state_head_id',(select head_id from controlled_stock_states where product_id=opening.product_id),'opening_id',opening.id,
 'basis',jsonb_build_object('kind','annotation','observed_at',null,'note','Synthetic managed annotation assertion'),'containers','[]'::jsonb);
 perform prepare_controlled_stock_action(auth.uid(),root,'append_native_dispense_correction',args,context);perform execute_controlled_stock_action(auth.uid(),root);
 if not exists(select 1 from controlled_stock_source_links where event_id=root and correction_event_id=root)then raise exception 'Later annotation requires exact controlled source';end if;
 if(select e#>>'{correction_head,version}'from jsonb_array_elements(opening.native_custody_boundary)e where(e->>'dispense_id')::uuid=d.id)<>'1'
 or(select count(*)from native_dispense_correction_events where dispense_id=d.id)<>2 then raise exception 'Historical correction prefix must remain1 despite later managed version2';end if;
 insert into opening_managed_proof values('canonical annotation committed through controlled wrapper');
 perform controlled_stock_validate_opening(opening.id);perform controlled_stock_validate_product(opening.product_id);
 if opening.native_custody_boundary is distinct from(select value from opening_retained_boundary)then raise exception 'Historical custody boundary cannot follow current latest';end if;
 insert into opening_managed_proof values('retained annotation prefix validates against later linked annotation');
end$$;
set constraints all immediate;
select jsonb_build_object('managed_canonical_actions',2,'managed_prefix_sql_assertions',(select count(*)from opening_managed_proof),
 'historical_prefix_preserved_after_linked_managed_append',true,'managed_pickup_null_boundary_preserved',true,'managed_annotation_boundary_stays_version1',true);
commit;
-- MANAGED_APPEND_END
