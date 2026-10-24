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
-- Independent dispense scenario:200 genuine single-allocation dispenses.
do $$declare r record;did uuid;begin
 for n in 1..200 loop
  did:=gen_random_uuid();perform record_native_dispense(did,pg_temp.capacity_request(n));
  insert into capacity_dispenses values(n,did);
 end loop;
end$$;
select pg_temp.capacity_assert((select count(*)from native_dispenses)=200,'genuine200dispenses');
select pg_temp.capacity_assert((select count(*)from native_dispense_allocations)=200
 and not exists(select 1 from native_dispenses d where(select count(*)from native_dispense_allocations a where a.dispense_id=d.id)<>1),
 'genuine200_single_allocation_sources');
-- This helper constructs an opening from every real source movement and the
-- first200 genuine dispenses. Validation remains a separate caller operation.
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
 -- One synthetic prepared container retains200 distinct original allocation
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
-- Actual shared-writer/exclusive-freeze separation is mandatory. Never remove
-- admission rows or bypass the configuration lock guards to simulate a freeze.
set constraints all immediate;commit;begin;set local timezone='UTC';
insert into capacity_baselines values('genuine200_before_configuration',pg_temp.capacity_snapshot());
savepoint capacity_unconfigured;
-- CAPACITY_PRIVATE_CONFIGURATION --
select pg_temp.capacity_build_opening();
select controlled_stock_validate_opening(pg_temp.capacity_id('engine_opening'));
select controlled_stock_validate_product(pg_temp.capacity_id('product'));
set constraints all immediate;
select pg_temp.capacity_assert((select jsonb_array_length(native_custody_boundary)=200 and octet_length(native_custody_boundary::text)<=1048576 from controlled_stock_openings where id=pg_temp.capacity_id('engine_opening')),'genuine200_fullopening_validated');
select pg_temp.capacity_assert(not exists(select 1 from controlled_stock_state_events where state='active')and not exists(select 1 from controlled_stock_events)
 and exists(select 1 from controlled_stock_state_events where state='opening_frozen'and opening_id is null),'fullopening_unattached_frozen_noactivation');
-- CAPACITY_GENUINE_200_READY --

-- Structural boundary probes are NOT valid canonical opening acceptance.
select pg_temp.capacity_refuse('structural201boundary_entries',
 $q$alter table controlled_stock_openings disable trigger immutable;update controlled_stock_openings set native_custody_boundary=native_custody_boundary||jsonb_build_array(native_custody_boundary->0)$q$,
 $q$select controlled_stock_validate_opening(pg_temp.capacity_id('engine_opening'))$q$,'Bounded actual opening boundary required');
create function pg_temp.capacity_byte_boundary(n integer)returns jsonb language plpgsql immutable as $$declare value jsonb;begin
 value:=jsonb_build_array(jsonb_build_object('padding',repeat('x',n-octet_length(jsonb_build_array(jsonb_build_object('padding',''))::text))));
 if octet_length(value::text)is distinct from n then raise exception 'Exact structural byte fixture size mismatch';end if;return value;end$$;
select pg_temp.capacity_refuse('structural_boundary_exact1MiB_reaches_fields_guard',
 $q$alter table controlled_stock_openings disable trigger immutable;update controlled_stock_openings set native_custody_boundary=pg_temp.capacity_byte_boundary(1048576)$q$,
 $q$select controlled_stock_validate_opening(pg_temp.capacity_id('engine_opening'))$q$,'Exact controlled-operation fields required');
select pg_temp.capacity_refuse('structural_boundary_1MiBplus1_size_guard',
 $q$alter table controlled_stock_openings disable trigger immutable;update controlled_stock_openings set native_custody_boundary=pg_temp.capacity_byte_boundary(1048577)$q$,
 $q$select controlled_stock_validate_opening(pg_temp.capacity_id('engine_opening'))$q$,'Bounded actual opening boundary required');

-- Synthetic helper arrays prove selector/head boundary mechanics and exact
-- identity/hash retention; they are not genuine1000-event source histories.
do $$declare events jsonb;head jsonb;expected jsonb;begin
 select jsonb_agg(jsonb_build_object('id',id,'sequence',n,'record_hash',lpad(n::text,64,'0'))order by n)into events from capacity_fake_ids where n<=1000;
 expected:=jsonb_build_object('event_id',(select id from capacity_fake_ids where n=1000),'version',1000,'record_hash',lpad('1000',64,'0'));
 head:=controlled_stock_opening_head(events,1000);
 perform pg_temp.capacity_assert(head=expected and controlled_stock_opening_selector(head)=1000,'synthetic_helper1000_exact_identity_hash');
end$$;
select pg_temp.capacity_refuse('synthetic_helper_selector1001','select 1',
 $q$select controlled_stock_opening_selector(jsonb_build_object('event_id',(select id from capacity_fake_ids where n=1001),'version',1001,'record_hash',repeat('1',64)))$q$,'Opening prefix exceeds candidate limit');
select pg_temp.capacity_refuse('synthetic_helper_head1001','select 1',
 $q$select controlled_stock_opening_head((select jsonb_agg(jsonb_build_object('id',id,'sequence',n,'record_hash',lpad(n::text,64,'0'))order by n)from capacity_fake_ids),1001)$q$,'Exact opening prefix unavailable');

-- Privileged corruption probes insert intentionally invalid provenance. The
-- complete row-count guard must reject BEFORE canonical history verification.
select pg_temp.capacity_refuse('corrupt1001_actual_corrections_selector0',
 $q$alter table native_dispense_correction_events disable trigger user;insert into native_dispense_correction_events(id,authorization_id,pet_id,dispense_id,sequence,prior_event_id,actor_id,kind,created_at,record_hash,reviewed_context,document)
 select f.id,pg_temp.capacity_id('sign'),pg_temp.capacity_id('pet'),(select id from capacity_dispenses where n=2),f.n,p.id,auth.uid(),'operational_annotation',clock_timestamp(),repeat('0',64),'{}','{}'
 from capacity_fake_ids f left join capacity_fake_ids p on p.n=f.n-1 order by f.n$q$,
 $q$select controlled_stock_opening_native_entry_for_product(pg_temp.capacity_id('product'),'tablet',(select id from capacity_dispenses where n=2),0,0,0,null)$q$,
 'Native history exceeds opening candidate limit; no truncation permitted');
select pg_temp.capacity_refuse('corrupt1001_actual_returns_selector0',
 $q$alter table native_return_events disable trigger user;insert into native_return_events(id,authorization_id,pet_id,dispense_id,sequence,prior_event_id,actor_id,action,intake_id,created_at,record_hash,reviewed_context,document)
 select f.id,pg_temp.capacity_id('sign'),pg_temp.capacity_id('pet'),(select id from capacity_dispenses where n=2),f.n,p.id,auth.uid(),'intake',null,clock_timestamp(),repeat('0',64),'{}','{}'
 from capacity_fake_ids f left join capacity_fake_ids p on p.n=f.n-1 order by f.n$q$,
 $q$select controlled_stock_opening_native_entry_for_product(pg_temp.capacity_id('product'),'tablet',(select id from capacity_dispenses where n=2),0,0,0,null)$q$,
 'Native history exceeds opening candidate limit; no truncation permitted');
select pg_temp.capacity_refuse('corrupt1001_actual_discrepancies_selector0',
 $q$alter table native_return_discrepancy_events disable trigger user;insert into native_return_discrepancy_events(id,authorization_id,pet_id,dispense_id,sequence,prior_event_id,actor_id,case_id,action,created_at,record_hash,reviewed_context,document)
 select f.id,pg_temp.capacity_id('sign'),pg_temp.capacity_id('pet'),(select id from capacity_dispenses where n=2),f.n,p.id,auth.uid(),f.id,'report',clock_timestamp(),repeat('0',64),'{}','{}'
 from capacity_fake_ids f left join capacity_fake_ids p on p.n=f.n-1 order by f.n$q$,
 $q$select controlled_stock_opening_native_entry_for_product(pg_temp.capacity_id('product'),'tablet',(select id from capacity_dispenses where n=2),0,0,0,null)$q$,
 'Native history exceeds opening candidate limit; no truncation permitted');
select controlled_stock_validate_product(pg_temp.capacity_id('product'));
set constraints all immediate;
-- Save the successful phase as a distinct machine-readable observation before
-- rolling back configuration to admit the genuine201st canonical writer.
select jsonb_build_object('kind','controlled-opening-capacity-positive-v1','genuine_dispenses',200,'genuine_max_allocations',1,
 'full_opening_validated',true,'unattached_frozen_only',true,'native_boundary_bytes',(select octet_length(native_custody_boundary::text)from controlled_stock_openings),
 'sql_checks',(select count(*)from capacity_results),'results',(select jsonb_object_agg(label,value)from capacity_results),
 'refusals',(select count(*)from capacity_results where value->>'outcome'='refused'),'outcomes',(select jsonb_agg(jsonb_build_object('label',label)||value order by label)from capacity_results),
 'separate_scenario_not_simultaneous_maxima',true,'genuine1000_event_chains_tested',false,'structural_byte_probes_are_valid_openings',false,'corrupt_event_rows_are_canonical_history',false);
rollback to savepoint capacity_unconfigured;
select pg_temp.capacity_assert(pg_temp.capacity_snapshot()=(select value from capacity_baselines where label='genuine200_before_configuration'),'positive_configuration_exact_four_schema_rollback');
commit;begin;set local timezone='UTC';
set constraints all deferred;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"a5510000-0000-4000-8000-000000000001"}',true);
insert into capacity_dispenses values(201,gen_random_uuid());
select record_native_dispense((select id from capacity_dispenses where n=201),pg_temp.capacity_request(201));
select pg_temp.capacity_assert((select count(*)from native_dispenses)=201,'genuine201st_canonical_writer_succeeded');
set constraints all immediate;commit;begin;set local timezone='UTC';
select jsonb_build_object('kind','controlled-opening-capacity-canonical-baseline-v1','fingerprint',pg_temp.capacity_snapshot(),
 'native_dispenses',(select count(*)from native_dispenses),'genuine_dispenses',201,'canonical_fixture_committed_inside_owned_clone',true);
-- CAPACITY_PRIVATE_CONFIGURATION --
select pg_temp.capacity_build_opening();
select pg_temp.capacity_refuse('genuine201product_dispenses_shortened200boundary','select 1',
 $q$select controlled_stock_validate_opening(pg_temp.capacity_id('engine_opening'))$q$,
 'Product native history exceeds opening candidate limit; no truncation permitted');
select jsonb_build_object('kind','controlled-opening-capacity-observation-v1','genuine_dispenses',201,'retained_boundary_entries',200,
 'complete_product_count_refused_without_truncation',true,'genuine200_positive_phase_preceded_this_result',true,
 'sql_checks',(select count(*)from capacity_results where label in('genuine201st_canonical_writer_succeeded','genuine201product_dispenses_shortened200boundary')),
 'refusals',1,'outcomes',(select jsonb_agg(jsonb_build_object('label',label)||value order by label)from capacity_results where label in('genuine201st_canonical_writer_succeeded','genuine201product_dispenses_shortened200boundary')),
 'separate_scenario_not_simultaneous_maxima',true,'synthetic_only',true,'hosted_writes',0,'clinical_or_register_activation',false,'configuration_transactions_rolled_back',true,
 'canonical_fixture_committed_inside_owned_clone',true,'canonical_fixture_removed_by_owned_clone_cleanup',true);
rollback;
