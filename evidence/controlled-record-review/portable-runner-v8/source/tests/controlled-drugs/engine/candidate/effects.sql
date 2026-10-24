create function public.controlled_stock_expected(
 p_id uuid,p_writer text,p_arguments jsonb
)returns jsonb language plpgsql volatile set search_path=public,pg_temp as $$
declare request jsonb:=p_arguments->'request';result jsonb:='[]';a jsonb;lot uuid;did uuid;iid uuid;
 q numeric;action text;prepared integer;held integer;begin
 if p_writer in('receive_inventory','adjust_inventory','record_patient_treatment','record_anesthesia_drug_administration')then
  if p_writer in('receive_inventory','adjust_inventory')then lot:=(p_arguments->>'lot_id')::uuid;q:=public.controlled_stock_decimal(p_arguments->'quantity');
  else lot:=(request->>'lot_id')::uuid;q:=-(request->>'quantity')::numeric;
   if q is null or q>=0 or q<>round(q,3)or q::text in('NaN','Infinity','-Infinity')then
    raise exception 'Exact positive canonical treatment quantity required'using errcode='23514';end if;
  end if;
  result:=jsonb_build_array(jsonb_build_object('lot_id',lot,'channel','available','dispense_id',null,'intake_id',null,'quantity_delta',q::text));
 elsif p_writer='record_native_dispense'then
  for a in select value from jsonb_array_elements(request->'allocations')loop
   lot:=(a->>'lot_id')::uuid;q:=public.native_fulfillment_quantity(a->'quantity');
   result:=result||jsonb_build_array(
    jsonb_build_object('lot_id',lot,'channel','available','dispense_id',null,'intake_id',null,'quantity_delta',(-q)::text),
    jsonb_build_object('lot_id',lot,'channel','prepared','dispense_id',p_id,'intake_id',null,'quantity_delta',q::text));
  end loop;
 elsif p_writer='record_native_pickup'then
  did:=(request->>'dispense_id')::uuid;
  for a in select to_jsonb(v)from public.native_dispense_allocations v where v.dispense_id=did loop
   result:=result||jsonb_build_array(jsonb_build_object('lot_id',a->'lot_id','channel','prepared','dispense_id',did,
    'intake_id',null,'quantity_delta',(-(a->>'quantity')::numeric)::text));
  end loop;
 elsif p_writer in('record_native_dispense_return','record_native_dispense_return_v2')then
  action:=request#>>'{intent,action}';did:=(request#>>'{intent,target,dispense_id}')::uuid;
  iid:=case action when 'intake'then p_id else(request#>>'{intent,intake_id}')::uuid end;
  case action
   when 'intake'then prepared:=-1;held:=1;
   when 'dispose','restock'then prepared:=0;held:=-1;
   when 'retract_intake'then prepared:=1;held:=-1;
   when 'retract_disposal','retract_restock'then prepared:=0;held:=1;
   else raise exception 'Reviewed original return subtype required'using errcode='23514';end case;
  for a in select value from jsonb_array_elements(request#>'{intent,allocations}')loop
   select lot_id into lot from public.native_dispense_allocations where id=(a->>'allocation_id')::uuid and dispense_id=did;
   if lot is null then raise exception 'Original native return allocation required'using errcode='23514';end if;
   q:=public.native_fulfillment_quantity(a->'quantity');
   if action in('restock','retract_restock')then
    result:=result||jsonb_build_array(jsonb_build_object('lot_id',lot,'channel','available','dispense_id',null,'intake_id',null,
     'quantity_delta',(case action when 'restock'then q else -q end)::text));
   end if;
   if prepared<>0 then result:=result||jsonb_build_array(jsonb_build_object('lot_id',lot,'channel','prepared','dispense_id',did,'intake_id',null,'quantity_delta',(prepared*q)::text));end if;
   result:=result||jsonb_build_array(jsonb_build_object('lot_id',lot,'channel','return_held','dispense_id',did,'intake_id',iid,'quantity_delta',(held*q)::text));
  end loop;
 elsif p_writer not in('record_native_return_discrepancy','append_native_dispense_correction')then
  raise exception 'Reviewed controlled source writer required'using errcode='23514';end if;
 if jsonb_array_length(result)>200 then raise exception 'Bounded expected controlled effects required'using errcode='23514';end if;
 return result;
end $$;
create function public.controlled_stock_effect_totals(value jsonb)returns jsonb
language sql immutable set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('lot_id',lot,'channel',channel,'dispense_id',did,'intake_id',iid,
  'quantity_delta',q)order by lot,channel,did,iid),'[]'::jsonb)
 from(select(v->>'lot_id')::uuid lot,v->>'channel'channel,nullif(v->>'dispense_id','')::uuid did,
  nullif(v->>'intake_id','')::uuid iid,sum((v->>'quantity_delta')::numeric)q
  from jsonb_array_elements(value)v group by 1,2,3,4)grouped
$$;
create function public.controlled_stock_correction_allocations(p_id uuid,p_writer text,p_arguments jsonb,p_context jsonb)returns void
language plpgsql volatile set search_path=public,pg_temp as $$
declare target uuid;sequence_before bigint;c jsonb;line jsonb;cell uuid;original numeric;already numeric;delta numeric;
begin
 if p_writer<>'record_native_dispense_return_v2'or p_arguments#>>'{request,intent,action}'not like 'retract_%'then return;end if;
 target:=(p_arguments#>>'{request,intent,correction_target,event_id}')::uuid;
 if target is null or not exists(select 1 from public.controlled_stock_events where id=target and product_id=(p_context->>'product_id')::uuid)then
  raise exception 'Pre-opening custody correction requires a separately reviewed exception'using errcode='23514';end if;
 select sequence into sequence_before from public.controlled_stock_events where id=p_id;
 for c in select value from jsonb_array_elements(p_context->'containers')loop
  for line in select value from jsonb_array_elements(c->'lines')loop
   select id into cell from public.controlled_stock_cells where container_id=(c->>'id')::uuid and lot_id=(line->>'lot_id')::uuid
    and channel=line->>'channel'and dispense_id is not distinct from(line->>'dispense_id')::uuid
    and intake_id is not distinct from(line->>'intake_id')::uuid;
   select sum(quantity_delta)into original from public.controlled_stock_event_lines where event_id=target and cell_id=cell;
   delta:=(line->>'quantity_delta')::numeric;
   select coalesce(sum(abs(l.quantity_delta)),0)into already from public.controlled_stock_event_lines l
    join public.controlled_stock_events e on e.id=l.event_id where l.cell_id=cell and e.id<>p_id
    and(e.source_bundle#>>'{native,document,correction_target,event_id}')::uuid=target
    and(sequence_before is null or e.sequence<sequence_before);
   if original is null or(original>0)=(delta>0)or abs(delta)>abs(original)-already then
    raise exception 'Correction must reverse the remaining quantity in its exact original physical cells'using errcode='23514';end if;
  end loop;
 end loop;
end $$;
create function public.controlled_stock_check_plan(p_id uuid,p_writer text,p_arguments jsonb,p_context jsonb)returns jsonb
language plpgsql volatile set search_path=public,pg_temp as $$declare expected jsonb;planned jsonb;basis text;begin
 expected:=public.controlled_stock_expected(p_id,p_writer,p_arguments);
 select coalesce(jsonb_agg(line),'[]'::jsonb)into planned from jsonb_array_elements(p_context->'containers')c
 cross join lateral jsonb_array_elements(c->'lines')line;
 if exists(select 1 from jsonb_array_elements(expected)x group by x-'quantity_delta'having count(*)<>1)then
  raise exception 'Every expected source effect must be unambiguous'using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(planned)p where
  (select count(*)from jsonb_array_elements(expected)e where e-'quantity_delta'=p-'quantity_delta'
   and((e->>'quantity_delta')::numeric>0)=((p->>'quantity_delta')::numeric>0))<>1)then
  raise exception 'A physical allocation cannot hide a transfer or opposing movement'using errcode='23514';end if;
 if public.controlled_stock_effect_totals(expected)is distinct from public.controlled_stock_effect_totals(planned)then
  raise exception 'Container allocations must match every exact canonical stock and custody effect'using errcode='23514';end if;
 if p_writer='append_native_dispense_correction'then basis:='annotation';
 elsif p_writer='record_native_return_discrepancy'then basis:='discrepancy_assertion';
 elsif p_writer in('record_native_dispense_return','record_native_dispense_return_v2')and p_arguments#>>'{request,intent,action}'like 'retract_%'then basis:='correction_assertion';
 else basis:='physical_record';end if;
 if p_context#>>'{basis,kind}'is distinct from basis then
  raise exception 'Evidence basis must preserve the canonical physical or assertion meaning'using errcode='23514';end if;
 perform public.controlled_stock_correction_allocations(p_id,p_writer,p_arguments,p_context);
 return expected;
end $$;
