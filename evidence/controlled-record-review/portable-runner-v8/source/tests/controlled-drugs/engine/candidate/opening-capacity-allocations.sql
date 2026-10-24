-- OWNED LOCAL ONLY. Runner prepends the genuine native_fulfillment prefix,
-- leaving its transaction open. Genuine writers commit ONLY in the marked clone
-- before each separate exclusive configuration transaction. No source runtime is
-- changed. No canonical history is inserted by hand except
-- the explicitly named corruption probes, each rolled back independently.
reset role;set local timezone='UTC';
create temp table capacity_results(label text primary key,value jsonb not null);
create temp table capacity_baselines(label text primary key,value jsonb not null);
create temp table capacity_lots(n integer primary key,id uuid not null unique);
insert into capacity_lots select n,gen_random_uuid()from generate_series(1,100)n;
create temp table capacity_dispenses(n integer primary key,id uuid not null unique);
create temp table capacity_fake_ids(n integer primary key,id uuid not null unique);
insert into capacity_fake_ids select n,gen_random_uuid()from generate_series(1,1001)n;
create function pg_temp.capacity_id(key text)returns uuid language sql stable as $$select id from fx where k=key$$;
create function pg_temp.capacity_assert(value boolean,label text)returns void language plpgsql as $$begin
 if value is distinct from true then raise exception 'Capacity assertion failed: %',label;end if;
 insert into capacity_results values(label,jsonb_build_object('outcome','accepted_assertion'));
end$$;
create function pg_temp.capacity_snapshot()returns jsonb language plpgsql volatile set timezone='UTC' as $$
declare r record;value jsonb;result jsonb:='{}';begin
 for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in('public','auth','storage','extensions')and c.relkind in('r','p')order by n.nspname,c.relname loop
 execute format('select jsonb_build_object(''count'',count(*),''hash'',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,''|''order by to_jsonb(t)::text),''''),''UTF8'')),''hex''))from %I.%I t',r.nspname,r.relname)into value;
 result:=result||jsonb_build_object(r.nspname||'.'||r.relname,value);end loop;return result;end$$;
create function pg_temp.capacity_refuse(label text,mutation text,observation text,expected text)returns void language plpgsql volatile as $$
declare before_value jsonb:=pg_temp.capacity_snapshot();manifest jsonb:=controlled_stock_manifest_snapshot();armed boolean:=false;failure text;state text;begin
 begin
  set constraints all deferred;execute mutation;armed:=true;execute observation;
  raise exception 'Capacity observation unexpectedly accepted: %',label using errcode='P0002';
 exception when check_violation then
  get stacked diagnostics failure=MESSAGE_TEXT,state=RETURNED_SQLSTATE;
  if not armed then raise exception 'Capacity mutation failed before observation: %: %',label,failure using errcode='P0003';end if;
  if state is distinct from '23514'or failure is distinct from expected then raise exception 'Wrong capacity guard: %: % %',label,state,failure using errcode='P0003';end if;
 end;
 if before_value is distinct from pg_temp.capacity_snapshot()or manifest is distinct from controlled_stock_manifest_snapshot()then
  raise exception 'Capacity refusal failed exact four-schema and manifest rollback: %',label;end if;
 insert into capacity_results values(label,jsonb_build_object('outcome','refused','sqlstate',state,'error',failure,'armed_before_observation',true,'four_schema_and_manifest_rollback',true));
end$$;
create function pg_temp.capacity_request(n integer,allocation_count integer default 1)returns jsonb language sql volatile as $$
 select t||jsonb_build_object('expected_context_hash',preview_native_dispense(t)->>'context_hash','reason','Synthetic capacity writer fixture',
 'attest_alert_review',true,'attest_dispense_review',true)from(select jsonb_build_object('authorization_id',pg_temp.capacity_id('sign'),'pet_id',pg_temp.capacity_id('pet'),
 'slot_index',0,'expected_slot_version',case when n=1 then null else n-1 end,'invoice_id',pg_temp.capacity_id('invoice'),
 'quantity',case when allocation_count>1 then '2.000'else '0.125'end,
 'allocations',case when allocation_count>1 then(select jsonb_agg(jsonb_build_object('lot_id',id,'quantity','0.020')order by id)from capacity_lots where capacity_lots.n<=allocation_count)
 else jsonb_build_array(jsonb_build_object('lot_id',pg_temp.capacity_id('lot2'),'quantity','0.125'))end,'refill',null)t)s
$$;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"a5510000-0000-4000-8000-000000000001"}',true);
-- Independent allocation scenario: receipts exactly equal dispensed quantities.
do $$declare r record;did uuid:=gen_random_uuid();begin
 for r in select *from capacity_lots order by n loop
  perform receive_inventory(gen_random_uuid(),r.id,pg_temp.capacity_id('product'),'SYNTHETIC-ALLOCATION-CAPACITY-'||r.n,current_date+365,'Synthetic clinic',0.020,'Synthetic exact allocation-capacity receipt');
 end loop;
 perform record_native_dispense(did,pg_temp.capacity_request(1,100));
 insert into capacity_dispenses values(1,did);
end$$;
select pg_temp.capacity_assert((select count(*)from native_dispenses)=1,'genuine_single_dispense');
select pg_temp.capacity_assert((select count(*)from native_dispense_allocations where dispense_id=(select id from capacity_dispenses where n=1))=100,'genuine100allocations');
select pg_temp.capacity_assert(jsonb_array_length(controlled_stock_opening_native_entry_for_product(pg_temp.capacity_id('product'),'tablet',(select id from capacity_dispenses where n=1),0,0,0,null)->'allocations')=100,'genuine100allocation_projection_complete');
insert into capacity_lots values(101,pg_temp.capacity_id('lot1'));
select pg_temp.capacity_refuse('canonical101allocation_request','select 1',
 $q$select preview_native_dispense(jsonb_build_object('authorization_id',pg_temp.capacity_id('sign'),'pet_id',pg_temp.capacity_id('pet'),'slot_index',0,'expected_slot_version',1,
 'invoice_id',pg_temp.capacity_id('invoice'),'quantity','2.020','allocations',(select jsonb_agg(jsonb_build_object('lot_id',id,'quantity','0.020')order by id)from capacity_lots),'refill',null))$q$,
 'Bounded lot allocations required');

-- This helper constructs an opening from every real source movement and the
-- single genuine dispense. Validation remains a separate caller operation.
create function pg_temp.capacity_build_opening()returns void language plpgsql volatile as $$declare boundary jsonb;r record;cid uuid;begin
 select jsonb_agg(controlled_stock_opening_native_entry_for_product(pg_temp.capacity_id('product'),'tablet',id,0,0,0,null)order by id)
 into boundary from capacity_dispenses where n<=200;
 insert into controlled_stock_openings(id,product_id,policy_version_id,observed_at,count_evidence,native_custody_boundary,actor_id,session_id)
 values(pg_temp.capacity_id('engine_opening'),pg_temp.capacity_id('product'),pg_temp.capacity_id('engine_policy'),clock_timestamp(),
 '{"synthetic":true,"not_practice_physical_count":true}',boundary,auth.uid(),pg_temp.capacity_id('engine_session'));
 insert into controlled_stock_opening_movements(opening_id,movement_id,lot_id,quantity,source_snapshot)
 select pg_temp.capacity_id('engine_opening'),m.id,m.lot_id,m.quantity,to_jsonb(m)from inventory_movements m join inventory_lots l on l.id=m.lot_id where l.product_id=pg_temp.capacity_id('product');
 for r in select l.id,coalesce(sum(m.quantity),0)quantity from inventory_lots l left join inventory_movements m on m.lot_id=l.id where l.product_id=pg_temp.capacity_id('product')group by l.id having coalesce(sum(m.quantity),0)>0 loop
  cid:=gen_random_uuid();
  insert into controlled_stock_containers(id,product_id,stock_unit,label,kind,stock_lot_id,controlling_site_id,initial_location_id,initial_custodian_id,opening_id,actor_id,session_id)
  values(cid,pg_temp.capacity_id('product'),'tablet','Synthetic capacity stock','stock',r.id,pg_temp.capacity_id('engine_site'),pg_temp.capacity_id('engine_location'),auth.uid(),pg_temp.capacity_id('engine_opening'),auth.uid(),pg_temp.capacity_id('engine_session'));
  insert into controlled_stock_cells(id,container_id,lot_id,channel,opening_id,opening_quantity)values(gen_random_uuid(),cid,r.id,'available',pg_temp.capacity_id('engine_opening'),r.quantity);
 end loop;
 -- One synthetic prepared container retains100 distinct original allocation
 -- cells. This is a technical fixture, not a practice packaging decision.
 cid:=gen_random_uuid();
 insert into controlled_stock_containers(id,product_id,stock_unit,label,kind,stock_lot_id,controlling_site_id,initial_location_id,initial_custodian_id,opening_id,actor_id,session_id)
 values(cid,pg_temp.capacity_id('product'),'tablet','Synthetic aggregate capacity package','prepared',null,pg_temp.capacity_id('engine_site'),pg_temp.capacity_id('engine_location'),auth.uid(),pg_temp.capacity_id('engine_opening'),auth.uid(),pg_temp.capacity_id('engine_session'));
 insert into controlled_stock_cells(id,container_id,lot_id,channel,dispense_id,allocation_id,opening_id,opening_quantity)
 select gen_random_uuid(),cid,a.lot_id,'prepared',a.dispense_id,a.id,pg_temp.capacity_id('engine_opening'),a.quantity
 from native_dispense_allocations a join capacity_dispenses d on d.id=a.dispense_id where d.n<=200;
 insert into controlled_stock_container_heads(container_id,version,location_id,custodian_id,status)
 select id,0,initial_location_id,initial_custodian_id,'onsite'from controlled_stock_containers where opening_id=pg_temp.capacity_id('engine_opening');
 insert into controlled_stock_positions select id,opening_quantity from controlled_stock_cells where opening_id=pg_temp.capacity_id('engine_opening');
end$$;
set constraints all immediate;commit;begin;set local timezone='UTC';
select jsonb_build_object('kind','controlled-opening-capacity-canonical-baseline-v1','fingerprint',pg_temp.capacity_snapshot(),
 'native_dispenses',(select count(*)from native_dispenses),'genuine_dispenses',1,'canonical_fixture_committed_inside_owned_clone',true);
-- CAPACITY_PRIVATE_CONFIGURATION --
select pg_temp.capacity_build_opening();
select controlled_stock_validate_opening(pg_temp.capacity_id('engine_opening'));
select controlled_stock_validate_product(pg_temp.capacity_id('product'));
set constraints all immediate;
select pg_temp.capacity_assert((select count(*)from controlled_stock_cells where channel='prepared')=100,'fullopening100prepared_allocation_cells');
select pg_temp.capacity_assert((select count(*)from controlled_stock_cells where channel='available')=2
 and not exists(select 1 from controlled_stock_cells c join capacity_lots l on l.id=c.lot_id where l.n<=100 and c.channel='available'),
 'zero_net100new_lots_need_no_available_cells');
select pg_temp.capacity_assert(not exists(select 1 from controlled_stock_state_events where state='active')and not exists(select 1 from controlled_stock_events)
 and exists(select 1 from controlled_stock_state_events where state='opening_frozen'and opening_id is null),'fullopening_unattached_frozen_noactivation');
select pg_temp.capacity_refuse('corrupt101_actual_allocations_selector0',
 $q$alter table native_dispense_allocations disable trigger user;insert into native_dispense_allocations(id,dispense_id,lot_id,movement_id,quantity)
 select gen_random_uuid(),(select id from capacity_dispenses where n=1),pg_temp.capacity_id('lot1'),m.id,0.001 from inventory_movements m where m.lot_id=pg_temp.capacity_id('lot1')and m.kind='receive'$q$,
 $q$select controlled_stock_opening_native_entry_for_product(pg_temp.capacity_id('product'),'tablet',(select id from capacity_dispenses where n=1),0,0,0,null)$q$,
 'Native history exceeds opening candidate limit; no truncation permitted');
select controlled_stock_validate_product(pg_temp.capacity_id('product'));
set constraints all immediate;
select jsonb_build_object('kind','controlled-opening-capacity-positive-v1','genuine_dispenses',1,'genuine_max_allocations',100,
 'full_opening_validated',true,'unattached_frozen_only',true,'native_boundary_bytes',(select octet_length(native_custody_boundary::text)from controlled_stock_openings),
 'sql_checks',(select count(*)from capacity_results),'refusals',(select count(*)from capacity_results where value->>'outcome'='refused'),
 'outcomes',(select jsonb_agg(jsonb_build_object('label',label)||value order by label)from capacity_results),
 'separate_scenario_not_simultaneous_maxima',true,'canonical_fixture_committed_inside_owned_clone',true,'configuration_transactions_rolled_back',true,
 'canonical_fixture_removed_by_owned_clone_cleanup',true,'synthetic_only',true,'hosted_writes',0,'clinical_or_register_activation',false,
 'corrupt_event_rows_are_canonical_history',false,'genuine1000_event_chains_tested',false,'structural_byte_probes_are_valid_openings',false);
select jsonb_build_object('kind','controlled-opening-capacity-observation-v1','genuine_dispenses',1,'genuine_max_allocations',100,
 'sql_checks',0,'refusals',0,'outcomes','[]'::jsonb,'separate_scenario_not_simultaneous_maxima',true,
 'canonical_fixture_committed_inside_owned_clone',true,'configuration_transactions_rolled_back',true,
 'canonical_fixture_removed_by_owned_clone_cleanup',true,'synthetic_only',true,'hosted_writes',0,'clinical_or_register_activation',false);
rollback;
