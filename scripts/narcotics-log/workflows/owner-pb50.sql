-- Owner-only finite fixture capture; NOT current count-entry authority.
begin isolation level repeatable read read only;
set local quote_all_identifiers=false;
set local search_path=pg_catalog,pg_temp;
set local client_encoding='UTF8';
set local timezone='UTC';
set local datestyle='ISO,YMD';
set local intervalstyle='postgres';
set local extra_float_digits=3;
set local standard_conforming_strings=on;
set local statement_timeout='30s';
set local lock_timeout='5s';
do $owner_capture_lock$ begin perform pg_catalog.pg_advisory_xact_lock(90271040,0);end $owner_capture_lock$;
lock table public.anesthesia_drug_administrations,public.billing_invoice_items,public.catalog_products,public.controlled_draft_entries,public.controlled_draft_versions,public.controlled_stock_actions,public.controlled_stock_cancellations,public.controlled_stock_cells,public.controlled_stock_container_heads,public.controlled_stock_container_transitions,public.controlled_stock_containers,public.controlled_stock_event_lines,public.controlled_stock_events,public.controlled_stock_locations,public.controlled_stock_opening_movements,public.controlled_stock_openings,public.controlled_stock_policy_sites,public.controlled_stock_policy_versions,public.controlled_stock_positions,public.controlled_stock_preparations,public.controlled_stock_sites,public.controlled_stock_source_links,public.controlled_stock_state_events,public.controlled_stock_states,public.inventory_lots,public.inventory_movements,public.native_dispense_allocations,public.native_dispense_correction_events,public.native_dispense_correction_operations,public.native_dispenses,public.native_fulfillment_operations,public.native_pickups,public.native_prescription_authorizations,public.native_refill_events,public.native_return_compensation_links,public.native_return_discrepancy_correction_links,public.native_return_discrepancy_events,public.native_return_discrepancy_operations,public.native_return_events,public.native_return_operations,public.native_return_policy_decisions,public.native_return_policy_state,public.native_return_stock_links,public.patient_treatments,public.stock_correction_sources,public.stock_custody_sources,public.stock_discrepancy_sources,public.stock_movement_sources,public.stock_pickup_sources,controlled_stock_workflow_v1.witness_operations in access share mode;
do $owner_capture$
<<owner_capture_data>>
declare capture_product_id uuid:='__OWNER_CAPTURE_PRODUCT_UUID__'::uuid;capture_site_id uuid:='__OWNER_CAPTURE_SITE_UUID__'::uuid;
 capture_row record;capture_boundary jsonb:='{}';capture_array jsonb;capture_value jsonb;
 capture_total_bytes bigint:=2;capture_row_bytes bigint;capture_add_bytes bigint;capture_class_rows bigint;
begin
 capture_total_bytes:=capture_total_bytes+13;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.actor_id, r.writer, r.session_id, r.request_hash, r.receipt, r.recorded_at FROM public.controlled_stock_actions AS r INNER JOIN public.controlled_stock_events AS e ON e.id = r.id WHERE e.product_id = owner_capture_data.capture_product_id ORDER BY r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('actions',capture_array);
 capture_total_bytes:=capture_total_bytes+39;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.record_id, r.pet_id, r.request, r.created_by, r.created_at FROM public.anesthesia_drug_administrations AS r WHERE r.id IN (SELECT s.source_id FROM public.stock_movement_sources AS s INNER JOIN public.inventory_movements AS m ON m.id = s.movement_id INNER JOIN public.inventory_lots AS l ON l.id = m.lot_id WHERE l.product_id = owner_capture_data.capture_product_id AND s.writer = 'record_anesthesia_drug_administration') ORDER BY r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('anesthesia_drug_administrations',capture_array);
 capture_total_bytes:=capture_total_bytes+29;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.invoice_id, r.pet_id, r.product_id, r.description, r.quantity, r.unit_price_cents, r.amount_cents, r.created_by, r.created_at FROM public.billing_invoice_items AS r WHERE r.id IN (SELECT d.invoice_item_id FROM public.native_dispenses AS d WHERE d.id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = owner_capture_data.capture_product_id) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = owner_capture_data.capture_product_id)) ORDER BY r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('billing_invoice_items',capture_array);
 capture_total_bytes:=capture_total_bytes+13;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.container_id, r.lot_id, r.channel, r.dispense_id, r.allocation_id, r.intake_id, r.opening_id, r.created_event_id, r.opening_quantity FROM public.controlled_stock_cells AS r INNER JOIN public.controlled_stock_containers AS c ON c.id = r.container_id WHERE c.product_id = owner_capture_data.capture_product_id ORDER BY r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('cells',capture_array);
 capture_total_bytes:=capture_total_bytes+18;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.product_id, r.stock_unit, r.label, r.kind, r.stock_lot_id, r.controlling_site_id, r.initial_location_id, r.initial_custodian_id, r.opening_id, r.created_event_id, r.actor_id, r.session_id, r.recorded_at FROM public.controlled_stock_containers AS r WHERE r.product_id = owner_capture_data.capture_product_id ORDER BY r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('containers',capture_array);
 capture_total_bytes:=capture_total_bytes+29;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.event_id, r.actor_id FROM public.stock_correction_sources AS r WHERE r.event_id IN (SELECT e.id FROM public.native_dispense_correction_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = owner_capture_data.capture_product_id) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = owner_capture_data.capture_product_id)) ORDER BY r.event_id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('correction_provenance',capture_array);
 capture_total_bytes:=capture_total_bytes+26;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.event_id, r.writer, r.actor_id FROM public.stock_custody_sources AS r WHERE r.event_id IN (SELECT e.id FROM public.native_return_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = owner_capture_data.capture_product_id) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = owner_capture_data.capture_product_id)) ORDER BY r.event_id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('custody_provenance',capture_array);
 capture_total_bytes:=capture_total_bytes+30;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.event_id, r.actor_id FROM public.stock_discrepancy_sources AS r WHERE r.event_id IN (SELECT e.id FROM public.native_return_discrepancy_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = owner_capture_data.capture_product_id) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = owner_capture_data.capture_product_id)) ORDER BY r.event_id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('discrepancy_provenance',capture_array);
 capture_total_bytes:=capture_total_bytes+21;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.product_id, r.state, r.head_id, r.created_by, r.created_at FROM public.controlled_draft_entries AS r WHERE r.product_id = owner_capture_data.capture_product_id ORDER BY r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('draft_entries',capture_array);
 capture_total_bytes:=capture_total_bytes+22;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.entry_id, r.version, r.definition, r.product_snapshot, r.action_id, r.actor_id, r.session_id, r.actor_name, r.created_at FROM public.controlled_draft_versions AS r WHERE r.entry_id IN (SELECT e.id FROM public.controlled_draft_entries AS e WHERE e.product_id = owner_capture_data.capture_product_id) ORDER BY r.entry_id, r.version, r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('draft_versions',capture_array);
 capture_total_bytes:=capture_total_bytes+14;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.product_id, r.sequence, r.prior_event_id, r.policy_version_id, r.opening_id, r.engine_revision, r.writer, r.event_kind, r.actor_id, r.session_id, r.actor_name, r.basis, r.observed_at, r.recorded_at, r.note, r.context_hash, r.canonical_result, r.source_bundle, r.source_effects, r.clinical_snapshot, r.secondary_review_required, r.prior_record_hash, r.record_hash FROM public.controlled_stock_events AS r WHERE r.product_id = owner_capture_data.capture_product_id ORDER BY r.sequence, r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('events',capture_array);
 capture_total_bytes:=capture_total_bytes+13;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.container_id, r.version, r.location_id, r.custodian_id, r.status, r.last_event_id FROM public.controlled_stock_container_heads AS r INNER JOIN public.controlled_stock_containers AS c ON c.id = r.container_id WHERE c.product_id = owner_capture_data.capture_product_id ORDER BY r.container_id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('heads',capture_array);
 capture_total_bytes:=capture_total_bytes+13;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.event_id, r.cell_id, r.source_link_id, r.quantity_delta, r.container_version_before, r.container_version_after FROM public.controlled_stock_event_lines AS r INNER JOIN public.controlled_stock_events AS e ON e.id = r.event_id WHERE e.product_id = owner_capture_data.capture_product_id ORDER BY r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('lines',capture_array);
 capture_total_bytes:=capture_total_bytes+17;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.site_id, r.kind, r.label, r.initial_custodian_id, r.actor_id, r.session_id, r.recorded_at FROM public.controlled_stock_locations AS r WHERE r.site_id = owner_capture_data.capture_site_id OR r.id IN (((SELECT c.initial_location_id AS id FROM public.controlled_stock_containers AS c WHERE c.product_id = owner_capture_data.capture_product_id UNION SELECT h.location_id FROM public.controlled_stock_container_heads AS h INNER JOIN public.controlled_stock_containers AS c ON c.id = h.container_id WHERE c.product_id = owner_capture_data.capture_product_id) UNION SELECT t.before_location_id FROM public.controlled_stock_container_transitions AS t INNER JOIN public.controlled_stock_containers AS c ON c.id = t.container_id WHERE c.product_id = owner_capture_data.capture_product_id) UNION SELECT t.after_location_id FROM public.controlled_stock_container_transitions AS t INNER JOIN public.controlled_stock_containers AS c ON c.id = t.container_id WHERE c.product_id = owner_capture_data.capture_product_id) ORDER BY r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('locations',capture_array);
 capture_total_bytes:=capture_total_bytes+12;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.product_id, r.lot_number, r.expires_on, r.location, r.created_by, r.created_at FROM public.inventory_lots AS r WHERE r.product_id = owner_capture_data.capture_product_id ORDER BY r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('lots',capture_array);
 capture_total_bytes:=capture_total_bytes+27;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.movement_id, r.writer, r.source_id, r.actor_id FROM public.stock_movement_sources AS r INNER JOIN public.inventory_movements AS m ON m.id = r.movement_id INNER JOIN public.inventory_lots AS l ON l.id = m.lot_id WHERE l.product_id = owner_capture_data.capture_product_id ORDER BY r.movement_id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('movement_provenance',capture_array);
 capture_total_bytes:=capture_total_bytes+17;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.lot_id, r.quantity, r.kind, r.reason, r.created_by, r.created_at FROM public.inventory_movements AS r INNER JOIN public.inventory_lots AS l ON l.id = r.lot_id WHERE l.product_id = owner_capture_data.capture_product_id ORDER BY r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('movements',capture_array);
 capture_total_bytes:=capture_total_bytes+26;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.dispense_id, r.lot_id, r.movement_id, r.quantity FROM public.native_dispense_allocations AS r WHERE r.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = owner_capture_data.capture_product_id) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = owner_capture_data.capture_product_id) ORDER BY r.dispense_id, r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('native_allocations',capture_array);
 capture_total_bytes:=capture_total_bytes+33;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.event_id, r.target_event_id, r.allocation_id, r.lot_id, r.original_movement_id, r.movement_id, r.quantity FROM public.native_return_compensation_links AS r WHERE r.event_id IN (SELECT e.id FROM public.native_return_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = owner_capture_data.capture_product_id) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = owner_capture_data.capture_product_id)) OR r.target_event_id IN (SELECT e.id FROM public.native_return_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = owner_capture_data.capture_product_id) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = owner_capture_data.capture_product_id)) OR r.lot_id IN (SELECT l.id FROM public.inventory_lots AS l WHERE l.product_id = owner_capture_data.capture_product_id) ORDER BY r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('native_compensation_links',capture_array);
 capture_total_bytes:=capture_total_bytes+32;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.authorization_id, r.pet_id, r.dispense_id, r.sequence, r.prior_event_id, r.actor_id, r.kind, r.created_at, r.record_hash, r.reviewed_context, r.document FROM public.native_dispense_correction_events AS r WHERE r.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = owner_capture_data.capture_product_id) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = owner_capture_data.capture_product_id) ORDER BY r.dispense_id, r.sequence, r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('native_correction_events',capture_array);
 capture_total_bytes:=capture_total_bytes+36;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.actor_id, r.request, r.request_hash, r.result, r.created_at FROM public.native_dispense_correction_operations AS r WHERE r.id IN (SELECT e.id FROM public.native_dispense_correction_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = owner_capture_data.capture_product_id) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = owner_capture_data.capture_product_id)) ORDER BY r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('native_correction_operations',capture_array);
 capture_total_bytes:=capture_total_bytes+33;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.authorization_id, r.pet_id, r.dispense_id, r.sequence, r.prior_event_id, r.actor_id, r.case_id, r.action, r.created_at, r.record_hash, r.reviewed_context, r.document FROM public.native_return_discrepancy_events AS r WHERE r.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = owner_capture_data.capture_product_id) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = owner_capture_data.capture_product_id) ORDER BY r.dispense_id, r.sequence, r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('native_discrepancy_events',capture_array);
 capture_total_bytes:=capture_total_bytes+32;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.case_id, r.correction_id, r.resolution_id FROM public.native_return_discrepancy_correction_links AS r WHERE r.case_id IN (SELECT e.id FROM public.native_return_discrepancy_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = owner_capture_data.capture_product_id) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = owner_capture_data.capture_product_id)) OR r.resolution_id IN (SELECT e.id FROM public.native_return_discrepancy_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = owner_capture_data.capture_product_id) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = owner_capture_data.capture_product_id)) OR r.correction_id IN (SELECT e.id FROM public.native_return_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = owner_capture_data.capture_product_id) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = owner_capture_data.capture_product_id)) ORDER BY r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('native_discrepancy_links',capture_array);
 capture_total_bytes:=capture_total_bytes+37;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.actor_id, r.request, r.request_hash, r.result, r.created_at FROM public.native_return_discrepancy_operations AS r WHERE r.id IN (SELECT e.id FROM public.native_return_discrepancy_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = owner_capture_data.capture_product_id) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = owner_capture_data.capture_product_id)) ORDER BY r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('native_discrepancy_operations',capture_array);
 capture_total_bytes:=capture_total_bytes+24;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.authorization_id, r.pet_id, r.slot_id, r.invoice_id, r.invoice_item_id, r.quantity, r.actor_id, r.dispensed_at, r.document FROM public.native_dispenses AS r WHERE r.id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = owner_capture_data.capture_product_id) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = owner_capture_data.capture_product_id) ORDER BY r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('native_dispenses',capture_array);
 capture_total_bytes:=capture_total_bytes+37;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.actor_id, r.operation, r.request, r.request_hash, r.result, r.created_at FROM public.native_fulfillment_operations AS r WHERE r.id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = owner_capture_data.capture_product_id) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = owner_capture_data.capture_product_id) OR r.id IN (SELECT e.id FROM public.native_pickups AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = owner_capture_data.capture_product_id) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = owner_capture_data.capture_product_id)) ORDER BY r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('native_fulfillment_operations',capture_array);
 capture_total_bytes:=capture_total_bytes+22;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.authorization_id, r.pet_id, r.dispense_id, r.actor_id, r.picked_up_at, r.document FROM public.native_pickups AS r WHERE r.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = owner_capture_data.capture_product_id) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = owner_capture_data.capture_product_id) ORDER BY r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('native_pickups',capture_array);
 capture_total_bytes:=capture_total_bytes+42;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.pet_id, r.client_id, r.draft_id, r.document FROM public.native_prescription_authorizations AS r WHERE r.id IN (SELECT d.authorization_id FROM public.native_dispenses AS d WHERE d.id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = owner_capture_data.capture_product_id) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = owner_capture_data.capture_product_id)) ORDER BY r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('native_prescription_authorizations',capture_array);
 capture_total_bytes:=capture_total_bytes+28;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.refill_id, r.revision, r.action, r.actor_id, r.reason, r.prior_event_id, r.before_snapshot, r.after_snapshot, r.link_context, r.created_at, r.fulfillment_reference FROM public.native_refill_events AS r WHERE r.refill_id IN (SELECT CAST(docs.document ->> 'refill_id' AS uuid) FROM (SELECT d.document FROM public.native_dispenses AS d WHERE d.id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = owner_capture_data.capture_product_id) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = owner_capture_data.capture_product_id) UNION ALL SELECT p.document FROM public.native_pickups AS p WHERE p.id IN (SELECT p.id FROM public.native_pickups AS p WHERE p.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = owner_capture_data.capture_product_id) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = owner_capture_data.capture_product_id))) AS docs WHERE (docs.document -> 'refill_id') IS DISTINCT FROM CAST('null' AS jsonb) UNION SELECT e.refill_id FROM public.native_refill_events AS e WHERE e.id IN (SELECT CAST(docs.document ->> 'refill_event_id' AS uuid) FROM (SELECT d.document FROM public.native_dispenses AS d WHERE d.id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = owner_capture_data.capture_product_id) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = owner_capture_data.capture_product_id) UNION ALL SELECT p.document FROM public.native_pickups AS p WHERE p.id IN (SELECT p.id FROM public.native_pickups AS p WHERE p.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = owner_capture_data.capture_product_id) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = owner_capture_data.capture_product_id))) AS docs WHERE (docs.document -> 'refill_event_id') IS DISTINCT FROM CAST('null' AS jsonb))) ORDER BY r.refill_id, r.revision, r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('native_refill_events',capture_array);
 capture_total_bytes:=capture_total_bytes+28;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.authorization_id, r.pet_id, r.dispense_id, r.sequence, r.prior_event_id, r.actor_id, r.action, r.intake_id, r.created_at, r.record_hash, r.reviewed_context, r.document FROM public.native_return_events AS r WHERE r.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = owner_capture_data.capture_product_id) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = owner_capture_data.capture_product_id) ORDER BY r.dispense_id, r.sequence, r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('native_return_events',capture_array);
 capture_total_bytes:=capture_total_bytes+32;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.actor_id, r.request, r.request_hash, r.result, r.created_at FROM public.native_return_operations AS r WHERE r.id IN (SELECT e.id FROM public.native_return_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = owner_capture_data.capture_product_id) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = owner_capture_data.capture_product_id)) ORDER BY r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('native_return_operations',capture_array);
 capture_total_bytes:=capture_total_bytes+38;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.version, r.actor_id, r.request, r.request_hash, r.document, r.created_at FROM public.native_return_policy_decisions AS r WHERE TRUE ORDER BY r.version, r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('native_return_policy_decisions',capture_array);
 capture_total_bytes:=capture_total_bytes+34;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.version, r.decision_id FROM public.native_return_policy_state AS r WHERE TRUE ORDER BY r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('native_return_policy_state',capture_array);
 capture_total_bytes:=capture_total_bytes+33;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.event_id, r.allocation_id, r.lot_id, r.movement_id, r.quantity FROM public.native_return_stock_links AS r WHERE r.event_id IN (SELECT e.id FROM public.native_return_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = owner_capture_data.capture_product_id) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = owner_capture_data.capture_product_id)) OR r.lot_id IN (SELECT l.id FROM public.inventory_lots AS l WHERE l.product_id = owner_capture_data.capture_product_id) ORDER BY r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('native_return_stock_links',capture_array);
 capture_total_bytes:=capture_total_bytes+15;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.product_id, r.policy_version_id, r.observed_at, r.count_evidence, r.native_custody_boundary, r.actor_id, r.session_id, r.recorded_at FROM public.controlled_stock_openings AS r WHERE r.product_id = owner_capture_data.capture_product_id ORDER BY r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('opening',capture_array);
 capture_total_bytes:=capture_total_bytes+25;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.opening_id, r.movement_id, r.lot_id, r.quantity, r.source_snapshot FROM public.controlled_stock_opening_movements AS r INNER JOIN public.controlled_stock_openings AS o ON o.id = r.opening_id WHERE o.product_id = owner_capture_data.capture_product_id ORDER BY r.opening_id, r.movement_id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('opening_movements',capture_array);
 capture_total_bytes:=capture_total_bytes+26;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.pet_id, r.product_id, r.lot_id, r.invoice_id, r.kind, r.historical, r.product_name, r.manufacturer, r.lot_number, r.expires_on, r.quantity, r.dose, r.route, r.site, r.veterinarian, r.veterinarian_license, r.administered_at, r.next_due_on, r.source, r.request, r.created_by, r.created_at FROM public.patient_treatments AS r WHERE r.id IN (SELECT s.source_id FROM public.stock_movement_sources AS s INNER JOIN public.inventory_movements AS m ON m.id = s.movement_id INNER JOIN public.inventory_lots AS l ON l.id = m.lot_id WHERE l.product_id = owner_capture_data.capture_product_id AND s.writer IN ('record_patient_treatment', 'record_anesthesia_drug_administration')) ORDER BY r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('patient_treatments',capture_array);
 capture_total_bytes:=capture_total_bytes+25;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.event_id, r.actor_id FROM public.stock_pickup_sources AS r WHERE r.event_id IN (SELECT e.id FROM public.native_pickups AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = owner_capture_data.capture_product_id) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = owner_capture_data.capture_product_id)) ORDER BY r.event_id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('pickup_provenance',capture_array);
 capture_total_bytes:=capture_total_bytes+17;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.cell_id, r.quantity FROM public.controlled_stock_positions AS r INNER JOIN public.controlled_stock_cells AS cell ON cell.id = r.cell_id INNER JOIN public.controlled_stock_containers AS c ON c.id = cell.container_id WHERE c.product_id = owner_capture_data.capture_product_id ORDER BY r.cell_id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('positions',capture_array);
 capture_total_bytes:=capture_total_bytes+20;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.writer, r.actor_id, r.session_id, r.product_id, r.policy_version_id, r.state_head_id, r.opening_id, r.canonical_arguments, r.context, r.frozen, r.request_hash, r.created_at, r.expires_at FROM public.controlled_stock_preparations AS r INNER JOIN public.controlled_stock_events AS e ON e.id = r.id WHERE e.product_id = owner_capture_data.capture_product_id ORDER BY r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('preparations',capture_array);
 capture_total_bytes:=capture_total_bytes+15;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.name, r.kind, r.manufacturer, r.unit, r.unit_price_cents, r.active, r.version, r.created_by, r.created_at FROM public.catalog_products AS r WHERE r.id = owner_capture_data.capture_product_id ORDER BY r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('product',capture_array);
 capture_total_bytes:=capture_total_bytes+13;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.label, r.registration_evidence, r.actor_id, r.session_id, r.recorded_at FROM public.controlled_stock_sites AS r WHERE r.id = owner_capture_data.capture_site_id OR EXISTS (SELECT 1 FROM public.controlled_stock_policy_sites AS ps INNER JOIN public.controlled_stock_policy_versions AS pv ON pv.id = ps.policy_version_id WHERE pv.product_id = owner_capture_data.capture_product_id AND ps.site_id = r.id) OR EXISTS (SELECT 1 FROM public.controlled_stock_containers AS c WHERE c.product_id = owner_capture_data.capture_product_id AND c.controlling_site_id = r.id) OR EXISTS (SELECT 1 FROM public.controlled_stock_locations AS l WHERE l.site_id = r.id AND l.id IN (((SELECT c.initial_location_id AS id FROM public.controlled_stock_containers AS c WHERE c.product_id = owner_capture_data.capture_product_id UNION SELECT h.location_id FROM public.controlled_stock_container_heads AS h INNER JOIN public.controlled_stock_containers AS c ON c.id = h.container_id WHERE c.product_id = owner_capture_data.capture_product_id) UNION SELECT t.before_location_id FROM public.controlled_stock_container_transitions AS t INNER JOIN public.controlled_stock_containers AS c ON c.id = t.container_id WHERE c.product_id = owner_capture_data.capture_product_id) UNION SELECT t.after_location_id FROM public.controlled_stock_container_transitions AS t INNER JOIN public.controlled_stock_containers AS c ON c.id = t.container_id WHERE c.product_id = owner_capture_data.capture_product_id)) ORDER BY r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('sites',capture_array);
 capture_total_bytes:=capture_total_bytes+20;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.event_id, r.movement_id, r.return_event_id, r.discrepancy_event_id, r.pickup_id, r.correction_event_id FROM public.controlled_stock_source_links AS r INNER JOIN public.controlled_stock_events AS e ON e.id = r.event_id WHERE e.product_id = owner_capture_data.capture_product_id ORDER BY r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('source_links',capture_array);
 capture_total_bytes:=capture_total_bytes+13;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.product_id, r.head_id, r.event_version, r.last_event_id FROM public.controlled_stock_states AS r WHERE r.product_id = owner_capture_data.capture_product_id ORDER BY r.product_id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('state',capture_array);
 capture_total_bytes:=capture_total_bytes+20;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.product_id, r.version, r.prior_event_id, r.state, r.policy_version_id, r.opening_id, r.actor_id, r.session_id, r.reason, r.recorded_at FROM public.controlled_stock_state_events AS r WHERE r.product_id = owner_capture_data.capture_product_id ORDER BY r.version, r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('state_events',capture_array);
 capture_total_bytes:=capture_total_bytes+27;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.actor_id, r.writer, r.session_id, r.recorded_at FROM public.controlled_stock_cancellations AS r WHERE r.id IN (SELECT e.id FROM public.controlled_stock_events AS e WHERE e.product_id = owner_capture_data.capture_product_id) ORDER BY r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('stock_cancellations',capture_array);
 capture_total_bytes:=capture_total_bytes+22;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.product_id, r.version, r.draft_version_id, r.engine_revision, r.stock_unit, r.identity_snapshot, r.permissions, r.clinic_retained_return_permitted, r.review_reference, r.actor_id, r.session_id, r.recorded_at FROM public.controlled_stock_policy_versions AS r WHERE r.product_id = owner_capture_data.capture_product_id ORDER BY r.version, r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('stock_policies',capture_array);
 capture_total_bytes:=capture_total_bytes+26;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.policy_version_id, r.site_id FROM public.controlled_stock_policy_sites AS r INNER JOIN public.controlled_stock_policy_versions AS p ON p.id = r.policy_version_id WHERE p.product_id = owner_capture_data.capture_product_id ORDER BY r.policy_version_id, r.site_id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('stock_policy_sites',capture_array);
 capture_total_bytes:=capture_total_bytes+19;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in SELECT r.id, r.event_id, r.container_id, r.version_before, r.version_after, r.before_location_id, r.before_custodian_id, r.before_status, r.after_location_id, r.after_custodian_id, r.after_status FROM public.controlled_stock_container_transitions AS r INNER JOIN public.controlled_stock_containers AS c ON c.id = r.container_id WHERE c.product_id = owner_capture_data.capture_product_id ORDER BY r.container_id, r.version_after, r.id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('transitions',capture_array);

 capture_total_bytes:=capture_total_bytes+26;
 if capture_total_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
 capture_array:='[]'::jsonb;capture_class_rows:=0;
 for capture_row in select w.*from controlled_stock_workflow_v1.witness_operations w
 join public.controlled_stock_events e on e.id=w.parent_action_id
 where e.product_id=owner_capture_data.capture_product_id and w.stage='saved'
 order by w.parent_action_id,w.operation_id loop
  capture_value:=to_jsonb(capture_row);capture_row_bytes:=octet_length(capture_value::text);
  capture_add_bytes:=capture_row_bytes+case when capture_class_rows>0 then 2 else 0 end;
  if capture_row_bytes>4194304 or capture_total_bytes+capture_add_bytes>16777216 then raise exception 'owner_capture_capacity_exceeded'using errcode='P0001';end if;
  capture_total_bytes:=capture_total_bytes+capture_add_bytes;
  capture_array:=capture_array||jsonb_build_array(capture_value);capture_class_rows:=capture_class_rows+1;
 end loop;
 capture_boundary:=capture_boundary||jsonb_build_object('witness_operations',capture_array);
 if octet_length(capture_boundary::text)<>capture_total_bytes or capture_total_bytes>16777216
 or(select count(*)from jsonb_object_keys(capture_boundary))<>50 then
  raise exception 'owner_capture_size_or_class_mismatch'using errcode='P0001';end if;
 -- Transaction-local raw data carrier only: no JWT, role, nonce, permission,
 -- freshness or count-authority assertion is encoded by this setting.
 perform set_config('lrv_component_probe.captured_data',capture_boundary::text,true);
end $owner_capture$;
select current_setting('lrv_component_probe.captured_data');
rollback;
