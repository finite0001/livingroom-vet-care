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
