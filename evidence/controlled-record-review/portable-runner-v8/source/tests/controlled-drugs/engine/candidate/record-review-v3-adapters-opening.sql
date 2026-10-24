-- PRIVATE UNINTEGRATED A2 DRAFT. No runtime or acceptance claim.
-- Exact immutable opening evidence only; no mutable position or container head.
-- BEGIN FUNCTION adapter_opening_site|jsonb|plpgsql
declare
 state jsonb:=p_state; target_event public.controlled_stock_events;
 target_correction public.native_dispense_correction_events; original_dispense public.native_dispenses;
 retained_opening public.controlled_stock_openings; selected_cell public.controlled_stock_cells;
 selected_container public.controlled_stock_containers; original_allocation record;
 entry jsonb; entry_candidate jsonb; projected jsonb; boundary_allocation jsonb;
 allocation_map jsonb:='{}'; prepared_sums jsonb:='{}'; retained_node jsonb;
 positive_sites jsonb:='{}'; zero_sites jsonb:='{}'; site_key text; retained_site uuid; selected_site uuid;
 opening_unit text; target_unit text; selected_pickup uuid;
 return_version integer; correction_version integer; discrepancy_version integer;
 entry_count integer:=0; allocation_count integer:=0; cell_count integer:=0;
 fully_prepared boolean:=true; reason text; expected_prepared numeric; actual_prepared numeric;
begin
 if p_dispense_id is null or p_product_id is null or jsonb_typeof(state) is distinct from 'object'
 or jsonb_typeof(state->'rows') is distinct from 'object' then
  raise exception 'adapter_source_integrity' using errcode='23514';end if;
 if octet_length(state::text)>1048576 then raise exception 'evidence_limit_exceeded' using errcode='54000';end if;
 select * into target_event from public.controlled_stock_events
 where id=public.controlled_stock_uuid(state->'target_event_id');
 select * into target_correction from public.native_dispense_correction_events where id=target_event.id;
 select * into original_dispense from public.native_dispenses where id=p_dispense_id;
 if target_event.id is null or target_event.writer is distinct from 'append_native_dispense_correction'
 or target_event.event_kind<>all(array['append_native_dispense_correction:clinical_annotation','append_native_dispense_correction:operational_annotation'])
 or target_event.product_id is distinct from p_product_id or state->>'product_id' is distinct from p_product_id::text
 or target_event.opening_id::text is distinct from state->>'opening_id'
 or target_correction.id is null or original_dispense.id is null
 or target_correction.dispense_id is distinct from p_dispense_id
 or target_correction.kind is distinct from split_part(target_event.event_kind,':',2)
 or target_correction.authorization_id is distinct from original_dispense.authorization_id
 or target_correction.pet_id is distinct from original_dispense.pet_id
 or target_correction.actor_id is distinct from target_event.actor_id then
  raise exception 'adapter_source_integrity' using errcode='23514';end if;
 select * into retained_opening from public.controlled_stock_openings where id=target_event.opening_id;
 select stock_unit into opening_unit from public.controlled_stock_policy_versions
 where id=retained_opening.policy_version_id and product_id=p_product_id;
 select stock_unit into target_unit from public.controlled_stock_policy_versions
 where id=target_event.policy_version_id and product_id=p_product_id;
 if retained_opening.id is null or retained_opening.product_id is distinct from p_product_id
 or opening_unit is null or target_unit is distinct from opening_unit then
  raise exception 'adapter_source_integrity' using errcode='23514';end if;
 if octet_length(retained_opening.native_custody_boundary::text)>1048576
 or jsonb_array_length(retained_opening.native_custody_boundary)>200 then
  raise exception 'evidence_limit_exceeded' using errcode='54000';end if;
 -- The immutable parent keeps all its reciprocal, prefix and later-link checks.
 perform public.controlled_stock_validate_opening(retained_opening.id);
 if controlled_review_v3.managed_source_event(jsonb_build_object(
  'source_kind','dispense','source_id',p_dispense_id,'product_id',p_product_id)) is not null then
  raise exception 'adapter_source_integrity' using errcode='23514';end if;
 -- This validates complete original allocations/provenance even for direct private
 -- helper calls; re-adding the existing rows obeys the unchanged role precedence.
 state:=controlled_review_v3.adapter_dispense(state,p_dispense_id,p_product_id,'original_dispense',1);
 for entry_candidate in select value from jsonb_array_elements(retained_opening.native_custody_boundary) loop
  if entry_candidate->>'dispense_id'=p_dispense_id::text then
   entry_count:=entry_count+1;entry:=entry_candidate;
  end if;
 end loop;
 if entry_count<>1 then raise exception 'adapter_source_integrity' using errcode='23514';end if;
 return_version:=public.controlled_stock_opening_selector(entry->'return_head');
 correction_version:=public.controlled_stock_opening_selector(entry->'correction_head');
 discrepancy_version:=public.controlled_stock_opening_selector(entry->'discrepancy_head');
 if entry->'pickup'<>'null'::jsonb then selected_pickup:=public.controlled_stock_uuid(entry#>'{pickup,id}');end if;
 projected:=public.controlled_stock_opening_native_entry(retained_opening.id,p_dispense_id,
  return_version,correction_version,discrepancy_version,selected_pickup);
 if entry is distinct from projected or target_correction.sequence<=correction_version
 or public.controlled_stock_opening_later_source(retained_opening.id,'correction',target_event.id) is distinct from target_event.id then
  raise exception 'adapter_source_integrity' using errcode='23514';end if;
 if jsonb_array_length(entry->'allocations')>100 then raise exception 'evidence_limit_exceeded' using errcode='54000';end if;
 fully_prepared:=return_version=0 and discrepancy_version=0 and selected_pickup is null
  and not exists(select 1 from public.native_dispense_correction_events prefix_correction
   where prefix_correction.dispense_id=p_dispense_id and prefix_correction.sequence<=correction_version
   and prefix_correction.kind<>all(array['clinical_annotation','operational_annotation']));
 for original_allocation in select * from public.native_dispense_allocations
 where dispense_id=p_dispense_id order by id limit 101 loop
  allocation_count:=allocation_count+1;
  if allocation_count>100 then raise exception 'evidence_limit_exceeded' using errcode='54000';end if;
  select value into boundary_allocation from jsonb_array_elements(entry->'allocations')
   where value->>'allocation_id'=original_allocation.id::text;
  if boundary_allocation is null or boundary_allocation->>'lot_id' is distinct from original_allocation.lot_id::text
  or original_allocation.quantity<=0
  or (boundary_allocation->>'dispensed_quantity')::numeric is distinct from original_allocation.quantity then
   raise exception 'adapter_source_integrity' using errcode='23514';end if;
  expected_prepared:=(boundary_allocation->>'prepared_quantity')::numeric;
  if expected_prepared is null or expected_prepared<0 then raise exception 'adapter_source_integrity' using errcode='23514';end if;
  if expected_prepared<>original_allocation.quantity or boundary_allocation->'held'<>'[]'::jsonb then fully_prepared:=false;end if;
  allocation_map:=allocation_map||jsonb_build_object(original_allocation.id::text,boundary_allocation);
 end loop;
 if allocation_count=0 or allocation_count<>jsonb_array_length(entry->'allocations') then
  raise exception 'adapter_source_integrity' using errcode='23514';end if;
 -- Preserve assertion/managed cross-set agreement even when O is unsupported.
 for retained_node in select value from jsonb_each(state->'rows') loop
  if retained_node->>'relation'='public.controlled_stock_containers' then
   selected_site:=(retained_node#>>'{row,controlling_site_id}')::uuid;
   if selected_site is null or(retained_site is not null and retained_site<>selected_site) then
    raise exception 'adapter_source_integrity' using errcode='23514';end if;
   retained_site:=selected_site;
  end if;
 end loop;
 for selected_cell in select * from public.controlled_stock_cells
 where opening_id=retained_opening.id and dispense_id=p_dispense_id and channel='prepared'
 order by id limit 513 loop
  cell_count:=cell_count+1;if cell_count>512 then raise exception 'evidence_limit_exceeded' using errcode='54000';end if;
  boundary_allocation:=allocation_map->selected_cell.allocation_id::text;
  select * into selected_container from public.controlled_stock_containers where id=selected_cell.container_id;
  if boundary_allocation is null or selected_cell.lot_id::text is distinct from boundary_allocation->>'lot_id'
  or selected_cell.intake_id is not null or selected_cell.created_event_id is not null or selected_cell.opening_quantity<0
  or selected_container.id is null or selected_container.opening_id is distinct from retained_opening.id
  or selected_container.product_id is distinct from p_product_id or selected_container.stock_unit is distinct from opening_unit
  or selected_container.kind is distinct from 'prepared' or selected_container.stock_lot_id is not null
  or selected_container.created_event_id is not null or selected_container.controlling_site_id is null then
   raise exception 'adapter_source_integrity' using errcode='23514';end if;
  selected_site:=selected_container.controlling_site_id;
  if retained_site is not null and selected_site<>retained_site then
   raise exception 'adapter_source_integrity' using errcode='23514';end if;
  state:=controlled_review_v3.adapter_add(state,'public.controlled_stock_cells',jsonb_build_object('id',selected_cell.id),to_jsonb(selected_cell),'opening_basis');
  state:=controlled_review_v3.adapter_add(state,'public.controlled_stock_containers',jsonb_build_object('id',selected_container.id),to_jsonb(selected_container),'opening_basis');
  actual_prepared:=coalesce((prepared_sums->>selected_cell.allocation_id::text)::numeric,0)+selected_cell.opening_quantity;
  prepared_sums:=prepared_sums||jsonb_build_object(selected_cell.allocation_id::text,actual_prepared);
  if selected_cell.opening_quantity>0 then positive_sites:=positive_sites||jsonb_build_object(selected_site::text,true);
  else zero_sites:=zero_sites||jsonb_build_object(selected_site::text,true);end if;
 end loop;
 for boundary_allocation in select value from jsonb_each(allocation_map) loop
  actual_prepared:=coalesce((prepared_sums->>(boundary_allocation->>'allocation_id'))::numeric,0);
  if actual_prepared is distinct from (boundary_allocation->>'prepared_quantity')::numeric then
   raise exception 'adapter_source_integrity' using errcode='23514';end if;
 end loop;
 if positive_sites<>'{}'::jsonb then
  for site_key in select jsonb_object_keys(zero_sites) loop
   if not(positive_sites?site_key) then raise exception 'adapter_source_integrity' using errcode='23514';end if;
  end loop;
 end if;
 selected_site:=null;
 if not fully_prepared or positive_sites='{}'::jsonb then reason:='opening_package_incomplete';
 elsif(select count(*) from jsonb_object_keys(positive_sites))<>1 then reason:='opening_package_multisite';
 else select jsonb_object_keys(positive_sites)::uuid into selected_site;end if;
 return jsonb_build_object('state',state,'site_id',selected_site,'reason',reason);
end
-- END FUNCTION
