CREATE FUNCTION narcotics_register_v1.csv_cell(p_value text) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT '"'||replace(''''||coalesce(p_value,''),'"','""')||'"'
$$;
CREATE FUNCTION narcotics_register_v1.quantity_at(p_cell uuid,p_at timestamptz) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT (CASE WHEN o.recorded_at<p_at THEN c.opening_quantity ELSE 0 END+
 coalesce((SELECT sum(l.quantity_delta) FROM public.controlled_stock_event_lines l
 JOIN public.controlled_stock_events e ON e.id=l.event_id WHERE l.cell_id=c.id AND e.recorded_at<p_at),0))::numeric(20,3)::text
 FROM public.controlled_stock_cells c LEFT JOIN public.controlled_stock_openings o ON o.id=c.opening_id WHERE c.id=p_cell
$$;
CREATE FUNCTION narcotics_register_v1.csv_row(p_values text[]) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT string_agg(narcotics_register_v1.csv_cell(value),',' ORDER BY ordinality)||E'\r\n' FROM unnest(p_values)WITH ORDINALITY AS cells(value,ordinality)
$$;
CREATE FUNCTION narcotics_register_v1.csv(p_dataset jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE result text:='"Report","Schedule","Medication","Site","Record type","Event","Sequence","Kind","Actor","Observed UTC","Recorded UTC","Period from UTC","Period to UTC","Cell","Channel","Opening quantity","Delta","Running quantity","Closing quantity","Stock unit","Note"'||E'\r\n';
 event_value jsonb;line_value jsonb;line_values jsonb;cell_value jsonb;form_value jsonb;opening_value jsonb;prefix text[];
BEGIN
 prefix:=ARRAY[p_dataset->>'report_id',p_dataset->>'schedule',p_dataset->>'product_name',p_dataset->>'site_label'];
 -- Opening-only periods still carry every cell's opening and closing balance.
 FOR cell_value IN SELECT value FROM jsonb_array_elements(p_dataset->'cells') LOOP
  result:=result||narcotics_register_v1.csv_row(prefix||ARRAY['Cell balances',NULL,NULL,NULL,NULL,NULL,NULL,p_dataset#>>'{request,from_at}',p_dataset#>>'{request,to_at}',cell_value->>'cell_id',cell_value->>'channel',cell_value->>'opening_quantity',NULL,NULL,cell_value->>'closing_quantity',p_dataset->>'stock_unit',NULL]);
  opening_value:=cell_value->'period_opening_entry';
  IF opening_value<>'null'::jsonb THEN
   result:=result||narcotics_register_v1.csv_row(prefix||ARRAY['Register opening',opening_value->>'opening_id',NULL,'opening',NULL,opening_value->>'observed_at',opening_value->>'recorded_at',p_dataset#>>'{request,from_at}',p_dataset#>>'{request,to_at}',cell_value->>'cell_id',cell_value->>'channel',cell_value->>'opening_quantity',opening_value->>'quantity',opening_value->>'quantity',cell_value->>'closing_quantity',p_dataset->>'stock_unit','Original register opening; existing stock, not a new receipt']);
  END IF;
 END LOOP;
 FOR event_value IN SELECT value FROM jsonb_array_elements(p_dataset->'events') LOOP
  line_values:=event_value->'lines';
  IF jsonb_array_length(line_values)=0 THEN line_values:='[null]'::jsonb;END IF;
  FOR line_value IN SELECT value FROM jsonb_array_elements(line_values) LOOP
   SELECT value INTO cell_value FROM jsonb_array_elements(p_dataset->'cells') WHERE value->>'cell_id'=line_value->>'cell_id';
   result:=result||narcotics_register_v1.csv_row(prefix||ARRAY['Movement',event_value->>'event_id',event_value->>'sequence',event_value->>'event_kind',event_value->>'actor_name',event_value->>'observed_at',event_value->>'recorded_at',p_dataset#>>'{request,from_at}',p_dataset#>>'{request,to_at}',line_value->>'cell_id',line_value->>'channel',cell_value->>'opening_quantity',line_value->>'quantity_delta',line_value->>'running_quantity',cell_value->>'closing_quantity',p_dataset->>'stock_unit',event_value->>'note']);
   IF octet_length(result)>4194304 THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
  END LOOP;
 END LOOP;
 FOR form_value IN SELECT value FROM jsonb_array_elements(p_dataset->'supporting_forms') LOOP
  result:=result||narcotics_register_v1.csv_row(prefix||ARRAY['Supporting form',form_value->>'form_id',NULL,form_value->>'kind',NULL,NULL,form_value->>'recorded_at',p_dataset#>>'{request,from_at}',p_dataset#>>'{request,to_at}',NULL,NULL,NULL,NULL,NULL,NULL,NULL,(form_value->>'title')||' | '||(form_value->>'filename')||' | SHA256 '||(form_value->>'sha256')]);
 END LOOP;
 IF octet_length(result)>4194304 THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
 RETURN result;
END $$;
CREATE FUNCTION narcotics_register_v1.event_authority(p_actor uuid,p_product uuid,p_site uuid,p_event uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE event_value public.controlled_stock_events;candidate jsonb;
BEGIN
 SELECT * INTO STRICT event_value FROM public.controlled_stock_events e WHERE e.id=p_event AND e.product_id=p_product;
 candidate:=controlled_review_v3.read_site_candidate(event_value.id);
 IF candidate->>'site_id' IS DISTINCT FROM p_site::text THEN RAISE EXCEPTION 'narcotics_scope_unproven' USING ERRCODE='PT409';END IF;
 RETURN controlled_review_v3.read_scope_authorization(p_actor,p_product,p_site,event_value.event_kind,false);
END $$;

CREATE FUNCTION narcotics_register_v1.make_dataset(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE actor_value uuid:=narcotics_register_v1.uuid_value(p_request->'actor_id');
 product_value uuid:=narcotics_register_v1.uuid_value(p_request->'product_id');
 site_value uuid:=narcotics_register_v1.uuid_value(p_request->'site_id');
 from_value timestamptz:=narcotics_register_v1.instant_value(p_request->'from_at');
 to_value timestamptz:=narcotics_register_v1.instant_value(p_request->'to_at');
 opening_value public.controlled_stock_openings;policy_value public.controlled_stock_policy_versions;
 event_value public.controlled_stock_events;cell_value record;count_value record;form_value record;history_event record;witness_value record;
 collected jsonb;packet jsonb;packet_text text;lines_value jsonb;transitions_value jsonb;
 events_value jsonb:='[]';cells_value jsonb:='[]';counts_value jsonb:='[]';forms_value jsonb:='[]';
 kinds_value jsonb:='[]';event_ids uuid[]:=ARRAY[]::uuid[];kind_value text;
 before_authority jsonb;after_authority jsonb;fingerprints jsonb:='{}';schedule_value text;
 count_projection jsonb;count_text text;result jsonb;display_value jsonb;pet_value uuid;pet_values uuid[];
 review_value jsonb;review_text text;witnesses_value jsonb;witness_text text;
BEGIN
 IF from_value>=to_value OR to_value>clock_timestamp() OR to_value-from_value>interval '31 days' THEN
 RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 before_authority:=narcotics_register_v1.authority(actor_value,product_value,site_value);
 -- Every opening/running balance depends on retained history outside the
 -- requested period too. Validate that complete bounded source before export.
 IF (SELECT count(*) FROM(SELECT 1 FROM public.controlled_stock_events e WHERE e.product_id=product_value LIMIT 251)b)>250 THEN
 RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
 PERFORM public.controlled_stock_validate_product(product_value);
 FOR history_event IN SELECT e.id FROM public.controlled_stock_events e WHERE e.product_id=product_value ORDER BY e.sequence LOOP
  PERFORM public.controlled_stock_validate_event(history_event.id);
 END LOOP;
 SELECT * INTO STRICT opening_value FROM public.controlled_stock_openings o WHERE o.product_id=product_value;
 SELECT * INTO STRICT policy_value FROM public.controlled_stock_policy_versions v WHERE v.id=opening_value.policy_version_id;
 IF opening_value.recorded_at>=to_value THEN RAISE EXCEPTION 'narcotics_period_before_opening' USING ERRCODE='PT409';END IF;
 SELECT min(d.definition->>'schedule') INTO schedule_value FROM public.controlled_stock_policy_versions v
 JOIN public.controlled_draft_versions d ON d.id=v.draft_version_id WHERE v.product_id=product_value AND v.recorded_at<to_value;
 IF schedule_value NOT IN ('II','III','IV','V') OR schedule_value IS NULL
 OR EXISTS(SELECT 1 FROM public.controlled_stock_policy_versions v JOIN public.controlled_draft_versions d ON d.id=v.draft_version_id
 WHERE v.product_id=product_value AND v.recorded_at<to_value AND (d.definition->>'schedule') IS DISTINCT FROM schedule_value) THEN
 RAISE EXCEPTION 'narcotics_classification_changed' USING ERRCODE='PT409';END IF;
 IF (SELECT count(*) FROM(SELECT 1 FROM public.controlled_stock_events e WHERE e.product_id=product_value AND e.recorded_at>=from_value AND e.recorded_at<to_value LIMIT 251)b)>250 THEN
 RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
 FOR event_value IN SELECT e.* FROM public.controlled_stock_events e WHERE e.product_id=product_value AND e.recorded_at>=from_value AND e.recorded_at<to_value ORDER BY e.sequence LOOP
  -- A missing site is a refusal, never a silently omitted product event.
  collected:=controlled_review_v3.read_site_candidate(event_value.id);
  IF collected->>'site_id' IS NULL THEN RAISE EXCEPTION 'narcotics_scope_unproven' USING ERRCODE='PT409';END IF;
  IF collected->>'site_id'<>site_value::text THEN CONTINUE;END IF;
  collected:=narcotics_register_v1.event_authority(actor_value,product_value,site_value,event_value.id);
  IF NOT fingerprints ? event_value.event_kind THEN
   fingerprints:=fingerprints||jsonb_build_object(event_value.event_kind,collected);
  ELSIF fingerprints->event_value.event_kind IS DISTINCT FROM collected THEN RAISE EXCEPTION 'narcotics_access_denied' USING ERRCODE='42501';END IF;
  collected:=controlled_review_v3.read_collect_visible_scalar(event_value.id);
  IF collected->>'state'<>'complete' OR collected#>>'{adapter,provenance_state}'<>'supported' OR collected#>>'{adapter,site_id}' IS DISTINCT FROM site_value::text THEN
  RAISE EXCEPTION 'narcotics_scope_unproven' USING ERRCODE='PT409';END IF;
  packet:=controlled_review_v3.read_scalar_base(collected);packet_text:=packet::text;
  review_value:=controlled_review_v3.read_scalar_history(packet);review_text:=review_value::text;
  witnesses_value:='[]'::jsonb;
  -- Full event validation above verifies each saved posted-parent witness.
  -- Capture its immutable original evidence; pending witnesses are excluded.
  FOR witness_value IN SELECT w.* FROM controlled_stock_workflow_v1.witness_operations w
   WHERE w.parent_action_id=event_value.id AND w.stage='saved' ORDER BY w.operation_id LOOP
   witness_text:=to_jsonb(witness_value)::text;
   witnesses_value:=witnesses_value||jsonb_build_array(jsonb_build_object('operation_id',witness_value.operation_id,
    'record_hash',witness_value.record_hash,'document_text',witness_text,'document_hash',encode(sha256(convert_to(witness_text,'UTF8')),'hex')));
  END LOOP;
  SELECT coalesce(jsonb_agg(jsonb_build_object('cell_id',l.cell_id,'container_id',c.container_id,'lot_id',c.lot_id,'channel',c.channel,'quantity_delta',l.quantity_delta::text,
   'running_quantity',((CASE WHEN o.recorded_at<to_value THEN c.opening_quantity ELSE 0 END)+
   coalesce((SELECT sum(prior.quantity_delta) FROM public.controlled_stock_event_lines prior JOIN public.controlled_stock_events pe ON pe.id=prior.event_id
    WHERE prior.cell_id=c.id AND pe.recorded_at<to_value AND(pe.recorded_at<from_value OR(pe.recorded_at>=from_value AND pe.sequence<=event_value.sequence))),0))::numeric(20,3)::text)
   ORDER BY l.cell_id,l.id),'[]'::jsonb) INTO lines_value
   FROM public.controlled_stock_event_lines l JOIN public.controlled_stock_cells c ON c.id=l.cell_id
   JOIN public.controlled_stock_containers t ON t.id=c.container_id LEFT JOIN public.controlled_stock_openings o ON o.id=c.opening_id
   WHERE l.event_id=event_value.id AND t.controlling_site_id=site_value;
  -- Preserve complete immutable custody transitions as exact canonical text.
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.container_id),'[]'::jsonb) INTO transitions_value FROM public.controlled_stock_container_transitions t WHERE t.event_id=event_value.id;
  SELECT array_agg(DISTINCT (value#>>'{row,pet_id}')::uuid) INTO pet_values FROM jsonb_array_elements(packet->'source_rows')
   WHERE value->>'relation' IN ('public.patient_treatments','public.native_prescription_authorizations','public.native_dispenses') AND value#>>'{row,pet_id}' IS NOT NULL;
  IF cardinality(pet_values)>1 THEN RAISE EXCEPTION 'narcotics_scope_unproven' USING ERRCODE='PT409';END IF;
  pet_value:=pet_values[1];display_value:=NULL;
  IF pet_value IS NOT NULL THEN
   SELECT jsonb_build_object('basis','current_display_captured_at_export','patient_id',p.id,'patient_name',p.name,'client_id',c.id,'client_name',concat_ws(' ',c.first_name,c.last_name)) INTO display_value FROM public.pets p JOIN public.clients c ON c.id=p.client_id WHERE p.id=pet_value;
  END IF;
  events_value:=events_value||jsonb_build_array(jsonb_build_object('event_id',event_value.id,'sequence',event_value.sequence::text,'writer',event_value.writer,'event_kind',event_value.event_kind,
   'actor_id',event_value.actor_id,'actor_name',event_value.actor_name,'observed_at',narcotics_register_v1.utc(event_value.observed_at),'recorded_at',narcotics_register_v1.utc(event_value.recorded_at),
   'basis',event_value.basis,'note',event_value.note,'record_hash',event_value.record_hash,'lines',lines_value,'custody_text',transitions_value::text,
   'source_packet_text',packet_text,'source_packet_hash',encode(sha256(convert_to(packet_text,'UTF8')),'hex'),
   'review_history_text',review_text,'review_history_hash',encode(sha256(convert_to(review_text,'UTF8')),'hex'),
   'saved_witnesses',witnesses_value,'current_display',display_value));
  event_ids:=array_append(event_ids,event_value.id);
  IF octet_length(events_value::text)>4194304 THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
 END LOOP;
 FOR cell_value IN SELECT c.*,t.label,t.kind,t.stock_unit,t.initial_location_id,t.initial_custodian_id,t.controlling_site_id,t.created_event_id AS container_created_event_id,
  o.recorded_at AS opening_recorded_at,o.observed_at AS opening_observed_at,born.recorded_at AS cell_recorded_at,t.initial_location_id AS initial_location
  FROM public.controlled_stock_cells c JOIN public.controlled_stock_containers t ON t.id=c.container_id
  LEFT JOIN public.controlled_stock_openings o ON o.id=c.opening_id LEFT JOIN public.controlled_stock_events born ON born.id=c.created_event_id
  WHERE t.product_id=product_value AND t.controlling_site_id=site_value AND coalesce(o.recorded_at,born.recorded_at)<to_value ORDER BY c.id LIMIT 513 LOOP
  IF jsonb_array_length(cells_value)>=512 THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
  cells_value:=cells_value||jsonb_build_array(jsonb_build_object('cell_id',cell_value.id,'container_id',cell_value.container_id,'label',cell_value.label,'kind',cell_value.kind,'lot_id',cell_value.lot_id,
   'channel',cell_value.channel,'stock_unit',cell_value.stock_unit,'opening_quantity',narcotics_register_v1.quantity_at(cell_value.id,from_value),
   'closing_quantity',narcotics_register_v1.quantity_at(cell_value.id,to_value),
   'period_opening_entry',CASE WHEN cell_value.opening_recorded_at>=from_value THEN jsonb_build_object('opening_id',cell_value.opening_id,'observed_at',narcotics_register_v1.utc(cell_value.opening_observed_at),'recorded_at',narcotics_register_v1.utc(cell_value.opening_recorded_at),'quantity',cell_value.opening_quantity::text) ELSE NULL END,
   'custody_at_start',narcotics_register_v1.custody_at(cell_value.container_id,from_value),
   'custody_at_end',narcotics_register_v1.custody_at(cell_value.container_id,to_value)));
 END LOOP;
 FOR count_value IN SELECT c.count_id FROM controlled_count_v1.cycles c JOIN controlled_count_v1.outcomes o ON o.count_id=c.count_id
  WHERE c.product_id=product_value AND c.site_id=site_value AND o.kind IN ('agreement','variance') AND (o.document->>'recorded_at')::timestamptz>=from_value AND (o.document->>'recorded_at')::timestamptz<to_value ORDER BY (o.document->>'recorded_at')::timestamptz,c.count_id LIMIT 33 LOOP
  IF jsonb_array_length(counts_value)>=32 THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
  -- This is an exact source copy of the existing authorized READ projector;
  -- only its redundant full module check is removed under this root's check.
  count_projection:=narcotics_register_v1.read_terminal_count(jsonb_build_object('schema_version',1,'actor_id',actor_value,'count_id',count_value.count_id));
  IF count_projection->>'state'<>'available' OR count_projection#>>'{data,history_state}' NOT IN ('agreement','variance') THEN
  RAISE EXCEPTION 'narcotics_scope_unproven' USING ERRCODE='PT409';END IF;
  count_text:=count_projection::text;
  counts_value:=counts_value||jsonb_build_array(jsonb_build_object('count_id',count_value.count_id,'state',count_projection#>>'{data,history_state}',
   'projection_text',count_text,'projection_hash',encode(sha256(convert_to(count_text,'UTF8')),'hex')));
 END LOOP;
 FOR form_value IN SELECT f.*,c.sha256,c.byte_length,c.mime FROM narcotics_register_v1.form_records f JOIN narcotics_register_v1.form_contents c ON c.form_id=f.form_id
  WHERE f.product_id=product_value AND f.site_id=site_value AND(f.event_id IS NULL OR f.event_id=ANY(event_ids)) ORDER BY f.recorded_at,f.form_id LIMIT 129 LOOP
  IF jsonb_array_length(forms_value)>=128 THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
  forms_value:=forms_value||jsonb_build_array(jsonb_build_object('form_id',form_value.form_id,'kind',form_value.kind,'title',form_value.title,'filename',form_value.filename,
   'mime',form_value.mime,'byte_length',form_value.byte_length,'sha256',form_value.sha256,'obtained_at',narcotics_register_v1.utc(form_value.obtained_at),
   'recorded_at',narcotics_register_v1.utc(form_value.recorded_at),'event_id',form_value.event_id,'event_hash',form_value.event_hash,'document_text',form_value.document_text,'document_hash',form_value.document_hash));
 END LOOP;
 FOR kind_value IN SELECT key FROM jsonb_object_keys(fingerprints)key ORDER BY key LOOP
  after_authority:=controlled_review_v3.read_scope_authorization(actor_value,product_value,site_value,kind_value,false);
  IF after_authority IS DISTINCT FROM fingerprints->kind_value THEN RAISE EXCEPTION 'narcotics_access_denied' USING ERRCODE='42501';END IF;
  kinds_value:=kinds_value||to_jsonb(kind_value);
 END LOOP;
 IF narcotics_register_v1.authority(actor_value,product_value,site_value) IS DISTINCT FROM before_authority THEN RAISE EXCEPTION 'narcotics_access_denied' USING ERRCODE='42501';END IF;
 result:=jsonb_build_object('schema_version',1,'report_id',p_request->'operation_id','request',p_request,'captured_at',narcotics_register_v1.utc(clock_timestamp()),
  'time_basis','movements and terminal counts: recorded_at [from,to); reviews, witnesses and supporting forms: source state at capture','schedule',schedule_value,'product_name',policy_value.identity_snapshot->>'name',
  'stock_unit',policy_value.stock_unit,'site_label',(SELECT s.label FROM public.controlled_stock_sites s WHERE s.id=site_value),
  'registration_evidence_text',(SELECT s.registration_evidence::text FROM public.controlled_stock_sites s WHERE s.id=site_value),'opening_evidence_text',to_jsonb(opening_value)::text,
  'authorization_kinds',kinds_value,'cells',cells_value,'events',events_value,'counts',counts_value,'supporting_forms',forms_value,
  'evidence_gaps',jsonb_build_array('Historical patient and owner names are present only where captured in the original source. Current display labels are marked separately.',
   'Supplier and order-form evidence is limited to explicitly preserved supporting files. Missing clinic facts have not been inferred.',
   'Collecting, stale and cancelled count statements are excluded to preserve blind observations. Only finalized revealed count projections are included.'));
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
 RETURN result;
END $$;

CREATE FUNCTION narcotics_register_v1.custody_at(p_container uuid,p_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE container_value public.controlled_stock_containers;transition_value public.controlled_stock_container_transitions;head_value public.controlled_stock_container_heads;
BEGIN
 SELECT * INTO STRICT container_value FROM public.controlled_stock_containers c WHERE c.id=p_container;
 IF container_value.recorded_at>=p_at THEN RETURN NULL;END IF;
 SELECT t.* INTO transition_value FROM public.controlled_stock_container_transitions t JOIN public.controlled_stock_events e ON e.id=t.event_id
 WHERE t.container_id=p_container AND e.recorded_at<p_at ORDER BY t.version_after DESC LIMIT 1;
 IF FOUND THEN RETURN jsonb_build_object('status',transition_value.after_status,'location_id',transition_value.after_location_id,'custodian_id',transition_value.after_custodian_id);END IF;
 SELECT * INTO transition_value FROM public.controlled_stock_container_transitions t WHERE t.container_id=p_container ORDER BY t.version_before LIMIT 1;
 IF FOUND THEN
  IF transition_value.version_before<>0 THEN RAISE EXCEPTION 'narcotics_source_invalid' USING ERRCODE='23514';END IF;
  RETURN jsonb_build_object('status',transition_value.before_status,'location_id',transition_value.before_location_id,'custodian_id',transition_value.before_custodian_id);
 END IF;
 SELECT * INTO STRICT head_value FROM public.controlled_stock_container_heads h WHERE h.container_id=p_container AND h.version=0 AND h.last_event_id IS NULL;
 RETURN jsonb_build_object('status',head_value.status,'location_id',head_value.location_id,'custodian_id',head_value.custodian_id);
END $$;
