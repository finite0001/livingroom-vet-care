-- PRIVATE LOCAL CANDIDATE ONLY. No commissioning API, grants or policy defaults.
-- Limits: 200 product dispenses/boundary entries, 100 allocations per dispense,
-- 1000 events per native history family (including later history), 1 MiB boundary.
-- Pre-C1a native sources without provenance remain unsupported, not inferred old.
create function public.controlled_stock_opening_selector(value jsonb)returns integer
language plpgsql immutable set search_path=public,pg_temp set timezone='UTC' as $$
declare n integer;begin
 perform public.controlled_stock_keys(value,array['event_id','version','record_hash']);
 if jsonb_typeof(value->'version')is distinct from 'number'or(value->>'version')!~'^(0|[1-9][0-9]{0,3})$'then
  raise exception 'Bounded canonical opening prefix required'using errcode='23514';end if;
 n:=(value->>'version')::integer;
 if n>1000 then raise exception 'Opening prefix exceeds candidate limit'using errcode='23514';end if;
 if n=0 then
  if value is distinct from jsonb_build_object('event_id',null,'version',0,'record_hash',null)then
   raise exception 'Exact empty opening prefix required'using errcode='23514';end if;
 else
  perform public.controlled_stock_uuid(value->'event_id');
  if jsonb_typeof(value->'record_hash')is distinct from 'string'or(value->>'record_hash')!~'^[0-9a-f]{64}$'then
   raise exception 'Exact opening prefix hash required'using errcode='23514';end if;
 end if;return n;
end $$;
create function public.controlled_stock_opening_head(events jsonb,n integer)returns jsonb
language plpgsql immutable set search_path=public,pg_temp set timezone='UTC' as $$begin
 if n is null or n<0 or n>1000 or jsonb_typeof(events)is distinct from 'array'or n>jsonb_array_length(events)then
  raise exception 'Exact opening prefix unavailable'using errcode='23514';end if;
 if n=0 then return jsonb_build_object('event_id',null,'version',0,'record_hash',null);end if;
 if(events->(n-1)->>'sequence')::integer is distinct from n then
  raise exception 'Opening prefix sequence mismatch'using errcode='23514';end if;
 return jsonb_build_object('event_id',events->(n-1)->'id','version',n,'record_hash',events->(n-1)->'record_hash');
end $$;
create function public.controlled_stock_opening_contains_head(events jsonb,head jsonb,n integer)returns boolean
language plpgsql immutable set search_path=public,pg_temp set timezone='UTC' as $$declare v integer;begin
 v:=public.controlled_stock_opening_selector(head);
 return v<=n and head=public.controlled_stock_opening_head(events,v);
end $$;
create function public.controlled_stock_opening_pickup(p_dispense uuid)returns jsonb
language plpgsql stable set search_path=public,pg_temp set timezone='UTC' as $$
declare p public.native_pickups;o public.native_fulfillment_operations;d jsonb;c jsonb;r public.native_refill_events;before_refill jsonb;begin
 select * into p from public.native_pickups where dispense_id=p_dispense;
 if not found then return null;end if;
 d:=public.native_fulfillment_verified_dispense(p_dispense);c:=p.document->'reviewed_context';
 select * into o from public.native_fulfillment_operations where id=p.id;
 perform public.controlled_stock_keys(p.document,array['version','id','authorization_id','pet_id','dispense_id','actor_id','recipient_name','recipient_relationship','reason','reviewed_context','reviewed_context_hash','refill_id','refill_event_id','picked_up_at']);
 perform public.controlled_stock_keys(c,array['version','authorization','dispense','existing_pickup_id','refill']);
 perform public.controlled_stock_keys(o.request,array['authorization_id','pet_id','dispense_id','expected_context_hash','recipient_name','recipient_relationship','reason','attest_handoff','refill_close']);
 if d is null or p.document->'version'is distinct from '1'::jsonb or c->'version'is distinct from '1'::jsonb
  or p.document->>'id'is distinct from p.id::text or p.document->>'authorization_id'is distinct from p.authorization_id::text
  or p.document->>'pet_id'is distinct from p.pet_id::text or p.document->>'dispense_id'is distinct from p.dispense_id::text
  or p.document->>'actor_id'is distinct from p.actor_id::text
  or p.authorization_id::text is distinct from d->>'authorization_id'or p.pet_id::text is distinct from d->>'pet_id'
  or public.native_correction_instant(p.document->'picked_up_at')is distinct from p.picked_up_at
  or not isfinite(o.created_at)or o.created_at<p.picked_up_at
  or o.id is null or o.operation<>'pickup'or o.actor_id<>p.actor_id or o.result is distinct from p.document
  or o.request_hash is distinct from public.native_fulfillment_hash(jsonb_build_object('version',1,'actor_id',o.actor_id,'operation','pickup','request',o.request))
  -- Original pickup requests allow mixed-case UUIDs; preserve their exact hash.
  or public.native_rx_uuid(o.request->'authorization_id')is distinct from p.authorization_id
  or public.native_rx_uuid(o.request->'pet_id')is distinct from p.pet_id
  or public.native_rx_uuid(o.request->'dispense_id')is distinct from p.dispense_id
  or o.request->'attest_handoff'is distinct from 'true'::jsonb
  or p.document->'recipient_name'is distinct from o.request->'recipient_name'
  or p.document->'recipient_relationship'is distinct from o.request->'recipient_relationship'
  or p.document->'reason'is distinct from o.request->'reason'
  or p.document->>'reviewed_context_hash'is distinct from public.native_fulfillment_hash(c)
  or o.request->>'expected_context_hash'is distinct from p.document->>'reviewed_context_hash'
  or c->'dispense'is distinct from d or c->'existing_pickup_id'is distinct from 'null'::jsonb
  or c#>>'{authorization,id}'is distinct from p.authorization_id::text
  or c#>>'{authorization,hash}'is distinct from d->>'authorization_hash'
  or not exists(select 1 from public.stock_pickup_sources s where s.event_id=p.id and s.actor_id=p.actor_id)then
  raise exception 'Verified original pickup row, operation and provenance required'using errcode='23514';end if;
 perform public.native_rx_text(o.request->'recipient_name',200);perform public.native_rx_text(o.request->'recipient_relationship',200);perform public.native_rx_text(o.request->'reason',2000);
 if c->'refill'='null'::jsonb then
  if o.request->'refill_close'is distinct from 'null'::jsonb or p.document->'refill_id'is distinct from 'null'::jsonb
   or p.document->'refill_event_id'is distinct from 'null'::jsonb then
   raise exception 'Original pickup refill absence mismatch'using errcode='23514';end if;
 else
  perform public.controlled_stock_keys(c->'refill',array['refill','head_id']);
  perform public.controlled_stock_keys(o.request->'refill_close',array['id','expected_version','reason']);
  before_refill:=c#>'{refill,refill}';
  select * into r from public.native_refill_events where id=public.native_rx_uuid(p.document->'refill_event_id');
  if r.id is null or r.action<>'pickup'or r.actor_id<>p.actor_id
   or r.refill_id is distinct from public.native_rx_uuid(p.document->'refill_id')
   or r.refill_id is distinct from public.native_rx_uuid(o.request#>'{refill_close,id}')
   or r.refill_id::text is distinct from d->>'refill_id'
   or r.before_snapshot is distinct from before_refill or r.prior_event_id is distinct from public.native_rx_uuid(c#>'{refill,head_id}',true)
   or r.revision<>(before_refill->>'version')::integer+1 or o.request#>'{refill_close,expected_version}'is distinct from before_refill->'version'
   or r.reason is distinct from o.request#>>'{refill_close,reason}'
   or r.after_snapshot is distinct from before_refill||jsonb_build_object('version',r.revision,'state','closed','updated_by',p.actor_id,'updated_at',r.after_snapshot->'updated_at')
   or r.fulfillment_reference is distinct from jsonb_build_object('kind','pickup','id',p.id,'dispense_id',p.dispense_id,'authorization_id',p.authorization_id)
   or not isfinite(r.created_at)or r.created_at<p.picked_up_at or r.created_at>o.created_at then
   raise exception 'Original pickup refill closure evidence mismatch'using errcode='23514';end if;
 end if;
 return jsonb_build_object('id',p.id,'document_hash',public.native_fulfillment_hash(p.document),'operation_hash',public.native_fulfillment_hash(public.native_fulfillment_receipt(o)));
end $$;
create function public.controlled_stock_opening_native_entry_for_product(
 p_product uuid,p_stock_unit text,p_dispense uuid,p_return_version integer,p_correction_version integer,p_discrepancy_version integer,p_pickup_id uuid
)returns jsonb language plpgsql stable set search_path=public,pg_temp set timezone='UTC' as $$
declare d jsonb;stored public.native_dispenses;op public.native_fulfillment_operations;return_history jsonb;corrections jsonb;discrepancies jsonb;
 discrepancy_events jsonb;originals jsonb;quantity_events jsonb;replay jsonb;pickup jsonb;pickup_summary jsonb;allocations jsonb:='[]';held jsonb;
 r_alloc record;r_event record;balance jsonb;prepared numeric;slot jsonb;actual_slot jsonb;actual_refill jsonb;slot_time_field text;actual_instant timestamptz;expected_instant timestamptz;maximum numeric;dispensed numeric;refill_row public.native_refill_events;refill_result jsonb;begin
 if p_product is null or p_dispense is null or p_stock_unit is null or length(p_stock_unit)not between 1 and 50
  or p_return_version is null or p_correction_version is null or p_discrepancy_version is null
  or least(p_return_version,p_correction_version,p_discrepancy_version)<0 or greatest(p_return_version,p_correction_version,p_discrepancy_version)>1000 then
  raise exception 'Bounded exact opening native selectors required'using errcode='23514';end if;
 if(select count(*)from public.native_dispense_allocations where dispense_id=p_dispense)not between 1 and 100
  or(select count(*)from public.native_return_events where dispense_id=p_dispense)>1000
  or(select count(*)from public.native_dispense_correction_events where dispense_id=p_dispense)>1000
  or(select count(*)from public.native_return_discrepancy_events where dispense_id=p_dispense)>1000 then
  raise exception 'Native history exceeds opening candidate limit; no truncation permitted'using errcode='23514';end if;
 select * into stored from public.native_dispenses where id=p_dispense;
 d:=public.native_fulfillment_verified_dispense(p_dispense);
 select * into op from public.native_fulfillment_operations where id=p_dispense;
 perform public.controlled_stock_keys(op.request,array['authorization_id','pet_id','slot_index','expected_slot_version','invoice_id','quantity','allocations','refill','expected_context_hash','reason','attest_alert_review','attest_dispense_review']);
 perform public.controlled_stock_keys(op.result,array['dispense','slot','refill_event']);
 if d is null or stored.id is null or op.id is null or op.operation<>'dispense'or op.actor_id<>stored.actor_id
  or op.result->'dispense'is distinct from d
  or op.request_hash is distinct from public.native_fulfillment_hash(jsonb_build_object('version',1,'actor_id',op.actor_id,'operation','dispense','request',op.request))
  or public.native_rx_uuid(op.request->'authorization_id')is distinct from stored.authorization_id
  or public.native_rx_uuid(op.request->'pet_id')is distinct from stored.pet_id
  or op.request->>'expected_context_hash'is distinct from d->>'reviewed_context_hash'
  or op.request-array['expected_context_hash','reason','attest_alert_review','attest_dispense_review']is distinct from d#>'{reviewed_context,target}'
  or op.request->'reason'is distinct from d->'reason'or op.request->'attest_alert_review'is distinct from 'true'::jsonb or op.request->'attest_dispense_review'is distinct from 'true'::jsonb
  or d->>'authorization_id'is distinct from stored.authorization_id::text or d->>'pet_id'is distinct from stored.pet_id::text
  or d->>'unit'is distinct from p_stock_unit or d#>>'{reviewed_context,product,id}'is distinct from p_product::text
  or exists(select 1 from public.native_dispense_allocations a left join public.inventory_lots l on l.id=a.lot_id where a.dispense_id=p_dispense and l.product_id is distinct from p_product)then
  raise exception 'Exact original opening dispense operation, product and stock unit required'using errcode='23514';end if;
 -- Reconstruct the original result slot, never the mutable current slot.
 maximum:=(d#>>'{reviewed_context,signed_artifact,quantity_per_fill}')::numeric;
 dispensed:=coalesce((d#>>'{reviewed_context,slot,dispensed_quantity}')::numeric,0)+stored.quantity;
 if maximum is null or dispensed>maximum or not isfinite(op.created_at)or op.created_at<stored.dispensed_at
  or public.native_rx_uuid(op.request->'invoice_id')is distinct from stored.invoice_id
  or public.native_fulfillment_quantity(op.request->'quantity')is distinct from stored.quantity
  or op.request->'slot_index'is distinct from d->'slot_index'
  or op.request->'expected_slot_version'is distinct from d->'slot_version_before'
  or(d->>'slot_version_after')::integer<>coalesce((d#>>'{reviewed_context,slot,version}')::integer,0)+1 then
  raise exception 'Original dispense request/slot quantities must match retained evidence'using errcode='23514';end if;
 if d#>'{reviewed_context,slot}'='null'::jsonb then
  slot:=jsonb_build_object('id',stored.slot_id,'authorization_id',stored.authorization_id,'index',d->'slot_index',
   'version',d->'slot_version_after','maximum_quantity',public.native_fulfillment_decimal(maximum),
   'dispensed_quantity',public.native_fulfillment_decimal(dispensed),'remaining_quantity',public.native_fulfillment_decimal(maximum-dispensed),
   'state',case when dispensed=maximum then 'closed'else 'open'end,'closure_kind',case when dispensed=maximum then 'filled'else null end,
   'opened_by',stored.actor_id,'opened_at',stored.dispensed_at,'closed_by',case when dispensed=maximum then stored.actor_id else null end,
   'closed_at',case when dispensed=maximum then stored.dispensed_at else null end,'close_reason',null);
 else
  if d#>>'{reviewed_context,slot,id}'is distinct from stored.slot_id::text then raise exception 'Original dispense slot identity mismatch'using errcode='23514';end if;
  slot:=(d#>'{reviewed_context,slot}')||jsonb_build_object('version',d->'slot_version_after','dispensed_quantity',public.native_fulfillment_decimal(dispensed),
   'remaining_quantity',public.native_fulfillment_decimal(maximum-dispensed),'state',case when dispensed=maximum then 'closed'else 'open'end,
   'closure_kind',case when dispensed=maximum then 'filled'else null end,'closed_by',case when dispensed=maximum then stored.actor_id else null end,
   'closed_at',case when dispensed=maximum then stored.dispensed_at else null end);
 end if;
 refill_result:='null'::jsonb;
 if d->'refill_event_id'<>'null'::jsonb then
  select * into refill_row from public.native_refill_events where id=public.native_rx_uuid(d->'refill_event_id');
  if refill_row.id is null or refill_row.action<>'dispense'or refill_row.actor_id<>stored.actor_id
   or refill_row.refill_id::text is distinct from d->>'refill_id'
   or refill_row.before_snapshot is distinct from d#>'{reviewed_context,refill,refill}'
   or refill_row.fulfillment_reference is distinct from jsonb_build_object('kind','dispense','id',p_dispense,'dispense_id',p_dispense,'authorization_id',stored.authorization_id)then
   raise exception 'Original dispense refill event mismatch'using errcode='23514';end if;
  refill_result:=public.native_refill_event(refill_row);
 elsif d#>'{reviewed_context,refill}'is distinct from 'null'::jsonb then raise exception 'Original dispense refill absence mismatch'using errcode='23514';end if;
 -- Only the two reconstructed slot instants may use equivalent offset spelling.
 -- The saved operation/result is never normalized or rewritten; its full original
 -- receipt hash below still witnesses every stored JSON value, including these.
 actual_slot:=op.result->'slot';
 if jsonb_typeof(actual_slot)is distinct from 'object'
  or not(actual_slot?&array['opened_at','closed_at'])
  or actual_slot-array['opened_at','closed_at']is distinct from slot-array['opened_at','closed_at']
  or op.result-array['slot','refill_event']is distinct from jsonb_build_object('dispense',d)then
  raise exception 'Original dispense result must retain its exact slot and refill frame'using errcode='23514';end if;
 foreach slot_time_field in array array['opened_at','closed_at']loop
  if slot_time_field='closed_at'and slot->slot_time_field='null'::jsonb then
   if actual_slot->slot_time_field is distinct from 'null'::jsonb then
    raise exception 'Original dispense slot timestamps must retain exact finite instants'using errcode='23514';end if;
  else
   begin
    expected_instant:=public.native_correction_instant(slot->slot_time_field);
    actual_instant:=public.native_correction_instant(actual_slot->slot_time_field);
   exception when data_exception or check_violation then
    raise exception 'Original dispense slot timestamps must retain exact finite instants'using errcode='23514';
   end;
   if actual_instant is distinct from expected_instant then
    raise exception 'Original dispense slot timestamps must retain exact finite instants'using errcode='23514';end if;
  end if;
 end loop;
 -- The verified original refill event has one reconstructed typed timestamp.
 -- Nested snapshots and every other event field remain exact saved JSON.
 actual_refill:=op.result->'refill_event';
 if refill_result='null'::jsonb then
  if actual_refill is distinct from 'null'::jsonb then
   raise exception 'Original dispense result must retain its exact slot and refill frame'using errcode='23514';end if;
 else
  if refill_row.id is null or jsonb_typeof(actual_refill)is distinct from 'object'or not(actual_refill?'created_at')
   or actual_refill-'created_at'is distinct from refill_result-'created_at'then
   raise exception 'Original dispense result must retain its exact slot and refill frame'using errcode='23514';end if;
  begin
   actual_instant:=public.native_correction_instant(actual_refill->'created_at');
  exception when data_exception or check_violation then
   raise exception 'Original dispense refill timestamp must retain its exact finite instant'using errcode='23514';
  end;
  if not isfinite(refill_row.created_at)or actual_instant is distinct from refill_row.created_at then
   raise exception 'Original dispense refill timestamp must retain its exact finite instant'using errcode='23514';end if;
 end if;
 for r_alloc in select * from public.native_dispense_allocations where dispense_id=p_dispense loop
  perform public.stock_source_validate_movement(r_alloc.movement_id);
 end loop;
 corrections:=public.native_correction_verified(stored.authorization_id,stored.pet_id,p_dispense);
 return_history:=public.native_reconciliation_verified(stored.authorization_id,stored.pet_id,p_dispense);
 perform public.controlled_stock_opening_head(return_history->'events',p_return_version);
 perform public.controlled_stock_opening_head(corrections->'events',p_correction_version);
 discrepancies:=public.native_reconciliation_discrepancies(p_dispense,p_discrepancy_version);
 if(discrepancies->>'open_case_count')::integer<>0 then
  raise exception 'Unresolved cutover discrepancy requires an unavailable exception workflow'using errcode='23514';end if;
 select coalesce(jsonb_agg(document order by sequence),'[]')into discrepancy_events from public.native_return_discrepancy_events where dispense_id=p_dispense;
 pickup:=public.controlled_stock_opening_pickup(p_dispense);
 if p_pickup_id is not null and(pickup is null or pickup->>'id'is distinct from p_pickup_id::text)then
  raise exception 'Actual original opening pickup required'using errcode='23514';end if;
 if p_pickup_id is not null and p_return_version<>0 then
  raise exception 'Handed-off return history requires an unavailable opening exception'using errcode='23514';end if;
 pickup_summary:=case when p_pickup_id is null then null else public.native_correction_pickup(p_dispense)end;
 -- Independent prefix heads must also form one causally closed cutover.
 for r_event in select * from public.native_return_events where dispense_id=p_dispense and sequence<=p_return_version loop
  if not public.controlled_stock_opening_contains_head(corrections->'events',r_event.reviewed_context->'correction_head',p_correction_version)
   or(r_event.document->'version'='2'::jsonb and not public.controlled_stock_opening_contains_head(discrepancy_events,r_event.reviewed_context->'discrepancy_head',p_discrepancy_version))
   or(r_event.reviewed_context->'original_pickup'<>'null'::jsonb and r_event.reviewed_context->'original_pickup'is distinct from coalesce(pickup_summary,'null'::jsonb))then
   raise exception 'Return prefix depends on evidence outside the opening boundary'using errcode='23514';end if;
  if r_event.action='intake'and r_event.document->>'custody'is distinct from 'clinic_retained'then
   raise exception 'Client or unknown opening custody is unavailable'using errcode='23514';end if;
 end loop;
 for r_event in select * from public.native_dispense_correction_events where dispense_id=p_dispense and sequence<=p_correction_version loop
  if(r_event.reviewed_context->'original_pickup'<>'null'::jsonb and r_event.reviewed_context->'original_pickup'is distinct from coalesce(pickup_summary,'null'::jsonb))
   or(r_event.kind='pickup_amendment'and p_pickup_id is null)
   or(r_event.document->>'amends_event_id'is not null and not exists(select 1 from public.native_dispense_correction_events prior
    where prior.id=(r_event.document->>'amends_event_id')::uuid and prior.dispense_id=p_dispense and prior.sequence<r_event.sequence and prior.sequence<=p_correction_version))then
   raise exception 'Correction prefix depends on evidence outside the opening boundary'using errcode='23514';end if;
 end loop;
 for r_event in select * from public.native_return_discrepancy_events where dispense_id=p_dispense and sequence<=p_discrepancy_version loop
  if not public.controlled_stock_opening_contains_head(return_history->'events',r_event.document->'return_head',p_return_version)
   or not exists(select 1 from public.native_return_events src where src.id=(r_event.document#>>'{source,event_id}')::uuid
    and src.dispense_id=p_dispense and src.sequence<=p_return_version and src.record_hash=r_event.document#>>'{source,record_hash}')
   or exists(select 1 from jsonb_array_elements_text(r_event.document->'correction_ids')cid where not exists(
    select 1 from public.native_return_events cr where cr.id=cid::uuid and cr.dispense_id=p_dispense and cr.sequence<=p_return_version))then
   raise exception 'Discrepancy prefix depends on evidence outside the opening boundary'using errcode='23514';end if;
 end loop;
 select jsonb_agg(jsonb_build_object('allocation_id',id,'lot_id',lot_id,'quantity',public.native_fulfillment_decimal(quantity))order by id)into originals from public.native_dispense_allocations where dispense_id=p_dispense;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'sequence',sequence,'action',action,'intake_id',intake_id,
  'correction_target_id',document#>'{correction_target,event_id}','allocations',(select jsonb_agg(x-'movement_id'order by x->>'allocation_id')from jsonb_array_elements(document->'allocations')x))order by sequence),'[]')
 into quantity_events from public.native_return_events where dispense_id=p_dispense and sequence<=p_return_version;
 replay:=public.native_reconciliation_quantity_prefixes(originals,quantity_events)->p_return_version;
 for r_alloc in select * from public.native_dispense_allocations where dispense_id=p_dispense order by id loop
  select x into balance from jsonb_array_elements(replay->'allocations')x where x->>'allocation_id'=r_alloc.id::text;
  prepared:=case when p_pickup_id is not null then 0 else r_alloc.quantity-(balance->>'returned_quantity')::numeric end;
  if prepared is null or prepared<0 then raise exception 'Reconstructible nonnegative opening prepared quantity required'using errcode='23514';end if;
  select coalesce(jsonb_agg(jsonb_build_object('intake_id',x->'id','quantity',y->'held_quantity')order by x->>'id'),'[]')into held
   from jsonb_array_elements(replay->'intakes')x cross join lateral jsonb_array_elements(x->'allocations')y where y->>'allocation_id'=r_alloc.id::text;
  allocations:=allocations||jsonb_build_array(jsonb_build_object('allocation_id',r_alloc.id,'lot_id',r_alloc.lot_id,
   'dispensed_quantity',public.native_fulfillment_decimal(r_alloc.quantity),'prepared_quantity',public.native_fulfillment_decimal(prepared),'held',held));
 end loop;
 return jsonb_build_object('version',1,'dispense_id',p_dispense,'dispense_document_hash',public.native_fulfillment_hash(d),'dispense_operation_hash',public.native_fulfillment_hash(public.native_fulfillment_receipt(op)),
  'return_head',public.controlled_stock_opening_head(return_history->'events',p_return_version),
  'correction_head',public.controlled_stock_opening_head(corrections->'events',p_correction_version),
  'discrepancy_head',discrepancies->'head','pickup',case when p_pickup_id is null then null else pickup end,'allocations',allocations);
end $$;
create function public.controlled_stock_opening_native_entry(
 p_opening uuid,p_dispense uuid,p_return_version integer,p_correction_version integer,p_discrepancy_version integer,p_pickup_id uuid
)returns jsonb language plpgsql stable set search_path=public,pg_temp set timezone='UTC' as $$declare o public.controlled_stock_openings;unit text;begin
 select * into o from public.controlled_stock_openings where id=p_opening;
 select stock_unit into unit from public.controlled_stock_policy_versions where id=o.policy_version_id and product_id=o.product_id;
 if o.id is null or unit is null then raise exception 'Actual opening product and policy required'using errcode='23514';end if;
 return public.controlled_stock_opening_native_entry_for_product(o.product_id,unit,p_dispense,p_return_version,p_correction_version,p_discrepancy_version,p_pickup_id);
end $$;
create function public.controlled_stock_opening_later_source(p_opening uuid,p_kind text,p_source uuid)returns uuid
language plpgsql stable set search_path=public,pg_temp set timezone='UTC' as $$declare e public.controlled_stock_events;o public.controlled_stock_openings;begin
 select * into o from public.controlled_stock_openings where id=p_opening;
 select event.* into e from public.controlled_stock_source_links link join public.controlled_stock_events event on event.id=link.event_id
  where case p_kind when 'movement'then link.movement_id when 'return'then link.return_event_id when 'correction'then link.correction_event_id
   when 'discrepancy'then link.discrepancy_event_id when 'pickup'then link.pickup_id else null end=p_source;
 if e.id is null or e.opening_id is distinct from p_opening or e.product_id is distinct from o.product_id
  or(p_kind<>'movement'and(e.id<>p_source or e.source_bundle#>>'{native,kind}'is distinct from p_kind
   or e.source_bundle#>>'{native,id}'is distinct from p_source::text
   or(p_kind='return'and e.writer not in('record_native_dispense_return','record_native_dispense_return_v2'))
   or(p_kind='correction'and e.writer<>'append_native_dispense_correction')
   or(p_kind='discrepancy'and e.writer<>'record_native_return_discrepancy')
   or(p_kind='pickup'and e.writer<>'record_native_pickup')))then
  raise exception 'Every later source requires its exact owned opening/product event link'using errcode='23514';end if;
 return e.id;
end $$;
create function public.controlled_stock_validate_opening(p_opening uuid)returns void
language plpgsql volatile set search_path=public,pg_temp set timezone='UTC' as $$
declare o public.controlled_stock_openings;unit text;entry jsonb;projected jsonb;expected jsonb:='[]';by_dispense jsonb:='{}';
 r_dispense record;r_source record;r_movement record;r_cell record;value jsonb;v_held jsonb;entry_id uuid;last_id text:='';rv integer;cv integer;dv integer;pid uuid;event_id uuid;
 old_count bigint;total_count bigint;actual numeric;opening_net numeric;begin
 select * into o from public.controlled_stock_openings where id=p_opening;
 select stock_unit into unit from public.controlled_stock_policy_versions where id=o.policy_version_id and product_id=o.product_id;
 if o.id is null or unit is null or jsonb_typeof(o.native_custody_boundary)is distinct from 'array'
  or jsonb_array_length(o.native_custody_boundary)>200 or octet_length(o.native_custody_boundary::text)>1048576 then
  raise exception 'Bounded actual opening boundary required'using errcode='23514';end if;
 if(select count(distinct a.dispense_id)from public.native_dispense_allocations a join public.inventory_lots l on l.id=a.lot_id where l.product_id=o.product_id)>200 then
  raise exception 'Product native history exceeds opening candidate limit; no truncation permitted'using errcode='23514';end if;
 if exists(select 1 from public.controlled_stock_opening_movements b left join public.inventory_movements m on m.id=b.movement_id
  left join public.inventory_lots l on l.id=m.lot_id where b.opening_id=o.id and(m.id is null or l.product_id is distinct from o.product_id
   or b.lot_id<>m.lot_id or b.quantity<>m.quantity or b.source_snapshot is distinct from to_jsonb(m)))then
  raise exception 'Exact original opening movement snapshots required'using errcode='23514';end if;
 for r_movement in select m.* from public.inventory_movements m join public.inventory_lots l on l.id=m.lot_id where l.product_id=o.product_id loop
  if exists(select 1 from public.controlled_stock_opening_movements b where b.opening_id=o.id and b.movement_id=r_movement.id)then
   if exists(select 1 from public.controlled_stock_source_links where movement_id=r_movement.id)then raise exception 'Opening and managed movement membership overlap'using errcode='23514';end if;
  else
   event_id:=public.controlled_stock_opening_later_source(o.id,'movement',r_movement.id);
  end if;
 end loop;
 if exists(select 1 from public.controlled_stock_containers t where t.opening_id=o.id and(t.product_id<>o.product_id or t.stock_unit<>unit))
  or exists(select 1 from public.controlled_stock_cells cell left join public.controlled_stock_containers t on t.id=cell.container_id
   left join public.inventory_lots l on l.id=cell.lot_id where cell.opening_id=o.id and(t.opening_id is distinct from o.id or t.product_id is distinct from o.product_id
    or l.product_id is distinct from o.product_id or t.stock_unit is distinct from unit or cell.created_event_id is not null
    or(t.kind='stock'and(cell.channel<>'available'or t.stock_lot_id<>cell.lot_id))or(t.kind='prepared'and cell.channel='available')))then
  raise exception 'Exact opening container/cell product, unit and provenance required'using errcode='23514';end if;
 for r_dispense in select id from public.inventory_lots where product_id=o.product_id loop
  select coalesce(sum(quantity),0)into opening_net from public.controlled_stock_opening_movements where opening_id=o.id and lot_id=r_dispense.id;
  select coalesce(sum(opening_quantity),0)into actual from public.controlled_stock_cells where opening_id=o.id and lot_id=r_dispense.id and channel='available';
  if opening_net<>actual or opening_net<0 then raise exception 'Opening available cells must match original opening movement net exactly'using errcode='23514';end if;
 end loop;
 for entry in select x from jsonb_array_elements(o.native_custody_boundary)x loop
  perform public.controlled_stock_keys(entry,array['version','dispense_id','dispense_document_hash','dispense_operation_hash','return_head','correction_head','discrepancy_head','pickup','allocations']);
  if jsonb_typeof(entry->'version')is distinct from 'number'or entry->>'version'<>'1'then raise exception 'Exact opening boundary version required'using errcode='23514';end if;
  entry_id:=public.controlled_stock_uuid(entry->'dispense_id');
  if entry_id::text collate "C"<=last_id collate "C"then raise exception 'Sorted unique opening dispenses required'using errcode='23514';end if;last_id:=entry_id::text;
  rv:=public.controlled_stock_opening_selector(entry->'return_head');cv:=public.controlled_stock_opening_selector(entry->'correction_head');dv:=public.controlled_stock_opening_selector(entry->'discrepancy_head');pid:=null;
  if entry->'pickup'<>'null'::jsonb then perform public.controlled_stock_keys(entry->'pickup',array['id','document_hash','operation_hash']);pid:=public.controlled_stock_uuid(entry#>'{pickup,id}');end if;
  projected:=public.controlled_stock_opening_native_entry(o.id,entry_id,rv,cv,dv,pid);
  if entry is distinct from projected then raise exception 'Stored opening custody must equal the canonical retained native prefix'using errcode='23514';end if;
  expected:=expected||jsonb_build_array(projected);by_dispense:=by_dispense||jsonb_build_object(entry_id::text,projected);
 end loop;
 for r_dispense in select d.id from public.native_dispenses d where exists(select 1 from public.native_dispense_allocations a join public.inventory_lots l on l.id=a.lot_id where a.dispense_id=d.id and l.product_id=o.product_id)loop
  select count(*),count(*)filter(where exists(select 1 from public.controlled_stock_opening_movements b where b.opening_id=o.id and b.movement_id=x.movement_id))
   into total_count,old_count from public.native_dispense_allocations x where x.dispense_id=r_dispense.id;
  if old_count not in(0,total_count)then raise exception 'Native dispense cannot straddle the opening boundary'using errcode='23514';end if;
  entry:=by_dispense->r_dispense.id::text;
  if(old_count>0)is distinct from(entry is not null)then raise exception 'Every original opening dispense requires exactly one boundary entry'using errcode='23514';end if;
  if entry is null then
   -- Verify complete later history too, without adopting its quantities into opening.
   perform public.controlled_stock_opening_native_entry_for_product(o.product_id,unit,r_dispense.id,0,0,0,null);
   for r_movement in select movement_id from public.native_dispense_allocations where dispense_id=r_dispense.id loop
    event_id:=public.controlled_stock_opening_later_source(o.id,'movement',r_movement.movement_id);
    if event_id<>r_dispense.id or not exists(select 1 from public.controlled_stock_events where id=event_id and writer='record_native_dispense')then
     raise exception 'Later dispense requires every exact native debit link'using errcode='23514';end if;
   end loop;
   rv:=0;cv:=0;dv:=0;pid:=null;
  else rv:=(entry#>>'{return_head,version}')::integer;cv:=(entry#>>'{correction_head,version}')::integer;dv:=(entry#>>'{discrepancy_head,version}')::integer;pid:=(entry#>>'{pickup,id}')::uuid;end if;
  for r_source in select 'return'kind,id,sequence,document from public.native_return_events where dispense_id=r_dispense.id
   union all select 'correction',id,sequence,document from public.native_dispense_correction_events where dispense_id=r_dispense.id
   union all select 'discrepancy',id,sequence,document from public.native_return_discrepancy_events where dispense_id=r_dispense.id
   union all select 'pickup',id,1,document from public.native_pickups where dispense_id=r_dispense.id loop
   if(r_source.kind='return'and r_source.sequence<=rv)or(r_source.kind='correction'and r_source.sequence<=cv)or(r_source.kind='discrepancy'and r_source.sequence<=dv)or(r_source.kind='pickup'and r_source.id=pid)then
    if exists(select 1 from public.controlled_stock_source_links k where coalesce(k.return_event_id,k.correction_event_id,k.discrepancy_event_id,k.pickup_id)=r_source.id)then
     raise exception 'Retained prefix and managed native source membership overlap'using errcode='23514';end if;
   else event_id:=public.controlled_stock_opening_later_source(o.id,r_source.kind,r_source.id);end if;
   if r_source.kind='return'then
    for r_movement in select movement_id from public.native_return_stock_links link where link.event_id=r_source.id union all select movement_id from public.native_return_compensation_links link where link.event_id=r_source.id loop
     perform public.stock_source_validate_movement(r_movement.movement_id);
     if r_source.sequence<=rv then
      if not exists(select 1 from public.controlled_stock_opening_movements where opening_id=o.id and movement_id=r_movement.movement_id)then raise exception 'Retained return movement must belong to the same opening prefix'using errcode='23514';end if;
     elsif public.controlled_stock_opening_later_source(o.id,'movement',r_movement.movement_id)<>r_source.id then raise exception 'Later return movement must belong to its exact native event'using errcode='23514';end if;
    end loop;
   end if;
  end loop;
 end loop;
 -- No forged boundary dispense can be absent from the actual old allocation set.
 if exists(select 1 from jsonb_array_elements(expected)e where not exists(select 1 from public.native_dispense_allocations a
  join public.controlled_stock_opening_movements m on m.movement_id=a.movement_id and m.opening_id=o.id where a.dispense_id=(e->>'dispense_id')::uuid))then
  raise exception 'Opening custody cannot invent an old native dispense'using errcode='23514';end if;
 for entry in select x from jsonb_array_elements(expected)x loop
  for value in select x from jsonb_array_elements(entry->'allocations')x loop
   select coalesce(sum(opening_quantity),0)into actual from public.controlled_stock_cells where opening_id=o.id and channel='prepared'
    and dispense_id=(entry->>'dispense_id')::uuid and allocation_id=(value->>'allocation_id')::uuid and lot_id=(value->>'lot_id')::uuid;
   if actual<>(value->>'prepared_quantity')::numeric then raise exception 'Opening prepared custody must reconcile in both directions'using errcode='23514';end if;
   for v_held in select x from jsonb_array_elements(value->'held')x loop
    select coalesce(sum(opening_quantity),0)into actual from public.controlled_stock_cells where opening_id=o.id and channel='return_held'
     and dispense_id=(entry->>'dispense_id')::uuid and allocation_id=(value->>'allocation_id')::uuid and lot_id=(value->>'lot_id')::uuid and intake_id=(v_held->>'intake_id')::uuid;
    if actual<>(v_held->>'quantity')::numeric then raise exception 'Opening held custody must match the exact original intake'using errcode='23514';end if;
   end loop;
  end loop;
 end loop;
 for r_cell in select * from public.controlled_stock_cells where opening_id=o.id and channel<>'available'loop
  entry:=by_dispense->r_cell.dispense_id::text;
  select x into value from jsonb_array_elements(coalesce(entry->'allocations','[]'))x where x->>'allocation_id'=r_cell.allocation_id::text and x->>'lot_id'=r_cell.lot_id::text;
  if entry is null or value is null or(r_cell.channel='return_held'and not exists(select 1 from jsonb_array_elements(value->'held')held_source where held_source->>'intake_id'=r_cell.intake_id::text))then
   raise exception 'Every opening custody cell needs its exact retained native source, including zero cells'using errcode='23514';end if;
 end loop;
 -- Deferred guards validate each new/root event; restore audits every historical
 -- event explicitly. Do not repeat that full audit for every product-row trigger.
end $$;
