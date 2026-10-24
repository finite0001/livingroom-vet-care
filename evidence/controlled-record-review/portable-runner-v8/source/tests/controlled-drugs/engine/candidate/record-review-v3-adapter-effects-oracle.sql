-- Synthetic local acceptance only, after adapter-fixtures in the same connection.
-- These quantities are independent fixture intent, never adapter output. Full
-- dependency membership and corruption/overflow proofs remain separate gates.
begin;
set local timezone='UTC';
create temp table review_v3_expected_effects(
 label text primary key,available numeric not null,prepared numeric not null,
 held numeric not null,movement_count integer not null,charge_count integer not null
);
insert into review_v3_expected_effects values
 ('receive',1.125,0,0,1,0),
 ('adjust_negative',-0.125,0,0,1,0),
 ('adjust_positive',0.125,0,0,1,0),
 ('treatment',-0.250,0,0,1,1),
 ('anesthesia',-1.500,0,0,1,1),
 ('dispense_a',-10,10,0,2,1),
 ('dispense_b',-8,8,0,2,1),
 ('pickup',0,-10,0,0,0),
 ('intake_v1',0,-4,4,0,0),
 ('dispose_v1',0,0,-1,0,0),
 ('restock_v1',1,0,-1,2,0),
 ('intake_v2',0,-0.500,0.500,0,0),
 ('dispose_v2',0,0,-0.250,0,0),
 ('restock_v2',0.250,0,-0.250,2,0),
 ('retract_intake_v1',0,1,-1,0,0),
 ('retract_disposal_v1',0,0,0.500,0,0),
 ('retract_restock_v1',-0.500,0,0.500,2,0),
 ('retract_intake_v2',0,0.050,-0.050,0,0),
 ('retract_disposal_v2',0,0,0.050,0,0),
 ('retract_restock_v2',-0.050,0,0.050,2,0),
 ('report_v2',0,0,0,0,0),('note_v2',0,0,0,0,0),
 ('confirm_v2',0,0,0,0,0),('corrected_v2',0,0,0,0,0),
 ('report_v1',0,0,0,0,0),('note_v1',0,0,0,0,0),
 ('confirm_v1',0,0,0,0,0),('corrected_v1',0,0,0,0,0),
 ('clinical_annotation',0,0,0,0,0),('operational_annotation',0,0,0,0,0),
 ('pickup_amendment',0,0,0,0,0),('clinical_amended',0,0,0,0,0),
 ('pickup_amended',0,0,0,0,0);

create temp table review_v3_effect_proof(label text primary key,assertion jsonb not null);
do $$
declare f record;e public.controlled_stock_events;v_available numeric;v_prepared numeric;v_held numeric;
 v_movements integer;v_charges integer;v_movement_quantity numeric;collected jsonb;ref jsonb;source jsonb;
begin
 if exists(select label from review_v3_fixture_cases except select label from review_v3_expected_effects)
 or exists(select label from review_v3_expected_effects except select label from review_v3_fixture_cases)then
  raise exception 'A1 exact effect-oracle case set differs';end if;
 for f in select c.*,x.available,x.prepared,x.held,x.movement_count,x.charge_count
  from review_v3_fixture_cases c join review_v3_expected_effects x using(label)order by c.label loop
  select * into strict e from public.controlled_stock_events where id=pg_temp.eid(f.event_key);
  select coalesce(sum(l.quantity_delta)filter(where c.channel='available'),0),
   coalesce(sum(l.quantity_delta)filter(where c.channel='prepared'),0),
   coalesce(sum(l.quantity_delta)filter(where c.channel='return_held'),0)
   into v_available,v_prepared,v_held from public.controlled_stock_event_lines l
   join public.controlled_stock_cells c on c.id=l.cell_id where l.event_id=e.id;
  select count(*),coalesce(sum(m.quantity),0)into v_movements,v_movement_quantity
   from public.stock_movement_sources s join public.inventory_movements m on m.id=s.movement_id
   where s.writer=e.writer and s.source_id=e.id;
  select count(*)into v_charges from public.billing_invoice_items where id=case
   when e.writer='record_native_dispense'then(select invoice_item_id from public.native_dispenses where id=e.id)
   else e.id end;
  if v_available is distinct from f.available or v_prepared is distinct from f.prepared
   or v_held is distinct from f.held or v_movement_quantity is distinct from f.available
   or v_movements is distinct from f.movement_count or v_charges is distinct from f.charge_count then
   raise exception 'A1 independent per-event effects differ for %',f.label;end if;
  collected:=controlled_review_v3.collect_event_sources(e.id);
  -- Check the entire ordered row/ref correspondence independently of the
  -- collector's internal accumulator and reject duplicate or malformed keys.
  if exists(select 1 from jsonb_array_elements(collected->'source_rows')r
    group by r->'relation',r->'key' having count(*)<>1)
   or collected->'source_rows' is distinct from(select jsonb_agg(r order by r->>'relation' collate "C",(r->'key')::text collate "C")
    from jsonb_array_elements(collected->'source_rows')r)then
   raise exception 'A1 source rows are not unique and canonically sorted';end if;
  for source,ref in select r.value,s.value from jsonb_array_elements(collected->'source_rows')with ordinality r
   full join jsonb_array_elements(collected#>'{adapter,source_refs}')with ordinality s on r.ordinality=s.ordinality loop
   if source is null or ref is null
    or(select array_agg(k order by k)from jsonb_object_keys(source)k)is distinct from array['key','relation','row']
    or(select array_agg(k order by k)from jsonb_object_keys(ref)k)is distinct from array['key','relation','role','row_hash']
    or source->'relation'is distinct from ref->'relation' or source->'key'is distinct from ref->'key'
    or ref->>'row_hash'is distinct from public.controlled_stock_hash(source->'row')then
    raise exception 'A1 full immutable row/ref/hash correspondence differs';end if;
  end loop;
  insert into review_v3_effect_proof values(f.label,jsonb_build_object('event_kind',e.event_kind,
   'writer',e.writer,'event_id',e.id,'record_hash',e.record_hash,
   'available',v_available::text,'prepared',v_prepared::text,'return_held',v_held::text,
   'movements',v_movements,'charges',v_charges,'source_rows',jsonb_array_length(collected->'source_rows'),
   'source_refs',collected#>'{adapter,source_refs}','site_id',collected#>'{adapter,site_id}',
   'site_basis',collected#>'{adapter,site_basis}','native_family_dispense_id',collected#>'{adapter,native_family_dispense_id}'));
 end loop;
end $$;
select jsonb_build_object('synthetic_only',true,'per_event_effect_cases',(select count(*)from review_v3_effect_proof),
 'full_dependency_membership_proven',false,'corruption_and_overflow_proven',false,
 'cases',(select jsonb_agg(assertion order by label)from review_v3_effect_proof));
commit;
