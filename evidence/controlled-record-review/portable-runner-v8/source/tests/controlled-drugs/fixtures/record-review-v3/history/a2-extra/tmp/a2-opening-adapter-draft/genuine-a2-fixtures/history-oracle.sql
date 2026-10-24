create function pg_temp.a2_history_rows(relation_name text) returns jsonb language plpgsql as $$
declare body jsonb;cols jsonb;begin
 if relation_name<>all(array['auth.users','profiles','user_roles','native_prescriber_configurations','native_prescription_draft_revisions','clients','pets','catalog_products','native_prescription_authorizations','native_prescription_drafts',
 'native_prescription_authorization_events','native_fill_slots','native_dispenses','native_dispense_allocations',
 'native_fulfillment_events','native_fulfillment_operations','native_dispense_correction_events','native_dispense_correction_operations',
 'inventory_lots','inventory_movements','native_prescription_operations','billing_invoices','billing_invoice_items',
 'stock_movement_sources','stock_custody_sources','stock_discrepancy_sources','native_pickups','native_slot_closures',
 'native_return_events','native_return_discrepancy_events','stock_writer_admissions']) then
 raise exception 'Unreviewed historical source relation' using errcode='23514';end if;
 select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod))order by a.attnum) into cols
 from pg_attribute a where a.attrelid=to_regclass(case when relation_name='auth.users' then relation_name else 'public.'||relation_name end) and a.attnum>0 and not a.attisdropped;
 if cols is null then raise exception 'Required historical relation absent' using errcode='23514';end if;
 execute format('select coalesce(jsonb_agg(j order by j::text collate "C"),''[]''::jsonb)from(select to_jsonb(r)j from %I.%I r limit 1001)q',case when relation_name='auth.users' then 'auth' else 'public' end,case when relation_name='auth.users' then 'users' else relation_name end) into body;
 if jsonb_array_length(body)>1000 then raise exception 'Historical fixture source relation exceeds bound' using errcode='54000';end if;
 return jsonb_build_object('columns',cols,'rows',body);
end$$;
create function pg_temp.a2_history_assertions()returns jsonb language plpgsql as $$
declare f record;actual jsonb;expected jsonb;unexpected boolean;begin
 perform pg_temp.a2_identity('ordinary');
 if (select count(*)from public.native_dispenses)<>5 or (select count(*)from public.native_dispense_allocations)<>10
 or (select count(*)from public.inventory_lots)<>10 or (select count(*)from public.inventory_movements)<>20
 or (select count(*)from public.stock_movement_sources)<>20 or (select count(*)from public.billing_invoice_items)<>5
 or (select count(*)from public.native_fill_slots)<>5 or (select count(*)from public.native_fulfillment_operations)<>5
 or (select count(*)from public.native_dispense_correction_events)<>2 or (select count(*)from public.native_dispense_correction_operations)<>2
 or exists(select 1 from public.native_pickups) or exists(select 1 from public.native_return_events) or exists(select 1 from public.native_return_discrepancy_events)
 or exists(select 1 from public.stock_custody_sources) or exists(select 1 from public.stock_discrepancy_sources) or exists(select 1 from public.native_slot_closures) then
 raise exception 'A2 genuine188 fixed source inventory differs' using errcode='23514';end if;
 for f in select label from(values('plain'),('clinical_prefix'),('operational_prefix'),('split'),('pickup'))v(label) loop
  if not exists(select 1 from public.native_dispenses d join public.native_fulfillment_operations o on o.id=d.id
    join public.billing_invoice_items i on i.id=d.invoice_item_id join public.native_fill_slots s on s.id=d.slot_id
    where d.id=pg_temp.a2_id(f.label||'.dispense') and d.authorization_id=pg_temp.a2_id(f.label||'.sign') and d.invoice_id=pg_temp.a2_id(f.label||'.invoice')
    and d.pet_id=pg_temp.a2_id('pet') and d.actor_id=pg_temp.a2_id('actor') and d.quantity=2.000 and o.operation='dispense' and o.actor_id=d.actor_id
    and o.result->'dispense'=d.document and i.id=pg_temp.a2_id(f.label||'.charge') and i.invoice_id=d.invoice_id and i.product_id=pg_temp.a2_id(f.label||'.product')
    and i.quantity=2.000 and i.amount_cents=200 and s.authorization_id=d.authorization_id and s.slot_index=0 and s.version=1
    and s.maximum_quantity=2.000 and s.dispensed_quantity=2.000 and s.remaining_quantity=0 and s.state='closed' and s.closure_kind='filled') then
   raise exception 'A2 exact genuine dispense/charge/slot identity differs' using errcode='23514';end if;
  select jsonb_agg(jsonb_build_object('id',a.id,'lot',a.lot_id,'quantity',a.quantity,'movement',a.movement_id,'movement_quantity',m.quantity,
   'kind',m.kind,'product',l.product_id,'writer',s.writer,'source',s.source_id,'actor',s.actor_id)order by a.id)into actual
   from public.native_dispense_allocations a join public.inventory_movements m on m.id=a.movement_id and m.lot_id=a.lot_id and m.created_by=pg_temp.a2_id('actor')
   join public.inventory_lots l on l.id=a.lot_id join public.stock_movement_sources s on s.movement_id=m.id where a.dispense_id=pg_temp.a2_id(f.label||'.dispense');
  select jsonb_agg(jsonb_build_object('id',pg_temp.a2_id(f.label||'.allocation'||n),'lot',pg_temp.a2_id(f.label||'.lot'||n),'quantity',1.000,
   'movement',pg_temp.a2_id(f.label||'.movement'||n),'movement_quantity',-1.000,'kind','dispense','product',pg_temp.a2_id(f.label||'.product'),
   'writer','record_native_dispense','source',pg_temp.a2_id(f.label||'.dispense'),'actor',pg_temp.a2_id('actor'))order by pg_temp.a2_id(f.label||'.allocation'||n))into expected from generate_series(1,2)n;
  if actual is distinct from expected then raise exception 'A2 exact original allocation/source membership differs' using errcode='23514';end if;
  select jsonb_agg(jsonb_build_object('id',m.id,'lot',m.lot_id,'quantity',m.quantity,'kind',m.kind,'source',s.source_id,'writer',s.writer,
   'actor',s.actor_id,'product',l.product_id)order by m.id)into actual
   from public.inventory_movements m join public.stock_movement_sources s on s.movement_id=m.id join public.inventory_lots l on l.id=m.lot_id
   where m.id in(pg_temp.a2_id(f.label||'.receive1'),pg_temp.a2_id(f.label||'.receive2')) and m.created_by=pg_temp.a2_id('actor');
  select jsonb_agg(jsonb_build_object('id',pg_temp.a2_id(f.label||'.receive'||n),'lot',pg_temp.a2_id(f.label||'.lot'||n),'quantity',3.000,'kind','receive',
   'source',pg_temp.a2_id(f.label||'.receive'||n),'writer','receive_inventory','actor',pg_temp.a2_id('actor'),'product',pg_temp.a2_id(f.label||'.product'))
   order by pg_temp.a2_id(f.label||'.receive'||n))into expected from generate_series(1,2)n;
  if actual is distinct from expected or exists(select 1 from public.inventory_lots l where l.product_id=pg_temp.a2_id(f.label||'.product')
   and(select sum(quantity)from public.inventory_movements where lot_id=l.id)<>2.000) then raise exception 'A2 receipt/net source quantity differs' using errcode='23514';end if;
  if f.label in('clinical_prefix','operational_prefix') and not exists(select 1 from public.native_dispense_correction_events c
   join public.native_dispense_correction_operations o on o.id=c.id where c.id=pg_temp.a2_id(f.label||'.old_correction')
   and c.dispense_id=pg_temp.a2_id(f.label||'.dispense') and c.authorization_id=pg_temp.a2_id(f.label||'.sign') and c.pet_id=pg_temp.a2_id('pet')
   and c.actor_id=pg_temp.a2_id('actor') and c.kind=case f.label when 'clinical_prefix' then 'clinical_annotation' else 'operational_annotation' end
   and c.sequence=1 and c.prior_event_id is null and o.actor_id=c.actor_id and o.result=c.document) then
   raise exception 'A2 exact retained historical correction differs' using errcode='23514';end if;
 end loop;
 if (select count(*)from public.stock_writer_admissions)<>1 or not exists(select 1 from public.stock_writer_admissions a
  where a.backend_pid=__SEED_PID__ and a.writer='record_native_dispense' and a.source_id=pg_temp.a2_id('pickup.dispense') and a.actor_id=pg_temp.a2_id('actor'))
 or exists(select 1 from public.stock_writer_admissions a join pg_stat_activity b on b.pid=a.backend_pid) then
 raise exception 'A2 retained admission must bind exact closed genuine seed backend' using errcode='23514';end if;
 if to_regclass('public.stock_pickup_sources') is not null then
  execute 'select exists(select 1 from public.stock_pickup_sources)or exists(select 1 from public.stock_correction_sources)'into unexpected;
  if unexpected is distinct from false then raise exception 'A2 old history provenance backfilled' using errcode='23514';end if;
 end if;
 if to_regclass('public.controlled_stock_opening_movements') is not null then
  execute 'select exists(select 1 from public.controlled_stock_opening_movements)or exists(select 1 from public.controlled_stock_events)'into unexpected;
  if unexpected is distinct from false then raise exception 'A2 old controlled membership backfilled' using errcode='23514';end if;
 end if;
 return jsonb_build_object('products',5,'lots',10,'movements',20,'movement_sources',20,'allocations',10,'dispenses',5,'charges',5,'old_corrections',2,
 'closed_seed_backend',__SEED_PID__,'retroactive_membership',false,'new_pickup_correction_provenance',false);
end $$;
