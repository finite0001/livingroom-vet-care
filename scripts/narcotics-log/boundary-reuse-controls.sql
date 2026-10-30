-- Synthetic owner DATA controls only; never an Auth or closure certificate.
BEGIN;
SET LOCAL statement_timeout='8s';SET LOCAL lock_timeout='5s';
SET LOCAL search_path=pg_catalog;SET LOCAL timezone='UTC';
SET LOCAL datestyle='ISO,YMD';SET LOCAL intervalstyle='postgres';SET LOCAL extra_float_digits=3;
DO $lock$BEGIN PERFORM pg_advisory_xact_lock(90271040,0);END$lock$;
LOCK TABLE controlled_count_v1.reconciliation_preparations,
 controlled_count_v1.reconciliation_executions,controlled_count_v1.reconciliation_confirmations,
 controlled_count_v1.resolutions IN SHARE ROW EXCLUSIVE MODE;
CREATE FUNCTION pg_temp.boundary_reuse_controls()RETURNS jsonb LANGUAGE plpgsql
SECURITY INVOKER SET search_path=pg_catalog AS $control$
DECLARE item record;candidate jsonb;cache jsonb;variant integer;cases integer:=0;boundaries integer:=0;
 kinds text[]:='{}';old_code text;new_code text;old_message text;new_message text;
 reference_boundary jsonb;reference_cache jsonb;base_variant integer;cache_key text;body_domain_cases integer:=0;
BEGIN
 FOR item IN
  SELECT 'reconciliation_preparation'::text kind,p.preparation_id id,p.document,p.document#>'{body,boundary}' boundary
   FROM controlled_count_v1.reconciliation_preparations p
  UNION ALL SELECT 'reconciliation_execution',e.execution_id,e.document,e.document#>'{body,before_boundary}'
   FROM controlled_count_v1.reconciliation_executions e
  UNION ALL SELECT 'reconciliation_execution',e.execution_id,e.document,e.document#>'{body,after_boundary}'
   FROM controlled_count_v1.reconciliation_executions e
  UNION ALL SELECT 'reconciliation_confirmation',c.confirmation_id,c.document,c.document#>'{body,post_boundary}'
   FROM controlled_count_v1.reconciliation_confirmations c
  UNION ALL SELECT 'cause_resolution',r.resolution_id,r.document,r.document#>'{body,current_boundary}'
   FROM controlled_count_v1.resolutions r
 LOOP
  boundaries:=boundaries+1;
  IF boundaries=1 THEN reference_boundary:=item.boundary;
   reference_cache:=jsonb_build_object(item.kind||':'||item.id::text,item.document);END IF;
  IF NOT(item.kind=ANY(kinds))THEN kinds:=array_append(kinds,item.kind);END IF;
  FOR variant IN 1..10 LOOP
   base_variant:=1+((variant-1)%5);
   cache_key:=(CASE WHEN variant<=5 THEN''ELSE'body_grammar:'END)||item.kind||':'||item.id::text;
   candidate:=item.boundary;cache:=jsonb_build_object(cache_key,item.document);
   IF base_variant=2 THEN cache:=jsonb_build_object(cache_key,item.document||jsonb_build_object('unreviewed_extra_field',true));
   ELSIF base_variant=3 THEN cache:=jsonb_build_object('wrong_kind:'||item.id::text,item.document);
   ELSIF base_variant=4 THEN candidate:=candidate||jsonb_build_object('unreviewed_extra_field',true);
   ELSIF base_variant=5 THEN candidate:='null'::jsonb;END IF;
   old_code:=NULL;new_code:=NULL;old_message:=NULL;new_message:=NULL;
   BEGIN PERFORM controlled_count_v1.historical_boundary_values(candidate);
   EXCEPTION WHEN query_canceled OR assert_failure THEN RAISE;
    WHEN OTHERS THEN GET STACKED DIAGNOSTICS old_code=RETURNED_SQLSTATE,old_message=MESSAGE_TEXT;END;
   BEGIN PERFORM controlled_count_v1.history_scan_historical_boundary_values(candidate,cache);
   EXCEPTION WHEN query_canceled OR assert_failure THEN RAISE;
    WHEN OTHERS THEN GET STACKED DIAGNOSTICS new_code=RETURNED_SQLSTATE,new_message=MESSAGE_TEXT;END;
   IF old_code IS DISTINCT FROM new_code OR old_message IS DISTINCT FROM new_message
    OR(base_variant<=3 AND old_code IS NOT NULL)OR(base_variant>=4 AND old_code IS NULL)THEN
    RAISE EXCEPTION 'boundary_grammar_reuse_control_failed';END IF;
   cases:=cases+1;
   IF variant>5 THEN body_domain_cases:=body_domain_cases+1;END IF;
  END LOOP;
 END LOOP;
 IF cardinality(kinds)<>4 OR boundaries<5 THEN RAISE EXCEPTION 'complete_management_boundary_fixture_required';END IF;
 FOR variant IN 0..5 LOOP
  candidate:=reference_boundary;
  cache:=CASE variant WHEN 0 THEN NULL WHEN 1 THEN reference_cache WHEN 2 THEN'null'::jsonb
   WHEN 3 THEN'[]'::jsonb WHEN 4 THEN'"wrong map"'::jsonb ELSE'1'::jsonb END;
  IF variant=1 THEN candidate:=NULL;END IF;
  old_code:=NULL;new_code:=NULL;old_message:=NULL;new_message:=NULL;
  BEGIN
   IF variant<=1 THEN PERFORM controlled_count_v1.historical_boundary_values(candidate);
   ELSE PERFORM *FROM jsonb_each(cache);END IF;
  EXCEPTION WHEN query_canceled OR assert_failure THEN RAISE;
   WHEN OTHERS THEN GET STACKED DIAGNOSTICS old_code=RETURNED_SQLSTATE,old_message=MESSAGE_TEXT;END;
  BEGIN PERFORM controlled_count_v1.history_scan_historical_boundary_values(candidate,cache);
  EXCEPTION WHEN query_canceled OR assert_failure THEN RAISE;
   WHEN OTHERS THEN GET STACKED DIAGNOSTICS new_code=RETURNED_SQLSTATE,new_message=MESSAGE_TEXT;END;
  IF old_code IS DISTINCT FROM new_code OR old_message IS DISTINCT FROM new_message
   OR(variant=0 AND old_code IS NOT NULL)OR(variant>=1 AND old_code IS NULL)THEN
   RAISE EXCEPTION 'boundary_map_null_control_failed';END IF;
  cases:=cases+1;
 END LOOP;
 RETURN jsonb_build_object('kind','management-boundary-grammar-controls-v1','kinds',cardinality(kinds),
  'boundaries',boundaries,'cases',cases,'map_and_sql_null_cases',6,'body_grammar_cases',body_domain_cases,'original_and_context_results_exact',true,
  'domain_writes',0,'Auth_acceptance',false);
END$control$;
SELECT pg_temp.boundary_reuse_controls();
ROLLBACK;
