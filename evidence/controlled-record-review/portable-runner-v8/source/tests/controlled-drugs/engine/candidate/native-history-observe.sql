-- OWNED LOCAL ONLY, after the verified unchanged204 prefix and selected installation lane.
-- Exactly one read-only constructor observation per invocation. Runner verifies
-- all retained original-column row fingerprints before and after EVERY call.
begin;set local timezone='UTC';
select set_config('request.jwt.claims','{}',true);
create temp table native_history_observation_input(payload jsonb not null,case_name text not null,expected_migration_count integer not null);
insert into native_history_observation_input values(:'ids_json'::jsonb,:'case_name',:'expected_migration_count'::integer);
create temp table native_history_observation_result(value jsonb not null);
do $$declare payload jsonb;case_name text;c record;era integer;product uuid;pet uuid;authorization_id uuid;document jsonb;corrections jsonb;reconciliation jsonb;discrepancy_events jsonb;
 projection jsonb;outcome text;failure text;failure_state text;checks integer:=0;allocation_count integer;modern_movements integer;
 pickup_count integer;modern_pickups integer;correction_count integer;modern_corrections integer;open_cases integer;source record;begin
 select i.payload,i.case_name into payload,case_name from native_history_observation_input i;
 if payload->>'kind'is distinct from 'controlled-native-history-seed-v1'or (payload->>'era'is distinct from '187'and payload->>'era'is distinct from '188')
 or case_name not in('187_prepared_native','188_prepared_native','188_clinical_annotation','188_operational_annotation','188_pickup','188_pickup_amendment','188_unresolved_discrepancy')then
 raise exception 'Exact genuine historical seed and named case required';end if;era:=(payload->>'era')::integer;checks:=checks+1;
 if(select count(*)from jsonb_array_elements(payload->'cases')x where x->>'name'=case_name)<>1 then raise exception 'Exactly one seeded observation case required';end if;
 select *into c from jsonb_to_recordset(payload->'cases')as x(name text,dispense_id uuid,return_version integer,correction_version integer,discrepancy_version integer,pickup_id uuid,expected_outcome text,expected_error text)where x.name=case_name;
 if left(c.name,3)is distinct from era::text then raise exception 'Historical case era mismatch';end if;checks:=checks+1;
 if(select expected_migration_count from native_history_observation_input)not in(204,205)
 or(select count(*)from supabase_migrations.schema_migrations)is distinct from(select expected_migration_count from native_history_observation_input)then raise exception 'Observation requires the exact separately verified installation ledger';end if;checks:=checks+1;
 if exists(select 1 from controlled_stock_sites)or exists(select 1 from controlled_stock_policy_versions)or exists(select 1 from controlled_stock_openings)
 or exists(select 1 from controlled_stock_cells)or exists(select 1 from controlled_stock_events)then raise exception 'Historical observation must not invent configuration provenance or physical cells';end if;checks:=checks+1;
 product:=(payload#>>'{ids,product}')::uuid;pet:=(payload#>>'{ids,pet}')::uuid;authorization_id:=(payload#>>'{ids,sign}')::uuid;
 document:=native_fulfillment_verified_dispense(c.dispense_id);
 if document is null or document->>'authorization_id'is distinct from authorization_id::text or document->>'pet_id'is distinct from pet::text
 or document#>>'{reviewed_context,product,id}'is distinct from product::text or(document->>'quantity')::numeric is distinct from 2 then raise exception 'Actual original canonical dispense must remain independently verified';end if;checks:=checks+1;
 corrections:=native_correction_verified(authorization_id,pet,c.dispense_id);reconciliation:=native_reconciliation_verified(authorization_id,pet,c.dispense_id);
 if jsonb_typeof(corrections)is distinct from 'object'or jsonb_typeof(reconciliation)is distinct from 'object'
 or(case when jsonb_typeof(corrections->'events')='array'then jsonb_array_length(corrections->'events')else null end)is distinct from c.correction_version
 or(case when jsonb_typeof(reconciliation->'events')='array'then jsonb_array_length(reconciliation->'events')else null end)is distinct from c.return_version then raise exception 'Original canonical native history must be complete and exact';end if;checks:=checks+1;
 select count(*),count(*)filter(where s.movement_id is not null)into allocation_count,modern_movements
 from native_dispense_allocations a left join stock_movement_sources s on s.movement_id=a.movement_id and s.writer='record_native_dispense'
 and s.source_id=c.dispense_id and s.actor_id=(document->>'actor_id')::uuid where a.dispense_id=c.dispense_id;
 if allocation_count is distinct from 2 or modern_movements is distinct from(case era when 187 then 0 else 2 end) then raise exception 'Actual old-era allocation provenance classification changed';end if;checks:=checks+1;
 if era=188 then
  for source in select movement_id from native_dispense_allocations where dispense_id=c.dispense_id loop perform stock_source_validate_movement(source.movement_id);end loop;
  checks:=checks+1;
 end if;
 select count(*),count(*)filter(where s.event_id is not null)into pickup_count,modern_pickups from native_pickups p left join stock_pickup_sources s on s.event_id=p.id where p.dispense_id=c.dispense_id;
 select count(*),count(*)filter(where s.event_id is not null)into correction_count,modern_corrections from native_dispense_correction_events e left join stock_correction_sources s on s.event_id=e.id where e.dispense_id=c.dispense_id;
 if pickup_count is distinct from(case when c.pickup_id is null then 0 else 1 end)or modern_pickups is distinct from 0 or correction_count is distinct from c.correction_version or modern_corrections is distinct from 0 then
 raise exception '189 migration must not fabricate original handoff or correction provenance';end if;checks:=checks+1;
 open_cases:=(reconciliation#>>'{read,discrepancies,open_case_count}')::integer;
 if c.name='188_unresolved_discrepancy'then
  if open_cases is distinct from 1 or not exists(select 1 from native_return_events e join stock_custody_sources s on s.event_id=e.id and s.actor_id=e.actor_id where e.dispense_id=c.dispense_id)
  or not exists(select 1 from native_return_discrepancy_events e join stock_discrepancy_sources s on s.event_id=e.id and s.actor_id=e.actor_id where e.dispense_id=c.dispense_id)
  or not exists(select 1 from native_dispense_allocations a where a.dispense_id=c.dispense_id and native_reconciliation_lot_held(a.lot_id))then
  raise exception 'Actual188 unresolved hold must retain genuine movement custody and discrepancy provenance';end if;
 else
  if open_cases is distinct from 0 then raise exception 'A simple annotation must not be classified as an actual discrepancy hold';end if;
 end if;checks:=checks+1;
 begin
  projection:=controlled_stock_opening_native_entry_for_product(product,'tablet',c.dispense_id,c.return_version,c.correction_version,c.discrepancy_version,c.pickup_id);
  outcome:='accepted_projection';
 exception when check_violation then
  get stacked diagnostics failure=MESSAGE_TEXT,failure_state=RETURNED_SQLSTATE;outcome:='refused';
 end;
 if outcome is distinct from c.expected_outcome then raise exception 'Historical case % outcome %, expected %',c.name,outcome,c.expected_outcome;end if;
 if outcome='refused'then
  if failure_state is distinct from '23514'or failure is distinct from c.expected_error then raise exception 'Historical case % stopped at unexpected guard: %',c.name,failure;end if;
 else
  select coalesce(jsonb_agg(e.document order by e.sequence),'[]'::jsonb)into discrepancy_events from native_return_discrepancy_events e where e.dispense_id=c.dispense_id;
  if projection->>'dispense_id'is distinct from c.dispense_id::text
  or projection->'correction_head'is distinct from controlled_stock_opening_head(corrections->'events',c.correction_version)
  or projection->'return_head'is distinct from controlled_stock_opening_head(reconciliation->'events',c.return_version)
  or projection->'discrepancy_head'is distinct from controlled_stock_opening_head(discrepancy_events,c.discrepancy_version)
  or projection->'pickup'is distinct from 'null'::jsonb then
   raise exception 'Accepted original native prefix must retain exact independently verified heads and pickup absence';end if;
  if(case when jsonb_typeof(projection->'allocations')='array'then jsonb_array_length(projection->'allocations')else null end)is distinct from 2 then
   raise exception 'Accepted original native prefix requires its exact two allocations';end if;
  if(select count(distinct a->>'allocation_id')from jsonb_array_elements(projection->'allocations')a)is distinct from 2
  or exists(select 1 from jsonb_array_elements(projection->'allocations')value where jsonb_typeof(value)is distinct from 'object'
   or not exists(select 1 from native_dispense_allocations original where original.dispense_id=c.dispense_id
    and original.id::text=value->>'allocation_id'and original.lot_id::text=value->>'lot_id'
    and original.quantity is not distinct from 1
    and value->'dispensed_quantity'is not distinct from to_jsonb(native_fulfillment_decimal(original.quantity))
    and value->'prepared_quantity'is not distinct from to_jsonb(native_fulfillment_decimal(original.quantity)))
   or(case when jsonb_typeof(value->'held')='array'then jsonb_array_length(value->'held')else null end)is distinct from 0)then
   raise exception 'Accepted original native prefix must retain exact unique allocation lot and canonical quantity membership';end if;
 end if;checks:=checks+1;
 if exists(select 1 from controlled_stock_sites)or exists(select 1 from controlled_stock_policy_versions)or exists(select 1 from controlled_stock_openings)
 or exists(select 1 from controlled_stock_cells)or exists(select 1 from controlled_stock_events)then raise exception 'Read-only observation created commissioning evidence';end if;checks:=checks+1;
 insert into native_history_observation_result values(jsonb_build_object('kind','controlled-native-history-observation-v1','era',era,'case_name',c.name,
 'outcome',outcome,'expected_outcome',c.expected_outcome,'sqlstate',failure_state,'error',failure,'sql_checks',checks,
 'canonical_original_native_history_verified',true,'actual_allocation_count',allocation_count,'modern_movement_provenance_count',modern_movements,
 'actual_original_pickup_count',pickup_count,'modern_pickup_provenance_count',modern_pickups,'actual_original_correction_count',correction_count,
 'modern_correction_provenance_count',modern_corrections,'actual_unresolved_discrepancy_count',open_cases,
 'annotation_is_not_a_physical_hold',c.name in('188_clinical_annotation','188_operational_annotation'),
 'pickup_amendment_stopped_at_original_pickup',c.name='188_pickup_amendment'and outcome='refused',
 'entry_projection_only',true,'actual_opening_or_cells_created',false,'provenance_backfilled',false,'projection',projection));
end$$;
select value from native_history_observation_result;
rollback;
