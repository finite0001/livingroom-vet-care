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
  PERFORM narcotics_register_v1.keys(row_value.receipt,ARRAY['schema_version','operation_id','actor_id','action','state','request_hash','data']);
  expected_receipt:=jsonb_build_object('schema_version',1,'operation_id',row_value.operation_id,'actor_id',row_value.actor_id,
   'action',row_value.action,'state','saved','request_hash',row_value.request_hash,'data',row_value.receipt->'data');
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
