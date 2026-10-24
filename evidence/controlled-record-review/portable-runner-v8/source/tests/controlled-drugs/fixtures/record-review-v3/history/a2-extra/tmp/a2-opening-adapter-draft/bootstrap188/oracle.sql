-- Independent direct source oracle, in a fresh postgres read-only transaction.
-- __FIXED188_IDS__ is substituted only with an exact admitted UUID-key JSON map.
begin;
set local timezone='UTC';
create temp table fixed188_oracle_ids(value jsonb not null);
insert into fixed188_oracle_ids values (__FIXED188_IDS__::jsonb);
create function pg_temp.fixed188_id(key text) returns uuid language sql stable as
 $$select(value->>key)::uuid from pg_temp.fixed188_oracle_ids$$;
create function pg_temp.fixed188_rows(relation_name text) returns jsonb language plpgsql as $$
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
create function pg_temp.fixed188_membership() returns jsonb language plpgsql as $$
declare d public.native_dispenses;c public.native_dispense_correction_events;unexpected boolean;actual jsonb;expected jsonb;begin
 if session_user<>'postgres' or current_user<>'postgres' or current_setting('role')<>'none' or current_setting('session_replication_role')<>'origin'
 or auth.uid() is not null or auth.role() is not null or auth.email() is not null
 or nullif(current_setting('request.jwt.claims',true),'') is not null or nullif(current_setting('request.jwt.claim.sub',true),'') is not null
 or nullif(current_setting('request.jwt.claim.role',true),'') is not null or nullif(current_setting('request.jwt.claim.email',true),'') is not null then
 raise exception 'Historical oracle ordinary session required' using errcode='23514';end if;
 select * into strict d from native_dispenses where id=pg_temp.fixed188_id('dispense');
 select * into strict c from native_dispense_correction_events where id=pg_temp.fixed188_id('correction');
 if d.authorization_id<>pg_temp.fixed188_id('sign') or d.pet_id<>pg_temp.fixed188_id('pet') or d.invoice_id<>pg_temp.fixed188_id('invoice')
 or d.actor_id<>pg_temp.fixed188_id('actor') or d.quantity<>2.000 or c.dispense_id<>d.id or c.authorization_id<>d.authorization_id
 or c.pet_id<>d.pet_id or c.actor_id<>d.actor_id or c.sequence<>1 or c.prior_event_id is not null or c.kind<>'clinical_annotation'
 or (select count(*)from native_dispenses)<>1 or (select count(*)from native_dispense_correction_events)<>1
 or (select count(*)from native_fulfillment_operations)<>1 or (select count(*)from native_dispense_correction_operations)<>1
 or not exists(select 1 from native_fulfillment_operations o where o.id=d.id and o.actor_id=d.actor_id and o.operation='dispense')
 or not exists(select 1 from native_dispense_correction_operations o where o.id=c.id and o.actor_id=c.actor_id and o.result=c.document)
 or (select count(*)from native_dispense_allocations)<>2 or (select count(*)from inventory_lots)<>2
 or (select count(*)from inventory_movements)<>4 or (select count(*)from stock_movement_sources)<>4
 or (select count(*)from billing_invoice_items)<>1 or (select count(*)from native_fill_slots)<>1 then
 raise exception 'Historical fixture exact source identity/cardinality mismatch' using errcode='23514';end if;
 if not exists(select 1 from billing_invoice_items i where i.id=d.invoice_item_id and i.invoice_id=d.invoice_id and i.product_id=pg_temp.fixed188_id('product') and i.quantity=2.000 and i.amount_cents=200)
 or not exists(select 1 from native_fill_slots s where s.id=d.slot_id and s.authorization_id=d.authorization_id and s.slot_index=0
 and s.version=1 and s.maximum_quantity=2.000 and s.dispensed_quantity=2.000 and s.remaining_quantity=0 and s.state='closed' and s.closure_kind='filled') then
 raise exception 'Historical fixture charge or slot effects mismatch' using errcode='23514';end if;
 select jsonb_agg(jsonb_build_object('lot',a.lot_id,'quantity',a.quantity,'movement_quantity',m.quantity,'movement_kind',m.kind,
 'product',l.product_id,'writer',s.writer,'source_id',s.source_id,'actor',s.actor_id)order by a.lot_id) into actual
 from native_dispense_allocations a join inventory_movements m on m.id=a.movement_id join inventory_lots l on l.id=a.lot_id
 join stock_movement_sources s on s.movement_id=a.movement_id where a.dispense_id=d.id and m.lot_id=a.lot_id and m.created_by=d.actor_id;
 select jsonb_agg(jsonb_build_object('lot',pg_temp.fixed188_id('lot'||n),'quantity',1.000,'movement_quantity',-1.000,'movement_kind','dispense',
 'product',pg_temp.fixed188_id('product'),'writer','record_native_dispense','source_id',d.id,'actor',d.actor_id)order by n) into expected from generate_series(1,2)n;
 if actual is distinct from expected then raise exception 'Historical original allocation/movement/source membership differs' using errcode='23514';end if;
 select jsonb_agg(jsonb_build_object('lot',m.lot_id,'quantity',m.quantity,'kind',m.kind,'writer',s.writer,'source_id',s.source_id,'actor',s.actor_id)order by m.lot_id) into actual
 from inventory_movements m join stock_movement_sources s on s.movement_id=m.id where m.kind='receive';
 select jsonb_agg(jsonb_build_object('lot',pg_temp.fixed188_id('lot'||n),'quantity',3.000,'kind','receive','writer','receive_inventory',
 'source_id',pg_temp.fixed188_id('receive'||n),'actor',pg_temp.fixed188_id('actor'))order by n) into expected from generate_series(1,2)n;
 if actual is distinct from expected or exists(select 1 from inventory_lots l where l.product_id<>pg_temp.fixed188_id('product')
 or (select sum(m.quantity)from inventory_movements m where m.lot_id=l.id)<>2.000) then
 raise exception 'Historical genuine receipt membership or remaining quantity differs' using errcode='23514';end if;
 if exists(select 1 from native_pickups) or exists(select 1 from native_slot_closures) or exists(select 1 from native_return_events)
 or exists(select 1 from native_return_discrepancy_events) or exists(select 1 from stock_custody_sources) or exists(select 1 from stock_discrepancy_sources)
 then
 raise exception 'Historical fixture contains unrequested handoff/custody/active admission' using errcode='23514';end if;
 if to_regclass('public.stock_pickup_sources') is not null then
 execute 'select exists(select 1 from public.stock_pickup_sources) or exists(select 1 from public.stock_correction_sources)' into unexpected;
 if unexpected is distinct from false then raise exception 'Historical handoff/correction provenance backfilled' using errcode='23514';end if;
 end if;
 if to_regclass('public.controlled_stock_opening_movements') is not null then
 execute 'select exists(select 1 from public.controlled_stock_opening_movements) or exists(select 1 from public.controlled_stock_events)' into unexpected;
 if unexpected is distinct from false then raise exception 'Historical controlled membership backfilled' using errcode='23514';end if;
 end if;
 if (select count(*)from stock_writer_admissions)<>1 or not exists(select 1 from stock_writer_admissions a where a.writer='record_native_dispense' and a.source_id=d.id and a.actor_id=d.actor_id)
 or exists(select 1 from stock_writer_admissions a join pg_stat_activity b on b.pid=a.backend_pid) then
 raise exception 'Historical writer admission is not the exact closed fixture backend' using errcode='23514';end if;
 return jsonb_build_object('admission_backend_pid',(select backend_pid from stock_writer_admissions),'dispense_id',d.id,'correction_id',c.id,'movement_count',4,'allocation_count',2,
 'charge_count',1,'pickup_sources',0,'correction_sources',0,'backfilled',false,'opening_or_controlled_event_count',0);
end$$;
commit;
begin read only;
set local timezone='UTC';
select jsonb_build_object('kind','fixed188-source-oracle-v1','membership',pg_temp.fixed188_membership(),
 'relations',(select jsonb_object_agg(name,pg_temp.fixed188_rows(name)order by name collate "C")from unnest(array[
 'auth.users','profiles','user_roles','native_prescriber_configurations','native_prescription_draft_revisions','clients','pets','catalog_products','native_prescription_authorizations','native_prescription_drafts','native_prescription_authorization_events',
 'native_fill_slots','native_dispenses','native_dispense_allocations','native_fulfillment_events','native_fulfillment_operations',
 'native_dispense_correction_events','native_dispense_correction_operations','inventory_lots','inventory_movements','native_prescription_operations',
 'billing_invoices','billing_invoice_items','stock_movement_sources','stock_custody_sources','stock_discrepancy_sources','native_pickups',
 'native_slot_closures','native_return_events','native_return_discrepancy_events','stock_writer_admissions'])name));
commit;
