-- PRIVATE UNINTEGRATED A2 draft; no runtime/acceptance claim.
-- Additive A2 declarations: record-review-v3-adapters-a2-selectors.json.
-- BEGIN FUNCTION adapter_add|jsonb|plpgsql
declare
 state jsonb:=p_state; identity text; prior jsonb; item jsonb; rank integer; old_rank integer;
 roles text[]:=array['reviewed_target','correction_target','case_report','ordinary_source','original_intake','original_pickup','amendment_predecessor','original_dispense','resolution_correction','opening_basis','retained_context'];
 expected_key jsonb; count_rows integer;
begin
 if jsonb_typeof(state) is distinct from 'object' or jsonb_typeof(state->'rows') is distinct from 'object'
 or jsonb_typeof(p_key) is distinct from 'object' or jsonb_typeof(p_row) is distinct from 'object'
 or p_relation is null or p_role is null or not(p_role=any(roles)) then
  raise exception 'adapter_source_integrity' using errcode='23514';
 end if;
 if octet_length(state::text)>1048576 or octet_length(p_row::text)>1048576 then
  raise exception 'evidence_limit_exceeded' using errcode='54000';
 end if;
 expected_key:=case p_relation
 when 'public.stock_movement_sources' then jsonb_build_object('movement_id',p_row->'movement_id')
 when 'public.stock_custody_sources' then jsonb_build_object('event_id',p_row->'event_id')
 when 'public.stock_pickup_sources' then jsonb_build_object('event_id',p_row->'event_id')
 when 'public.stock_discrepancy_sources' then jsonb_build_object('event_id',p_row->'event_id')
 when 'public.stock_correction_sources' then jsonb_build_object('event_id',p_row->'event_id')
 when 'public.controlled_stock_opening_movements' then jsonb_build_object('opening_id',p_row->'opening_id','movement_id',p_row->'movement_id')
 else jsonb_build_object('id',p_row->'id') end;
 if p_key is distinct from expected_key or exists(select 1 from jsonb_each(p_key) x where jsonb_typeof(x.value)<>'string')
 or p_relation<>all(array[
 'public.controlled_stock_events','public.controlled_stock_actions','public.controlled_stock_preparations',
 'public.controlled_stock_policy_versions','public.controlled_stock_openings','public.controlled_stock_source_links',
 'public.controlled_stock_event_lines','public.controlled_stock_container_transitions','public.controlled_stock_cells',
 'public.controlled_stock_containers','public.inventory_movements','public.stock_movement_sources','public.inventory_lots',
 'public.patient_treatments','public.billing_invoice_items','public.treatment_alert_reviews','public.anesthesia_drug_administrations',
 'public.native_dispenses','public.native_fulfillment_operations','public.native_dispense_allocations','public.native_pickups',
 'public.stock_pickup_sources','public.native_return_events','public.native_return_operations','public.stock_custody_sources',
 'public.native_return_stock_links','public.native_return_compensation_links','public.native_return_discrepancy_events',
 'public.native_return_discrepancy_operations','public.stock_discrepancy_sources','public.native_return_discrepancy_correction_links',
 'public.native_dispense_correction_events','public.native_dispense_correction_operations','public.stock_correction_sources',
 'public.controlled_stock_opening_movements']) then
  raise exception 'adapter_source_integrity' using errcode='23514';
 end if;
 identity:=jsonb_build_array(p_relation,p_key)::text;
 prior:=state->'rows'->identity;
 rank:=array_position(roles,p_role);
 item:=jsonb_build_object('relation',p_relation,'key',p_key,'row',p_row,'row_hash',public.controlled_stock_hash(p_row),'role',p_role);
 if prior is not null then
  if prior->'row' is distinct from p_row or prior->>'row_hash' is distinct from item->>'row_hash' then
   raise exception 'adapter_source_role_conflict' using errcode='23514';
  end if;
  old_rank:=array_position(roles,prior->>'role');
  if old_rank is null then raise exception 'adapter_source_role_conflict' using errcode='23514';end if;
  if old_rank<=rank then return state;end if;
 else
  select count(*) into count_rows from jsonb_object_keys(state->'rows');
  if count_rows>=512 then raise exception 'evidence_limit_exceeded' using errcode='54000';end if;
  if p_relation=any(array['public.native_dispenses','public.native_pickups','public.native_return_events',
   'public.native_return_discrepancy_events','public.native_dispense_correction_events']) then
   if jsonb_array_length(state->'documents')>=100 then raise exception 'evidence_limit_exceeded' using errcode='54000';end if;
   state:=jsonb_set(state,'{documents}',(state->'documents')||jsonb_build_array(identity));
  end if;
  if p_relation='public.native_dispense_allocations' then
   if jsonb_array_length(state->'allocations')>=100 then raise exception 'evidence_limit_exceeded' using errcode='54000';end if;
   state:=jsonb_set(state,'{allocations}',(state->'allocations')||jsonb_build_array(p_row->'id'));
  end if;
 end if;
 state:=jsonb_set(state,array['rows',identity],item);
 if octet_length(state::text)>1048576 then raise exception 'evidence_limit_exceeded' using errcode='54000';end if;
 return state;
end
-- END FUNCTION

-- BEGIN FUNCTION collect_event_sources|jsonb|plpgsql
declare e public.controlled_stock_events; state jsonb; adapter jsonb; refs jsonb; rows jsonb;
 target jsonb; result jsonb; adapter_id text; site uuid; site_basis text; reason text;
 did uuid; family uuid; managed jsonb; source_id uuid; node jsonb; retained_site uuid; node_site uuid;
begin
 if p_event_id is null or p_event_id='00000000-0000-0000-0000-000000000000'::uuid then
  raise exception 'invalid_adapter_argument' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(90271040,0);
 perform controlled_review_v3.required();
 select * into e from public.controlled_stock_events where id=p_event_id;
 if e.id is null then raise exception 'invalid_adapter_argument' using errcode='22023';end if;
 -- Whole literal dispatch precedes any transition/site inspection.
 case e.event_kind
 when 'receive_inventory','adjust_inventory' then adapter_id:='movement_v1';
 when 'record_patient_treatment' then adapter_id:='treatment_v1';
 when 'record_anesthesia_drug_administration' then adapter_id:='anesthesia_v1';
 when 'record_native_dispense' then adapter_id:='dispense_v1';
 when 'record_native_pickup' then adapter_id:='pickup_v1';
 when 'record_native_dispense_return:intake','record_native_dispense_return:dispose','record_native_dispense_return:restock' then adapter_id:='return_v1';
 when 'record_native_dispense_return_v2:intake','record_native_dispense_return_v2:dispose','record_native_dispense_return_v2:restock' then adapter_id:='return_v2';
 when 'record_native_dispense_return_v2:retract_intake','record_native_dispense_return_v2:retract_disposal','record_native_dispense_return_v2:retract_restock' then adapter_id:='retraction_v1';
 when 'record_native_return_discrepancy:report','record_native_return_discrepancy:note','record_native_return_discrepancy:resolve_corrected','record_native_return_discrepancy:resolve_confirmed_original' then adapter_id:='discrepancy_v1';
 when 'append_native_dispense_correction:clinical_annotation','append_native_dispense_correction:operational_annotation','append_native_dispense_correction:pickup_amendment' then adapter_id:='annotation_v1';
 else raise exception 'unsupported_event_kind' using errcode='22023';end case;
 state:=jsonb_build_object('rows','{}'::jsonb,'documents','[]'::jsonb,'allocations','[]'::jsonb,
  'target_event_id',e.id,'product_id',e.product_id,'opening_id',e.opening_id);
 state:=controlled_review_v3.adapter_parent(state,e.id,'reviewed_target');
 if adapter_id in('movement_v1','treatment_v1','anesthesia_v1') then
  state:=controlled_review_v3.adapter_clinical(state,e.id);
 elsif adapter_id='dispense_v1' then
  did:=e.id;family:=did;state:=controlled_review_v3.adapter_dispense(state,did,e.product_id,'reviewed_target',0);
 elsif adapter_id='pickup_v1' then
  select dispense_id into did from public.native_pickups where id=e.id;
  family:=did;state:=controlled_review_v3.adapter_pickup(state,e.id,e.product_id,'reviewed_target',0);
 elsif adapter_id in('return_v1','return_v2','retraction_v1') then
  state:=controlled_review_v3.adapter_return(state,e.id,e.product_id,'reviewed_target',0);
 else state:=controlled_review_v3.adapter_context(state,e.id);end if;
 -- Available retained managed/source and assertion transitions must agree even
 -- when A1 cannot establish a supported site. This scan never supplies the site.
 for node in select value from jsonb_each(state->'rows') loop
  if node->>'relation'='public.controlled_stock_containers' then
   node_site:=(node#>>'{row,controlling_site_id}')::uuid;
   if node_site is null or(retained_site is not null and retained_site<>node_site) then
    raise exception 'adapter_source_integrity' using errcode='23514';end if;
   retained_site:=node_site;
  end if;
 end loop;
 if adapter_id='annotation_v1' then
  select dispense_id into did from public.native_dispense_correction_events where id=e.id;
  managed:=controlled_review_v3.managed_source_event(jsonb_build_object('source_kind','dispense','source_id',did,'product_id',e.product_id));
  if managed is not null then
   site:=(controlled_review_v3.adapter_event_site((managed->>'event_id')::uuid)->>'site_id')::uuid;site_basis:='managed_dispense';
  elsif e.event_kind='append_native_dispense_correction:pickup_amendment' then
   select(document#>>'{pickup_amendment,original_pickup_id}')::uuid into source_id
    from public.native_dispense_correction_events where id=e.id;
   managed:=controlled_review_v3.managed_source_event(jsonb_build_object('source_kind','pickup','source_id',source_id,'product_id',e.product_id));
   if managed is null then reason:='unmanaged_original_pickup';
   else site:=(controlled_review_v3.adapter_event_site((managed->>'event_id')::uuid)->>'site_id')::uuid;site_basis:='managed_pickup';end if;
  else
   result:=controlled_review_v3.adapter_opening_site(state,did,e.product_id);
   state:=result->'state';site:=(result->>'site_id')::uuid;reason:=result->>'reason';site_basis:='opening_custody_site';
  end if;
 elsif adapter_id='discrepancy_v1' then
  select(document#>>'{source,event_id}')::uuid into source_id from public.native_return_discrepancy_events where id=e.id;
  managed:=controlled_review_v3.managed_source_event(jsonb_build_object('source_kind','return','source_id',source_id,'product_id',e.product_id));
  if managed is null then reason:='unmanaged_original_return';
  else site:=(controlled_review_v3.adapter_event_site((managed->>'event_id')::uuid)->>'site_id')::uuid;site_basis:='managed_return';end if;
 else
  site:=(controlled_review_v3.adapter_event_site(e.id)->>'site_id')::uuid;site_basis:='event_transitions';
 end if;
 if reason is null then
  if site is null or(retained_site is not null and retained_site<>site) then
   raise exception 'adapter_source_integrity' using errcode='23514';end if;
 else site:=null;site_basis:='unproven';end if;
 target:=jsonb_build_object('event_id',e.id,'product_id',e.product_id,'sequence',e.sequence,'record_hash',e.record_hash,
  'original_actor_id',e.actor_id,'policy_version_id',e.policy_version_id,'opening_id',e.opening_id,'engine_revision',e.engine_revision);
 select coalesce(jsonb_agg(value-'row' order by (value->>'relation') collate "C",(value->'key')::text collate "C"),'[]'::jsonb),
  coalesce(jsonb_agg(value-'row_hash'-'role' order by (value->>'relation') collate "C",(value->'key')::text collate "C"),'[]'::jsonb)
 into refs,rows from jsonb_each(state->'rows');
 adapter:=jsonb_build_object('version',1,'event_kind',e.event_kind,'adapter_id',adapter_id,'target',target,
  'site_basis',site_basis,'site_id',site,'source_refs',refs,'native_family_dispense_id',family,
  'provenance_state',case when reason is null then 'supported' else 'unsupported' end,'reason',reason);
 result:=jsonb_build_object('adapter',adapter,'source_rows',rows);
 if octet_length(result::text)>1048576 then raise exception 'evidence_limit_exceeded' using errcode='54000';end if;
 return result;
end
-- END FUNCTION

-- BEGIN FUNCTION adapt_event|jsonb|plpgsql
begin
 return controlled_review_v3.collect_event_sources(p_event_id)->'adapter';
end
-- END FUNCTION

-- BEGIN FUNCTION managed_source_event|jsonb|plpgsql
declare selected_source_kind text; selected_source_id uuid; product uuid; source_row jsonb; did uuid; expected_writer text;
 opening public.controlled_stock_openings; e public.controlled_stock_events; link public.controlled_stock_source_links;
 movement public.inventory_movements; provenance public.stock_movement_sources; allocation record;
 n integer:=0; linked integer:=0; opened integer:=0; sourced integer:=0; dispense_root_count integer; parent_id uuid; ids jsonb:='[]'; entry jsonb;
 native_source_provenance jsonb; selected_movement record; return_count integer:=0; return_sourced integer:=0; return_root_count integer;
begin
 if octet_length(p_request::text)>131072 then raise exception 'evidence_limit_exceeded' using errcode='54000';end if;
 if jsonb_typeof(p_request) is distinct from 'object'
 or (select array_agg(k order by k) from jsonb_object_keys(p_request) k) is distinct from array['product_id','source_id','source_kind']::text[]
 or jsonb_typeof(p_request->'source_kind') is distinct from 'string'
 or jsonb_typeof(p_request->'source_id') is distinct from 'string'
 or jsonb_typeof(p_request->'product_id') is distinct from 'string'
 or p_request->>'source_id'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 or p_request->>'product_id'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  raise exception 'invalid_adapter_argument' using errcode='22023';end if;
 selected_source_kind:=p_request->>'source_kind';selected_source_id:=(p_request->>'source_id')::uuid;product:=(p_request->>'product_id')::uuid;
 if selected_source_id='00000000-0000-0000-0000-000000000000'::uuid or product='00000000-0000-0000-0000-000000000000'::uuid
 or selected_source_kind<>all(array['movement','return','pickup','discrepancy','correction','dispense']) then
  raise exception 'invalid_adapter_argument' using errcode='22023';end if;
 select * into opening from public.controlled_stock_openings where product_id=product;
 if opening.id is not null then perform public.controlled_stock_validate_opening(opening.id);end if;
 if selected_source_kind='movement' then
  select * into movement from public.inventory_movements where id=selected_source_id;
  if movement.id is null or not exists(select 1 from public.inventory_lots where id=movement.lot_id and product_id=product) then
   raise exception 'adapter_source_integrity' using errcode='23514';end if;
  select * into provenance from public.stock_movement_sources where movement_id=selected_source_id;
  if provenance.movement_id is not null then perform public.stock_source_validate_movement(selected_source_id);end if;
  select * into link from public.controlled_stock_source_links where movement_id=selected_source_id;
 else
  case selected_source_kind
  when 'dispense' then select to_jsonb(s) into source_row from public.native_dispenses s where s.id=selected_source_id;
  when 'return' then select to_jsonb(s) into source_row from public.native_return_events s where s.id=selected_source_id;
  when 'pickup' then select to_jsonb(s) into source_row from public.native_pickups s where s.id=selected_source_id;
  when 'discrepancy' then select to_jsonb(s) into source_row from public.native_return_discrepancy_events s where s.id=selected_source_id;
  when 'correction' then select to_jsonb(s) into source_row from public.native_dispense_correction_events s where s.id=selected_source_id;
  end case;
  if source_row is null then raise exception 'adapter_source_integrity' using errcode='23514';end if;
  did:=case when selected_source_kind='dispense' then selected_source_id else(source_row->>'dispense_id')::uuid end;
  perform public.native_fulfillment_verified_dispense(did);
  perform public.native_reconciliation_verified((source_row->>'authorization_id')::uuid,(source_row->>'pet_id')::uuid,did);
  -- Classification is independently callable: validate present native provenance
  -- even for historical_null, without relying on the collector to visit it later.
  case selected_source_kind
  when 'return' then
   select to_jsonb(s) into native_source_provenance from public.stock_custody_sources s where s.event_id=selected_source_id;
   expected_writer:=case source_row#>>'{document,version}' when '1' then 'record_native_dispense_return' when '2' then 'record_native_dispense_return_v2' end;
  when 'pickup' then select to_jsonb(s) into native_source_provenance from public.stock_pickup_sources s where s.event_id=selected_source_id;
  when 'discrepancy' then select to_jsonb(s) into native_source_provenance from public.stock_discrepancy_sources s where s.event_id=selected_source_id;
  when 'correction' then select to_jsonb(s) into native_source_provenance from public.stock_correction_sources s where s.event_id=selected_source_id;
  else null;end case;
  if native_source_provenance is not null and(
   native_source_provenance->>'actor_id' is distinct from source_row->>'actor_id'
   or(selected_source_kind='return' and native_source_provenance->>'writer' is distinct from expected_writer)) then
   raise exception 'adapter_source_integrity' using errcode='23514';end if;
  if selected_source_kind='return' then
   if expected_writer is null then raise exception 'adapter_source_integrity' using errcode='23514';end if;
   for selected_movement in
    select l.movement_id,l.lot_id,l.quantity from public.native_return_stock_links l
     where source_row->>'action'='restock' and l.event_id=selected_source_id
    union all
    select l.movement_id,l.lot_id,-l.quantity from public.native_return_compensation_links l
     where source_row->>'action'='retract_restock' and l.event_id=selected_source_id
    order by movement_id limit 101 loop
    return_count:=return_count+1;if return_count>100 then raise exception 'evidence_limit_exceeded' using errcode='54000';end if;
    select * into movement from public.inventory_movements where id=selected_movement.movement_id;
    if movement.id is null or movement.lot_id<>selected_movement.lot_id or movement.quantity<>selected_movement.quantity
    or movement.created_by::text is distinct from source_row->>'actor_id'
    or movement.kind is distinct from(case source_row->>'action' when 'restock' then 'native_return' else 'native_return_compensation' end) then
     raise exception 'adapter_source_integrity' using errcode='23514';end if;
    select * into provenance from public.stock_movement_sources where movement_id=selected_movement.movement_id;
    if provenance.movement_id is not null then
     return_sourced:=return_sourced+1;
     if provenance.source_id<>selected_source_id or provenance.writer<>expected_writer
     or provenance.actor_id::text is distinct from source_row->>'actor_id' then
      raise exception 'adapter_source_integrity' using errcode='23514';end if;
     perform public.stock_source_validate_movement(provenance.movement_id);
    end if;
   end loop;
   if(source_row->>'action' in('restock','retract_restock') and(return_count=0 or return_count<>jsonb_array_length(source_row#>'{document,allocations}')))
   or return_sourced not in(0,return_count) then raise exception 'adapter_source_integrity' using errcode='23514';end if;
   select count(*) into return_root_count from(select s.movement_id from public.stock_movement_sources s
    where s.writer=expected_writer and s.source_id=selected_source_id limit 101)q;
   if return_root_count>100 then raise exception 'evidence_limit_exceeded' using errcode='54000';end if;
   if return_root_count<>return_sourced or exists(select 1 from public.stock_movement_sources s
    where s.writer=expected_writer and s.source_id=selected_source_id
    and not exists(select 1 from public.native_return_stock_links l where source_row->>'action'='restock' and l.event_id=selected_source_id and l.movement_id=s.movement_id)
    and not exists(select 1 from public.native_return_compensation_links l where source_row->>'action'='retract_restock' and l.event_id=selected_source_id and l.movement_id=s.movement_id)) then
    raise exception 'adapter_source_integrity' using errcode='23514';end if;
  end if;
  for allocation in select a.* from public.native_dispense_allocations a where dispense_id=did order by lot_id limit 101 loop
   n:=n+1;if n>100 then raise exception 'evidence_limit_exceeded' using errcode='54000';end if;
   if not exists(select 1 from public.inventory_lots where id=allocation.lot_id and product_id=product) then
    raise exception 'adapter_source_integrity' using errcode='23514';end if;
   select * into provenance from public.stock_movement_sources where movement_id=allocation.movement_id;
   if provenance.movement_id is not null then
    sourced:=sourced+1;
    if provenance.writer<>'record_native_dispense' or provenance.source_id<>did
    or provenance.actor_id is distinct from(select actor_id from public.native_dispenses where id=did) then
     raise exception 'adapter_source_integrity' using errcode='23514';end if;
    perform public.stock_source_validate_movement(provenance.movement_id);
   end if;
   if exists(select 1 from public.controlled_stock_opening_movements where movement_id=allocation.movement_id and opening_id=opening.id) then opened:=opened+1;end if;
   if selected_source_kind='dispense' then
    select * into link from public.controlled_stock_source_links where movement_id=allocation.movement_id;
    if link.id is not null then
     linked:=linked+1;
     if parent_id is not null and parent_id<>link.event_id then raise exception 'adapter_source_integrity' using errcode='23514';end if;
     parent_id:=link.event_id;ids:=ids||jsonb_build_array(link.id);
    end if;
   end if;
  end loop;
  if n=0 or sourced not in(0,n) or opened not in(0,n) then raise exception 'adapter_source_integrity' using errcode='23514';end if;
  select count(*) into dispense_root_count from(select s.movement_id from public.stock_movement_sources s
   where s.writer='record_native_dispense' and s.source_id=did limit 101)q;
  if dispense_root_count>100 then raise exception 'evidence_limit_exceeded' using errcode='54000';end if;
  if dispense_root_count<>sourced or exists(select 1 from public.stock_movement_sources s
   where s.writer='record_native_dispense' and s.source_id=did
   and not exists(select 1 from public.native_dispense_allocations a where a.dispense_id=did and a.movement_id=s.movement_id)) then
   raise exception 'adapter_source_integrity' using errcode='23514';end if;
  if selected_source_kind='dispense' then
   if linked not in(0,n) or(linked>0 and(opened>0 or sourced<>n)) then raise exception 'adapter_source_integrity' using errcode='23514';end if;
  else
   case selected_source_kind
   when 'return' then select * into link from public.controlled_stock_source_links where return_event_id=selected_source_id;
   when 'pickup' then select * into link from public.controlled_stock_source_links where pickup_id=selected_source_id;
   when 'discrepancy' then select * into link from public.controlled_stock_source_links where discrepancy_event_id=selected_source_id;
   when 'correction' then select * into link from public.controlled_stock_source_links where correction_event_id=selected_source_id;
   end case;
  end if;
 end if;
 if selected_source_kind<>'dispense' and link.id is not null then parent_id:=link.event_id;ids:=jsonb_build_array(link.id);end if;
 if parent_id is not null then
  if(selected_source_kind not in('movement','dispense') and native_source_provenance is null)
  or(selected_source_kind='return' and return_sourced<>return_count) then
   raise exception 'adapter_source_integrity' using errcode='23514';end if;
  select * into e from public.controlled_stock_events where id=parent_id;
  if e.id is null or e.product_id<>product or(opening.id is not null and e.opening_id<>opening.id) then
   raise exception 'adapter_source_integrity' using errcode='23514';end if;
  perform public.controlled_stock_validate_event(e.id);
  expected_writer:=case selected_source_kind when 'dispense' then 'record_native_dispense' when 'pickup' then 'record_native_pickup'
   when 'correction' then 'append_native_dispense_correction' when 'discrepancy' then 'record_native_return_discrepancy'
   when 'return' then case source_row#>>'{document,version}' when '1' then 'record_native_dispense_return' when '2' then 'record_native_dispense_return_v2' end
   when 'movement' then provenance.writer end;
  if expected_writer is null or e.writer<>expected_writer or(selected_source_kind<>'movement' and(e.id<>selected_source_id or e.actor_id::text is distinct from source_row->>'actor_id'))
  or(selected_source_kind='movement' and(provenance.movement_id is null or e.id<>provenance.source_id or e.actor_id<>provenance.actor_id
   or not exists(select 1 from jsonb_array_elements(e.source_bundle->'available') x where x->>'id'=selected_source_id::text)))
  or(selected_source_kind not in('movement','dispense') and(e.source_bundle#>>'{native,kind}'<>selected_source_kind or e.source_bundle#>>'{native,id}'<>selected_source_id::text)) then
   raise exception 'adapter_source_integrity' using errcode='23514';end if;
  select jsonb_agg(x order by (x#>>'{}') collate "C") into ids from jsonb_array_elements(ids) x;
  return jsonb_build_object('event_id',e.id,'source_link_ids',ids);
 end if;
 if exists(select 1 from public.controlled_stock_events where id=case when selected_source_kind='movement' then coalesce(provenance.source_id,selected_source_id) else selected_source_id end) then
  raise exception 'adapter_source_integrity' using errcode='23514';end if;
 if opening.id is not null then
  if selected_source_kind='movement' then
   if not exists(select 1 from public.controlled_stock_opening_movements where opening_id=opening.id and movement_id=selected_source_id) then
    raise exception 'adapter_source_integrity' using errcode='23514';end if;
  else
   select x into entry from jsonb_array_elements(opening.native_custody_boundary) x where x->>'dispense_id'=did::text;
   if entry is null or opened<>n
   or(selected_source_kind='return' and(source_row->>'sequence')::integer>(entry#>>'{return_head,version}')::integer)
   or(selected_source_kind='correction' and(source_row->>'sequence')::integer>(entry#>>'{correction_head,version}')::integer)
   or(selected_source_kind='discrepancy' and(source_row->>'sequence')::integer>(entry#>>'{discrepancy_head,version}')::integer)
   or(selected_source_kind='pickup' and entry#>>'{pickup,id}' is distinct from selected_source_id::text) then
    raise exception 'adapter_source_integrity' using errcode='23514';end if;
  end if;
 end if;
 return null;
end
-- END FUNCTION

-- BEGIN FUNCTION adapter_parent|jsonb|plpgsql
declare state jsonb:=p_state; e public.controlled_stock_events; r record; row_value jsonb;
begin
 if p_role is null or p_role<>all(array['reviewed_target','correction_target','ordinary_source','original_dispense','original_pickup']) then
  raise exception 'adapter_source_role_conflict' using errcode='23514';end if;
 select * into e from public.controlled_stock_events where id=p_event_id;
 if e.id is null or e.product_id::text is distinct from state->>'product_id'
 or e.opening_id::text is distinct from state->>'opening_id' then
  raise exception 'adapter_parent_integrity' using errcode='23514';end if;
 perform public.controlled_stock_validate_event(e.id);
 state:=controlled_review_v3.adapter_add(state,'public.controlled_stock_events',jsonb_build_object('id',e.id),to_jsonb(e),p_role);
 select to_jsonb(a) into row_value from public.controlled_stock_actions a where a.id=e.id;
 state:=controlled_review_v3.adapter_add(state,'public.controlled_stock_actions',jsonb_build_object('id',e.id),row_value,p_role);
 select to_jsonb(a) into row_value from public.controlled_stock_preparations a where a.id=e.id;
 state:=controlled_review_v3.adapter_add(state,'public.controlled_stock_preparations',jsonb_build_object('id',e.id),row_value,p_role);
 select to_jsonb(a) into row_value from public.controlled_stock_policy_versions a where a.id=e.policy_version_id;
 state:=controlled_review_v3.adapter_add(state,'public.controlled_stock_policy_versions',jsonb_build_object('id',e.policy_version_id),row_value,p_role);
 select to_jsonb(a) into row_value from public.controlled_stock_openings a where a.id=e.opening_id;
 state:=controlled_review_v3.adapter_add(state,'public.controlled_stock_openings',jsonb_build_object('id',e.opening_id),row_value,p_role);
 for r in select * from public.controlled_stock_source_links where event_id=e.id order by id limit 513 loop
  state:=controlled_review_v3.adapter_add(state,'public.controlled_stock_source_links',jsonb_build_object('id',r.id),to_jsonb(r),p_role);
 end loop;
 for r in select * from public.controlled_stock_event_lines where event_id=e.id order by cell_id,source_link_id limit 513 loop
  state:=controlled_review_v3.adapter_add(state,'public.controlled_stock_event_lines',jsonb_build_object('id',r.id),to_jsonb(r),p_role);
  select to_jsonb(c) into row_value from public.controlled_stock_cells c where c.id=r.cell_id;
  state:=controlled_review_v3.adapter_add(state,'public.controlled_stock_cells',jsonb_build_object('id',r.cell_id),row_value,p_role);
  select to_jsonb(c) into row_value from public.controlled_stock_containers c where c.id=(row_value->>'container_id')::uuid;
  state:=controlled_review_v3.adapter_add(state,'public.controlled_stock_containers',jsonb_build_object('id',row_value->'id'),row_value,p_role);
 end loop;
 for r in select * from public.controlled_stock_container_transitions where event_id=e.id order by container_id limit 513 loop
  state:=controlled_review_v3.adapter_add(state,'public.controlled_stock_container_transitions',jsonb_build_object('id',r.id),to_jsonb(r),p_role);
  select to_jsonb(c) into row_value from public.controlled_stock_containers c where c.id=r.container_id;
  state:=controlled_review_v3.adapter_add(state,'public.controlled_stock_containers',jsonb_build_object('id',r.container_id),row_value,p_role);
 end loop;
 return state;
end
-- END FUNCTION

-- BEGIN FUNCTION adapter_event_site|jsonb|plpgsql
declare e public.controlled_stock_events; site uuid; unit text; r record; n integer:=0;
begin
 select * into e from public.controlled_stock_events where id=p_event_id;
 if e.id is null then raise exception 'adapter_parent_integrity' using errcode='23514';end if;
 select stock_unit into unit from public.controlled_stock_policy_versions where id=e.policy_version_id;
 for r in select c.controlling_site_id,c.product_id,c.stock_unit from public.controlled_stock_container_transitions t
  join public.controlled_stock_containers c on c.id=t.container_id where t.event_id=e.id order by t.container_id limit 513 loop
  n:=n+1;
  if n>512 then raise exception 'evidence_limit_exceeded' using errcode='54000';end if;
  if r.product_id<>e.product_id or r.stock_unit is distinct from unit or(site is not null and site<>r.controlling_site_id) then
   raise exception 'adapter_source_integrity' using errcode='23514';end if;
  site:=r.controlling_site_id;
 end loop;
 if e.basis in('physical_record','correction_assertion') and(site is null or not exists(select 1 from public.controlled_stock_event_lines where event_id=e.id)) then
  raise exception 'adapter_source_integrity' using errcode='23514';end if;
 return jsonb_build_object('site_id',site);
end
-- END FUNCTION
