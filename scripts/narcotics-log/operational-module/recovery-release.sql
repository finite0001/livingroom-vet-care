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
 evidence_refs jsonb:='[]';product_value jsonb;causes_value jsonb;head_value jsonb;note_value text;scope_count integer;
BEGIN
 receipt_value:=narcotics_recovery_v1.operation_request(p_request,'release');
 IF receipt_value IS NOT NULL THEN RETURN receipt_value;END IF;
 PERFORM narcotics_register_v1.keys(p_request->'data',ARRAY['agreements','history_review_note']);
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
 IF(SELECT count(*)FROM narcotics_recovery_v1.evidence e WHERE e.epoch_id=(epoch_value->>'epoch_id')::uuid)>64 THEN
 RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413';END IF;
 FOR evidence_value IN SELECT e.evidence_id FROM narcotics_recovery_v1.evidence e
  WHERE e.epoch_id=(epoch_value->>'epoch_id')::uuid ORDER BY e.evidence_id LOOP
  evidence_document:=narcotics_recovery_v1.evidence_record(evidence_value.evidence_id);
  acknowledgment_value:=narcotics_recovery_v1.acknowledgment_record(evidence_value.evidence_id);
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
