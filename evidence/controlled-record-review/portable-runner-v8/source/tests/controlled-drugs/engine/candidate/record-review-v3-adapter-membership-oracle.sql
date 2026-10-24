-- Synthetic local oracle, after adapter fixtures in the SAME connection.
-- Fixture identities and finite source groups are independent of adapter output.
-- No call to an adapter helper is permitted in expected-row construction.
begin;
set local timezone='UTC';
create temp table review_v3_expected_groups(label text not null,group_name text not null,source_id uuid not null,role_rank integer not null);
insert into review_v3_expected_groups select label,'parent',pg_temp.eid(event_key),0 from review_v3_fixture_cases;
insert into review_v3_expected_groups select label,'movement',pg_temp.eid(event_key),0 from review_v3_fixture_cases
 where label in('receive','adjust_negative','adjust_positive','treatment','anesthesia');
insert into review_v3_expected_groups select label,'clinical',pg_temp.eid(event_key),0 from review_v3_fixture_cases
 where label in('treatment','anesthesia');
insert into review_v3_expected_groups select label,'anesthesia',pg_temp.eid(event_key),0 from review_v3_fixture_cases where label='anesthesia';
-- The genuine recipe uses dispense A for pickup/annotations, B for all returns
-- and discrepancies. These are fixture-intent labels, not source output inference.
insert into review_v3_expected_groups select label,'dispense',pg_temp.eid(case
 when label in('dispense_a','pickup','clinical_annotation','operational_annotation','pickup_amendment','clinical_amended','pickup_amended')then 'dispense'else 'dispense2'end),
 case when label in('dispense_a','dispense_b')then 0 else 7 end from review_v3_fixture_cases
 where label not in('receive','adjust_negative','adjust_positive','treatment','anesthesia');
insert into review_v3_expected_groups select label,'pickup',pg_temp.eid('engine_pickup'),case when label='pickup'then 0 else 5 end
 from review_v3_fixture_cases where label in('pickup','pickup_amendment','pickup_amended');
insert into review_v3_expected_groups select label,'return',pg_temp.eid(event_key),0 from review_v3_fixture_cases where label in(
 'intake_v1','dispose_v1','restock_v1','intake_v2','dispose_v2','restock_v2',
 'retract_intake_v1','retract_disposal_v1','retract_restock_v1','retract_intake_v2','retract_disposal_v2','retract_restock_v2');
insert into review_v3_expected_groups select label,'return',pg_temp.eid(k),rank from(values
 ('retract_intake_v1','engine_intake1',1),('retract_disposal_v1','engine_dispose1',1),('retract_restock_v1','engine_restock1',1),
 ('retract_intake_v2','engine_intake2',1),('retract_disposal_v2','engine_dispose2',1),('retract_restock_v2','engine_restock2',1),
 ('report_v1','engine_dispose1',3),('note_v1','engine_dispose1',3),('confirm_v1','engine_dispose1',3),('corrected_v1','engine_dispose1',3),
 ('report_v2','engine_dispose2',3),('note_v2','engine_dispose2',3),('confirm_v2','engine_dispose2',3),('corrected_v2','engine_dispose2',3),
 ('corrected_v1','review_correct_v1_first',8),('corrected_v1','review_correct_v1_second',8),('corrected_v2','engine_case_retract',8),
 ('corrected_v1','engine_dispose1',1),('corrected_v2','engine_dispose2',1))v(label,k,rank);
-- Exact immediate intake membership is independently selected from immutable
-- return rows, with no recursive history walk or current-head query.
insert into review_v3_expected_groups select g.label,'return',r.intake_id,4
 from review_v3_expected_groups g join public.native_return_events r on r.id=g.source_id
 where g.group_name='return'and r.intake_id is not null;
insert into review_v3_expected_groups select label,'discrepancy',pg_temp.eid(event_key),0 from review_v3_fixture_cases
 where label in('report_v1','note_v1','confirm_v1','corrected_v1','report_v2','note_v2','confirm_v2','corrected_v2');
insert into review_v3_expected_groups select label,'discrepancy',pg_temp.eid(k),2 from(values
 ('note_v1','review_report_v1_confirm'),('confirm_v1','review_report_v1_confirm'),('corrected_v1','review_report_v1_correct'),
 ('note_v2','engine_report1'),('confirm_v2','engine_report1'),('corrected_v2','engine_report2'))v(label,k);
insert into review_v3_expected_groups select label,'annotation',pg_temp.eid(event_key),0 from review_v3_fixture_cases
 where label in('clinical_annotation','operational_annotation','pickup_amendment','clinical_amended','pickup_amended');
insert into review_v3_expected_groups select label,'annotation',pg_temp.eid(k),6 from(values
 ('clinical_amended','engine_annotation'),('pickup_amended','engine_amendment'))v(label,k);
-- Only these declared managed dependency groups retain parent/physical evidence.
insert into review_v3_expected_groups select label,'parent',source_id,role_rank from review_v3_expected_groups
 where group_name in('dispense','pickup')or(group_name='return'and role_rank in(0,1,3));
insert into review_v3_expected_groups select g.label,'movement',a.movement_id,g.role_rank
 from review_v3_expected_groups g join public.native_dispense_allocations a on a.dispense_id=g.source_id where g.group_name='dispense';
insert into review_v3_expected_groups select g.label,'movement',s.movement_id,g.role_rank
 from review_v3_expected_groups g join public.native_return_stock_links s on s.event_id=g.source_id where g.group_name='return';
insert into review_v3_expected_groups select g.label,'movement',s.movement_id,g.role_rank
 from review_v3_expected_groups g join public.native_return_compensation_links s on s.event_id=g.source_id where g.group_name='return';

create function pg_temp.review_v3_expected_group_rows(p_group text,p_id uuid)
 returns table(relation text,key jsonb,row_value jsonb)language sql stable as $$
 select 'public.controlled_stock_events',jsonb_build_object('id',r.id),to_jsonb(r) from (select * from public.controlled_stock_events where id=p_id)r where p_group='parent'
 union all
 select 'public.controlled_stock_actions',jsonb_build_object('id',r.id),to_jsonb(r) from (select * from public.controlled_stock_actions where id=p_id)r where p_group='parent'
 union all
 select 'public.controlled_stock_preparations',jsonb_build_object('id',r.id),to_jsonb(r) from (select * from public.controlled_stock_preparations where id=p_id)r where p_group='parent'
 union all
 select 'public.controlled_stock_policy_versions',jsonb_build_object('id',r.id),to_jsonb(r) from (select x.* from public.controlled_stock_policy_versions x join public.controlled_stock_events e on e.policy_version_id=x.id where e.id=p_id)r where p_group='parent'
 union all
 select 'public.controlled_stock_openings',jsonb_build_object('id',r.id),to_jsonb(r) from (select x.* from public.controlled_stock_openings x join public.controlled_stock_events e on e.opening_id=x.id where e.id=p_id)r where p_group='parent'
 union all
 select 'public.controlled_stock_source_links',jsonb_build_object('id',r.id),to_jsonb(r) from (select * from public.controlled_stock_source_links where event_id=p_id)r where p_group='parent'
 union all
 select 'public.controlled_stock_event_lines',jsonb_build_object('id',r.id),to_jsonb(r) from (select * from public.controlled_stock_event_lines where event_id=p_id)r where p_group='parent'
 union all
 select 'public.controlled_stock_container_transitions',jsonb_build_object('id',r.id),to_jsonb(r) from (select * from public.controlled_stock_container_transitions where event_id=p_id)r where p_group='parent'
 union all
 select 'public.controlled_stock_cells',jsonb_build_object('id',r.id),to_jsonb(r) from (select c.* from public.controlled_stock_cells c where c.id in(select cell_id from public.controlled_stock_event_lines where event_id=p_id))r where p_group='parent'
 union all
 select 'public.controlled_stock_containers',jsonb_build_object('id',r.id),to_jsonb(r) from (select c.* from public.controlled_stock_containers c where c.id in(select container_id from public.controlled_stock_container_transitions where event_id=p_id union select s.container_id from public.controlled_stock_cells s join public.controlled_stock_event_lines l on l.cell_id=s.id where l.event_id=p_id))r where p_group='parent'
 union all
 select 'public.inventory_movements',jsonb_build_object('id',r.id),to_jsonb(r) from (select * from public.inventory_movements where id=p_id)r where p_group='movement'
 union all
 select 'public.stock_movement_sources',jsonb_build_object('movement_id',r.movement_id),to_jsonb(r) from (select * from public.stock_movement_sources where movement_id=p_id)r where p_group='movement'
 union all
 select 'public.inventory_lots',jsonb_build_object('id',r.id),to_jsonb(r) from (select l.* from public.inventory_lots l join public.inventory_movements m on m.lot_id=l.id where m.id=p_id)r where p_group='movement'
 union all
 select 'public.patient_treatments',jsonb_build_object('id',r.id),to_jsonb(r) from (select * from public.patient_treatments where id=p_id)r where p_group='clinical'
 union all
 select 'public.billing_invoice_items',jsonb_build_object('id',r.id),to_jsonb(r) from (select * from public.billing_invoice_items where id=p_id)r where p_group='clinical'
 union all
 select 'public.treatment_alert_reviews',jsonb_build_object('id',r.id),to_jsonb(r) from (select * from public.treatment_alert_reviews where treatment_id=p_id)r where p_group='clinical'
 union all
 select 'public.anesthesia_drug_administrations',jsonb_build_object('id',r.id),to_jsonb(r) from (select * from public.anesthesia_drug_administrations where id=p_id)r where p_group='anesthesia'
 union all
 select 'public.native_dispenses',jsonb_build_object('id',r.id),to_jsonb(r) from (select * from public.native_dispenses where id=p_id)r where p_group='dispense'
 union all
 select 'public.native_fulfillment_operations',jsonb_build_object('id',r.id),to_jsonb(r) from (select * from public.native_fulfillment_operations where id=p_id)r where p_group='dispense'
 union all
 select 'public.native_pickups',jsonb_build_object('id',r.id),to_jsonb(r) from (select * from public.native_pickups where id=p_id)r where p_group='pickup'
 union all
 select 'public.native_fulfillment_operations',jsonb_build_object('id',r.id),to_jsonb(r) from (select * from public.native_fulfillment_operations where id=p_id)r where p_group='pickup'
 union all
 select 'public.native_return_events',jsonb_build_object('id',r.id),to_jsonb(r) from (select * from public.native_return_events where id=p_id)r where p_group='return'
 union all
 select 'public.native_return_operations',jsonb_build_object('id',r.id),to_jsonb(r) from (select * from public.native_return_operations where id=p_id)r where p_group='return'
 union all
 select 'public.native_return_discrepancy_events',jsonb_build_object('id',r.id),to_jsonb(r) from (select * from public.native_return_discrepancy_events where id=p_id)r where p_group='discrepancy'
 union all
 select 'public.native_return_discrepancy_operations',jsonb_build_object('id',r.id),to_jsonb(r) from (select * from public.native_return_discrepancy_operations where id=p_id)r where p_group='discrepancy'
 union all
 select 'public.native_dispense_correction_events',jsonb_build_object('id',r.id),to_jsonb(r) from (select * from public.native_dispense_correction_events where id=p_id)r where p_group='annotation'
 union all
 select 'public.native_dispense_correction_operations',jsonb_build_object('id',r.id),to_jsonb(r) from (select * from public.native_dispense_correction_operations where id=p_id)r where p_group='annotation'
 union all
 select 'public.stock_pickup_sources',jsonb_build_object('event_id',r.event_id),to_jsonb(r) from (select * from public.stock_pickup_sources where event_id=p_id)r where p_group='pickup'
 union all
 select 'public.stock_custody_sources',jsonb_build_object('event_id',r.event_id),to_jsonb(r) from (select * from public.stock_custody_sources where event_id=p_id)r where p_group='return'
 union all
 select 'public.stock_discrepancy_sources',jsonb_build_object('event_id',r.event_id),to_jsonb(r) from (select * from public.stock_discrepancy_sources where event_id=p_id)r where p_group='discrepancy'
 union all
 select 'public.stock_correction_sources',jsonb_build_object('event_id',r.event_id),to_jsonb(r) from (select * from public.stock_correction_sources where event_id=p_id)r where p_group='annotation'
 union all
 select 'public.native_dispense_allocations',jsonb_build_object('id',r.id),to_jsonb(r) from (select * from public.native_dispense_allocations where dispense_id=p_id)r where p_group='dispense'
 union all
 select 'public.billing_invoice_items',jsonb_build_object('id',r.id),to_jsonb(r) from (select i.* from public.billing_invoice_items i join public.native_dispenses d on d.invoice_item_id=i.id where d.id=p_id)r where p_group='dispense'
 union all
 select 'public.native_return_stock_links',jsonb_build_object('id',r.id),to_jsonb(r) from (select * from public.native_return_stock_links where event_id=p_id)r where p_group='return'
 union all
 select 'public.native_return_compensation_links',jsonb_build_object('id',r.id),to_jsonb(r) from (select * from public.native_return_compensation_links where event_id=p_id)r where p_group='return'
 union all
 select 'public.native_return_discrepancy_correction_links',jsonb_build_object('id',r.id),to_jsonb(r) from (select * from public.native_return_discrepancy_correction_links where resolution_id=p_id)r where p_group='discrepancy'
$$;

create temp table review_v3_expected_rows as
 select distinct on(g.label,r.relation,r.key)g.label,r.relation,r.key,r.row_value,g.role_rank
 from review_v3_expected_groups g cross join lateral pg_temp.review_v3_expected_group_rows(g.group_name,g.source_id)r
 order by g.label,r.relation,r.key,g.role_rank;
create temp table review_v3_membership_proof(label text primary key,row_count integer not null,refs_hash text not null);
do $$declare f record;expected_rows jsonb;expected_refs jsonb;actual jsonb;
 roles text[]:=array['reviewed_target','correction_target','case_report','ordinary_source','original_intake',
 'original_pickup','amendment_predecessor','original_dispense','resolution_correction','opening_basis','retained_context'];
begin
 for f in select * from review_v3_fixture_cases order by label loop
  select jsonb_agg(jsonb_build_object('relation',relation,'key',key,'row',row_value)
   order by relation collate "C",key::text collate "C"),
   jsonb_agg(jsonb_build_object('relation',relation,'key',key,'row_hash',public.controlled_stock_hash(row_value),'role',roles[role_rank+1])
   order by relation collate "C",key::text collate "C")into expected_rows,expected_refs
   from review_v3_expected_rows where label=f.label;
  if expected_rows is null or jsonb_array_length(expected_rows)not between 1 and 512 then
   raise exception 'A1 independent membership fixture is empty or exceeds acceptance bound';end if;
  actual:=controlled_review_v3.collect_event_sources(pg_temp.eid(f.event_key));
  if actual->'source_rows'is distinct from expected_rows or actual#>'{adapter,source_refs}'is distinct from expected_refs then
   raise exception 'A1 exact independently selected source rows/roles/hashes differ for %',f.label;end if;
  insert into review_v3_membership_proof values(f.label,jsonb_array_length(expected_rows),public.controlled_stock_hash(expected_refs));
 end loop;
end $$;
select jsonb_build_object('synthetic_only',true,'membership_cases',(select count(*)from review_v3_membership_proof),
 'cases',(select jsonb_agg(to_jsonb(p)order by p.label)from review_v3_membership_proof p));
commit;
