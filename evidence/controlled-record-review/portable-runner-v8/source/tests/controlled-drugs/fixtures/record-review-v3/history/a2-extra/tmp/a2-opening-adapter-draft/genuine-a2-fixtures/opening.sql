-- Explicit retained selector0/1, never current head/count authority.
select public.prepare_controlled_draft_review(auth.uid(),pg_temp.a2_id('__LABEL__.controlled_review'),'draft_configuration',jsonb_build_object(
 'id',pg_temp.a2_id('__LABEL__.controlled_draft'),'expected_version',null,'review_note','SYNTHETIC A2 FIXTURE ONLY','attest_review',true,
 'definition',jsonb_build_object('product_id',pg_temp.a2_id('__LABEL__.product'),'product_version',1,'stock_unit','tablet','generic_name','Synthetic A2 __LABEL__ medication',
 'brand_name',null,'schedule','II','concentration','Synthetic only; no clinical dose','concentration_source','Synthetic engineering fixture',
 'classification_source','Synthetic engineering fixture','configuration_note','Not real practice configuration')));
select public.execute_controlled_draft_review(auth.uid(),pg_temp.a2_id('__LABEL__.controlled_review'));
select public.controlled_stock_exclusive();
insert into controlled_stock_policy_versions(id,product_id,version,draft_version_id,engine_revision,stock_unit,identity_snapshot,permissions,
 clinic_retained_return_permitted,review_reference,actor_id,session_id)
 select pg_temp.a2_id('__LABEL__.policy'),pg_temp.a2_id('__LABEL__.product'),1,head_id,1,'tablet',public.controlled_stock_identity(pg_temp.a2_id('__LABEL__.product')),
 jsonb_build_object('record_native_pickup',pg_temp.a2_permission('physical_record'),
 'append_native_dispense_correction:clinical_annotation',pg_temp.a2_permission('annotation'),
 'append_native_dispense_correction:operational_annotation',pg_temp.a2_permission('annotation'),
 'append_native_dispense_correction:pickup_amendment',pg_temp.a2_permission('annotation')),
 false,'SYNTHETIC A2 LOCAL ONLY; not practice commissioning',auth.uid(),pg_temp.a2_id('session')
 from controlled_draft_entries where id=pg_temp.a2_id('__LABEL__.controlled_draft');
insert into controlled_stock_policy_sites values(pg_temp.a2_id('__LABEL__.policy'),pg_temp.a2_id('site'));
insert into controlled_stock_state_events(id,product_id,version,state,policy_version_id,actor_id,session_id,reason)
 values(pg_temp.a2_id('__LABEL__.frozen'),pg_temp.a2_id('__LABEL__.product'),1,'opening_frozen',pg_temp.a2_id('__LABEL__.policy'),auth.uid(),pg_temp.a2_id('session'),'Synthetic A2 freeze');
insert into controlled_stock_states(product_id,head_id)values(pg_temp.a2_id('__LABEL__.product'),pg_temp.a2_id('__LABEL__.frozen'));
do $$declare expected jsonb;actual jsonb;begin
 expected:=pg_temp.a2_expected_boundary('__LABEL__');
 actual:=public.controlled_stock_opening_native_entry_for_product(pg_temp.a2_id('__LABEL__.product'),'tablet',pg_temp.a2_id('__LABEL__.dispense'),0,__PREFIX__,0,null);
 if actual is distinct from expected then raise exception 'A2 full independently expected opening boundary differs' using errcode='23514';end if;
 insert into a2_expected_boundaries values('__LABEL__',jsonb_build_array(expected));
end $$;
insert into controlled_stock_openings(id,product_id,policy_version_id,observed_at,count_evidence,native_custody_boundary,actor_id,session_id)
 select pg_temp.a2_id('__LABEL__.opening'),pg_temp.a2_id('__LABEL__.product'),pg_temp.a2_id('__LABEL__.policy'),clock_timestamp(),
 '{"synthetic":true,"not_practice_physical_count":true,"available_per_lot":"2.000","prepared_per_allocation":"1.000"}',boundary,auth.uid(),pg_temp.a2_id('session')
 from a2_expected_boundaries where label='__LABEL__';
insert into controlled_stock_opening_movements(opening_id,movement_id,lot_id,quantity,source_snapshot)
 select pg_temp.a2_id('__LABEL__.opening'),m.id,m.lot_id,m.quantity,to_jsonb(m)from inventory_movements m
 where m.id in(pg_temp.a2_id('__LABEL__.receive1'),pg_temp.a2_id('__LABEL__.receive2'),pg_temp.a2_id('__LABEL__.movement1'),pg_temp.a2_id('__LABEL__.movement2'));
insert into controlled_stock_containers(id,product_id,stock_unit,label,kind,stock_lot_id,controlling_site_id,initial_location_id,initial_custodian_id,opening_id,actor_id,session_id)
 select pg_temp.a2_id(f.container_key),pg_temp.a2_id('__LABEL__.product'),'tablet','Synthetic A2 '||f.k,
 case f.channel when 'available' then 'stock' else 'prepared' end,
 case f.channel when 'available' then pg_temp.a2_id('__LABEL__.lot'||f.lot_number) else null end,
 pg_temp.a2_id('site'),pg_temp.a2_id('location'),auth.uid(),pg_temp.a2_id('__LABEL__.opening'),auth.uid(),pg_temp.a2_id('session')
 from a2_expected_cells f where product_label='__LABEL__';
insert into controlled_stock_container_heads(container_id,version,location_id,custodian_id,status)
 select pg_temp.a2_id(container_key),0,pg_temp.a2_id('location'),auth.uid(),'onsite'from a2_expected_cells where product_label='__LABEL__';
insert into controlled_stock_cells(id,container_id,lot_id,channel,dispense_id,allocation_id,opening_id,opening_quantity)
 select pg_temp.a2_id(f.k),pg_temp.a2_id(f.container_key),pg_temp.a2_id('__LABEL__.lot'||f.lot_number),f.channel,
 case when f.channel='prepared' then pg_temp.a2_id('__LABEL__.dispense') end,
 case when f.channel='prepared' then pg_temp.a2_id('__LABEL__.allocation'||f.allocation_number) end,pg_temp.a2_id('__LABEL__.opening'),f.quantity
 from a2_expected_cells f where product_label='__LABEL__';
insert into controlled_stock_positions select pg_temp.a2_id(k),quantity from a2_expected_cells where product_label='__LABEL__';
-- The unchanged canonical validator must accept all declared zero/split cells.
select public.controlled_stock_validate_opening(pg_temp.a2_id('__LABEL__.opening'));
select public.controlled_stock_validate_product(pg_temp.a2_id('__LABEL__.product'));
set constraints all immediate;
-- State row and projection change together under deferred canonical constraints.
set constraints all deferred;
insert into controlled_stock_state_events(id,product_id,version,prior_event_id,state,policy_version_id,opening_id,actor_id,session_id,reason)
 values(pg_temp.a2_id('__LABEL__.active'),pg_temp.a2_id('__LABEL__.product'),2,pg_temp.a2_id('__LABEL__.frozen'),'active',
 pg_temp.a2_id('__LABEL__.policy'),pg_temp.a2_id('__LABEL__.opening'),auth.uid(),pg_temp.a2_id('session'),'Synthetic local fixture only; no clinical activation');
update controlled_stock_states set head_id=pg_temp.a2_id('__LABEL__.active')where product_id=pg_temp.a2_id('__LABEL__.product');
