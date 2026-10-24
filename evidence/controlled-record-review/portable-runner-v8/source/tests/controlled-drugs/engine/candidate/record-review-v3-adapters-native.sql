-- Private A1 immutable native sources. Original rows are never rewritten.
-- BEGIN FUNCTION adapter_dispense|jsonb|plpgsql
declare state jsonb:=p_state; d public.native_dispenses; op public.native_fulfillment_operations;
 item public.billing_invoice_items; a record; m public.inventory_movements; managed jsonb;
 n integer:=0; source_count integer; total numeric:=0; unit text;
begin
 if p_role is null or p_role<>all(array['reviewed_target','original_dispense']) then
  raise exception 'adapter_source_role_conflict' using errcode='23514';end if;
 if p_depth is null or p_depth<0 or p_depth>4 then raise exception 'evidence_limit_exceeded' using errcode='54000';end if;
 select * into d from public.native_dispenses where id=p_dispense_id;
 select * into op from public.native_fulfillment_operations where id=p_dispense_id;
 select * into item from public.billing_invoice_items where id=d.invoice_item_id;
 select stock_unit into unit from public.controlled_stock_policy_versions where id=(select policy_version_id from public.controlled_stock_events where id=(state->>'target_event_id')::uuid);
 if d.id is null or op.id is null or item.id is null or op.operation<>'dispense' or op.actor_id<>d.actor_id
 or op.result->'dispense' is distinct from d.document or item.product_id<>p_product_id or item.quantity<>d.quantity
 or item.created_by<>d.actor_id or item.invoice_id<>d.invoice_id or item.pet_id is distinct from d.pet_id
 or d.document->>'unit' is distinct from unit or state->>'product_id' is distinct from p_product_id::text then
  raise exception 'adapter_source_integrity' using errcode='23514';end if;
 managed:=controlled_review_v3.managed_source_event(jsonb_build_object('source_kind','dispense','source_id',d.id,'product_id',p_product_id));
 if managed is not null then state:=controlled_review_v3.adapter_parent(state,(managed->>'event_id')::uuid,p_role);end if;
 state:=controlled_review_v3.adapter_add(state,'public.native_dispenses',jsonb_build_object('id',d.id),to_jsonb(d),p_role);
 state:=controlled_review_v3.adapter_add(state,'public.native_fulfillment_operations',jsonb_build_object('id',op.id),to_jsonb(op),p_role);
 state:=controlled_review_v3.adapter_add(state,'public.billing_invoice_items',jsonb_build_object('id',item.id),to_jsonb(item),p_role);
 for a in select * from public.native_dispense_allocations where dispense_id=d.id order by lot_id limit 101 loop
  n:=n+1;if n>100 then raise exception 'evidence_limit_exceeded' using errcode='54000';end if;
  select * into m from public.inventory_movements where id=a.movement_id;
  if m.id is null or m.lot_id<>a.lot_id or m.quantity<>-a.quantity or m.kind<>'dispense' then
   raise exception 'adapter_source_integrity' using errcode='23514';end if;
  total:=total+a.quantity;
  state:=controlled_review_v3.adapter_add(state,'public.native_dispense_allocations',jsonb_build_object('id',a.id),to_jsonb(a),p_role);
  state:=controlled_review_v3.adapter_movement(state,a.movement_id,'record_native_dispense',d.id,d.actor_id,p_role,managed is not null);
 end loop;
 if n=0 or total<>d.quantity then raise exception 'adapter_source_integrity' using errcode='23514';end if;
 select count(*) into source_count from(select movement_id from public.stock_movement_sources where writer='record_native_dispense' and source_id=d.id limit 101) q;
 if source_count>100 then raise exception 'evidence_limit_exceeded' using errcode='54000';end if;
 if source_count not in(0,n) or(managed is not null and source_count<>n)
 or exists(select 1 from public.stock_movement_sources s where writer='record_native_dispense' and source_id=d.id
  and not exists(select 1 from public.native_dispense_allocations allocation_row where allocation_row.dispense_id=d.id and allocation_row.movement_id=s.movement_id)) then
  raise exception 'adapter_source_integrity' using errcode='23514';end if;
 return state;
end
-- END FUNCTION

-- BEGIN FUNCTION adapter_pickup|jsonb|plpgsql
declare state jsonb:=p_state; p public.native_pickups; op public.native_fulfillment_operations;
 provenance public.stock_pickup_sources; managed jsonb;
begin
 if p_role is null or p_role<>all(array['reviewed_target','original_pickup']) then
  raise exception 'adapter_source_role_conflict' using errcode='23514';end if;
 if p_depth is null or p_depth<0 or p_depth>4 then raise exception 'evidence_limit_exceeded' using errcode='54000';end if;
 select * into p from public.native_pickups where id=p_pickup_id;
 select * into op from public.native_fulfillment_operations where id=p_pickup_id;
 select * into provenance from public.stock_pickup_sources where event_id=p_pickup_id;
 if p.id is null or op.id is null or op.operation<>'pickup' or op.actor_id<>p.actor_id or op.result is distinct from p.document then
  raise exception 'adapter_source_integrity' using errcode='23514';end if;
 managed:=controlled_review_v3.managed_source_event(jsonb_build_object('source_kind','pickup','source_id',p.id,'product_id',p_product_id));
 if managed is not null then state:=controlled_review_v3.adapter_parent(state,(managed->>'event_id')::uuid,p_role);end if;
 if provenance.event_id is null and managed is not null then raise exception 'adapter_source_integrity' using errcode='23514';end if;
 if provenance.event_id is not null then
  if provenance.actor_id<>p.actor_id then raise exception 'adapter_source_integrity' using errcode='23514';end if;
  state:=controlled_review_v3.adapter_add(state,'public.stock_pickup_sources',jsonb_build_object('event_id',p.id),to_jsonb(provenance),p_role);
 end if;
 state:=controlled_review_v3.adapter_add(state,'public.native_pickups',jsonb_build_object('id',p.id),to_jsonb(p),p_role);
 state:=controlled_review_v3.adapter_add(state,'public.native_fulfillment_operations',jsonb_build_object('id',op.id),to_jsonb(op),p_role);
 state:=controlled_review_v3.adapter_dispense(state,p.dispense_id,p_product_id,'original_dispense',p_depth+1);
 return state;
end
-- END FUNCTION

-- BEGIN FUNCTION adapter_return|jsonb|plpgsql
declare state jsonb:=p_state; r public.native_return_events; op public.native_return_operations;
 provenance public.stock_custody_sources; original public.native_return_events;
 stock public.native_return_stock_links; movement public.inventory_movements; a public.native_dispense_allocations;
 x record; managed jsonb; source_writer text; n integer:=0; source_count integer; target_id uuid;
begin
 if p_role is null or p_role<>all(array['reviewed_target','correction_target','ordinary_source','original_intake','resolution_correction']) then
  raise exception 'adapter_source_role_conflict' using errcode='23514';end if;
 if p_depth is null or p_depth<0 or p_depth>4 then raise exception 'evidence_limit_exceeded' using errcode='54000';end if;
 select * into r from public.native_return_events where id=p_return_id;
 select * into op from public.native_return_operations where id=p_return_id;
 select * into provenance from public.stock_custody_sources where event_id=p_return_id;
 source_writer:=case r.document->>'version' when '1' then 'record_native_dispense_return' when '2' then 'record_native_dispense_return_v2' end;
 if r.id is null or op.id is null or source_writer is null or op.actor_id<>r.actor_id or op.result is distinct from r.document
 or r.document->>'record_hash' is distinct from r.record_hash or public.native_fulfillment_hash(r.document-'record_hash') is distinct from r.record_hash then
  raise exception 'adapter_source_integrity' using errcode='23514';end if;
 managed:=controlled_review_v3.managed_source_event(jsonb_build_object('source_kind','return','source_id',r.id,'product_id',p_product_id));
 -- Only these return roles declare parent/physical reference edges.
 if managed is not null and p_role in('reviewed_target','correction_target','ordinary_source') then
  state:=controlled_review_v3.adapter_parent(state,(managed->>'event_id')::uuid,p_role);end if;
 if provenance.event_id is null and managed is not null then raise exception 'adapter_source_integrity' using errcode='23514';end if;
 if provenance.event_id is not null then
  if provenance.actor_id<>r.actor_id or provenance.writer<>source_writer then raise exception 'adapter_source_integrity' using errcode='23514';end if;
  state:=controlled_review_v3.adapter_add(state,'public.stock_custody_sources',jsonb_build_object('event_id',r.id),to_jsonb(provenance),p_role);
 end if;
 state:=controlled_review_v3.adapter_add(state,'public.native_return_events',jsonb_build_object('id',r.id),to_jsonb(r),p_role);
 state:=controlled_review_v3.adapter_add(state,'public.native_return_operations',jsonb_build_object('id',op.id),to_jsonb(op),p_role);
 state:=controlled_review_v3.adapter_dispense(state,r.dispense_id,p_product_id,'original_dispense',p_depth+1);
 if r.intake_id is not null then
  select * into original from public.native_return_events where id=r.intake_id;
  if original.id is null or original.id=r.id or original.action<>'intake' or original.dispense_id<>r.dispense_id or original.sequence>=r.sequence then
   raise exception 'adapter_source_integrity' using errcode='23514';end if;
  state:=controlled_review_v3.adapter_return(state,original.id,p_product_id,'original_intake',p_depth+1);
 end if;
 if r.action in('retract_intake','retract_disposal','retract_restock') then
  target_id:=(r.document#>>'{correction_target,event_id}')::uuid;
  select * into original from public.native_return_events where id=target_id;
  if original.id is null or original.id=r.id or original.dispense_id<>r.dispense_id or original.sequence>=r.sequence
  or original.record_hash is distinct from r.document#>>'{correction_target,record_hash}'
  or original.action is distinct from(case r.action when 'retract_intake' then 'intake' when 'retract_disposal' then 'dispose' else 'restock' end)
  or controlled_review_v3.managed_source_event(jsonb_build_object('source_kind','return','source_id',target_id,'product_id',p_product_id)) is null then
   raise exception 'adapter_source_integrity' using errcode='23514';end if;
  state:=controlled_review_v3.adapter_return(state,target_id,p_product_id,'correction_target',p_depth+1);
 end if;
 if r.action='restock' then
  for x in select * from public.native_return_stock_links where event_id=r.id order by allocation_id limit 101 loop
   n:=n+1;if n>100 then raise exception 'evidence_limit_exceeded' using errcode='54000';end if;
   select * into a from public.native_dispense_allocations where id=x.allocation_id;
   select * into movement from public.inventory_movements where id=x.movement_id;
   if a.id is null or movement.id is null or a.dispense_id<>r.dispense_id or a.lot_id<>x.lot_id or movement.lot_id<>x.lot_id or movement.quantity<>x.quantity
   or not exists(select 1 from jsonb_array_elements(r.document->'allocations') d where d->>'allocation_id'=x.allocation_id::text
    and d->>'movement_id'=x.movement_id::text and(d->>'quantity')::numeric=x.quantity and d->>'lot_id'=x.lot_id::text) then
    raise exception 'adapter_source_integrity' using errcode='23514';end if;
   state:=controlled_review_v3.adapter_add(state,'public.native_return_stock_links',jsonb_build_object('id',x.id),to_jsonb(x),p_role);
   state:=controlled_review_v3.adapter_movement(state,x.movement_id,source_writer,r.id,r.actor_id,p_role,managed is not null);
  end loop;
 elsif r.action='retract_restock' then
  for x in select * from public.native_return_compensation_links where event_id=r.id order by allocation_id limit 101 loop
   n:=n+1;if n>100 then raise exception 'evidence_limit_exceeded' using errcode='54000';end if;
   select * into stock from public.native_return_stock_links where event_id=target_id and allocation_id=x.allocation_id;
   select * into movement from public.inventory_movements where id=x.movement_id;
   if stock.id is null or movement.id is null or x.target_event_id<>target_id or x.original_movement_id<>stock.movement_id or x.lot_id<>stock.lot_id
   or movement.lot_id<>x.lot_id or movement.quantity<>-x.quantity
   or not exists(select 1 from jsonb_array_elements(r.document->'allocations') d where d->>'allocation_id'=x.allocation_id::text
    and d->>'movement_id'=x.movement_id::text and(d->>'quantity')::numeric=x.quantity and d->>'lot_id'=x.lot_id::text) then
    raise exception 'adapter_source_integrity' using errcode='23514';end if;
   state:=controlled_review_v3.adapter_add(state,'public.native_return_compensation_links',jsonb_build_object('id',x.id),to_jsonb(x),p_role);
   state:=controlled_review_v3.adapter_add(state,'public.native_return_stock_links',jsonb_build_object('id',stock.id),to_jsonb(stock),'correction_target');
   -- adapter_return(target) already retained/checked the original positive movement.
   -- Its exact stock link above binds original_movement_id; retain the distinct negative movement now.
   state:=controlled_review_v3.adapter_movement(state,x.movement_id,source_writer,r.id,r.actor_id,p_role,managed is not null);
  end loop;
 end if;
 if r.action in('restock','retract_restock') and(n=0 or n<>jsonb_array_length(r.document->'allocations')) then
  raise exception 'adapter_source_integrity' using errcode='23514';end if;
 select count(*) into source_count from(select movement_id from public.stock_movement_sources s where s.writer=source_writer and s.source_id=r.id limit 101) q;
 if source_count>100 then raise exception 'evidence_limit_exceeded' using errcode='54000';end if;
 if source_count not in(0,n) or(managed is not null and source_count<>n)
 or exists(select 1 from public.stock_movement_sources s where s.writer=source_writer and s.source_id=r.id
  and not exists(select 1 from public.native_return_stock_links l where r.action='restock' and l.event_id=r.id and l.movement_id=s.movement_id)
  and not exists(select 1 from public.native_return_compensation_links l where r.action='retract_restock' and l.event_id=r.id and l.movement_id=s.movement_id)) then
  raise exception 'adapter_source_integrity' using errcode='23514';end if;
 return state;
end
-- END FUNCTION
