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
 evidence_id uuid NOT NULL UNIQUE REFERENCES narcotics_recovery_v1.evidence(evidence_id),
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
 IF evidence_value->'actor_id'=p_request->'actor_id'OR evidence_value->'epoch_id'IS DISTINCT FROM epoch_value->'epoch_id'
 OR evidence_value->>'record_hash'IS DISTINCT FROM data_value->>'evidence_hash'THEN
 RAISE EXCEPTION 'narcotics_recovery_independent_review_required' USING ERRCODE='PT409';END IF;
 PERFORM controlled_count_v1.current_principal((p_request->>'actor_id')::uuid,
  (evidence_value->>'product_id')::uuid,(evidence_value->>'site_id')::uuid,'observe');
 note_value:=narcotics_register_v1.text_value(data_value->'review_note',2000);at_value:=clock_timestamp();
 document_value:=jsonb_build_object('schema_version',1,'domain','lrv-narcotics-recovery-acknowledgment-v1',
  'acknowledgment_id',p_request->'operation_id','evidence_id',evidence_value->'evidence_id','evidence_hash',evidence_value->'record_hash',
  'actor_id',p_request->'actor_id','session_id',identity_value->'session_id','recorded_at',narcotics_register_v1.utc(at_value),
  'review_note',note_value,'meaning_version','1',
  'meaning','I reviewed this exact file and the staff-reported account. This acknowledgment does not certify the file as a recovered original database event.');
 receipt_value:=narcotics_recovery_v1.save_operation(p_request,jsonb_build_object('acknowledgment_id',p_request->'operation_id',
  'evidence_id',evidence_value->'evidence_id','evidence_hash',evidence_value->'record_hash',
  'acknowledgment_hash',narcotics_register_v1.hash('narcotics-recovery-acknowledgment-v1',document_value)));
 INSERT INTO narcotics_recovery_v1.acknowledgments VALUES((p_request->>'operation_id')::uuid,(evidence_value->>'evidence_id')::uuid,
  evidence_value->>'record_hash',(p_request->>'actor_id')::uuid,(identity_value->>'session_id')::uuid,at_value,note_value,
  document_value,narcotics_register_v1.hash('narcotics-recovery-acknowledgment-v1',document_value));
 RETURN receipt_value;
END $$;

CREATE FUNCTION narcotics_recovery_v1.acknowledgment_record(p_evidence uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE saved narcotics_recovery_v1.acknowledgments;evidence_value jsonb;operation_value jsonb;expected jsonb;
BEGIN
 PERFORM controlled_count_entry_v1.assert_read_frontier();PERFORM narcotics_recovery_v1.require_exclusive_admission();
 evidence_value:=narcotics_recovery_v1.evidence_record(p_evidence);
 SELECT *INTO STRICT saved FROM narcotics_recovery_v1.acknowledgments a WHERE a.evidence_id=p_evidence;
 operation_value:=narcotics_recovery_v1.saved_operation(saved.acknowledgment_id);
 expected:=jsonb_build_object('schema_version',1,'domain','lrv-narcotics-recovery-acknowledgment-v1',
  'acknowledgment_id',saved.acknowledgment_id,'evidence_id',saved.evidence_id,'evidence_hash',saved.evidence_hash,
  'actor_id',saved.actor_id,'session_id',saved.session_id,'recorded_at',narcotics_register_v1.utc(saved.recorded_at),
  'review_note',saved.review_note,'meaning_version','1',
  'meaning','I reviewed this exact file and the staff-reported account. This acknowledgment does not certify the file as a recovered original database event.');
 PERFORM narcotics_register_v1.keys(operation_value#>'{original_request,data}',ARRAY['evidence_id','evidence_hash','acknowledged','review_note']);
 IF expected::text IS DISTINCT FROM saved.document::text
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
 IF(SELECT count(*)FROM narcotics_recovery_v1.evidence e WHERE e.epoch_id=(epoch_value->>'epoch_id')::uuid)>=64 THEN
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
