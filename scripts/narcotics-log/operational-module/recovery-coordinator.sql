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
