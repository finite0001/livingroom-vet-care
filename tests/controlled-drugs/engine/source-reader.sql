-- Local source-reconciliation oracle for C1b engineering proofs only.
-- Installed in pg_temp inside a rolled-back owned clone; never a hosted RPC.
create or replace function pg_temp.controlled_stock_source_bundle(
 p_writer text,p_root uuid,p_actor uuid,p_result jsonb
)returns jsonb language plpgsql volatile security invoker
set search_path=public,pg_temp set timezone='UTC' as $$
declare expected jsonb;native_document jsonb;native_kind text;dispense uuid;
 product uuid;products uuid[];available jsonb;allocations jsonb;
 movement_count integer;actual_actor uuid;source_count integer;return_source jsonb;verified_dispense jsonb;
begin
 if p_root is null or p_actor is null or p_result is null then
  raise exception 'Exact controlled source identity required'using errcode='23514';end if;
 case p_writer
 when 'receive_inventory','adjust_inventory'then
  select to_jsonb(m),m.created_by into expected,actual_actor
  from public.inventory_movements m where m.id=p_root;
 when 'record_patient_treatment'then
  select to_jsonb(t),t.created_by into expected,actual_actor
  from public.patient_treatments t where t.id=p_root and not t.historical;
 when 'record_anesthesia_drug_administration'then
  -- The outer writer returns its treatment row, not the separate audit link.
  select to_jsonb(t),a.created_by into expected,actual_actor
  from public.anesthesia_drug_administrations a
  join public.patient_treatments t on t.id=a.id and t.created_by=a.created_by
  where a.id=p_root;
 when 'record_native_dispense'then
  select public.native_fulfillment_receipt(o),d.actor_id,d.id,d.document
  into expected,actual_actor,dispense,native_document
  from public.native_dispenses d join public.native_fulfillment_operations o
   on o.id=d.id and o.operation='dispense'and o.actor_id=d.actor_id
  where d.id=p_root and o.result->'dispense'=d.document;
  native_kind:='dispense';
 when 'record_native_dispense_return','record_native_dispense_return_v2'then
  select e.actor_id,e.dispense_id,e.document into actual_actor,dispense,native_document
  from public.native_return_events e join public.stock_custody_sources s
   on s.event_id=e.id and s.actor_id=e.actor_id and s.writer=p_writer
  join public.native_return_operations o on o.id=e.id and o.actor_id=e.actor_id and o.result=e.document
  where e.id=p_root and e.document->>'version'=case p_writer when 'record_native_dispense_return'then '1'else '2'end;
  if p_writer='record_native_dispense_return'then
   select public.native_return_receipt(o)into expected from public.native_return_operations o where o.id=p_root;
  else
   select jsonb_build_object('version',2,'id',o.id,'actor_id',o.actor_id,'request',o.request,
    'request_hash',o.request_hash,'result',o.result,'created_at',o.created_at)into expected
   from public.native_return_operations o where o.id=p_root;
  end if;
  -- Provenance remains verifiable after the original recorder retires. This
  -- private data reader must not borrow an owner-only recovery RPC's Auth gate.
  perform public.native_reconciliation_verified((native_document#>>'{target,authorization_id}')::uuid,
   (native_document#>>'{target,pet_id}')::uuid,dispense);
  native_kind:='return';
  select jsonb_build_object('action',e.action,'intake_id',coalesce(e.intake_id,e.id),
   'intake_document',i.document,'intake_reviewed_context',i.reviewed_context)
  into return_source from public.native_return_events e
  join public.native_return_events i on i.id=coalesce(e.intake_id,e.id)
   and i.action='intake'and i.dispense_id=e.dispense_id
  where e.id=p_root;
  if return_source is null then raise exception 'Exact original intake source required'using errcode='23514';end if;
 when 'record_native_return_discrepancy'then
  select e.actor_id,e.dispense_id,e.document into actual_actor,dispense,native_document
  from public.native_return_discrepancy_events e join public.stock_discrepancy_sources s
   on s.event_id=e.id and s.actor_id=e.actor_id
  join public.native_return_discrepancy_operations o on o.id=e.id and o.actor_id=e.actor_id and o.result=e.document
  where e.id=p_root;
  select jsonb_build_object('version',1,'id',o.id,'actor_id',o.actor_id,'request',o.request,
   'request_hash',o.request_hash,'result',o.result,'created_at',o.created_at)into expected
  from public.native_return_discrepancy_operations o where o.id=p_root;
  perform public.native_reconciliation_verified((native_document#>>'{target,authorization_id}')::uuid,
   (native_document#>>'{target,pet_id}')::uuid,dispense);
  native_kind:='discrepancy';
 when 'record_native_pickup'then
  select public.native_fulfillment_receipt(o),e.actor_id,e.dispense_id,e.document
  into expected,actual_actor,dispense,native_document
  from public.native_pickups e join public.stock_pickup_sources s on s.event_id=e.id and s.actor_id=e.actor_id
  join public.native_fulfillment_operations o on o.id=e.id and o.operation='pickup'and o.actor_id=e.actor_id and o.result=e.document
  where e.id=p_root;
  native_kind:='pickup';
 when 'append_native_dispense_correction'then
  select public.native_correction_receipt(o),e.actor_id,e.dispense_id,e.document
  into expected,actual_actor,dispense,native_document
  from public.native_dispense_correction_events e join public.stock_correction_sources s on s.event_id=e.id and s.actor_id=e.actor_id
  join public.native_dispense_correction_operations o on o.id=e.id and o.actor_id=e.actor_id and o.result=e.document
  where e.id=p_root;
  native_kind:='correction';
 else raise exception 'Reviewed controlled source writer required'using errcode='23514';
 end case;
 if expected is null or expected is distinct from p_result or actual_actor is distinct from p_actor then
  raise exception 'Original controlled canonical receipt required'using errcode='23514';end if;

 -- Keep every actual signed movement as a distinct source; never net opposing
 -- compensation entries or assign meaning by the order of generated UUIDs.
 select count(*)::integer into source_count from(select 1 from public.stock_movement_sources s
  where s.writer=p_writer and s.source_id=p_root limit 101)bounded;
 if source_count>100 then raise exception 'Bounded controlled source movements required'using errcode='23514';end if;
 if exists(select 1 from public.stock_movement_sources s where s.writer=p_writer and s.source_id=p_root and s.actor_id is distinct from p_actor)then
  raise exception 'Exact controlled source actor required'using errcode='23514';end if;
 perform public.stock_source_validate_movement(s.movement_id)
 from public.stock_movement_sources s where s.writer=p_writer and s.source_id=p_root;
 select count(*)::integer,array_agg(distinct l.product_id),coalesce(jsonb_agg(jsonb_build_object(
  'kind','movement','id',m.id,'lot_id',m.lot_id,'product_id',l.product_id,
  'quantity_delta',m.quantity::text,'native_kind',m.kind
 )order by m.id),'[]'::jsonb)into movement_count,products,available
 from public.stock_movement_sources s join public.inventory_movements m on m.id=s.movement_id
 join public.inventory_lots l on l.id=m.lot_id
 where s.writer=p_writer and s.source_id=p_root and s.actor_id=p_actor;
 if p_writer in('receive_inventory','adjust_inventory','record_patient_treatment','record_anesthesia_drug_administration')then
  if movement_count<>1 then raise exception 'One original controlled stock movement required'using errcode='23514';end if;
 elsif p_writer in('record_native_return_discrepancy','record_native_pickup','append_native_dispense_correction')and movement_count<>0 then
  raise exception 'Custody or annotation cannot invent available stock effects'using errcode='23514';
 end if;

 if native_kind is not null then
  if native_document is null or dispense is null then raise exception 'Exact native controlled source required'using errcode='23514';end if;
  verified_dispense:=public.native_fulfillment_verified_dispense(dispense);
  if verified_dispense is null or(native_kind='dispense'and verified_dispense is distinct from native_document)then
   raise exception 'Verified original native dispense required'using errcode='23514';end if;
  select array_agg(distinct l.product_id),count(*)::integer,coalesce(jsonb_agg(jsonb_build_object(
   'allocation_id',a.id,'dispense_id',a.dispense_id,'lot_id',a.lot_id,
   'movement_id',a.movement_id,'quantity',a.quantity::text
  )order by a.lot_id),'[]'::jsonb)into products,source_count,allocations
  from public.native_dispense_allocations a join public.inventory_lots l on l.id=a.lot_id
  where a.dispense_id=dispense;
  if source_count not between 1 and 100 or cardinality(products)<>1 then
   raise exception 'Exact single-product native allocation membership required'using errcode='23514';end if;
  if p_writer='record_native_dispense'and movement_count<>source_count then
   raise exception 'Every controlled dispense allocation needs its original debit'using errcode='23514';end if;
 end if;
 if cardinality(products)is distinct from 1 then
  raise exception 'One exact controlled source product required'using errcode='23514';end if;
 product:=products[1];
 if exists(select 1 from jsonb_array_elements(available)source where(source->>'product_id')::uuid is distinct from product)then
  raise exception 'Controlled source product membership changed'using errcode='23514';end if;
 -- The caller must still reconcile per-source custody effects to its frozen
 -- container slots. Returning this bundle never authorizes or posts an event.
 return jsonb_build_object('version',1,'writer',p_writer,'root',p_root,
  'actor_id',p_actor,'product_id',product,'available',available,
  'native',case when native_kind is null then 'null'::jsonb else
   jsonb_build_object('kind',native_kind,'id',p_root,'dispense_id',dispense,
    'document',native_document,'original_allocations',allocations,
    'return_source',coalesce(return_source,'null'::jsonb))end);
end $$;
revoke all on function pg_temp.controlled_stock_source_bundle(text,uuid,uuid,jsonb)from public,anon,authenticated,service_role;
