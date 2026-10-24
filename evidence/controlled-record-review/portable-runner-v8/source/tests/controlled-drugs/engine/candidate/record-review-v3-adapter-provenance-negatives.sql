-- SYNTHETIC OWNED LOCAL ONLY. Source-only until separately integrated/reviewed.
-- Requires the genuine A1 fixtures in the SAME connection. Every mutation is
-- rolled back in a subtransaction; no event, hash, seal or expectation is repaired.
begin;
set local plpgsql.variable_conflict='error';
create temp table review_v3_provenance_faults(
 label text primary key, source_kind text not null, source_key text not null,
 mutation text not null, changed_rows integer not null check(changed_rows>0)
);
insert into review_v3_provenance_faults values
 ('return_v1_actor','return','engine_intake1',
  $$update public.stock_custody_sources set actor_id='a5510000-0000-4000-8000-000000000099' where event_id=pg_temp.eid('engine_intake1')$$,1),
 ('return_v2_actor','return','engine_intake2',
  $$update public.stock_custody_sources set actor_id='a5510000-0000-4000-8000-000000000099' where event_id=pg_temp.eid('engine_intake2')$$,1),
 ('pickup_actor','pickup','engine_pickup',
  $$update public.stock_pickup_sources set actor_id='a5510000-0000-4000-8000-000000000099' where event_id=pg_temp.eid('engine_pickup')$$,1),
 ('discrepancy_actor','discrepancy','engine_report1',
  $$update public.stock_discrepancy_sources set actor_id='a5510000-0000-4000-8000-000000000099' where event_id=pg_temp.eid('engine_report1')$$,1),
 ('correction_actor','correction','engine_annotation',
  $$update public.stock_correction_sources set actor_id='a5510000-0000-4000-8000-000000000099' where event_id=pg_temp.eid('engine_annotation')$$,1),
 ('return_v1_wrong_writer','return','engine_intake1',
  $$update public.stock_custody_sources set writer='record_native_dispense_return_v2' where event_id=pg_temp.eid('engine_intake1')$$,1),
 ('return_v2_wrong_writer','return','engine_intake2',
  $$update public.stock_custody_sources set writer='record_native_dispense_return' where event_id=pg_temp.eid('engine_intake2')$$,1),
 ('return_missing','return','engine_intake1',
  $$delete from public.stock_custody_sources where event_id=pg_temp.eid('engine_intake1')$$,1),
 ('pickup_missing','pickup','engine_pickup',
  $$delete from public.stock_pickup_sources where event_id=pg_temp.eid('engine_pickup')$$,1),
 ('discrepancy_missing','discrepancy','engine_report1',
  $$delete from public.stock_discrepancy_sources where event_id=pg_temp.eid('engine_report1')$$,1),
 ('correction_missing','correction','engine_annotation',
  $$delete from public.stock_correction_sources where event_id=pg_temp.eid('engine_annotation')$$,1),
 ('restock_movement_actor','return','engine_restock1',
  $$update public.stock_movement_sources set actor_id='a5510000-0000-4000-8000-000000000099' where movement_id=(select movement_id from public.native_return_stock_links where event_id=pg_temp.eid('engine_restock1') order by movement_id limit 1)$$,1),
 ('restock_movement_root','return','engine_restock1',
  $$update public.stock_movement_sources set source_id=pg_temp.eid('engine_restock2') where movement_id=(select movement_id from public.native_return_stock_links where event_id=pg_temp.eid('engine_restock1') order by movement_id limit 1)$$,1),
 ('restock_movement_writer','return','engine_restock1',
  $$update public.stock_movement_sources set writer='record_native_dispense_return_v2' where movement_id=(select movement_id from public.native_return_stock_links where event_id=pg_temp.eid('engine_restock1') order by movement_id limit 1)$$,1),
 ('restock_movement_partial','return','engine_restock1',
  $$delete from public.stock_movement_sources where movement_id=(select movement_id from public.native_return_stock_links where event_id=pg_temp.eid('engine_restock1') order by movement_id limit 1)$$,1),
 ('restock_movement_absent','return','engine_restock1',
  $$delete from public.stock_movement_sources where movement_id in(select movement_id from public.native_return_stock_links where event_id=pg_temp.eid('engine_restock1'))$$,2),
 ('compensation_movement_partial','return','engine_retract_restock1',
  $$delete from public.stock_movement_sources where movement_id=(select movement_id from public.native_return_compensation_links where event_id=pg_temp.eid('engine_retract_restock1') order by movement_id limit 1)$$,1),
 ('compensation_movement_absent','return','engine_retract_restock1',
  $$delete from public.stock_movement_sources where movement_id in(select movement_id from public.native_return_compensation_links where event_id=pg_temp.eid('engine_retract_restock1'))$$,2),
 ('dispense_movement_partial','dispense','dispense',
  $$delete from public.stock_movement_sources where movement_id=(select movement_id from public.native_dispense_allocations where dispense_id=pg_temp.eid('dispense') order by movement_id limit 1)$$,1),
 ('dispense_movement_absent','dispense','dispense',
  $$delete from public.stock_movement_sources where movement_id in(select movement_id from public.native_dispense_allocations where dispense_id=pg_temp.eid('dispense'))$$,2),
 ('dispense_parent_links_partial','dispense','dispense',
  $$delete from public.controlled_stock_source_links where movement_id=(select movement_id from public.native_dispense_allocations where dispense_id=pg_temp.eid('dispense') order by movement_id limit 1)$$,1),
 ('dispense_parent_links_absent','dispense','dispense',
  $$delete from public.controlled_stock_source_links where movement_id in(select movement_id from public.native_dispense_allocations where dispense_id=pg_temp.eid('dispense'))$$,2);

create temp table review_v3_provenance_refusals(
 label text not null, entrypoint text not null, refusal_message text not null,
 primary key(label,entrypoint)
);
do $proof$
declare fault record; selected_entrypoint text; changed integer; refused boolean; message text;
 request jsonb; parent_result jsonb; retained_setting text:=current_setting('session_replication_role');
begin
 if retained_setting<>'origin' then raise exception 'Fault proof requires ordinary trigger mode';end if;
 if(select count(*)from review_v3_provenance_faults)<>22 then raise exception 'Fault inventory differs';end if;
 for fault in select * from review_v3_provenance_faults order by label collate "C" loop
  request:=jsonb_build_object('source_kind',fault.source_kind,'source_id',pg_temp.eid(fault.source_key),'product_id',pg_temp.eid('product'));
  -- Prove the untouched fixture is accepted first. A pre-existing refusal must
  -- not make the deliberately corrupted case appear successful.
  parent_result:=controlled_review_v3.managed_source_event(request);
  if parent_result->>'event_id' is distinct from pg_temp.eid(fault.source_key)::text then
   raise exception 'Fault baseline is not the declared managed event: %',fault.label;end if;
  perform controlled_review_v3.collect_event_sources(pg_temp.eid(fault.source_key));
  foreach selected_entrypoint in array array['classifier','collector'] loop
   refused:=false;message:=null;
   begin
    -- The enclosing subtransaction restores both trigger mode and all mutated
    -- rows. Mutation errors occur OUTSIDE the accepted refusal handler.
    perform set_config('session_replication_role','replica',true);
    execute fault.mutation;
    get diagnostics changed=row_count;
    if changed<>fault.changed_rows then raise exception 'Fault changed unexpected row count: %',fault.label;end if;
    perform set_config('session_replication_role','origin',true);
    begin
     if selected_entrypoint='classifier' then perform controlled_review_v3.managed_source_event(request);
     else perform controlled_review_v3.collect_event_sources(pg_temp.eid(fault.source_key));end if;
    exception when check_violation then
     refused:=true;get stacked diagnostics message=message_text;
    end;
    if not refused then raise exception 'Adapter accepted corrupted provenance: %/%',fault.label,selected_entrypoint;end if;
    raise exception 'Rollback the deliberate fault' using errcode='ZX001';
   exception when sqlstate 'ZX001' then null;
   end;
   if current_setting('session_replication_role')<>retained_setting then raise exception 'Trigger mode was not restored';end if;
   if controlled_review_v3.managed_source_event(request)is distinct from parent_result then
    raise exception 'Fault rollback changed the managed source';end if;
   perform controlled_review_v3.collect_event_sources(pg_temp.eid(fault.source_key));
   insert into review_v3_provenance_refusals values(fault.label,selected_entrypoint,message);
  end loop;
 end loop;
 if(select count(*)from review_v3_provenance_refusals)<>44 then raise exception 'Refusal matrix incomplete';end if;
end $proof$;
-- Full permanent row/catalog/seal preservation must also be checked by the
-- integrating runner against its pre-fault snapshot. This summary is narrower.
select jsonb_build_object('managed_provenance_negative_cases',22,'entrypoint_refusals',44,
 'all_mutations_rolled_back',true,'historical_A2',false,'full_corruption_matrix',false);
select jsonb_build_object('managed_provenance_refusal_receipts',
 (select jsonb_agg(to_jsonb(r)order by r.label collate "C",r.entrypoint collate "C")from review_v3_provenance_refusals r));
commit;
