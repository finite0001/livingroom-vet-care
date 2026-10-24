-- Private A1 assertion sources. Empty transitions never establish their site.
-- BEGIN FUNCTION adapter_context|jsonb|plpgsql
declare state jsonb:=p_state; e public.controlled_stock_events; target jsonb; source jsonb;
 row_value jsonb; operation jsonb; provenance jsonb; managed jsonb; did uuid; selected_id uuid; role_name text;
 selected_ids uuid[]; predecessor uuid; original_source uuid; selected_case_id uuid; selected_correction_id uuid;
 correction public.native_return_events; link public.native_return_discrepancy_correction_links;
 n integer:=0; count_links integer; last_id text:='';
begin
 select * into e from public.controlled_stock_events where id=p_event_id;
 if e.id is null then raise exception 'adapter_parent_integrity' using errcode='23514';end if;
 if e.writer='append_native_dispense_correction' then
  select to_jsonb(r) into target from public.native_dispense_correction_events r where r.id=e.id;
  if target is null then raise exception 'adapter_source_integrity' using errcode='23514';end if;
  did:=(target->>'dispense_id')::uuid;
  predecessor:=(target#>>'{document,amends_event_id}')::uuid;
  selected_ids:=array[e.id];
  if predecessor is not null then
   select to_jsonb(r) into source from public.native_dispense_correction_events r where r.id=predecessor;
   if source is null or predecessor=e.id or source->>'dispense_id' is distinct from did::text
   or source->>'kind' is distinct from target->>'kind' or(source->>'sequence')::integer>=(target->>'sequence')::integer then
    raise exception 'adapter_source_integrity' using errcode='23514';end if;
   selected_ids:=selected_ids||predecessor;
  end if;
  foreach selected_id in array selected_ids loop
   role_name:=case when selected_id=e.id then 'reviewed_target' else 'amendment_predecessor' end;
   select to_jsonb(r) into row_value from public.native_dispense_correction_events r where r.id=selected_id;
   select to_jsonb(r) into operation from public.native_dispense_correction_operations r where r.id=selected_id;
   select to_jsonb(r) into provenance from public.stock_correction_sources r where r.event_id=selected_id;
   managed:=controlled_review_v3.managed_source_event(jsonb_build_object('source_kind','correction','source_id',selected_id,'product_id',e.product_id));
   if operation is null or operation->>'actor_id' is distinct from row_value->>'actor_id'
   or operation->'result' is distinct from row_value->'document'
   or row_value->>'record_hash' is distinct from public.native_fulfillment_hash((row_value->'document')-'record_hash')
   or(provenance is null and managed is not null)
   or(provenance is not null and provenance->>'actor_id' is distinct from row_value->>'actor_id') then
    raise exception 'adapter_source_integrity' using errcode='23514';end if;
   -- Membership is validated above; these context-only roles declare no parent/physical edge.
   state:=controlled_review_v3.adapter_add(state,'public.native_dispense_correction_events',jsonb_build_object('id',selected_id),row_value,role_name);
   state:=controlled_review_v3.adapter_add(state,'public.native_dispense_correction_operations',jsonb_build_object('id',selected_id),operation,role_name);
   if provenance is not null then state:=controlled_review_v3.adapter_add(state,'public.stock_correction_sources',jsonb_build_object('event_id',selected_id),provenance,role_name);end if;
  end loop;
  state:=controlled_review_v3.adapter_dispense(state,did,e.product_id,'original_dispense',1);
  if target->>'kind'='pickup_amendment' then
   selected_id:=(target#>>'{document,pickup_amendment,original_pickup_id}')::uuid;
   if selected_id is null or not exists(select 1 from public.native_pickups where id=selected_id and dispense_id=did) then
    raise exception 'adapter_source_integrity' using errcode='23514';end if;
   state:=controlled_review_v3.adapter_pickup(state,selected_id,e.product_id,'original_pickup',1);
  end if;
 elsif e.writer='record_native_return_discrepancy' then
  select to_jsonb(r) into target from public.native_return_discrepancy_events r where r.id=e.id;
  if target is null then raise exception 'adapter_source_integrity' using errcode='23514';end if;
  did:=(target->>'dispense_id')::uuid;selected_case_id:=(target->>'case_id')::uuid;
  original_source:=(target#>>'{document,source,event_id}')::uuid;
  select to_jsonb(r) into source from public.native_return_events r where r.id=original_source;
  if source is null or source->>'dispense_id' is distinct from did::text
  or source->>'record_hash' is distinct from target#>>'{document,source,record_hash}'
  or source->>'action'<>all(array['intake','dispose','restock']) then
   raise exception 'adapter_source_integrity' using errcode='23514';end if;
  selected_ids:=array[e.id];if selected_case_id<>e.id then selected_ids:=selected_ids||selected_case_id;end if;
  foreach selected_id in array selected_ids loop
   role_name:=case when selected_id=e.id then 'reviewed_target' else 'case_report' end;
   select to_jsonb(r) into row_value from public.native_return_discrepancy_events r where r.id=selected_id;
   select to_jsonb(r) into operation from public.native_return_discrepancy_operations r where r.id=selected_id;
   select to_jsonb(r) into provenance from public.stock_discrepancy_sources r where r.event_id=selected_id;
   if row_value is null or operation is null or row_value->>'dispense_id' is distinct from did::text
   or operation->>'actor_id' is distinct from row_value->>'actor_id' or operation->'result' is distinct from row_value->'document'
   or row_value->>'record_hash' is distinct from public.native_fulfillment_hash((row_value->'document')-'record_hash')
   or row_value#>'{document,source}' is distinct from target#>'{document,source}'
   or row_value#>'{document,allocations}' is distinct from target#>'{document,allocations}'
   or(selected_id<>e.id and(row_value->>'action'<>'report' or(row_value->>'sequence')::integer>=(target->>'sequence')::integer)) then
    raise exception 'adapter_source_integrity' using errcode='23514';end if;
   managed:=controlled_review_v3.managed_source_event(jsonb_build_object('source_kind','discrepancy','source_id',selected_id,'product_id',e.product_id));
   if(provenance is null and managed is not null) or(provenance is not null and provenance->>'actor_id' is distinct from row_value->>'actor_id') then
    raise exception 'adapter_source_integrity' using errcode='23514';end if;
   -- Membership is validated above; these context-only roles declare no parent/physical edge.
   state:=controlled_review_v3.adapter_add(state,'public.native_return_discrepancy_events',jsonb_build_object('id',selected_id),row_value,role_name);
   state:=controlled_review_v3.adapter_add(state,'public.native_return_discrepancy_operations',jsonb_build_object('id',selected_id),operation,role_name);
   if provenance is not null then state:=controlled_review_v3.adapter_add(state,'public.stock_discrepancy_sources',jsonb_build_object('event_id',selected_id),provenance,role_name);end if;
  end loop;
  state:=controlled_review_v3.adapter_return(state,original_source,e.product_id,'ordinary_source',1);
  if jsonb_typeof(target#>'{document,correction_ids}') is distinct from 'array' then
   raise exception 'adapter_source_integrity' using errcode='23514';end if;
  if jsonb_array_length(target#>'{document,correction_ids}')>100 then raise exception 'evidence_limit_exceeded' using errcode='54000';end if;
  if target->>'action'='resolve_corrected' then
   if jsonb_array_length(target#>'{document,correction_ids}')=0 then raise exception 'adapter_source_integrity' using errcode='23514';end if;
   for row_value in select value from jsonb_array_elements(target#>'{document,correction_ids}') loop
    if jsonb_typeof(row_value)<>'string' or row_value#>>'{}'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or (row_value#>>'{}') collate "C"<=last_id collate "C" then raise exception 'adapter_source_integrity' using errcode='23514';end if;
    last_id:=row_value#>>'{}';selected_correction_id:=last_id::uuid;
    select * into correction from public.native_return_events where id=selected_correction_id;
    select * into link from public.native_return_discrepancy_correction_links l where l.correction_id=selected_correction_id;
    if correction.id is null or link.id is null or link.case_id<>selected_case_id or link.resolution_id<>e.id
    or correction.dispense_id<>did or correction.document->>'version'<>'2'
    or correction.action<>all(array['retract_intake','retract_disposal','retract_restock'])
    or correction.document#>'{correction_target}' is distinct from target#>'{document,source}'
    or correction.document->>'discrepancy_id' is distinct from selected_case_id::text then
     raise exception 'adapter_source_integrity' using errcode='23514';end if;
    n:=n+1;
    state:=controlled_review_v3.adapter_add(state,'public.native_return_discrepancy_correction_links',jsonb_build_object('id',link.id),to_jsonb(link),'reviewed_target');
    state:=controlled_review_v3.adapter_return(state,correction.id,e.product_id,'resolution_correction',1);
   end loop;
  elsif target#>'{document,correction_ids}'<>'[]'::jsonb then raise exception 'adapter_source_integrity' using errcode='23514';end if;
  select count(*) into count_links from(select id from public.native_return_discrepancy_correction_links where resolution_id=e.id limit 101) q;
  if count_links>100 then raise exception 'evidence_limit_exceeded' using errcode='54000';end if;
  if count_links<>n then raise exception 'adapter_source_integrity' using errcode='23514';end if;
 else raise exception 'unsupported_event_kind' using errcode='22023';end if;
 return state;
end
-- END FUNCTION
