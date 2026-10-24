-- Independent expected membership: fixture IDs and declared finite groups only.
-- No adapter result or current head chooses an expected relation/key/role.
create function pg_temp.a2_group_rows(p_group text,p_id uuid)
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
 select 'public.native_dispenses',jsonb_build_object('id',r.id),to_jsonb(r) from (select * from public.native_dispenses where id=p_id)r where p_group='dispense'
 union all
 select 'public.native_fulfillment_operations',jsonb_build_object('id',r.id),to_jsonb(r) from (select * from public.native_fulfillment_operations where id=p_id)r where p_group='dispense'
 union all
 select 'public.native_pickups',jsonb_build_object('id',r.id),to_jsonb(r) from (select * from public.native_pickups where id=p_id)r where p_group='pickup'
 union all
 select 'public.native_fulfillment_operations',jsonb_build_object('id',r.id),to_jsonb(r) from (select * from public.native_fulfillment_operations where id=p_id)r where p_group='pickup'
 union all
 select 'public.native_dispense_correction_events',jsonb_build_object('id',r.id),to_jsonb(r) from (select * from public.native_dispense_correction_events where id=p_id)r where p_group='annotation'
 union all
 select 'public.native_dispense_correction_operations',jsonb_build_object('id',r.id),to_jsonb(r) from (select * from public.native_dispense_correction_operations where id=p_id)r where p_group='annotation'
 union all
 select 'public.stock_pickup_sources',jsonb_build_object('event_id',r.event_id),to_jsonb(r) from (select * from public.stock_pickup_sources where event_id=p_id)r where p_group='pickup'
 union all
 select 'public.stock_correction_sources',jsonb_build_object('event_id',r.event_id),to_jsonb(r) from (select * from public.stock_correction_sources where event_id=p_id)r where p_group='annotation'
 union all
 select 'public.native_dispense_allocations',jsonb_build_object('id',r.id),to_jsonb(r) from (select * from public.native_dispense_allocations where dispense_id=p_id)r where p_group='dispense'
 union all
 select 'public.billing_invoice_items',jsonb_build_object('id',r.id),to_jsonb(r) from (select i.* from public.billing_invoice_items i join public.native_dispenses d on d.invoice_item_id=i.id where d.id=p_id)r where p_group='dispense'
 union all
 select 'public.controlled_stock_opening_movements',jsonb_build_object('opening_id',r.opening_id,'movement_id',r.movement_id),to_jsonb(r)
 from public.controlled_stock_opening_movements r where p_group='opening_movement' and r.movement_id=p_id
 union all
 select 'public.controlled_stock_cells',jsonb_build_object('id',r.id),to_jsonb(r)
 from public.controlled_stock_cells r join a2_expected_cells f on r.id=pg_temp.a2_id(f.k)
 where p_group='opening_cells' and f.channel='prepared' and pg_temp.a2_id(f.product_label||'.dispense')=p_id
 union all
 select 'public.controlled_stock_containers',jsonb_build_object('id',r.id),to_jsonb(r)
 from public.controlled_stock_containers r join a2_expected_cells f on r.id=pg_temp.a2_id(f.container_key)
 where p_group='opening_cells' and f.channel='prepared' and pg_temp.a2_id(f.product_label||'.dispense')=p_id
$$;
create function pg_temp.a2_expected_packet(p_label text) returns jsonb language plpgsql stable as $$
declare f a2_cases;event_row public.controlled_stock_events;rows jsonb;refs jsonb;expected_count integer;
 target jsonb;adapter jsonb;roles text[]:=array['reviewed_target','correction_target','case_report','ordinary_source','original_intake','original_pickup','amendment_predecessor','original_dispense','resolution_correction','opening_basis','retained_context'];begin
 select * into strict f from a2_cases where label=p_label;
 select * into strict event_row from public.controlled_stock_events where id=pg_temp.a2_id(f.label);
 if event_row.product_id is distinct from pg_temp.a2_id(f.product_label||'.product')
 or event_row.opening_id is distinct from pg_temp.a2_id(f.product_label||'.opening')
 or event_row.policy_version_id is distinct from pg_temp.a2_id(f.product_label||'.policy')
 or event_row.actor_id is distinct from pg_temp.a2_id('actor') or event_row.session_id is distinct from pg_temp.a2_id('session')
 or event_row.sequence is distinct from f.event_sequence or event_row.engine_revision<>1
 or event_row.writer is distinct from(case f.correction_kind when 'pickup' then 'record_native_pickup' else 'append_native_dispense_correction' end)
 or event_row.event_kind is distinct from(case f.correction_kind when 'pickup' then 'record_native_pickup' else 'append_native_dispense_correction:'||f.correction_kind end)
 or event_row.basis is distinct from(case f.correction_kind when 'pickup' then 'physical_record' else 'annotation' end) then
 raise exception 'A2 exact independent target identity differs' using errcode='23514';end if;
 with groups(group_name,source_id,rank)as(
  select 'parent',pg_temp.a2_id(f.label),0
  union all select 'dispense',pg_temp.a2_id(f.product_label||'.dispense'),7
  union all select 'movement',pg_temp.a2_id(f.product_label||'.movement'||n),7 from generate_series(1,2)n
  union all select 'opening_movement',pg_temp.a2_id(f.product_label||'.movement'||n),9 from generate_series(1,2)n
  union all select 'annotation',pg_temp.a2_id(f.label),0 where f.correction_kind<>'pickup'
  union all select 'annotation',pg_temp.a2_id(f.predecessor_key),6 where f.predecessor_key is not null
  union all select 'pickup',pg_temp.a2_id('K_managed_pickup_of_188_package'),case when f.correction_kind='pickup' then 0 else 5 end
   where f.product_label='pickup'
  union all select 'parent',pg_temp.a2_id('K_managed_pickup_of_188_package'),5 where f.correction_kind='pickup_amendment'
  union all select 'opening_cells',pg_temp.a2_id(f.product_label||'.dispense'),9 where f.site_basis='opening_custody_site'
 ), all_rows as(select g.rank,r.*from groups g cross join lateral pg_temp.a2_group_rows(g.group_name,g.source_id)r),
 selected as(select distinct on(relation,key)relation,key,row_value,rank from all_rows order by relation,key,rank)
 select jsonb_agg(jsonb_build_object('relation',relation,'key',key,'row',row_value)order by relation collate "C",key::text collate "C"),
 jsonb_agg(jsonb_build_object('relation',relation,'key',key,'row_hash',public.controlled_stock_hash(row_value),'role',roles[rank+1])order by relation collate "C",key::text collate "C")
 into rows,refs from selected;
 expected_count:=case p_label when 'O_split_same_site' then 30 when 'K_managed_pickup_of_188_package' then 30 when 'K_first_amendment' then 37 when 'K_second_amendment' then 40 else 26 end;
 if rows is null or jsonb_array_length(rows)<>expected_count or jsonb_array_length(refs)<>expected_count then
 raise exception 'A2 independent exact source-row cardinality differs for %',p_label using errcode='23514';end if;
 target:=jsonb_build_object('event_id',event_row.id,'product_id',event_row.product_id,'sequence',event_row.sequence,'record_hash',event_row.record_hash,
 'original_actor_id',event_row.actor_id,'policy_version_id',event_row.policy_version_id,'opening_id',event_row.opening_id,'engine_revision',1);
 adapter:=jsonb_build_object('version',1,'event_kind',event_row.event_kind,'adapter_id',case f.correction_kind when 'pickup' then 'pickup_v1' else 'annotation_v1' end,
 'target',target,'site_basis',f.site_basis,'site_id',pg_temp.a2_id('site'),'source_refs',refs,
 'native_family_dispense_id',case when f.family_key is not null then pg_temp.a2_id(f.family_key) end,'provenance_state','supported','reason',null);
 return jsonb_build_object('adapter',adapter,'source_rows',rows);
end $$;

create function pg_temp.a2_physical_assertions(p_after boolean)returns void language plpgsql as $$
declare f record;actual jsonb;expected jsonb;begin
 if (select count(*)from a2_expected_cells)<>22 or (select count(*)from public.controlled_stock_openings)<>5
 or (select count(*)from public.controlled_stock_containers)<>22 or (select count(*)from public.controlled_stock_cells)<>22
 or (select count(*)from public.controlled_stock_positions)<>22 or (select count(*)from public.controlled_stock_opening_movements)<>20
 or (select count(*)from public.inventory_lots)<>10 or (select count(*)from public.inventory_movements)<>20
 or (select count(*)from public.stock_movement_sources)<>20 or (select count(*)from public.native_dispenses)<>5
 or (select count(*)from public.native_dispense_allocations)<>10 or (select count(*)from public.billing_invoice_items)<>5
 or (select count(*)from public.native_pickups)<>1 or (select count(*)from public.stock_pickup_sources)<>1
 or (select count(*)from public.controlled_stock_events)<>(case when p_after then 9 else 7 end)
 or (select count(*)from public.controlled_stock_source_links)<>(case when p_after then 9 else 7 end)
 or (select count(*)from public.native_dispense_correction_events)<>(case when p_after then 10 else 8 end)
 or (select count(*)from public.stock_correction_sources)<>(case when p_after then 8 else 6 end)
 or (select count(*)from public.controlled_stock_event_lines)<>2 or (select count(*)from public.controlled_stock_container_transitions)<>2 then
 raise exception 'A2 exact positive-core cardinalities differ' using errcode='23514';end if;
 if exists(select 1 from public.native_return_events) or exists(select 1 from public.native_return_discrepancy_events)
 or exists(select 1 from public.stock_custody_sources) or exists(select 1 from public.stock_discrepancy_sources)
 or exists(select 1 from public.controlled_stock_cells where channel='return_held') then
 raise exception 'A2 positive fixture contains undeclared held/return/discrepancy sources' using errcode='23514';end if;
 for f in select *from a2_products order by label collate "C" loop
  if (select native_custody_boundary from public.controlled_stock_openings where id=pg_temp.a2_id(f.label||'.opening'))
   is distinct from(select boundary from a2_expected_boundaries where label=f.label)
  or (select boundary from a2_expected_boundaries where label=f.label) is distinct from jsonb_build_array(pg_temp.a2_expected_boundary(f.label)) then
   raise exception 'A2 retained complete boundary changed after later source' using errcode='23514';end if;
  perform public.controlled_stock_validate_opening(pg_temp.a2_id(f.label||'.opening'));
  perform public.controlled_stock_validate_product(pg_temp.a2_id(f.label||'.product'));
 end loop;
 -- Prove exactly the22 declared cells/container identities and quantities,
 -- including the same-site zero and both distinct half cells. No current site.
 if exists(select 1 from a2_expected_cells expected_cell left join public.controlled_stock_cells c on c.id=pg_temp.a2_id(expected_cell.k)
  left join public.controlled_stock_containers t on t.id=c.container_id left join public.controlled_stock_positions p on p.cell_id=c.id
  where c.id is null or t.id is null or p.cell_id is null or c.container_id<>pg_temp.a2_id(expected_cell.container_key)
  or c.lot_id<>pg_temp.a2_id(expected_cell.product_label||'.lot'||expected_cell.lot_number) or c.channel<>expected_cell.channel
  or c.dispense_id is distinct from(case when expected_cell.channel='prepared' then pg_temp.a2_id(expected_cell.product_label||'.dispense') end)
  or c.allocation_id is distinct from(case when expected_cell.channel='prepared' then pg_temp.a2_id(expected_cell.product_label||'.allocation'||expected_cell.allocation_number) end)
  or c.intake_id is not null or c.created_event_id is not null or c.opening_id<>pg_temp.a2_id(expected_cell.product_label||'.opening') or c.opening_quantity<>expected_cell.quantity
  or t.opening_id<>c.opening_id or t.product_id<>pg_temp.a2_id(expected_cell.product_label||'.product') or t.stock_unit<>'tablet'
  or t.kind<>(case expected_cell.channel when 'available' then 'stock' else 'prepared' end)
  or t.stock_lot_id is distinct from(case when expected_cell.channel='available' then c.lot_id end)
  or t.created_event_id is not null or t.controlling_site_id<>pg_temp.a2_id('site')
  or p.quantity<>(case when expected_cell.product_label='pickup' and expected_cell.channel='prepared' then 0 else expected_cell.quantity end)) then
  raise exception 'A2 full declared cell/container/product/site or effect quantities differ' using errcode='23514';end if;
 -- All exact opening membership snapshots, including original receipts/debits.
 if exists(select 1 from public.controlled_stock_opening_movements o join public.inventory_movements m on m.id=o.movement_id
  where o.source_snapshot is distinct from to_jsonb(m) or o.quantity<>m.quantity or o.lot_id<>m.lot_id)
 or exists(select 1 from public.controlled_stock_source_links where movement_id is not null)
 then raise exception 'A2 original movement membership/zero new stock-charge effects differ' using errcode='23514';end if;
 select jsonb_agg(jsonb_build_object('cell',l.cell_id,'container',line_cell.container_id,'delta',l.quantity_delta,'event',l.event_id)
 order by l.cell_id)into actual from public.controlled_stock_event_lines l join public.controlled_stock_cells line_cell on line_cell.id=l.cell_id;
 select jsonb_agg(jsonb_build_object('cell',pg_temp.a2_id('pickup.preparedcell'||n),'container',pg_temp.a2_id('pickup.prepared'||n),
 'delta',-1.000,'event',pg_temp.a2_id('K_managed_pickup_of_188_package'))order by pg_temp.a2_id('pickup.preparedcell'||n))into expected from generate_series(1,2)n;
 if actual is distinct from expected then raise exception 'A2 independent exact pickup line effects differ' using errcode='23514';end if;
 for f in select *from a2_cases where ordinal<=case when p_after then 8 else 7 end order by ordinal loop
  if exists(select 1 from public.stock_movement_sources where source_id=pg_temp.a2_id(f.label))
  or exists(select 1 from public.billing_invoice_items where id=pg_temp.a2_id(f.label)) then
   raise exception 'A2 target unexpectedly adds movement/charge' using errcode='23514';end if;
  if f.correction_kind<>'pickup' and(exists(select 1 from public.controlled_stock_event_lines where event_id=pg_temp.a2_id(f.label))
   or exists(select 1 from public.controlled_stock_container_transitions where event_id=pg_temp.a2_id(f.label))) then
   raise exception 'A2 annotation unexpectedly changes physical custody' using errcode='23514';end if;
 end loop;
end $$;

create function pg_temp.a2_verify(p_after boolean)returns jsonb language plpgsql as $$
declare f record;v_expected_packet jsonb;v_collected_packet jsonb;v_adapted_packet jsonb;managed jsonb;managed_expected jsonb;proof jsonb:='[]';old_count integer;begin
 perform pg_temp.a2_identity('ordinary');
 if p_after is null then raise exception 'A2 exact before/after inventory required' using errcode='23514';end if;
 old_count:=(select count(*)from a2_before_append);
 if old_count<>(case when p_after then 7 else 0 end) then raise exception 'A2 fixed baseline lifecycle differs' using errcode='23514';end if;
 perform pg_temp.a2_physical_assertions(p_after);
 for f in select *from a2_products order by label collate "C" loop
  managed:=controlled_review_v3.managed_source_event(jsonb_build_object('source_kind','dispense','source_id',pg_temp.a2_id(f.label||'.dispense'),'product_id',pg_temp.a2_id(f.label||'.product')));
  if managed is not null then raise exception 'A2 genuine188 dispense must stay historical' using errcode='23514';end if;
  if f.correction_version=1 and controlled_review_v3.managed_source_event(jsonb_build_object('source_kind','correction','source_id',pg_temp.a2_id(f.label||'.old_correction'),'product_id',pg_temp.a2_id(f.label||'.product'))) is not null then
   raise exception 'A2 retained188 correction must stay historical' using errcode='23514';end if;
 end loop;
 for f in select *from a2_cases where ordinal<=case when p_after then 8 else 7 end order by ordinal loop
  -- Compute full source-based expected value BEFORE either tested entrypoint.
  v_expected_packet:=pg_temp.a2_expected_packet(f.label);
  v_collected_packet:=controlled_review_v3.collect_event_sources(pg_temp.a2_id(f.label));
  v_adapted_packet:=controlled_review_v3.adapt_event(pg_temp.a2_id(f.label));
  if v_collected_packet is distinct from v_expected_packet or v_adapted_packet is distinct from v_expected_packet->'adapter' then
   raise exception 'A2 full independent rows/roles/effect identity differs for %',f.label using errcode='23514';end if;
  select jsonb_build_object('event_id',pg_temp.a2_id(f.label),'source_link_ids',jsonb_agg(id order by id))into managed_expected
   from public.controlled_stock_source_links where event_id=pg_temp.a2_id(f.label);
  managed:=controlled_review_v3.managed_source_event(jsonb_build_object('source_kind',case when f.correction_kind='pickup' then 'pickup' else 'correction' end,
   'source_id',pg_temp.a2_id(f.label),'product_id',pg_temp.a2_id(f.product_label||'.product')));
  if managed is distinct from managed_expected then raise exception 'A2 exact managed classifier identity differs' using errcode='23514';end if;
  if not p_after then insert into a2_before_append values(f.label,v_collected_packet,v_adapted_packet,v_expected_packet);
  elsif f.ordinal<=7 and not exists(select 1 from a2_before_append b where b.label=f.label and b.collected=v_collected_packet and b.adapted=v_adapted_packet and b.expected=v_expected_packet) then
   raise exception 'A2 original seven complete outputs changed after append' using errcode='23514';end if;
  proof:=proof||jsonb_build_array(jsonb_build_object('label',f.label,'collected',v_collected_packet,'adapted',v_adapted_packet,'independent_expected',v_expected_packet,'managed',managed,
   'available','0.000','prepared',case when f.correction_kind='pickup' then '-2.000' else '0.000' end,'return_held','0.000','new_movements',0,'new_charges',0));
 end loop;
 if p_after then
  if not exists(select 1 from public.native_dispense_correction_events c where c.id=pg_temp.a2_id('O_plain_later_clinical_witness')
   and c.dispense_id=pg_temp.a2_id('plain.dispense') and c.kind='clinical_annotation'
   and c.document->>'amends_event_id'=pg_temp.a2_id('O_plain_clinical')::text and c.sequence=3)
  or not exists(select 1 from public.controlled_stock_source_links where event_id=pg_temp.a2_id('O_plain_later_clinical_witness') and correction_event_id=pg_temp.a2_id('O_plain_later_clinical_witness')) then
   raise exception 'A2 genuine later clinical stability witness missing' using errcode='23514';end if;
 end if;
 return jsonb_build_object('kind','a2-positive-core-values-v1','after_append',p_after,'target_cases',jsonb_array_length(proof),'cases',proof,
 'original_seven_stable',p_after,'synthetic_only',true,'remaining_negative_limit_restore_proven',false,'clinical_activation',false);
end $$;
