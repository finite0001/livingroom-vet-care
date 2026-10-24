-- Private A1 scalar/clinical sources; no mutable display-row packet joins.
-- BEGIN FUNCTION adapter_movement|jsonb|plpgsql
declare state jsonb:=p_state; m public.inventory_movements; l public.inventory_lots;
 s public.stock_movement_sources; boundary public.controlled_stock_opening_movements;
begin
 select * into m from public.inventory_movements where id=p_movement_id;
 select * into l from public.inventory_lots where id=m.lot_id;
 select * into s from public.stock_movement_sources where movement_id=m.id;
 if m.id is null or l.id is null or l.product_id::text is distinct from state->>'product_id'
 or m.created_by is distinct from p_actor_id or p_managed is null then
  raise exception 'adapter_source_integrity' using errcode='23514';end if;
 if s.movement_id is not null then
  if s.writer is distinct from p_source_writer or s.source_id is distinct from p_source_id or s.actor_id is distinct from p_actor_id then
   raise exception 'adapter_source_integrity' using errcode='23514';end if;
  perform public.stock_source_validate_movement(m.id);
  state:=controlled_review_v3.adapter_add(state,'public.stock_movement_sources',jsonb_build_object('movement_id',s.movement_id),to_jsonb(s),p_role);
 elsif p_managed then raise exception 'adapter_source_integrity' using errcode='23514';end if;
 select * into boundary from public.controlled_stock_opening_movements where movement_id=m.id;
 if p_managed then
  if boundary.movement_id is not null or not exists(select 1 from public.controlled_stock_source_links where movement_id=m.id and event_id=p_source_id) then
   raise exception 'adapter_source_integrity' using errcode='23514';end if;
 else
  if boundary.movement_id is null or boundary.opening_id::text is distinct from state->>'opening_id'
  or boundary.source_snapshot is distinct from to_jsonb(m) or boundary.lot_id<>m.lot_id or boundary.quantity<>m.quantity
  or exists(select 1 from public.controlled_stock_source_links where movement_id=m.id) then
   raise exception 'adapter_source_integrity' using errcode='23514';end if;
  state:=controlled_review_v3.adapter_add(state,'public.controlled_stock_opening_movements',
   jsonb_build_object('opening_id',boundary.opening_id,'movement_id',boundary.movement_id),to_jsonb(boundary),'opening_basis');
 end if;
 state:=controlled_review_v3.adapter_add(state,'public.inventory_movements',jsonb_build_object('id',m.id),to_jsonb(m),p_role);
 state:=controlled_review_v3.adapter_add(state,'public.inventory_lots',jsonb_build_object('id',l.id),to_jsonb(l),p_role);
 return state;
end
-- END FUNCTION

-- BEGIN FUNCTION adapter_clinical|jsonb|plpgsql
declare state jsonb:=p_state; e public.controlled_stock_events; p public.controlled_stock_preparations;
 m public.inventory_movements; t public.patient_treatments; i public.billing_invoice_items;
 a public.treatment_alert_reviews; link public.anesthesia_drug_administrations; n integer;
begin
 select * into e from public.controlled_stock_events where id=p_event_id;
 select * into p from public.controlled_stock_preparations where id=p_event_id;
 if e.id is null or e.writer<>all(array['receive_inventory','adjust_inventory','record_patient_treatment','record_anesthesia_drug_administration']) then
  raise exception 'unsupported_event_kind' using errcode='22023';end if;
 select count(*) into n from(select movement_id from public.stock_movement_sources where writer=e.writer and source_id=e.id limit 2)q;
 if n<>1 or not exists(select 1 from public.stock_movement_sources where writer=e.writer and source_id=e.id and movement_id=e.id) then
  raise exception 'adapter_source_integrity' using errcode='23514';end if;
 state:=controlled_review_v3.adapter_movement(state,e.id,e.writer,e.id,e.actor_id,'reviewed_target',true);
 select * into m from public.inventory_movements where id=e.id;
 if e.writer='receive_inventory' then
  if m.kind<>'receive' or m.quantity<=0 then raise exception 'adapter_source_integrity' using errcode='23514';end if;
 elsif e.writer='adjust_inventory' then
  if m.kind<>'adjust' then raise exception 'adapter_source_integrity' using errcode='23514';end if;
 else
  select * into t from public.patient_treatments where id=e.id;
  select * into i from public.billing_invoice_items where id=e.id;
  select * into a from public.treatment_alert_reviews where treatment_id=e.id;
  if t.id is null or i.id is null or a.id is null or t.historical or t.product_id<>e.product_id or t.lot_id<>m.lot_id
  or t.created_by<>e.actor_id or i.created_by<>e.actor_id or a.reviewed_by<>e.actor_id
  or t.invoice_id<>i.invoice_id or t.pet_id is distinct from i.pet_id or t.pet_id<>a.pet_id or i.product_id<>e.product_id
  or m.quantity<>-t.quantity or i.quantity<>t.quantity or m.kind<>'dispense'
  or t.administered_at is distinct from e.observed_at
  or t.administered_at is distinct from(p.canonical_arguments#>>'{request,administered_at}')::timestamptz
  or a.source_hash is distinct from public.controlled_stock_hash(a.snapshot)
  or a.source_hash is distinct from t.request#>>'{alert_review,source_hash}' then
   raise exception 'adapter_source_integrity' using errcode='23514';end if;
  state:=controlled_review_v3.adapter_add(state,'public.patient_treatments',jsonb_build_object('id',t.id),to_jsonb(t),'reviewed_target');
  state:=controlled_review_v3.adapter_add(state,'public.billing_invoice_items',jsonb_build_object('id',i.id),to_jsonb(i),'reviewed_target');
  state:=controlled_review_v3.adapter_add(state,'public.treatment_alert_reviews',jsonb_build_object('id',a.id),to_jsonb(a),'reviewed_target');
  if e.writer='record_anesthesia_drug_administration' then
   select * into link from public.anesthesia_drug_administrations where id=e.id;
   if link.id is null or link.created_by<>e.actor_id or link.pet_id<>t.pet_id
   or link.record_id::text is distinct from p.canonical_arguments->>'record_id'
   or link.pet_id::text is distinct from p.canonical_arguments->>'pet_id'
   or link.request is distinct from((p.canonical_arguments->'request')||jsonb_build_object('pet_id',link.pet_id,'source','Anesthesia record '||link.record_id::text))
   or link.request is distinct from t.request then
    raise exception 'adapter_source_integrity' using errcode='23514';end if;
   state:=controlled_review_v3.adapter_add(state,'public.anesthesia_drug_administrations',jsonb_build_object('id',link.id),to_jsonb(link),'reviewed_target');
  end if;
 end if;
 return state;
end
-- END FUNCTION
