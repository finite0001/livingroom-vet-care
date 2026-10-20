-- SYNTHETIC OWNED LOCAL ONLY. The caller supplies seeded_preamble and the
-- reviewed private frozen-configuration prefix before BUILD. A separate marked
-- clone is committed/dumped/restored by the helper; no source runtime changes.
-- Neither section owns COMMIT/ROLLBACK. No canonical writer, replay, direct
-- history mutation, trigger disable or clinical/register activation occurs here.

-- CORRECTION_RESTORE_BUILD_BEGIN --
-- Source snapshots were captured in UTC. Scope this setting to the temporary
-- comparison function; opening/product validation retains the caller's zone.
create function pg_temp.correction_restore_source_matches()returns boolean
language plpgsql stable set timezone='UTC' as $$begin
 return pg_temp.correction_capacity_source()=(select seed->'source_baseline'from correction_capacity_meta);
end$$;
do $$declare o public.controlled_stock_openings;head jsonb;projected jsonb;audit_before jsonb;audit_after jsonb;begin
 select coalesce(jsonb_agg(to_jsonb(a)order by a.backend_pid),'[]')into audit_before from stock_writer_admissions a;
 perform pg_temp.correction_capacity_build_opening(1000);
 select * into o from controlled_stock_openings where product_id=pg_temp.correction_capacity_id('product');
 if (select count(*)from controlled_stock_openings)<>1 or o.id is null then
  raise exception 'Exactly one populated correction opening required';end if;
 if pg_temp.correction_capacity_verified(1000)is distinct from true
  or pg_temp.correction_restore_source_matches()is distinct from true then
  raise exception 'Restored exact canonical chain, receipts, quantities and billing required';end if;
 select jsonb_build_object('event_id',id,'version',sequence,'record_hash',record_hash)into head
 from native_dispense_correction_events where dispense_id=pg_temp.correction_capacity_id('dispense')and sequence=1000;
 projected:=controlled_stock_opening_native_entry_for_product(pg_temp.correction_capacity_id('product'),'tablet',pg_temp.correction_capacity_id('dispense'),0,1000,0,null);
 if head is null or o.native_custody_boundary#>'{0,correction_head}'is distinct from head
  or o.native_custody_boundary is distinct from jsonb_build_array(projected)then
  raise exception 'Exact persisted 1000th head and complete custody boundary required';end if;
 if (select count(*)from native_dispenses)<>1 or(select count(*)from native_dispense_allocations)<>1
  or(select quantity from native_dispenses where id=pg_temp.correction_capacity_id('dispense'))is distinct from 0.125::numeric
  or(select quantity from native_dispense_allocations where dispense_id=pg_temp.correction_capacity_id('dispense'))is distinct from 0.125::numeric
  or(select count(*)from controlled_stock_cells where channel='prepared')<>1
  or not exists(select 1 from controlled_stock_cells c join native_dispense_allocations a on a.id=c.allocation_id
    and a.dispense_id=c.dispense_id and a.lot_id=c.lot_id
    where c.opening_id=o.id and c.channel='prepared'and c.opening_quantity=0.125 and c.opening_quantity=a.quantity)
  then raise exception 'Exact single prepared allocation quantity required';end if;
 if exists(select 1 from native_return_events)or exists(select 1 from native_return_discrepancy_events)
  or exists(select 1 from native_pickups)then raise exception 'Independent correction family only';end if;
 if (select count(*)from controlled_stock_state_events)<>1
  or not exists(select 1 from controlled_stock_state_events e join controlled_stock_states s on s.head_id=e.id and s.product_id=e.product_id
    where e.product_id=o.product_id and e.state='opening_frozen'and e.opening_id is null)
  or exists(select 1 from controlled_stock_state_events where state='active')
  or exists(select 1 from controlled_stock_events)or exists(select 1 from controlled_stock_source_links)then
  raise exception 'Only one frozen unattached opening with no controlled events or activation required';end if;
 perform controlled_stock_validate_opening(o.id);
 perform controlled_stock_validate_product(o.product_id);
 set constraints all immediate;
 select coalesce(jsonb_agg(to_jsonb(a)order by a.backend_pid),'[]')into audit_after from stock_writer_admissions a;
 if audit_after is distinct from audit_before then raise exception 'Validation must preserve every admission audit row exactly';end if;
end$$;
-- CORRECTION_RESTORE_BUILD_END --

-- CORRECTION_RESTORE_VALIDATE_BEGIN --
-- Each validation backend receives a fresh seeded_preamble first. Optional
-- session retirement belongs to the helper's enclosing rollback transaction,
-- before this section. Retained session IDs are evidence, never caller authority.
-- CORRECTION_RESTORE_TIMEZONE --
-- Source snapshots were captured in UTC. Scope this setting to the temporary
-- comparison function; opening/product validation retains the caller's zone.
create function pg_temp.correction_restore_source_matches()returns boolean
language plpgsql stable set timezone='UTC' as $$begin
 return pg_temp.correction_capacity_source()=(select seed->'source_baseline'from correction_capacity_meta);
end$$;
create temp table correction_restore_observation(value jsonb not null);
do $$declare o public.controlled_stock_openings;head jsonb;projected jsonb;audit_before jsonb;audit_after jsonb;begin
 perform set_config('request.jwt.claims','{}',true);
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claim.role','',true);
 if auth.uid()is not null or current_setting('request.jwt.claims',true)is distinct from '{}'then
  raise exception 'Restored validation must not rely on caller authentication';end if;
 select coalesce(jsonb_agg(to_jsonb(a)order by a.backend_pid),'[]')into audit_before from stock_writer_admissions a;
 select * into o from controlled_stock_openings where product_id=pg_temp.correction_capacity_id('product');
 if (select count(*)from controlled_stock_openings)<>1 or o.id is null then
  raise exception 'Exactly one populated correction opening required';end if;
 if pg_temp.correction_capacity_verified(1000)is distinct from true
  or pg_temp.correction_restore_source_matches()is distinct from true then
  raise exception 'Restored exact canonical chain, receipts, quantities and billing required';end if;
 select jsonb_build_object('event_id',id,'version',sequence,'record_hash',record_hash)into head
 from native_dispense_correction_events where dispense_id=pg_temp.correction_capacity_id('dispense')and sequence=1000;
 projected:=controlled_stock_opening_native_entry_for_product(pg_temp.correction_capacity_id('product'),'tablet',pg_temp.correction_capacity_id('dispense'),0,1000,0,null);
 if head is null or o.native_custody_boundary#>'{0,correction_head}'is distinct from head
  or o.native_custody_boundary is distinct from jsonb_build_array(projected)then
  raise exception 'Exact persisted 1000th head and complete custody boundary required';end if;
 if (select count(*)from native_dispenses)<>1 or(select count(*)from native_dispense_allocations)<>1
  or(select quantity from native_dispenses where id=pg_temp.correction_capacity_id('dispense'))is distinct from 0.125::numeric
  or(select quantity from native_dispense_allocations where dispense_id=pg_temp.correction_capacity_id('dispense'))is distinct from 0.125::numeric
  or(select count(*)from controlled_stock_cells where channel='prepared')<>1
  or not exists(select 1 from controlled_stock_cells c join native_dispense_allocations a on a.id=c.allocation_id
    and a.dispense_id=c.dispense_id and a.lot_id=c.lot_id
    where c.opening_id=o.id and c.channel='prepared'and c.opening_quantity=0.125 and c.opening_quantity=a.quantity)
  then raise exception 'Exact single prepared allocation quantity required';end if;
 if exists(select 1 from native_return_events)or exists(select 1 from native_return_discrepancy_events)
  or exists(select 1 from native_pickups)then raise exception 'Independent correction family only';end if;
 if (select count(*)from controlled_stock_state_events)<>1
  or not exists(select 1 from controlled_stock_state_events e join controlled_stock_states s on s.head_id=e.id and s.product_id=e.product_id
    where e.product_id=o.product_id and e.state='opening_frozen'and e.opening_id is null)
  or exists(select 1 from controlled_stock_state_events where state='active')
  or exists(select 1 from controlled_stock_events)or exists(select 1 from controlled_stock_source_links)then
  raise exception 'Only one frozen unattached opening with no controlled events or activation required';end if;
 perform controlled_stock_validate_opening(o.id);
 perform controlled_stock_validate_product(o.product_id);
 set constraints all immediate;
 select coalesce(jsonb_agg(to_jsonb(a)order by a.backend_pid),'[]')into audit_after from stock_writer_admissions a;
 if audit_after is distinct from audit_before then raise exception 'Validation must preserve every admission audit row exactly';end if;
 insert into correction_restore_observation values(jsonb_build_object(
  'kind','controlled-correction-history-restored-validation-v1',
  'canonical_corrections',(select count(*)from native_dispense_correction_events),
  'canonical_operations',(select count(*)from native_dispense_correction_operations),
  'native_dispenses',(select count(*)from native_dispenses),'native_allocations',(select count(*)from native_dispense_allocations),
  'retained_correction_version',(o.native_custody_boundary#>>'{0,correction_head,version}')::integer,
  'prepared_quantity','0.125','valid_unattached_openings',(select count(*)from controlled_stock_openings),
  'frozen_states',(select count(*)from controlled_stock_state_events where state='opening_frozen'),
  'active_states',(select count(*)from controlled_stock_state_events where state='active'),
  'controlled_events',(select count(*)from controlled_stock_events),
  'validation_timezone',current_setting('TimeZone'),'retained_auth_sessions',(select count(*)from auth.sessions),
  'opening_actor_session_present',exists(select 1 from auth.sessions where id=o.session_id and user_id=o.actor_id),
  'caller_claims_cleared',true,'canonical_chain_and_receipts_verified',true,'exact_stored_head_and_boundary',true,
  'native_quantities_and_billing_unchanged',true,'opening_and_product_validated',true,
  'all_deferred_constraints_validated',true,'no_other_lifecycle_families',true,'audit_rows_unchanged_during_validation',true));
end$$;
select value from correction_restore_observation;
-- CORRECTION_RESTORE_VALIDATE_END --
