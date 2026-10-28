-- Reviewed operational source candidate; runtime acceptance and release approval are required.
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';SET LOCAL client_min_messages='warning';SET LOCAL quote_all_identifiers=false;SET LOCAL TimeZone='UTC';SET LOCAL DateStyle='ISO,YMD';SET LOCAL IntervalStyle='postgres';SET LOCAL extra_float_digits=3;
SELECT pg_advisory_xact_lock(90271190,0);
SELECT pg_advisory_xact_lock(90271040,0);
DO $operational_parent$BEGIN PERFORM controlled_count_entry_v1.require_bound_module();END $operational_parent$;
-- Independent operational audit module. No existing relation is changed.
CREATE SCHEMA narcotics_register_v1 AUTHORIZATION postgres;
CREATE SCHEMA narcotics_recovery_v1 AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA narcotics_register_v1,narcotics_recovery_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE narcotics_register_v1.descriptor (
 revision integer PRIMARY KEY CHECK (revision=1),
 definition jsonb NOT NULL CHECK (jsonb_typeof(definition)='object'),
 definition_hash text NOT NULL CHECK (definition_hash ~ '^[0-9a-f]{64}$')
);
CREATE TABLE narcotics_register_v1.operations (
 operation_id uuid PRIMARY KEY, actor_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('report','form')),
 product_id uuid NOT NULL, site_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('saved','abandoned')),
 original_request jsonb, request_hash text,
 session_id uuid NOT NULL, recorded_at timestamptz NOT NULL,
 CHECK((state='saved' AND original_request IS NOT NULL AND request_hash IS NOT NULL) OR(state='abandoned' AND original_request IS NULL AND request_hash IS NULL)),
 CHECK(request_hash IS NULL OR request_hash ~ '^[0-9a-f]{64}$')
);
CREATE TABLE narcotics_register_v1.reports (
 report_id uuid PRIMARY KEY REFERENCES narcotics_register_v1.operations(operation_id),
 captured_at timestamptz NOT NULL,
 dataset_text text NOT NULL CHECK(octet_length(dataset_text)<=4194304),
 dataset_hash text NOT NULL CHECK(dataset_hash=encode(sha256(convert_to(dataset_text,'UTF8')),'hex')),
 csv_text text NOT NULL CHECK(octet_length(csv_text)<=4194304),
 csv_hash text NOT NULL CHECK(csv_hash=encode(sha256(convert_to(csv_text,'UTF8')),'hex'))
);
CREATE TABLE narcotics_register_v1.form_contents (
 form_id uuid PRIMARY KEY,
 original_bytes bytea NOT NULL CHECK(octet_length(original_bytes) BETWEEN 1 AND 2097152),
 mime text NOT NULL CHECK(mime IN ('application/pdf','image/png','image/jpeg')),
 byte_length integer NOT NULL CHECK(byte_length=octet_length(original_bytes)),
 sha256 text NOT NULL CHECK(sha256=encode(pg_catalog.sha256(original_bytes),'hex'))
);
CREATE TABLE narcotics_register_v1.form_records (
 form_id uuid PRIMARY KEY REFERENCES narcotics_register_v1.form_contents(form_id),
 operation_id uuid NOT NULL UNIQUE REFERENCES narcotics_register_v1.operations(operation_id),
 actor_id uuid NOT NULL, session_id uuid NOT NULL,
 product_id uuid NOT NULL, site_id uuid NOT NULL,
 event_id uuid, event_hash text,
 kind text NOT NULL CHECK(kind IN ('supplier_receipt','registration','order_form','other')),
 title text NOT NULL, filename text NOT NULL,
 obtained_at timestamptz NOT NULL, recorded_at timestamptz NOT NULL,
 document_text text NOT NULL,
 document_hash text NOT NULL CHECK(document_hash=encode(sha256(convert_to(document_text,'UTF8')),'hex')),
 CHECK((event_id IS NULL)=(event_hash IS NULL))
);
CREATE FUNCTION narcotics_register_v1.reject_history_change() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'narcotics_history_immutable' USING ERRCODE='23514',DETAIL='',HINT='';END $$;
CREATE FUNCTION narcotics_register_v1.keys(p_value jsonb,p_keys text[]) RETURNS void
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'object'
 OR (SELECT count(*) FROM jsonb_object_keys(p_value))<>cardinality(p_keys)
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_value)k WHERE NOT k=ANY(p_keys)) THEN
 RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023',DETAIL='',HINT='';END IF;
END $$;
CREATE FUNCTION narcotics_register_v1.uuid_value(p_value jsonb) RETURNS uuid
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE value uuid;
BEGIN
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 value:=(p_value#>>'{}')::uuid;
 IF value='00000000-0000-0000-0000-000000000000'::uuid OR value::text IS DISTINCT FROM p_value#>>'{}' THEN
 RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;RETURN value;
END $$;
CREATE FUNCTION narcotics_register_v1.instant_value(p_value jsonb) RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE value timestamptz;raw text:=p_value#>>'{}';
BEGIN
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' OR raw !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN
 RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 value:=raw::timestamptz;
 IF NOT isfinite(value) OR to_char(value,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>raw THEN
 RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;RETURN value;
END $$;
CREATE FUNCTION narcotics_register_v1.utc(p_value timestamptz) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$
 SELECT to_char(p_value,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;
CREATE FUNCTION narcotics_register_v1.hash(p_domain text,p_value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object('domain',p_domain,'value',p_value)::text,'UTF8')),'hex')
$$;
CREATE FUNCTION narcotics_register_v1.text_value(p_value jsonb,p_limit integer) RETURNS text
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE value text:=p_value#>>'{}';
BEGIN
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' OR length(value) NOT BETWEEN 1 AND p_limit
 OR btrim(value)='' OR value ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 RETURN value;
END $$;
CREATE FUNCTION narcotics_register_v1.identity(p_actor uuid,p_admin boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE identity_value jsonb;
BEGIN
 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_access_denied' USING ERRCODE='42501';END IF;
 identity_value:=controlled_review_v3.protocol_identity(p_actor);
 IF NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_actor AND (u.banned_until IS NULL OR u.banned_until<=clock_timestamp()))
 OR (p_admin AND NOT EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p_actor AND r.role='ADMIN')) THEN
 RAISE EXCEPTION 'narcotics_access_denied' USING ERRCODE='42501';END IF;
 RETURN identity_value;
END $$;
CREATE FUNCTION narcotics_register_v1.authority(p_actor uuid,p_product uuid,p_site uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE identity_value jsonb;authority_value jsonb;
BEGIN
 identity_value:=narcotics_register_v1.identity(p_actor,true);
 authority_value:=controlled_review_v3.ops_admin_authority(p_actor,p_product,'audit');
 IF NOT EXISTS(SELECT 1 FROM public.controlled_stock_sites s WHERE s.id=p_site)
 OR NOT EXISTS(SELECT 1 FROM public.controlled_stock_policy_sites s JOIN public.controlled_stock_policy_versions v ON v.id=s.policy_version_id WHERE v.product_id=p_product AND s.site_id=p_site) THEN
 RAISE EXCEPTION 'narcotics_access_denied' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('identity',identity_value,'audit',authority_value);
END $$;
CREATE FUNCTION narcotics_register_v1.enter_register() RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 -- Dedicated admission precedes every old stock lock, including direct calls.
 PERFORM pg_advisory_xact_lock_shared(90271190,0);
 PERFORM pg_advisory_xact_lock(90271040,0);
 PERFORM controlled_count_entry_v1.acquire_shared_product_relation_frontier();
 PERFORM controlled_count_entry_v1.require_bound_module();
 PERFORM narcotics_register_v1.require_module();
END $$;
CREATE FUNCTION narcotics_register_v1.operation_lock(p_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN PERFORM pg_advisory_xact_lock(hashtextextended('narcotics-register-operation:'||p_id::text,0));END $$;
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
   result:=result||narcotics_register_v1.csv_row(prefix||ARRAY[CASE event_value->>'basis' WHEN 'physical_record' THEN 'Physical movement' WHEN 'annotation' THEN 'Annotation' WHEN 'correction_assertion' THEN 'Correction assertion' WHEN 'discrepancy_assertion' THEN 'Discrepancy assertion' ELSE 'Unclassified record' END,event_value->>'event_id',event_value->>'sequence',event_value->>'event_kind',event_value->>'actor_name',event_value->>'observed_at',event_value->>'recorded_at',p_dataset#>>'{request,from_at}',p_dataset#>>'{request,to_at}',line_value->>'cell_id',line_value->>'channel',cell_value->>'opening_quantity',line_value->>'quantity_delta',line_value->>'running_quantity',cell_value->>'closing_quantity',p_dataset->>'stock_unit',event_value->>'note']);
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
   -- Preserve the original public receipt/request and saved attribution. The
   -- private nonce and private preparation are not part of an exported receipt.
   witness_text:=jsonb_build_object('schema_version',1,'operation_id',witness_value.operation_id,'stage','saved',
    'actor_id',witness_value.actor_id,'actor_name',witness_value.name,'recorder_id',witness_value.recorder_id,'recorder_name',witness_value.recorder_name,
    'parent_action_id',witness_value.parent_action_id,'writer',witness_value.writer,'product_id',witness_value.product_id,'event_kind',witness_value.event_kind,
    'recorded_at',narcotics_register_v1.utc(witness_value.recorded_at),'preparation_digest',witness_value.preparation_digest,'request',witness_value.request,'receipt',witness_value.receipt)::text;
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
   'basis',event_value.basis,'note',event_value.note,'record_hash',event_value.record_hash,'secondary_review_required',event_value.secondary_review_required,'lines',lines_value,'custody_text',transitions_value::text,
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
CREATE FUNCTION narcotics_register_v1.list_reports(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actor_value uuid;product_value uuid;site_value uuid;cursor_value uuid;cursor_time timestamptz;page_value integer;
 row_value record;items jsonb:='[]'::jsonb;more_value boolean:=false;last_id uuid;authority_value jsonb;
BEGIN
 PERFORM narcotics_register_v1.keys(p_request,ARRAY['schema_version','actor_id','product_id','site_id','after_operation_id','page_size']);
 IF (p_request->'schema_version')::text IS DISTINCT FROM '1' OR jsonb_typeof(p_request->'page_size')IS DISTINCT FROM'number' THEN RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 page_value:=(p_request->>'page_size')::integer;
 IF page_value NOT BETWEEN 1 AND 50 OR to_jsonb(page_value)IS DISTINCT FROM p_request->'page_size' THEN RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 actor_value:=narcotics_register_v1.uuid_value(p_request->'actor_id');product_value:=narcotics_register_v1.uuid_value(p_request->'product_id');site_value:=narcotics_register_v1.uuid_value(p_request->'site_id');
 IF p_request->'after_operation_id'<>'null'::jsonb THEN cursor_value:=narcotics_register_v1.uuid_value(p_request->'after_operation_id');END IF;
 PERFORM controlled_count_entry_v1.assert_shared_product_relation_frontier();authority_value:=narcotics_register_v1.authority(actor_value,product_value,site_value);
 IF cursor_value IS NOT NULL THEN
  SELECT o.recorded_at INTO STRICT cursor_time FROM narcotics_register_v1.operations o WHERE o.operation_id=cursor_value AND o.actor_id=actor_value AND o.product_id=product_value AND o.site_id=site_value AND o.kind='report' AND o.state='saved';
 END IF;
 FOR row_value IN SELECT o.operation_id,o.recorded_at,o.original_request,r.captured_at FROM narcotics_register_v1.operations o JOIN narcotics_register_v1.reports r ON r.report_id=o.operation_id
  WHERE o.actor_id=actor_value AND o.product_id=product_value AND o.site_id=site_value AND o.kind='report' AND o.state='saved'
  AND(cursor_value IS NULL OR(o.recorded_at,o.operation_id)<(cursor_time,cursor_value)) ORDER BY o.recorded_at DESC,o.operation_id DESC LIMIT page_value+1 LOOP
  IF jsonb_array_length(items)=page_value THEN more_value:=true;EXIT;END IF;
  items:=items||jsonb_build_array(jsonb_build_object('operation_id',row_value.operation_id,'recorded_at',narcotics_register_v1.utc(row_value.recorded_at),'captured_at',narcotics_register_v1.utc(row_value.captured_at),
   'from_at',row_value.original_request->'from_at','to_at',row_value.original_request->'to_at'));last_id:=row_value.operation_id;
 END LOOP;
 IF narcotics_register_v1.authority(actor_value,product_value,site_value)IS DISTINCT FROM authority_value THEN RAISE EXCEPTION 'narcotics_access_denied' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('schema_version',1,'actor_id',actor_value,'product_id',product_value,'site_id',site_value,'items',items,'has_more',more_value,'next_operation_id',CASE WHEN more_value THEN last_id ELSE NULL END);
END $$;
CREATE FUNCTION narcotics_register_v1.result_of(p_operation uuid,p_actor uuid,p_kind text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE operation_value narcotics_register_v1.operations;report_value narcotics_register_v1.reports;
 form_value narcotics_register_v1.form_records;content_value narcotics_register_v1.form_contents;
 dataset jsonb;kind_value text;before_authority jsonb;request_value jsonb;data_value jsonb;
BEGIN
 SELECT * INTO operation_value FROM narcotics_register_v1.operations o WHERE o.operation_id=p_operation;
 IF NOT FOUND THEN RETURN jsonb_build_object('schema_version',1,'state','not_found','kind',p_kind,'operation_id',p_operation);END IF;
 IF operation_value.actor_id<>p_actor OR operation_value.kind<>p_kind THEN RAISE EXCEPTION 'narcotics_access_denied' USING ERRCODE='42501';END IF;
 before_authority:=narcotics_register_v1.authority(p_actor,operation_value.product_id,operation_value.site_id);
 IF operation_value.state='abandoned' THEN RETURN jsonb_build_object('schema_version',1,'state','abandoned','kind',p_kind,'operation_id',p_operation);END IF;
 IF p_kind='report' THEN
  SELECT * INTO STRICT report_value FROM narcotics_register_v1.reports r WHERE r.report_id=p_operation;
  dataset:=report_value.dataset_text::jsonb;
  IF dataset->'request' IS DISTINCT FROM operation_value.original_request OR dataset->>'report_id'<>p_operation::text
  OR report_value.dataset_hash<>encode(sha256(convert_to(report_value.dataset_text,'UTF8')),'hex')
  OR report_value.csv_hash<>encode(sha256(convert_to(report_value.csv_text,'UTF8')),'hex') THEN RAISE EXCEPTION 'narcotics_source_invalid' USING ERRCODE='23514';END IF;
  FOR kind_value IN SELECT jsonb_array_elements_text(dataset->'authorization_kinds') LOOP
   PERFORM controlled_review_v3.read_scope_authorization(p_actor,operation_value.product_id,operation_value.site_id,kind_value,false);
  END LOOP;
  IF jsonb_array_length(dataset->'counts')>0 THEN PERFORM controlled_count_v1.current_principal(p_actor,operation_value.product_id,operation_value.site_id,'read');END IF;
  request_value:=operation_value.original_request;
  data_value:=jsonb_build_object('captured_at',narcotics_register_v1.utc(report_value.captured_at),'dataset_text',report_value.dataset_text,'dataset_hash',report_value.dataset_hash,
   'dataset_utf8_bytes',octet_length(report_value.dataset_text),'csv_text',report_value.csv_text,'csv_hash',report_value.csv_hash,'csv_utf8_bytes',octet_length(report_value.csv_text));
 ELSIF p_kind='form' THEN
  SELECT * INTO STRICT form_value FROM narcotics_register_v1.form_records f WHERE f.operation_id=p_operation;
  SELECT * INTO STRICT content_value FROM narcotics_register_v1.form_contents c WHERE c.form_id=form_value.form_id;
  IF form_value.actor_id<>p_actor OR form_value.product_id<>operation_value.product_id OR form_value.site_id<>operation_value.site_id
  OR form_value.document_hash<>encode(sha256(convert_to(form_value.document_text,'UTF8')),'hex')
  OR content_value.sha256<>encode(sha256(content_value.original_bytes),'hex') OR content_value.byte_length<>octet_length(content_value.original_bytes) THEN RAISE EXCEPTION 'narcotics_source_invalid' USING ERRCODE='23514';END IF;
  IF form_value.event_id IS NOT NULL THEN PERFORM narcotics_register_v1.event_authority(p_actor,form_value.product_id,form_value.site_id,form_value.event_id);END IF;
  request_value:=operation_value.original_request||jsonb_build_object('base64',replace(encode(content_value.original_bytes,'base64'),E'\n',''));
  data_value:=jsonb_build_object('form_id',form_value.form_id,'document_text',form_value.document_text,'document_hash',form_value.document_hash,
   'sha256',content_value.sha256,'byte_length',content_value.byte_length,'mime',content_value.mime,'filename',form_value.filename);
 ELSE RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 IF operation_value.request_hash<>narcotics_register_v1.hash('narcotics-register-'||p_kind||'-request-v1',request_value)
 OR narcotics_register_v1.authority(p_actor,operation_value.product_id,operation_value.site_id) IS DISTINCT FROM before_authority THEN
 RAISE EXCEPTION 'narcotics_source_invalid' USING ERRCODE='23514';END IF;
 RETURN jsonb_build_object('schema_version',1,'state','saved','kind',p_kind,'operation_id',p_operation,'actor_id',p_actor,
  'original_session_id',operation_value.session_id,'recorded_at',narcotics_register_v1.utc(operation_value.recorded_at),
  'request_metadata',operation_value.original_request,'request_hash',operation_value.request_hash,'data',data_value);
END $$;
CREATE FUNCTION narcotics_register_v1.read_operation(p_request jsonb,p_kind text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actor_value uuid;operation_value uuid;
BEGIN
 PERFORM narcotics_register_v1.keys(p_request,ARRAY['schema_version','actor_id','operation_id']);
 IF (p_request->'schema_version')::text IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 actor_value:=narcotics_register_v1.uuid_value(p_request->'actor_id');operation_value:=narcotics_register_v1.uuid_value(p_request->'operation_id');
 PERFORM controlled_count_entry_v1.assert_shared_product_relation_frontier();PERFORM narcotics_register_v1.identity(actor_value,true);
 PERFORM narcotics_register_v1.operation_lock(operation_value);
 RETURN narcotics_register_v1.result_of(operation_value,actor_value,p_kind);
END $$;
CREATE FUNCTION narcotics_register_v1.close_operation(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actor_value uuid;operation_value uuid;product_value uuid;site_value uuid;kind_value text;identity_value jsonb;
BEGIN
 PERFORM narcotics_register_v1.keys(p_request,ARRAY['schema_version','actor_id','operation_id','product_id','site_id','kind']);
 IF (p_request->'schema_version')::text IS DISTINCT FROM '1' OR p_request->>'kind' NOT IN ('report','form') THEN RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 actor_value:=narcotics_register_v1.uuid_value(p_request->'actor_id');operation_value:=narcotics_register_v1.uuid_value(p_request->'operation_id');
 product_value:=narcotics_register_v1.uuid_value(p_request->'product_id');site_value:=narcotics_register_v1.uuid_value(p_request->'site_id');kind_value:=p_request->>'kind';
 PERFORM controlled_count_entry_v1.assert_shared_product_relation_frontier();PERFORM narcotics_register_v1.authority(actor_value,product_value,site_value);PERFORM narcotics_register_v1.operation_lock(operation_value);
 IF NOT EXISTS(SELECT 1 FROM narcotics_register_v1.operations o WHERE o.operation_id=operation_value) THEN
  identity_value:=narcotics_register_v1.identity(actor_value,true);
  INSERT INTO narcotics_register_v1.operations(operation_id,actor_id,kind,product_id,site_id,state,session_id,recorded_at)
  VALUES(operation_value,actor_value,kind_value,product_value,site_value,'abandoned',(identity_value->>'session_id')::uuid,clock_timestamp());
 ELSE
  IF NOT EXISTS(SELECT 1 FROM narcotics_register_v1.operations o WHERE o.operation_id=operation_value AND o.product_id=product_value AND o.site_id=site_value) THEN RAISE EXCEPTION 'narcotics_request_mismatch' USING ERRCODE='22023';END IF;
 END IF;
 RETURN narcotics_register_v1.result_of(operation_value,actor_value,kind_value);
END $$;
CREATE FUNCTION narcotics_register_v1.create_report(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actor_value uuid;operation_value uuid;product_value uuid;site_value uuid;identity_value jsonb;prior narcotics_register_v1.operations;
 dataset_value jsonb;dataset_text text;csv_text text;request_hash text;response_value jsonb;
BEGIN
 PERFORM narcotics_register_v1.keys(p_request,ARRAY['schema_version','actor_id','operation_id','product_id','site_id','from_at','to_at']);
 IF (p_request->'schema_version')::text IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 actor_value:=narcotics_register_v1.uuid_value(p_request->'actor_id');operation_value:=narcotics_register_v1.uuid_value(p_request->'operation_id');product_value:=narcotics_register_v1.uuid_value(p_request->'product_id');site_value:=narcotics_register_v1.uuid_value(p_request->'site_id');
 PERFORM controlled_count_entry_v1.assert_shared_product_relation_frontier();PERFORM narcotics_register_v1.authority(actor_value,product_value,site_value);PERFORM narcotics_register_v1.operation_lock(operation_value);
 request_hash:=narcotics_register_v1.hash('narcotics-register-report-request-v1',p_request);
 SELECT * INTO prior FROM narcotics_register_v1.operations o WHERE o.operation_id=operation_value;
 IF FOUND THEN
  IF prior.state<>'saved' OR prior.kind<>'report' OR prior.actor_id<>actor_value OR prior.request_hash<>request_hash OR prior.original_request IS DISTINCT FROM p_request THEN RAISE EXCEPTION 'narcotics_request_closed_or_changed' USING ERRCODE='PT409';END IF;
  RETURN narcotics_register_v1.result_of(operation_value,actor_value,'report');
 END IF;
 dataset_value:=narcotics_register_v1.make_dataset(p_request);dataset_text:=dataset_value::text;csv_text:=narcotics_register_v1.csv(dataset_value);
 identity_value:=narcotics_register_v1.identity(actor_value,true);
 INSERT INTO narcotics_register_v1.operations VALUES(operation_value,actor_value,'report',product_value,site_value,'saved',p_request,request_hash,(identity_value->>'session_id')::uuid,clock_timestamp());
 INSERT INTO narcotics_register_v1.reports VALUES(operation_value,(dataset_value->>'captured_at')::timestamptz,dataset_text,encode(sha256(convert_to(dataset_text,'UTF8')),'hex'),csv_text,encode(sha256(convert_to(csv_text,'UTF8')),'hex'));
 response_value:=narcotics_register_v1.result_of(operation_value,actor_value,'report');
 IF octet_length(response_value::text)>8388608 THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
 RETURN response_value;
END $$;
CREATE FUNCTION narcotics_register_v1.form_bytes(p_mime text,p_base64 text) RETURNS bytea
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE value bytea;length_value integer;
BEGIN
 IF p_base64 IS NULL OR length(p_base64) NOT BETWEEN 4 AND 2796204 OR length(p_base64)%4<>0
 OR p_base64 !~ '^[A-Za-z0-9+/]*={0,2}$' OR p_mime NOT IN ('application/pdf','image/png','image/jpeg') THEN RAISE EXCEPTION 'narcotics_document_invalid' USING ERRCODE='22023';END IF;
 value:=decode(p_base64,'base64');length_value:=octet_length(value);
 IF length_value NOT BETWEEN 1 AND 2097152 OR replace(encode(value,'base64'),E'\n','')<>p_base64 THEN RAISE EXCEPTION 'narcotics_document_invalid' USING ERRCODE='22023';END IF;
 IF (p_mime='application/pdf' AND(substring(value FROM 1 FOR 5)<>convert_to('%PDF-','UTF8') OR position(convert_to('%%EOF','UTF8') IN substring(value FROM greatest(1,length_value-64)))=0))
 OR(p_mime='image/png' AND(substring(value FROM 1 FOR 8)<>decode('89504e470d0a1a0a','hex') OR substring(value FROM length_value-11 FOR 12)<>decode('0000000049454e44ae426082','hex')))
 OR(p_mime='image/jpeg' AND(substring(value FROM 1 FOR 3)<>decode('ffd8ff','hex') OR substring(value FROM length_value-1 FOR 2)<>decode('ffd9','hex'))) THEN
 RAISE EXCEPTION 'narcotics_document_invalid' USING ERRCODE='22023';END IF;
 RETURN value;
END $$;
CREATE FUNCTION narcotics_register_v1.preserve_form(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actor_value uuid;operation_value uuid;product_value uuid;site_value uuid;event_value uuid;
 kind_value text;title_value text;filename_value text;mime_value text;obtained_value timestamptz;recorded_value timestamptz;
 raw_value bytea;raw_hash text;request_hash text;event_hash text;identity_value jsonb;authority_value jsonb;prior narcotics_register_v1.operations;document_value jsonb;document_text text;
BEGIN
 IF octet_length(p_request::text)>3145728 THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
 PERFORM narcotics_register_v1.keys(p_request,ARRAY['schema_version','actor_id','operation_id','product_id','site_id','event_id','kind','title','filename','obtained_at','mime','base64']);
 IF (p_request->'schema_version')::text IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 actor_value:=narcotics_register_v1.uuid_value(p_request->'actor_id');operation_value:=narcotics_register_v1.uuid_value(p_request->'operation_id');product_value:=narcotics_register_v1.uuid_value(p_request->'product_id');site_value:=narcotics_register_v1.uuid_value(p_request->'site_id');
 IF p_request->'event_id'<>'null'::jsonb THEN event_value:=narcotics_register_v1.uuid_value(p_request->'event_id');END IF;
 kind_value:=narcotics_register_v1.text_value(p_request->'kind',32);title_value:=narcotics_register_v1.text_value(p_request->'title',200);filename_value:=narcotics_register_v1.text_value(p_request->'filename',200);
 IF kind_value NOT IN ('supplier_receipt','registration','order_form','other') OR filename_value ~ '[/\\]' THEN RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 obtained_value:=narcotics_register_v1.instant_value(p_request->'obtained_at');mime_value:=narcotics_register_v1.text_value(p_request->'mime',100);
 IF obtained_value>clock_timestamp() OR jsonb_typeof(p_request->'base64') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 raw_value:=narcotics_register_v1.form_bytes(mime_value,p_request->>'base64');raw_hash:=encode(sha256(raw_value),'hex');request_hash:=narcotics_register_v1.hash('narcotics-register-form-request-v1',p_request);
 PERFORM controlled_count_entry_v1.assert_shared_product_relation_frontier();authority_value:=narcotics_register_v1.authority(actor_value,product_value,site_value);PERFORM narcotics_register_v1.operation_lock(operation_value);
 SELECT * INTO prior FROM narcotics_register_v1.operations o WHERE o.operation_id=operation_value;
 IF FOUND THEN
  IF prior.state<>'saved' OR prior.kind<>'form' OR prior.actor_id<>actor_value OR prior.request_hash<>request_hash OR prior.original_request IS DISTINCT FROM p_request-'base64' THEN RAISE EXCEPTION 'narcotics_request_closed_or_changed' USING ERRCODE='PT409';END IF;
  RETURN narcotics_register_v1.result_of(operation_value,actor_value,'form');
 END IF;
 IF event_value IS NOT NULL THEN
  PERFORM narcotics_register_v1.event_authority(actor_value,product_value,site_value,event_value);
  PERFORM controlled_review_v3.read_scalar_base(controlled_review_v3.read_collect_visible_scalar(event_value));
  SELECT e.record_hash INTO STRICT event_hash FROM public.controlled_stock_events e WHERE e.id=event_value;
 END IF;
 identity_value:=narcotics_register_v1.identity(actor_value,true);recorded_value:=clock_timestamp();
 document_value:=jsonb_build_object('schema_version',1,'form_id',operation_value,'operation_id',operation_value,'request_metadata',p_request-'base64','request_hash',request_hash,
  'actor_id',actor_value,'session_id',identity_value->'session_id','recorded_at',narcotics_register_v1.utc(recorded_value),'obtained_at_basis','staff_reported',
  'event_hash',event_hash,'sha256',raw_hash,'byte_length',octet_length(raw_value),'mime',mime_value);
 document_text:=document_value::text;
 IF narcotics_register_v1.authority(actor_value,product_value,site_value) IS DISTINCT FROM authority_value THEN RAISE EXCEPTION 'narcotics_access_denied' USING ERRCODE='42501';END IF;
 INSERT INTO narcotics_register_v1.operations VALUES(operation_value,actor_value,'form',product_value,site_value,'saved',p_request-'base64',request_hash,(identity_value->>'session_id')::uuid,recorded_value);
 INSERT INTO narcotics_register_v1.form_contents VALUES(operation_value,raw_value,mime_value,octet_length(raw_value),raw_hash);
 INSERT INTO narcotics_register_v1.form_records VALUES(operation_value,operation_value,actor_value,(identity_value->>'session_id')::uuid,product_value,site_value,event_value,event_hash,kind_value,title_value,filename_value,obtained_value,recorded_value,document_text,encode(sha256(convert_to(document_text,'UTF8')),'hex'));
 RETURN narcotics_register_v1.result_of(operation_value,actor_value,'form');
END $$;
CREATE FUNCTION narcotics_register_v1.download_form(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actor_value uuid;form_id_value uuid;form_value narcotics_register_v1.form_records;content_value narcotics_register_v1.form_contents;authority_value jsonb;data_value jsonb;
BEGIN
 PERFORM narcotics_register_v1.keys(p_request,ARRAY['schema_version','actor_id','form_id']);
 IF (p_request->'schema_version')::text IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 actor_value:=narcotics_register_v1.uuid_value(p_request->'actor_id');form_id_value:=narcotics_register_v1.uuid_value(p_request->'form_id');
 PERFORM controlled_count_entry_v1.assert_shared_product_relation_frontier();PERFORM narcotics_register_v1.identity(actor_value,true);
 SELECT * INTO STRICT form_value FROM narcotics_register_v1.form_records f WHERE f.form_id=form_id_value;
 authority_value:=narcotics_register_v1.authority(actor_value,form_value.product_id,form_value.site_id);
 IF form_value.event_id IS NOT NULL THEN PERFORM narcotics_register_v1.event_authority(actor_value,form_value.product_id,form_value.site_id,form_value.event_id);END IF;
 SELECT * INTO STRICT content_value FROM narcotics_register_v1.form_contents c WHERE c.form_id=form_id_value;
 IF content_value.sha256<>encode(sha256(content_value.original_bytes),'hex') OR content_value.byte_length<>octet_length(content_value.original_bytes)
 OR form_value.document_hash<>encode(sha256(convert_to(form_value.document_text,'UTF8')),'hex') THEN RAISE EXCEPTION 'narcotics_source_invalid' USING ERRCODE='23514';END IF;
 data_value:=jsonb_build_object('schema_version',1,'form_id',form_id_value,'filename',form_value.filename,'mime',content_value.mime,'byte_length',content_value.byte_length,
  'sha256',content_value.sha256,'base64',replace(encode(content_value.original_bytes,'base64'),E'\n',''),'document_text',form_value.document_text,'document_hash',form_value.document_hash);
 IF narcotics_register_v1.authority(actor_value,form_value.product_id,form_value.site_id) IS DISTINCT FROM authority_value THEN RAISE EXCEPTION 'narcotics_access_denied' USING ERRCODE='42501';END IF;
 RETURN data_value;
END $$;
-- Prospective recovery coordinator. The release builder remains disabled.
-- A mode transition is an immutable audit append plus its catalog projection.
CREATE TABLE narcotics_recovery_v1.heads (
 head_id uuid PRIMARY KEY,
 prior_head_id uuid UNIQUE REFERENCES narcotics_recovery_v1.heads(head_id),
 prior_head_hash text,
 kind text NOT NULL CHECK(kind IN ('installed','armed','source_resumed','epoch_started','released')),
 mode text NOT NULL CHECK(mode IN ('idle','armed')),
 arm_id uuid, epoch_id uuid,
 actor_id uuid, session_id uuid,
 recorded_at timestamptz NOT NULL,
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<=131072),
 record_hash text NOT NULL CHECK(record_hash ~ '^[0-9a-f]{64}$'),
 CHECK((prior_head_id IS NULL)=(prior_head_hash IS NULL)),
 CHECK((kind='installed')=(prior_head_id IS NULL)),
 CHECK((kind='installed')=(actor_id IS NULL)),
 CHECK((actor_id IS NULL)=(session_id IS NULL)),
 CHECK((mode='idle')=(arm_id IS NULL)),
 CHECK(epoch_id IS NULL OR mode='armed')
);
CREATE UNIQUE INDEX one_installation_head ON narcotics_recovery_v1.heads((true)) WHERE prior_head_id IS NULL;
CREATE FUNCTION narcotics_recovery_v1.catalog_projection() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE description_value text;projection jsonb;
BEGIN
 SELECT d.description INTO STRICT description_value FROM pg_namespace n
 JOIN pg_description d ON d.objoid=n.oid AND d.classoid='pg_namespace'::regclass AND d.objsubid=0
 WHERE n.nspname='narcotics_recovery_v1'AND n.nspowner='postgres'::regrole;
 IF description_value IS NULL OR octet_length(description_value)>2048 THEN
 RAISE EXCEPTION 'narcotics_recovery_projection_invalid' USING ERRCODE='42501';END IF;
 projection:=description_value::jsonb;
 IF projection::text IS DISTINCT FROM description_value OR jsonb_typeof(projection)<>'object'
 OR(SELECT count(*)FROM jsonb_object_keys(projection))<>7
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(projection)k WHERE k NOT IN ('schema_version','domain','mode','head_id','head_hash','arm_id','epoch_id'))
 OR(projection->'schema_version')::text IS DISTINCT FROM'1'
 OR projection->>'domain'IS DISTINCT FROM'lrv-narcotics-recovery-mode-v1'
 OR jsonb_typeof(projection->'mode')IS DISTINCT FROM'string'OR projection->>'mode'NOT IN ('idle','armed')
 OR jsonb_typeof(projection->'head_hash')IS DISTINCT FROM'string'OR projection->>'head_hash'!~'^[0-9a-f]{64}$' THEN
 RAISE EXCEPTION 'narcotics_recovery_projection_invalid' USING ERRCODE='42501';END IF;
 -- Keep the before-frontier reader catalog-only with no mutable helper call.
 IF jsonb_typeof(projection->'head_id')IS DISTINCT FROM'string'
 OR projection->>'head_id'!~'^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
 OR(projection->'arm_id'<>'null'::jsonb AND(jsonb_typeof(projection->'arm_id')IS DISTINCT FROM'string'OR projection->>'arm_id'!~'^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'))
 OR(projection->'epoch_id'<>'null'::jsonb AND(jsonb_typeof(projection->'epoch_id')IS DISTINCT FROM'string'OR projection->>'epoch_id'!~'^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'))THEN
 RAISE EXCEPTION 'narcotics_recovery_projection_invalid' USING ERRCODE='42501';END IF;
 IF(projection->>'mode'='idle')IS DISTINCT FROM(projection->'arm_id'='null'::jsonb)
 OR(projection->'epoch_id'<>'null'::jsonb AND projection->>'mode'<>'armed') THEN
 RAISE EXCEPTION 'narcotics_recovery_projection_invalid' USING ERRCODE='42501';END IF;
 RETURN projection;
END $$;
CREATE FUNCTION narcotics_recovery_v1.projection_of(p_document jsonb,p_hash text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('schema_version',1,'domain','lrv-narcotics-recovery-mode-v1',
 'head_id',p_document->'head_id','head_hash',p_hash,'mode',p_document->'mode','arm_id',p_document->'arm_id','epoch_id',p_document->'epoch_id')
$$;
CREATE FUNCTION narcotics_recovery_v1.require_head() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE projection jsonb;row_value narcotics_recovery_v1.heads;prior_value narcotics_recovery_v1.heads;total integer:=0;root_count integer:=0;leaf_count integer:=0;selected jsonb;
BEGIN
 -- This function is a POST-frontier check. Its catalog-only caller must never
 -- inspect this audit relation before the complete original121 frontier.
 PERFORM controlled_count_entry_v1.assert_read_frontier();
 PERFORM narcotics_register_v1.require_module();
 projection:=narcotics_recovery_v1.catalog_projection();
 FOR row_value IN SELECT h.*FROM narcotics_recovery_v1.heads h ORDER BY h.recorded_at,h.head_id LIMIT 4097 LOOP
  total:=total+1;
  IF total>4096 THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
  PERFORM narcotics_register_v1.keys(row_value.document,ARRAY['schema_version','domain','head_id','prior_head_id','prior_head_hash','kind','mode','arm_id','epoch_id','actor_id','session_id','recorded_at','body']);
  IF NOT isfinite(row_value.recorded_at) OR(row_value.document->'schema_version')::text IS DISTINCT FROM'1'
  OR row_value.document->>'domain'IS DISTINCT FROM'lrv-narcotics-recovery-head-v1'
  OR row_value.document->'head_id'IS DISTINCT FROM to_jsonb(row_value.head_id)
  OR row_value.document->'prior_head_id'IS DISTINCT FROM coalesce(to_jsonb(row_value.prior_head_id),'null'::jsonb)
  OR row_value.document->'prior_head_hash'IS DISTINCT FROM coalesce(to_jsonb(row_value.prior_head_hash),'null'::jsonb)
  OR row_value.document->>'kind'IS DISTINCT FROM row_value.kind OR row_value.document->>'mode'IS DISTINCT FROM row_value.mode
  OR row_value.document->'arm_id'IS DISTINCT FROM coalesce(to_jsonb(row_value.arm_id),'null'::jsonb)
  OR row_value.document->'epoch_id'IS DISTINCT FROM coalesce(to_jsonb(row_value.epoch_id),'null'::jsonb)
  OR row_value.document->'actor_id'IS DISTINCT FROM coalesce(to_jsonb(row_value.actor_id),'null'::jsonb)
  OR row_value.document->'session_id'IS DISTINCT FROM coalesce(to_jsonb(row_value.session_id),'null'::jsonb)
  OR row_value.document->>'recorded_at'IS DISTINCT FROM narcotics_register_v1.utc(row_value.recorded_at)
  OR jsonb_typeof(row_value.document->'body')IS DISTINCT FROM'object'
  OR row_value.record_hash IS DISTINCT FROM narcotics_register_v1.hash('narcotics-recovery-head-v1',row_value.document) THEN
  RAISE EXCEPTION 'narcotics_recovery_history_invalid' USING ERRCODE='23514';END IF;
  IF row_value.prior_head_id IS NULL THEN
   root_count:=root_count+1;
   IF row_value.mode<>'idle'OR row_value.epoch_id IS NOT NULL THEN RAISE EXCEPTION 'narcotics_recovery_history_invalid';END IF;
  ELSE
   SELECT *INTO STRICT prior_value FROM narcotics_recovery_v1.heads h WHERE h.head_id=row_value.prior_head_id;
   IF prior_value.record_hash<>row_value.prior_head_hash OR prior_value.recorded_at>row_value.recorded_at THEN
   RAISE EXCEPTION 'narcotics_recovery_history_invalid' USING ERRCODE='23514';END IF;
   IF row_value.kind='armed'AND(prior_value.mode<>'idle'OR row_value.mode<>'armed'OR row_value.arm_id IS DISTINCT FROM row_value.head_id OR row_value.epoch_id IS NOT NULL)
   OR row_value.kind='epoch_started'AND(prior_value.mode<>'armed'OR row_value.mode<>'armed'OR row_value.arm_id IS DISTINCT FROM prior_value.arm_id OR row_value.epoch_id IS DISTINCT FROM row_value.head_id)
   OR row_value.kind IN ('source_resumed','released')AND(prior_value.mode<>'armed'OR row_value.mode<>'idle'OR row_value.epoch_id IS NOT NULL) THEN
   RAISE EXCEPTION 'narcotics_recovery_history_invalid' USING ERRCODE='23514';END IF;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM narcotics_recovery_v1.heads h WHERE h.prior_head_id=row_value.head_id)THEN
   leaf_count:=leaf_count+1;
   IF narcotics_recovery_v1.projection_of(row_value.document,row_value.record_hash)IS DISTINCT FROM projection THEN
   RAISE EXCEPTION 'narcotics_recovery_projection_invalid' USING ERRCODE='23514';END IF;
   selected:=row_value.document||jsonb_build_object('record_hash',row_value.record_hash);
  END IF;
 END LOOP;
 IF total=0 OR root_count<>1 OR leaf_count<>1 OR selected IS NULL THEN
 RAISE EXCEPTION 'narcotics_recovery_history_invalid' USING ERRCODE='23514';END IF;
 RETURN selected;
END $$;
CREATE FUNCTION narcotics_recovery_v1.require_exclusive_admission() RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=pg_backend_pid()AND l.locktype='advisory'
 AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database())AND l.classid=90271190::oid AND l.objid=0::oid AND l.objsubid=2 AND l.mode='ExclusiveLock'AND l.granted) THEN
 RAISE EXCEPTION 'narcotics_recovery_admission_invalid' USING ERRCODE='42501';END IF;
END $$;
CREATE FUNCTION narcotics_recovery_v1.enter_recovery() RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 -- Refuse a shared-to-exclusive upgrade before any admission/practice wait.
 IF EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=pg_backend_pid()AND l.locktype='advisory'
 AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database())AND l.classid=90271190::oid AND l.objid=0::oid AND l.objsubid=2 AND l.mode='ShareLock'AND l.granted)
 AND NOT EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=pg_backend_pid()AND l.locktype='advisory'
 AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database())AND l.classid=90271190::oid AND l.objid=0::oid AND l.objsubid=2 AND l.mode='ExclusiveLock'AND l.granted)THEN
 RAISE EXCEPTION 'narcotics_recovery_admission_invalid' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(90271190,0);
 PERFORM pg_advisory_xact_lock(90271040,0);
 PERFORM controlled_count_entry_v1.acquire_shared_product_relation_frontier();
 PERFORM controlled_count_entry_v1.require_bound_module();
 PERFORM narcotics_register_v1.require_module();
END $$;
CREATE FUNCTION narcotics_recovery_v1.append_head(p_kind text,p_id uuid,p_actor uuid,p_body jsonb,p_expected_id uuid,p_expected_hash text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE prior_value jsonb;identity_value jsonb;document_value jsonb;projection jsonb;hash_value text;mode_value text;arm_value uuid;epoch_value uuid;at_value timestamptz;
BEGIN
 PERFORM narcotics_recovery_v1.require_exclusive_admission();
 prior_value:=narcotics_recovery_v1.require_head();identity_value:=narcotics_register_v1.identity(p_actor,true);
 IF prior_value->>'head_id'IS DISTINCT FROM p_expected_id::text OR prior_value->>'record_hash'IS DISTINCT FROM p_expected_hash
 OR p_id IS NULL OR p_id='00000000-0000-0000-0000-000000000000'::uuid
 OR jsonb_typeof(p_body)IS DISTINCT FROM'object'OR octet_length(p_body::text)>65536 THEN
 RAISE EXCEPTION 'narcotics_recovery_head_changed' USING ERRCODE='PT409';END IF;
 CASE p_kind
 WHEN 'armed'THEN
  IF prior_value->>'mode'<>'idle'THEN RAISE EXCEPTION 'narcotics_recovery_already_armed';END IF;
  mode_value:='armed';arm_value:=p_id;
 WHEN 'epoch_started'THEN
  IF prior_value->>'mode'<>'armed'THEN RAISE EXCEPTION 'narcotics_recovery_not_armed';END IF;
  mode_value:='armed';arm_value:=(prior_value->>'arm_id')::uuid;epoch_value:=p_id;
 WHEN 'source_resumed','released'THEN
  IF prior_value->>'mode'<>'armed'THEN RAISE EXCEPTION 'narcotics_recovery_not_armed';END IF;
  mode_value:='idle';
 ELSE RAISE EXCEPTION 'narcotics_recovery_transition_invalid';END CASE;
 at_value:=clock_timestamp();
 document_value:=jsonb_build_object('schema_version',1,'domain','lrv-narcotics-recovery-head-v1','head_id',p_id,
 'prior_head_id',p_expected_id,'prior_head_hash',p_expected_hash,'kind',p_kind,'mode',mode_value,'arm_id',arm_value,'epoch_id',epoch_value,
 'actor_id',p_actor,'session_id',identity_value->'session_id','recorded_at',narcotics_register_v1.utc(at_value),'body',p_body);
 hash_value:=narcotics_register_v1.hash('narcotics-recovery-head-v1',document_value);
 INSERT INTO narcotics_recovery_v1.heads VALUES(p_id,p_expected_id,p_expected_hash,p_kind,mode_value,arm_value,epoch_value,p_actor,(identity_value->>'session_id')::uuid,at_value,document_value,hash_value);
 projection:=narcotics_recovery_v1.projection_of(document_value,hash_value);
 EXECUTE format('COMMENT ON SCHEMA narcotics_recovery_v1 IS %L',projection::text);
 RETURN narcotics_recovery_v1.require_head();
END $$;
CREATE FUNCTION narcotics_recovery_v1.latest_epoch(p_head jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE row_value narcotics_recovery_v1.heads;prior_hash text;depth_value integer:=0;
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();
 -- The caller has validated the entire module and head inventory. Bind the
 -- supplied complete document again, then follow actual ancestry, not dates.
 SELECT *INTO STRICT row_value FROM narcotics_recovery_v1.heads h WHERE h.head_id=(p_head->>'head_id')::uuid;
 IF p_head::text IS DISTINCT FROM(row_value.document||jsonb_build_object('record_hash',row_value.record_hash))::text
 OR narcotics_recovery_v1.projection_of(row_value.document,row_value.record_hash)IS DISTINCT FROM narcotics_recovery_v1.catalog_projection()THEN
 RAISE EXCEPTION 'narcotics_recovery_history_invalid' USING ERRCODE='23514';END IF;
 LOOP
  depth_value:=depth_value+1;
  IF depth_value>4096 OR row_value.record_hash IS DISTINCT FROM narcotics_register_v1.hash('narcotics-recovery-head-v1',row_value.document)THEN
  RAISE EXCEPTION 'narcotics_recovery_history_invalid' USING ERRCODE='23514';END IF;
  IF row_value.kind='epoch_started'THEN RETURN row_value.document||jsonb_build_object('record_hash',row_value.record_hash);END IF;
  IF row_value.prior_head_id IS NULL THEN RETURN NULL;END IF;
  prior_hash:=row_value.prior_head_hash;
  SELECT *INTO STRICT row_value FROM narcotics_recovery_v1.heads h WHERE h.head_id=row_value.prior_head_id;
  IF row_value.record_hash IS DISTINCT FROM prior_hash THEN
  RAISE EXCEPTION 'narcotics_recovery_history_invalid' USING ERRCODE='23514';END IF;
 END LOOP;
END $$;
CREATE FUNCTION narcotics_recovery_v1.post_frontier_session_required(p_head jsonb) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE epoch_value jsonb;identity_value jsonb;actor_value uuid;
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();
 epoch_value:=narcotics_recovery_v1.latest_epoch(p_head);
 IF epoch_value IS NULL THEN RETURN;END IF;
 IF p_head->>'mode'='armed'AND p_head->'epoch_id'<>'null'::jsonb
 AND epoch_value#>'{body,native_receiver}'IS DISTINCT FROM narcotics_recovery_v1.server_identity()THEN
 RAISE EXCEPTION 'narcotics_recovery_receiver_changed' USING ERRCODE='42501';END IF;
 actor_value:=auth.uid();identity_value:=narcotics_register_v1.identity(actor_value,false);
 IF NOT EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=(identity_value->>'session_id')::uuid AND s.user_id=actor_value
  AND s.created_at>(epoch_value->>'recorded_at')::timestamptz
  AND(s.not_after IS NULL OR s.not_after>clock_timestamp()))THEN
 RAISE EXCEPTION 'narcotics_recovery_fresh_session_required' USING ERRCODE='42501';END IF;
 -- This is a lasting session watermark, including after release. Ordinary
 -- server restarts do not invalidate sessions created after recovery.
END $$;
-- Prospective recovery control receipts. Not included in the release builder
-- until the complete coordinator and genuine populated restore proof pass.
CREATE TABLE narcotics_recovery_v1.operations (
 operation_id uuid PRIMARY KEY, actor_id uuid NOT NULL, action text NOT NULL,
 state text NOT NULL CHECK(state IN ('saved','abandoned')),
 session_id uuid NOT NULL, recorded_at timestamptz NOT NULL,
 original_request jsonb, request_hash text, receipt jsonb,
 document jsonb NOT NULL, record_hash text NOT NULL,
 CHECK(action IN ('arm','backup_prepare','source_resume','begin_epoch','start_count','preserve_evidence','acknowledge_evidence','release')),
 CHECK((state='saved'AND original_request IS NOT NULL AND request_hash IS NOT NULL AND receipt IS NOT NULL)
    OR(state='abandoned'AND original_request IS NULL AND request_hash IS NULL AND receipt IS NULL)),
 CHECK(request_hash IS NULL OR request_hash~'^[0-9a-f]{64}$'),
 CHECK(record_hash~'^[0-9a-f]{64}$'),
 CHECK(octet_length(document::text)<=8388608)
);
CREATE FUNCTION narcotics_recovery_v1.operation_action(p_value jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF jsonb_typeof(p_value)IS DISTINCT FROM'string'OR p_value#>>'{}'NOT IN
 ('arm','backup_prepare','source_resume','begin_epoch','start_count','preserve_evidence','acknowledge_evidence','release')THEN
 RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 RETURN p_value#>>'{}';
END $$;
CREATE FUNCTION narcotics_recovery_v1.saved_operation(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE row_value narcotics_recovery_v1.operations;expected jsonb;expected_receipt jsonb;request_value jsonb;
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();
 PERFORM narcotics_recovery_v1.require_exclusive_admission();
 SELECT *INTO row_value FROM narcotics_recovery_v1.operations o WHERE o.operation_id=p_id;
 IF NOT FOUND THEN RETURN NULL;END IF;
 expected:=jsonb_build_object('schema_version',1,'domain','lrv-narcotics-recovery-operation-v1',
  'operation_id',row_value.operation_id,'actor_id',row_value.actor_id,'action',row_value.action,'state',row_value.state,
  'session_id',row_value.session_id,'recorded_at',narcotics_register_v1.utc(row_value.recorded_at),
  'original_request',row_value.original_request,'request_hash',row_value.request_hash,'receipt',row_value.receipt);
 IF expected::text IS DISTINCT FROM row_value.document::text
 OR row_value.record_hash IS DISTINCT FROM narcotics_register_v1.hash('narcotics-recovery-operation-v1',expected)
 OR NOT isfinite(row_value.recorded_at)
 OR(row_value.state='saved'AND row_value.request_hash IS DISTINCT FROM narcotics_register_v1.hash('narcotics-recovery-request-v1',row_value.original_request))THEN
 RAISE EXCEPTION 'narcotics_recovery_history_invalid' USING ERRCODE='23514';END IF;
 IF row_value.state='saved'THEN
  request_value:=row_value.original_request;
  PERFORM narcotics_register_v1.keys(request_value,ARRAY['schema_version','actor_id','operation_id','action','expected_head_id','expected_head_hash','data']);
  PERFORM narcotics_register_v1.uuid_value(request_value->'expected_head_id');
  PERFORM narcotics_register_v1.keys(row_value.receipt,ARRAY['schema_version','operation_id','actor_id','action','state','request_hash','data','receipt_hash']);
  expected_receipt:=jsonb_build_object('schema_version',1,'operation_id',row_value.operation_id,'actor_id',row_value.actor_id,
   'action',row_value.action,'state','saved','request_hash',row_value.request_hash,'data',row_value.receipt->'data');
  expected_receipt:=expected_receipt||jsonb_build_object('receipt_hash',narcotics_register_v1.hash('narcotics-recovery-receipt-v1',expected_receipt));
  IF(request_value->'schema_version')::text IS DISTINCT FROM'1'
  OR request_value->'actor_id'IS DISTINCT FROM to_jsonb(row_value.actor_id)
  OR request_value->'operation_id'IS DISTINCT FROM to_jsonb(row_value.operation_id)
  OR request_value->>'action'IS DISTINCT FROM row_value.action
  OR jsonb_typeof(request_value->'data')IS DISTINCT FROM'object'OR octet_length(request_value::text)>4194304
  OR jsonb_typeof(request_value->'expected_head_hash')IS DISTINCT FROM'string'
  OR request_value->>'expected_head_hash'!~'^[0-9a-f]{64}$'
  OR jsonb_typeof(row_value.receipt->'data')IS DISTINCT FROM'object'OR octet_length((row_value.receipt->'data')::text)>131072
  OR expected_receipt::text IS DISTINCT FROM row_value.receipt::text THEN
  RAISE EXCEPTION 'narcotics_recovery_history_invalid' USING ERRCODE='23514';END IF;
 END IF;
 RETURN expected||jsonb_build_object('record_hash',row_value.record_hash);
END $$;
CREATE FUNCTION narcotics_recovery_v1.operation_request(p_request jsonb,p_action text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actor_value uuid;operation_value uuid;saved jsonb;hash_value text;head_value jsonb;
BEGIN
 PERFORM narcotics_recovery_v1.require_exclusive_admission();
 head_value:=narcotics_recovery_v1.require_head();
 PERFORM narcotics_register_v1.keys(p_request,ARRAY['schema_version','actor_id','operation_id','action','expected_head_id','expected_head_hash','data']);
 IF(p_request->'schema_version')::text IS DISTINCT FROM'1'
 OR narcotics_recovery_v1.operation_action(p_request->'action')IS DISTINCT FROM p_action
 OR jsonb_typeof(p_request->'data')IS DISTINCT FROM'object'OR octet_length(p_request::text)>4194304
 OR jsonb_typeof(p_request->'expected_head_hash')IS DISTINCT FROM'string'
 OR p_request->>'expected_head_hash'!~'^[0-9a-f]{64}$'THEN
 RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 actor_value:=narcotics_register_v1.uuid_value(p_request->'actor_id');
 operation_value:=narcotics_register_v1.uuid_value(p_request->'operation_id');
 PERFORM narcotics_register_v1.uuid_value(p_request->'expected_head_id');
 PERFORM narcotics_register_v1.identity(actor_value,p_action<>'acknowledge_evidence');
 saved:=narcotics_recovery_v1.saved_operation(operation_value);
 IF saved IS NULL THEN
  IF head_value->'head_id'IS DISTINCT FROM p_request->'expected_head_id'
  OR head_value->>'record_hash'IS DISTINCT FROM p_request->>'expected_head_hash'THEN
  RAISE EXCEPTION 'narcotics_recovery_head_changed' USING ERRCODE='PT409';END IF;
  RETURN NULL;
 END IF;
 hash_value:=narcotics_register_v1.hash('narcotics-recovery-request-v1',p_request);
 IF saved->'actor_id'IS DISTINCT FROM p_request->'actor_id'OR saved->>'action'IS DISTINCT FROM p_action
 OR saved->>'state'IS DISTINCT FROM'saved'OR saved->>'request_hash'IS DISTINCT FROM hash_value
 OR(saved->'original_request')::text IS DISTINCT FROM p_request::text THEN
 RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409';END IF;
 -- Recovered original receipts take precedence over today's changed head.
 -- This returns evidence only; it cannot reapply the original transition.
 RETURN saved->'receipt';
END $$;
CREATE FUNCTION narcotics_recovery_v1.save_operation(p_request jsonb,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actor_value uuid;operation_value uuid;identity_value jsonb;at_value timestamptz;hash_value text;receipt_value jsonb;document_value jsonb;
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();
 PERFORM narcotics_recovery_v1.require_exclusive_admission();
 actor_value:=narcotics_register_v1.uuid_value(p_request->'actor_id');
 operation_value:=narcotics_register_v1.uuid_value(p_request->'operation_id');
 identity_value:=narcotics_register_v1.identity(actor_value,p_request->>'action'<>'acknowledge_evidence');
 PERFORM narcotics_recovery_v1.operation_action(p_request->'action');
 IF jsonb_typeof(p_data)IS DISTINCT FROM'object'OR octet_length(p_data::text)>131072
 OR narcotics_recovery_v1.saved_operation(operation_value)IS NOT NULL THEN
 RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409';END IF;
 at_value:=clock_timestamp();hash_value:=narcotics_register_v1.hash('narcotics-recovery-request-v1',p_request);
 receipt_value:=jsonb_build_object('schema_version',1,'operation_id',operation_value,'actor_id',actor_value,
  'action',p_request->'action','state','saved','request_hash',hash_value,'data',p_data);
 receipt_value:=receipt_value||jsonb_build_object('receipt_hash',narcotics_register_v1.hash('narcotics-recovery-receipt-v1',receipt_value));
 document_value:=jsonb_build_object('schema_version',1,'domain','lrv-narcotics-recovery-operation-v1',
  'operation_id',operation_value,'actor_id',actor_value,'action',p_request->'action','state','saved',
  'session_id',identity_value->'session_id','recorded_at',narcotics_register_v1.utc(at_value),
  'original_request',p_request,'request_hash',hash_value,'receipt',receipt_value);
 INSERT INTO narcotics_recovery_v1.operations VALUES(operation_value,actor_value,p_request->>'action','saved',
  (identity_value->>'session_id')::uuid,at_value,p_request,hash_value,receipt_value,document_value,
  narcotics_register_v1.hash('narcotics-recovery-operation-v1',document_value));
 PERFORM narcotics_recovery_v1.saved_operation(operation_value);
 RETURN receipt_value;
END $$;
CREATE FUNCTION narcotics_recovery_v1.operation_pointer(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actor_value uuid;operation_value uuid;action_value text;saved jsonb;
BEGIN
 PERFORM narcotics_recovery_v1.require_exclusive_admission();
 PERFORM narcotics_recovery_v1.require_head();
 PERFORM narcotics_register_v1.keys(p_request,ARRAY['schema_version','actor_id','operation_id','action']);
 IF(p_request->'schema_version')::text IS DISTINCT FROM'1'THEN RAISE EXCEPTION 'narcotics_request_invalid';END IF;
 actor_value:=narcotics_register_v1.uuid_value(p_request->'actor_id');
 operation_value:=narcotics_register_v1.uuid_value(p_request->'operation_id');
 action_value:=narcotics_recovery_v1.operation_action(p_request->'action');
 PERFORM narcotics_register_v1.identity(actor_value,false);
 saved:=narcotics_recovery_v1.saved_operation(operation_value);
 IF saved IS NULL THEN RETURN jsonb_build_object('schema_version',1,'actor_id',actor_value,'operation_id',operation_value,'action',action_value,'state','pending','receipt',NULL);END IF;
 IF saved->>'actor_id'IS DISTINCT FROM actor_value::text OR saved->>'action'IS DISTINCT FROM action_value THEN
 RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409';END IF;
 RETURN jsonb_build_object('schema_version',1,'actor_id',actor_value,'operation_id',operation_value,'action',action_value,'state',saved->'state','receipt',saved->'receipt');
END $$;
CREATE FUNCTION narcotics_recovery_v1.close_operation(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE pointer_value jsonb;identity_value jsonb;document_value jsonb;at_value timestamptz;
BEGIN
 pointer_value:=narcotics_recovery_v1.operation_pointer(p_request);
 IF pointer_value->>'state'<>'pending'THEN RETURN pointer_value;END IF;
 identity_value:=narcotics_register_v1.identity((p_request->>'actor_id')::uuid,false);at_value:=clock_timestamp();
 document_value:=jsonb_build_object('schema_version',1,'domain','lrv-narcotics-recovery-operation-v1',
  'operation_id',p_request->'operation_id','actor_id',p_request->'actor_id','action',p_request->'action','state','abandoned',
  'session_id',identity_value->'session_id','recorded_at',narcotics_register_v1.utc(at_value),
  'original_request',NULL,'request_hash',NULL,'receipt',NULL);
 INSERT INTO narcotics_recovery_v1.operations VALUES((p_request->>'operation_id')::uuid,(p_request->>'actor_id')::uuid,
  p_request->>'action','abandoned',(identity_value->>'session_id')::uuid,at_value,NULL,NULL,NULL,document_value,
  narcotics_register_v1.hash('narcotics-recovery-operation-v1',document_value));
 RETURN narcotics_recovery_v1.operation_pointer(p_request);
END $$;
-- Complete prospective recovery scope, including retired/empty products and
-- historical container locations. No current-state or nonzero-quantity filter.
CREATE FUNCTION narcotics_recovery_v1.scope_inventory() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE answer jsonb;
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();
 PERFORM narcotics_recovery_v1.require_exclusive_admission();
 WITH container_locations AS MATERIALIZED(
  SELECT c.product_id,c.initial_location_id location_id FROM public.controlled_stock_containers c
  UNION SELECT c.product_id,h.location_id FROM public.controlled_stock_containers c
   JOIN public.controlled_stock_container_heads h ON h.container_id=c.id
  UNION SELECT c.product_id,t.before_location_id FROM public.controlled_stock_containers c
   JOIN public.controlled_stock_container_transitions t ON t.container_id=c.id
  UNION SELECT c.product_id,t.after_location_id FROM public.controlled_stock_containers c
   JOIN public.controlled_stock_container_transitions t ON t.container_id=c.id
 ),scope_refs AS MATERIALIZED(
  SELECT pv.product_id,ps.site_id FROM public.controlled_stock_policy_versions pv
   JOIN public.controlled_stock_policy_sites ps ON ps.policy_version_id=pv.id
  UNION SELECT product_id,controlling_site_id FROM public.controlled_stock_containers
  UNION SELECT x.product_id,l.site_id FROM container_locations x
   JOIN public.controlled_stock_locations l ON l.id=x.location_id
  UNION SELECT product_id,site_id FROM controlled_count_v1.policies
  UNION SELECT product_id,site_id FROM controlled_count_v1.cycles
  UNION SELECT product_id,site_id FROM controlled_count_v1.operations
  UNION SELECT product_id,site_id FROM controlled_count_v1.causes
  UNION SELECT product_id,site_id FROM controlled_count_v1.open_causes
  UNION SELECT product_id,site_id FROM controlled_count_v1.reconciliation_preparations
  UNION SELECT product_id,site_id FROM controlled_count_v1.operation_closures
  UNION SELECT product_id,site_id FROM controlled_stock_workflow_v1.journal
   WHERE product_id IS NOT NULL AND site_id IS NOT NULL
 ),product_refs AS MATERIALIZED(
  SELECT product_id FROM scope_refs
  UNION SELECT product_id FROM public.controlled_stock_states
  UNION SELECT product_id FROM public.controlled_stock_state_events
  UNION SELECT product_id FROM public.controlled_stock_policy_versions
  UNION SELECT product_id FROM public.controlled_stock_openings
  UNION SELECT product_id FROM public.controlled_stock_events
  UNION SELECT product_id FROM controlled_stock_workflow_v1.journal WHERE product_id IS NOT NULL
 ),bounded_products AS MATERIALIZED(
  SELECT product_id FROM product_refs ORDER BY product_id LIMIT 257
 ),bounded_scopes AS MATERIALIZED(
  SELECT product_id,site_id FROM scope_refs ORDER BY product_id,site_id LIMIT 257
 )SELECT jsonb_build_object('over_capacity',
  (SELECT count(*)>256 FROM bounded_products)OR(SELECT count(*)>256 FROM bounded_scopes),
  'products',(SELECT coalesce(jsonb_agg(product_id ORDER BY product_id),'[]'::jsonb)FROM bounded_products),
  'scopes',(SELECT coalesce(jsonb_agg(jsonb_build_object('product_id',product_id,'site_id',site_id)
   ORDER BY product_id,site_id),'[]'::jsonb)FROM bounded_scopes))INTO answer;
 IF answer->'over_capacity'IS DISTINCT FROM'false'::jsonb THEN
 RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(answer->'products')p(product_id)
  WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(answer->'scopes')s(scope)WHERE s.scope->>'product_id'=p.product_id))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(answer->'scopes')s(scope)
  WHERE NOT EXISTS(SELECT 1 FROM public.controlled_stock_sites site WHERE site.id=(s.scope->>'site_id')::uuid))THEN
 RAISE EXCEPTION 'narcotics_recovery_scope_unavailable' USING ERRCODE='PT409';END IF;
 RETURN answer-'over_capacity';
END $$;
CREATE FUNCTION narcotics_recovery_v1.capture_inventory(p_actor uuid,p_preflight boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE inventory_value jsonb;product_value jsonb;scope_value jsonb;event_value record;
 product_id_value uuid;site_id_value uuid;policy_value jsonb;boundary_value jsonb;
 manifest_value jsonb;scopes_value jsonb:='[]';answer jsonb;observers_value jsonb;
 candidate_value record;roles_value jsonb;observer_value jsonb;capability_value text;
BEGIN
 PERFORM narcotics_recovery_v1.require_exclusive_admission();
 PERFORM narcotics_recovery_v1.require_head();
 IF EXISTS(SELECT 1 FROM controlled_count_v1.pending_products)THEN
 RAISE EXCEPTION 'narcotics_recovery_unfinished_validation' USING ERRCODE='PT409';END IF;
 PERFORM narcotics_register_v1.identity(p_actor,true);
 IF p_preflight IS NULL THEN RAISE EXCEPTION 'narcotics_request_invalid';END IF;
 inventory_value:=narcotics_recovery_v1.scope_inventory();
 FOR product_value IN SELECT value FROM jsonb_array_elements(inventory_value->'products')LOOP
  product_id_value:=narcotics_register_v1.uuid_value(product_value);
  PERFORM public.controlled_stock_product_gate(p_actor,product_id_value);
  PERFORM public.controlled_stock_validate_product(product_id_value);
  -- Every retained event is validated; no recent-history cutoff is accepted.
  FOR event_value IN SELECT e.id FROM public.controlled_stock_events e
   WHERE e.product_id=product_id_value ORDER BY e.sequence LOOP
   PERFORM public.controlled_stock_validate_event(event_value.id);
  END LOOP;
 END LOOP;
 FOR scope_value IN SELECT value FROM jsonb_array_elements(inventory_value->'scopes')LOOP
  product_id_value:=(scope_value->>'product_id')::uuid;site_id_value:=(scope_value->>'site_id')::uuid;
  PERFORM narcotics_register_v1.authority(p_actor,product_id_value,site_id_value);
  boundary_value:=narcotics_recovery_v1.capture_full_boundary(product_id_value,site_id_value);
  manifest_value:=controlled_count_v1.saved_boundary_manifest(boundary_value,site_id_value);
  IF p_preflight THEN
   -- This release can reconcile one onsite available cell with the retained
   -- original correction workflow. Other physical footprints stay unarmed;
   -- they are not silently dropped or converted into a fictitious zero.
   IF jsonb_array_length(boundary_value->'cells')>1 OR jsonb_array_length(boundary_value->'containers')>1
   OR jsonb_array_length(boundary_value->'cells')<>jsonb_array_length(boundary_value->'containers')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(boundary_value->'cells')u(unit)WHERE u.unit->>'channel'IS DISTINCT FROM'available')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(boundary_value->'containers')c(container)WHERE c.container->>'kind'IS DISTINCT FROM'stock')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(boundary_value->'heads')h(head)WHERE h.head->>'status'IS DISTINCT FROM'onsite')
   OR jsonb_array_length(manifest_value->'units')>1
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(manifest_value->'units')u(unit)
    WHERE u.unit->>'channel'IS DISTINCT FROM'available')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(boundary_value->'containers')c(container)
    JOIN jsonb_array_elements(boundary_value->'heads')h(head)ON h.head->'container_id'=c.container->'id'
    JOIN jsonb_array_elements(boundary_value->'cells')cell(cell)ON cell.cell->'container_id'=c.container->'id'
    JOIN jsonb_array_elements(boundary_value->'positions')pos(position)ON pos.position->'cell_id'=cell.cell->'id'
    WHERE c.container->'controlling_site_id'=to_jsonb(site_id_value)AND h.head->>'status'<>'onsite'
     AND(pos.position->>'quantity')::numeric<>0)THEN
   RAISE EXCEPTION 'narcotics_recovery_footprint_unsupported' USING ERRCODE='PT409';END IF;
   policy_value:=controlled_count_v1.policy_history(product_id_value,site_id_value);
   IF policy_value IS NULL THEN RAISE EXCEPTION 'narcotics_recovery_count_unconfigured' USING ERRCODE='PT409';END IF;
   -- The existing two-person workflow must be usable before configuration is
   -- frozen: initiating administrator can observe/manage/prepare/execute/resolve;
   -- an independent observer can approve and confirm. No session is fabricated.
   FOREACH capability_value IN ARRAY ARRAY['observe','manage','reconciliation_prepare','reconciliation_execute','cause_resolve']LOOP
    PERFORM controlled_count_v1.current_principal(p_actor,product_id_value,site_id_value,capability_value);
   END LOOP;
   observers_value:=jsonb_build_array(controlled_count_v1.observer_candidate(p_actor,product_id_value,site_id_value));
   FOR candidate_value IN SELECT p.id FROM public.profiles p JOIN auth.users u ON u.id=p.id
    WHERE p.id<>p_actor AND p.is_active AND public.is_active_staff(p.id)AND(u.banned_until IS NULL OR u.banned_until<=clock_timestamp())
    ORDER BY p.id LOOP
    SELECT coalesce(jsonb_agg(r.role::text ORDER BY r.role::text COLLATE "C"),'[]'::jsonb)INTO roles_value
     FROM public.user_roles r WHERE r.user_id=candidate_value.id;
    IF controlled_count_v1.policy_capability_values(policy_value,roles_value,'observe')
    AND controlled_count_v1.policy_capability_values(policy_value,roles_value,'reconciliation_approve')
    AND controlled_count_v1.policy_capability_values(policy_value,roles_value,'reconciliation_confirm')THEN
     observer_value:=controlled_count_v1.observer_candidate(candidate_value.id,product_id_value,site_id_value);
     observers_value:=observers_value||jsonb_build_array(observer_value);
     EXIT WHEN jsonb_array_length(observers_value)=2;
    END IF;
   END LOOP;
   IF jsonb_array_length(observers_value)<>2 THEN
   RAISE EXCEPTION 'narcotics_recovery_two_observers_required' USING ERRCODE='PT409';END IF;
  END IF;
  scopes_value:=scopes_value||jsonb_build_array(scope_value||jsonb_build_object('boundary',boundary_value,
   'boundary_hash',narcotics_register_v1.hash('narcotics-recovery-physical-boundary-v1',boundary_value)));
  IF octet_length(scopes_value::text)>8388608 THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
 END LOOP;
 answer:=jsonb_build_object('inventory',inventory_value,'scopes',scopes_value);
 IF octet_length(answer::text)>8388608 THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
 RETURN answer;
END $$;
-- Prospective coordinator. It is deliberately outside the release assembly
-- until all controls and the genuine populated-receiver rehearsal are verified.
CREATE TABLE narcotics_recovery_v1.arms (
 arm_id uuid PRIMARY KEY REFERENCES narcotics_recovery_v1.heads(head_id),
 source_boot timestamptz NOT NULL, database_oid oid NOT NULL, database_name text NOT NULL,
 captured_at timestamptz NOT NULL, capture jsonb NOT NULL, capture_hash text NOT NULL,
 document jsonb NOT NULL, record_hash text NOT NULL,
 CHECK(octet_length(capture::text)<=8388608),CHECK(octet_length(document::text)<=8388608),
 CHECK(capture_hash~'^[0-9a-f]{64}$'),CHECK(record_hash~'^[0-9a-f]{64}$')
);
CREATE TABLE narcotics_recovery_v1.backup_markers (
 marker_id uuid PRIMARY KEY REFERENCES narcotics_recovery_v1.operations(operation_id) DEFERRABLE INITIALLY DEFERRED,
 arm_id uuid NOT NULL UNIQUE REFERENCES narcotics_recovery_v1.arms(arm_id),
 source_boot timestamptz NOT NULL, database_oid oid NOT NULL, database_name text NOT NULL,
 recorded_at timestamptz NOT NULL, document jsonb NOT NULL, record_hash text NOT NULL,
 CHECK(octet_length(document::text)<=131072),CHECK(record_hash~'^[0-9a-f]{64}$')
);
CREATE TABLE narcotics_recovery_v1.count_markers (
 -- No FK into a sealed old relation: it would add an undeclared RI trigger.
 -- The exact old cycle is checked through its complete graph before insertion.
 count_id uuid PRIMARY KEY,
 operation_id uuid NOT NULL UNIQUE REFERENCES narcotics_recovery_v1.operations(operation_id) DEFERRABLE INITIALLY DEFERRED,
 arm_id uuid NOT NULL REFERENCES narcotics_recovery_v1.arms(arm_id),
 epoch_id uuid NOT NULL REFERENCES narcotics_recovery_v1.heads(head_id),
 product_id uuid NOT NULL, site_id uuid NOT NULL,
 receiver_boot timestamptz NOT NULL, recorded_at timestamptz NOT NULL,
 document jsonb NOT NULL, record_hash text NOT NULL,
 CHECK(octet_length(document::text)<=131072),CHECK(record_hash~'^[0-9a-f]{64}$')
);
CREATE FUNCTION narcotics_recovery_v1.server_identity() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 RETURN jsonb_build_object('boot',narcotics_register_v1.utc(pg_postmaster_start_time()),
  'database_oid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),'database_name',current_database());
END $$;
CREATE FUNCTION narcotics_recovery_v1.backup_record(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE saved narcotics_recovery_v1.backup_markers;arm_value jsonb;expected_source jsonb;operation_value jsonb;
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();PERFORM narcotics_recovery_v1.require_exclusive_admission();
 SELECT *INTO STRICT saved FROM narcotics_recovery_v1.backup_markers b WHERE b.marker_id=p_id;
 arm_value:=narcotics_recovery_v1.arm_record(saved.arm_id);
 operation_value:=narcotics_recovery_v1.saved_operation(p_id);
 expected_source:=jsonb_build_object('boot',narcotics_register_v1.utc(saved.source_boot),
  'database_oid',saved.database_oid::text,'database_name',saved.database_name);
 PERFORM narcotics_register_v1.keys(saved.document,ARRAY['schema_version','domain','marker_id','arm_id','head_id','head_hash','source','recorded_at','capture_hash']);
 IF(saved.document->'schema_version')::text IS DISTINCT FROM'1'
 OR saved.document->>'domain'IS DISTINCT FROM'lrv-narcotics-backup-preparation-v1'
 OR saved.document->'marker_id'IS DISTINCT FROM to_jsonb(saved.marker_id)
 OR saved.document->'arm_id'IS DISTINCT FROM to_jsonb(saved.arm_id)
 OR saved.document->'head_id'IS DISTINCT FROM to_jsonb(saved.arm_id)
 OR NOT EXISTS(SELECT 1 FROM narcotics_recovery_v1.heads h WHERE h.head_id=saved.arm_id AND h.record_hash=saved.document->>'head_hash')
 OR saved.document->'source'IS DISTINCT FROM expected_source
 OR expected_source IS DISTINCT FROM jsonb_build_object('boot',arm_value->'source_boot','database_oid',arm_value->'database_oid','database_name',arm_value->'database_name')
 OR saved.document->>'recorded_at'IS DISTINCT FROM narcotics_register_v1.utc(saved.recorded_at)
 OR NOT isfinite(saved.recorded_at)OR saved.recorded_at<(arm_value->>'captured_at')::timestamptz
 OR saved.document->'capture_hash'IS DISTINCT FROM arm_value->'capture_hash'
 OR saved.record_hash IS DISTINCT FROM narcotics_register_v1.hash('narcotics-backup-preparation-v1',saved.document)
 OR operation_value->>'action'IS DISTINCT FROM'backup_prepare'OR operation_value->>'state'IS DISTINCT FROM'saved'
 OR operation_value#>'{receipt,data,marker}'IS DISTINCT FROM saved.document
 OR operation_value#>>'{receipt,data,marker_hash}'IS DISTINCT FROM saved.record_hash THEN
 RAISE EXCEPTION 'narcotics_recovery_history_invalid' USING ERRCODE='23514';END IF;
 RETURN saved.document||jsonb_build_object('record_hash',saved.record_hash);
END $$;
CREATE FUNCTION narcotics_recovery_v1.begin_epoch(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE receipt_value jsonb;head_value jsonb;marker_value jsonb;server_value jsonb;identity_value jsonb;capture_value jsonb;arm_value jsonb;prior_epoch jsonb;
BEGIN
 receipt_value:=narcotics_recovery_v1.operation_request(p_request,'begin_epoch');
 IF receipt_value IS NOT NULL THEN RETURN receipt_value;END IF;
 PERFORM narcotics_register_v1.keys(p_request->'data',ARRAY['marker_id','marker_hash','external_capsule_sha256','external_archive_sha256']);
 IF EXISTS(SELECT 1 FROM jsonb_each(p_request->'data')item WHERE item.key<>'marker_id'
  AND(jsonb_typeof(item.value)IS DISTINCT FROM'string'OR item.value#>>'{}'!~'^[0-9a-f]{64}$'))THEN
 RAISE EXCEPTION 'narcotics_request_invalid';END IF;
 head_value:=narcotics_recovery_v1.require_head();
 IF head_value->>'mode'<>'armed'THEN
 RAISE EXCEPTION 'narcotics_recovery_epoch_unavailable' USING ERRCODE='PT409';END IF;
 marker_value:=narcotics_recovery_v1.backup_record(narcotics_register_v1.uuid_value(p_request#>'{data,marker_id}'));
 server_value:=narcotics_recovery_v1.server_identity();
 identity_value:=narcotics_register_v1.identity((p_request->>'actor_id')::uuid,true);
 IF head_value->'epoch_id'<>'null'::jsonb THEN
  prior_epoch:=narcotics_recovery_v1.latest_epoch(head_value);
  IF prior_epoch->'epoch_id'IS DISTINCT FROM head_value->'epoch_id'
  OR prior_epoch#>'{body,native_receiver}'IS NOT DISTINCT FROM server_value
  OR prior_epoch#>'{body,operator_supplied_backup_references}'IS DISTINCT FROM p_request->'data' THEN
  RAISE EXCEPTION 'narcotics_recovery_epoch_unavailable' USING ERRCODE='PT409';END IF;
 END IF;
 -- Epoch time must strictly separate every restored session from later grants.
 IF EXISTS(SELECT 1 FROM auth.sessions s WHERE NOT isfinite(s.created_at)OR s.created_at>clock_timestamp())THEN
 RAISE EXCEPTION 'narcotics_recovery_auth_clock_invalid' USING ERRCODE='PT409';END IF;
 IF marker_value->'arm_id'IS DISTINCT FROM head_value->'arm_id'
 OR marker_value->>'record_hash'IS DISTINCT FROM p_request#>>'{data,marker_hash}'
 OR marker_value#>'{source,boot}'IS NOT DISTINCT FROM server_value->'boot'
 OR(server_value->>'boot')::timestamptz<=(marker_value->>'recorded_at')::timestamptz
 OR NOT EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=(identity_value->>'session_id')::uuid
  AND s.user_id=(p_request->>'actor_id')::uuid AND s.created_at>pg_postmaster_start_time()
  AND(s.not_after IS NULL OR s.not_after>clock_timestamp()))THEN
 RAISE EXCEPTION 'narcotics_recovery_fresh_receiver_required' USING ERRCODE='PT409';END IF;
 arm_value:=narcotics_recovery_v1.arm_record((head_value->>'arm_id')::uuid);
 capture_value:=narcotics_recovery_v1.capture_inventory((p_request->>'actor_id')::uuid,prior_epoch IS NULL);
 IF(prior_epoch IS NULL AND capture_value::text IS DISTINCT FROM(arm_value->'capture')::text)
 OR(capture_value->'inventory')::text IS DISTINCT FROM(arm_value#>'{capture,inventory}')::text THEN
 RAISE EXCEPTION 'narcotics_recovery_boundary_changed' USING ERRCODE='PT409';END IF;
 -- External file references are explicitly attributed to the operator. This
 -- database cannot prove its own dump completed, nor a future archive hash.
 -- The native runner independently binds actual dump completion and receiver
 -- startup before it admits a populated restore proof.
 head_value:=narcotics_recovery_v1.append_head('epoch_started',(p_request->>'operation_id')::uuid,(p_request->>'actor_id')::uuid,
  jsonb_build_object('marker_id',marker_value->'marker_id','marker_hash',marker_value->'record_hash',
   'native_receiver',server_value,'prior_epoch_id',prior_epoch->'epoch_id',
   'current_capture_hash',narcotics_register_v1.hash('narcotics-recovery-capture-v1',capture_value),
   'operator_supplied_backup_references',p_request->'data'),
  (p_request->>'expected_head_id')::uuid,p_request->>'expected_head_hash');
 RETURN narcotics_recovery_v1.save_operation(p_request,jsonb_build_object('head_id',head_value->'head_id','head_hash',head_value->'record_hash',
  'arm_id',head_value->'arm_id','epoch_id',head_value->'epoch_id','mode','armed','started_at',head_value->'recorded_at','native_receiver',server_value));
END $$;
CREATE FUNCTION narcotics_recovery_v1.require_epoch() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE head_value jsonb;epoch_value narcotics_recovery_v1.heads;
BEGIN
 PERFORM narcotics_recovery_v1.require_exclusive_admission();head_value:=narcotics_recovery_v1.require_head();
 IF head_value->>'mode'<>'armed'OR head_value->'epoch_id'='null'::jsonb THEN
 RAISE EXCEPTION 'narcotics_recovery_epoch_required' USING ERRCODE='PT409';END IF;
 SELECT *INTO STRICT epoch_value FROM narcotics_recovery_v1.heads h WHERE h.head_id=(head_value->>'epoch_id')::uuid;
 IF epoch_value.kind<>'epoch_started'OR epoch_value.arm_id IS DISTINCT FROM(head_value->>'arm_id')::uuid
 OR epoch_value.document#>'{body,native_receiver}'IS DISTINCT FROM narcotics_recovery_v1.server_identity()THEN
 RAISE EXCEPTION 'narcotics_recovery_receiver_changed' USING ERRCODE='PT409';END IF;
 RETURN epoch_value.document||jsonb_build_object('record_hash',epoch_value.record_hash);
END $$;
CREATE FUNCTION narcotics_recovery_v1.start_count(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE receipt_value jsonb;epoch_value jsonb;arm_value jsonb;count_request jsonb;count_receipt jsonb;
 identity_value jsonb;document_value jsonb;at_value timestamptz;inventory_value jsonb;
BEGIN
 receipt_value:=narcotics_recovery_v1.operation_request(p_request,'start_count');
 IF receipt_value IS NOT NULL THEN RETURN receipt_value;END IF;
 PERFORM narcotics_register_v1.keys(p_request->'data',ARRAY['request']);
 epoch_value:=narcotics_recovery_v1.require_epoch();
 arm_value:=narcotics_recovery_v1.arm_record((epoch_value->>'arm_id')::uuid);
 count_request:=controlled_count_v1.count_wire_request('start',p_request#>'{data,request}');
 IF count_request->'actor_id'IS DISTINCT FROM p_request->'actor_id'
 OR count_request->'operation_id'IS DISTINCT FROM p_request->'operation_id'
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(arm_value#>'{capture,inventory,scopes}')scope(value)
  WHERE scope.value->'product_id'=count_request->'product_id'AND scope.value->'site_id'=count_request->'site_id')THEN
 RAISE EXCEPTION 'narcotics_recovery_count_scope_invalid' USING ERRCODE='PT409';END IF;
 identity_value:=narcotics_register_v1.identity((p_request->>'actor_id')::uuid,true);
 IF NOT EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=(identity_value->>'session_id')::uuid
  AND s.user_id=(p_request->>'actor_id')::uuid AND s.created_at>(epoch_value->>'recorded_at')::timestamptz
  AND s.created_at>pg_postmaster_start_time()AND(s.not_after IS NULL OR s.not_after>clock_timestamp()))THEN
 RAISE EXCEPTION 'narcotics_recovery_fresh_session_required' USING ERRCODE='PT409';END IF;
 inventory_value:=narcotics_recovery_v1.scope_inventory();
 IF inventory_value::text IS DISTINCT FROM(arm_value#>'{capture,inventory}')::text THEN
 RAISE EXCEPTION 'narcotics_recovery_scope_changed' USING ERRCODE='PT409';END IF;
 -- This lane has only admission/practice int2 locks plus the full121 frontier.
 -- Do not take a hashed operation/product int8 lock before the original fresh
 -- entry guard. Existing unmarked/restored cycles cannot be relabelled.
 IF EXISTS(SELECT 1 FROM controlled_count_v1.cycles c WHERE c.count_id=(count_request->>'count_id')::uuid)
 OR EXISTS(SELECT 1 FROM controlled_count_v1.operations o WHERE o.operation_id=(count_request->>'operation_id')::uuid)
 OR EXISTS(SELECT 1 FROM controlled_count_v1.operation_closures c WHERE c.operation_id=(count_request->>'operation_id')::uuid)
 OR EXISTS(SELECT 1 FROM narcotics_recovery_v1.count_markers m WHERE m.count_id=(count_request->>'count_id')::uuid)THEN
 RAISE EXCEPTION 'narcotics_recovery_fresh_count_required' USING ERRCODE='PT409';END IF;
 count_receipt:=public.start_controlled_count_v1(count_request);
 PERFORM controlled_count_v1.validate_operation_graph((count_request->>'operation_id')::uuid);
 PERFORM controlled_count_v1.count_wire_receipt(count_receipt);
 IF count_receipt->>'action'IS DISTINCT FROM'start'
 OR count_receipt->'operation_id'IS DISTINCT FROM count_request->'operation_id'
 OR count_receipt->'count_id'IS DISTINCT FROM count_request->'count_id'
 OR count_receipt->'actor_id'IS DISTINCT FROM count_request->'actor_id'
 OR count_receipt->>'request_digest'IS DISTINCT FROM controlled_count_v1.count_wire_request_digest('start',count_request)
 OR count_receipt->>'receipt_digest'IS DISTINCT FROM controlled_count_v1.count_wire_receipt_digest(count_receipt)THEN
 RAISE EXCEPTION 'narcotics_recovery_count_receipt_invalid' USING ERRCODE='23514';END IF;
 at_value:=clock_timestamp();
 document_value:=jsonb_build_object('schema_version',1,'domain','lrv-narcotics-recovery-count-marker-v1',
  'count_id',count_request->'count_id','operation_id',p_request->'operation_id','arm_id',epoch_value->'arm_id',
  'epoch_id',epoch_value->'epoch_id','product_id',count_request->'product_id','site_id',count_request->'site_id',
  'receiver_boot',narcotics_register_v1.utc(pg_postmaster_start_time()),'recorded_at',narcotics_register_v1.utc(at_value),
  'count_receipt',count_receipt);
 -- The old count finisher sets all constraints immediate. Save our receipt
 -- before its dependent marker; both still commit or roll back together.
 receipt_value:=narcotics_recovery_v1.save_operation(p_request,jsonb_build_object('count_id',count_request->'count_id',
  'epoch_id',epoch_value->'epoch_id','count_receipt',count_receipt));
 INSERT INTO narcotics_recovery_v1.count_markers VALUES((count_request->>'count_id')::uuid,(p_request->>'operation_id')::uuid,
  (epoch_value->>'arm_id')::uuid,(epoch_value->>'epoch_id')::uuid,(count_request->>'product_id')::uuid,(count_request->>'site_id')::uuid,
  pg_postmaster_start_time(),at_value,document_value,narcotics_register_v1.hash('narcotics-recovery-count-marker-v1',document_value));
 RETURN receipt_value;
END $$;
CREATE FUNCTION narcotics_recovery_v1.arm_record(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE saved narcotics_recovery_v1.arms;expected jsonb;head_value narcotics_recovery_v1.heads;
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();
 PERFORM narcotics_recovery_v1.require_exclusive_admission();
 SELECT *INTO STRICT saved FROM narcotics_recovery_v1.arms a WHERE a.arm_id=p_id;
 SELECT *INTO STRICT head_value FROM narcotics_recovery_v1.heads h WHERE h.head_id=p_id;
 expected:=jsonb_build_object('schema_version',1,'domain','lrv-narcotics-recovery-arm-v1','arm_id',saved.arm_id,
  'source_boot',narcotics_register_v1.utc(saved.source_boot),'database_oid',saved.database_oid::text,
  'database_name',saved.database_name,'captured_at',narcotics_register_v1.utc(saved.captured_at),
  'capture',saved.capture,'capture_hash',saved.capture_hash);
 IF expected::text IS DISTINCT FROM saved.document::text
 OR saved.record_hash IS DISTINCT FROM narcotics_register_v1.hash('narcotics-recovery-arm-v1',expected)
 OR saved.capture_hash IS DISTINCT FROM narcotics_register_v1.hash('narcotics-recovery-capture-v1',saved.capture)
 OR head_value.kind<>'armed'OR head_value.document#>>'{body,capture_hash}'IS DISTINCT FROM saved.capture_hash
 OR NOT isfinite(saved.source_boot)OR NOT isfinite(saved.captured_at)OR saved.source_boot>saved.captured_at THEN
 RAISE EXCEPTION 'narcotics_recovery_history_invalid' USING ERRCODE='23514';END IF;
 RETURN expected||jsonb_build_object('record_hash',saved.record_hash);
END $$;
CREATE FUNCTION narcotics_recovery_v1.preflight(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actor_value uuid;head_value jsonb;capture_value jsonb;
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();
 PERFORM narcotics_recovery_v1.require_exclusive_admission();
 PERFORM narcotics_register_v1.keys(p_request,ARRAY['schema_version','actor_id']);
 IF(p_request->'schema_version')::text IS DISTINCT FROM'1'THEN RAISE EXCEPTION 'narcotics_request_invalid';END IF;
 actor_value:=narcotics_register_v1.uuid_value(p_request->'actor_id');
 PERFORM narcotics_register_v1.identity(actor_value,true);head_value:=narcotics_recovery_v1.require_head();
 IF head_value->>'mode'<>'idle'THEN RAISE EXCEPTION 'narcotics_recovery_already_armed' USING ERRCODE='PT409';END IF;
 capture_value:=narcotics_recovery_v1.capture_inventory(actor_value,true);
 RETURN jsonb_build_object('schema_version',1,'state','ready','head_id',head_value->'head_id','head_hash',head_value->'record_hash',
  'capture_hash',narcotics_register_v1.hash('narcotics-recovery-capture-v1',capture_value),'inventory',capture_value->'inventory');
END $$;
CREATE FUNCTION narcotics_recovery_v1.arm(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE receipt_value jsonb;capture_value jsonb;capture_hash_value text;head_value jsonb;server_value jsonb;document_value jsonb;at_value timestamptz;id_value uuid;
BEGIN
 receipt_value:=narcotics_recovery_v1.operation_request(p_request,'arm');
 IF receipt_value IS NOT NULL THEN RETURN receipt_value;END IF;
 PERFORM narcotics_register_v1.keys(p_request->'data',ARRAY['capture_hash']);
 capture_value:=narcotics_recovery_v1.capture_inventory((p_request->>'actor_id')::uuid,true);
 capture_hash_value:=narcotics_register_v1.hash('narcotics-recovery-capture-v1',capture_value);
 IF p_request#>>'{data,capture_hash}'IS DISTINCT FROM capture_hash_value THEN
 RAISE EXCEPTION 'narcotics_recovery_preflight_changed' USING ERRCODE='PT409';END IF;
 id_value:=(p_request->>'operation_id')::uuid;server_value:=narcotics_recovery_v1.server_identity();at_value:=clock_timestamp();
 head_value:=narcotics_recovery_v1.append_head('armed',id_value,(p_request->>'actor_id')::uuid,
  jsonb_build_object('capture_hash',capture_hash_value,'inventory',capture_value->'inventory','source',server_value),
  (p_request->>'expected_head_id')::uuid,p_request->>'expected_head_hash');
 document_value:=jsonb_build_object('schema_version',1,'domain','lrv-narcotics-recovery-arm-v1','arm_id',id_value,
  'source_boot',server_value->'boot','database_oid',server_value->'database_oid','database_name',server_value->'database_name',
  'captured_at',narcotics_register_v1.utc(at_value),'capture',capture_value,'capture_hash',capture_hash_value);
 INSERT INTO narcotics_recovery_v1.arms VALUES(id_value,(server_value->>'boot')::timestamptz,(server_value->>'database_oid')::oid,
  server_value->>'database_name',at_value,capture_value,capture_hash_value,document_value,narcotics_register_v1.hash('narcotics-recovery-arm-v1',document_value));
 PERFORM narcotics_recovery_v1.arm_record(id_value);
 RETURN narcotics_recovery_v1.save_operation(p_request,jsonb_build_object('head_id',head_value->'head_id',
  'head_hash',head_value->'record_hash','mode','armed','arm_id',id_value,'capture_hash',capture_hash_value));
END $$;
CREATE FUNCTION narcotics_recovery_v1.backup_prepare(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE receipt_value jsonb;head_value jsonb;arm_value jsonb;capture_value jsonb;server_value jsonb;document_value jsonb;hash_value text;at_value timestamptz;
BEGIN
 receipt_value:=narcotics_recovery_v1.operation_request(p_request,'backup_prepare');
 IF receipt_value IS NOT NULL THEN RETURN receipt_value;END IF;
 PERFORM narcotics_register_v1.keys(p_request->'data',ARRAY[]::text[]);
 head_value:=narcotics_recovery_v1.require_head();
 IF head_value->>'mode'<>'armed'OR head_value->'epoch_id'<>'null'::jsonb THEN RAISE EXCEPTION 'narcotics_recovery_backup_unavailable' USING ERRCODE='PT409';END IF;
 arm_value:=narcotics_recovery_v1.arm_record((head_value->>'arm_id')::uuid);server_value:=narcotics_recovery_v1.server_identity();
 IF server_value IS DISTINCT FROM jsonb_build_object('boot',arm_value->'source_boot','database_oid',arm_value->'database_oid','database_name',arm_value->'database_name')THEN
 RAISE EXCEPTION 'narcotics_recovery_source_changed' USING ERRCODE='PT409';END IF;
 capture_value:=narcotics_recovery_v1.capture_inventory((p_request->>'actor_id')::uuid,false);
 IF capture_value::text IS DISTINCT FROM(arm_value->'capture')::text THEN
 RAISE EXCEPTION 'narcotics_recovery_boundary_changed' USING ERRCODE='PT409';END IF;
 at_value:=clock_timestamp();
 -- This is a committed PRE-backup marker. It cannot contain its own future
 -- archive hash or claim the dump has completed. Those bindings stay external.
 document_value:=jsonb_build_object('schema_version',1,'domain','lrv-narcotics-backup-preparation-v1',
  'marker_id',p_request->'operation_id','arm_id',head_value->'arm_id','head_id',head_value->'head_id',
  'head_hash',head_value->'record_hash','source',server_value,'recorded_at',narcotics_register_v1.utc(at_value),
  'capture_hash',arm_value->'capture_hash');
 hash_value:=narcotics_register_v1.hash('narcotics-backup-preparation-v1',document_value);
 INSERT INTO narcotics_recovery_v1.backup_markers VALUES((p_request->>'operation_id')::uuid,(head_value->>'arm_id')::uuid,
  (server_value->>'boot')::timestamptz,(server_value->>'database_oid')::oid,server_value->>'database_name',at_value,document_value,hash_value);
 RETURN narcotics_recovery_v1.save_operation(p_request,jsonb_build_object('marker',document_value,'marker_hash',hash_value));
END $$;
CREATE FUNCTION narcotics_recovery_v1.source_resume(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE receipt_value jsonb;head_value jsonb;arm_value jsonb;capture_value jsonb;server_value jsonb;
BEGIN
 receipt_value:=narcotics_recovery_v1.operation_request(p_request,'source_resume');
 IF receipt_value IS NOT NULL THEN RETURN receipt_value;END IF;
 PERFORM narcotics_register_v1.keys(p_request->'data',ARRAY[]::text[]);head_value:=narcotics_recovery_v1.require_head();
 IF head_value->>'mode'<>'armed'OR head_value->'epoch_id'<>'null'::jsonb THEN
 RAISE EXCEPTION 'narcotics_recovery_source_resume_unavailable' USING ERRCODE='PT409';END IF;
 arm_value:=narcotics_recovery_v1.arm_record((head_value->>'arm_id')::uuid);server_value:=narcotics_recovery_v1.server_identity();
 IF server_value IS DISTINCT FROM jsonb_build_object('boot',arm_value->'source_boot','database_oid',arm_value->'database_oid','database_name',arm_value->'database_name')THEN
 RAISE EXCEPTION 'narcotics_recovery_source_changed' USING ERRCODE='PT409';END IF;
 capture_value:=narcotics_recovery_v1.capture_inventory((p_request->>'actor_id')::uuid,false);
 IF capture_value::text IS DISTINCT FROM(arm_value->'capture')::text THEN
 RAISE EXCEPTION 'narcotics_recovery_boundary_changed' USING ERRCODE='PT409';END IF;
 head_value:=narcotics_recovery_v1.append_head('source_resumed',(p_request->>'operation_id')::uuid,(p_request->>'actor_id')::uuid,
  jsonb_build_object('arm_id',head_value->'arm_id','unchanged_capture_hash',arm_value->'capture_hash','native_source',server_value),
  (p_request->>'expected_head_id')::uuid,p_request->>'expected_head_hash');
 RETURN narcotics_recovery_v1.save_operation(p_request,jsonb_build_object('head_id',head_value->'head_id','head_hash',head_value->'record_hash','mode','idle'));
END $$;
-- Staff-reported recovery evidence is never inserted as a lost original event.
CREATE TABLE narcotics_recovery_v1.evidence (
 evidence_id uuid PRIMARY KEY REFERENCES narcotics_recovery_v1.operations(operation_id) DEFERRABLE INITIALLY DEFERRED,
 arm_id uuid NOT NULL REFERENCES narcotics_recovery_v1.arms(arm_id),
 epoch_id uuid NOT NULL REFERENCES narcotics_recovery_v1.heads(head_id),
 product_id uuid NOT NULL,site_id uuid NOT NULL,actor_id uuid NOT NULL,session_id uuid NOT NULL,
 recorded_at timestamptz NOT NULL,reported_occurred_at timestamptz NOT NULL,
 claim text NOT NULL,filename text NOT NULL,mime text NOT NULL,
 original_bytes bytea NOT NULL CHECK(octet_length(original_bytes)BETWEEN 1 AND 2097152),
 bytes_hash text NOT NULL CHECK(bytes_hash=encode(sha256(original_bytes),'hex')),
 document jsonb NOT NULL,record_hash text NOT NULL CHECK(record_hash~'^[0-9a-f]{64}$'),
 CHECK(octet_length(document::text)<=131072)
);
CREATE TABLE narcotics_recovery_v1.acknowledgments (
 acknowledgment_id uuid PRIMARY KEY REFERENCES narcotics_recovery_v1.operations(operation_id) DEFERRABLE INITIALLY DEFERRED,
 evidence_id uuid NOT NULL REFERENCES narcotics_recovery_v1.evidence(evidence_id),
 epoch_id uuid NOT NULL REFERENCES narcotics_recovery_v1.heads(head_id),
 UNIQUE(evidence_id,epoch_id,session_id),
 evidence_hash text NOT NULL,actor_id uuid NOT NULL,session_id uuid NOT NULL,
 recorded_at timestamptz NOT NULL,review_note text NOT NULL,
 document jsonb NOT NULL,record_hash text NOT NULL CHECK(record_hash~'^[0-9a-f]{64}$'),
 CHECK(octet_length(document::text)<=131072)
);
CREATE FUNCTION narcotics_recovery_v1.fresh_identity(p_actor uuid,p_admin boolean,p_epoch jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE identity_value jsonb;
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();PERFORM narcotics_recovery_v1.require_exclusive_admission();
 identity_value:=narcotics_register_v1.identity(p_actor,p_admin);
 IF NOT EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=(identity_value->>'session_id')::uuid AND s.user_id=p_actor
  AND s.created_at>(p_epoch->>'recorded_at')::timestamptz AND s.created_at>pg_postmaster_start_time()
  AND(s.not_after IS NULL OR s.not_after>clock_timestamp()))THEN
 RAISE EXCEPTION 'narcotics_recovery_fresh_session_required' USING ERRCODE='PT409';END IF;
 RETURN identity_value;
END $$;
CREATE FUNCTION narcotics_recovery_v1.evidence_record(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE saved narcotics_recovery_v1.evidence;expected jsonb;operation_value jsonb;
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();PERFORM narcotics_recovery_v1.require_exclusive_admission();
 SELECT *INTO STRICT saved FROM narcotics_recovery_v1.evidence e WHERE e.evidence_id=p_id;
 expected:=jsonb_build_object('schema_version',1,'domain','lrv-narcotics-recovery-evidence-v1',
  'evidence_id',saved.evidence_id,'arm_id',saved.arm_id,'epoch_id',saved.epoch_id,'product_id',saved.product_id,'site_id',saved.site_id,
  'actor_id',saved.actor_id,'session_id',saved.session_id,'recorded_at',narcotics_register_v1.utc(saved.recorded_at),
  'reported_occurred_at',narcotics_register_v1.utc(saved.reported_occurred_at),'claim',saved.claim,'basis','staff_reported',
  'filename',saved.filename,'mime',saved.mime,'byte_length',octet_length(saved.original_bytes),'bytes_hash',saved.bytes_hash);
 operation_value:=narcotics_recovery_v1.saved_operation(p_id);
 PERFORM narcotics_register_v1.keys(operation_value#>'{original_request,data}',
  ARRAY['product_id','site_id','reported_occurred_at','claim','filename','mime','base64']);
 IF expected::text IS DISTINCT FROM saved.document::text
 OR saved.record_hash IS DISTINCT FROM narcotics_register_v1.hash('narcotics-recovery-evidence-v1',expected)
 OR saved.bytes_hash IS DISTINCT FROM encode(sha256(saved.original_bytes),'hex')
 OR NOT isfinite(saved.recorded_at)OR NOT isfinite(saved.reported_occurred_at)OR saved.reported_occurred_at>saved.recorded_at
 OR operation_value->>'action'IS DISTINCT FROM'preserve_evidence'OR operation_value->>'state'IS DISTINCT FROM'saved'
 OR operation_value->'actor_id'IS DISTINCT FROM to_jsonb(saved.actor_id)
 OR operation_value->'session_id'IS DISTINCT FROM to_jsonb(saved.session_id)
 OR operation_value#>'{original_request,data,product_id}'IS DISTINCT FROM to_jsonb(saved.product_id)
 OR operation_value#>'{original_request,data,site_id}'IS DISTINCT FROM to_jsonb(saved.site_id)
 OR operation_value#>>'{original_request,data,claim}'IS DISTINCT FROM saved.claim
 OR operation_value#>>'{original_request,data,filename}'IS DISTINCT FROM saved.filename
 OR operation_value#>>'{original_request,data,mime}'IS DISTINCT FROM saved.mime
 OR narcotics_register_v1.instant_value(operation_value#>'{original_request,data,reported_occurred_at}')IS DISTINCT FROM saved.reported_occurred_at
 OR operation_value#>>'{original_request,data,base64}'IS DISTINCT FROM replace(encode(saved.original_bytes,'base64'),E'\n','')
 OR operation_value#>'{receipt,data}'IS DISTINCT FROM jsonb_build_object('evidence_id',saved.evidence_id,
  'evidence_hash',saved.record_hash,'bytes_hash',saved.bytes_hash,'basis','staff_reported')THEN
 RAISE EXCEPTION 'narcotics_recovery_history_invalid' USING ERRCODE='23514';END IF;
 RETURN expected||jsonb_build_object('record_hash',saved.record_hash);
END $$;
CREATE FUNCTION narcotics_recovery_v1.read_evidence(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actor_value uuid;evidence_value jsonb;raw_value bytea;
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();PERFORM narcotics_recovery_v1.require_exclusive_admission();
 PERFORM narcotics_recovery_v1.require_head();
 PERFORM narcotics_register_v1.keys(p_request,ARRAY['schema_version','actor_id','evidence_id']);
 IF(p_request->'schema_version')::text IS DISTINCT FROM'1'THEN RAISE EXCEPTION 'narcotics_request_invalid';END IF;
 actor_value:=narcotics_register_v1.uuid_value(p_request->'actor_id');PERFORM narcotics_register_v1.identity(actor_value,false);
 evidence_value:=narcotics_recovery_v1.evidence_record(narcotics_register_v1.uuid_value(p_request->'evidence_id'));
 PERFORM controlled_count_v1.current_principal(actor_value,(evidence_value->>'product_id')::uuid,(evidence_value->>'site_id')::uuid,'read');
 SELECT e.original_bytes INTO STRICT raw_value FROM narcotics_recovery_v1.evidence e WHERE e.evidence_id=(p_request->>'evidence_id')::uuid;
 RETURN jsonb_build_object('schema_version',1,'evidence',evidence_value,'base64',replace(encode(raw_value,'base64'),E'\n',''));
END $$;
CREATE FUNCTION narcotics_recovery_v1.acknowledge_evidence(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE receipt_value jsonb;epoch_value jsonb;identity_value jsonb;evidence_value jsonb;data_value jsonb;
 document_value jsonb;note_value text;at_value timestamptz;
BEGIN
 receipt_value:=narcotics_recovery_v1.operation_request(p_request,'acknowledge_evidence');
 IF receipt_value IS NOT NULL THEN RETURN receipt_value;END IF;
 data_value:=p_request->'data';PERFORM narcotics_register_v1.keys(data_value,ARRAY['evidence_id','evidence_hash','acknowledged','review_note']);
 IF data_value->'acknowledged'IS DISTINCT FROM'true'::jsonb THEN RAISE EXCEPTION 'narcotics_request_invalid';END IF;
 epoch_value:=narcotics_recovery_v1.require_epoch();
 identity_value:=narcotics_recovery_v1.fresh_identity((p_request->>'actor_id')::uuid,false,epoch_value);
 evidence_value:=narcotics_recovery_v1.evidence_record(narcotics_register_v1.uuid_value(data_value->'evidence_id'));
 IF evidence_value->'actor_id'=p_request->'actor_id'OR evidence_value->'arm_id'IS DISTINCT FROM epoch_value->'arm_id'
 OR evidence_value->>'record_hash'IS DISTINCT FROM data_value->>'evidence_hash'THEN
 RAISE EXCEPTION 'narcotics_recovery_independent_review_required' USING ERRCODE='PT409';END IF;
 PERFORM controlled_count_v1.current_principal((p_request->>'actor_id')::uuid,
  (evidence_value->>'product_id')::uuid,(evidence_value->>'site_id')::uuid,'observe');
 note_value:=narcotics_register_v1.text_value(data_value->'review_note',2000);at_value:=clock_timestamp();
 document_value:=jsonb_build_object('schema_version',1,'domain','lrv-narcotics-recovery-acknowledgment-v1',
  'acknowledgment_id',p_request->'operation_id','epoch_id',epoch_value->'epoch_id','evidence_id',evidence_value->'evidence_id','evidence_hash',evidence_value->'record_hash',
  'actor_id',p_request->'actor_id','session_id',identity_value->'session_id','recorded_at',narcotics_register_v1.utc(at_value),
  'review_note',note_value,'meaning_version','1',
  'meaning','I reviewed this exact file and the staff-reported account. This acknowledgment does not certify the file as a recovered original database event.');
 receipt_value:=narcotics_recovery_v1.save_operation(p_request,jsonb_build_object('acknowledgment_id',p_request->'operation_id',
  'evidence_id',evidence_value->'evidence_id','evidence_hash',evidence_value->'record_hash',
  'acknowledgment_hash',narcotics_register_v1.hash('narcotics-recovery-acknowledgment-v1',document_value)));
 INSERT INTO narcotics_recovery_v1.acknowledgments VALUES((p_request->>'operation_id')::uuid,(evidence_value->>'evidence_id')::uuid,(epoch_value->>'epoch_id')::uuid,
  evidence_value->>'record_hash',(p_request->>'actor_id')::uuid,(identity_value->>'session_id')::uuid,at_value,note_value,
  document_value,narcotics_register_v1.hash('narcotics-recovery-acknowledgment-v1',document_value));
 RETURN receipt_value;
END $$;
CREATE FUNCTION narcotics_recovery_v1.acknowledgment_record(p_evidence uuid,p_epoch uuid,p_acknowledgment uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE saved narcotics_recovery_v1.acknowledgments;evidence_value jsonb;operation_value jsonb;expected jsonb;epoch_value narcotics_recovery_v1.heads;
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();PERFORM narcotics_recovery_v1.require_exclusive_admission();
 evidence_value:=narcotics_recovery_v1.evidence_record(p_evidence);
 SELECT *INTO STRICT saved FROM narcotics_recovery_v1.acknowledgments a WHERE a.evidence_id=p_evidence AND a.epoch_id=p_epoch AND a.acknowledgment_id=p_acknowledgment;
 SELECT *INTO STRICT epoch_value FROM narcotics_recovery_v1.heads h WHERE h.head_id=p_epoch;
 operation_value:=narcotics_recovery_v1.saved_operation(saved.acknowledgment_id);
 expected:=jsonb_build_object('schema_version',1,'domain','lrv-narcotics-recovery-acknowledgment-v1',
  'acknowledgment_id',saved.acknowledgment_id,'epoch_id',saved.epoch_id,'evidence_id',saved.evidence_id,'evidence_hash',saved.evidence_hash,
  'actor_id',saved.actor_id,'session_id',saved.session_id,'recorded_at',narcotics_register_v1.utc(saved.recorded_at),
  'review_note',saved.review_note,'meaning_version','1',
  'meaning','I reviewed this exact file and the staff-reported account. This acknowledgment does not certify the file as a recovered original database event.');
 PERFORM narcotics_register_v1.keys(operation_value#>'{original_request,data}',ARRAY['evidence_id','evidence_hash','acknowledged','review_note']);
 IF epoch_value.kind<>'epoch_started'OR to_jsonb(epoch_value.arm_id)IS DISTINCT FROM evidence_value->'arm_id'
 OR saved.recorded_at<=epoch_value.recorded_at
 OR operation_value#>'{original_request,expected_head_id}'IS DISTINCT FROM to_jsonb(saved.epoch_id)
 OR expected::text IS DISTINCT FROM saved.document::text
 OR saved.record_hash IS DISTINCT FROM narcotics_register_v1.hash('narcotics-recovery-acknowledgment-v1',expected)
 OR saved.evidence_hash IS DISTINCT FROM evidence_value->>'record_hash'
 OR saved.actor_id=(evidence_value->>'actor_id')::uuid
 OR NOT isfinite(saved.recorded_at)OR saved.recorded_at<(evidence_value->>'recorded_at')::timestamptz
 OR operation_value->>'action'IS DISTINCT FROM'acknowledge_evidence'OR operation_value->>'state'IS DISTINCT FROM'saved'
 OR operation_value->'actor_id'IS DISTINCT FROM to_jsonb(saved.actor_id)OR operation_value->'session_id'IS DISTINCT FROM to_jsonb(saved.session_id)
 OR operation_value#>'{original_request,data,evidence_id}'IS DISTINCT FROM to_jsonb(saved.evidence_id)
 OR operation_value#>>'{original_request,data,evidence_hash}'IS DISTINCT FROM saved.evidence_hash
 OR operation_value#>'{original_request,data,acknowledged}'IS DISTINCT FROM'true'::jsonb
 OR operation_value#>>'{original_request,data,review_note}'IS DISTINCT FROM saved.review_note
 OR operation_value#>'{receipt,data}'IS DISTINCT FROM jsonb_build_object('acknowledgment_id',saved.acknowledgment_id,
  'evidence_id',saved.evidence_id,'evidence_hash',saved.evidence_hash,'acknowledgment_hash',saved.record_hash)THEN
 RAISE EXCEPTION 'narcotics_recovery_history_invalid' USING ERRCODE='23514';END IF;
 RETURN expected||jsonb_build_object('record_hash',saved.record_hash);
END $$;
CREATE FUNCTION narcotics_recovery_v1.preserve_evidence(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE receipt_value jsonb;epoch_value jsonb;arm_value jsonb;identity_value jsonb;data_value jsonb;
 product_value uuid;site_value uuid;reported_value timestamptz;at_value timestamptz;claim_value text;
 filename_value text;mime_value text;raw_value bytea;hash_value text;document_value jsonb;
BEGIN
 receipt_value:=narcotics_recovery_v1.operation_request(p_request,'preserve_evidence');
 IF receipt_value IS NOT NULL THEN RETURN receipt_value;END IF;
 data_value:=p_request->'data';PERFORM narcotics_register_v1.keys(data_value,
  ARRAY['product_id','site_id','reported_occurred_at','claim','filename','mime','base64']);
 epoch_value:=narcotics_recovery_v1.require_epoch();
 identity_value:=narcotics_recovery_v1.fresh_identity((p_request->>'actor_id')::uuid,true,epoch_value);
 arm_value:=narcotics_recovery_v1.arm_record((epoch_value->>'arm_id')::uuid);
 product_value:=narcotics_register_v1.uuid_value(data_value->'product_id');site_value:=narcotics_register_v1.uuid_value(data_value->'site_id');
 PERFORM narcotics_register_v1.authority((p_request->>'actor_id')::uuid,product_value,site_value);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(arm_value#>'{capture,inventory,scopes}')scope(value)
  WHERE scope.value->'product_id'=to_jsonb(product_value)AND scope.value->'site_id'=to_jsonb(site_value))THEN
 RAISE EXCEPTION 'narcotics_recovery_scope_unavailable' USING ERRCODE='PT409';END IF;
 IF(SELECT count(*)FROM narcotics_recovery_v1.evidence e WHERE e.arm_id=(epoch_value->>'arm_id')::uuid)>=64 THEN
 RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
 reported_value:=narcotics_register_v1.instant_value(data_value->'reported_occurred_at');
 claim_value:=narcotics_register_v1.text_value(data_value->'claim',4000);
 filename_value:=narcotics_register_v1.text_value(data_value->'filename',200);mime_value:=narcotics_register_v1.text_value(data_value->'mime',100);
 IF filename_value~'[/\\]'OR mime_value NOT IN('application/json','text/plain','application/pdf','image/png','image/jpeg')
 OR jsonb_typeof(data_value->'base64')IS DISTINCT FROM'string'OR octet_length(data_value->>'base64')>2796204 THEN
 RAISE EXCEPTION 'narcotics_document_invalid' USING ERRCODE='22023';END IF;
 raw_value:=decode(data_value->>'base64','base64');
 IF octet_length(raw_value)NOT BETWEEN 1 AND 2097152
 OR replace(encode(raw_value,'base64'),E'\n','')IS DISTINCT FROM data_value->>'base64'THEN
 RAISE EXCEPTION 'narcotics_document_invalid' USING ERRCODE='22023';END IF;
 IF mime_value IN('application/pdf','image/png','image/jpeg')THEN
  PERFORM narcotics_register_v1.form_bytes(mime_value,data_value->>'base64');
 ELSE
  PERFORM convert_from(raw_value,'UTF8');
  IF mime_value='application/json'THEN PERFORM convert_from(raw_value,'UTF8')::jsonb;END IF;
 END IF;
 at_value:=clock_timestamp();IF reported_value>at_value THEN RAISE EXCEPTION 'narcotics_request_invalid';END IF;
 hash_value:=encode(sha256(raw_value),'hex');
 document_value:=jsonb_build_object('schema_version',1,'domain','lrv-narcotics-recovery-evidence-v1',
  'evidence_id',p_request->'operation_id','arm_id',epoch_value->'arm_id','epoch_id',epoch_value->'epoch_id',
  'product_id',product_value,'site_id',site_value,'actor_id',p_request->'actor_id','session_id',identity_value->'session_id',
  'recorded_at',narcotics_register_v1.utc(at_value),'reported_occurred_at',narcotics_register_v1.utc(reported_value),
  'claim',claim_value,'basis','staff_reported','filename',filename_value,'mime',mime_value,'byte_length',octet_length(raw_value),'bytes_hash',hash_value);
 receipt_value:=narcotics_recovery_v1.save_operation(p_request,jsonb_build_object('evidence_id',p_request->'operation_id',
  'evidence_hash',narcotics_register_v1.hash('narcotics-recovery-evidence-v1',document_value),'bytes_hash',hash_value,'basis','staff_reported'));
 INSERT INTO narcotics_recovery_v1.evidence VALUES((p_request->>'operation_id')::uuid,(epoch_value->>'arm_id')::uuid,(epoch_value->>'epoch_id')::uuid,
  product_value,site_value,(p_request->>'actor_id')::uuid,(identity_value->>'session_id')::uuid,at_value,reported_value,
  claim_value,filename_value,mime_value,raw_value,hash_value,document_value,narcotics_register_v1.hash('narcotics-recovery-evidence-v1',document_value));
 PERFORM narcotics_recovery_v1.evidence_record((p_request->>'operation_id')::uuid);
 RETURN receipt_value;
END $$;
-- Prospective release checks. Every captured scope needs a genuine fresh count;
-- original policy, expiry, quarantine and product-state gates remain in force.
CREATE FUNCTION narcotics_recovery_v1.count_marker_record(p_count uuid,p_epoch jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE saved narcotics_recovery_v1.count_markers;expected jsonb;operation_value jsonb;cycle_value controlled_count_v1.cycles;parent_operation controlled_count_v1.operations;
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();PERFORM narcotics_recovery_v1.require_exclusive_admission();
 SELECT *INTO STRICT saved FROM narcotics_recovery_v1.count_markers m WHERE m.count_id=p_count;
 PERFORM controlled_count_v1.validate_operation_graph(saved.operation_id);
 SELECT *INTO STRICT cycle_value FROM controlled_count_v1.cycles c WHERE c.count_id=p_count;
 operation_value:=narcotics_recovery_v1.saved_operation(saved.operation_id);
 SELECT *INTO STRICT parent_operation FROM controlled_count_v1.operations o WHERE o.operation_id=saved.operation_id;
 expected:=jsonb_build_object('schema_version',1,'domain','lrv-narcotics-recovery-count-marker-v1',
  'count_id',saved.count_id,'operation_id',saved.operation_id,'arm_id',saved.arm_id,'epoch_id',saved.epoch_id,
  'product_id',saved.product_id,'site_id',saved.site_id,'receiver_boot',narcotics_register_v1.utc(saved.receiver_boot),
  'recorded_at',narcotics_register_v1.utc(saved.recorded_at),'count_receipt',operation_value#>'{receipt,data,count_receipt}');
 IF expected::text IS DISTINCT FROM saved.document::text
 OR saved.record_hash IS DISTINCT FROM narcotics_register_v1.hash('narcotics-recovery-count-marker-v1',expected)
 OR saved.arm_id IS DISTINCT FROM(p_epoch->>'arm_id')::uuid OR saved.epoch_id IS DISTINCT FROM(p_epoch->>'epoch_id')::uuid
 OR saved.receiver_boot IS DISTINCT FROM pg_postmaster_start_time()
 OR saved.product_id IS DISTINCT FROM cycle_value.product_id OR saved.site_id IS DISTINCT FROM cycle_value.site_id
 OR cycle_value.start_operation_id IS DISTINCT FROM saved.operation_id
 OR NOT isfinite(saved.recorded_at)OR saved.recorded_at<cycle_value.started_at
 OR cycle_value.started_at<=(p_epoch->>'recorded_at')::timestamptz
 OR operation_value->>'action'IS DISTINCT FROM'start_count'OR operation_value->>'state'IS DISTINCT FROM'saved'
 OR parent_operation.action IS DISTINCT FROM'start'OR parent_operation.result_kind IS DISTINCT FROM'cycle'
 OR parent_operation.result_id IS DISTINCT FROM saved.count_id
 OR to_jsonb(parent_operation.actor_id)IS DISTINCT FROM operation_value->'actor_id'
 OR to_jsonb(parent_operation.original_session_id)IS DISTINCT FROM operation_value->'session_id'
 OR parent_operation.canonical_request::text IS DISTINCT FROM(operation_value#>'{original_request,data,request}')::text
 OR parent_operation.receipt::text IS DISTINCT FROM(operation_value#>'{receipt,data,count_receipt}')::text
 OR operation_value#>'{receipt,data,count_id}'IS DISTINCT FROM to_jsonb(saved.count_id)
 OR operation_value#>'{receipt,data,epoch_id}'IS DISTINCT FROM to_jsonb(saved.epoch_id)
 OR operation_value#>'{original_request,data,request,count_id}'IS DISTINCT FROM to_jsonb(saved.count_id)
 OR operation_value#>'{original_request,data,request,product_id}'IS DISTINCT FROM to_jsonb(saved.product_id)
 OR operation_value#>'{original_request,data,request,site_id}'IS DISTINCT FROM to_jsonb(saved.site_id)THEN
 RAISE EXCEPTION 'narcotics_recovery_count_marker_invalid' USING ERRCODE='23514';END IF;
 RETURN expected||jsonb_build_object('record_hash',saved.record_hash);
END $$;
CREATE FUNCTION narcotics_recovery_v1.release(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE receipt_value jsonb;epoch_value jsonb;arm_value jsonb;capture_value jsonb;scope_value jsonb;chosen_value jsonb;
 agreements_value jsonb:='[]';evidence_value record;evidence_document jsonb;acknowledgment_value jsonb;
 evidence_refs jsonb:='[]';product_value jsonb;causes_value jsonb;head_value jsonb;note_value text;scope_count integer;chosen_ack jsonb;
BEGIN
 receipt_value:=narcotics_recovery_v1.operation_request(p_request,'release');
 IF receipt_value IS NOT NULL THEN RETURN receipt_value;END IF;
 PERFORM narcotics_register_v1.keys(p_request->'data',ARRAY['agreements','acknowledgments','history_review_note']);
 IF jsonb_typeof(p_request#>'{data,agreements}')IS DISTINCT FROM'array'
 OR jsonb_array_length(p_request#>'{data,agreements}')>256 THEN RAISE EXCEPTION 'narcotics_request_invalid';END IF;
 note_value:=narcotics_register_v1.text_value(p_request#>'{data,history_review_note}',4000);
 epoch_value:=narcotics_recovery_v1.require_epoch();
 PERFORM narcotics_recovery_v1.fresh_identity((p_request->>'actor_id')::uuid,true,epoch_value);
 arm_value:=narcotics_recovery_v1.arm_record((epoch_value->>'arm_id')::uuid);
 capture_value:=narcotics_recovery_v1.capture_inventory((p_request->>'actor_id')::uuid,false);
 IF(capture_value->'inventory')::text IS DISTINCT FROM(arm_value#>'{capture,inventory}')::text THEN
 RAISE EXCEPTION 'narcotics_recovery_scope_changed' USING ERRCODE='PT409';END IF;
 scope_count:=jsonb_array_length(capture_value->'scopes');
 IF jsonb_array_length(p_request#>'{data,agreements}')<>scope_count
 OR(SELECT count(DISTINCT jsonb_build_array(item->'product_id',item->'site_id'))FROM jsonb_array_elements(p_request#>'{data,agreements}')item)<>scope_count THEN
 RAISE EXCEPTION 'narcotics_recovery_every_scope_required' USING ERRCODE='PT409';END IF;
 FOR scope_value IN SELECT value FROM jsonb_array_elements(capture_value->'scopes')LOOP
  SELECT item INTO STRICT chosen_value FROM jsonb_array_elements(p_request#>'{data,agreements}')item
   WHERE item->'product_id'=scope_value->'product_id'AND item->'site_id'=scope_value->'site_id';
  PERFORM controlled_count_v1.current_principal((p_request->>'actor_id')::uuid,
   (scope_value->>'product_id')::uuid,(scope_value->>'site_id')::uuid,'manage');
  agreements_value:=agreements_value||jsonb_build_array(narcotics_recovery_v1.agreement_required(chosen_value,scope_value,epoch_value));
 END LOOP;
 FOR product_value IN SELECT value FROM jsonb_array_elements(capture_value#>'{inventory,products}')LOOP
  causes_value:=controlled_count_v1.product_live_causes((product_value#>>'{}')::uuid);
  IF causes_value->'causes'IS DISTINCT FROM'[]'::jsonb OR causes_value->'membership'IS DISTINCT FROM'[]'::jsonb THEN
  RAISE EXCEPTION 'narcotics_recovery_unresolved_causes' USING ERRCODE='PT409';END IF;
 END LOOP;
 IF jsonb_typeof(p_request#>'{data,acknowledgments}')IS DISTINCT FROM'array'
 OR jsonb_array_length(p_request#>'{data,acknowledgments}')>64
 OR jsonb_array_length(p_request#>'{data,acknowledgments}')<>(SELECT count(*)FROM narcotics_recovery_v1.evidence e WHERE e.arm_id=(epoch_value->>'arm_id')::uuid)
 OR(SELECT count(DISTINCT value->'evidence_id')FROM jsonb_array_elements(p_request#>'{data,acknowledgments}'))<>jsonb_array_length(p_request#>'{data,acknowledgments}')THEN
 RAISE EXCEPTION 'narcotics_recovery_every_evidence_review_required' USING ERRCODE='PT409';END IF;
 IF(SELECT count(*)FROM narcotics_recovery_v1.evidence e WHERE e.arm_id=(epoch_value->>'arm_id')::uuid)>64 THEN
 RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
 FOR evidence_value IN SELECT e.evidence_id FROM narcotics_recovery_v1.evidence e
  WHERE e.arm_id=(epoch_value->>'arm_id')::uuid ORDER BY e.evidence_id LOOP
  evidence_document:=narcotics_recovery_v1.evidence_record(evidence_value.evidence_id);
  SELECT value INTO STRICT chosen_ack FROM jsonb_array_elements(p_request#>'{data,acknowledgments}')
   WHERE value->'evidence_id'=to_jsonb(evidence_value.evidence_id);
  PERFORM narcotics_register_v1.keys(chosen_ack,ARRAY['evidence_id','acknowledgment_id']);
  acknowledgment_value:=narcotics_recovery_v1.acknowledgment_record(evidence_value.evidence_id,(epoch_value->>'epoch_id')::uuid,
   narcotics_register_v1.uuid_value(chosen_ack->'acknowledgment_id'));
  PERFORM controlled_count_v1.observer_candidate((acknowledgment_value->>'actor_id')::uuid,
   (evidence_document->>'product_id')::uuid,(evidence_document->>'site_id')::uuid);
  IF NOT EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=(acknowledgment_value->>'session_id')::uuid
   AND s.user_id=(acknowledgment_value->>'actor_id')::uuid AND s.created_at>(epoch_value->>'recorded_at')::timestamptz
   AND s.created_at>pg_postmaster_start_time()AND(s.not_after IS NULL OR s.not_after>clock_timestamp()))THEN
  RAISE EXCEPTION 'narcotics_recovery_fresh_session_required' USING ERRCODE='PT409';END IF;
  evidence_refs:=evidence_refs||jsonb_build_array(jsonb_build_object('evidence_id',evidence_value.evidence_id,
   'evidence_hash',evidence_document->'record_hash','acknowledgment_id',acknowledgment_value->'acknowledgment_id',
   'acknowledgment_hash',acknowledgment_value->'record_hash'));
 END LOOP;
 IF scope_count>0 AND jsonb_array_length(evidence_refs)=0 THEN
 RAISE EXCEPTION 'narcotics_recovery_history_review_required' USING ERRCODE='PT409';END IF;
 -- The full immutable release record lives in the saved operation receipt;
 -- the bounded mode head carries hashes/references, never large boundary data.
 head_value:=narcotics_recovery_v1.append_head('released',(p_request->>'operation_id')::uuid,(p_request->>'actor_id')::uuid,
  jsonb_build_object('arm_id',epoch_value->'arm_id','epoch_id',epoch_value->'epoch_id',
   'agreements_hash',narcotics_register_v1.hash('narcotics-recovery-release-agreements-v1',agreements_value),
   'evidence_hash',narcotics_register_v1.hash('narcotics-recovery-release-evidence-v1',evidence_refs),
   'history_review_note_hash',encode(sha256(convert_to(note_value,'UTF8')),'hex'),'existing_stock_restrictions_preserved',true),
  (p_request->>'expected_head_id')::uuid,p_request->>'expected_head_hash');
 RETURN narcotics_recovery_v1.save_operation(p_request,jsonb_build_object('head_id',head_value->'head_id','head_hash',head_value->'record_hash',
  'mode','idle','arm_id',epoch_value->'arm_id','epoch_id',epoch_value->'epoch_id','agreements',agreements_value,
  'reviewed_evidence',evidence_refs,'history_review_note',note_value,'existing_stock_restrictions_preserved',true));
END $$;
CREATE FUNCTION narcotics_recovery_v1.agreement_required(p_chosen jsonb,p_scope jsonb,p_epoch jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE marker_value jsonb;outcome_value controlled_count_v1.outcomes;outcome_document jsonb;
 cycle_value controlled_count_v1.cycles;snapshot_value controlled_count_v1.snapshots;
 statement_value controlled_count_v1.statements;statement_document jsonb;policy_value jsonb;
 statement_id_value uuid;statement_session_value uuid;statement_count integer:=0;
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();PERFORM narcotics_recovery_v1.require_exclusive_admission();
 PERFORM narcotics_register_v1.keys(p_chosen,ARRAY['product_id','site_id','count_id','outcome_id']);
 IF p_chosen->'product_id'IS DISTINCT FROM p_scope->'product_id'OR p_chosen->'site_id'IS DISTINCT FROM p_scope->'site_id'THEN
 RAISE EXCEPTION 'narcotics_recovery_count_scope_invalid' USING ERRCODE='PT409';END IF;
 marker_value:=narcotics_recovery_v1.count_marker_record(narcotics_register_v1.uuid_value(p_chosen->'count_id'),p_epoch);
 IF marker_value->'product_id'IS DISTINCT FROM p_scope->'product_id'OR marker_value->'site_id'IS DISTINCT FROM p_scope->'site_id'THEN
 RAISE EXCEPTION 'narcotics_recovery_count_scope_invalid' USING ERRCODE='PT409';END IF;
 outcome_document:=controlled_count_v1.saved_result_graph('outcome',narcotics_register_v1.uuid_value(p_chosen->'outcome_id'));
 SELECT *INTO STRICT outcome_value FROM controlled_count_v1.outcomes o WHERE o.outcome_id=(p_chosen->>'outcome_id')::uuid;
 SELECT *INTO STRICT cycle_value FROM controlled_count_v1.cycles c WHERE c.count_id=(p_chosen->>'count_id')::uuid;
 SELECT *INTO STRICT snapshot_value FROM controlled_count_v1.snapshots s WHERE s.snapshot_id=cycle_value.snapshot_id;
 policy_value:=controlled_count_v1.policy_history(cycle_value.product_id,cycle_value.site_id);
 IF outcome_value.count_id IS DISTINCT FROM cycle_value.count_id OR outcome_value.snapshot_id IS DISTINCT FROM snapshot_value.snapshot_id
 OR outcome_value.kind<>'agreement'OR outcome_document#>>'{body,kind}'IS DISTINCT FROM'agreement'
 OR(outcome_document#>'{body,boundary_observation,boundary}')::text IS DISTINCT FROM(p_scope->'boundary')::text
 OR(outcome_document->>'recorded_at')::timestamptz<=(p_epoch->>'recorded_at')::timestamptz
 OR cycle_value.actor_a_id=cycle_value.actor_b_id OR snapshot_value.captured_at<=(p_epoch->>'recorded_at')::timestamptz
 OR(snapshot_value.document->'policy')::text IS DISTINCT FROM policy_value::text THEN
 RAISE EXCEPTION 'narcotics_recovery_fresh_agreement_required' USING ERRCODE='PT409';END IF;
 FOREACH statement_id_value IN ARRAY ARRAY[outcome_value.statement_a_id,outcome_value.statement_b_id]LOOP
  statement_document:=controlled_count_v1.saved_result_graph('statement',statement_id_value);
  SELECT *INTO STRICT statement_value FROM controlled_count_v1.statements s WHERE s.statement_id=statement_id_value;
  statement_session_value:=(statement_document#>>'{actor,session_id}')::uuid;
  PERFORM controlled_count_v1.observer_candidate(statement_value.actor_id,cycle_value.product_id,cycle_value.site_id);
  IF statement_value.count_id IS DISTINCT FROM cycle_value.count_id OR statement_value.snapshot_id IS DISTINCT FROM snapshot_value.snapshot_id
  OR(statement_document->>'recorded_at')::timestamptz<=(p_epoch->>'recorded_at')::timestamptz
  OR(statement_document#>>'{body,observation,observed_at}')::timestamptz<=(p_epoch->>'recorded_at')::timestamptz
  OR controlled_count_v1.observation_time_fresh(snapshot_value.captured_at,
   (statement_document#>>'{body,observation,observed_at}')::timestamptz,clock_timestamp(),(policy_value->>'max_observation_age_seconds')::integer)IS NOT TRUE
  OR NOT EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=statement_session_value AND s.user_id=statement_value.actor_id
   AND s.created_at>(p_epoch->>'recorded_at')::timestamptz AND s.created_at>pg_postmaster_start_time()
   AND(s.not_after IS NULL OR s.not_after>clock_timestamp()))THEN
  RAISE EXCEPTION 'narcotics_recovery_fresh_observations_required' USING ERRCODE='PT409';END IF;
  statement_count:=statement_count+1;
 END LOOP;
 IF statement_count<>2 THEN RAISE EXCEPTION 'narcotics_recovery_fresh_observations_required' USING ERRCODE='PT409';END IF;
 RETURN jsonb_build_object('product_id',p_scope->'product_id','site_id',p_scope->'site_id','count_id',cycle_value.count_id,
  'outcome_id',outcome_value.outcome_id,'outcome_hash',outcome_value.record_hash,'count_marker_hash',marker_value->'record_hash',
  'boundary_hash',p_scope->'boundary_hash');
END $$;
CREATE FUNCTION narcotics_recovery_v1.status(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actor_value uuid;head_value jsonb;epoch_value jsonb;arm_value jsonb;scope_value jsonb;roles_value jsonb;identity_value jsonb;fresh_value boolean:=false;latest_epoch_value jsonb;needs_epoch_value boolean:=false;
 policy_value jsonb;visible_scopes jsonb:='[]';evidence_value record;evidence_document jsonb;
 evidence_values jsonb:='[]';ack_value narcotics_recovery_v1.acknowledgments;admin_value boolean;
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();PERFORM narcotics_recovery_v1.require_exclusive_admission();
 head_value:=narcotics_recovery_v1.require_head();
 PERFORM narcotics_register_v1.keys(p_request,ARRAY['schema_version','actor_id']);
 IF(p_request->'schema_version')::text IS DISTINCT FROM'1'THEN RAISE EXCEPTION 'narcotics_request_invalid';END IF;
 actor_value:=narcotics_register_v1.uuid_value(p_request->'actor_id');identity_value:=narcotics_register_v1.identity(actor_value,false);
 latest_epoch_value:=narcotics_recovery_v1.latest_epoch(head_value);
 SELECT EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=(identity_value->>'session_id')::uuid AND s.user_id=actor_value
  AND(latest_epoch_value IS NULL OR s.created_at>(latest_epoch_value->>'recorded_at')::timestamptz)
  AND(s.not_after IS NULL OR s.not_after>clock_timestamp()))INTO fresh_value;
 SELECT coalesce(jsonb_agg(r.role::text ORDER BY r.role::text COLLATE "C"),'[]'::jsonb),coalesce(bool_or(r.role='ADMIN'),false)
  INTO roles_value,admin_value FROM public.user_roles r WHERE r.user_id=actor_value;
 IF head_value->>'mode'='armed'THEN
  arm_value:=narcotics_recovery_v1.arm_record((head_value->>'arm_id')::uuid);
  FOR scope_value IN SELECT value FROM jsonb_array_elements(arm_value#>'{capture,inventory,scopes}')LOOP
   policy_value:=controlled_count_v1.policy_history((scope_value->>'product_id')::uuid,(scope_value->>'site_id')::uuid);
   IF policy_value IS NOT NULL AND controlled_count_v1.policy_capability_values(policy_value,roles_value,'read')THEN
    visible_scopes:=visible_scopes||jsonb_build_array(scope_value);
   END IF;
  END LOOP;
  IF head_value->'epoch_id'<>'null'::jsonb THEN
   epoch_value:=latest_epoch_value;
   needs_epoch_value:=epoch_value#>'{body,native_receiver}'IS DISTINCT FROM narcotics_recovery_v1.server_identity();
   IF needs_epoch_value THEN fresh_value:=false;END IF;
   IF(SELECT count(*)FROM narcotics_recovery_v1.evidence e WHERE e.arm_id=(epoch_value->>'arm_id')::uuid)>64 THEN
   RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
   FOR evidence_value IN SELECT e.evidence_id,e.product_id,e.site_id FROM narcotics_recovery_v1.evidence e
    WHERE e.arm_id=(epoch_value->>'arm_id')::uuid ORDER BY e.recorded_at,e.evidence_id LOOP
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(visible_scopes)scope(value)
     WHERE scope.value->'product_id'=to_jsonb(evidence_value.product_id)AND scope.value->'site_id'=to_jsonb(evidence_value.site_id))THEN
     evidence_document:=narcotics_recovery_v1.evidence_record(evidence_value.evidence_id);
     SELECT *INTO ack_value FROM narcotics_recovery_v1.acknowledgments a WHERE a.evidence_id=evidence_value.evidence_id AND a.epoch_id=(epoch_value->>'epoch_id')::uuid ORDER BY a.recorded_at DESC,a.acknowledgment_id DESC LIMIT 1;
     IF FOUND THEN PERFORM narcotics_recovery_v1.acknowledgment_record(evidence_value.evidence_id,(epoch_value->>'epoch_id')::uuid,ack_value.acknowledgment_id);END IF;
     evidence_values:=evidence_values||jsonb_build_array(jsonb_build_object('evidence',evidence_document,
      'acknowledgment',CASE WHEN ack_value.acknowledgment_id IS NULL THEN NULL ELSE ack_value.document||jsonb_build_object('record_hash',ack_value.record_hash)END));
    END IF;
   END LOOP;
  END IF;
 END IF;
 RETURN jsonb_build_object('schema_version',1,'actor_id',actor_value,'session_id',identity_value->'session_id',
  'is_admin',admin_value,'fresh_session',fresh_value,'mode',head_value->'mode',
  'head_id',head_value->'head_id','head_hash',head_value->'record_hash','arm_id',head_value->'arm_id','epoch_id',head_value->'epoch_id',
  'epoch_started_at',epoch_value->'recorded_at','latest_epoch_started_at',latest_epoch_value->'recorded_at','needs_new_epoch',needs_epoch_value,'native_server',narcotics_recovery_v1.server_identity(),
  'scopes',visible_scopes,'evidence',evidence_values);
END $$;
CREATE FUNCTION narcotics_register_v1.module_properties(p_register text,p_recovery text,p_canonical_register text,p_canonical_recovery text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE result jsonb;reference_value boolean:=p_register<>p_canonical_register;
BEGIN
 SELECT jsonb_build_object(
 'schemas',(SELECT jsonb_object_agg(n.nspname,jsonb_build_object('owner',pg_get_userbyid(n.nspowner),
  'acl',(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantee,a.privilege_type),'[]'::jsonb) FROM aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner)))a))) FROM pg_namespace n WHERE n.nspname IN(p_register,p_recovery)),
 'default_acl',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'role',pg_get_userbyid(d.defaclrole),'kind',d.defaclobjtype,'acl',d.defaclacl::text) ORDER BY n.nspname,d.defaclrole,d.defaclobjtype),'[]'::jsonb) FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE n.nspname IN(p_register,p_recovery)),
 'relations',(SELECT coalesce(jsonb_object_agg(n.nspname||'.'||c.relname,jsonb_build_object(
  'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'persistence',c.relpersistence,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'options',to_jsonb(c.reloptions),'is_partition',c.relispartition,
  'dropped_columns',(SELECT count(*) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND a.attisdropped),
  'columns',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',a.attname,'number',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,
   'collation',CASE WHEN a.attcollation=0 THEN NULL ELSE(SELECT ns.nspname||'.'||co.collname FROM pg_collation co JOIN pg_namespace ns ON ns.oid=co.collnamespace WHERE co.oid=a.attcollation)END,
   'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl::text) ORDER BY a.attnum),'[]'::jsonb) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
  'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',q.conname,'kind',q.contype,'deferrable',q.condeferrable,'deferred',q.condeferred,'validated',q.convalidated,'definition',pg_get_constraintdef(q.oid,false)) ORDER BY q.conname),'[]'::jsonb) FROM pg_constraint q WHERE q.conrelid=c.oid),
  'indexes',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',ci.relname,'definition',pg_get_indexdef(i.indexrelid,0,false),'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive) ORDER BY ci.relname),'[]'::jsonb) FROM pg_index i JOIN pg_class ci ON ci.oid=i.indexrelid WHERE i.indrelid=c.oid),
  'policies',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',p.polname,'command',p.polcmd,'permissive',p.polpermissive,'roles',(SELECT jsonb_agg(CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r)END ORDER BY r) FROM unnest(p.polroles)r),'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname),'[]'::jsonb) FROM pg_policy p WHERE p.polrelid=c.oid),
  'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_get_triggerdef(t.oid,false),'enabled',t.tgenabled,'type',t.tgtype,'deferrable',t.tgdeferrable,'deferred',t.tginitdeferred) ORDER BY t.tgname),'[]'::jsonb) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal),
  -- RI trigger names contain installation OIDs. Compare every semantic RI
  -- registration instead; no observed trigger name becomes a source literal.
  'internal_triggers',(SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM(SELECT jsonb_build_object('function',p.proname,'type',t.tgtype,'enabled',t.tgenabled,'deferrable',t.tgdeferrable,'deferred',t.tginitdeferred,'constraint',q.conname,'referenced_relation',rn.nspname||'.'||rc.relname,'args',encode(t.tgargs,'hex'))value FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid LEFT JOIN pg_constraint q ON q.oid=t.tgconstraint LEFT JOIN pg_class rc ON rc.oid=t.tgconstrrelid LEFT JOIN pg_namespace rn ON rn.oid=rc.relnamespace WHERE t.tgrelid=c.oid AND t.tgisinternal)registrations),
  'acl',(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)END,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantee,a.privilege_type),'[]'::jsonb) FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a)) ORDER BY n.nspname,c.relname),'{}'::jsonb) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN(p_register,p_recovery)),
 'types',(SELECT coalesce(jsonb_object_agg(n.nspname||'.'||t.typname,jsonb_build_object('kind',t.typtype,'category',t.typcategory,'owner',pg_get_userbyid(t.typowner),'not_null',t.typnotnull,'defined',t.typisdefined,'relation',CASE WHEN t.typrelid=0 THEN NULL ELSE(SELECT rn.nspname||'.'||c.relname FROM pg_class c JOIN pg_namespace rn ON rn.oid=c.relnamespace WHERE c.oid=t.typrelid)END,'base_type',CASE WHEN t.typbasetype=0 THEN NULL ELSE format_type(t.typbasetype,t.typtypmod)END,'default',t.typdefault,'acl',t.typacl::text,
  'enum',(SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid=t.oid)) ORDER BY n.nspname,t.typname),'{}'::jsonb) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname IN(p_register,p_recovery)),
 'functions',(SELECT coalesce(jsonb_object_agg(CASE WHEN reference_value AND p.proname=ANY(ARRAY['close_narcotics_register_operation_v1','create_narcotics_register_v1','download_narcotics_form_v1','list_narcotics_registers_v1','narcotics_recovery_acknowledge_evidence_v1','narcotics_recovery_admission_v1','narcotics_recovery_arm_v1','narcotics_recovery_backup_prepare_v1','narcotics_recovery_begin_epoch_v1','narcotics_recovery_close_operation_v1','narcotics_recovery_preflight_v1','narcotics_recovery_preserve_evidence_v1','narcotics_recovery_probe_boundary_v1','narcotics_recovery_probe_gate_v1','narcotics_recovery_probe_permissions_v1','narcotics_recovery_probe_state_v1','narcotics_recovery_read_evidence_v1','narcotics_recovery_read_operation_v1','narcotics_recovery_release_v1','narcotics_recovery_source_resume_v1','narcotics_recovery_start_count_v1','narcotics_recovery_status_v1','preserve_narcotics_form_v1','read_narcotics_form_operation_v1','read_narcotics_register_v1']::text[]) THEN 'public' ELSE n.nspname END||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')',jsonb_build_object(
  'name',p.proname,'schema',CASE WHEN reference_value AND p.proname=ANY(ARRAY['close_narcotics_register_operation_v1','create_narcotics_register_v1','download_narcotics_form_v1','list_narcotics_registers_v1','narcotics_recovery_acknowledge_evidence_v1','narcotics_recovery_admission_v1','narcotics_recovery_arm_v1','narcotics_recovery_backup_prepare_v1','narcotics_recovery_begin_epoch_v1','narcotics_recovery_close_operation_v1','narcotics_recovery_preflight_v1','narcotics_recovery_preserve_evidence_v1','narcotics_recovery_probe_boundary_v1','narcotics_recovery_probe_gate_v1','narcotics_recovery_probe_permissions_v1','narcotics_recovery_probe_state_v1','narcotics_recovery_read_evidence_v1','narcotics_recovery_read_operation_v1','narcotics_recovery_release_v1','narcotics_recovery_source_resume_v1','narcotics_recovery_start_count_v1','narcotics_recovery_status_v1','preserve_narcotics_form_v1','read_narcotics_form_operation_v1','read_narcotics_register_v1']::text[]) THEN 'public' ELSE n.nspname END,
  'arg_types',oidvectortypes(p.proargtypes),'arg_names',to_jsonb(p.proargnames),'all_arg_types',(SELECT jsonb_agg(format_type(t,NULL) ORDER BY ord) FROM unnest(p.proallargtypes)WITH ORDINALITY AS types(t,ord)),
  'arg_modes',to_jsonb(p.proargmodes),'return_type',format_type(p.prorettype,NULL),'setof',p.proretset,'language',l.lanname,'volatility',p.provolatile,'definer',p.prosecdef,'strict',p.proisstrict,'leakproof',p.proleakproof,'parallel',p.proparallel,
  'kind',p.prokind,'variadic',p.provariadic::integer,'support',p.prosupport::oid::integer,'sqlbody_null',p.prosqlbody IS NULL,'owner',pg_get_userbyid(p.proowner),'cost',p.procost,'rows',p.prorows,
  'defaults',pg_get_expr(p.proargdefaults,0),'configuration',to_jsonb(p.proconfig),'probin',p.probin,'argument_count',p.pronargs,'default_count',p.pronargdefaults,
  'body_sha256',encode(sha256(convert_to(replace(replace(p.prosrc,p_register,p_canonical_register),p_recovery,p_canonical_recovery),'UTF8')),'hex'),
  'acl',(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)END,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantee,a.privilege_type),'[]'::jsonb) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a)) ORDER BY n.nspname,p.proname,oidvectortypes(p.proargtypes)),'{}'::jsonb)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname IN(p_register,p_recovery) OR(NOT reference_value AND n.nspname='public' AND p.proname ~ '^(list_narcotics_|create_narcotics_|read_narcotics_|close_narcotics_|preserve_narcotics_|download_narcotics_|narcotics_recovery_)')))
 INTO result;
 RETURN replace(replace(result::text,p_register,p_canonical_register),p_recovery,p_canonical_recovery)::jsonb;
END $$;
CREATE FUNCTION narcotics_register_v1.require_module() RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE saved narcotics_register_v1.descriptor;actual jsonb;
BEGIN
 SELECT * INTO STRICT saved FROM narcotics_register_v1.descriptor d WHERE d.revision=1;
 IF saved.definition_hash<>narcotics_register_v1.hash('narcotics-operational-module-v1',saved.definition) THEN RAISE EXCEPTION 'narcotics_module_invalid' USING ERRCODE='23514';END IF;
 actual:=narcotics_register_v1.module_properties('narcotics_register_v1','narcotics_recovery_v1','narcotics_register_v1','narcotics_recovery_v1');
 IF actual IS DISTINCT FROM saved.definition THEN RAISE EXCEPTION 'narcotics_module_invalid' USING ERRCODE='23514';END IF;
END $$;
CREATE FUNCTION narcotics_register_v1.read_terminal_count(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public,controlled_count_v1,controlled_count_entry_v1,pg_temp
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3 AS $$
declare q jsonb;principal_value jsonb;policy_value jsonb;cycle_value jsonb;snapshot_value jsonb;statement_a jsonb;statement_b jsonb;
 outcome_value jsonb;cancellation_value jsonb;terminal_policy jsonb;boundary_value jsonb;result_value jsonb;
 product_value uuid;site_value uuid;actor_value uuid;id_value uuid;count_value uuid;
begin
 perform controlled_count_entry_v1.count_entry_budget_required();
 perform controlled_count_entry_v1.acquire_static_relation_frontier();
 -- Exactly one whole metadata check, after real held frontier and before user/current-principal/saved reads.
 perform controlled_count_entry_v1.assert_read_frontier();


 q:=controlled_count_v1.count_wire_request('read',p_request);
 actor_value:=public.controlled_stock_actor((q->>'actor_id')::uuid);perform public.next_visit_review_session();
 count_value:=(q->>'count_id')::uuid;
 -- Scope-only lookup before explicit READ. No expected/participant/statement
 -- values are loaded or projected before that authority check.
 select c.product_id,c.site_id into strict product_value,site_value from controlled_count_v1.cycles c where c.count_id=count_value;
 principal_value:=controlled_count_v1.current_principal(actor_value,product_value,site_value,'read');
 cycle_value:=controlled_count_v1.saved_result_graph('cycle',count_value);
 perform controlled_count_v1.validate_operation_graph((cycle_value->>'operation_id')::uuid);
 snapshot_value:=controlled_count_v1.saved_snapshot_document((cycle_value#>>'{body,snapshot_id}')::uuid);
 select s.statement_id into id_value from controlled_count_v1.statements s where s.count_id=count_value and s.slot='A';
 if id_value is not null then statement_a:=controlled_count_v1.saved_result_graph('statement',id_value);
  perform controlled_count_v1.validate_operation_graph((statement_a->>'operation_id')::uuid);end if;
 id_value:=null;select s.statement_id into id_value from controlled_count_v1.statements s where s.count_id=count_value and s.slot='B';
 if id_value is not null then statement_b:=controlled_count_v1.saved_result_graph('statement',id_value);
  perform controlled_count_v1.validate_operation_graph((statement_b->>'operation_id')::uuid);end if;
 id_value:=null;select o.outcome_id into id_value from controlled_count_v1.outcomes o where o.count_id=count_value;
 if id_value is not null then outcome_value:=controlled_count_v1.saved_result_graph('outcome',id_value);
  perform controlled_count_v1.validate_operation_graph((outcome_value->>'operation_id')::uuid);
  terminal_policy:=controlled_count_v1.saved_policy_document((outcome_value#>>'{policy,id}')::uuid);end if;
 id_value:=null;select c.cancellation_id into id_value from controlled_count_v1.cancellations c where c.count_id=count_value;
 if id_value is not null then cancellation_value:=controlled_count_v1.saved_result_graph('cancellation',id_value);
  perform controlled_count_v1.validate_operation_graph((cancellation_value->>'operation_id')::uuid);
  terminal_policy:=controlled_count_v1.saved_policy_document((cancellation_value#>>'{policy,id}')::uuid);end if;
 if outcome_value is not null and cancellation_value is not null then
  raise exception 'count_source_invalid'using errcode='P0001',detail='',hint='';end if;
 boundary_value:=controlled_count_v1.capture_full_boundary_read(count_value,actor_value,product_value,site_value);
 principal_value:=controlled_count_v1.current_principal(actor_value,product_value,site_value,'read');
 policy_value:=controlled_count_v1.policy_history(product_value,site_value);
 result_value:=controlled_count_v1.project_count_read(principal_value,policy_value,cycle_value,snapshot_value,
  statement_a,statement_b,outcome_value,cancellation_value,terminal_policy,boundary_value,clock_timestamp());
 return result_value;
exception when others or query_canceled or assert_failure then
 raise exception 'count_request_failed'using errcode='P0001',detail='',hint='';
end $$;
CREATE FUNCTION narcotics_recovery_v1.capture_full_boundary(p_product uuid,p_site uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,controlled_count_v1,pg_temp
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3 AS $$declare source_row record;event_value uuid;row_value jsonb;rows_value jsonb;boundary_value jsonb:='{}'::jsonb;
 row_bytes bigint;class_bytes bigint;total_bytes bigint:=2;
begin
 -- Mandatory real entry identity/current source metadata/held-resource cut.
 -- No principal, source row or parent cold function is read before it.
 perform narcotics_recovery_v1.capture_guard(p_product,p_site);
 perform public.controlled_stock_validate_product(p_product);
 -- Product validation does not substitute for complete per-event validation.
 -- Walk the full retained source history, with no latest/checkpoint shortcut.
 for event_value in select e.id from public.controlled_stock_events e where e.product_id=p_product order by e.sequence loop
  perform public.controlled_stock_validate_event(event_value);
 end loop;
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.actor_id, r.writer, r.session_id, r.request_hash, r.receipt, r.recorded_at FROM public.controlled_stock_actions AS r INNER JOIN public.controlled_stock_events AS e ON e.id = r.id WHERE e.product_id = p_product ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('actions',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('actions'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('actions',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.record_id, r.pet_id, r.request, r.created_by, r.created_at FROM public.anesthesia_drug_administrations AS r WHERE r.id IN (SELECT s.source_id FROM public.stock_movement_sources AS s INNER JOIN public.inventory_movements AS m ON m.id = s.movement_id INNER JOIN public.inventory_lots AS l ON l.id = m.lot_id WHERE l.product_id = p_product AND s.writer = 'record_anesthesia_drug_administration') ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('anesthesia_drug_administrations',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('anesthesia_drug_administrations'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('anesthesia_drug_administrations',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.invoice_id, r.pet_id, r.product_id, r.description, r.quantity, r.unit_price_cents, r.amount_cents, r.created_by, r.created_at FROM public.billing_invoice_items AS r WHERE r.id IN (SELECT d.invoice_item_id FROM public.native_dispenses AS d WHERE d.id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product)) ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('billing_invoice_items',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('billing_invoice_items'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('billing_invoice_items',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.container_id, r.lot_id, r.channel, r.dispense_id, r.allocation_id, r.intake_id, r.opening_id, r.created_event_id, r.opening_quantity FROM public.controlled_stock_cells AS r INNER JOIN public.controlled_stock_containers AS c ON c.id = r.container_id WHERE c.product_id = p_product ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('cells',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('cells'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('cells',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.product_id, r.stock_unit, r.label, r.kind, r.stock_lot_id, r.controlling_site_id, r.initial_location_id, r.initial_custodian_id, r.opening_id, r.created_event_id, r.actor_id, r.session_id, r.recorded_at FROM public.controlled_stock_containers AS r WHERE r.product_id = p_product ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('containers',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('containers'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('containers',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.event_id, r.actor_id FROM public.stock_correction_sources AS r WHERE r.event_id IN (SELECT e.id FROM public.native_dispense_correction_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product)) ORDER BY r.event_id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('correction_provenance',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('correction_provenance'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('correction_provenance',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.event_id, r.writer, r.actor_id FROM public.stock_custody_sources AS r WHERE r.event_id IN (SELECT e.id FROM public.native_return_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product)) ORDER BY r.event_id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('custody_provenance',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('custody_provenance'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('custody_provenance',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.event_id, r.actor_id FROM public.stock_discrepancy_sources AS r WHERE r.event_id IN (SELECT e.id FROM public.native_return_discrepancy_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product)) ORDER BY r.event_id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('discrepancy_provenance',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('discrepancy_provenance'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('discrepancy_provenance',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.product_id, r.state, r.head_id, r.created_by, r.created_at FROM public.controlled_draft_entries AS r WHERE r.product_id = p_product ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('draft_entries',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('draft_entries'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('draft_entries',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.entry_id, r.version, r.definition, r.product_snapshot, r.action_id, r.actor_id, r.session_id, r.actor_name, r.created_at FROM public.controlled_draft_versions AS r WHERE r.entry_id IN (SELECT e.id FROM public.controlled_draft_entries AS e WHERE e.product_id = p_product) ORDER BY r.entry_id, r.version, r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('draft_versions',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('draft_versions'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('draft_versions',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.product_id, r.sequence, r.prior_event_id, r.policy_version_id, r.opening_id, r.engine_revision, r.writer, r.event_kind, r.actor_id, r.session_id, r.actor_name, r.basis, r.observed_at, r.recorded_at, r.note, r.context_hash, r.canonical_result, r.source_bundle, r.source_effects, r.clinical_snapshot, r.secondary_review_required, r.prior_record_hash, r.record_hash FROM public.controlled_stock_events AS r WHERE r.product_id = p_product ORDER BY r.sequence, r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('events',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('events'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('events',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.container_id, r.version, r.location_id, r.custodian_id, r.status, r.last_event_id FROM public.controlled_stock_container_heads AS r INNER JOIN public.controlled_stock_containers AS c ON c.id = r.container_id WHERE c.product_id = p_product ORDER BY r.container_id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('heads',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('heads'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('heads',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.event_id, r.cell_id, r.source_link_id, r.quantity_delta, r.container_version_before, r.container_version_after FROM public.controlled_stock_event_lines AS r INNER JOIN public.controlled_stock_events AS e ON e.id = r.event_id WHERE e.product_id = p_product ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('lines',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('lines'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('lines',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.site_id, r.kind, r.label, r.initial_custodian_id, r.actor_id, r.session_id, r.recorded_at FROM public.controlled_stock_locations AS r WHERE r.site_id = p_site OR r.id IN (((SELECT c.initial_location_id AS id FROM public.controlled_stock_containers AS c WHERE c.product_id = p_product UNION SELECT h.location_id FROM public.controlled_stock_container_heads AS h INNER JOIN public.controlled_stock_containers AS c ON c.id = h.container_id WHERE c.product_id = p_product) UNION SELECT t.before_location_id FROM public.controlled_stock_container_transitions AS t INNER JOIN public.controlled_stock_containers AS c ON c.id = t.container_id WHERE c.product_id = p_product) UNION SELECT t.after_location_id FROM public.controlled_stock_container_transitions AS t INNER JOIN public.controlled_stock_containers AS c ON c.id = t.container_id WHERE c.product_id = p_product) ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('locations',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('locations'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('locations',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.product_id, r.lot_number, r.expires_on, r.location, r.created_by, r.created_at FROM public.inventory_lots AS r WHERE r.product_id = p_product ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('lots',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('lots'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('lots',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.movement_id, r.writer, r.source_id, r.actor_id FROM public.stock_movement_sources AS r INNER JOIN public.inventory_movements AS m ON m.id = r.movement_id INNER JOIN public.inventory_lots AS l ON l.id = m.lot_id WHERE l.product_id = p_product ORDER BY r.movement_id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('movement_provenance',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('movement_provenance'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('movement_provenance',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.lot_id, r.quantity, r.kind, r.reason, r.created_by, r.created_at FROM public.inventory_movements AS r INNER JOIN public.inventory_lots AS l ON l.id = r.lot_id WHERE l.product_id = p_product ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('movements',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('movements'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('movements',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.dispense_id, r.lot_id, r.movement_id, r.quantity FROM public.native_dispense_allocations AS r WHERE r.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product) ORDER BY r.dispense_id, r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('native_allocations',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('native_allocations'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('native_allocations',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.event_id, r.target_event_id, r.allocation_id, r.lot_id, r.original_movement_id, r.movement_id, r.quantity FROM public.native_return_compensation_links AS r WHERE r.event_id IN (SELECT e.id FROM public.native_return_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product)) OR r.target_event_id IN (SELECT e.id FROM public.native_return_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product)) OR r.lot_id IN (SELECT l.id FROM public.inventory_lots AS l WHERE l.product_id = p_product) ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('native_compensation_links',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('native_compensation_links'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('native_compensation_links',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.authorization_id, r.pet_id, r.dispense_id, r.sequence, r.prior_event_id, r.actor_id, r.kind, r.created_at, r.record_hash, r.reviewed_context, r.document FROM public.native_dispense_correction_events AS r WHERE r.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product) ORDER BY r.dispense_id, r.sequence, r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('native_correction_events',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('native_correction_events'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('native_correction_events',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.actor_id, r.request, r.request_hash, r.result, r.created_at FROM public.native_dispense_correction_operations AS r WHERE r.id IN (SELECT e.id FROM public.native_dispense_correction_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product)) ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('native_correction_operations',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('native_correction_operations'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('native_correction_operations',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.authorization_id, r.pet_id, r.dispense_id, r.sequence, r.prior_event_id, r.actor_id, r.case_id, r.action, r.created_at, r.record_hash, r.reviewed_context, r.document FROM public.native_return_discrepancy_events AS r WHERE r.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product) ORDER BY r.dispense_id, r.sequence, r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('native_discrepancy_events',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('native_discrepancy_events'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('native_discrepancy_events',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.case_id, r.correction_id, r.resolution_id FROM public.native_return_discrepancy_correction_links AS r WHERE r.case_id IN (SELECT e.id FROM public.native_return_discrepancy_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product)) OR r.resolution_id IN (SELECT e.id FROM public.native_return_discrepancy_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product)) OR r.correction_id IN (SELECT e.id FROM public.native_return_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product)) ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('native_discrepancy_links',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('native_discrepancy_links'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('native_discrepancy_links',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.actor_id, r.request, r.request_hash, r.result, r.created_at FROM public.native_return_discrepancy_operations AS r WHERE r.id IN (SELECT e.id FROM public.native_return_discrepancy_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product)) ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('native_discrepancy_operations',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('native_discrepancy_operations'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('native_discrepancy_operations',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.authorization_id, r.pet_id, r.slot_id, r.invoice_id, r.invoice_item_id, r.quantity, r.actor_id, r.dispensed_at, r.document FROM public.native_dispenses AS r WHERE r.id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product) ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('native_dispenses',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('native_dispenses'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('native_dispenses',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.actor_id, r.operation, r.request, r.request_hash, r.result, r.created_at FROM public.native_fulfillment_operations AS r WHERE r.id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product) OR r.id IN (SELECT e.id FROM public.native_pickups AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product)) ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('native_fulfillment_operations',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('native_fulfillment_operations'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('native_fulfillment_operations',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.authorization_id, r.pet_id, r.dispense_id, r.actor_id, r.picked_up_at, r.document FROM public.native_pickups AS r WHERE r.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product) ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('native_pickups',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('native_pickups'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('native_pickups',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.pet_id, r.client_id, r.draft_id, r.document FROM public.native_prescription_authorizations AS r WHERE r.id IN (SELECT d.authorization_id FROM public.native_dispenses AS d WHERE d.id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product)) ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('native_prescription_authorizations',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('native_prescription_authorizations'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('native_prescription_authorizations',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.refill_id, r.revision, r.action, r.actor_id, r.reason, r.prior_event_id, r.before_snapshot, r.after_snapshot, r.link_context, r.created_at, r.fulfillment_reference FROM public.native_refill_events AS r WHERE r.refill_id IN (SELECT CAST(docs.document ->> 'refill_id' AS uuid) FROM (SELECT d.document FROM public.native_dispenses AS d WHERE d.id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product) UNION ALL SELECT p.document FROM public.native_pickups AS p WHERE p.id IN (SELECT p.id FROM public.native_pickups AS p WHERE p.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product))) AS docs WHERE (docs.document -> 'refill_id') IS DISTINCT FROM CAST('null' AS jsonb) UNION SELECT e.refill_id FROM public.native_refill_events AS e WHERE e.id IN (SELECT CAST(docs.document ->> 'refill_event_id' AS uuid) FROM (SELECT d.document FROM public.native_dispenses AS d WHERE d.id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product) UNION ALL SELECT p.document FROM public.native_pickups AS p WHERE p.id IN (SELECT p.id FROM public.native_pickups AS p WHERE p.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product))) AS docs WHERE (docs.document -> 'refill_event_id') IS DISTINCT FROM CAST('null' AS jsonb))) ORDER BY r.refill_id, r.revision, r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('native_refill_events',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('native_refill_events'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('native_refill_events',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.authorization_id, r.pet_id, r.dispense_id, r.sequence, r.prior_event_id, r.actor_id, r.action, r.intake_id, r.created_at, r.record_hash, r.reviewed_context, r.document FROM public.native_return_events AS r WHERE r.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product) ORDER BY r.dispense_id, r.sequence, r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('native_return_events',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('native_return_events'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('native_return_events',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.actor_id, r.request, r.request_hash, r.result, r.created_at FROM public.native_return_operations AS r WHERE r.id IN (SELECT e.id FROM public.native_return_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product)) ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('native_return_operations',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('native_return_operations'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('native_return_operations',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.version, r.actor_id, r.request, r.request_hash, r.document, r.created_at FROM public.native_return_policy_decisions AS r WHERE TRUE ORDER BY r.version, r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('native_return_policy_decisions',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('native_return_policy_decisions'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('native_return_policy_decisions',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.version, r.decision_id FROM public.native_return_policy_state AS r WHERE TRUE ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('native_return_policy_state',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('native_return_policy_state'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('native_return_policy_state',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.event_id, r.allocation_id, r.lot_id, r.movement_id, r.quantity FROM public.native_return_stock_links AS r WHERE r.event_id IN (SELECT e.id FROM public.native_return_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product)) OR r.lot_id IN (SELECT l.id FROM public.inventory_lots AS l WHERE l.product_id = p_product) ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('native_return_stock_links',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('native_return_stock_links'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('native_return_stock_links',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.product_id, r.policy_version_id, r.observed_at, r.count_evidence, r.native_custody_boundary, r.actor_id, r.session_id, r.recorded_at FROM public.controlled_stock_openings AS r WHERE r.product_id = p_product ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('opening',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('opening'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('opening',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.opening_id, r.movement_id, r.lot_id, r.quantity, r.source_snapshot FROM public.controlled_stock_opening_movements AS r INNER JOIN public.controlled_stock_openings AS o ON o.id = r.opening_id WHERE o.product_id = p_product ORDER BY r.opening_id, r.movement_id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('opening_movements',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('opening_movements'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('opening_movements',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.pet_id, r.product_id, r.lot_id, r.invoice_id, r.kind, r.historical, r.product_name, r.manufacturer, r.lot_number, r.expires_on, r.quantity, r.dose, r.route, r.site, r.veterinarian, r.veterinarian_license, r.administered_at, r.next_due_on, r.source, r.request, r.created_by, r.created_at FROM public.patient_treatments AS r WHERE r.id IN (SELECT s.source_id FROM public.stock_movement_sources AS s INNER JOIN public.inventory_movements AS m ON m.id = s.movement_id INNER JOIN public.inventory_lots AS l ON l.id = m.lot_id WHERE l.product_id = p_product AND s.writer IN ('record_patient_treatment', 'record_anesthesia_drug_administration')) ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('patient_treatments',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('patient_treatments'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('patient_treatments',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.event_id, r.actor_id FROM public.stock_pickup_sources AS r WHERE r.event_id IN (SELECT e.id FROM public.native_pickups AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product)) ORDER BY r.event_id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('pickup_provenance',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('pickup_provenance'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('pickup_provenance',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.cell_id, r.quantity FROM public.controlled_stock_positions AS r INNER JOIN public.controlled_stock_cells AS cell ON cell.id = r.cell_id INNER JOIN public.controlled_stock_containers AS c ON c.id = cell.container_id WHERE c.product_id = p_product ORDER BY r.cell_id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('positions',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('positions'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('positions',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.writer, r.actor_id, r.session_id, r.product_id, r.policy_version_id, r.state_head_id, r.opening_id, r.canonical_arguments, r.context, r.frozen, r.request_hash, r.created_at, r.expires_at FROM public.controlled_stock_preparations AS r INNER JOIN public.controlled_stock_events AS e ON e.id = r.id WHERE e.product_id = p_product ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('preparations',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('preparations'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('preparations',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.name, r.kind, r.manufacturer, r.unit, r.unit_price_cents, r.active, r.version, r.created_by, r.created_at FROM public.catalog_products AS r WHERE r.id = p_product ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('product',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('product'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('product',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.label, r.registration_evidence, r.actor_id, r.session_id, r.recorded_at FROM public.controlled_stock_sites AS r WHERE r.id = p_site OR EXISTS (SELECT 1 FROM public.controlled_stock_policy_sites AS ps INNER JOIN public.controlled_stock_policy_versions AS pv ON pv.id = ps.policy_version_id WHERE pv.product_id = p_product AND ps.site_id = r.id) OR EXISTS (SELECT 1 FROM public.controlled_stock_containers AS c WHERE c.product_id = p_product AND c.controlling_site_id = r.id) OR EXISTS (SELECT 1 FROM public.controlled_stock_locations AS l WHERE l.site_id = r.id AND l.id IN (((SELECT c.initial_location_id AS id FROM public.controlled_stock_containers AS c WHERE c.product_id = p_product UNION SELECT h.location_id FROM public.controlled_stock_container_heads AS h INNER JOIN public.controlled_stock_containers AS c ON c.id = h.container_id WHERE c.product_id = p_product) UNION SELECT t.before_location_id FROM public.controlled_stock_container_transitions AS t INNER JOIN public.controlled_stock_containers AS c ON c.id = t.container_id WHERE c.product_id = p_product) UNION SELECT t.after_location_id FROM public.controlled_stock_container_transitions AS t INNER JOIN public.controlled_stock_containers AS c ON c.id = t.container_id WHERE c.product_id = p_product)) ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('sites',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('sites'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('sites',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.event_id, r.movement_id, r.return_event_id, r.discrepancy_event_id, r.pickup_id, r.correction_event_id FROM public.controlled_stock_source_links AS r INNER JOIN public.controlled_stock_events AS e ON e.id = r.event_id WHERE e.product_id = p_product ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('source_links',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('source_links'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('source_links',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.product_id, r.head_id, r.event_version, r.last_event_id FROM public.controlled_stock_states AS r WHERE r.product_id = p_product ORDER BY r.product_id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('state',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('state'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('state',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.product_id, r.version, r.prior_event_id, r.state, r.policy_version_id, r.opening_id, r.actor_id, r.session_id, r.reason, r.recorded_at FROM public.controlled_stock_state_events AS r WHERE r.product_id = p_product ORDER BY r.version, r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('state_events',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('state_events'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('state_events',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.actor_id, r.writer, r.session_id, r.recorded_at FROM public.controlled_stock_cancellations AS r WHERE r.id IN (SELECT e.id FROM public.controlled_stock_events AS e WHERE e.product_id = p_product) ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('stock_cancellations',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('stock_cancellations'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('stock_cancellations',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.product_id, r.version, r.draft_version_id, r.engine_revision, r.stock_unit, r.identity_snapshot, r.permissions, r.clinic_retained_return_permitted, r.review_reference, r.actor_id, r.session_id, r.recorded_at FROM public.controlled_stock_policy_versions AS r WHERE r.product_id = p_product ORDER BY r.version, r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('stock_policies',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('stock_policies'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('stock_policies',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.policy_version_id, r.site_id FROM public.controlled_stock_policy_sites AS r INNER JOIN public.controlled_stock_policy_versions AS p ON p.id = r.policy_version_id WHERE p.product_id = p_product ORDER BY r.policy_version_id, r.site_id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('stock_policy_sites',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('stock_policy_sites'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('stock_policy_sites',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.event_id, r.container_id, r.version_before, r.version_after, r.before_location_id, r.before_custodian_id, r.before_status, r.after_location_id, r.after_custodian_id, r.after_status FROM public.controlled_stock_container_transitions AS r INNER JOIN public.controlled_stock_containers AS c ON c.id = r.container_id WHERE c.product_id = p_product ORDER BY r.container_id, r.version_after, r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('transitions',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('transitions'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('transitions',rows_value);
 -- NEW explicit event-owned witness class. Nonphysical pending/abandoned
 -- witness work is absent from physical/source freshness by construction.
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in select w.*from controlled_stock_workflow_v1.witness_operations w
 join public.controlled_stock_events e on e.id=w.parent_action_id
 where e.product_id=p_product and w.stage='saved'order by w.parent_action_id,w.operation_id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>4194304 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+64>16777216 then
   raise exception 'count_boundary_capacity'using errcode='P0001',detail='',hint='';end if;
  perform controlled_stock_workflow_v1.witness_row_required(row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 boundary_value:=boundary_value||jsonb_build_object('witness_operations',rows_value);
 if octet_length(boundary_value::text)>16777216 then
  raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 -- The complete retained history/children/membership validator is mandatory;
 -- it is not supplied by the shape component or replaced with an empty body.
 perform controlled_count_v1.historical_boundary_values(boundary_value);
 -- Recheck exact held identity/module/source metadata after all source work.
 perform narcotics_recovery_v1.capture_guard(p_product,p_site);
 return boundary_value;
end$$;
CREATE FUNCTION narcotics_recovery_v1.capture_guard(p_product uuid,p_site uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();
 IF NOT EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=pg_backend_pid()AND l.locktype='advisory'
  AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database())AND l.classid=90271190::oid AND l.objid=0::oid AND l.objsubid=2 AND l.mode IN ('ShareLock','ExclusiveLock')AND l.granted)
 OR NOT EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=pg_backend_pid()AND l.locktype='advisory'
  AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database())AND l.classid=90271040::oid AND l.objid=0::oid AND l.objsubid=2 AND l.mode='ExclusiveLock'AND l.granted)
 OR public.controlled_stock_lock_held('controlled-stock-product:',p_product)IS NOT TRUE THEN
 RAISE EXCEPTION 'narcotics_recovery_frontier_invalid' USING ERRCODE='42501';END IF;
 PERFORM narcotics_recovery_v1.require_head();
 PERFORM narcotics_register_v1.authority(auth.uid(),p_product,p_site);
END $$;

CREATE FUNCTION public.list_narcotics_registers_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_v1','narcotics_recovery_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_v1','narcotics_recovery_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_register_v1.enter_register();

 RETURN narcotics_register_v1.list_reports(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;

CREATE FUNCTION public.create_narcotics_register_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_v1','narcotics_recovery_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_v1','narcotics_recovery_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_register_v1.enter_register();

 RETURN narcotics_register_v1.create_report(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;

CREATE FUNCTION public.read_narcotics_register_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_v1','narcotics_recovery_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_v1','narcotics_recovery_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_register_v1.enter_register();

 RETURN narcotics_register_v1.read_operation(p_request,'report');
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;

CREATE FUNCTION public.close_narcotics_register_operation_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_v1','narcotics_recovery_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_v1','narcotics_recovery_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_register_v1.enter_register();

 RETURN narcotics_register_v1.close_operation(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;

CREATE FUNCTION public.preserve_narcotics_form_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_v1','narcotics_recovery_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_v1','narcotics_recovery_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_register_v1.enter_register();

 RETURN narcotics_register_v1.preserve_form(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;

CREATE FUNCTION public.read_narcotics_form_operation_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_v1','narcotics_recovery_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_v1','narcotics_recovery_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_register_v1.enter_register();

 RETURN narcotics_register_v1.read_operation(p_request,'form');
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;

CREATE FUNCTION public.download_narcotics_form_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_v1','narcotics_recovery_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_v1','narcotics_recovery_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_register_v1.enter_register();

 RETURN narcotics_register_v1.download_form(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;

CREATE FUNCTION public.narcotics_recovery_preflight_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_v1','narcotics_recovery_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_v1','narcotics_recovery_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_recovery_v1.enter_recovery();

 RETURN narcotics_recovery_v1.preflight(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;

CREATE FUNCTION public.narcotics_recovery_arm_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_v1','narcotics_recovery_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_v1','narcotics_recovery_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_recovery_v1.enter_recovery();

 RETURN narcotics_recovery_v1.arm(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;

CREATE FUNCTION public.narcotics_recovery_backup_prepare_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_v1','narcotics_recovery_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_v1','narcotics_recovery_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_recovery_v1.enter_recovery();

 RETURN narcotics_recovery_v1.backup_prepare(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;

CREATE FUNCTION public.narcotics_recovery_source_resume_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_v1','narcotics_recovery_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_v1','narcotics_recovery_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_recovery_v1.enter_recovery();

 RETURN narcotics_recovery_v1.source_resume(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;

CREATE FUNCTION public.narcotics_recovery_begin_epoch_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_v1','narcotics_recovery_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_v1','narcotics_recovery_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_recovery_v1.enter_recovery();

 RETURN narcotics_recovery_v1.begin_epoch(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;

CREATE FUNCTION public.narcotics_recovery_start_count_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_v1','narcotics_recovery_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_v1','narcotics_recovery_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_recovery_v1.enter_recovery();

 RETURN narcotics_recovery_v1.start_count(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;

CREATE FUNCTION public.narcotics_recovery_preserve_evidence_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_v1','narcotics_recovery_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_v1','narcotics_recovery_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_recovery_v1.enter_recovery();

 RETURN narcotics_recovery_v1.preserve_evidence(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;

CREATE FUNCTION public.narcotics_recovery_acknowledge_evidence_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_v1','narcotics_recovery_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_v1','narcotics_recovery_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_recovery_v1.enter_recovery();

 RETURN narcotics_recovery_v1.acknowledge_evidence(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;

CREATE FUNCTION public.narcotics_recovery_read_evidence_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_v1','narcotics_recovery_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_v1','narcotics_recovery_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_recovery_v1.enter_recovery();

 RETURN narcotics_recovery_v1.read_evidence(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;

CREATE FUNCTION public.narcotics_recovery_release_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_v1','narcotics_recovery_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_v1','narcotics_recovery_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_recovery_v1.enter_recovery();

 RETURN narcotics_recovery_v1.release(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;

CREATE FUNCTION public.narcotics_recovery_read_operation_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_v1','narcotics_recovery_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_v1','narcotics_recovery_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_recovery_v1.enter_recovery();

 RETURN narcotics_recovery_v1.operation_pointer(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;

CREATE FUNCTION public.narcotics_recovery_close_operation_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_v1','narcotics_recovery_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_v1','narcotics_recovery_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_recovery_v1.enter_recovery();

 RETURN narcotics_recovery_v1.close_operation(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;

CREATE FUNCTION public.narcotics_recovery_status_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_v1','narcotics_recovery_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_v1','narcotics_recovery_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_recovery_v1.enter_recovery();

 RETURN narcotics_recovery_v1.status(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;
CREATE FUNCTION public.narcotics_recovery_admission_v1() RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN
 IF session_user<>'authenticator'OR current_setting('role')NOT IN ('anon','authenticated','service_role')THEN
 RAISE EXCEPTION 'narcotics_access_denied' USING ERRCODE='42501',DETAIL='',HINT='';END IF;

 IF EXISTS(WITH expected(signature,body_hash,result_type)AS(VALUES
('controlled_count_entry_v1.admit_recovery_request()','aa1682cb790a2e62ae4121522e694b4bb966538ae2fbee881dec3d2f6267aa98','void'))SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef
 OR p.prokind<>'f'OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u'OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargs<>0 OR p.proargnames IS NOT NULL OR p.proallargtypes IS NOT NULL OR p.proargmodes IS NOT NULL
 OR p.pronargdefaults<>0 OR p.proargdefaults IS NOT NULL OR p.prosqlbody IS NOT NULL OR p.probin IS NOT NULL
 OR p.procost<>100 OR p.prorows<>0 OR l.lanname<>'plpgsql'OR p.provolatile<>'v'
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(VALUES('anon'),('authenticated'),('service_role'))recovery_sealed_role(role_name)WHERE has_function_privilege(recovery_sealed_role.role_name,p.oid,'EXECUTE')))THEN
 RAISE EXCEPTION 'narcotics_recovery_source_invalid' USING ERRCODE='42501',DETAIL='',HINT='';END IF;

 PERFORM controlled_count_entry_v1.admit_recovery_request();
END $$;
ALTER TABLE narcotics_register_v1.descriptor OWNER TO postgres;
ALTER TABLE narcotics_register_v1.descriptor ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE narcotics_register_v1.descriptor FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER history_immutable BEFORE UPDATE OR DELETE ON narcotics_register_v1.descriptor FOR EACH ROW EXECUTE FUNCTION narcotics_register_v1.reject_history_change();
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON narcotics_register_v1.descriptor FOR EACH STATEMENT EXECUTE FUNCTION narcotics_register_v1.reject_history_change();
ALTER TABLE narcotics_register_v1.operations OWNER TO postgres;
ALTER TABLE narcotics_register_v1.operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE narcotics_register_v1.operations FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER history_immutable BEFORE UPDATE OR DELETE ON narcotics_register_v1.operations FOR EACH ROW EXECUTE FUNCTION narcotics_register_v1.reject_history_change();
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON narcotics_register_v1.operations FOR EACH STATEMENT EXECUTE FUNCTION narcotics_register_v1.reject_history_change();
ALTER TABLE narcotics_register_v1.reports OWNER TO postgres;
ALTER TABLE narcotics_register_v1.reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE narcotics_register_v1.reports FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER history_immutable BEFORE UPDATE OR DELETE ON narcotics_register_v1.reports FOR EACH ROW EXECUTE FUNCTION narcotics_register_v1.reject_history_change();
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON narcotics_register_v1.reports FOR EACH STATEMENT EXECUTE FUNCTION narcotics_register_v1.reject_history_change();
ALTER TABLE narcotics_register_v1.form_contents OWNER TO postgres;
ALTER TABLE narcotics_register_v1.form_contents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE narcotics_register_v1.form_contents FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER history_immutable BEFORE UPDATE OR DELETE ON narcotics_register_v1.form_contents FOR EACH ROW EXECUTE FUNCTION narcotics_register_v1.reject_history_change();
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON narcotics_register_v1.form_contents FOR EACH STATEMENT EXECUTE FUNCTION narcotics_register_v1.reject_history_change();
ALTER TABLE narcotics_register_v1.form_records OWNER TO postgres;
ALTER TABLE narcotics_register_v1.form_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE narcotics_register_v1.form_records FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER history_immutable BEFORE UPDATE OR DELETE ON narcotics_register_v1.form_records FOR EACH ROW EXECUTE FUNCTION narcotics_register_v1.reject_history_change();
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON narcotics_register_v1.form_records FOR EACH STATEMENT EXECUTE FUNCTION narcotics_register_v1.reject_history_change();
ALTER TABLE narcotics_recovery_v1.backup_markers OWNER TO postgres;
ALTER TABLE narcotics_recovery_v1.backup_markers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE narcotics_recovery_v1.backup_markers FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER history_immutable BEFORE UPDATE OR DELETE ON narcotics_recovery_v1.backup_markers FOR EACH ROW EXECUTE FUNCTION narcotics_register_v1.reject_history_change();
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON narcotics_recovery_v1.backup_markers FOR EACH STATEMENT EXECUTE FUNCTION narcotics_register_v1.reject_history_change();
ALTER TABLE narcotics_recovery_v1.count_markers OWNER TO postgres;
ALTER TABLE narcotics_recovery_v1.count_markers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE narcotics_recovery_v1.count_markers FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER history_immutable BEFORE UPDATE OR DELETE ON narcotics_recovery_v1.count_markers FOR EACH ROW EXECUTE FUNCTION narcotics_register_v1.reject_history_change();
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON narcotics_recovery_v1.count_markers FOR EACH STATEMENT EXECUTE FUNCTION narcotics_register_v1.reject_history_change();
ALTER TABLE narcotics_recovery_v1.acknowledgments OWNER TO postgres;
ALTER TABLE narcotics_recovery_v1.acknowledgments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE narcotics_recovery_v1.acknowledgments FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER history_immutable BEFORE UPDATE OR DELETE ON narcotics_recovery_v1.acknowledgments FOR EACH ROW EXECUTE FUNCTION narcotics_register_v1.reject_history_change();
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON narcotics_recovery_v1.acknowledgments FOR EACH STATEMENT EXECUTE FUNCTION narcotics_register_v1.reject_history_change();
ALTER FUNCTION narcotics_register_v1.reject_history_change() OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_v1.reject_history_change() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_v1.keys(jsonb,text[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_v1.keys(jsonb,text[]) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_v1.uuid_value(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_v1.uuid_value(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_v1.instant_value(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_v1.instant_value(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_v1.utc(timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_v1.utc(timestamptz) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_v1.hash(text,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_v1.hash(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_v1.text_value(jsonb,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_v1.text_value(jsonb,integer) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_v1.identity(uuid,boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_v1.identity(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_v1.authority(uuid,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_v1.authority(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_v1.enter_register() OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_v1.enter_register() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_v1.operation_lock(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_v1.operation_lock(uuid) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_v1.csv_cell(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_v1.csv_cell(text) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_v1.quantity_at(uuid,timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_v1.quantity_at(uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_v1.csv_row(text[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_v1.csv_row(text[]) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_v1.csv(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_v1.csv(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_v1.event_authority(uuid,uuid,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_v1.event_authority(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_v1.make_dataset(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_v1.make_dataset(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_v1.custody_at(uuid,timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_v1.custody_at(uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_v1.list_reports(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_v1.list_reports(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_v1.result_of(uuid,uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_v1.result_of(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_v1.read_operation(jsonb,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_v1.read_operation(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_v1.close_operation(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_v1.close_operation(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_v1.create_report(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_v1.create_report(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_v1.form_bytes(text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_v1.form_bytes(text,text) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_v1.preserve_form(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_v1.preserve_form(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_v1.download_form(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_v1.download_form(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.catalog_projection() OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.catalog_projection() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.projection_of(jsonb,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.projection_of(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.require_head() OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.require_head() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.require_exclusive_admission() OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.require_exclusive_admission() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.enter_recovery() OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.enter_recovery() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.append_head(text,uuid,uuid,jsonb,uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.append_head(text,uuid,uuid,jsonb,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.latest_epoch(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.latest_epoch(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.post_frontier_session_required(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.post_frontier_session_required(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.operation_action(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.operation_action(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.saved_operation(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.saved_operation(uuid) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.operation_request(jsonb,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.operation_request(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.save_operation(jsonb,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.save_operation(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.operation_pointer(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.operation_pointer(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.close_operation(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.close_operation(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.capture_inventory(uuid,boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.capture_inventory(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.server_identity() OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.server_identity() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.backup_record(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.backup_record(uuid) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.begin_epoch(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.begin_epoch(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.require_epoch() OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.require_epoch() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.start_count(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.start_count(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.arm_record(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.arm_record(uuid) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.preflight(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.preflight(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.arm(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.arm(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.backup_prepare(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.backup_prepare(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.source_resume(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.source_resume(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.fresh_identity(uuid,boolean,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.fresh_identity(uuid,boolean,jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.evidence_record(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.evidence_record(uuid) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.read_evidence(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.read_evidence(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.acknowledge_evidence(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.acknowledge_evidence(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.acknowledgment_record(uuid,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.acknowledgment_record(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.preserve_evidence(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.preserve_evidence(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.release(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.release(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.agreement_required(jsonb,jsonb,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.agreement_required(jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.status(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.status(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_v1.module_properties(text,text,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_v1.module_properties(text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_v1.require_module() OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_v1.require_module() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_v1.read_terminal_count(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_v1.read_terminal_count(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.capture_full_boundary(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.capture_full_boundary(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_v1.capture_guard(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_v1.capture_guard(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.list_narcotics_registers_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_narcotics_registers_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.create_narcotics_register_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_narcotics_register_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.read_narcotics_register_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.read_narcotics_register_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.close_narcotics_register_operation_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.close_narcotics_register_operation_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.preserve_narcotics_form_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.preserve_narcotics_form_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.read_narcotics_form_operation_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.read_narcotics_form_operation_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.download_narcotics_form_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.download_narcotics_form_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.narcotics_recovery_preflight_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.narcotics_recovery_preflight_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.narcotics_recovery_arm_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.narcotics_recovery_arm_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.narcotics_recovery_backup_prepare_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.narcotics_recovery_backup_prepare_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.narcotics_recovery_source_resume_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.narcotics_recovery_source_resume_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.narcotics_recovery_begin_epoch_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.narcotics_recovery_begin_epoch_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.narcotics_recovery_start_count_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.narcotics_recovery_start_count_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.narcotics_recovery_preserve_evidence_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.narcotics_recovery_preserve_evidence_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.narcotics_recovery_acknowledge_evidence_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.narcotics_recovery_acknowledge_evidence_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.narcotics_recovery_read_evidence_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.narcotics_recovery_read_evidence_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.narcotics_recovery_release_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.narcotics_recovery_release_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.narcotics_recovery_read_operation_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.narcotics_recovery_read_operation_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.narcotics_recovery_close_operation_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.narcotics_recovery_close_operation_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.narcotics_recovery_status_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.narcotics_recovery_status_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.narcotics_recovery_admission_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.narcotics_recovery_admission_v1() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_narcotics_registers_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_narcotics_register_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.read_narcotics_register_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_narcotics_register_operation_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preserve_narcotics_form_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.read_narcotics_form_operation_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.download_narcotics_form_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.narcotics_recovery_preflight_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.narcotics_recovery_arm_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.narcotics_recovery_backup_prepare_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.narcotics_recovery_source_resume_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.narcotics_recovery_begin_epoch_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.narcotics_recovery_start_count_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.narcotics_recovery_preserve_evidence_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.narcotics_recovery_acknowledge_evidence_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.narcotics_recovery_read_evidence_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.narcotics_recovery_release_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.narcotics_recovery_read_operation_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.narcotics_recovery_close_operation_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.narcotics_recovery_status_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.narcotics_recovery_admission_v1() TO anon,authenticated,service_role;
-- Independent operational audit module. No existing relation is changed.
CREATE SCHEMA narcotics_register_reference_v1 AUTHORIZATION postgres;
CREATE SCHEMA narcotics_recovery_reference_v1 AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA narcotics_register_reference_v1,narcotics_recovery_reference_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE narcotics_register_reference_v1.descriptor (
 revision integer PRIMARY KEY CHECK (revision=1),
 definition jsonb NOT NULL CHECK (jsonb_typeof(definition)='object'),
 definition_hash text NOT NULL CHECK (definition_hash ~ '^[0-9a-f]{64}$')
);
CREATE TABLE narcotics_register_reference_v1.operations (
 operation_id uuid PRIMARY KEY, actor_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('report','form')),
 product_id uuid NOT NULL, site_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('saved','abandoned')),
 original_request jsonb, request_hash text,
 session_id uuid NOT NULL, recorded_at timestamptz NOT NULL,
 CHECK((state='saved' AND original_request IS NOT NULL AND request_hash IS NOT NULL) OR(state='abandoned' AND original_request IS NULL AND request_hash IS NULL)),
 CHECK(request_hash IS NULL OR request_hash ~ '^[0-9a-f]{64}$')
);
CREATE TABLE narcotics_register_reference_v1.reports (
 report_id uuid PRIMARY KEY REFERENCES narcotics_register_reference_v1.operations(operation_id),
 captured_at timestamptz NOT NULL,
 dataset_text text NOT NULL CHECK(octet_length(dataset_text)<=4194304),
 dataset_hash text NOT NULL CHECK(dataset_hash=encode(sha256(convert_to(dataset_text,'UTF8')),'hex')),
 csv_text text NOT NULL CHECK(octet_length(csv_text)<=4194304),
 csv_hash text NOT NULL CHECK(csv_hash=encode(sha256(convert_to(csv_text,'UTF8')),'hex'))
);
CREATE TABLE narcotics_register_reference_v1.form_contents (
 form_id uuid PRIMARY KEY,
 original_bytes bytea NOT NULL CHECK(octet_length(original_bytes) BETWEEN 1 AND 2097152),
 mime text NOT NULL CHECK(mime IN ('application/pdf','image/png','image/jpeg')),
 byte_length integer NOT NULL CHECK(byte_length=octet_length(original_bytes)),
 sha256 text NOT NULL CHECK(sha256=encode(pg_catalog.sha256(original_bytes),'hex'))
);
CREATE TABLE narcotics_register_reference_v1.form_records (
 form_id uuid PRIMARY KEY REFERENCES narcotics_register_reference_v1.form_contents(form_id),
 operation_id uuid NOT NULL UNIQUE REFERENCES narcotics_register_reference_v1.operations(operation_id),
 actor_id uuid NOT NULL, session_id uuid NOT NULL,
 product_id uuid NOT NULL, site_id uuid NOT NULL,
 event_id uuid, event_hash text,
 kind text NOT NULL CHECK(kind IN ('supplier_receipt','registration','order_form','other')),
 title text NOT NULL, filename text NOT NULL,
 obtained_at timestamptz NOT NULL, recorded_at timestamptz NOT NULL,
 document_text text NOT NULL,
 document_hash text NOT NULL CHECK(document_hash=encode(sha256(convert_to(document_text,'UTF8')),'hex')),
 CHECK((event_id IS NULL)=(event_hash IS NULL))
);
CREATE FUNCTION narcotics_register_reference_v1.reject_history_change() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'narcotics_history_immutable' USING ERRCODE='23514',DETAIL='',HINT='';END $$;
CREATE FUNCTION narcotics_register_reference_v1.keys(p_value jsonb,p_keys text[]) RETURNS void
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'object'
 OR (SELECT count(*) FROM jsonb_object_keys(p_value))<>cardinality(p_keys)
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_value)k WHERE NOT k=ANY(p_keys)) THEN
 RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023',DETAIL='',HINT='';END IF;
END $$;
CREATE FUNCTION narcotics_register_reference_v1.uuid_value(p_value jsonb) RETURNS uuid
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE value uuid;
BEGIN
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 value:=(p_value#>>'{}')::uuid;
 IF value='00000000-0000-0000-0000-000000000000'::uuid OR value::text IS DISTINCT FROM p_value#>>'{}' THEN
 RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;RETURN value;
END $$;
CREATE FUNCTION narcotics_register_reference_v1.instant_value(p_value jsonb) RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE value timestamptz;raw text:=p_value#>>'{}';
BEGIN
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' OR raw !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN
 RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 value:=raw::timestamptz;
 IF NOT isfinite(value) OR to_char(value,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>raw THEN
 RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;RETURN value;
END $$;
CREATE FUNCTION narcotics_register_reference_v1.utc(p_value timestamptz) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$
 SELECT to_char(p_value,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;
CREATE FUNCTION narcotics_register_reference_v1.hash(p_domain text,p_value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object('domain',p_domain,'value',p_value)::text,'UTF8')),'hex')
$$;
CREATE FUNCTION narcotics_register_reference_v1.text_value(p_value jsonb,p_limit integer) RETURNS text
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE value text:=p_value#>>'{}';
BEGIN
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' OR length(value) NOT BETWEEN 1 AND p_limit
 OR btrim(value)='' OR value ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 RETURN value;
END $$;
CREATE FUNCTION narcotics_register_reference_v1.identity(p_actor uuid,p_admin boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE identity_value jsonb;
BEGIN
 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_access_denied' USING ERRCODE='42501';END IF;
 identity_value:=controlled_review_v3.protocol_identity(p_actor);
 IF NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_actor AND (u.banned_until IS NULL OR u.banned_until<=clock_timestamp()))
 OR (p_admin AND NOT EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p_actor AND r.role='ADMIN')) THEN
 RAISE EXCEPTION 'narcotics_access_denied' USING ERRCODE='42501';END IF;
 RETURN identity_value;
END $$;
CREATE FUNCTION narcotics_register_reference_v1.authority(p_actor uuid,p_product uuid,p_site uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE identity_value jsonb;authority_value jsonb;
BEGIN
 identity_value:=narcotics_register_reference_v1.identity(p_actor,true);
 authority_value:=controlled_review_v3.ops_admin_authority(p_actor,p_product,'audit');
 IF NOT EXISTS(SELECT 1 FROM public.controlled_stock_sites s WHERE s.id=p_site)
 OR NOT EXISTS(SELECT 1 FROM public.controlled_stock_policy_sites s JOIN public.controlled_stock_policy_versions v ON v.id=s.policy_version_id WHERE v.product_id=p_product AND s.site_id=p_site) THEN
 RAISE EXCEPTION 'narcotics_access_denied' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('identity',identity_value,'audit',authority_value);
END $$;
CREATE FUNCTION narcotics_register_reference_v1.enter_register() RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 -- Dedicated admission precedes every old stock lock, including direct calls.
 PERFORM pg_advisory_xact_lock_shared(90271190,0);
 PERFORM pg_advisory_xact_lock(90271040,0);
 PERFORM controlled_count_entry_v1.acquire_shared_product_relation_frontier();
 PERFORM controlled_count_entry_v1.require_bound_module();
 PERFORM narcotics_register_reference_v1.require_module();
END $$;
CREATE FUNCTION narcotics_register_reference_v1.operation_lock(p_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN PERFORM pg_advisory_xact_lock(hashtextextended('narcotics-register-operation:'||p_id::text,0));END $$;
CREATE FUNCTION narcotics_register_reference_v1.csv_cell(p_value text) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT '"'||replace(''''||coalesce(p_value,''),'"','""')||'"'
$$;
CREATE FUNCTION narcotics_register_reference_v1.quantity_at(p_cell uuid,p_at timestamptz) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT (CASE WHEN o.recorded_at<p_at THEN c.opening_quantity ELSE 0 END+
 coalesce((SELECT sum(l.quantity_delta) FROM public.controlled_stock_event_lines l
 JOIN public.controlled_stock_events e ON e.id=l.event_id WHERE l.cell_id=c.id AND e.recorded_at<p_at),0))::numeric(20,3)::text
 FROM public.controlled_stock_cells c LEFT JOIN public.controlled_stock_openings o ON o.id=c.opening_id WHERE c.id=p_cell
$$;
CREATE FUNCTION narcotics_register_reference_v1.csv_row(p_values text[]) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT string_agg(narcotics_register_reference_v1.csv_cell(value),',' ORDER BY ordinality)||E'\r\n' FROM unnest(p_values)WITH ORDINALITY AS cells(value,ordinality)
$$;
CREATE FUNCTION narcotics_register_reference_v1.csv(p_dataset jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE result text:='"Report","Schedule","Medication","Site","Record type","Event","Sequence","Kind","Actor","Observed UTC","Recorded UTC","Period from UTC","Period to UTC","Cell","Channel","Opening quantity","Delta","Running quantity","Closing quantity","Stock unit","Note"'||E'\r\n';
 event_value jsonb;line_value jsonb;line_values jsonb;cell_value jsonb;form_value jsonb;opening_value jsonb;prefix text[];
BEGIN
 prefix:=ARRAY[p_dataset->>'report_id',p_dataset->>'schedule',p_dataset->>'product_name',p_dataset->>'site_label'];
 -- Opening-only periods still carry every cell's opening and closing balance.
 FOR cell_value IN SELECT value FROM jsonb_array_elements(p_dataset->'cells') LOOP
  result:=result||narcotics_register_reference_v1.csv_row(prefix||ARRAY['Cell balances',NULL,NULL,NULL,NULL,NULL,NULL,p_dataset#>>'{request,from_at}',p_dataset#>>'{request,to_at}',cell_value->>'cell_id',cell_value->>'channel',cell_value->>'opening_quantity',NULL,NULL,cell_value->>'closing_quantity',p_dataset->>'stock_unit',NULL]);
  opening_value:=cell_value->'period_opening_entry';
  IF opening_value<>'null'::jsonb THEN
   result:=result||narcotics_register_reference_v1.csv_row(prefix||ARRAY['Register opening',opening_value->>'opening_id',NULL,'opening',NULL,opening_value->>'observed_at',opening_value->>'recorded_at',p_dataset#>>'{request,from_at}',p_dataset#>>'{request,to_at}',cell_value->>'cell_id',cell_value->>'channel',cell_value->>'opening_quantity',opening_value->>'quantity',opening_value->>'quantity',cell_value->>'closing_quantity',p_dataset->>'stock_unit','Original register opening; existing stock, not a new receipt']);
  END IF;
 END LOOP;
 FOR event_value IN SELECT value FROM jsonb_array_elements(p_dataset->'events') LOOP
  line_values:=event_value->'lines';
  IF jsonb_array_length(line_values)=0 THEN line_values:='[null]'::jsonb;END IF;
  FOR line_value IN SELECT value FROM jsonb_array_elements(line_values) LOOP
   SELECT value INTO cell_value FROM jsonb_array_elements(p_dataset->'cells') WHERE value->>'cell_id'=line_value->>'cell_id';
   result:=result||narcotics_register_reference_v1.csv_row(prefix||ARRAY[CASE event_value->>'basis' WHEN 'physical_record' THEN 'Physical movement' WHEN 'annotation' THEN 'Annotation' WHEN 'correction_assertion' THEN 'Correction assertion' WHEN 'discrepancy_assertion' THEN 'Discrepancy assertion' ELSE 'Unclassified record' END,event_value->>'event_id',event_value->>'sequence',event_value->>'event_kind',event_value->>'actor_name',event_value->>'observed_at',event_value->>'recorded_at',p_dataset#>>'{request,from_at}',p_dataset#>>'{request,to_at}',line_value->>'cell_id',line_value->>'channel',cell_value->>'opening_quantity',line_value->>'quantity_delta',line_value->>'running_quantity',cell_value->>'closing_quantity',p_dataset->>'stock_unit',event_value->>'note']);
   IF octet_length(result)>4194304 THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
  END LOOP;
 END LOOP;
 FOR form_value IN SELECT value FROM jsonb_array_elements(p_dataset->'supporting_forms') LOOP
  result:=result||narcotics_register_reference_v1.csv_row(prefix||ARRAY['Supporting form',form_value->>'form_id',NULL,form_value->>'kind',NULL,NULL,form_value->>'recorded_at',p_dataset#>>'{request,from_at}',p_dataset#>>'{request,to_at}',NULL,NULL,NULL,NULL,NULL,NULL,NULL,(form_value->>'title')||' | '||(form_value->>'filename')||' | SHA256 '||(form_value->>'sha256')]);
 END LOOP;
 IF octet_length(result)>4194304 THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
 RETURN result;
END $$;
CREATE FUNCTION narcotics_register_reference_v1.event_authority(p_actor uuid,p_product uuid,p_site uuid,p_event uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE event_value public.controlled_stock_events;candidate jsonb;
BEGIN
 SELECT * INTO STRICT event_value FROM public.controlled_stock_events e WHERE e.id=p_event AND e.product_id=p_product;
 candidate:=controlled_review_v3.read_site_candidate(event_value.id);
 IF candidate->>'site_id' IS DISTINCT FROM p_site::text THEN RAISE EXCEPTION 'narcotics_scope_unproven' USING ERRCODE='PT409';END IF;
 RETURN controlled_review_v3.read_scope_authorization(p_actor,p_product,p_site,event_value.event_kind,false);
END $$;
CREATE FUNCTION narcotics_register_reference_v1.make_dataset(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE actor_value uuid:=narcotics_register_reference_v1.uuid_value(p_request->'actor_id');
 product_value uuid:=narcotics_register_reference_v1.uuid_value(p_request->'product_id');
 site_value uuid:=narcotics_register_reference_v1.uuid_value(p_request->'site_id');
 from_value timestamptz:=narcotics_register_reference_v1.instant_value(p_request->'from_at');
 to_value timestamptz:=narcotics_register_reference_v1.instant_value(p_request->'to_at');
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
 before_authority:=narcotics_register_reference_v1.authority(actor_value,product_value,site_value);
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
  collected:=narcotics_register_reference_v1.event_authority(actor_value,product_value,site_value,event_value.id);
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
   -- Preserve the original public receipt/request and saved attribution. The
   -- private nonce and private preparation are not part of an exported receipt.
   witness_text:=jsonb_build_object('schema_version',1,'operation_id',witness_value.operation_id,'stage','saved',
    'actor_id',witness_value.actor_id,'actor_name',witness_value.name,'recorder_id',witness_value.recorder_id,'recorder_name',witness_value.recorder_name,
    'parent_action_id',witness_value.parent_action_id,'writer',witness_value.writer,'product_id',witness_value.product_id,'event_kind',witness_value.event_kind,
    'recorded_at',narcotics_register_reference_v1.utc(witness_value.recorded_at),'preparation_digest',witness_value.preparation_digest,'request',witness_value.request,'receipt',witness_value.receipt)::text;
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
   'actor_id',event_value.actor_id,'actor_name',event_value.actor_name,'observed_at',narcotics_register_reference_v1.utc(event_value.observed_at),'recorded_at',narcotics_register_reference_v1.utc(event_value.recorded_at),
   'basis',event_value.basis,'note',event_value.note,'record_hash',event_value.record_hash,'secondary_review_required',event_value.secondary_review_required,'lines',lines_value,'custody_text',transitions_value::text,
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
   'channel',cell_value.channel,'stock_unit',cell_value.stock_unit,'opening_quantity',narcotics_register_reference_v1.quantity_at(cell_value.id,from_value),
   'closing_quantity',narcotics_register_reference_v1.quantity_at(cell_value.id,to_value),
   'period_opening_entry',CASE WHEN cell_value.opening_recorded_at>=from_value THEN jsonb_build_object('opening_id',cell_value.opening_id,'observed_at',narcotics_register_reference_v1.utc(cell_value.opening_observed_at),'recorded_at',narcotics_register_reference_v1.utc(cell_value.opening_recorded_at),'quantity',cell_value.opening_quantity::text) ELSE NULL END,
   'custody_at_start',narcotics_register_reference_v1.custody_at(cell_value.container_id,from_value),
   'custody_at_end',narcotics_register_reference_v1.custody_at(cell_value.container_id,to_value)));
 END LOOP;
 FOR count_value IN SELECT c.count_id FROM controlled_count_v1.cycles c JOIN controlled_count_v1.outcomes o ON o.count_id=c.count_id
  WHERE c.product_id=product_value AND c.site_id=site_value AND o.kind IN ('agreement','variance') AND (o.document->>'recorded_at')::timestamptz>=from_value AND (o.document->>'recorded_at')::timestamptz<to_value ORDER BY (o.document->>'recorded_at')::timestamptz,c.count_id LIMIT 33 LOOP
  IF jsonb_array_length(counts_value)>=32 THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
  -- This is an exact source copy of the existing authorized READ projector;
  -- only its redundant full module check is removed under this root's check.
  count_projection:=narcotics_register_reference_v1.read_terminal_count(jsonb_build_object('schema_version',1,'actor_id',actor_value,'count_id',count_value.count_id));
  IF count_projection->>'state'<>'available' OR count_projection#>>'{data,history_state}' NOT IN ('agreement','variance') THEN
  RAISE EXCEPTION 'narcotics_scope_unproven' USING ERRCODE='PT409';END IF;
  count_text:=count_projection::text;
  counts_value:=counts_value||jsonb_build_array(jsonb_build_object('count_id',count_value.count_id,'state',count_projection#>>'{data,history_state}',
   'projection_text',count_text,'projection_hash',encode(sha256(convert_to(count_text,'UTF8')),'hex')));
 END LOOP;
 FOR form_value IN SELECT f.*,c.sha256,c.byte_length,c.mime FROM narcotics_register_reference_v1.form_records f JOIN narcotics_register_reference_v1.form_contents c ON c.form_id=f.form_id
  WHERE f.product_id=product_value AND f.site_id=site_value AND(f.event_id IS NULL OR f.event_id=ANY(event_ids)) ORDER BY f.recorded_at,f.form_id LIMIT 129 LOOP
  IF jsonb_array_length(forms_value)>=128 THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
  forms_value:=forms_value||jsonb_build_array(jsonb_build_object('form_id',form_value.form_id,'kind',form_value.kind,'title',form_value.title,'filename',form_value.filename,
   'mime',form_value.mime,'byte_length',form_value.byte_length,'sha256',form_value.sha256,'obtained_at',narcotics_register_reference_v1.utc(form_value.obtained_at),
   'recorded_at',narcotics_register_reference_v1.utc(form_value.recorded_at),'event_id',form_value.event_id,'event_hash',form_value.event_hash,'document_text',form_value.document_text,'document_hash',form_value.document_hash));
 END LOOP;
 FOR kind_value IN SELECT key FROM jsonb_object_keys(fingerprints)key ORDER BY key LOOP
  after_authority:=controlled_review_v3.read_scope_authorization(actor_value,product_value,site_value,kind_value,false);
  IF after_authority IS DISTINCT FROM fingerprints->kind_value THEN RAISE EXCEPTION 'narcotics_access_denied' USING ERRCODE='42501';END IF;
  kinds_value:=kinds_value||to_jsonb(kind_value);
 END LOOP;
 IF narcotics_register_reference_v1.authority(actor_value,product_value,site_value) IS DISTINCT FROM before_authority THEN RAISE EXCEPTION 'narcotics_access_denied' USING ERRCODE='42501';END IF;
 result:=jsonb_build_object('schema_version',1,'report_id',p_request->'operation_id','request',p_request,'captured_at',narcotics_register_reference_v1.utc(clock_timestamp()),
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
CREATE FUNCTION narcotics_register_reference_v1.custody_at(p_container uuid,p_at timestamptz) RETURNS jsonb
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
CREATE FUNCTION narcotics_register_reference_v1.list_reports(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actor_value uuid;product_value uuid;site_value uuid;cursor_value uuid;cursor_time timestamptz;page_value integer;
 row_value record;items jsonb:='[]'::jsonb;more_value boolean:=false;last_id uuid;authority_value jsonb;
BEGIN
 PERFORM narcotics_register_reference_v1.keys(p_request,ARRAY['schema_version','actor_id','product_id','site_id','after_operation_id','page_size']);
 IF (p_request->'schema_version')::text IS DISTINCT FROM '1' OR jsonb_typeof(p_request->'page_size')IS DISTINCT FROM'number' THEN RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 page_value:=(p_request->>'page_size')::integer;
 IF page_value NOT BETWEEN 1 AND 50 OR to_jsonb(page_value)IS DISTINCT FROM p_request->'page_size' THEN RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 actor_value:=narcotics_register_reference_v1.uuid_value(p_request->'actor_id');product_value:=narcotics_register_reference_v1.uuid_value(p_request->'product_id');site_value:=narcotics_register_reference_v1.uuid_value(p_request->'site_id');
 IF p_request->'after_operation_id'<>'null'::jsonb THEN cursor_value:=narcotics_register_reference_v1.uuid_value(p_request->'after_operation_id');END IF;
 PERFORM controlled_count_entry_v1.assert_shared_product_relation_frontier();authority_value:=narcotics_register_reference_v1.authority(actor_value,product_value,site_value);
 IF cursor_value IS NOT NULL THEN
  SELECT o.recorded_at INTO STRICT cursor_time FROM narcotics_register_reference_v1.operations o WHERE o.operation_id=cursor_value AND o.actor_id=actor_value AND o.product_id=product_value AND o.site_id=site_value AND o.kind='report' AND o.state='saved';
 END IF;
 FOR row_value IN SELECT o.operation_id,o.recorded_at,o.original_request,r.captured_at FROM narcotics_register_reference_v1.operations o JOIN narcotics_register_reference_v1.reports r ON r.report_id=o.operation_id
  WHERE o.actor_id=actor_value AND o.product_id=product_value AND o.site_id=site_value AND o.kind='report' AND o.state='saved'
  AND(cursor_value IS NULL OR(o.recorded_at,o.operation_id)<(cursor_time,cursor_value)) ORDER BY o.recorded_at DESC,o.operation_id DESC LIMIT page_value+1 LOOP
  IF jsonb_array_length(items)=page_value THEN more_value:=true;EXIT;END IF;
  items:=items||jsonb_build_array(jsonb_build_object('operation_id',row_value.operation_id,'recorded_at',narcotics_register_reference_v1.utc(row_value.recorded_at),'captured_at',narcotics_register_reference_v1.utc(row_value.captured_at),
   'from_at',row_value.original_request->'from_at','to_at',row_value.original_request->'to_at'));last_id:=row_value.operation_id;
 END LOOP;
 IF narcotics_register_reference_v1.authority(actor_value,product_value,site_value)IS DISTINCT FROM authority_value THEN RAISE EXCEPTION 'narcotics_access_denied' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('schema_version',1,'actor_id',actor_value,'product_id',product_value,'site_id',site_value,'items',items,'has_more',more_value,'next_operation_id',CASE WHEN more_value THEN last_id ELSE NULL END);
END $$;
CREATE FUNCTION narcotics_register_reference_v1.result_of(p_operation uuid,p_actor uuid,p_kind text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE operation_value narcotics_register_reference_v1.operations;report_value narcotics_register_reference_v1.reports;
 form_value narcotics_register_reference_v1.form_records;content_value narcotics_register_reference_v1.form_contents;
 dataset jsonb;kind_value text;before_authority jsonb;request_value jsonb;data_value jsonb;
BEGIN
 SELECT * INTO operation_value FROM narcotics_register_reference_v1.operations o WHERE o.operation_id=p_operation;
 IF NOT FOUND THEN RETURN jsonb_build_object('schema_version',1,'state','not_found','kind',p_kind,'operation_id',p_operation);END IF;
 IF operation_value.actor_id<>p_actor OR operation_value.kind<>p_kind THEN RAISE EXCEPTION 'narcotics_access_denied' USING ERRCODE='42501';END IF;
 before_authority:=narcotics_register_reference_v1.authority(p_actor,operation_value.product_id,operation_value.site_id);
 IF operation_value.state='abandoned' THEN RETURN jsonb_build_object('schema_version',1,'state','abandoned','kind',p_kind,'operation_id',p_operation);END IF;
 IF p_kind='report' THEN
  SELECT * INTO STRICT report_value FROM narcotics_register_reference_v1.reports r WHERE r.report_id=p_operation;
  dataset:=report_value.dataset_text::jsonb;
  IF dataset->'request' IS DISTINCT FROM operation_value.original_request OR dataset->>'report_id'<>p_operation::text
  OR report_value.dataset_hash<>encode(sha256(convert_to(report_value.dataset_text,'UTF8')),'hex')
  OR report_value.csv_hash<>encode(sha256(convert_to(report_value.csv_text,'UTF8')),'hex') THEN RAISE EXCEPTION 'narcotics_source_invalid' USING ERRCODE='23514';END IF;
  FOR kind_value IN SELECT jsonb_array_elements_text(dataset->'authorization_kinds') LOOP
   PERFORM controlled_review_v3.read_scope_authorization(p_actor,operation_value.product_id,operation_value.site_id,kind_value,false);
  END LOOP;
  IF jsonb_array_length(dataset->'counts')>0 THEN PERFORM controlled_count_v1.current_principal(p_actor,operation_value.product_id,operation_value.site_id,'read');END IF;
  request_value:=operation_value.original_request;
  data_value:=jsonb_build_object('captured_at',narcotics_register_reference_v1.utc(report_value.captured_at),'dataset_text',report_value.dataset_text,'dataset_hash',report_value.dataset_hash,
   'dataset_utf8_bytes',octet_length(report_value.dataset_text),'csv_text',report_value.csv_text,'csv_hash',report_value.csv_hash,'csv_utf8_bytes',octet_length(report_value.csv_text));
 ELSIF p_kind='form' THEN
  SELECT * INTO STRICT form_value FROM narcotics_register_reference_v1.form_records f WHERE f.operation_id=p_operation;
  SELECT * INTO STRICT content_value FROM narcotics_register_reference_v1.form_contents c WHERE c.form_id=form_value.form_id;
  IF form_value.actor_id<>p_actor OR form_value.product_id<>operation_value.product_id OR form_value.site_id<>operation_value.site_id
  OR form_value.document_hash<>encode(sha256(convert_to(form_value.document_text,'UTF8')),'hex')
  OR content_value.sha256<>encode(sha256(content_value.original_bytes),'hex') OR content_value.byte_length<>octet_length(content_value.original_bytes) THEN RAISE EXCEPTION 'narcotics_source_invalid' USING ERRCODE='23514';END IF;
  IF form_value.event_id IS NOT NULL THEN PERFORM narcotics_register_reference_v1.event_authority(p_actor,form_value.product_id,form_value.site_id,form_value.event_id);END IF;
  request_value:=operation_value.original_request||jsonb_build_object('base64',replace(encode(content_value.original_bytes,'base64'),E'\n',''));
  data_value:=jsonb_build_object('form_id',form_value.form_id,'document_text',form_value.document_text,'document_hash',form_value.document_hash,
   'sha256',content_value.sha256,'byte_length',content_value.byte_length,'mime',content_value.mime,'filename',form_value.filename);
 ELSE RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 IF operation_value.request_hash<>narcotics_register_reference_v1.hash('narcotics-register-'||p_kind||'-request-v1',request_value)
 OR narcotics_register_reference_v1.authority(p_actor,operation_value.product_id,operation_value.site_id) IS DISTINCT FROM before_authority THEN
 RAISE EXCEPTION 'narcotics_source_invalid' USING ERRCODE='23514';END IF;
 RETURN jsonb_build_object('schema_version',1,'state','saved','kind',p_kind,'operation_id',p_operation,'actor_id',p_actor,
  'original_session_id',operation_value.session_id,'recorded_at',narcotics_register_reference_v1.utc(operation_value.recorded_at),
  'request_metadata',operation_value.original_request,'request_hash',operation_value.request_hash,'data',data_value);
END $$;
CREATE FUNCTION narcotics_register_reference_v1.read_operation(p_request jsonb,p_kind text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actor_value uuid;operation_value uuid;
BEGIN
 PERFORM narcotics_register_reference_v1.keys(p_request,ARRAY['schema_version','actor_id','operation_id']);
 IF (p_request->'schema_version')::text IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 actor_value:=narcotics_register_reference_v1.uuid_value(p_request->'actor_id');operation_value:=narcotics_register_reference_v1.uuid_value(p_request->'operation_id');
 PERFORM controlled_count_entry_v1.assert_shared_product_relation_frontier();PERFORM narcotics_register_reference_v1.identity(actor_value,true);
 PERFORM narcotics_register_reference_v1.operation_lock(operation_value);
 RETURN narcotics_register_reference_v1.result_of(operation_value,actor_value,p_kind);
END $$;
CREATE FUNCTION narcotics_register_reference_v1.close_operation(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actor_value uuid;operation_value uuid;product_value uuid;site_value uuid;kind_value text;identity_value jsonb;
BEGIN
 PERFORM narcotics_register_reference_v1.keys(p_request,ARRAY['schema_version','actor_id','operation_id','product_id','site_id','kind']);
 IF (p_request->'schema_version')::text IS DISTINCT FROM '1' OR p_request->>'kind' NOT IN ('report','form') THEN RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 actor_value:=narcotics_register_reference_v1.uuid_value(p_request->'actor_id');operation_value:=narcotics_register_reference_v1.uuid_value(p_request->'operation_id');
 product_value:=narcotics_register_reference_v1.uuid_value(p_request->'product_id');site_value:=narcotics_register_reference_v1.uuid_value(p_request->'site_id');kind_value:=p_request->>'kind';
 PERFORM controlled_count_entry_v1.assert_shared_product_relation_frontier();PERFORM narcotics_register_reference_v1.authority(actor_value,product_value,site_value);PERFORM narcotics_register_reference_v1.operation_lock(operation_value);
 IF NOT EXISTS(SELECT 1 FROM narcotics_register_reference_v1.operations o WHERE o.operation_id=operation_value) THEN
  identity_value:=narcotics_register_reference_v1.identity(actor_value,true);
  INSERT INTO narcotics_register_reference_v1.operations(operation_id,actor_id,kind,product_id,site_id,state,session_id,recorded_at)
  VALUES(operation_value,actor_value,kind_value,product_value,site_value,'abandoned',(identity_value->>'session_id')::uuid,clock_timestamp());
 ELSE
  IF NOT EXISTS(SELECT 1 FROM narcotics_register_reference_v1.operations o WHERE o.operation_id=operation_value AND o.product_id=product_value AND o.site_id=site_value) THEN RAISE EXCEPTION 'narcotics_request_mismatch' USING ERRCODE='22023';END IF;
 END IF;
 RETURN narcotics_register_reference_v1.result_of(operation_value,actor_value,kind_value);
END $$;
CREATE FUNCTION narcotics_register_reference_v1.create_report(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actor_value uuid;operation_value uuid;product_value uuid;site_value uuid;identity_value jsonb;prior narcotics_register_reference_v1.operations;
 dataset_value jsonb;dataset_text text;csv_text text;request_hash text;response_value jsonb;
BEGIN
 PERFORM narcotics_register_reference_v1.keys(p_request,ARRAY['schema_version','actor_id','operation_id','product_id','site_id','from_at','to_at']);
 IF (p_request->'schema_version')::text IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 actor_value:=narcotics_register_reference_v1.uuid_value(p_request->'actor_id');operation_value:=narcotics_register_reference_v1.uuid_value(p_request->'operation_id');product_value:=narcotics_register_reference_v1.uuid_value(p_request->'product_id');site_value:=narcotics_register_reference_v1.uuid_value(p_request->'site_id');
 PERFORM controlled_count_entry_v1.assert_shared_product_relation_frontier();PERFORM narcotics_register_reference_v1.authority(actor_value,product_value,site_value);PERFORM narcotics_register_reference_v1.operation_lock(operation_value);
 request_hash:=narcotics_register_reference_v1.hash('narcotics-register-report-request-v1',p_request);
 SELECT * INTO prior FROM narcotics_register_reference_v1.operations o WHERE o.operation_id=operation_value;
 IF FOUND THEN
  IF prior.state<>'saved' OR prior.kind<>'report' OR prior.actor_id<>actor_value OR prior.request_hash<>request_hash OR prior.original_request IS DISTINCT FROM p_request THEN RAISE EXCEPTION 'narcotics_request_closed_or_changed' USING ERRCODE='PT409';END IF;
  RETURN narcotics_register_reference_v1.result_of(operation_value,actor_value,'report');
 END IF;
 dataset_value:=narcotics_register_reference_v1.make_dataset(p_request);dataset_text:=dataset_value::text;csv_text:=narcotics_register_reference_v1.csv(dataset_value);
 identity_value:=narcotics_register_reference_v1.identity(actor_value,true);
 INSERT INTO narcotics_register_reference_v1.operations VALUES(operation_value,actor_value,'report',product_value,site_value,'saved',p_request,request_hash,(identity_value->>'session_id')::uuid,clock_timestamp());
 INSERT INTO narcotics_register_reference_v1.reports VALUES(operation_value,(dataset_value->>'captured_at')::timestamptz,dataset_text,encode(sha256(convert_to(dataset_text,'UTF8')),'hex'),csv_text,encode(sha256(convert_to(csv_text,'UTF8')),'hex'));
 response_value:=narcotics_register_reference_v1.result_of(operation_value,actor_value,'report');
 IF octet_length(response_value::text)>8388608 THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
 RETURN response_value;
END $$;
CREATE FUNCTION narcotics_register_reference_v1.form_bytes(p_mime text,p_base64 text) RETURNS bytea
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE value bytea;length_value integer;
BEGIN
 IF p_base64 IS NULL OR length(p_base64) NOT BETWEEN 4 AND 2796204 OR length(p_base64)%4<>0
 OR p_base64 !~ '^[A-Za-z0-9+/]*={0,2}$' OR p_mime NOT IN ('application/pdf','image/png','image/jpeg') THEN RAISE EXCEPTION 'narcotics_document_invalid' USING ERRCODE='22023';END IF;
 value:=decode(p_base64,'base64');length_value:=octet_length(value);
 IF length_value NOT BETWEEN 1 AND 2097152 OR replace(encode(value,'base64'),E'\n','')<>p_base64 THEN RAISE EXCEPTION 'narcotics_document_invalid' USING ERRCODE='22023';END IF;
 IF (p_mime='application/pdf' AND(substring(value FROM 1 FOR 5)<>convert_to('%PDF-','UTF8') OR position(convert_to('%%EOF','UTF8') IN substring(value FROM greatest(1,length_value-64)))=0))
 OR(p_mime='image/png' AND(substring(value FROM 1 FOR 8)<>decode('89504e470d0a1a0a','hex') OR substring(value FROM length_value-11 FOR 12)<>decode('0000000049454e44ae426082','hex')))
 OR(p_mime='image/jpeg' AND(substring(value FROM 1 FOR 3)<>decode('ffd8ff','hex') OR substring(value FROM length_value-1 FOR 2)<>decode('ffd9','hex'))) THEN
 RAISE EXCEPTION 'narcotics_document_invalid' USING ERRCODE='22023';END IF;
 RETURN value;
END $$;
CREATE FUNCTION narcotics_register_reference_v1.preserve_form(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actor_value uuid;operation_value uuid;product_value uuid;site_value uuid;event_value uuid;
 kind_value text;title_value text;filename_value text;mime_value text;obtained_value timestamptz;recorded_value timestamptz;
 raw_value bytea;raw_hash text;request_hash text;event_hash text;identity_value jsonb;authority_value jsonb;prior narcotics_register_reference_v1.operations;document_value jsonb;document_text text;
BEGIN
 IF octet_length(p_request::text)>3145728 THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
 PERFORM narcotics_register_reference_v1.keys(p_request,ARRAY['schema_version','actor_id','operation_id','product_id','site_id','event_id','kind','title','filename','obtained_at','mime','base64']);
 IF (p_request->'schema_version')::text IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 actor_value:=narcotics_register_reference_v1.uuid_value(p_request->'actor_id');operation_value:=narcotics_register_reference_v1.uuid_value(p_request->'operation_id');product_value:=narcotics_register_reference_v1.uuid_value(p_request->'product_id');site_value:=narcotics_register_reference_v1.uuid_value(p_request->'site_id');
 IF p_request->'event_id'<>'null'::jsonb THEN event_value:=narcotics_register_reference_v1.uuid_value(p_request->'event_id');END IF;
 kind_value:=narcotics_register_reference_v1.text_value(p_request->'kind',32);title_value:=narcotics_register_reference_v1.text_value(p_request->'title',200);filename_value:=narcotics_register_reference_v1.text_value(p_request->'filename',200);
 IF kind_value NOT IN ('supplier_receipt','registration','order_form','other') OR filename_value ~ '[/\\]' THEN RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 obtained_value:=narcotics_register_reference_v1.instant_value(p_request->'obtained_at');mime_value:=narcotics_register_reference_v1.text_value(p_request->'mime',100);
 IF obtained_value>clock_timestamp() OR jsonb_typeof(p_request->'base64') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 raw_value:=narcotics_register_reference_v1.form_bytes(mime_value,p_request->>'base64');raw_hash:=encode(sha256(raw_value),'hex');request_hash:=narcotics_register_reference_v1.hash('narcotics-register-form-request-v1',p_request);
 PERFORM controlled_count_entry_v1.assert_shared_product_relation_frontier();authority_value:=narcotics_register_reference_v1.authority(actor_value,product_value,site_value);PERFORM narcotics_register_reference_v1.operation_lock(operation_value);
 SELECT * INTO prior FROM narcotics_register_reference_v1.operations o WHERE o.operation_id=operation_value;
 IF FOUND THEN
  IF prior.state<>'saved' OR prior.kind<>'form' OR prior.actor_id<>actor_value OR prior.request_hash<>request_hash OR prior.original_request IS DISTINCT FROM p_request-'base64' THEN RAISE EXCEPTION 'narcotics_request_closed_or_changed' USING ERRCODE='PT409';END IF;
  RETURN narcotics_register_reference_v1.result_of(operation_value,actor_value,'form');
 END IF;
 IF event_value IS NOT NULL THEN
  PERFORM narcotics_register_reference_v1.event_authority(actor_value,product_value,site_value,event_value);
  PERFORM controlled_review_v3.read_scalar_base(controlled_review_v3.read_collect_visible_scalar(event_value));
  SELECT e.record_hash INTO STRICT event_hash FROM public.controlled_stock_events e WHERE e.id=event_value;
 END IF;
 identity_value:=narcotics_register_reference_v1.identity(actor_value,true);recorded_value:=clock_timestamp();
 document_value:=jsonb_build_object('schema_version',1,'form_id',operation_value,'operation_id',operation_value,'request_metadata',p_request-'base64','request_hash',request_hash,
  'actor_id',actor_value,'session_id',identity_value->'session_id','recorded_at',narcotics_register_reference_v1.utc(recorded_value),'obtained_at_basis','staff_reported',
  'event_hash',event_hash,'sha256',raw_hash,'byte_length',octet_length(raw_value),'mime',mime_value);
 document_text:=document_value::text;
 IF narcotics_register_reference_v1.authority(actor_value,product_value,site_value) IS DISTINCT FROM authority_value THEN RAISE EXCEPTION 'narcotics_access_denied' USING ERRCODE='42501';END IF;
 INSERT INTO narcotics_register_reference_v1.operations VALUES(operation_value,actor_value,'form',product_value,site_value,'saved',p_request-'base64',request_hash,(identity_value->>'session_id')::uuid,recorded_value);
 INSERT INTO narcotics_register_reference_v1.form_contents VALUES(operation_value,raw_value,mime_value,octet_length(raw_value),raw_hash);
 INSERT INTO narcotics_register_reference_v1.form_records VALUES(operation_value,operation_value,actor_value,(identity_value->>'session_id')::uuid,product_value,site_value,event_value,event_hash,kind_value,title_value,filename_value,obtained_value,recorded_value,document_text,encode(sha256(convert_to(document_text,'UTF8')),'hex'));
 RETURN narcotics_register_reference_v1.result_of(operation_value,actor_value,'form');
END $$;
CREATE FUNCTION narcotics_register_reference_v1.download_form(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actor_value uuid;form_id_value uuid;form_value narcotics_register_reference_v1.form_records;content_value narcotics_register_reference_v1.form_contents;authority_value jsonb;data_value jsonb;
BEGIN
 PERFORM narcotics_register_reference_v1.keys(p_request,ARRAY['schema_version','actor_id','form_id']);
 IF (p_request->'schema_version')::text IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 actor_value:=narcotics_register_reference_v1.uuid_value(p_request->'actor_id');form_id_value:=narcotics_register_reference_v1.uuid_value(p_request->'form_id');
 PERFORM controlled_count_entry_v1.assert_shared_product_relation_frontier();PERFORM narcotics_register_reference_v1.identity(actor_value,true);
 SELECT * INTO STRICT form_value FROM narcotics_register_reference_v1.form_records f WHERE f.form_id=form_id_value;
 authority_value:=narcotics_register_reference_v1.authority(actor_value,form_value.product_id,form_value.site_id);
 IF form_value.event_id IS NOT NULL THEN PERFORM narcotics_register_reference_v1.event_authority(actor_value,form_value.product_id,form_value.site_id,form_value.event_id);END IF;
 SELECT * INTO STRICT content_value FROM narcotics_register_reference_v1.form_contents c WHERE c.form_id=form_id_value;
 IF content_value.sha256<>encode(sha256(content_value.original_bytes),'hex') OR content_value.byte_length<>octet_length(content_value.original_bytes)
 OR form_value.document_hash<>encode(sha256(convert_to(form_value.document_text,'UTF8')),'hex') THEN RAISE EXCEPTION 'narcotics_source_invalid' USING ERRCODE='23514';END IF;
 data_value:=jsonb_build_object('schema_version',1,'form_id',form_id_value,'filename',form_value.filename,'mime',content_value.mime,'byte_length',content_value.byte_length,
  'sha256',content_value.sha256,'base64',replace(encode(content_value.original_bytes,'base64'),E'\n',''),'document_text',form_value.document_text,'document_hash',form_value.document_hash);
 IF narcotics_register_reference_v1.authority(actor_value,form_value.product_id,form_value.site_id) IS DISTINCT FROM authority_value THEN RAISE EXCEPTION 'narcotics_access_denied' USING ERRCODE='42501';END IF;
 RETURN data_value;
END $$;
-- Prospective recovery coordinator. The release builder remains disabled.
-- A mode transition is an immutable audit append plus its catalog projection.
CREATE TABLE narcotics_recovery_reference_v1.heads (
 head_id uuid PRIMARY KEY,
 prior_head_id uuid UNIQUE REFERENCES narcotics_recovery_reference_v1.heads(head_id),
 prior_head_hash text,
 kind text NOT NULL CHECK(kind IN ('installed','armed','source_resumed','epoch_started','released')),
 mode text NOT NULL CHECK(mode IN ('idle','armed')),
 arm_id uuid, epoch_id uuid,
 actor_id uuid, session_id uuid,
 recorded_at timestamptz NOT NULL,
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<=131072),
 record_hash text NOT NULL CHECK(record_hash ~ '^[0-9a-f]{64}$'),
 CHECK((prior_head_id IS NULL)=(prior_head_hash IS NULL)),
 CHECK((kind='installed')=(prior_head_id IS NULL)),
 CHECK((kind='installed')=(actor_id IS NULL)),
 CHECK((actor_id IS NULL)=(session_id IS NULL)),
 CHECK((mode='idle')=(arm_id IS NULL)),
 CHECK(epoch_id IS NULL OR mode='armed')
);
CREATE UNIQUE INDEX one_installation_head ON narcotics_recovery_reference_v1.heads((true)) WHERE prior_head_id IS NULL;
CREATE FUNCTION narcotics_recovery_reference_v1.catalog_projection() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE description_value text;projection jsonb;
BEGIN
 SELECT d.description INTO STRICT description_value FROM pg_namespace n
 JOIN pg_description d ON d.objoid=n.oid AND d.classoid='pg_namespace'::regclass AND d.objsubid=0
 WHERE n.nspname='narcotics_recovery_reference_v1'AND n.nspowner='postgres'::regrole;
 IF description_value IS NULL OR octet_length(description_value)>2048 THEN
 RAISE EXCEPTION 'narcotics_recovery_projection_invalid' USING ERRCODE='42501';END IF;
 projection:=description_value::jsonb;
 IF projection::text IS DISTINCT FROM description_value OR jsonb_typeof(projection)<>'object'
 OR(SELECT count(*)FROM jsonb_object_keys(projection))<>7
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(projection)k WHERE k NOT IN ('schema_version','domain','mode','head_id','head_hash','arm_id','epoch_id'))
 OR(projection->'schema_version')::text IS DISTINCT FROM'1'
 OR projection->>'domain'IS DISTINCT FROM'lrv-narcotics-recovery-mode-v1'
 OR jsonb_typeof(projection->'mode')IS DISTINCT FROM'string'OR projection->>'mode'NOT IN ('idle','armed')
 OR jsonb_typeof(projection->'head_hash')IS DISTINCT FROM'string'OR projection->>'head_hash'!~'^[0-9a-f]{64}$' THEN
 RAISE EXCEPTION 'narcotics_recovery_projection_invalid' USING ERRCODE='42501';END IF;
 -- Keep the before-frontier reader catalog-only with no mutable helper call.
 IF jsonb_typeof(projection->'head_id')IS DISTINCT FROM'string'
 OR projection->>'head_id'!~'^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
 OR(projection->'arm_id'<>'null'::jsonb AND(jsonb_typeof(projection->'arm_id')IS DISTINCT FROM'string'OR projection->>'arm_id'!~'^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'))
 OR(projection->'epoch_id'<>'null'::jsonb AND(jsonb_typeof(projection->'epoch_id')IS DISTINCT FROM'string'OR projection->>'epoch_id'!~'^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'))THEN
 RAISE EXCEPTION 'narcotics_recovery_projection_invalid' USING ERRCODE='42501';END IF;
 IF(projection->>'mode'='idle')IS DISTINCT FROM(projection->'arm_id'='null'::jsonb)
 OR(projection->'epoch_id'<>'null'::jsonb AND projection->>'mode'<>'armed') THEN
 RAISE EXCEPTION 'narcotics_recovery_projection_invalid' USING ERRCODE='42501';END IF;
 RETURN projection;
END $$;
CREATE FUNCTION narcotics_recovery_reference_v1.projection_of(p_document jsonb,p_hash text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('schema_version',1,'domain','lrv-narcotics-recovery-mode-v1',
 'head_id',p_document->'head_id','head_hash',p_hash,'mode',p_document->'mode','arm_id',p_document->'arm_id','epoch_id',p_document->'epoch_id')
$$;
CREATE FUNCTION narcotics_recovery_reference_v1.require_head() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE projection jsonb;row_value narcotics_recovery_reference_v1.heads;prior_value narcotics_recovery_reference_v1.heads;total integer:=0;root_count integer:=0;leaf_count integer:=0;selected jsonb;
BEGIN
 -- This function is a POST-frontier check. Its catalog-only caller must never
 -- inspect this audit relation before the complete original121 frontier.
 PERFORM controlled_count_entry_v1.assert_read_frontier();
 PERFORM narcotics_register_reference_v1.require_module();
 projection:=narcotics_recovery_reference_v1.catalog_projection();
 FOR row_value IN SELECT h.*FROM narcotics_recovery_reference_v1.heads h ORDER BY h.recorded_at,h.head_id LIMIT 4097 LOOP
  total:=total+1;
  IF total>4096 THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
  PERFORM narcotics_register_reference_v1.keys(row_value.document,ARRAY['schema_version','domain','head_id','prior_head_id','prior_head_hash','kind','mode','arm_id','epoch_id','actor_id','session_id','recorded_at','body']);
  IF NOT isfinite(row_value.recorded_at) OR(row_value.document->'schema_version')::text IS DISTINCT FROM'1'
  OR row_value.document->>'domain'IS DISTINCT FROM'lrv-narcotics-recovery-head-v1'
  OR row_value.document->'head_id'IS DISTINCT FROM to_jsonb(row_value.head_id)
  OR row_value.document->'prior_head_id'IS DISTINCT FROM coalesce(to_jsonb(row_value.prior_head_id),'null'::jsonb)
  OR row_value.document->'prior_head_hash'IS DISTINCT FROM coalesce(to_jsonb(row_value.prior_head_hash),'null'::jsonb)
  OR row_value.document->>'kind'IS DISTINCT FROM row_value.kind OR row_value.document->>'mode'IS DISTINCT FROM row_value.mode
  OR row_value.document->'arm_id'IS DISTINCT FROM coalesce(to_jsonb(row_value.arm_id),'null'::jsonb)
  OR row_value.document->'epoch_id'IS DISTINCT FROM coalesce(to_jsonb(row_value.epoch_id),'null'::jsonb)
  OR row_value.document->'actor_id'IS DISTINCT FROM coalesce(to_jsonb(row_value.actor_id),'null'::jsonb)
  OR row_value.document->'session_id'IS DISTINCT FROM coalesce(to_jsonb(row_value.session_id),'null'::jsonb)
  OR row_value.document->>'recorded_at'IS DISTINCT FROM narcotics_register_reference_v1.utc(row_value.recorded_at)
  OR jsonb_typeof(row_value.document->'body')IS DISTINCT FROM'object'
  OR row_value.record_hash IS DISTINCT FROM narcotics_register_reference_v1.hash('narcotics-recovery-head-v1',row_value.document) THEN
  RAISE EXCEPTION 'narcotics_recovery_history_invalid' USING ERRCODE='23514';END IF;
  IF row_value.prior_head_id IS NULL THEN
   root_count:=root_count+1;
   IF row_value.mode<>'idle'OR row_value.epoch_id IS NOT NULL THEN RAISE EXCEPTION 'narcotics_recovery_history_invalid';END IF;
  ELSE
   SELECT *INTO STRICT prior_value FROM narcotics_recovery_reference_v1.heads h WHERE h.head_id=row_value.prior_head_id;
   IF prior_value.record_hash<>row_value.prior_head_hash OR prior_value.recorded_at>row_value.recorded_at THEN
   RAISE EXCEPTION 'narcotics_recovery_history_invalid' USING ERRCODE='23514';END IF;
   IF row_value.kind='armed'AND(prior_value.mode<>'idle'OR row_value.mode<>'armed'OR row_value.arm_id IS DISTINCT FROM row_value.head_id OR row_value.epoch_id IS NOT NULL)
   OR row_value.kind='epoch_started'AND(prior_value.mode<>'armed'OR row_value.mode<>'armed'OR row_value.arm_id IS DISTINCT FROM prior_value.arm_id OR row_value.epoch_id IS DISTINCT FROM row_value.head_id)
   OR row_value.kind IN ('source_resumed','released')AND(prior_value.mode<>'armed'OR row_value.mode<>'idle'OR row_value.epoch_id IS NOT NULL) THEN
   RAISE EXCEPTION 'narcotics_recovery_history_invalid' USING ERRCODE='23514';END IF;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM narcotics_recovery_reference_v1.heads h WHERE h.prior_head_id=row_value.head_id)THEN
   leaf_count:=leaf_count+1;
   IF narcotics_recovery_reference_v1.projection_of(row_value.document,row_value.record_hash)IS DISTINCT FROM projection THEN
   RAISE EXCEPTION 'narcotics_recovery_projection_invalid' USING ERRCODE='23514';END IF;
   selected:=row_value.document||jsonb_build_object('record_hash',row_value.record_hash);
  END IF;
 END LOOP;
 IF total=0 OR root_count<>1 OR leaf_count<>1 OR selected IS NULL THEN
 RAISE EXCEPTION 'narcotics_recovery_history_invalid' USING ERRCODE='23514';END IF;
 RETURN selected;
END $$;
CREATE FUNCTION narcotics_recovery_reference_v1.require_exclusive_admission() RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=pg_backend_pid()AND l.locktype='advisory'
 AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database())AND l.classid=90271190::oid AND l.objid=0::oid AND l.objsubid=2 AND l.mode='ExclusiveLock'AND l.granted) THEN
 RAISE EXCEPTION 'narcotics_recovery_admission_invalid' USING ERRCODE='42501';END IF;
END $$;
CREATE FUNCTION narcotics_recovery_reference_v1.enter_recovery() RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 -- Refuse a shared-to-exclusive upgrade before any admission/practice wait.
 IF EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=pg_backend_pid()AND l.locktype='advisory'
 AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database())AND l.classid=90271190::oid AND l.objid=0::oid AND l.objsubid=2 AND l.mode='ShareLock'AND l.granted)
 AND NOT EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=pg_backend_pid()AND l.locktype='advisory'
 AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database())AND l.classid=90271190::oid AND l.objid=0::oid AND l.objsubid=2 AND l.mode='ExclusiveLock'AND l.granted)THEN
 RAISE EXCEPTION 'narcotics_recovery_admission_invalid' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(90271190,0);
 PERFORM pg_advisory_xact_lock(90271040,0);
 PERFORM controlled_count_entry_v1.acquire_shared_product_relation_frontier();
 PERFORM controlled_count_entry_v1.require_bound_module();
 PERFORM narcotics_register_reference_v1.require_module();
END $$;
CREATE FUNCTION narcotics_recovery_reference_v1.append_head(p_kind text,p_id uuid,p_actor uuid,p_body jsonb,p_expected_id uuid,p_expected_hash text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE prior_value jsonb;identity_value jsonb;document_value jsonb;projection jsonb;hash_value text;mode_value text;arm_value uuid;epoch_value uuid;at_value timestamptz;
BEGIN
 PERFORM narcotics_recovery_reference_v1.require_exclusive_admission();
 prior_value:=narcotics_recovery_reference_v1.require_head();identity_value:=narcotics_register_reference_v1.identity(p_actor,true);
 IF prior_value->>'head_id'IS DISTINCT FROM p_expected_id::text OR prior_value->>'record_hash'IS DISTINCT FROM p_expected_hash
 OR p_id IS NULL OR p_id='00000000-0000-0000-0000-000000000000'::uuid
 OR jsonb_typeof(p_body)IS DISTINCT FROM'object'OR octet_length(p_body::text)>65536 THEN
 RAISE EXCEPTION 'narcotics_recovery_head_changed' USING ERRCODE='PT409';END IF;
 CASE p_kind
 WHEN 'armed'THEN
  IF prior_value->>'mode'<>'idle'THEN RAISE EXCEPTION 'narcotics_recovery_already_armed';END IF;
  mode_value:='armed';arm_value:=p_id;
 WHEN 'epoch_started'THEN
  IF prior_value->>'mode'<>'armed'THEN RAISE EXCEPTION 'narcotics_recovery_not_armed';END IF;
  mode_value:='armed';arm_value:=(prior_value->>'arm_id')::uuid;epoch_value:=p_id;
 WHEN 'source_resumed','released'THEN
  IF prior_value->>'mode'<>'armed'THEN RAISE EXCEPTION 'narcotics_recovery_not_armed';END IF;
  mode_value:='idle';
 ELSE RAISE EXCEPTION 'narcotics_recovery_transition_invalid';END CASE;
 at_value:=clock_timestamp();
 document_value:=jsonb_build_object('schema_version',1,'domain','lrv-narcotics-recovery-head-v1','head_id',p_id,
 'prior_head_id',p_expected_id,'prior_head_hash',p_expected_hash,'kind',p_kind,'mode',mode_value,'arm_id',arm_value,'epoch_id',epoch_value,
 'actor_id',p_actor,'session_id',identity_value->'session_id','recorded_at',narcotics_register_reference_v1.utc(at_value),'body',p_body);
 hash_value:=narcotics_register_reference_v1.hash('narcotics-recovery-head-v1',document_value);
 INSERT INTO narcotics_recovery_reference_v1.heads VALUES(p_id,p_expected_id,p_expected_hash,p_kind,mode_value,arm_value,epoch_value,p_actor,(identity_value->>'session_id')::uuid,at_value,document_value,hash_value);
 projection:=narcotics_recovery_reference_v1.projection_of(document_value,hash_value);
 EXECUTE format('COMMENT ON SCHEMA narcotics_recovery_reference_v1 IS %L',projection::text);
 RETURN narcotics_recovery_reference_v1.require_head();
END $$;
CREATE FUNCTION narcotics_recovery_reference_v1.latest_epoch(p_head jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE row_value narcotics_recovery_reference_v1.heads;prior_hash text;depth_value integer:=0;
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();
 -- The caller has validated the entire module and head inventory. Bind the
 -- supplied complete document again, then follow actual ancestry, not dates.
 SELECT *INTO STRICT row_value FROM narcotics_recovery_reference_v1.heads h WHERE h.head_id=(p_head->>'head_id')::uuid;
 IF p_head::text IS DISTINCT FROM(row_value.document||jsonb_build_object('record_hash',row_value.record_hash))::text
 OR narcotics_recovery_reference_v1.projection_of(row_value.document,row_value.record_hash)IS DISTINCT FROM narcotics_recovery_reference_v1.catalog_projection()THEN
 RAISE EXCEPTION 'narcotics_recovery_history_invalid' USING ERRCODE='23514';END IF;
 LOOP
  depth_value:=depth_value+1;
  IF depth_value>4096 OR row_value.record_hash IS DISTINCT FROM narcotics_register_reference_v1.hash('narcotics-recovery-head-v1',row_value.document)THEN
  RAISE EXCEPTION 'narcotics_recovery_history_invalid' USING ERRCODE='23514';END IF;
  IF row_value.kind='epoch_started'THEN RETURN row_value.document||jsonb_build_object('record_hash',row_value.record_hash);END IF;
  IF row_value.prior_head_id IS NULL THEN RETURN NULL;END IF;
  prior_hash:=row_value.prior_head_hash;
  SELECT *INTO STRICT row_value FROM narcotics_recovery_reference_v1.heads h WHERE h.head_id=row_value.prior_head_id;
  IF row_value.record_hash IS DISTINCT FROM prior_hash THEN
  RAISE EXCEPTION 'narcotics_recovery_history_invalid' USING ERRCODE='23514';END IF;
 END LOOP;
END $$;
CREATE FUNCTION narcotics_recovery_reference_v1.post_frontier_session_required(p_head jsonb) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE epoch_value jsonb;identity_value jsonb;actor_value uuid;
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();
 epoch_value:=narcotics_recovery_reference_v1.latest_epoch(p_head);
 IF epoch_value IS NULL THEN RETURN;END IF;
 IF p_head->>'mode'='armed'AND p_head->'epoch_id'<>'null'::jsonb
 AND epoch_value#>'{body,native_receiver}'IS DISTINCT FROM narcotics_recovery_reference_v1.server_identity()THEN
 RAISE EXCEPTION 'narcotics_recovery_receiver_changed' USING ERRCODE='42501';END IF;
 actor_value:=auth.uid();identity_value:=narcotics_register_reference_v1.identity(actor_value,false);
 IF NOT EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=(identity_value->>'session_id')::uuid AND s.user_id=actor_value
  AND s.created_at>(epoch_value->>'recorded_at')::timestamptz
  AND(s.not_after IS NULL OR s.not_after>clock_timestamp()))THEN
 RAISE EXCEPTION 'narcotics_recovery_fresh_session_required' USING ERRCODE='42501';END IF;
 -- This is a lasting session watermark, including after release. Ordinary
 -- server restarts do not invalidate sessions created after recovery.
END $$;
-- Prospective recovery control receipts. Not included in the release builder
-- until the complete coordinator and genuine populated restore proof pass.
CREATE TABLE narcotics_recovery_reference_v1.operations (
 operation_id uuid PRIMARY KEY, actor_id uuid NOT NULL, action text NOT NULL,
 state text NOT NULL CHECK(state IN ('saved','abandoned')),
 session_id uuid NOT NULL, recorded_at timestamptz NOT NULL,
 original_request jsonb, request_hash text, receipt jsonb,
 document jsonb NOT NULL, record_hash text NOT NULL,
 CHECK(action IN ('arm','backup_prepare','source_resume','begin_epoch','start_count','preserve_evidence','acknowledge_evidence','release')),
 CHECK((state='saved'AND original_request IS NOT NULL AND request_hash IS NOT NULL AND receipt IS NOT NULL)
    OR(state='abandoned'AND original_request IS NULL AND request_hash IS NULL AND receipt IS NULL)),
 CHECK(request_hash IS NULL OR request_hash~'^[0-9a-f]{64}$'),
 CHECK(record_hash~'^[0-9a-f]{64}$'),
 CHECK(octet_length(document::text)<=8388608)
);
CREATE FUNCTION narcotics_recovery_reference_v1.operation_action(p_value jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF jsonb_typeof(p_value)IS DISTINCT FROM'string'OR p_value#>>'{}'NOT IN
 ('arm','backup_prepare','source_resume','begin_epoch','start_count','preserve_evidence','acknowledge_evidence','release')THEN
 RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 RETURN p_value#>>'{}';
END $$;
CREATE FUNCTION narcotics_recovery_reference_v1.saved_operation(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE row_value narcotics_recovery_reference_v1.operations;expected jsonb;expected_receipt jsonb;request_value jsonb;
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();
 PERFORM narcotics_recovery_reference_v1.require_exclusive_admission();
 SELECT *INTO row_value FROM narcotics_recovery_reference_v1.operations o WHERE o.operation_id=p_id;
 IF NOT FOUND THEN RETURN NULL;END IF;
 expected:=jsonb_build_object('schema_version',1,'domain','lrv-narcotics-recovery-operation-v1',
  'operation_id',row_value.operation_id,'actor_id',row_value.actor_id,'action',row_value.action,'state',row_value.state,
  'session_id',row_value.session_id,'recorded_at',narcotics_register_reference_v1.utc(row_value.recorded_at),
  'original_request',row_value.original_request,'request_hash',row_value.request_hash,'receipt',row_value.receipt);
 IF expected::text IS DISTINCT FROM row_value.document::text
 OR row_value.record_hash IS DISTINCT FROM narcotics_register_reference_v1.hash('narcotics-recovery-operation-v1',expected)
 OR NOT isfinite(row_value.recorded_at)
 OR(row_value.state='saved'AND row_value.request_hash IS DISTINCT FROM narcotics_register_reference_v1.hash('narcotics-recovery-request-v1',row_value.original_request))THEN
 RAISE EXCEPTION 'narcotics_recovery_history_invalid' USING ERRCODE='23514';END IF;
 IF row_value.state='saved'THEN
  request_value:=row_value.original_request;
  PERFORM narcotics_register_reference_v1.keys(request_value,ARRAY['schema_version','actor_id','operation_id','action','expected_head_id','expected_head_hash','data']);
  PERFORM narcotics_register_reference_v1.uuid_value(request_value->'expected_head_id');
  PERFORM narcotics_register_reference_v1.keys(row_value.receipt,ARRAY['schema_version','operation_id','actor_id','action','state','request_hash','data','receipt_hash']);
  expected_receipt:=jsonb_build_object('schema_version',1,'operation_id',row_value.operation_id,'actor_id',row_value.actor_id,
   'action',row_value.action,'state','saved','request_hash',row_value.request_hash,'data',row_value.receipt->'data');
  expected_receipt:=expected_receipt||jsonb_build_object('receipt_hash',narcotics_register_reference_v1.hash('narcotics-recovery-receipt-v1',expected_receipt));
  IF(request_value->'schema_version')::text IS DISTINCT FROM'1'
  OR request_value->'actor_id'IS DISTINCT FROM to_jsonb(row_value.actor_id)
  OR request_value->'operation_id'IS DISTINCT FROM to_jsonb(row_value.operation_id)
  OR request_value->>'action'IS DISTINCT FROM row_value.action
  OR jsonb_typeof(request_value->'data')IS DISTINCT FROM'object'OR octet_length(request_value::text)>4194304
  OR jsonb_typeof(request_value->'expected_head_hash')IS DISTINCT FROM'string'
  OR request_value->>'expected_head_hash'!~'^[0-9a-f]{64}$'
  OR jsonb_typeof(row_value.receipt->'data')IS DISTINCT FROM'object'OR octet_length((row_value.receipt->'data')::text)>131072
  OR expected_receipt::text IS DISTINCT FROM row_value.receipt::text THEN
  RAISE EXCEPTION 'narcotics_recovery_history_invalid' USING ERRCODE='23514';END IF;
 END IF;
 RETURN expected||jsonb_build_object('record_hash',row_value.record_hash);
END $$;
CREATE FUNCTION narcotics_recovery_reference_v1.operation_request(p_request jsonb,p_action text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actor_value uuid;operation_value uuid;saved jsonb;hash_value text;head_value jsonb;
BEGIN
 PERFORM narcotics_recovery_reference_v1.require_exclusive_admission();
 head_value:=narcotics_recovery_reference_v1.require_head();
 PERFORM narcotics_register_reference_v1.keys(p_request,ARRAY['schema_version','actor_id','operation_id','action','expected_head_id','expected_head_hash','data']);
 IF(p_request->'schema_version')::text IS DISTINCT FROM'1'
 OR narcotics_recovery_reference_v1.operation_action(p_request->'action')IS DISTINCT FROM p_action
 OR jsonb_typeof(p_request->'data')IS DISTINCT FROM'object'OR octet_length(p_request::text)>4194304
 OR jsonb_typeof(p_request->'expected_head_hash')IS DISTINCT FROM'string'
 OR p_request->>'expected_head_hash'!~'^[0-9a-f]{64}$'THEN
 RAISE EXCEPTION 'narcotics_request_invalid' USING ERRCODE='22023';END IF;
 actor_value:=narcotics_register_reference_v1.uuid_value(p_request->'actor_id');
 operation_value:=narcotics_register_reference_v1.uuid_value(p_request->'operation_id');
 PERFORM narcotics_register_reference_v1.uuid_value(p_request->'expected_head_id');
 PERFORM narcotics_register_reference_v1.identity(actor_value,p_action<>'acknowledge_evidence');
 saved:=narcotics_recovery_reference_v1.saved_operation(operation_value);
 IF saved IS NULL THEN
  IF head_value->'head_id'IS DISTINCT FROM p_request->'expected_head_id'
  OR head_value->>'record_hash'IS DISTINCT FROM p_request->>'expected_head_hash'THEN
  RAISE EXCEPTION 'narcotics_recovery_head_changed' USING ERRCODE='PT409';END IF;
  RETURN NULL;
 END IF;
 hash_value:=narcotics_register_reference_v1.hash('narcotics-recovery-request-v1',p_request);
 IF saved->'actor_id'IS DISTINCT FROM p_request->'actor_id'OR saved->>'action'IS DISTINCT FROM p_action
 OR saved->>'state'IS DISTINCT FROM'saved'OR saved->>'request_hash'IS DISTINCT FROM hash_value
 OR(saved->'original_request')::text IS DISTINCT FROM p_request::text THEN
 RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409';END IF;
 -- Recovered original receipts take precedence over today's changed head.
 -- This returns evidence only; it cannot reapply the original transition.
 RETURN saved->'receipt';
END $$;
CREATE FUNCTION narcotics_recovery_reference_v1.save_operation(p_request jsonb,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actor_value uuid;operation_value uuid;identity_value jsonb;at_value timestamptz;hash_value text;receipt_value jsonb;document_value jsonb;
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();
 PERFORM narcotics_recovery_reference_v1.require_exclusive_admission();
 actor_value:=narcotics_register_reference_v1.uuid_value(p_request->'actor_id');
 operation_value:=narcotics_register_reference_v1.uuid_value(p_request->'operation_id');
 identity_value:=narcotics_register_reference_v1.identity(actor_value,p_request->>'action'<>'acknowledge_evidence');
 PERFORM narcotics_recovery_reference_v1.operation_action(p_request->'action');
 IF jsonb_typeof(p_data)IS DISTINCT FROM'object'OR octet_length(p_data::text)>131072
 OR narcotics_recovery_reference_v1.saved_operation(operation_value)IS NOT NULL THEN
 RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409';END IF;
 at_value:=clock_timestamp();hash_value:=narcotics_register_reference_v1.hash('narcotics-recovery-request-v1',p_request);
 receipt_value:=jsonb_build_object('schema_version',1,'operation_id',operation_value,'actor_id',actor_value,
  'action',p_request->'action','state','saved','request_hash',hash_value,'data',p_data);
 receipt_value:=receipt_value||jsonb_build_object('receipt_hash',narcotics_register_reference_v1.hash('narcotics-recovery-receipt-v1',receipt_value));
 document_value:=jsonb_build_object('schema_version',1,'domain','lrv-narcotics-recovery-operation-v1',
  'operation_id',operation_value,'actor_id',actor_value,'action',p_request->'action','state','saved',
  'session_id',identity_value->'session_id','recorded_at',narcotics_register_reference_v1.utc(at_value),
  'original_request',p_request,'request_hash',hash_value,'receipt',receipt_value);
 INSERT INTO narcotics_recovery_reference_v1.operations VALUES(operation_value,actor_value,p_request->>'action','saved',
  (identity_value->>'session_id')::uuid,at_value,p_request,hash_value,receipt_value,document_value,
  narcotics_register_reference_v1.hash('narcotics-recovery-operation-v1',document_value));
 PERFORM narcotics_recovery_reference_v1.saved_operation(operation_value);
 RETURN receipt_value;
END $$;
CREATE FUNCTION narcotics_recovery_reference_v1.operation_pointer(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actor_value uuid;operation_value uuid;action_value text;saved jsonb;
BEGIN
 PERFORM narcotics_recovery_reference_v1.require_exclusive_admission();
 PERFORM narcotics_recovery_reference_v1.require_head();
 PERFORM narcotics_register_reference_v1.keys(p_request,ARRAY['schema_version','actor_id','operation_id','action']);
 IF(p_request->'schema_version')::text IS DISTINCT FROM'1'THEN RAISE EXCEPTION 'narcotics_request_invalid';END IF;
 actor_value:=narcotics_register_reference_v1.uuid_value(p_request->'actor_id');
 operation_value:=narcotics_register_reference_v1.uuid_value(p_request->'operation_id');
 action_value:=narcotics_recovery_reference_v1.operation_action(p_request->'action');
 PERFORM narcotics_register_reference_v1.identity(actor_value,false);
 saved:=narcotics_recovery_reference_v1.saved_operation(operation_value);
 IF saved IS NULL THEN RETURN jsonb_build_object('schema_version',1,'actor_id',actor_value,'operation_id',operation_value,'action',action_value,'state','pending','receipt',NULL);END IF;
 IF saved->>'actor_id'IS DISTINCT FROM actor_value::text OR saved->>'action'IS DISTINCT FROM action_value THEN
 RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409';END IF;
 RETURN jsonb_build_object('schema_version',1,'actor_id',actor_value,'operation_id',operation_value,'action',action_value,'state',saved->'state','receipt',saved->'receipt');
END $$;
CREATE FUNCTION narcotics_recovery_reference_v1.close_operation(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE pointer_value jsonb;identity_value jsonb;document_value jsonb;at_value timestamptz;
BEGIN
 pointer_value:=narcotics_recovery_reference_v1.operation_pointer(p_request);
 IF pointer_value->>'state'<>'pending'THEN RETURN pointer_value;END IF;
 identity_value:=narcotics_register_reference_v1.identity((p_request->>'actor_id')::uuid,false);at_value:=clock_timestamp();
 document_value:=jsonb_build_object('schema_version',1,'domain','lrv-narcotics-recovery-operation-v1',
  'operation_id',p_request->'operation_id','actor_id',p_request->'actor_id','action',p_request->'action','state','abandoned',
  'session_id',identity_value->'session_id','recorded_at',narcotics_register_reference_v1.utc(at_value),
  'original_request',NULL,'request_hash',NULL,'receipt',NULL);
 INSERT INTO narcotics_recovery_reference_v1.operations VALUES((p_request->>'operation_id')::uuid,(p_request->>'actor_id')::uuid,
  p_request->>'action','abandoned',(identity_value->>'session_id')::uuid,at_value,NULL,NULL,NULL,document_value,
  narcotics_register_reference_v1.hash('narcotics-recovery-operation-v1',document_value));
 RETURN narcotics_recovery_reference_v1.operation_pointer(p_request);
END $$;
-- Complete prospective recovery scope, including retired/empty products and
-- historical container locations. No current-state or nonzero-quantity filter.
CREATE FUNCTION narcotics_recovery_reference_v1.scope_inventory() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE answer jsonb;
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();
 PERFORM narcotics_recovery_reference_v1.require_exclusive_admission();
 WITH container_locations AS MATERIALIZED(
  SELECT c.product_id,c.initial_location_id location_id FROM public.controlled_stock_containers c
  UNION SELECT c.product_id,h.location_id FROM public.controlled_stock_containers c
   JOIN public.controlled_stock_container_heads h ON h.container_id=c.id
  UNION SELECT c.product_id,t.before_location_id FROM public.controlled_stock_containers c
   JOIN public.controlled_stock_container_transitions t ON t.container_id=c.id
  UNION SELECT c.product_id,t.after_location_id FROM public.controlled_stock_containers c
   JOIN public.controlled_stock_container_transitions t ON t.container_id=c.id
 ),scope_refs AS MATERIALIZED(
  SELECT pv.product_id,ps.site_id FROM public.controlled_stock_policy_versions pv
   JOIN public.controlled_stock_policy_sites ps ON ps.policy_version_id=pv.id
  UNION SELECT product_id,controlling_site_id FROM public.controlled_stock_containers
  UNION SELECT x.product_id,l.site_id FROM container_locations x
   JOIN public.controlled_stock_locations l ON l.id=x.location_id
  UNION SELECT product_id,site_id FROM controlled_count_v1.policies
  UNION SELECT product_id,site_id FROM controlled_count_v1.cycles
  UNION SELECT product_id,site_id FROM controlled_count_v1.operations
  UNION SELECT product_id,site_id FROM controlled_count_v1.causes
  UNION SELECT product_id,site_id FROM controlled_count_v1.open_causes
  UNION SELECT product_id,site_id FROM controlled_count_v1.reconciliation_preparations
  UNION SELECT product_id,site_id FROM controlled_count_v1.operation_closures
  UNION SELECT product_id,site_id FROM controlled_stock_workflow_v1.journal
   WHERE product_id IS NOT NULL AND site_id IS NOT NULL
 ),product_refs AS MATERIALIZED(
  SELECT product_id FROM scope_refs
  UNION SELECT product_id FROM public.controlled_stock_states
  UNION SELECT product_id FROM public.controlled_stock_state_events
  UNION SELECT product_id FROM public.controlled_stock_policy_versions
  UNION SELECT product_id FROM public.controlled_stock_openings
  UNION SELECT product_id FROM public.controlled_stock_events
  UNION SELECT product_id FROM controlled_stock_workflow_v1.journal WHERE product_id IS NOT NULL
 ),bounded_products AS MATERIALIZED(
  SELECT product_id FROM product_refs ORDER BY product_id LIMIT 257
 ),bounded_scopes AS MATERIALIZED(
  SELECT product_id,site_id FROM scope_refs ORDER BY product_id,site_id LIMIT 257
 )SELECT jsonb_build_object('over_capacity',
  (SELECT count(*)>256 FROM bounded_products)OR(SELECT count(*)>256 FROM bounded_scopes),
  'products',(SELECT coalesce(jsonb_agg(product_id ORDER BY product_id),'[]'::jsonb)FROM bounded_products),
  'scopes',(SELECT coalesce(jsonb_agg(jsonb_build_object('product_id',product_id,'site_id',site_id)
   ORDER BY product_id,site_id),'[]'::jsonb)FROM bounded_scopes))INTO answer;
 IF answer->'over_capacity'IS DISTINCT FROM'false'::jsonb THEN
 RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(answer->'products')p(product_id)
  WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(answer->'scopes')s(scope)WHERE s.scope->>'product_id'=p.product_id))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(answer->'scopes')s(scope)
  WHERE NOT EXISTS(SELECT 1 FROM public.controlled_stock_sites site WHERE site.id=(s.scope->>'site_id')::uuid))THEN
 RAISE EXCEPTION 'narcotics_recovery_scope_unavailable' USING ERRCODE='PT409';END IF;
 RETURN answer-'over_capacity';
END $$;
CREATE FUNCTION narcotics_recovery_reference_v1.capture_inventory(p_actor uuid,p_preflight boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE inventory_value jsonb;product_value jsonb;scope_value jsonb;event_value record;
 product_id_value uuid;site_id_value uuid;policy_value jsonb;boundary_value jsonb;
 manifest_value jsonb;scopes_value jsonb:='[]';answer jsonb;observers_value jsonb;
 candidate_value record;roles_value jsonb;observer_value jsonb;capability_value text;
BEGIN
 PERFORM narcotics_recovery_reference_v1.require_exclusive_admission();
 PERFORM narcotics_recovery_reference_v1.require_head();
 IF EXISTS(SELECT 1 FROM controlled_count_v1.pending_products)THEN
 RAISE EXCEPTION 'narcotics_recovery_unfinished_validation' USING ERRCODE='PT409';END IF;
 PERFORM narcotics_register_reference_v1.identity(p_actor,true);
 IF p_preflight IS NULL THEN RAISE EXCEPTION 'narcotics_request_invalid';END IF;
 inventory_value:=narcotics_recovery_reference_v1.scope_inventory();
 FOR product_value IN SELECT value FROM jsonb_array_elements(inventory_value->'products')LOOP
  product_id_value:=narcotics_register_reference_v1.uuid_value(product_value);
  PERFORM public.controlled_stock_product_gate(p_actor,product_id_value);
  PERFORM public.controlled_stock_validate_product(product_id_value);
  -- Every retained event is validated; no recent-history cutoff is accepted.
  FOR event_value IN SELECT e.id FROM public.controlled_stock_events e
   WHERE e.product_id=product_id_value ORDER BY e.sequence LOOP
   PERFORM public.controlled_stock_validate_event(event_value.id);
  END LOOP;
 END LOOP;
 FOR scope_value IN SELECT value FROM jsonb_array_elements(inventory_value->'scopes')LOOP
  product_id_value:=(scope_value->>'product_id')::uuid;site_id_value:=(scope_value->>'site_id')::uuid;
  PERFORM narcotics_register_reference_v1.authority(p_actor,product_id_value,site_id_value);
  boundary_value:=narcotics_recovery_reference_v1.capture_full_boundary(product_id_value,site_id_value);
  manifest_value:=controlled_count_v1.saved_boundary_manifest(boundary_value,site_id_value);
  IF p_preflight THEN
   -- This release can reconcile one onsite available cell with the retained
   -- original correction workflow. Other physical footprints stay unarmed;
   -- they are not silently dropped or converted into a fictitious zero.
   IF jsonb_array_length(boundary_value->'cells')>1 OR jsonb_array_length(boundary_value->'containers')>1
   OR jsonb_array_length(boundary_value->'cells')<>jsonb_array_length(boundary_value->'containers')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(boundary_value->'cells')u(unit)WHERE u.unit->>'channel'IS DISTINCT FROM'available')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(boundary_value->'containers')c(container)WHERE c.container->>'kind'IS DISTINCT FROM'stock')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(boundary_value->'heads')h(head)WHERE h.head->>'status'IS DISTINCT FROM'onsite')
   OR jsonb_array_length(manifest_value->'units')>1
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(manifest_value->'units')u(unit)
    WHERE u.unit->>'channel'IS DISTINCT FROM'available')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(boundary_value->'containers')c(container)
    JOIN jsonb_array_elements(boundary_value->'heads')h(head)ON h.head->'container_id'=c.container->'id'
    JOIN jsonb_array_elements(boundary_value->'cells')cell(cell)ON cell.cell->'container_id'=c.container->'id'
    JOIN jsonb_array_elements(boundary_value->'positions')pos(position)ON pos.position->'cell_id'=cell.cell->'id'
    WHERE c.container->'controlling_site_id'=to_jsonb(site_id_value)AND h.head->>'status'<>'onsite'
     AND(pos.position->>'quantity')::numeric<>0)THEN
   RAISE EXCEPTION 'narcotics_recovery_footprint_unsupported' USING ERRCODE='PT409';END IF;
   policy_value:=controlled_count_v1.policy_history(product_id_value,site_id_value);
   IF policy_value IS NULL THEN RAISE EXCEPTION 'narcotics_recovery_count_unconfigured' USING ERRCODE='PT409';END IF;
   -- The existing two-person workflow must be usable before configuration is
   -- frozen: initiating administrator can observe/manage/prepare/execute/resolve;
   -- an independent observer can approve and confirm. No session is fabricated.
   FOREACH capability_value IN ARRAY ARRAY['observe','manage','reconciliation_prepare','reconciliation_execute','cause_resolve']LOOP
    PERFORM controlled_count_v1.current_principal(p_actor,product_id_value,site_id_value,capability_value);
   END LOOP;
   observers_value:=jsonb_build_array(controlled_count_v1.observer_candidate(p_actor,product_id_value,site_id_value));
   FOR candidate_value IN SELECT p.id FROM public.profiles p JOIN auth.users u ON u.id=p.id
    WHERE p.id<>p_actor AND p.is_active AND public.is_active_staff(p.id)AND(u.banned_until IS NULL OR u.banned_until<=clock_timestamp())
    ORDER BY p.id LOOP
    SELECT coalesce(jsonb_agg(r.role::text ORDER BY r.role::text COLLATE "C"),'[]'::jsonb)INTO roles_value
     FROM public.user_roles r WHERE r.user_id=candidate_value.id;
    IF controlled_count_v1.policy_capability_values(policy_value,roles_value,'observe')
    AND controlled_count_v1.policy_capability_values(policy_value,roles_value,'reconciliation_approve')
    AND controlled_count_v1.policy_capability_values(policy_value,roles_value,'reconciliation_confirm')THEN
     observer_value:=controlled_count_v1.observer_candidate(candidate_value.id,product_id_value,site_id_value);
     observers_value:=observers_value||jsonb_build_array(observer_value);
     EXIT WHEN jsonb_array_length(observers_value)=2;
    END IF;
   END LOOP;
   IF jsonb_array_length(observers_value)<>2 THEN
   RAISE EXCEPTION 'narcotics_recovery_two_observers_required' USING ERRCODE='PT409';END IF;
  END IF;
  scopes_value:=scopes_value||jsonb_build_array(scope_value||jsonb_build_object('boundary',boundary_value,
   'boundary_hash',narcotics_register_reference_v1.hash('narcotics-recovery-physical-boundary-v1',boundary_value)));
  IF octet_length(scopes_value::text)>8388608 THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
 END LOOP;
 answer:=jsonb_build_object('inventory',inventory_value,'scopes',scopes_value);
 IF octet_length(answer::text)>8388608 THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
 RETURN answer;
END $$;
-- Prospective coordinator. It is deliberately outside the release assembly
-- until all controls and the genuine populated-receiver rehearsal are verified.
CREATE TABLE narcotics_recovery_reference_v1.arms (
 arm_id uuid PRIMARY KEY REFERENCES narcotics_recovery_reference_v1.heads(head_id),
 source_boot timestamptz NOT NULL, database_oid oid NOT NULL, database_name text NOT NULL,
 captured_at timestamptz NOT NULL, capture jsonb NOT NULL, capture_hash text NOT NULL,
 document jsonb NOT NULL, record_hash text NOT NULL,
 CHECK(octet_length(capture::text)<=8388608),CHECK(octet_length(document::text)<=8388608),
 CHECK(capture_hash~'^[0-9a-f]{64}$'),CHECK(record_hash~'^[0-9a-f]{64}$')
);
CREATE TABLE narcotics_recovery_reference_v1.backup_markers (
 marker_id uuid PRIMARY KEY REFERENCES narcotics_recovery_reference_v1.operations(operation_id) DEFERRABLE INITIALLY DEFERRED,
 arm_id uuid NOT NULL UNIQUE REFERENCES narcotics_recovery_reference_v1.arms(arm_id),
 source_boot timestamptz NOT NULL, database_oid oid NOT NULL, database_name text NOT NULL,
 recorded_at timestamptz NOT NULL, document jsonb NOT NULL, record_hash text NOT NULL,
 CHECK(octet_length(document::text)<=131072),CHECK(record_hash~'^[0-9a-f]{64}$')
);
CREATE TABLE narcotics_recovery_reference_v1.count_markers (
 -- No FK into a sealed old relation: it would add an undeclared RI trigger.
 -- The exact old cycle is checked through its complete graph before insertion.
 count_id uuid PRIMARY KEY,
 operation_id uuid NOT NULL UNIQUE REFERENCES narcotics_recovery_reference_v1.operations(operation_id) DEFERRABLE INITIALLY DEFERRED,
 arm_id uuid NOT NULL REFERENCES narcotics_recovery_reference_v1.arms(arm_id),
 epoch_id uuid NOT NULL REFERENCES narcotics_recovery_reference_v1.heads(head_id),
 product_id uuid NOT NULL, site_id uuid NOT NULL,
 receiver_boot timestamptz NOT NULL, recorded_at timestamptz NOT NULL,
 document jsonb NOT NULL, record_hash text NOT NULL,
 CHECK(octet_length(document::text)<=131072),CHECK(record_hash~'^[0-9a-f]{64}$')
);
CREATE FUNCTION narcotics_recovery_reference_v1.server_identity() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 RETURN jsonb_build_object('boot',narcotics_register_reference_v1.utc(pg_postmaster_start_time()),
  'database_oid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),'database_name',current_database());
END $$;
CREATE FUNCTION narcotics_recovery_reference_v1.backup_record(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE saved narcotics_recovery_reference_v1.backup_markers;arm_value jsonb;expected_source jsonb;operation_value jsonb;
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();PERFORM narcotics_recovery_reference_v1.require_exclusive_admission();
 SELECT *INTO STRICT saved FROM narcotics_recovery_reference_v1.backup_markers b WHERE b.marker_id=p_id;
 arm_value:=narcotics_recovery_reference_v1.arm_record(saved.arm_id);
 operation_value:=narcotics_recovery_reference_v1.saved_operation(p_id);
 expected_source:=jsonb_build_object('boot',narcotics_register_reference_v1.utc(saved.source_boot),
  'database_oid',saved.database_oid::text,'database_name',saved.database_name);
 PERFORM narcotics_register_reference_v1.keys(saved.document,ARRAY['schema_version','domain','marker_id','arm_id','head_id','head_hash','source','recorded_at','capture_hash']);
 IF(saved.document->'schema_version')::text IS DISTINCT FROM'1'
 OR saved.document->>'domain'IS DISTINCT FROM'lrv-narcotics-backup-preparation-v1'
 OR saved.document->'marker_id'IS DISTINCT FROM to_jsonb(saved.marker_id)
 OR saved.document->'arm_id'IS DISTINCT FROM to_jsonb(saved.arm_id)
 OR saved.document->'head_id'IS DISTINCT FROM to_jsonb(saved.arm_id)
 OR NOT EXISTS(SELECT 1 FROM narcotics_recovery_reference_v1.heads h WHERE h.head_id=saved.arm_id AND h.record_hash=saved.document->>'head_hash')
 OR saved.document->'source'IS DISTINCT FROM expected_source
 OR expected_source IS DISTINCT FROM jsonb_build_object('boot',arm_value->'source_boot','database_oid',arm_value->'database_oid','database_name',arm_value->'database_name')
 OR saved.document->>'recorded_at'IS DISTINCT FROM narcotics_register_reference_v1.utc(saved.recorded_at)
 OR NOT isfinite(saved.recorded_at)OR saved.recorded_at<(arm_value->>'captured_at')::timestamptz
 OR saved.document->'capture_hash'IS DISTINCT FROM arm_value->'capture_hash'
 OR saved.record_hash IS DISTINCT FROM narcotics_register_reference_v1.hash('narcotics-backup-preparation-v1',saved.document)
 OR operation_value->>'action'IS DISTINCT FROM'backup_prepare'OR operation_value->>'state'IS DISTINCT FROM'saved'
 OR operation_value#>'{receipt,data,marker}'IS DISTINCT FROM saved.document
 OR operation_value#>>'{receipt,data,marker_hash}'IS DISTINCT FROM saved.record_hash THEN
 RAISE EXCEPTION 'narcotics_recovery_history_invalid' USING ERRCODE='23514';END IF;
 RETURN saved.document||jsonb_build_object('record_hash',saved.record_hash);
END $$;
CREATE FUNCTION narcotics_recovery_reference_v1.begin_epoch(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE receipt_value jsonb;head_value jsonb;marker_value jsonb;server_value jsonb;identity_value jsonb;capture_value jsonb;arm_value jsonb;prior_epoch jsonb;
BEGIN
 receipt_value:=narcotics_recovery_reference_v1.operation_request(p_request,'begin_epoch');
 IF receipt_value IS NOT NULL THEN RETURN receipt_value;END IF;
 PERFORM narcotics_register_reference_v1.keys(p_request->'data',ARRAY['marker_id','marker_hash','external_capsule_sha256','external_archive_sha256']);
 IF EXISTS(SELECT 1 FROM jsonb_each(p_request->'data')item WHERE item.key<>'marker_id'
  AND(jsonb_typeof(item.value)IS DISTINCT FROM'string'OR item.value#>>'{}'!~'^[0-9a-f]{64}$'))THEN
 RAISE EXCEPTION 'narcotics_request_invalid';END IF;
 head_value:=narcotics_recovery_reference_v1.require_head();
 IF head_value->>'mode'<>'armed'THEN
 RAISE EXCEPTION 'narcotics_recovery_epoch_unavailable' USING ERRCODE='PT409';END IF;
 marker_value:=narcotics_recovery_reference_v1.backup_record(narcotics_register_reference_v1.uuid_value(p_request#>'{data,marker_id}'));
 server_value:=narcotics_recovery_reference_v1.server_identity();
 identity_value:=narcotics_register_reference_v1.identity((p_request->>'actor_id')::uuid,true);
 IF head_value->'epoch_id'<>'null'::jsonb THEN
  prior_epoch:=narcotics_recovery_reference_v1.latest_epoch(head_value);
  IF prior_epoch->'epoch_id'IS DISTINCT FROM head_value->'epoch_id'
  OR prior_epoch#>'{body,native_receiver}'IS NOT DISTINCT FROM server_value
  OR prior_epoch#>'{body,operator_supplied_backup_references}'IS DISTINCT FROM p_request->'data' THEN
  RAISE EXCEPTION 'narcotics_recovery_epoch_unavailable' USING ERRCODE='PT409';END IF;
 END IF;
 -- Epoch time must strictly separate every restored session from later grants.
 IF EXISTS(SELECT 1 FROM auth.sessions s WHERE NOT isfinite(s.created_at)OR s.created_at>clock_timestamp())THEN
 RAISE EXCEPTION 'narcotics_recovery_auth_clock_invalid' USING ERRCODE='PT409';END IF;
 IF marker_value->'arm_id'IS DISTINCT FROM head_value->'arm_id'
 OR marker_value->>'record_hash'IS DISTINCT FROM p_request#>>'{data,marker_hash}'
 OR marker_value#>'{source,boot}'IS NOT DISTINCT FROM server_value->'boot'
 OR(server_value->>'boot')::timestamptz<=(marker_value->>'recorded_at')::timestamptz
 OR NOT EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=(identity_value->>'session_id')::uuid
  AND s.user_id=(p_request->>'actor_id')::uuid AND s.created_at>pg_postmaster_start_time()
  AND(s.not_after IS NULL OR s.not_after>clock_timestamp()))THEN
 RAISE EXCEPTION 'narcotics_recovery_fresh_receiver_required' USING ERRCODE='PT409';END IF;
 arm_value:=narcotics_recovery_reference_v1.arm_record((head_value->>'arm_id')::uuid);
 capture_value:=narcotics_recovery_reference_v1.capture_inventory((p_request->>'actor_id')::uuid,prior_epoch IS NULL);
 IF(prior_epoch IS NULL AND capture_value::text IS DISTINCT FROM(arm_value->'capture')::text)
 OR(capture_value->'inventory')::text IS DISTINCT FROM(arm_value#>'{capture,inventory}')::text THEN
 RAISE EXCEPTION 'narcotics_recovery_boundary_changed' USING ERRCODE='PT409';END IF;
 -- External file references are explicitly attributed to the operator. This
 -- database cannot prove its own dump completed, nor a future archive hash.
 -- The native runner independently binds actual dump completion and receiver
 -- startup before it admits a populated restore proof.
 head_value:=narcotics_recovery_reference_v1.append_head('epoch_started',(p_request->>'operation_id')::uuid,(p_request->>'actor_id')::uuid,
  jsonb_build_object('marker_id',marker_value->'marker_id','marker_hash',marker_value->'record_hash',
   'native_receiver',server_value,'prior_epoch_id',prior_epoch->'epoch_id',
   'current_capture_hash',narcotics_register_reference_v1.hash('narcotics-recovery-capture-v1',capture_value),
   'operator_supplied_backup_references',p_request->'data'),
  (p_request->>'expected_head_id')::uuid,p_request->>'expected_head_hash');
 RETURN narcotics_recovery_reference_v1.save_operation(p_request,jsonb_build_object('head_id',head_value->'head_id','head_hash',head_value->'record_hash',
  'arm_id',head_value->'arm_id','epoch_id',head_value->'epoch_id','mode','armed','started_at',head_value->'recorded_at','native_receiver',server_value));
END $$;
CREATE FUNCTION narcotics_recovery_reference_v1.require_epoch() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE head_value jsonb;epoch_value narcotics_recovery_reference_v1.heads;
BEGIN
 PERFORM narcotics_recovery_reference_v1.require_exclusive_admission();head_value:=narcotics_recovery_reference_v1.require_head();
 IF head_value->>'mode'<>'armed'OR head_value->'epoch_id'='null'::jsonb THEN
 RAISE EXCEPTION 'narcotics_recovery_epoch_required' USING ERRCODE='PT409';END IF;
 SELECT *INTO STRICT epoch_value FROM narcotics_recovery_reference_v1.heads h WHERE h.head_id=(head_value->>'epoch_id')::uuid;
 IF epoch_value.kind<>'epoch_started'OR epoch_value.arm_id IS DISTINCT FROM(head_value->>'arm_id')::uuid
 OR epoch_value.document#>'{body,native_receiver}'IS DISTINCT FROM narcotics_recovery_reference_v1.server_identity()THEN
 RAISE EXCEPTION 'narcotics_recovery_receiver_changed' USING ERRCODE='PT409';END IF;
 RETURN epoch_value.document||jsonb_build_object('record_hash',epoch_value.record_hash);
END $$;
CREATE FUNCTION narcotics_recovery_reference_v1.start_count(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE receipt_value jsonb;epoch_value jsonb;arm_value jsonb;count_request jsonb;count_receipt jsonb;
 identity_value jsonb;document_value jsonb;at_value timestamptz;inventory_value jsonb;
BEGIN
 receipt_value:=narcotics_recovery_reference_v1.operation_request(p_request,'start_count');
 IF receipt_value IS NOT NULL THEN RETURN receipt_value;END IF;
 PERFORM narcotics_register_reference_v1.keys(p_request->'data',ARRAY['request']);
 epoch_value:=narcotics_recovery_reference_v1.require_epoch();
 arm_value:=narcotics_recovery_reference_v1.arm_record((epoch_value->>'arm_id')::uuid);
 count_request:=controlled_count_v1.count_wire_request('start',p_request#>'{data,request}');
 IF count_request->'actor_id'IS DISTINCT FROM p_request->'actor_id'
 OR count_request->'operation_id'IS DISTINCT FROM p_request->'operation_id'
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(arm_value#>'{capture,inventory,scopes}')scope(value)
  WHERE scope.value->'product_id'=count_request->'product_id'AND scope.value->'site_id'=count_request->'site_id')THEN
 RAISE EXCEPTION 'narcotics_recovery_count_scope_invalid' USING ERRCODE='PT409';END IF;
 identity_value:=narcotics_register_reference_v1.identity((p_request->>'actor_id')::uuid,true);
 IF NOT EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=(identity_value->>'session_id')::uuid
  AND s.user_id=(p_request->>'actor_id')::uuid AND s.created_at>(epoch_value->>'recorded_at')::timestamptz
  AND s.created_at>pg_postmaster_start_time()AND(s.not_after IS NULL OR s.not_after>clock_timestamp()))THEN
 RAISE EXCEPTION 'narcotics_recovery_fresh_session_required' USING ERRCODE='PT409';END IF;
 inventory_value:=narcotics_recovery_reference_v1.scope_inventory();
 IF inventory_value::text IS DISTINCT FROM(arm_value#>'{capture,inventory}')::text THEN
 RAISE EXCEPTION 'narcotics_recovery_scope_changed' USING ERRCODE='PT409';END IF;
 -- This lane has only admission/practice int2 locks plus the full121 frontier.
 -- Do not take a hashed operation/product int8 lock before the original fresh
 -- entry guard. Existing unmarked/restored cycles cannot be relabelled.
 IF EXISTS(SELECT 1 FROM controlled_count_v1.cycles c WHERE c.count_id=(count_request->>'count_id')::uuid)
 OR EXISTS(SELECT 1 FROM controlled_count_v1.operations o WHERE o.operation_id=(count_request->>'operation_id')::uuid)
 OR EXISTS(SELECT 1 FROM controlled_count_v1.operation_closures c WHERE c.operation_id=(count_request->>'operation_id')::uuid)
 OR EXISTS(SELECT 1 FROM narcotics_recovery_reference_v1.count_markers m WHERE m.count_id=(count_request->>'count_id')::uuid)THEN
 RAISE EXCEPTION 'narcotics_recovery_fresh_count_required' USING ERRCODE='PT409';END IF;
 count_receipt:=public.start_controlled_count_v1(count_request);
 PERFORM controlled_count_v1.validate_operation_graph((count_request->>'operation_id')::uuid);
 PERFORM controlled_count_v1.count_wire_receipt(count_receipt);
 IF count_receipt->>'action'IS DISTINCT FROM'start'
 OR count_receipt->'operation_id'IS DISTINCT FROM count_request->'operation_id'
 OR count_receipt->'count_id'IS DISTINCT FROM count_request->'count_id'
 OR count_receipt->'actor_id'IS DISTINCT FROM count_request->'actor_id'
 OR count_receipt->>'request_digest'IS DISTINCT FROM controlled_count_v1.count_wire_request_digest('start',count_request)
 OR count_receipt->>'receipt_digest'IS DISTINCT FROM controlled_count_v1.count_wire_receipt_digest(count_receipt)THEN
 RAISE EXCEPTION 'narcotics_recovery_count_receipt_invalid' USING ERRCODE='23514';END IF;
 at_value:=clock_timestamp();
 document_value:=jsonb_build_object('schema_version',1,'domain','lrv-narcotics-recovery-count-marker-v1',
  'count_id',count_request->'count_id','operation_id',p_request->'operation_id','arm_id',epoch_value->'arm_id',
  'epoch_id',epoch_value->'epoch_id','product_id',count_request->'product_id','site_id',count_request->'site_id',
  'receiver_boot',narcotics_register_reference_v1.utc(pg_postmaster_start_time()),'recorded_at',narcotics_register_reference_v1.utc(at_value),
  'count_receipt',count_receipt);
 -- The old count finisher sets all constraints immediate. Save our receipt
 -- before its dependent marker; both still commit or roll back together.
 receipt_value:=narcotics_recovery_reference_v1.save_operation(p_request,jsonb_build_object('count_id',count_request->'count_id',
  'epoch_id',epoch_value->'epoch_id','count_receipt',count_receipt));
 INSERT INTO narcotics_recovery_reference_v1.count_markers VALUES((count_request->>'count_id')::uuid,(p_request->>'operation_id')::uuid,
  (epoch_value->>'arm_id')::uuid,(epoch_value->>'epoch_id')::uuid,(count_request->>'product_id')::uuid,(count_request->>'site_id')::uuid,
  pg_postmaster_start_time(),at_value,document_value,narcotics_register_reference_v1.hash('narcotics-recovery-count-marker-v1',document_value));
 RETURN receipt_value;
END $$;
CREATE FUNCTION narcotics_recovery_reference_v1.arm_record(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE saved narcotics_recovery_reference_v1.arms;expected jsonb;head_value narcotics_recovery_reference_v1.heads;
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();
 PERFORM narcotics_recovery_reference_v1.require_exclusive_admission();
 SELECT *INTO STRICT saved FROM narcotics_recovery_reference_v1.arms a WHERE a.arm_id=p_id;
 SELECT *INTO STRICT head_value FROM narcotics_recovery_reference_v1.heads h WHERE h.head_id=p_id;
 expected:=jsonb_build_object('schema_version',1,'domain','lrv-narcotics-recovery-arm-v1','arm_id',saved.arm_id,
  'source_boot',narcotics_register_reference_v1.utc(saved.source_boot),'database_oid',saved.database_oid::text,
  'database_name',saved.database_name,'captured_at',narcotics_register_reference_v1.utc(saved.captured_at),
  'capture',saved.capture,'capture_hash',saved.capture_hash);
 IF expected::text IS DISTINCT FROM saved.document::text
 OR saved.record_hash IS DISTINCT FROM narcotics_register_reference_v1.hash('narcotics-recovery-arm-v1',expected)
 OR saved.capture_hash IS DISTINCT FROM narcotics_register_reference_v1.hash('narcotics-recovery-capture-v1',saved.capture)
 OR head_value.kind<>'armed'OR head_value.document#>>'{body,capture_hash}'IS DISTINCT FROM saved.capture_hash
 OR NOT isfinite(saved.source_boot)OR NOT isfinite(saved.captured_at)OR saved.source_boot>saved.captured_at THEN
 RAISE EXCEPTION 'narcotics_recovery_history_invalid' USING ERRCODE='23514';END IF;
 RETURN expected||jsonb_build_object('record_hash',saved.record_hash);
END $$;
CREATE FUNCTION narcotics_recovery_reference_v1.preflight(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actor_value uuid;head_value jsonb;capture_value jsonb;
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();
 PERFORM narcotics_recovery_reference_v1.require_exclusive_admission();
 PERFORM narcotics_register_reference_v1.keys(p_request,ARRAY['schema_version','actor_id']);
 IF(p_request->'schema_version')::text IS DISTINCT FROM'1'THEN RAISE EXCEPTION 'narcotics_request_invalid';END IF;
 actor_value:=narcotics_register_reference_v1.uuid_value(p_request->'actor_id');
 PERFORM narcotics_register_reference_v1.identity(actor_value,true);head_value:=narcotics_recovery_reference_v1.require_head();
 IF head_value->>'mode'<>'idle'THEN RAISE EXCEPTION 'narcotics_recovery_already_armed' USING ERRCODE='PT409';END IF;
 capture_value:=narcotics_recovery_reference_v1.capture_inventory(actor_value,true);
 RETURN jsonb_build_object('schema_version',1,'state','ready','head_id',head_value->'head_id','head_hash',head_value->'record_hash',
  'capture_hash',narcotics_register_reference_v1.hash('narcotics-recovery-capture-v1',capture_value),'inventory',capture_value->'inventory');
END $$;
CREATE FUNCTION narcotics_recovery_reference_v1.arm(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE receipt_value jsonb;capture_value jsonb;capture_hash_value text;head_value jsonb;server_value jsonb;document_value jsonb;at_value timestamptz;id_value uuid;
BEGIN
 receipt_value:=narcotics_recovery_reference_v1.operation_request(p_request,'arm');
 IF receipt_value IS NOT NULL THEN RETURN receipt_value;END IF;
 PERFORM narcotics_register_reference_v1.keys(p_request->'data',ARRAY['capture_hash']);
 capture_value:=narcotics_recovery_reference_v1.capture_inventory((p_request->>'actor_id')::uuid,true);
 capture_hash_value:=narcotics_register_reference_v1.hash('narcotics-recovery-capture-v1',capture_value);
 IF p_request#>>'{data,capture_hash}'IS DISTINCT FROM capture_hash_value THEN
 RAISE EXCEPTION 'narcotics_recovery_preflight_changed' USING ERRCODE='PT409';END IF;
 id_value:=(p_request->>'operation_id')::uuid;server_value:=narcotics_recovery_reference_v1.server_identity();at_value:=clock_timestamp();
 head_value:=narcotics_recovery_reference_v1.append_head('armed',id_value,(p_request->>'actor_id')::uuid,
  jsonb_build_object('capture_hash',capture_hash_value,'inventory',capture_value->'inventory','source',server_value),
  (p_request->>'expected_head_id')::uuid,p_request->>'expected_head_hash');
 document_value:=jsonb_build_object('schema_version',1,'domain','lrv-narcotics-recovery-arm-v1','arm_id',id_value,
  'source_boot',server_value->'boot','database_oid',server_value->'database_oid','database_name',server_value->'database_name',
  'captured_at',narcotics_register_reference_v1.utc(at_value),'capture',capture_value,'capture_hash',capture_hash_value);
 INSERT INTO narcotics_recovery_reference_v1.arms VALUES(id_value,(server_value->>'boot')::timestamptz,(server_value->>'database_oid')::oid,
  server_value->>'database_name',at_value,capture_value,capture_hash_value,document_value,narcotics_register_reference_v1.hash('narcotics-recovery-arm-v1',document_value));
 PERFORM narcotics_recovery_reference_v1.arm_record(id_value);
 RETURN narcotics_recovery_reference_v1.save_operation(p_request,jsonb_build_object('head_id',head_value->'head_id',
  'head_hash',head_value->'record_hash','mode','armed','arm_id',id_value,'capture_hash',capture_hash_value));
END $$;
CREATE FUNCTION narcotics_recovery_reference_v1.backup_prepare(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE receipt_value jsonb;head_value jsonb;arm_value jsonb;capture_value jsonb;server_value jsonb;document_value jsonb;hash_value text;at_value timestamptz;
BEGIN
 receipt_value:=narcotics_recovery_reference_v1.operation_request(p_request,'backup_prepare');
 IF receipt_value IS NOT NULL THEN RETURN receipt_value;END IF;
 PERFORM narcotics_register_reference_v1.keys(p_request->'data',ARRAY[]::text[]);
 head_value:=narcotics_recovery_reference_v1.require_head();
 IF head_value->>'mode'<>'armed'OR head_value->'epoch_id'<>'null'::jsonb THEN RAISE EXCEPTION 'narcotics_recovery_backup_unavailable' USING ERRCODE='PT409';END IF;
 arm_value:=narcotics_recovery_reference_v1.arm_record((head_value->>'arm_id')::uuid);server_value:=narcotics_recovery_reference_v1.server_identity();
 IF server_value IS DISTINCT FROM jsonb_build_object('boot',arm_value->'source_boot','database_oid',arm_value->'database_oid','database_name',arm_value->'database_name')THEN
 RAISE EXCEPTION 'narcotics_recovery_source_changed' USING ERRCODE='PT409';END IF;
 capture_value:=narcotics_recovery_reference_v1.capture_inventory((p_request->>'actor_id')::uuid,false);
 IF capture_value::text IS DISTINCT FROM(arm_value->'capture')::text THEN
 RAISE EXCEPTION 'narcotics_recovery_boundary_changed' USING ERRCODE='PT409';END IF;
 at_value:=clock_timestamp();
 -- This is a committed PRE-backup marker. It cannot contain its own future
 -- archive hash or claim the dump has completed. Those bindings stay external.
 document_value:=jsonb_build_object('schema_version',1,'domain','lrv-narcotics-backup-preparation-v1',
  'marker_id',p_request->'operation_id','arm_id',head_value->'arm_id','head_id',head_value->'head_id',
  'head_hash',head_value->'record_hash','source',server_value,'recorded_at',narcotics_register_reference_v1.utc(at_value),
  'capture_hash',arm_value->'capture_hash');
 hash_value:=narcotics_register_reference_v1.hash('narcotics-backup-preparation-v1',document_value);
 INSERT INTO narcotics_recovery_reference_v1.backup_markers VALUES((p_request->>'operation_id')::uuid,(head_value->>'arm_id')::uuid,
  (server_value->>'boot')::timestamptz,(server_value->>'database_oid')::oid,server_value->>'database_name',at_value,document_value,hash_value);
 RETURN narcotics_recovery_reference_v1.save_operation(p_request,jsonb_build_object('marker',document_value,'marker_hash',hash_value));
END $$;
CREATE FUNCTION narcotics_recovery_reference_v1.source_resume(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE receipt_value jsonb;head_value jsonb;arm_value jsonb;capture_value jsonb;server_value jsonb;
BEGIN
 receipt_value:=narcotics_recovery_reference_v1.operation_request(p_request,'source_resume');
 IF receipt_value IS NOT NULL THEN RETURN receipt_value;END IF;
 PERFORM narcotics_register_reference_v1.keys(p_request->'data',ARRAY[]::text[]);head_value:=narcotics_recovery_reference_v1.require_head();
 IF head_value->>'mode'<>'armed'OR head_value->'epoch_id'<>'null'::jsonb THEN
 RAISE EXCEPTION 'narcotics_recovery_source_resume_unavailable' USING ERRCODE='PT409';END IF;
 arm_value:=narcotics_recovery_reference_v1.arm_record((head_value->>'arm_id')::uuid);server_value:=narcotics_recovery_reference_v1.server_identity();
 IF server_value IS DISTINCT FROM jsonb_build_object('boot',arm_value->'source_boot','database_oid',arm_value->'database_oid','database_name',arm_value->'database_name')THEN
 RAISE EXCEPTION 'narcotics_recovery_source_changed' USING ERRCODE='PT409';END IF;
 capture_value:=narcotics_recovery_reference_v1.capture_inventory((p_request->>'actor_id')::uuid,false);
 IF capture_value::text IS DISTINCT FROM(arm_value->'capture')::text THEN
 RAISE EXCEPTION 'narcotics_recovery_boundary_changed' USING ERRCODE='PT409';END IF;
 head_value:=narcotics_recovery_reference_v1.append_head('source_resumed',(p_request->>'operation_id')::uuid,(p_request->>'actor_id')::uuid,
  jsonb_build_object('arm_id',head_value->'arm_id','unchanged_capture_hash',arm_value->'capture_hash','native_source',server_value),
  (p_request->>'expected_head_id')::uuid,p_request->>'expected_head_hash');
 RETURN narcotics_recovery_reference_v1.save_operation(p_request,jsonb_build_object('head_id',head_value->'head_id','head_hash',head_value->'record_hash','mode','idle'));
END $$;
-- Staff-reported recovery evidence is never inserted as a lost original event.
CREATE TABLE narcotics_recovery_reference_v1.evidence (
 evidence_id uuid PRIMARY KEY REFERENCES narcotics_recovery_reference_v1.operations(operation_id) DEFERRABLE INITIALLY DEFERRED,
 arm_id uuid NOT NULL REFERENCES narcotics_recovery_reference_v1.arms(arm_id),
 epoch_id uuid NOT NULL REFERENCES narcotics_recovery_reference_v1.heads(head_id),
 product_id uuid NOT NULL,site_id uuid NOT NULL,actor_id uuid NOT NULL,session_id uuid NOT NULL,
 recorded_at timestamptz NOT NULL,reported_occurred_at timestamptz NOT NULL,
 claim text NOT NULL,filename text NOT NULL,mime text NOT NULL,
 original_bytes bytea NOT NULL CHECK(octet_length(original_bytes)BETWEEN 1 AND 2097152),
 bytes_hash text NOT NULL CHECK(bytes_hash=encode(sha256(original_bytes),'hex')),
 document jsonb NOT NULL,record_hash text NOT NULL CHECK(record_hash~'^[0-9a-f]{64}$'),
 CHECK(octet_length(document::text)<=131072)
);
CREATE TABLE narcotics_recovery_reference_v1.acknowledgments (
 acknowledgment_id uuid PRIMARY KEY REFERENCES narcotics_recovery_reference_v1.operations(operation_id) DEFERRABLE INITIALLY DEFERRED,
 evidence_id uuid NOT NULL REFERENCES narcotics_recovery_reference_v1.evidence(evidence_id),
 epoch_id uuid NOT NULL REFERENCES narcotics_recovery_reference_v1.heads(head_id),
 UNIQUE(evidence_id,epoch_id,session_id),
 evidence_hash text NOT NULL,actor_id uuid NOT NULL,session_id uuid NOT NULL,
 recorded_at timestamptz NOT NULL,review_note text NOT NULL,
 document jsonb NOT NULL,record_hash text NOT NULL CHECK(record_hash~'^[0-9a-f]{64}$'),
 CHECK(octet_length(document::text)<=131072)
);
CREATE FUNCTION narcotics_recovery_reference_v1.fresh_identity(p_actor uuid,p_admin boolean,p_epoch jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE identity_value jsonb;
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();PERFORM narcotics_recovery_reference_v1.require_exclusive_admission();
 identity_value:=narcotics_register_reference_v1.identity(p_actor,p_admin);
 IF NOT EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=(identity_value->>'session_id')::uuid AND s.user_id=p_actor
  AND s.created_at>(p_epoch->>'recorded_at')::timestamptz AND s.created_at>pg_postmaster_start_time()
  AND(s.not_after IS NULL OR s.not_after>clock_timestamp()))THEN
 RAISE EXCEPTION 'narcotics_recovery_fresh_session_required' USING ERRCODE='PT409';END IF;
 RETURN identity_value;
END $$;
CREATE FUNCTION narcotics_recovery_reference_v1.evidence_record(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE saved narcotics_recovery_reference_v1.evidence;expected jsonb;operation_value jsonb;
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();PERFORM narcotics_recovery_reference_v1.require_exclusive_admission();
 SELECT *INTO STRICT saved FROM narcotics_recovery_reference_v1.evidence e WHERE e.evidence_id=p_id;
 expected:=jsonb_build_object('schema_version',1,'domain','lrv-narcotics-recovery-evidence-v1',
  'evidence_id',saved.evidence_id,'arm_id',saved.arm_id,'epoch_id',saved.epoch_id,'product_id',saved.product_id,'site_id',saved.site_id,
  'actor_id',saved.actor_id,'session_id',saved.session_id,'recorded_at',narcotics_register_reference_v1.utc(saved.recorded_at),
  'reported_occurred_at',narcotics_register_reference_v1.utc(saved.reported_occurred_at),'claim',saved.claim,'basis','staff_reported',
  'filename',saved.filename,'mime',saved.mime,'byte_length',octet_length(saved.original_bytes),'bytes_hash',saved.bytes_hash);
 operation_value:=narcotics_recovery_reference_v1.saved_operation(p_id);
 PERFORM narcotics_register_reference_v1.keys(operation_value#>'{original_request,data}',
  ARRAY['product_id','site_id','reported_occurred_at','claim','filename','mime','base64']);
 IF expected::text IS DISTINCT FROM saved.document::text
 OR saved.record_hash IS DISTINCT FROM narcotics_register_reference_v1.hash('narcotics-recovery-evidence-v1',expected)
 OR saved.bytes_hash IS DISTINCT FROM encode(sha256(saved.original_bytes),'hex')
 OR NOT isfinite(saved.recorded_at)OR NOT isfinite(saved.reported_occurred_at)OR saved.reported_occurred_at>saved.recorded_at
 OR operation_value->>'action'IS DISTINCT FROM'preserve_evidence'OR operation_value->>'state'IS DISTINCT FROM'saved'
 OR operation_value->'actor_id'IS DISTINCT FROM to_jsonb(saved.actor_id)
 OR operation_value->'session_id'IS DISTINCT FROM to_jsonb(saved.session_id)
 OR operation_value#>'{original_request,data,product_id}'IS DISTINCT FROM to_jsonb(saved.product_id)
 OR operation_value#>'{original_request,data,site_id}'IS DISTINCT FROM to_jsonb(saved.site_id)
 OR operation_value#>>'{original_request,data,claim}'IS DISTINCT FROM saved.claim
 OR operation_value#>>'{original_request,data,filename}'IS DISTINCT FROM saved.filename
 OR operation_value#>>'{original_request,data,mime}'IS DISTINCT FROM saved.mime
 OR narcotics_register_reference_v1.instant_value(operation_value#>'{original_request,data,reported_occurred_at}')IS DISTINCT FROM saved.reported_occurred_at
 OR operation_value#>>'{original_request,data,base64}'IS DISTINCT FROM replace(encode(saved.original_bytes,'base64'),E'\n','')
 OR operation_value#>'{receipt,data}'IS DISTINCT FROM jsonb_build_object('evidence_id',saved.evidence_id,
  'evidence_hash',saved.record_hash,'bytes_hash',saved.bytes_hash,'basis','staff_reported')THEN
 RAISE EXCEPTION 'narcotics_recovery_history_invalid' USING ERRCODE='23514';END IF;
 RETURN expected||jsonb_build_object('record_hash',saved.record_hash);
END $$;
CREATE FUNCTION narcotics_recovery_reference_v1.read_evidence(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actor_value uuid;evidence_value jsonb;raw_value bytea;
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();PERFORM narcotics_recovery_reference_v1.require_exclusive_admission();
 PERFORM narcotics_recovery_reference_v1.require_head();
 PERFORM narcotics_register_reference_v1.keys(p_request,ARRAY['schema_version','actor_id','evidence_id']);
 IF(p_request->'schema_version')::text IS DISTINCT FROM'1'THEN RAISE EXCEPTION 'narcotics_request_invalid';END IF;
 actor_value:=narcotics_register_reference_v1.uuid_value(p_request->'actor_id');PERFORM narcotics_register_reference_v1.identity(actor_value,false);
 evidence_value:=narcotics_recovery_reference_v1.evidence_record(narcotics_register_reference_v1.uuid_value(p_request->'evidence_id'));
 PERFORM controlled_count_v1.current_principal(actor_value,(evidence_value->>'product_id')::uuid,(evidence_value->>'site_id')::uuid,'read');
 SELECT e.original_bytes INTO STRICT raw_value FROM narcotics_recovery_reference_v1.evidence e WHERE e.evidence_id=(p_request->>'evidence_id')::uuid;
 RETURN jsonb_build_object('schema_version',1,'evidence',evidence_value,'base64',replace(encode(raw_value,'base64'),E'\n',''));
END $$;
CREATE FUNCTION narcotics_recovery_reference_v1.acknowledge_evidence(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE receipt_value jsonb;epoch_value jsonb;identity_value jsonb;evidence_value jsonb;data_value jsonb;
 document_value jsonb;note_value text;at_value timestamptz;
BEGIN
 receipt_value:=narcotics_recovery_reference_v1.operation_request(p_request,'acknowledge_evidence');
 IF receipt_value IS NOT NULL THEN RETURN receipt_value;END IF;
 data_value:=p_request->'data';PERFORM narcotics_register_reference_v1.keys(data_value,ARRAY['evidence_id','evidence_hash','acknowledged','review_note']);
 IF data_value->'acknowledged'IS DISTINCT FROM'true'::jsonb THEN RAISE EXCEPTION 'narcotics_request_invalid';END IF;
 epoch_value:=narcotics_recovery_reference_v1.require_epoch();
 identity_value:=narcotics_recovery_reference_v1.fresh_identity((p_request->>'actor_id')::uuid,false,epoch_value);
 evidence_value:=narcotics_recovery_reference_v1.evidence_record(narcotics_register_reference_v1.uuid_value(data_value->'evidence_id'));
 IF evidence_value->'actor_id'=p_request->'actor_id'OR evidence_value->'arm_id'IS DISTINCT FROM epoch_value->'arm_id'
 OR evidence_value->>'record_hash'IS DISTINCT FROM data_value->>'evidence_hash'THEN
 RAISE EXCEPTION 'narcotics_recovery_independent_review_required' USING ERRCODE='PT409';END IF;
 PERFORM controlled_count_v1.current_principal((p_request->>'actor_id')::uuid,
  (evidence_value->>'product_id')::uuid,(evidence_value->>'site_id')::uuid,'observe');
 note_value:=narcotics_register_reference_v1.text_value(data_value->'review_note',2000);at_value:=clock_timestamp();
 document_value:=jsonb_build_object('schema_version',1,'domain','lrv-narcotics-recovery-acknowledgment-v1',
  'acknowledgment_id',p_request->'operation_id','epoch_id',epoch_value->'epoch_id','evidence_id',evidence_value->'evidence_id','evidence_hash',evidence_value->'record_hash',
  'actor_id',p_request->'actor_id','session_id',identity_value->'session_id','recorded_at',narcotics_register_reference_v1.utc(at_value),
  'review_note',note_value,'meaning_version','1',
  'meaning','I reviewed this exact file and the staff-reported account. This acknowledgment does not certify the file as a recovered original database event.');
 receipt_value:=narcotics_recovery_reference_v1.save_operation(p_request,jsonb_build_object('acknowledgment_id',p_request->'operation_id',
  'evidence_id',evidence_value->'evidence_id','evidence_hash',evidence_value->'record_hash',
  'acknowledgment_hash',narcotics_register_reference_v1.hash('narcotics-recovery-acknowledgment-v1',document_value)));
 INSERT INTO narcotics_recovery_reference_v1.acknowledgments VALUES((p_request->>'operation_id')::uuid,(evidence_value->>'evidence_id')::uuid,(epoch_value->>'epoch_id')::uuid,
  evidence_value->>'record_hash',(p_request->>'actor_id')::uuid,(identity_value->>'session_id')::uuid,at_value,note_value,
  document_value,narcotics_register_reference_v1.hash('narcotics-recovery-acknowledgment-v1',document_value));
 RETURN receipt_value;
END $$;
CREATE FUNCTION narcotics_recovery_reference_v1.acknowledgment_record(p_evidence uuid,p_epoch uuid,p_acknowledgment uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE saved narcotics_recovery_reference_v1.acknowledgments;evidence_value jsonb;operation_value jsonb;expected jsonb;epoch_value narcotics_recovery_reference_v1.heads;
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();PERFORM narcotics_recovery_reference_v1.require_exclusive_admission();
 evidence_value:=narcotics_recovery_reference_v1.evidence_record(p_evidence);
 SELECT *INTO STRICT saved FROM narcotics_recovery_reference_v1.acknowledgments a WHERE a.evidence_id=p_evidence AND a.epoch_id=p_epoch AND a.acknowledgment_id=p_acknowledgment;
 SELECT *INTO STRICT epoch_value FROM narcotics_recovery_reference_v1.heads h WHERE h.head_id=p_epoch;
 operation_value:=narcotics_recovery_reference_v1.saved_operation(saved.acknowledgment_id);
 expected:=jsonb_build_object('schema_version',1,'domain','lrv-narcotics-recovery-acknowledgment-v1',
  'acknowledgment_id',saved.acknowledgment_id,'epoch_id',saved.epoch_id,'evidence_id',saved.evidence_id,'evidence_hash',saved.evidence_hash,
  'actor_id',saved.actor_id,'session_id',saved.session_id,'recorded_at',narcotics_register_reference_v1.utc(saved.recorded_at),
  'review_note',saved.review_note,'meaning_version','1',
  'meaning','I reviewed this exact file and the staff-reported account. This acknowledgment does not certify the file as a recovered original database event.');
 PERFORM narcotics_register_reference_v1.keys(operation_value#>'{original_request,data}',ARRAY['evidence_id','evidence_hash','acknowledged','review_note']);
 IF epoch_value.kind<>'epoch_started'OR to_jsonb(epoch_value.arm_id)IS DISTINCT FROM evidence_value->'arm_id'
 OR saved.recorded_at<=epoch_value.recorded_at
 OR operation_value#>'{original_request,expected_head_id}'IS DISTINCT FROM to_jsonb(saved.epoch_id)
 OR expected::text IS DISTINCT FROM saved.document::text
 OR saved.record_hash IS DISTINCT FROM narcotics_register_reference_v1.hash('narcotics-recovery-acknowledgment-v1',expected)
 OR saved.evidence_hash IS DISTINCT FROM evidence_value->>'record_hash'
 OR saved.actor_id=(evidence_value->>'actor_id')::uuid
 OR NOT isfinite(saved.recorded_at)OR saved.recorded_at<(evidence_value->>'recorded_at')::timestamptz
 OR operation_value->>'action'IS DISTINCT FROM'acknowledge_evidence'OR operation_value->>'state'IS DISTINCT FROM'saved'
 OR operation_value->'actor_id'IS DISTINCT FROM to_jsonb(saved.actor_id)OR operation_value->'session_id'IS DISTINCT FROM to_jsonb(saved.session_id)
 OR operation_value#>'{original_request,data,evidence_id}'IS DISTINCT FROM to_jsonb(saved.evidence_id)
 OR operation_value#>>'{original_request,data,evidence_hash}'IS DISTINCT FROM saved.evidence_hash
 OR operation_value#>'{original_request,data,acknowledged}'IS DISTINCT FROM'true'::jsonb
 OR operation_value#>>'{original_request,data,review_note}'IS DISTINCT FROM saved.review_note
 OR operation_value#>'{receipt,data}'IS DISTINCT FROM jsonb_build_object('acknowledgment_id',saved.acknowledgment_id,
  'evidence_id',saved.evidence_id,'evidence_hash',saved.evidence_hash,'acknowledgment_hash',saved.record_hash)THEN
 RAISE EXCEPTION 'narcotics_recovery_history_invalid' USING ERRCODE='23514';END IF;
 RETURN expected||jsonb_build_object('record_hash',saved.record_hash);
END $$;
CREATE FUNCTION narcotics_recovery_reference_v1.preserve_evidence(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE receipt_value jsonb;epoch_value jsonb;arm_value jsonb;identity_value jsonb;data_value jsonb;
 product_value uuid;site_value uuid;reported_value timestamptz;at_value timestamptz;claim_value text;
 filename_value text;mime_value text;raw_value bytea;hash_value text;document_value jsonb;
BEGIN
 receipt_value:=narcotics_recovery_reference_v1.operation_request(p_request,'preserve_evidence');
 IF receipt_value IS NOT NULL THEN RETURN receipt_value;END IF;
 data_value:=p_request->'data';PERFORM narcotics_register_reference_v1.keys(data_value,
  ARRAY['product_id','site_id','reported_occurred_at','claim','filename','mime','base64']);
 epoch_value:=narcotics_recovery_reference_v1.require_epoch();
 identity_value:=narcotics_recovery_reference_v1.fresh_identity((p_request->>'actor_id')::uuid,true,epoch_value);
 arm_value:=narcotics_recovery_reference_v1.arm_record((epoch_value->>'arm_id')::uuid);
 product_value:=narcotics_register_reference_v1.uuid_value(data_value->'product_id');site_value:=narcotics_register_reference_v1.uuid_value(data_value->'site_id');
 PERFORM narcotics_register_reference_v1.authority((p_request->>'actor_id')::uuid,product_value,site_value);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(arm_value#>'{capture,inventory,scopes}')scope(value)
  WHERE scope.value->'product_id'=to_jsonb(product_value)AND scope.value->'site_id'=to_jsonb(site_value))THEN
 RAISE EXCEPTION 'narcotics_recovery_scope_unavailable' USING ERRCODE='PT409';END IF;
 IF(SELECT count(*)FROM narcotics_recovery_reference_v1.evidence e WHERE e.arm_id=(epoch_value->>'arm_id')::uuid)>=64 THEN
 RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
 reported_value:=narcotics_register_reference_v1.instant_value(data_value->'reported_occurred_at');
 claim_value:=narcotics_register_reference_v1.text_value(data_value->'claim',4000);
 filename_value:=narcotics_register_reference_v1.text_value(data_value->'filename',200);mime_value:=narcotics_register_reference_v1.text_value(data_value->'mime',100);
 IF filename_value~'[/\\]'OR mime_value NOT IN('application/json','text/plain','application/pdf','image/png','image/jpeg')
 OR jsonb_typeof(data_value->'base64')IS DISTINCT FROM'string'OR octet_length(data_value->>'base64')>2796204 THEN
 RAISE EXCEPTION 'narcotics_document_invalid' USING ERRCODE='22023';END IF;
 raw_value:=decode(data_value->>'base64','base64');
 IF octet_length(raw_value)NOT BETWEEN 1 AND 2097152
 OR replace(encode(raw_value,'base64'),E'\n','')IS DISTINCT FROM data_value->>'base64'THEN
 RAISE EXCEPTION 'narcotics_document_invalid' USING ERRCODE='22023';END IF;
 IF mime_value IN('application/pdf','image/png','image/jpeg')THEN
  PERFORM narcotics_register_reference_v1.form_bytes(mime_value,data_value->>'base64');
 ELSE
  PERFORM convert_from(raw_value,'UTF8');
  IF mime_value='application/json'THEN PERFORM convert_from(raw_value,'UTF8')::jsonb;END IF;
 END IF;
 at_value:=clock_timestamp();IF reported_value>at_value THEN RAISE EXCEPTION 'narcotics_request_invalid';END IF;
 hash_value:=encode(sha256(raw_value),'hex');
 document_value:=jsonb_build_object('schema_version',1,'domain','lrv-narcotics-recovery-evidence-v1',
  'evidence_id',p_request->'operation_id','arm_id',epoch_value->'arm_id','epoch_id',epoch_value->'epoch_id',
  'product_id',product_value,'site_id',site_value,'actor_id',p_request->'actor_id','session_id',identity_value->'session_id',
  'recorded_at',narcotics_register_reference_v1.utc(at_value),'reported_occurred_at',narcotics_register_reference_v1.utc(reported_value),
  'claim',claim_value,'basis','staff_reported','filename',filename_value,'mime',mime_value,'byte_length',octet_length(raw_value),'bytes_hash',hash_value);
 receipt_value:=narcotics_recovery_reference_v1.save_operation(p_request,jsonb_build_object('evidence_id',p_request->'operation_id',
  'evidence_hash',narcotics_register_reference_v1.hash('narcotics-recovery-evidence-v1',document_value),'bytes_hash',hash_value,'basis','staff_reported'));
 INSERT INTO narcotics_recovery_reference_v1.evidence VALUES((p_request->>'operation_id')::uuid,(epoch_value->>'arm_id')::uuid,(epoch_value->>'epoch_id')::uuid,
  product_value,site_value,(p_request->>'actor_id')::uuid,(identity_value->>'session_id')::uuid,at_value,reported_value,
  claim_value,filename_value,mime_value,raw_value,hash_value,document_value,narcotics_register_reference_v1.hash('narcotics-recovery-evidence-v1',document_value));
 PERFORM narcotics_recovery_reference_v1.evidence_record((p_request->>'operation_id')::uuid);
 RETURN receipt_value;
END $$;
-- Prospective release checks. Every captured scope needs a genuine fresh count;
-- original policy, expiry, quarantine and product-state gates remain in force.
CREATE FUNCTION narcotics_recovery_reference_v1.count_marker_record(p_count uuid,p_epoch jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE saved narcotics_recovery_reference_v1.count_markers;expected jsonb;operation_value jsonb;cycle_value controlled_count_v1.cycles;parent_operation controlled_count_v1.operations;
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();PERFORM narcotics_recovery_reference_v1.require_exclusive_admission();
 SELECT *INTO STRICT saved FROM narcotics_recovery_reference_v1.count_markers m WHERE m.count_id=p_count;
 PERFORM controlled_count_v1.validate_operation_graph(saved.operation_id);
 SELECT *INTO STRICT cycle_value FROM controlled_count_v1.cycles c WHERE c.count_id=p_count;
 operation_value:=narcotics_recovery_reference_v1.saved_operation(saved.operation_id);
 SELECT *INTO STRICT parent_operation FROM controlled_count_v1.operations o WHERE o.operation_id=saved.operation_id;
 expected:=jsonb_build_object('schema_version',1,'domain','lrv-narcotics-recovery-count-marker-v1',
  'count_id',saved.count_id,'operation_id',saved.operation_id,'arm_id',saved.arm_id,'epoch_id',saved.epoch_id,
  'product_id',saved.product_id,'site_id',saved.site_id,'receiver_boot',narcotics_register_reference_v1.utc(saved.receiver_boot),
  'recorded_at',narcotics_register_reference_v1.utc(saved.recorded_at),'count_receipt',operation_value#>'{receipt,data,count_receipt}');
 IF expected::text IS DISTINCT FROM saved.document::text
 OR saved.record_hash IS DISTINCT FROM narcotics_register_reference_v1.hash('narcotics-recovery-count-marker-v1',expected)
 OR saved.arm_id IS DISTINCT FROM(p_epoch->>'arm_id')::uuid OR saved.epoch_id IS DISTINCT FROM(p_epoch->>'epoch_id')::uuid
 OR saved.receiver_boot IS DISTINCT FROM pg_postmaster_start_time()
 OR saved.product_id IS DISTINCT FROM cycle_value.product_id OR saved.site_id IS DISTINCT FROM cycle_value.site_id
 OR cycle_value.start_operation_id IS DISTINCT FROM saved.operation_id
 OR NOT isfinite(saved.recorded_at)OR saved.recorded_at<cycle_value.started_at
 OR cycle_value.started_at<=(p_epoch->>'recorded_at')::timestamptz
 OR operation_value->>'action'IS DISTINCT FROM'start_count'OR operation_value->>'state'IS DISTINCT FROM'saved'
 OR parent_operation.action IS DISTINCT FROM'start'OR parent_operation.result_kind IS DISTINCT FROM'cycle'
 OR parent_operation.result_id IS DISTINCT FROM saved.count_id
 OR to_jsonb(parent_operation.actor_id)IS DISTINCT FROM operation_value->'actor_id'
 OR to_jsonb(parent_operation.original_session_id)IS DISTINCT FROM operation_value->'session_id'
 OR parent_operation.canonical_request::text IS DISTINCT FROM(operation_value#>'{original_request,data,request}')::text
 OR parent_operation.receipt::text IS DISTINCT FROM(operation_value#>'{receipt,data,count_receipt}')::text
 OR operation_value#>'{receipt,data,count_id}'IS DISTINCT FROM to_jsonb(saved.count_id)
 OR operation_value#>'{receipt,data,epoch_id}'IS DISTINCT FROM to_jsonb(saved.epoch_id)
 OR operation_value#>'{original_request,data,request,count_id}'IS DISTINCT FROM to_jsonb(saved.count_id)
 OR operation_value#>'{original_request,data,request,product_id}'IS DISTINCT FROM to_jsonb(saved.product_id)
 OR operation_value#>'{original_request,data,request,site_id}'IS DISTINCT FROM to_jsonb(saved.site_id)THEN
 RAISE EXCEPTION 'narcotics_recovery_count_marker_invalid' USING ERRCODE='23514';END IF;
 RETURN expected||jsonb_build_object('record_hash',saved.record_hash);
END $$;
CREATE FUNCTION narcotics_recovery_reference_v1.release(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE receipt_value jsonb;epoch_value jsonb;arm_value jsonb;capture_value jsonb;scope_value jsonb;chosen_value jsonb;
 agreements_value jsonb:='[]';evidence_value record;evidence_document jsonb;acknowledgment_value jsonb;
 evidence_refs jsonb:='[]';product_value jsonb;causes_value jsonb;head_value jsonb;note_value text;scope_count integer;chosen_ack jsonb;
BEGIN
 receipt_value:=narcotics_recovery_reference_v1.operation_request(p_request,'release');
 IF receipt_value IS NOT NULL THEN RETURN receipt_value;END IF;
 PERFORM narcotics_register_reference_v1.keys(p_request->'data',ARRAY['agreements','acknowledgments','history_review_note']);
 IF jsonb_typeof(p_request#>'{data,agreements}')IS DISTINCT FROM'array'
 OR jsonb_array_length(p_request#>'{data,agreements}')>256 THEN RAISE EXCEPTION 'narcotics_request_invalid';END IF;
 note_value:=narcotics_register_reference_v1.text_value(p_request#>'{data,history_review_note}',4000);
 epoch_value:=narcotics_recovery_reference_v1.require_epoch();
 PERFORM narcotics_recovery_reference_v1.fresh_identity((p_request->>'actor_id')::uuid,true,epoch_value);
 arm_value:=narcotics_recovery_reference_v1.arm_record((epoch_value->>'arm_id')::uuid);
 capture_value:=narcotics_recovery_reference_v1.capture_inventory((p_request->>'actor_id')::uuid,false);
 IF(capture_value->'inventory')::text IS DISTINCT FROM(arm_value#>'{capture,inventory}')::text THEN
 RAISE EXCEPTION 'narcotics_recovery_scope_changed' USING ERRCODE='PT409';END IF;
 scope_count:=jsonb_array_length(capture_value->'scopes');
 IF jsonb_array_length(p_request#>'{data,agreements}')<>scope_count
 OR(SELECT count(DISTINCT jsonb_build_array(item->'product_id',item->'site_id'))FROM jsonb_array_elements(p_request#>'{data,agreements}')item)<>scope_count THEN
 RAISE EXCEPTION 'narcotics_recovery_every_scope_required' USING ERRCODE='PT409';END IF;
 FOR scope_value IN SELECT value FROM jsonb_array_elements(capture_value->'scopes')LOOP
  SELECT item INTO STRICT chosen_value FROM jsonb_array_elements(p_request#>'{data,agreements}')item
   WHERE item->'product_id'=scope_value->'product_id'AND item->'site_id'=scope_value->'site_id';
  PERFORM controlled_count_v1.current_principal((p_request->>'actor_id')::uuid,
   (scope_value->>'product_id')::uuid,(scope_value->>'site_id')::uuid,'manage');
  agreements_value:=agreements_value||jsonb_build_array(narcotics_recovery_reference_v1.agreement_required(chosen_value,scope_value,epoch_value));
 END LOOP;
 FOR product_value IN SELECT value FROM jsonb_array_elements(capture_value#>'{inventory,products}')LOOP
  causes_value:=controlled_count_v1.product_live_causes((product_value#>>'{}')::uuid);
  IF causes_value->'causes'IS DISTINCT FROM'[]'::jsonb OR causes_value->'membership'IS DISTINCT FROM'[]'::jsonb THEN
  RAISE EXCEPTION 'narcotics_recovery_unresolved_causes' USING ERRCODE='PT409';END IF;
 END LOOP;
 IF jsonb_typeof(p_request#>'{data,acknowledgments}')IS DISTINCT FROM'array'
 OR jsonb_array_length(p_request#>'{data,acknowledgments}')>64
 OR jsonb_array_length(p_request#>'{data,acknowledgments}')<>(SELECT count(*)FROM narcotics_recovery_reference_v1.evidence e WHERE e.arm_id=(epoch_value->>'arm_id')::uuid)
 OR(SELECT count(DISTINCT value->'evidence_id')FROM jsonb_array_elements(p_request#>'{data,acknowledgments}'))<>jsonb_array_length(p_request#>'{data,acknowledgments}')THEN
 RAISE EXCEPTION 'narcotics_recovery_every_evidence_review_required' USING ERRCODE='PT409';END IF;
 IF(SELECT count(*)FROM narcotics_recovery_reference_v1.evidence e WHERE e.arm_id=(epoch_value->>'arm_id')::uuid)>64 THEN
 RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
 FOR evidence_value IN SELECT e.evidence_id FROM narcotics_recovery_reference_v1.evidence e
  WHERE e.arm_id=(epoch_value->>'arm_id')::uuid ORDER BY e.evidence_id LOOP
  evidence_document:=narcotics_recovery_reference_v1.evidence_record(evidence_value.evidence_id);
  SELECT value INTO STRICT chosen_ack FROM jsonb_array_elements(p_request#>'{data,acknowledgments}')
   WHERE value->'evidence_id'=to_jsonb(evidence_value.evidence_id);
  PERFORM narcotics_register_reference_v1.keys(chosen_ack,ARRAY['evidence_id','acknowledgment_id']);
  acknowledgment_value:=narcotics_recovery_reference_v1.acknowledgment_record(evidence_value.evidence_id,(epoch_value->>'epoch_id')::uuid,
   narcotics_register_reference_v1.uuid_value(chosen_ack->'acknowledgment_id'));
  PERFORM controlled_count_v1.observer_candidate((acknowledgment_value->>'actor_id')::uuid,
   (evidence_document->>'product_id')::uuid,(evidence_document->>'site_id')::uuid);
  IF NOT EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=(acknowledgment_value->>'session_id')::uuid
   AND s.user_id=(acknowledgment_value->>'actor_id')::uuid AND s.created_at>(epoch_value->>'recorded_at')::timestamptz
   AND s.created_at>pg_postmaster_start_time()AND(s.not_after IS NULL OR s.not_after>clock_timestamp()))THEN
  RAISE EXCEPTION 'narcotics_recovery_fresh_session_required' USING ERRCODE='PT409';END IF;
  evidence_refs:=evidence_refs||jsonb_build_array(jsonb_build_object('evidence_id',evidence_value.evidence_id,
   'evidence_hash',evidence_document->'record_hash','acknowledgment_id',acknowledgment_value->'acknowledgment_id',
   'acknowledgment_hash',acknowledgment_value->'record_hash'));
 END LOOP;
 IF scope_count>0 AND jsonb_array_length(evidence_refs)=0 THEN
 RAISE EXCEPTION 'narcotics_recovery_history_review_required' USING ERRCODE='PT409';END IF;
 -- The full immutable release record lives in the saved operation receipt;
 -- the bounded mode head carries hashes/references, never large boundary data.
 head_value:=narcotics_recovery_reference_v1.append_head('released',(p_request->>'operation_id')::uuid,(p_request->>'actor_id')::uuid,
  jsonb_build_object('arm_id',epoch_value->'arm_id','epoch_id',epoch_value->'epoch_id',
   'agreements_hash',narcotics_register_reference_v1.hash('narcotics-recovery-release-agreements-v1',agreements_value),
   'evidence_hash',narcotics_register_reference_v1.hash('narcotics-recovery-release-evidence-v1',evidence_refs),
   'history_review_note_hash',encode(sha256(convert_to(note_value,'UTF8')),'hex'),'existing_stock_restrictions_preserved',true),
  (p_request->>'expected_head_id')::uuid,p_request->>'expected_head_hash');
 RETURN narcotics_recovery_reference_v1.save_operation(p_request,jsonb_build_object('head_id',head_value->'head_id','head_hash',head_value->'record_hash',
  'mode','idle','arm_id',epoch_value->'arm_id','epoch_id',epoch_value->'epoch_id','agreements',agreements_value,
  'reviewed_evidence',evidence_refs,'history_review_note',note_value,'existing_stock_restrictions_preserved',true));
END $$;
CREATE FUNCTION narcotics_recovery_reference_v1.agreement_required(p_chosen jsonb,p_scope jsonb,p_epoch jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE marker_value jsonb;outcome_value controlled_count_v1.outcomes;outcome_document jsonb;
 cycle_value controlled_count_v1.cycles;snapshot_value controlled_count_v1.snapshots;
 statement_value controlled_count_v1.statements;statement_document jsonb;policy_value jsonb;
 statement_id_value uuid;statement_session_value uuid;statement_count integer:=0;
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();PERFORM narcotics_recovery_reference_v1.require_exclusive_admission();
 PERFORM narcotics_register_reference_v1.keys(p_chosen,ARRAY['product_id','site_id','count_id','outcome_id']);
 IF p_chosen->'product_id'IS DISTINCT FROM p_scope->'product_id'OR p_chosen->'site_id'IS DISTINCT FROM p_scope->'site_id'THEN
 RAISE EXCEPTION 'narcotics_recovery_count_scope_invalid' USING ERRCODE='PT409';END IF;
 marker_value:=narcotics_recovery_reference_v1.count_marker_record(narcotics_register_reference_v1.uuid_value(p_chosen->'count_id'),p_epoch);
 IF marker_value->'product_id'IS DISTINCT FROM p_scope->'product_id'OR marker_value->'site_id'IS DISTINCT FROM p_scope->'site_id'THEN
 RAISE EXCEPTION 'narcotics_recovery_count_scope_invalid' USING ERRCODE='PT409';END IF;
 outcome_document:=controlled_count_v1.saved_result_graph('outcome',narcotics_register_reference_v1.uuid_value(p_chosen->'outcome_id'));
 SELECT *INTO STRICT outcome_value FROM controlled_count_v1.outcomes o WHERE o.outcome_id=(p_chosen->>'outcome_id')::uuid;
 SELECT *INTO STRICT cycle_value FROM controlled_count_v1.cycles c WHERE c.count_id=(p_chosen->>'count_id')::uuid;
 SELECT *INTO STRICT snapshot_value FROM controlled_count_v1.snapshots s WHERE s.snapshot_id=cycle_value.snapshot_id;
 policy_value:=controlled_count_v1.policy_history(cycle_value.product_id,cycle_value.site_id);
 IF outcome_value.count_id IS DISTINCT FROM cycle_value.count_id OR outcome_value.snapshot_id IS DISTINCT FROM snapshot_value.snapshot_id
 OR outcome_value.kind<>'agreement'OR outcome_document#>>'{body,kind}'IS DISTINCT FROM'agreement'
 OR(outcome_document#>'{body,boundary_observation,boundary}')::text IS DISTINCT FROM(p_scope->'boundary')::text
 OR(outcome_document->>'recorded_at')::timestamptz<=(p_epoch->>'recorded_at')::timestamptz
 OR cycle_value.actor_a_id=cycle_value.actor_b_id OR snapshot_value.captured_at<=(p_epoch->>'recorded_at')::timestamptz
 OR(snapshot_value.document->'policy')::text IS DISTINCT FROM policy_value::text THEN
 RAISE EXCEPTION 'narcotics_recovery_fresh_agreement_required' USING ERRCODE='PT409';END IF;
 FOREACH statement_id_value IN ARRAY ARRAY[outcome_value.statement_a_id,outcome_value.statement_b_id]LOOP
  statement_document:=controlled_count_v1.saved_result_graph('statement',statement_id_value);
  SELECT *INTO STRICT statement_value FROM controlled_count_v1.statements s WHERE s.statement_id=statement_id_value;
  statement_session_value:=(statement_document#>>'{actor,session_id}')::uuid;
  PERFORM controlled_count_v1.observer_candidate(statement_value.actor_id,cycle_value.product_id,cycle_value.site_id);
  IF statement_value.count_id IS DISTINCT FROM cycle_value.count_id OR statement_value.snapshot_id IS DISTINCT FROM snapshot_value.snapshot_id
  OR(statement_document->>'recorded_at')::timestamptz<=(p_epoch->>'recorded_at')::timestamptz
  OR(statement_document#>>'{body,observation,observed_at}')::timestamptz<=(p_epoch->>'recorded_at')::timestamptz
  OR controlled_count_v1.observation_time_fresh(snapshot_value.captured_at,
   (statement_document#>>'{body,observation,observed_at}')::timestamptz,clock_timestamp(),(policy_value->>'max_observation_age_seconds')::integer)IS NOT TRUE
  OR NOT EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=statement_session_value AND s.user_id=statement_value.actor_id
   AND s.created_at>(p_epoch->>'recorded_at')::timestamptz AND s.created_at>pg_postmaster_start_time()
   AND(s.not_after IS NULL OR s.not_after>clock_timestamp()))THEN
  RAISE EXCEPTION 'narcotics_recovery_fresh_observations_required' USING ERRCODE='PT409';END IF;
  statement_count:=statement_count+1;
 END LOOP;
 IF statement_count<>2 THEN RAISE EXCEPTION 'narcotics_recovery_fresh_observations_required' USING ERRCODE='PT409';END IF;
 RETURN jsonb_build_object('product_id',p_scope->'product_id','site_id',p_scope->'site_id','count_id',cycle_value.count_id,
  'outcome_id',outcome_value.outcome_id,'outcome_hash',outcome_value.record_hash,'count_marker_hash',marker_value->'record_hash',
  'boundary_hash',p_scope->'boundary_hash');
END $$;
CREATE FUNCTION narcotics_recovery_reference_v1.status(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actor_value uuid;head_value jsonb;epoch_value jsonb;arm_value jsonb;scope_value jsonb;roles_value jsonb;identity_value jsonb;fresh_value boolean:=false;latest_epoch_value jsonb;needs_epoch_value boolean:=false;
 policy_value jsonb;visible_scopes jsonb:='[]';evidence_value record;evidence_document jsonb;
 evidence_values jsonb:='[]';ack_value narcotics_recovery_reference_v1.acknowledgments;admin_value boolean;
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();PERFORM narcotics_recovery_reference_v1.require_exclusive_admission();
 head_value:=narcotics_recovery_reference_v1.require_head();
 PERFORM narcotics_register_reference_v1.keys(p_request,ARRAY['schema_version','actor_id']);
 IF(p_request->'schema_version')::text IS DISTINCT FROM'1'THEN RAISE EXCEPTION 'narcotics_request_invalid';END IF;
 actor_value:=narcotics_register_reference_v1.uuid_value(p_request->'actor_id');identity_value:=narcotics_register_reference_v1.identity(actor_value,false);
 latest_epoch_value:=narcotics_recovery_reference_v1.latest_epoch(head_value);
 SELECT EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=(identity_value->>'session_id')::uuid AND s.user_id=actor_value
  AND(latest_epoch_value IS NULL OR s.created_at>(latest_epoch_value->>'recorded_at')::timestamptz)
  AND(s.not_after IS NULL OR s.not_after>clock_timestamp()))INTO fresh_value;
 SELECT coalesce(jsonb_agg(r.role::text ORDER BY r.role::text COLLATE "C"),'[]'::jsonb),coalesce(bool_or(r.role='ADMIN'),false)
  INTO roles_value,admin_value FROM public.user_roles r WHERE r.user_id=actor_value;
 IF head_value->>'mode'='armed'THEN
  arm_value:=narcotics_recovery_reference_v1.arm_record((head_value->>'arm_id')::uuid);
  FOR scope_value IN SELECT value FROM jsonb_array_elements(arm_value#>'{capture,inventory,scopes}')LOOP
   policy_value:=controlled_count_v1.policy_history((scope_value->>'product_id')::uuid,(scope_value->>'site_id')::uuid);
   IF policy_value IS NOT NULL AND controlled_count_v1.policy_capability_values(policy_value,roles_value,'read')THEN
    visible_scopes:=visible_scopes||jsonb_build_array(scope_value);
   END IF;
  END LOOP;
  IF head_value->'epoch_id'<>'null'::jsonb THEN
   epoch_value:=latest_epoch_value;
   needs_epoch_value:=epoch_value#>'{body,native_receiver}'IS DISTINCT FROM narcotics_recovery_reference_v1.server_identity();
   IF needs_epoch_value THEN fresh_value:=false;END IF;
   IF(SELECT count(*)FROM narcotics_recovery_reference_v1.evidence e WHERE e.arm_id=(epoch_value->>'arm_id')::uuid)>64 THEN
   RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
   FOR evidence_value IN SELECT e.evidence_id,e.product_id,e.site_id FROM narcotics_recovery_reference_v1.evidence e
    WHERE e.arm_id=(epoch_value->>'arm_id')::uuid ORDER BY e.recorded_at,e.evidence_id LOOP
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(visible_scopes)scope(value)
     WHERE scope.value->'product_id'=to_jsonb(evidence_value.product_id)AND scope.value->'site_id'=to_jsonb(evidence_value.site_id))THEN
     evidence_document:=narcotics_recovery_reference_v1.evidence_record(evidence_value.evidence_id);
     SELECT *INTO ack_value FROM narcotics_recovery_reference_v1.acknowledgments a WHERE a.evidence_id=evidence_value.evidence_id AND a.epoch_id=(epoch_value->>'epoch_id')::uuid ORDER BY a.recorded_at DESC,a.acknowledgment_id DESC LIMIT 1;
     IF FOUND THEN PERFORM narcotics_recovery_reference_v1.acknowledgment_record(evidence_value.evidence_id,(epoch_value->>'epoch_id')::uuid,ack_value.acknowledgment_id);END IF;
     evidence_values:=evidence_values||jsonb_build_array(jsonb_build_object('evidence',evidence_document,
      'acknowledgment',CASE WHEN ack_value.acknowledgment_id IS NULL THEN NULL ELSE ack_value.document||jsonb_build_object('record_hash',ack_value.record_hash)END));
    END IF;
   END LOOP;
  END IF;
 END IF;
 RETURN jsonb_build_object('schema_version',1,'actor_id',actor_value,'session_id',identity_value->'session_id',
  'is_admin',admin_value,'fresh_session',fresh_value,'mode',head_value->'mode',
  'head_id',head_value->'head_id','head_hash',head_value->'record_hash','arm_id',head_value->'arm_id','epoch_id',head_value->'epoch_id',
  'epoch_started_at',epoch_value->'recorded_at','latest_epoch_started_at',latest_epoch_value->'recorded_at','needs_new_epoch',needs_epoch_value,'native_server',narcotics_recovery_reference_v1.server_identity(),
  'scopes',visible_scopes,'evidence',evidence_values);
END $$;
CREATE FUNCTION narcotics_register_reference_v1.module_properties(p_register text,p_recovery text,p_canonical_register text,p_canonical_recovery text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE result jsonb;reference_value boolean:=p_register<>p_canonical_register;
BEGIN
 SELECT jsonb_build_object(
 'schemas',(SELECT jsonb_object_agg(n.nspname,jsonb_build_object('owner',pg_get_userbyid(n.nspowner),
  'acl',(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantee,a.privilege_type),'[]'::jsonb) FROM aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner)))a))) FROM pg_namespace n WHERE n.nspname IN(p_register,p_recovery)),
 'default_acl',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'role',pg_get_userbyid(d.defaclrole),'kind',d.defaclobjtype,'acl',d.defaclacl::text) ORDER BY n.nspname,d.defaclrole,d.defaclobjtype),'[]'::jsonb) FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE n.nspname IN(p_register,p_recovery)),
 'relations',(SELECT coalesce(jsonb_object_agg(n.nspname||'.'||c.relname,jsonb_build_object(
  'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'persistence',c.relpersistence,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'options',to_jsonb(c.reloptions),'is_partition',c.relispartition,
  'dropped_columns',(SELECT count(*) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND a.attisdropped),
  'columns',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',a.attname,'number',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,
   'collation',CASE WHEN a.attcollation=0 THEN NULL ELSE(SELECT ns.nspname||'.'||co.collname FROM pg_collation co JOIN pg_namespace ns ON ns.oid=co.collnamespace WHERE co.oid=a.attcollation)END,
   'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl::text) ORDER BY a.attnum),'[]'::jsonb) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
  'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',q.conname,'kind',q.contype,'deferrable',q.condeferrable,'deferred',q.condeferred,'validated',q.convalidated,'definition',pg_get_constraintdef(q.oid,false)) ORDER BY q.conname),'[]'::jsonb) FROM pg_constraint q WHERE q.conrelid=c.oid),
  'indexes',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',ci.relname,'definition',pg_get_indexdef(i.indexrelid,0,false),'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive) ORDER BY ci.relname),'[]'::jsonb) FROM pg_index i JOIN pg_class ci ON ci.oid=i.indexrelid WHERE i.indrelid=c.oid),
  'policies',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',p.polname,'command',p.polcmd,'permissive',p.polpermissive,'roles',(SELECT jsonb_agg(CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r)END ORDER BY r) FROM unnest(p.polroles)r),'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname),'[]'::jsonb) FROM pg_policy p WHERE p.polrelid=c.oid),
  'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_get_triggerdef(t.oid,false),'enabled',t.tgenabled,'type',t.tgtype,'deferrable',t.tgdeferrable,'deferred',t.tginitdeferred) ORDER BY t.tgname),'[]'::jsonb) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal),
  -- RI trigger names contain installation OIDs. Compare every semantic RI
  -- registration instead; no observed trigger name becomes a source literal.
  'internal_triggers',(SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM(SELECT jsonb_build_object('function',p.proname,'type',t.tgtype,'enabled',t.tgenabled,'deferrable',t.tgdeferrable,'deferred',t.tginitdeferred,'constraint',q.conname,'referenced_relation',rn.nspname||'.'||rc.relname,'args',encode(t.tgargs,'hex'))value FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid LEFT JOIN pg_constraint q ON q.oid=t.tgconstraint LEFT JOIN pg_class rc ON rc.oid=t.tgconstrrelid LEFT JOIN pg_namespace rn ON rn.oid=rc.relnamespace WHERE t.tgrelid=c.oid AND t.tgisinternal)registrations),
  'acl',(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)END,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantee,a.privilege_type),'[]'::jsonb) FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a)) ORDER BY n.nspname,c.relname),'{}'::jsonb) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN(p_register,p_recovery)),
 'types',(SELECT coalesce(jsonb_object_agg(n.nspname||'.'||t.typname,jsonb_build_object('kind',t.typtype,'category',t.typcategory,'owner',pg_get_userbyid(t.typowner),'not_null',t.typnotnull,'defined',t.typisdefined,'relation',CASE WHEN t.typrelid=0 THEN NULL ELSE(SELECT rn.nspname||'.'||c.relname FROM pg_class c JOIN pg_namespace rn ON rn.oid=c.relnamespace WHERE c.oid=t.typrelid)END,'base_type',CASE WHEN t.typbasetype=0 THEN NULL ELSE format_type(t.typbasetype,t.typtypmod)END,'default',t.typdefault,'acl',t.typacl::text,
  'enum',(SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid=t.oid)) ORDER BY n.nspname,t.typname),'{}'::jsonb) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname IN(p_register,p_recovery)),
 'functions',(SELECT coalesce(jsonb_object_agg(CASE WHEN reference_value AND p.proname=ANY(ARRAY['close_narcotics_register_operation_v1','create_narcotics_register_v1','download_narcotics_form_v1','list_narcotics_registers_v1','narcotics_recovery_acknowledge_evidence_v1','narcotics_recovery_admission_v1','narcotics_recovery_arm_v1','narcotics_recovery_backup_prepare_v1','narcotics_recovery_begin_epoch_v1','narcotics_recovery_close_operation_v1','narcotics_recovery_preflight_v1','narcotics_recovery_preserve_evidence_v1','narcotics_recovery_probe_boundary_v1','narcotics_recovery_probe_gate_v1','narcotics_recovery_probe_permissions_v1','narcotics_recovery_probe_state_v1','narcotics_recovery_read_evidence_v1','narcotics_recovery_read_operation_v1','narcotics_recovery_release_v1','narcotics_recovery_source_resume_v1','narcotics_recovery_start_count_v1','narcotics_recovery_status_v1','preserve_narcotics_form_v1','read_narcotics_form_operation_v1','read_narcotics_register_v1']::text[]) THEN 'public' ELSE n.nspname END||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')',jsonb_build_object(
  'name',p.proname,'schema',CASE WHEN reference_value AND p.proname=ANY(ARRAY['close_narcotics_register_operation_v1','create_narcotics_register_v1','download_narcotics_form_v1','list_narcotics_registers_v1','narcotics_recovery_acknowledge_evidence_v1','narcotics_recovery_admission_v1','narcotics_recovery_arm_v1','narcotics_recovery_backup_prepare_v1','narcotics_recovery_begin_epoch_v1','narcotics_recovery_close_operation_v1','narcotics_recovery_preflight_v1','narcotics_recovery_preserve_evidence_v1','narcotics_recovery_probe_boundary_v1','narcotics_recovery_probe_gate_v1','narcotics_recovery_probe_permissions_v1','narcotics_recovery_probe_state_v1','narcotics_recovery_read_evidence_v1','narcotics_recovery_read_operation_v1','narcotics_recovery_release_v1','narcotics_recovery_source_resume_v1','narcotics_recovery_start_count_v1','narcotics_recovery_status_v1','preserve_narcotics_form_v1','read_narcotics_form_operation_v1','read_narcotics_register_v1']::text[]) THEN 'public' ELSE n.nspname END,
  'arg_types',oidvectortypes(p.proargtypes),'arg_names',to_jsonb(p.proargnames),'all_arg_types',(SELECT jsonb_agg(format_type(t,NULL) ORDER BY ord) FROM unnest(p.proallargtypes)WITH ORDINALITY AS types(t,ord)),
  'arg_modes',to_jsonb(p.proargmodes),'return_type',format_type(p.prorettype,NULL),'setof',p.proretset,'language',l.lanname,'volatility',p.provolatile,'definer',p.prosecdef,'strict',p.proisstrict,'leakproof',p.proleakproof,'parallel',p.proparallel,
  'kind',p.prokind,'variadic',p.provariadic::integer,'support',p.prosupport::oid::integer,'sqlbody_null',p.prosqlbody IS NULL,'owner',pg_get_userbyid(p.proowner),'cost',p.procost,'rows',p.prorows,
  'defaults',pg_get_expr(p.proargdefaults,0),'configuration',to_jsonb(p.proconfig),'probin',p.probin,'argument_count',p.pronargs,'default_count',p.pronargdefaults,
  'body_sha256',encode(sha256(convert_to(replace(replace(p.prosrc,p_register,p_canonical_register),p_recovery,p_canonical_recovery),'UTF8')),'hex'),
  'acl',(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)END,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantee,a.privilege_type),'[]'::jsonb) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a)) ORDER BY n.nspname,p.proname,oidvectortypes(p.proargtypes)),'{}'::jsonb)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname IN(p_register,p_recovery) OR(NOT reference_value AND n.nspname='public' AND p.proname ~ '^(list_narcotics_|create_narcotics_|read_narcotics_|close_narcotics_|preserve_narcotics_|download_narcotics_|narcotics_recovery_)')))
 INTO result;
 RETURN replace(replace(result::text,p_register,p_canonical_register),p_recovery,p_canonical_recovery)::jsonb;
END $$;
CREATE FUNCTION narcotics_register_reference_v1.require_module() RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE saved narcotics_register_reference_v1.descriptor;actual jsonb;
BEGIN
 SELECT * INTO STRICT saved FROM narcotics_register_reference_v1.descriptor d WHERE d.revision=1;
 IF saved.definition_hash<>narcotics_register_reference_v1.hash('narcotics-operational-module-v1',saved.definition) THEN RAISE EXCEPTION 'narcotics_module_invalid' USING ERRCODE='23514';END IF;
 actual:=narcotics_register_reference_v1.module_properties('narcotics_register_reference_v1','narcotics_recovery_reference_v1','narcotics_register_reference_v1','narcotics_recovery_reference_v1');
 IF actual IS DISTINCT FROM saved.definition THEN RAISE EXCEPTION 'narcotics_module_invalid' USING ERRCODE='23514';END IF;
END $$;
CREATE FUNCTION narcotics_register_reference_v1.read_terminal_count(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public,controlled_count_v1,controlled_count_entry_v1,pg_temp
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3 AS $$
declare q jsonb;principal_value jsonb;policy_value jsonb;cycle_value jsonb;snapshot_value jsonb;statement_a jsonb;statement_b jsonb;
 outcome_value jsonb;cancellation_value jsonb;terminal_policy jsonb;boundary_value jsonb;result_value jsonb;
 product_value uuid;site_value uuid;actor_value uuid;id_value uuid;count_value uuid;
begin
 perform controlled_count_entry_v1.count_entry_budget_required();
 perform controlled_count_entry_v1.acquire_static_relation_frontier();
 -- Exactly one whole metadata check, after real held frontier and before user/current-principal/saved reads.
 perform controlled_count_entry_v1.assert_read_frontier();


 q:=controlled_count_v1.count_wire_request('read',p_request);
 actor_value:=public.controlled_stock_actor((q->>'actor_id')::uuid);perform public.next_visit_review_session();
 count_value:=(q->>'count_id')::uuid;
 -- Scope-only lookup before explicit READ. No expected/participant/statement
 -- values are loaded or projected before that authority check.
 select c.product_id,c.site_id into strict product_value,site_value from controlled_count_v1.cycles c where c.count_id=count_value;
 principal_value:=controlled_count_v1.current_principal(actor_value,product_value,site_value,'read');
 cycle_value:=controlled_count_v1.saved_result_graph('cycle',count_value);
 perform controlled_count_v1.validate_operation_graph((cycle_value->>'operation_id')::uuid);
 snapshot_value:=controlled_count_v1.saved_snapshot_document((cycle_value#>>'{body,snapshot_id}')::uuid);
 select s.statement_id into id_value from controlled_count_v1.statements s where s.count_id=count_value and s.slot='A';
 if id_value is not null then statement_a:=controlled_count_v1.saved_result_graph('statement',id_value);
  perform controlled_count_v1.validate_operation_graph((statement_a->>'operation_id')::uuid);end if;
 id_value:=null;select s.statement_id into id_value from controlled_count_v1.statements s where s.count_id=count_value and s.slot='B';
 if id_value is not null then statement_b:=controlled_count_v1.saved_result_graph('statement',id_value);
  perform controlled_count_v1.validate_operation_graph((statement_b->>'operation_id')::uuid);end if;
 id_value:=null;select o.outcome_id into id_value from controlled_count_v1.outcomes o where o.count_id=count_value;
 if id_value is not null then outcome_value:=controlled_count_v1.saved_result_graph('outcome',id_value);
  perform controlled_count_v1.validate_operation_graph((outcome_value->>'operation_id')::uuid);
  terminal_policy:=controlled_count_v1.saved_policy_document((outcome_value#>>'{policy,id}')::uuid);end if;
 id_value:=null;select c.cancellation_id into id_value from controlled_count_v1.cancellations c where c.count_id=count_value;
 if id_value is not null then cancellation_value:=controlled_count_v1.saved_result_graph('cancellation',id_value);
  perform controlled_count_v1.validate_operation_graph((cancellation_value->>'operation_id')::uuid);
  terminal_policy:=controlled_count_v1.saved_policy_document((cancellation_value#>>'{policy,id}')::uuid);end if;
 if outcome_value is not null and cancellation_value is not null then
  raise exception 'count_source_invalid'using errcode='P0001',detail='',hint='';end if;
 boundary_value:=controlled_count_v1.capture_full_boundary_read(count_value,actor_value,product_value,site_value);
 principal_value:=controlled_count_v1.current_principal(actor_value,product_value,site_value,'read');
 policy_value:=controlled_count_v1.policy_history(product_value,site_value);
 result_value:=controlled_count_v1.project_count_read(principal_value,policy_value,cycle_value,snapshot_value,
  statement_a,statement_b,outcome_value,cancellation_value,terminal_policy,boundary_value,clock_timestamp());
 return result_value;
exception when others or query_canceled or assert_failure then
 raise exception 'count_request_failed'using errcode='P0001',detail='',hint='';
end $$;
CREATE FUNCTION narcotics_recovery_reference_v1.capture_full_boundary(p_product uuid,p_site uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,controlled_count_v1,pg_temp
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3 AS $$declare source_row record;event_value uuid;row_value jsonb;rows_value jsonb;boundary_value jsonb:='{}'::jsonb;
 row_bytes bigint;class_bytes bigint;total_bytes bigint:=2;
begin
 -- Mandatory real entry identity/current source metadata/held-resource cut.
 -- No principal, source row or parent cold function is read before it.
 perform narcotics_recovery_reference_v1.capture_guard(p_product,p_site);
 perform public.controlled_stock_validate_product(p_product);
 -- Product validation does not substitute for complete per-event validation.
 -- Walk the full retained source history, with no latest/checkpoint shortcut.
 for event_value in select e.id from public.controlled_stock_events e where e.product_id=p_product order by e.sequence loop
  perform public.controlled_stock_validate_event(event_value);
 end loop;
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.actor_id, r.writer, r.session_id, r.request_hash, r.receipt, r.recorded_at FROM public.controlled_stock_actions AS r INNER JOIN public.controlled_stock_events AS e ON e.id = r.id WHERE e.product_id = p_product ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('actions',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('actions'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('actions',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.record_id, r.pet_id, r.request, r.created_by, r.created_at FROM public.anesthesia_drug_administrations AS r WHERE r.id IN (SELECT s.source_id FROM public.stock_movement_sources AS s INNER JOIN public.inventory_movements AS m ON m.id = s.movement_id INNER JOIN public.inventory_lots AS l ON l.id = m.lot_id WHERE l.product_id = p_product AND s.writer = 'record_anesthesia_drug_administration') ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('anesthesia_drug_administrations',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('anesthesia_drug_administrations'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('anesthesia_drug_administrations',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.invoice_id, r.pet_id, r.product_id, r.description, r.quantity, r.unit_price_cents, r.amount_cents, r.created_by, r.created_at FROM public.billing_invoice_items AS r WHERE r.id IN (SELECT d.invoice_item_id FROM public.native_dispenses AS d WHERE d.id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product)) ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('billing_invoice_items',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('billing_invoice_items'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('billing_invoice_items',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.container_id, r.lot_id, r.channel, r.dispense_id, r.allocation_id, r.intake_id, r.opening_id, r.created_event_id, r.opening_quantity FROM public.controlled_stock_cells AS r INNER JOIN public.controlled_stock_containers AS c ON c.id = r.container_id WHERE c.product_id = p_product ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('cells',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('cells'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('cells',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.product_id, r.stock_unit, r.label, r.kind, r.stock_lot_id, r.controlling_site_id, r.initial_location_id, r.initial_custodian_id, r.opening_id, r.created_event_id, r.actor_id, r.session_id, r.recorded_at FROM public.controlled_stock_containers AS r WHERE r.product_id = p_product ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('containers',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('containers'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('containers',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.event_id, r.actor_id FROM public.stock_correction_sources AS r WHERE r.event_id IN (SELECT e.id FROM public.native_dispense_correction_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product)) ORDER BY r.event_id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('correction_provenance',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('correction_provenance'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('correction_provenance',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.event_id, r.writer, r.actor_id FROM public.stock_custody_sources AS r WHERE r.event_id IN (SELECT e.id FROM public.native_return_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product)) ORDER BY r.event_id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('custody_provenance',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('custody_provenance'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('custody_provenance',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.event_id, r.actor_id FROM public.stock_discrepancy_sources AS r WHERE r.event_id IN (SELECT e.id FROM public.native_return_discrepancy_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product)) ORDER BY r.event_id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('discrepancy_provenance',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('discrepancy_provenance'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('discrepancy_provenance',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.product_id, r.state, r.head_id, r.created_by, r.created_at FROM public.controlled_draft_entries AS r WHERE r.product_id = p_product ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('draft_entries',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('draft_entries'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('draft_entries',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.entry_id, r.version, r.definition, r.product_snapshot, r.action_id, r.actor_id, r.session_id, r.actor_name, r.created_at FROM public.controlled_draft_versions AS r WHERE r.entry_id IN (SELECT e.id FROM public.controlled_draft_entries AS e WHERE e.product_id = p_product) ORDER BY r.entry_id, r.version, r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('draft_versions',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('draft_versions'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('draft_versions',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.product_id, r.sequence, r.prior_event_id, r.policy_version_id, r.opening_id, r.engine_revision, r.writer, r.event_kind, r.actor_id, r.session_id, r.actor_name, r.basis, r.observed_at, r.recorded_at, r.note, r.context_hash, r.canonical_result, r.source_bundle, r.source_effects, r.clinical_snapshot, r.secondary_review_required, r.prior_record_hash, r.record_hash FROM public.controlled_stock_events AS r WHERE r.product_id = p_product ORDER BY r.sequence, r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('events',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('events'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('events',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.container_id, r.version, r.location_id, r.custodian_id, r.status, r.last_event_id FROM public.controlled_stock_container_heads AS r INNER JOIN public.controlled_stock_containers AS c ON c.id = r.container_id WHERE c.product_id = p_product ORDER BY r.container_id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('heads',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('heads'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('heads',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.event_id, r.cell_id, r.source_link_id, r.quantity_delta, r.container_version_before, r.container_version_after FROM public.controlled_stock_event_lines AS r INNER JOIN public.controlled_stock_events AS e ON e.id = r.event_id WHERE e.product_id = p_product ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('lines',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('lines'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('lines',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.site_id, r.kind, r.label, r.initial_custodian_id, r.actor_id, r.session_id, r.recorded_at FROM public.controlled_stock_locations AS r WHERE r.site_id = p_site OR r.id IN (((SELECT c.initial_location_id AS id FROM public.controlled_stock_containers AS c WHERE c.product_id = p_product UNION SELECT h.location_id FROM public.controlled_stock_container_heads AS h INNER JOIN public.controlled_stock_containers AS c ON c.id = h.container_id WHERE c.product_id = p_product) UNION SELECT t.before_location_id FROM public.controlled_stock_container_transitions AS t INNER JOIN public.controlled_stock_containers AS c ON c.id = t.container_id WHERE c.product_id = p_product) UNION SELECT t.after_location_id FROM public.controlled_stock_container_transitions AS t INNER JOIN public.controlled_stock_containers AS c ON c.id = t.container_id WHERE c.product_id = p_product) ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('locations',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('locations'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('locations',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.product_id, r.lot_number, r.expires_on, r.location, r.created_by, r.created_at FROM public.inventory_lots AS r WHERE r.product_id = p_product ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('lots',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('lots'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('lots',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.movement_id, r.writer, r.source_id, r.actor_id FROM public.stock_movement_sources AS r INNER JOIN public.inventory_movements AS m ON m.id = r.movement_id INNER JOIN public.inventory_lots AS l ON l.id = m.lot_id WHERE l.product_id = p_product ORDER BY r.movement_id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('movement_provenance',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('movement_provenance'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('movement_provenance',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.lot_id, r.quantity, r.kind, r.reason, r.created_by, r.created_at FROM public.inventory_movements AS r INNER JOIN public.inventory_lots AS l ON l.id = r.lot_id WHERE l.product_id = p_product ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('movements',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('movements'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('movements',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.dispense_id, r.lot_id, r.movement_id, r.quantity FROM public.native_dispense_allocations AS r WHERE r.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product) ORDER BY r.dispense_id, r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('native_allocations',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('native_allocations'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('native_allocations',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.event_id, r.target_event_id, r.allocation_id, r.lot_id, r.original_movement_id, r.movement_id, r.quantity FROM public.native_return_compensation_links AS r WHERE r.event_id IN (SELECT e.id FROM public.native_return_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product)) OR r.target_event_id IN (SELECT e.id FROM public.native_return_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product)) OR r.lot_id IN (SELECT l.id FROM public.inventory_lots AS l WHERE l.product_id = p_product) ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('native_compensation_links',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('native_compensation_links'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('native_compensation_links',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.authorization_id, r.pet_id, r.dispense_id, r.sequence, r.prior_event_id, r.actor_id, r.kind, r.created_at, r.record_hash, r.reviewed_context, r.document FROM public.native_dispense_correction_events AS r WHERE r.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product) ORDER BY r.dispense_id, r.sequence, r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('native_correction_events',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('native_correction_events'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('native_correction_events',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.actor_id, r.request, r.request_hash, r.result, r.created_at FROM public.native_dispense_correction_operations AS r WHERE r.id IN (SELECT e.id FROM public.native_dispense_correction_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product)) ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('native_correction_operations',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('native_correction_operations'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('native_correction_operations',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.authorization_id, r.pet_id, r.dispense_id, r.sequence, r.prior_event_id, r.actor_id, r.case_id, r.action, r.created_at, r.record_hash, r.reviewed_context, r.document FROM public.native_return_discrepancy_events AS r WHERE r.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product) ORDER BY r.dispense_id, r.sequence, r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('native_discrepancy_events',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('native_discrepancy_events'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('native_discrepancy_events',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.case_id, r.correction_id, r.resolution_id FROM public.native_return_discrepancy_correction_links AS r WHERE r.case_id IN (SELECT e.id FROM public.native_return_discrepancy_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product)) OR r.resolution_id IN (SELECT e.id FROM public.native_return_discrepancy_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product)) OR r.correction_id IN (SELECT e.id FROM public.native_return_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product)) ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('native_discrepancy_links',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('native_discrepancy_links'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('native_discrepancy_links',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.actor_id, r.request, r.request_hash, r.result, r.created_at FROM public.native_return_discrepancy_operations AS r WHERE r.id IN (SELECT e.id FROM public.native_return_discrepancy_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product)) ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('native_discrepancy_operations',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('native_discrepancy_operations'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('native_discrepancy_operations',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.authorization_id, r.pet_id, r.slot_id, r.invoice_id, r.invoice_item_id, r.quantity, r.actor_id, r.dispensed_at, r.document FROM public.native_dispenses AS r WHERE r.id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product) ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('native_dispenses',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('native_dispenses'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('native_dispenses',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.actor_id, r.operation, r.request, r.request_hash, r.result, r.created_at FROM public.native_fulfillment_operations AS r WHERE r.id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product) OR r.id IN (SELECT e.id FROM public.native_pickups AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product)) ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('native_fulfillment_operations',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('native_fulfillment_operations'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('native_fulfillment_operations',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.authorization_id, r.pet_id, r.dispense_id, r.actor_id, r.picked_up_at, r.document FROM public.native_pickups AS r WHERE r.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product) ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('native_pickups',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('native_pickups'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('native_pickups',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.pet_id, r.client_id, r.draft_id, r.document FROM public.native_prescription_authorizations AS r WHERE r.id IN (SELECT d.authorization_id FROM public.native_dispenses AS d WHERE d.id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product)) ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('native_prescription_authorizations',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('native_prescription_authorizations'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('native_prescription_authorizations',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.refill_id, r.revision, r.action, r.actor_id, r.reason, r.prior_event_id, r.before_snapshot, r.after_snapshot, r.link_context, r.created_at, r.fulfillment_reference FROM public.native_refill_events AS r WHERE r.refill_id IN (SELECT CAST(docs.document ->> 'refill_id' AS uuid) FROM (SELECT d.document FROM public.native_dispenses AS d WHERE d.id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product) UNION ALL SELECT p.document FROM public.native_pickups AS p WHERE p.id IN (SELECT p.id FROM public.native_pickups AS p WHERE p.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product))) AS docs WHERE (docs.document -> 'refill_id') IS DISTINCT FROM CAST('null' AS jsonb) UNION SELECT e.refill_id FROM public.native_refill_events AS e WHERE e.id IN (SELECT CAST(docs.document ->> 'refill_event_id' AS uuid) FROM (SELECT d.document FROM public.native_dispenses AS d WHERE d.id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product) UNION ALL SELECT p.document FROM public.native_pickups AS p WHERE p.id IN (SELECT p.id FROM public.native_pickups AS p WHERE p.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product))) AS docs WHERE (docs.document -> 'refill_event_id') IS DISTINCT FROM CAST('null' AS jsonb))) ORDER BY r.refill_id, r.revision, r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('native_refill_events',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('native_refill_events'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('native_refill_events',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.authorization_id, r.pet_id, r.dispense_id, r.sequence, r.prior_event_id, r.actor_id, r.action, r.intake_id, r.created_at, r.record_hash, r.reviewed_context, r.document FROM public.native_return_events AS r WHERE r.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product) ORDER BY r.dispense_id, r.sequence, r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('native_return_events',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('native_return_events'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('native_return_events',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.actor_id, r.request, r.request_hash, r.result, r.created_at FROM public.native_return_operations AS r WHERE r.id IN (SELECT e.id FROM public.native_return_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product)) ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('native_return_operations',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('native_return_operations'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('native_return_operations',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.version, r.actor_id, r.request, r.request_hash, r.document, r.created_at FROM public.native_return_policy_decisions AS r WHERE TRUE ORDER BY r.version, r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('native_return_policy_decisions',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('native_return_policy_decisions'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('native_return_policy_decisions',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.version, r.decision_id FROM public.native_return_policy_state AS r WHERE TRUE ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('native_return_policy_state',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('native_return_policy_state'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('native_return_policy_state',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.event_id, r.allocation_id, r.lot_id, r.movement_id, r.quantity FROM public.native_return_stock_links AS r WHERE r.event_id IN (SELECT e.id FROM public.native_return_events AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product)) OR r.lot_id IN (SELECT l.id FROM public.inventory_lots AS l WHERE l.product_id = p_product) ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('native_return_stock_links',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('native_return_stock_links'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('native_return_stock_links',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.product_id, r.policy_version_id, r.observed_at, r.count_evidence, r.native_custody_boundary, r.actor_id, r.session_id, r.recorded_at FROM public.controlled_stock_openings AS r WHERE r.product_id = p_product ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('opening',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('opening'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('opening',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.opening_id, r.movement_id, r.lot_id, r.quantity, r.source_snapshot FROM public.controlled_stock_opening_movements AS r INNER JOIN public.controlled_stock_openings AS o ON o.id = r.opening_id WHERE o.product_id = p_product ORDER BY r.opening_id, r.movement_id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('opening_movements',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('opening_movements'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('opening_movements',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.pet_id, r.product_id, r.lot_id, r.invoice_id, r.kind, r.historical, r.product_name, r.manufacturer, r.lot_number, r.expires_on, r.quantity, r.dose, r.route, r.site, r.veterinarian, r.veterinarian_license, r.administered_at, r.next_due_on, r.source, r.request, r.created_by, r.created_at FROM public.patient_treatments AS r WHERE r.id IN (SELECT s.source_id FROM public.stock_movement_sources AS s INNER JOIN public.inventory_movements AS m ON m.id = s.movement_id INNER JOIN public.inventory_lots AS l ON l.id = m.lot_id WHERE l.product_id = p_product AND s.writer IN ('record_patient_treatment', 'record_anesthesia_drug_administration')) ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('patient_treatments',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('patient_treatments'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('patient_treatments',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.event_id, r.actor_id FROM public.stock_pickup_sources AS r WHERE r.event_id IN (SELECT e.id FROM public.native_pickups AS e WHERE e.dispense_id IN (SELECT d.id FROM public.native_dispenses AS d WHERE d.id IN (SELECT DISTINCT a.dispense_id FROM public.native_dispense_allocations AS a INNER JOIN public.inventory_lots AS l ON l.id = a.lot_id WHERE l.product_id = p_product) OR CAST(d.document #>> '{reviewed_context,product,id}' AS uuid) = p_product)) ORDER BY r.event_id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('pickup_provenance',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('pickup_provenance'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('pickup_provenance',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.cell_id, r.quantity FROM public.controlled_stock_positions AS r INNER JOIN public.controlled_stock_cells AS cell ON cell.id = r.cell_id INNER JOIN public.controlled_stock_containers AS c ON c.id = cell.container_id WHERE c.product_id = p_product ORDER BY r.cell_id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('positions',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('positions'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('positions',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.writer, r.actor_id, r.session_id, r.product_id, r.policy_version_id, r.state_head_id, r.opening_id, r.canonical_arguments, r.context, r.frozen, r.request_hash, r.created_at, r.expires_at FROM public.controlled_stock_preparations AS r INNER JOIN public.controlled_stock_events AS e ON e.id = r.id WHERE e.product_id = p_product ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('preparations',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('preparations'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('preparations',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.name, r.kind, r.manufacturer, r.unit, r.unit_price_cents, r.active, r.version, r.created_by, r.created_at FROM public.catalog_products AS r WHERE r.id = p_product ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('product',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('product'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('product',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.label, r.registration_evidence, r.actor_id, r.session_id, r.recorded_at FROM public.controlled_stock_sites AS r WHERE r.id = p_site OR EXISTS (SELECT 1 FROM public.controlled_stock_policy_sites AS ps INNER JOIN public.controlled_stock_policy_versions AS pv ON pv.id = ps.policy_version_id WHERE pv.product_id = p_product AND ps.site_id = r.id) OR EXISTS (SELECT 1 FROM public.controlled_stock_containers AS c WHERE c.product_id = p_product AND c.controlling_site_id = r.id) OR EXISTS (SELECT 1 FROM public.controlled_stock_locations AS l WHERE l.site_id = r.id AND l.id IN (((SELECT c.initial_location_id AS id FROM public.controlled_stock_containers AS c WHERE c.product_id = p_product UNION SELECT h.location_id FROM public.controlled_stock_container_heads AS h INNER JOIN public.controlled_stock_containers AS c ON c.id = h.container_id WHERE c.product_id = p_product) UNION SELECT t.before_location_id FROM public.controlled_stock_container_transitions AS t INNER JOIN public.controlled_stock_containers AS c ON c.id = t.container_id WHERE c.product_id = p_product) UNION SELECT t.after_location_id FROM public.controlled_stock_container_transitions AS t INNER JOIN public.controlled_stock_containers AS c ON c.id = t.container_id WHERE c.product_id = p_product)) ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('sites',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('sites'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('sites',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.event_id, r.movement_id, r.return_event_id, r.discrepancy_event_id, r.pickup_id, r.correction_event_id FROM public.controlled_stock_source_links AS r INNER JOIN public.controlled_stock_events AS e ON e.id = r.event_id WHERE e.product_id = p_product ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('source_links',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('source_links'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('source_links',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.product_id, r.head_id, r.event_version, r.last_event_id FROM public.controlled_stock_states AS r WHERE r.product_id = p_product ORDER BY r.product_id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('state',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('state'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('state',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.product_id, r.version, r.prior_event_id, r.state, r.policy_version_id, r.opening_id, r.actor_id, r.session_id, r.reason, r.recorded_at FROM public.controlled_stock_state_events AS r WHERE r.product_id = p_product ORDER BY r.version, r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('state_events',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('state_events'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('state_events',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.actor_id, r.writer, r.session_id, r.recorded_at FROM public.controlled_stock_cancellations AS r WHERE r.id IN (SELECT e.id FROM public.controlled_stock_events AS e WHERE e.product_id = p_product) ORDER BY r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('stock_cancellations',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('stock_cancellations'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('stock_cancellations',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.product_id, r.version, r.draft_version_id, r.engine_revision, r.stock_unit, r.identity_snapshot, r.permissions, r.clinic_retained_return_permitted, r.review_reference, r.actor_id, r.session_id, r.recorded_at FROM public.controlled_stock_policy_versions AS r WHERE r.product_id = p_product ORDER BY r.version, r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('stock_policies',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('stock_policies'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('stock_policies',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.policy_version_id, r.site_id FROM public.controlled_stock_policy_sites AS r INNER JOIN public.controlled_stock_policy_versions AS p ON p.id = r.policy_version_id WHERE p.product_id = p_product ORDER BY r.policy_version_id, r.site_id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('stock_policy_sites',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('stock_policy_sites'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('stock_policy_sites',rows_value);
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in SELECT r.id, r.event_id, r.container_id, r.version_before, r.version_after, r.before_location_id, r.before_custodian_id, r.before_status, r.after_location_id, r.after_custodian_id, r.after_status FROM public.controlled_stock_container_transitions AS r INNER JOIN public.controlled_stock_containers AS c ON c.id = r.container_id WHERE c.product_id = p_product ORDER BY r.container_id, r.version_after, r.id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>16777216 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+2>16777216 then
   raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_v1.historical_retained_row_shape_values('transitions',row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 total_bytes:=total_bytes+octet_length(to_jsonb('transitions'::text)::text)+4+class_bytes;
 if total_bytes>16777216 then raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 boundary_value:=boundary_value||jsonb_build_object('transitions',rows_value);
 -- NEW explicit event-owned witness class. Nonphysical pending/abandoned
 -- witness work is absent from physical/source freshness by construction.
 rows_value:='[]'::jsonb;class_bytes:=2;
 for source_row in select w.*from controlled_stock_workflow_v1.witness_operations w
 join public.controlled_stock_events e on e.id=w.parent_action_id
 where e.product_id=p_product and w.stage='saved'order by w.parent_action_id,w.operation_id loop
  row_value:=to_jsonb(source_row);row_bytes:=octet_length(row_value::text);
  if row_bytes>4194304 or class_bytes+row_bytes+2>16777216 or total_bytes+class_bytes+row_bytes+64>16777216 then
   raise exception 'count_boundary_capacity'using errcode='P0001',detail='',hint='';end if;
  perform controlled_stock_workflow_v1.witness_row_required(row_value);
  class_bytes:=class_bytes+row_bytes+2;rows_value:=rows_value||jsonb_build_array(row_value);
 end loop;
 boundary_value:=boundary_value||jsonb_build_object('witness_operations',rows_value);
 if octet_length(boundary_value::text)>16777216 then
  raise exception 'count_boundary_capacity' using errcode='P0001',detail='',hint='';end if;
 -- The complete retained history/children/membership validator is mandatory;
 -- it is not supplied by the shape component or replaced with an empty body.
 perform controlled_count_v1.historical_boundary_values(boundary_value);
 -- Recheck exact held identity/module/source metadata after all source work.
 perform narcotics_recovery_reference_v1.capture_guard(p_product,p_site);
 return boundary_value;
end$$;
CREATE FUNCTION narcotics_recovery_reference_v1.capture_guard(p_product uuid,p_site uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();
 IF NOT EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=pg_backend_pid()AND l.locktype='advisory'
  AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database())AND l.classid=90271190::oid AND l.objid=0::oid AND l.objsubid=2 AND l.mode IN ('ShareLock','ExclusiveLock')AND l.granted)
 OR NOT EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=pg_backend_pid()AND l.locktype='advisory'
  AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database())AND l.classid=90271040::oid AND l.objid=0::oid AND l.objsubid=2 AND l.mode='ExclusiveLock'AND l.granted)
 OR public.controlled_stock_lock_held('controlled-stock-product:',p_product)IS NOT TRUE THEN
 RAISE EXCEPTION 'narcotics_recovery_frontier_invalid' USING ERRCODE='42501';END IF;
 PERFORM narcotics_recovery_reference_v1.require_head();
 PERFORM narcotics_register_reference_v1.authority(auth.uid(),p_product,p_site);
END $$;
CREATE FUNCTION narcotics_register_reference_v1.list_narcotics_registers_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_reference_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_reference_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_reference_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_reference_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_reference_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_reference_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_reference_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_register_reference_v1.enter_register();

 RETURN narcotics_register_reference_v1.list_reports(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;
CREATE FUNCTION narcotics_register_reference_v1.create_narcotics_register_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_reference_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_reference_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_reference_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_reference_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_reference_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_reference_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_reference_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_register_reference_v1.enter_register();

 RETURN narcotics_register_reference_v1.create_report(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;
CREATE FUNCTION narcotics_register_reference_v1.read_narcotics_register_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_reference_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_reference_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_reference_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_reference_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_reference_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_reference_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_reference_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_register_reference_v1.enter_register();

 RETURN narcotics_register_reference_v1.read_operation(p_request,'report');
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;
CREATE FUNCTION narcotics_register_reference_v1.close_narcotics_register_operation_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_reference_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_reference_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_reference_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_reference_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_reference_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_reference_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_reference_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_register_reference_v1.enter_register();

 RETURN narcotics_register_reference_v1.close_operation(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;
CREATE FUNCTION narcotics_register_reference_v1.preserve_narcotics_form_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_reference_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_reference_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_reference_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_reference_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_reference_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_reference_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_reference_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_register_reference_v1.enter_register();

 RETURN narcotics_register_reference_v1.preserve_form(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;
CREATE FUNCTION narcotics_register_reference_v1.read_narcotics_form_operation_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_reference_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_reference_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_reference_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_reference_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_reference_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_reference_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_reference_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_register_reference_v1.enter_register();

 RETURN narcotics_register_reference_v1.read_operation(p_request,'form');
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;
CREATE FUNCTION narcotics_register_reference_v1.download_narcotics_form_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_reference_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_reference_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_reference_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_reference_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_reference_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_reference_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_reference_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_register_reference_v1.enter_register();

 RETURN narcotics_register_reference_v1.download_form(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;
CREATE FUNCTION narcotics_register_reference_v1.narcotics_recovery_preflight_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_reference_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_reference_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_reference_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_reference_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_reference_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_reference_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_reference_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_recovery_reference_v1.enter_recovery();

 RETURN narcotics_recovery_reference_v1.preflight(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;
CREATE FUNCTION narcotics_register_reference_v1.narcotics_recovery_arm_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_reference_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_reference_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_reference_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_reference_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_reference_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_reference_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_reference_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_recovery_reference_v1.enter_recovery();

 RETURN narcotics_recovery_reference_v1.arm(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;
CREATE FUNCTION narcotics_register_reference_v1.narcotics_recovery_backup_prepare_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_reference_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_reference_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_reference_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_reference_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_reference_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_reference_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_reference_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_recovery_reference_v1.enter_recovery();

 RETURN narcotics_recovery_reference_v1.backup_prepare(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;
CREATE FUNCTION narcotics_register_reference_v1.narcotics_recovery_source_resume_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_reference_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_reference_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_reference_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_reference_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_reference_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_reference_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_reference_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_recovery_reference_v1.enter_recovery();

 RETURN narcotics_recovery_reference_v1.source_resume(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;
CREATE FUNCTION narcotics_register_reference_v1.narcotics_recovery_begin_epoch_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_reference_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_reference_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_reference_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_reference_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_reference_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_reference_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_reference_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_recovery_reference_v1.enter_recovery();

 RETURN narcotics_recovery_reference_v1.begin_epoch(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;
CREATE FUNCTION narcotics_register_reference_v1.narcotics_recovery_start_count_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_reference_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_reference_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_reference_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_reference_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_reference_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_reference_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_reference_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_recovery_reference_v1.enter_recovery();

 RETURN narcotics_recovery_reference_v1.start_count(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;
CREATE FUNCTION narcotics_register_reference_v1.narcotics_recovery_preserve_evidence_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_reference_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_reference_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_reference_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_reference_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_reference_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_reference_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_reference_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_recovery_reference_v1.enter_recovery();

 RETURN narcotics_recovery_reference_v1.preserve_evidence(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;
CREATE FUNCTION narcotics_register_reference_v1.narcotics_recovery_acknowledge_evidence_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_reference_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_reference_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_reference_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_reference_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_reference_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_reference_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_reference_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_recovery_reference_v1.enter_recovery();

 RETURN narcotics_recovery_reference_v1.acknowledge_evidence(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;
CREATE FUNCTION narcotics_register_reference_v1.narcotics_recovery_read_evidence_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_reference_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_reference_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_reference_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_reference_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_reference_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_reference_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_reference_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_recovery_reference_v1.enter_recovery();

 RETURN narcotics_recovery_reference_v1.read_evidence(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;
CREATE FUNCTION narcotics_register_reference_v1.narcotics_recovery_release_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_reference_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_reference_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_reference_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_reference_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_reference_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_reference_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_reference_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_recovery_reference_v1.enter_recovery();

 RETURN narcotics_recovery_reference_v1.release(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;
CREATE FUNCTION narcotics_register_reference_v1.narcotics_recovery_read_operation_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_reference_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_reference_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_reference_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_reference_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_reference_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_reference_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_reference_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_recovery_reference_v1.enter_recovery();

 RETURN narcotics_recovery_reference_v1.operation_pointer(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;
CREATE FUNCTION narcotics_register_reference_v1.narcotics_recovery_close_operation_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_reference_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_reference_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_reference_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_reference_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_reference_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_reference_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_reference_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_recovery_reference_v1.enter_recovery();

 RETURN narcotics_recovery_reference_v1.close_operation(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;
CREATE FUNCTION narcotics_register_reference_v1.narcotics_recovery_status_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN

 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_reference_v1','narcotics_recovery_reference_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
('narcotics_register_reference_v1.enter_register()','70797a2033dfb3e29533830155b39f471c35d5485d6f9f4129451b16883b65b6','plpgsql','v','void'),
('narcotics_register_reference_v1.require_module()','f0b93e391f53be02c33043017cbabc2ecf27e5325f6738c859e8424cd201bf99','plpgsql','v','void'),
('narcotics_register_reference_v1.module_properties(text,text,text,text)','b7c781305dc765ac4928fd63d8f3d97f9a821b11c4990685f327168e71b42807','plpgsql','s','jsonb'),
('narcotics_register_reference_v1.hash(text,jsonb)','eba07311c3c4dd1cbf91815461f1bc23ed4248cbc7339e27948d66752fe47897','sql','i','text'),
('narcotics_recovery_reference_v1.enter_recovery()','2e64ae001896b3af8cc8f1a6e6bdc5b22232a713a684c2c838a47e7c2c16cf1e','plpgsql','v','void'),
('narcotics_recovery_reference_v1.require_head()','c0c0b7cdda74d17dd58e8ae6090f2f03aec789a83c38b4358b2ac826d44b6610','plpgsql','v','jsonb')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_reference_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_recovery_reference_v1.enter_recovery();

 RETURN narcotics_recovery_reference_v1.status(p_request);
EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';
END $$;
CREATE FUNCTION narcotics_register_reference_v1.narcotics_recovery_admission_v1() RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN
 IF session_user<>'authenticator'OR current_setting('role')NOT IN ('anon','authenticated','service_role')THEN
 RAISE EXCEPTION 'narcotics_access_denied' USING ERRCODE='42501',DETAIL='',HINT='';END IF;

 IF EXISTS(WITH expected(signature,body_hash,result_type)AS(VALUES
('controlled_count_entry_v1.admit_recovery_request()','aa1682cb790a2e62ae4121522e694b4bb966538ae2fbee881dec3d2f6267aa98','void'))SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef
 OR p.prokind<>'f'OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u'OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargs<>0 OR p.proargnames IS NOT NULL OR p.proallargtypes IS NOT NULL OR p.proargmodes IS NOT NULL
 OR p.pronargdefaults<>0 OR p.proargdefaults IS NOT NULL OR p.prosqlbody IS NOT NULL OR p.probin IS NOT NULL
 OR p.procost<>100 OR p.prorows<>0 OR l.lanname<>'plpgsql'OR p.provolatile<>'v'
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(VALUES('anon'),('authenticated'),('service_role'))recovery_sealed_role(role_name)WHERE has_function_privilege(recovery_sealed_role.role_name,p.oid,'EXECUTE')))THEN
 RAISE EXCEPTION 'narcotics_recovery_source_invalid' USING ERRCODE='42501',DETAIL='',HINT='';END IF;

 PERFORM controlled_count_entry_v1.admit_recovery_request();
END $$;
ALTER TABLE narcotics_register_reference_v1.descriptor OWNER TO postgres;
ALTER TABLE narcotics_register_reference_v1.descriptor ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE narcotics_register_reference_v1.descriptor FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER history_immutable BEFORE UPDATE OR DELETE ON narcotics_register_reference_v1.descriptor FOR EACH ROW EXECUTE FUNCTION narcotics_register_reference_v1.reject_history_change();
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON narcotics_register_reference_v1.descriptor FOR EACH STATEMENT EXECUTE FUNCTION narcotics_register_reference_v1.reject_history_change();
ALTER TABLE narcotics_register_reference_v1.operations OWNER TO postgres;
ALTER TABLE narcotics_register_reference_v1.operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE narcotics_register_reference_v1.operations FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER history_immutable BEFORE UPDATE OR DELETE ON narcotics_register_reference_v1.operations FOR EACH ROW EXECUTE FUNCTION narcotics_register_reference_v1.reject_history_change();
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON narcotics_register_reference_v1.operations FOR EACH STATEMENT EXECUTE FUNCTION narcotics_register_reference_v1.reject_history_change();
ALTER TABLE narcotics_register_reference_v1.reports OWNER TO postgres;
ALTER TABLE narcotics_register_reference_v1.reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE narcotics_register_reference_v1.reports FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER history_immutable BEFORE UPDATE OR DELETE ON narcotics_register_reference_v1.reports FOR EACH ROW EXECUTE FUNCTION narcotics_register_reference_v1.reject_history_change();
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON narcotics_register_reference_v1.reports FOR EACH STATEMENT EXECUTE FUNCTION narcotics_register_reference_v1.reject_history_change();
ALTER TABLE narcotics_register_reference_v1.form_contents OWNER TO postgres;
ALTER TABLE narcotics_register_reference_v1.form_contents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE narcotics_register_reference_v1.form_contents FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER history_immutable BEFORE UPDATE OR DELETE ON narcotics_register_reference_v1.form_contents FOR EACH ROW EXECUTE FUNCTION narcotics_register_reference_v1.reject_history_change();
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON narcotics_register_reference_v1.form_contents FOR EACH STATEMENT EXECUTE FUNCTION narcotics_register_reference_v1.reject_history_change();
ALTER TABLE narcotics_register_reference_v1.form_records OWNER TO postgres;
ALTER TABLE narcotics_register_reference_v1.form_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE narcotics_register_reference_v1.form_records FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER history_immutable BEFORE UPDATE OR DELETE ON narcotics_register_reference_v1.form_records FOR EACH ROW EXECUTE FUNCTION narcotics_register_reference_v1.reject_history_change();
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON narcotics_register_reference_v1.form_records FOR EACH STATEMENT EXECUTE FUNCTION narcotics_register_reference_v1.reject_history_change();
ALTER TABLE narcotics_recovery_reference_v1.backup_markers OWNER TO postgres;
ALTER TABLE narcotics_recovery_reference_v1.backup_markers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE narcotics_recovery_reference_v1.backup_markers FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER history_immutable BEFORE UPDATE OR DELETE ON narcotics_recovery_reference_v1.backup_markers FOR EACH ROW EXECUTE FUNCTION narcotics_register_reference_v1.reject_history_change();
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON narcotics_recovery_reference_v1.backup_markers FOR EACH STATEMENT EXECUTE FUNCTION narcotics_register_reference_v1.reject_history_change();
ALTER TABLE narcotics_recovery_reference_v1.count_markers OWNER TO postgres;
ALTER TABLE narcotics_recovery_reference_v1.count_markers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE narcotics_recovery_reference_v1.count_markers FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER history_immutable BEFORE UPDATE OR DELETE ON narcotics_recovery_reference_v1.count_markers FOR EACH ROW EXECUTE FUNCTION narcotics_register_reference_v1.reject_history_change();
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON narcotics_recovery_reference_v1.count_markers FOR EACH STATEMENT EXECUTE FUNCTION narcotics_register_reference_v1.reject_history_change();
ALTER TABLE narcotics_recovery_reference_v1.acknowledgments OWNER TO postgres;
ALTER TABLE narcotics_recovery_reference_v1.acknowledgments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE narcotics_recovery_reference_v1.acknowledgments FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER history_immutable BEFORE UPDATE OR DELETE ON narcotics_recovery_reference_v1.acknowledgments FOR EACH ROW EXECUTE FUNCTION narcotics_register_reference_v1.reject_history_change();
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON narcotics_recovery_reference_v1.acknowledgments FOR EACH STATEMENT EXECUTE FUNCTION narcotics_register_reference_v1.reject_history_change();
ALTER FUNCTION narcotics_register_reference_v1.reject_history_change() OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.reject_history_change() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.keys(jsonb,text[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.keys(jsonb,text[]) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.uuid_value(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.uuid_value(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.instant_value(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.instant_value(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.utc(timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.utc(timestamptz) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.hash(text,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.hash(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.text_value(jsonb,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.text_value(jsonb,integer) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.identity(uuid,boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.identity(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.authority(uuid,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.authority(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.enter_register() OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.enter_register() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.operation_lock(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.operation_lock(uuid) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.csv_cell(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.csv_cell(text) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.quantity_at(uuid,timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.quantity_at(uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.csv_row(text[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.csv_row(text[]) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.csv(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.csv(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.event_authority(uuid,uuid,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.event_authority(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.make_dataset(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.make_dataset(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.custody_at(uuid,timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.custody_at(uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.list_reports(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.list_reports(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.result_of(uuid,uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.result_of(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.read_operation(jsonb,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.read_operation(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.close_operation(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.close_operation(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.create_report(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.create_report(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.form_bytes(text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.form_bytes(text,text) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.preserve_form(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.preserve_form(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.download_form(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.download_form(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.catalog_projection() OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.catalog_projection() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.projection_of(jsonb,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.projection_of(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.require_head() OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.require_head() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.require_exclusive_admission() OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.require_exclusive_admission() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.enter_recovery() OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.enter_recovery() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.append_head(text,uuid,uuid,jsonb,uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.append_head(text,uuid,uuid,jsonb,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.latest_epoch(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.latest_epoch(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.post_frontier_session_required(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.post_frontier_session_required(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.operation_action(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.operation_action(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.saved_operation(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.saved_operation(uuid) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.operation_request(jsonb,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.operation_request(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.save_operation(jsonb,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.save_operation(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.operation_pointer(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.operation_pointer(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.close_operation(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.close_operation(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.capture_inventory(uuid,boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.capture_inventory(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.server_identity() OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.server_identity() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.backup_record(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.backup_record(uuid) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.begin_epoch(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.begin_epoch(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.require_epoch() OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.require_epoch() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.start_count(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.start_count(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.arm_record(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.arm_record(uuid) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.preflight(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.preflight(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.arm(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.arm(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.backup_prepare(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.backup_prepare(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.source_resume(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.source_resume(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.fresh_identity(uuid,boolean,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.fresh_identity(uuid,boolean,jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.evidence_record(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.evidence_record(uuid) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.read_evidence(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.read_evidence(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.acknowledge_evidence(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.acknowledge_evidence(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.acknowledgment_record(uuid,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.acknowledgment_record(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.preserve_evidence(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.preserve_evidence(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.release(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.release(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.agreement_required(jsonb,jsonb,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.agreement_required(jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.status(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.status(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.module_properties(text,text,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.module_properties(text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.require_module() OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.require_module() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.read_terminal_count(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.read_terminal_count(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.capture_full_boundary(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.capture_full_boundary(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_recovery_reference_v1.capture_guard(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_recovery_reference_v1.capture_guard(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.list_narcotics_registers_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.list_narcotics_registers_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.create_narcotics_register_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.create_narcotics_register_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.read_narcotics_register_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.read_narcotics_register_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.close_narcotics_register_operation_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.close_narcotics_register_operation_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.preserve_narcotics_form_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.preserve_narcotics_form_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.read_narcotics_form_operation_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.read_narcotics_form_operation_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.download_narcotics_form_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.download_narcotics_form_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.narcotics_recovery_preflight_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.narcotics_recovery_preflight_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.narcotics_recovery_arm_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.narcotics_recovery_arm_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.narcotics_recovery_backup_prepare_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.narcotics_recovery_backup_prepare_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.narcotics_recovery_source_resume_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.narcotics_recovery_source_resume_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.narcotics_recovery_begin_epoch_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.narcotics_recovery_begin_epoch_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.narcotics_recovery_start_count_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.narcotics_recovery_start_count_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.narcotics_recovery_preserve_evidence_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.narcotics_recovery_preserve_evidence_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.narcotics_recovery_acknowledge_evidence_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.narcotics_recovery_acknowledge_evidence_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.narcotics_recovery_read_evidence_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.narcotics_recovery_read_evidence_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.narcotics_recovery_release_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.narcotics_recovery_release_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.narcotics_recovery_read_operation_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.narcotics_recovery_read_operation_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.narcotics_recovery_close_operation_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.narcotics_recovery_close_operation_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.narcotics_recovery_status_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.narcotics_recovery_status_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION narcotics_register_reference_v1.narcotics_recovery_admission_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION narcotics_register_reference_v1.narcotics_recovery_admission_v1() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION narcotics_register_reference_v1.list_narcotics_registers_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION narcotics_register_reference_v1.create_narcotics_register_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION narcotics_register_reference_v1.read_narcotics_register_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION narcotics_register_reference_v1.close_narcotics_register_operation_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION narcotics_register_reference_v1.preserve_narcotics_form_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION narcotics_register_reference_v1.read_narcotics_form_operation_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION narcotics_register_reference_v1.download_narcotics_form_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION narcotics_register_reference_v1.narcotics_recovery_preflight_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION narcotics_register_reference_v1.narcotics_recovery_arm_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION narcotics_register_reference_v1.narcotics_recovery_backup_prepare_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION narcotics_register_reference_v1.narcotics_recovery_source_resume_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION narcotics_register_reference_v1.narcotics_recovery_begin_epoch_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION narcotics_register_reference_v1.narcotics_recovery_start_count_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION narcotics_register_reference_v1.narcotics_recovery_preserve_evidence_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION narcotics_register_reference_v1.narcotics_recovery_acknowledge_evidence_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION narcotics_register_reference_v1.narcotics_recovery_read_evidence_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION narcotics_register_reference_v1.narcotics_recovery_release_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION narcotics_register_reference_v1.narcotics_recovery_read_operation_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION narcotics_register_reference_v1.narcotics_recovery_close_operation_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION narcotics_register_reference_v1.narcotics_recovery_status_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION narcotics_register_reference_v1.narcotics_recovery_admission_v1() TO anon,authenticated,service_role;
DO $operational_source$DECLARE expected jsonb;actual jsonb;differences jsonb;BEGIN
 expected:=narcotics_register_reference_v1.module_properties('narcotics_register_reference_v1','narcotics_recovery_reference_v1','narcotics_register_v1','narcotics_recovery_v1');
 actual:=narcotics_register_v1.module_properties('narcotics_register_v1','narcotics_recovery_v1','narcotics_register_v1','narcotics_recovery_v1');
 IF actual IS DISTINCT FROM expected THEN
  WITH RECURSIVE delta(path,before_value,after_value)AS(
   SELECT '$',expected,actual
   UNION ALL
   SELECT d.path||'.'||k.key,d.before_value->k.key,d.after_value->k.key
   FROM delta d CROSS JOIN LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(d.before_value)='object'AND jsonb_typeof(d.after_value)='object' THEN d.before_value||d.after_value ELSE '{}'::jsonb END)k(key)
   WHERE d.before_value IS DISTINCT FROM d.after_value)
  SELECT jsonb_agg(jsonb_build_object('path',path,'expected',left(before_value::text,256),'actual',left(after_value::text,256)))INTO differences
  FROM(SELECT *FROM delta WHERE before_value IS DISTINCT FROM after_value
   AND(jsonb_typeof(before_value)IS DISTINCT FROM'object'OR jsonb_typeof(after_value)IS DISTINCT FROM'object')ORDER BY path LIMIT 20)leaf;
  RAISE EXCEPTION 'narcotics_source_properties_differ' USING ERRCODE='23514',DETAIL=coalesce(differences::text,'bounded source property difference');
 END IF;
 INSERT INTO narcotics_register_v1.descriptor VALUES(1,expected,narcotics_register_v1.hash('narcotics-operational-module-v1',expected));
END $operational_source$;
DO $operational_initial_head$DECLARE id_value uuid:=gen_random_uuid();at_value timestamptz:=clock_timestamp();document_value jsonb;hash_value text;BEGIN
 document_value:=jsonb_build_object('schema_version',1,'domain','lrv-narcotics-recovery-head-v1','head_id',id_value,
 'prior_head_id',NULL,'prior_head_hash',NULL,'kind','installed','mode','idle','arm_id',NULL,'epoch_id',NULL,'actor_id',NULL,'session_id',NULL,
 'recorded_at',narcotics_register_v1.utc(at_value),'body',jsonb_build_object('basis','source_installation_only'));
 hash_value:=narcotics_register_v1.hash('narcotics-recovery-head-v1',document_value);
 INSERT INTO narcotics_recovery_v1.heads VALUES(id_value,NULL,NULL,'installed','idle',NULL,NULL,NULL,NULL,at_value,document_value,hash_value);
 EXECUTE format('COMMENT ON SCHEMA narcotics_recovery_v1 IS %L',narcotics_recovery_v1.projection_of(document_value,hash_value)::text);
END $operational_initial_head$;
DROP SCHEMA narcotics_register_reference_v1,narcotics_recovery_reference_v1 CASCADE;
DO $operational_installed$BEGIN
 PERFORM narcotics_register_v1.require_module();
 PERFORM controlled_count_entry_v1.require_bound_module();
END $operational_installed$;

-- Apply only to the verified owned/native receiver while REST ingress is
-- inaccessible or drained. A reload notification does not drain old requests.
-- pg_dump does not preserve this role configuration; repeat the exact check
-- and installation before reopening a restored receiver.
DO $recovery_gateway_configuration$
DECLARE observed jsonb;expected jsonb:='[{"role":"authenticator","database":null,"setting":"pgrst.db_pre_request=public.narcotics_recovery_admission_v1"}]'::jsonb;
BEGIN
 IF current_user<>'postgres'OR to_regprocedure('public.narcotics_recovery_admission_v1()')IS NULL THEN
 RAISE EXCEPTION 'narcotics_recovery_gateway_installation_invalid';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('role',r.rolname,'database',d.datname,'setting',setting)
  ORDER BY r.rolname,d.datname,setting),'[]'::jsonb)INTO observed
 FROM pg_db_role_setting s LEFT JOIN pg_roles r ON r.oid=s.setrole LEFT JOIN pg_database d ON d.oid=s.setdatabase
 CROSS JOIN LATERAL unnest(s.setconfig)config(setting)
 WHERE(s.setdatabase=0 OR d.datname='postgres')AND(
  setting LIKE'pgrst.%'OR((r.rolname IN('authenticator','anon','authenticated','service_role')OR s.setrole=0)
   AND split_part(setting,'=',1)IN('search_path','role','session_authorization')));
 IF observed<>'[]'::jsonb AND observed IS DISTINCT FROM expected THEN
 RAISE EXCEPTION 'narcotics_recovery_existing_gateway_configuration';END IF;
 IF observed='[]'::jsonb THEN
  ALTER ROLE authenticator SET pgrst.db_pre_request='public.narcotics_recovery_admission_v1';
 END IF;
END $recovery_gateway_configuration$;
SELECT pg_notify('pgrst','reload config');
SELECT pg_notify('pgrst','reload schema');
