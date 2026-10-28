-- Pure-data adversarial controls in an owned rollback-only observer.
BEGIN;
SET LOCAL statement_timeout='8s';
SET LOCAL lock_timeout='5s';
SET LOCAL search_path=pg_catalog;
SET LOCAL timezone='UTC';
SET LOCAL datestyle='ISO,YMD';
SET LOCAL intervalstyle='postgres';
SET LOCAL extra_float_digits=3;
-- Owner-only DATA locks, matching the existing owner observation convention.
-- This does not manufacture an API session or count-entry authority.
DO $owner_data_lock$BEGIN PERFORM pg_advisory_xact_lock(90271040,0);END $owner_data_lock$;
LOCK TABLE controlled_count_v1.policies,controlled_count_v1.snapshots IN SHARE ROW EXCLUSIVE MODE;
CREATE FUNCTION pg_temp.policy_reuse_controls() RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $control$
DECLARE actual controlled_count_v1.policies;original_value jsonb;candidate jsonb;bad jsonb;
 cache jsonb;selected_cache jsonb;old_result jsonb;new_result jsonb;roles_value jsonb;
 old_code text;new_code text;old_message text;new_message text;variant integer;checked integer:=0;
BEGIN
 SELECT *INTO STRICT actual FROM controlled_count_v1.policies ORDER BY policy_id LIMIT 1;
 -- The genuine profile already verified history. Here the original PURE
 -- grammar validator independently certifies the full document before caching.
 original_value:=controlled_count_v1.policy_values(actual.document);
 cache:=jsonb_build_object('policy_values:'||actual.policy_id::text,original_value);
 FOR variant IN 1..11 LOOP
  candidate:=original_value;selected_cache:=cache;
  IF variant IN(2,3)THEN
   candidate:=candidate||jsonb_build_object('unreviewed_extra_field',true);
   IF variant=3 THEN candidate:=jsonb_set(candidate,'{record_hash}',to_jsonb(controlled_count_v1.document_hash(candidate)));END IF;
  ELSIF variant=4 THEN
   candidate:=jsonb_set(candidate,'{version}','"wrong type"'::jsonb);
   candidate:=jsonb_set(candidate,'{record_hash}',to_jsonb(controlled_count_v1.document_hash(candidate)));
  ELSIF variant=5 THEN
   selected_cache:=jsonb_build_object('policy_values:'||actual.policy_id::text,original_value||jsonb_build_object('unreviewed_extra_field',true));
  ELSIF variant=6 THEN selected_cache:='{}';
  ELSIF variant=7 THEN selected_cache:=jsonb_build_object('policy_values:00000000-0000-0000-0000-000000000000',original_value);
  ELSIF variant=8 THEN candidate:='null';
  ELSIF variant=11 THEN
   candidate:=jsonb_set(candidate,'{read_enabled}','false');
   candidate:=jsonb_set(candidate,'{record_hash}',to_jsonb(controlled_count_v1.document_hash(candidate)));
  END IF;
  roles_value:=CASE WHEN variant=10 THEN'[]'::jsonb ELSE original_value->'reader_roles'END;
  old_code:=NULL;new_code:=NULL;old_message:=NULL;new_message:=NULL;old_result:=NULL;new_result:=NULL;
  BEGIN
   IF variant<=8 THEN old_result:=controlled_count_v1.policy_values(candidate);
   ELSE old_result:=to_jsonb(controlled_count_v1.policy_capability_values(candidate,roles_value,'read'));END IF;
  EXCEPTION WHEN query_canceled OR assert_failure THEN RAISE;
   WHEN OTHERS THEN GET STACKED DIAGNOSTICS old_code=RETURNED_SQLSTATE,old_message=MESSAGE_TEXT;END;
  BEGIN
   IF variant<=8 THEN new_result:=controlled_count_v1.history_scan_policy_values(candidate,selected_cache);
   ELSE new_result:=to_jsonb(controlled_count_v1.history_scan_policy_capability_values(candidate,roles_value,'read',selected_cache));END IF;
  EXCEPTION WHEN query_canceled OR assert_failure THEN RAISE;
   WHEN OTHERS THEN GET STACKED DIAGNOSTICS new_code=RETURNED_SQLSTATE,new_message=MESSAGE_TEXT;END;
  IF old_code IS DISTINCT FROM new_code OR old_message IS DISTINCT FROM new_message
   OR old_result::text IS DISTINCT FROM new_result::text THEN
   RAISE EXCEPTION 'policy_grammar_reuse_control_failed';END IF;
  checked:=checked+1;
 END LOOP;
 RETURN jsonb_build_object('kind','historical-policy-grammar-controls-v1','cases',checked,
  'original_and_context_results_exact',true,'captured_capability_decisions_recomputed',true,'domain_writes',0,'Auth_acceptance',false);
END $control$;
SELECT pg_temp.policy_reuse_controls();
ROLLBACK;
