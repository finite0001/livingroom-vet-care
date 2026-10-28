"""Isolated owner-data protocol controls, never application/Auth acceptance.

Uses the exact queue/trigger source in a rollback-only synthetic namespace.
Only scope admission, frontier admission and the full-validator implementation
are substituted with explicit test inputs/spies. Their source inverse is checked.
No clinical rows, claims, sessions or historical descriptors are changed.
"""
import re
from pathlib import Path

from pending_validation import FACT_TABLES
from sql_framing import split_reviewed_statements

HERE = Path(__file__).resolve().parent
SCHEMA = 'narcotics_pending_protocol_test'


def program():
    original = (HERE / 'pending-validation.sql').read_text()
    selected = []
    for statement in split_reviewed_statements(original):
        if re.match(r'^CREATE FUNCTION controlled_count_v1\.pending_scope_required\(', statement):
            selected.append(statement)
    if len(selected) != 1:
        raise ValueError('One exact original scope helper required')
    statement = selected[0]
    body = re.search(r'\bAS\s+(\$[a-zA-Z0-9_]*\$)(.*?)\1\s*$', statement, re.S)
    if not body:
        raise ValueError('Exact scope body framing required')
    spy = "BEGIN RETURN(SELECT jsonb_build_object('product_id',product_id)FROM controlled_count_v1.scope_input);END "
    replacement = statement[:body.start(2)] + spy + statement[body.end(2):]
    changed = original.replace(statement, replacement, 1)
    if changed.replace(replacement, statement, 1) != original:
        raise ValueError('Whole source helper inverse required')
    # Both source namespaces map to this disposable test schema. The fixture
    # retains all source queue bodies and all eighteen trigger declarations.
    changed = changed.replace('controlled_count_entry_v1', SCHEMA).replace('controlled_count_v1', SCHEMA)
    prefix = """BEGIN;
SET LOCAL statement_timeout='8s';SET LOCAL lock_timeout='5s';SET LOCAL search_path=pg_catalog;
CREATE SCHEMA narcotics_pending_protocol_test;
CREATE TABLE narcotics_pending_protocol_test.scope_input(product_id uuid NOT NULL,reject boolean NOT NULL);
INSERT INTO narcotics_pending_protocol_test.scope_input VALUES('00000000-0000-0000-0000-000000000001',false);
CREATE TABLE narcotics_pending_protocol_test.calls(product_id uuid NOT NULL);
CREATE FUNCTION narcotics_pending_protocol_test.assert_read_frontier()RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END$$;
CREATE FUNCTION narcotics_pending_protocol_test.product_live_causes(p uuid)RETURNS void LANGUAGE plpgsql AS $$BEGIN
 IF(SELECT reject FROM narcotics_pending_protocol_test.scope_input)THEN RAISE EXCEPTION 'synthetic_full_validation_failed';END IF;
 INSERT INTO narcotics_pending_protocol_test.calls VALUES(p);END$$;
"""
    prefix += '\n'.join('CREATE TABLE ' + SCHEMA + '.' + name + '(id integer);' for name in FACT_TABLES) + '\n'
    checks = """
CREATE FUNCTION narcotics_pending_protocol_test.run_controls()RETURNS jsonb LANGUAGE plpgsql AS $controls$
DECLARE checked integer:=0;blocked boolean;before_calls bigint;
BEGIN
 -- Fourteen writes of one product require one full check at the first flush.
""" + '\n'.join('INSERT INTO ' + SCHEMA + '.' + name + ' VALUES(1);' for name in FACT_TABLES) + """
 IF(SELECT count(*)FROM narcotics_pending_protocol_test.pending_products)<>1 THEN RAISE EXCEPTION 'pending_dedup_failed';END IF;
 SET CONSTRAINTS narcotics_pending_protocol_test.pending_product_consistency IMMEDIATE;
 IF(SELECT count(*)FROM narcotics_pending_protocol_test.calls)<>1 OR EXISTS(SELECT 1 FROM narcotics_pending_protocol_test.pending_products)THEN RAISE EXCEPTION 'pending_flush_failed';END IF;
 checked:=checked+1;
 -- A later write must re-enqueue, even after an earlier successful flush.
 SET CONSTRAINTS narcotics_pending_protocol_test.pending_product_consistency DEFERRED;
 INSERT INTO narcotics_pending_protocol_test.operations VALUES(2);
 SET CONSTRAINTS narcotics_pending_protocol_test.pending_product_consistency IMMEDIATE;
 IF(SELECT count(*)FROM narcotics_pending_protocol_test.calls)<>2 THEN RAISE EXCEPTION 'pending_reenqueue_failed';END IF;
 checked:=checked+1;
 -- Distinct products are independent mandatory work, in the same transaction.
 SET CONSTRAINTS narcotics_pending_protocol_test.pending_product_consistency DEFERRED;
 INSERT INTO narcotics_pending_protocol_test.operations VALUES(3);
 UPDATE narcotics_pending_protocol_test.scope_input SET product_id='00000000-0000-0000-0000-000000000002';
 INSERT INTO narcotics_pending_protocol_test.operations VALUES(4);
 IF(SELECT count(*)FROM narcotics_pending_protocol_test.pending_products)<>2 THEN RAISE EXCEPTION 'pending_product_cut_failed';END IF;
 SET CONSTRAINTS narcotics_pending_protocol_test.pending_product_consistency IMMEDIATE;
 IF(SELECT count(*)FROM narcotics_pending_protocol_test.calls)<>4 THEN RAISE EXCEPTION 'pending_two_products_failed';END IF;
 checked:=checked+1;
 -- Immediate mode checks the actual AFTER-write state; failure rolls it back.
 UPDATE narcotics_pending_protocol_test.scope_input SET reject=true;
 blocked:=false;
 BEGIN INSERT INTO narcotics_pending_protocol_test.operations VALUES(5);
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'synthetic_full_validation_failed'THEN RAISE;END IF;blocked:=true;END;
 IF NOT blocked OR EXISTS(SELECT 1 FROM narcotics_pending_protocol_test.operations WHERE id=5)
 OR EXISTS(SELECT 1 FROM narcotics_pending_protocol_test.pending_products)THEN RAISE EXCEPTION 'pending_immediate_rollback_failed';END IF;
 checked:=checked+1;
 -- Explicit deletion cannot skip full validation, and failed clear retains work.
 SET CONSTRAINTS narcotics_pending_protocol_test.pending_product_consistency DEFERRED;
 INSERT INTO narcotics_pending_protocol_test.operations VALUES(6);
 blocked:=false;
 BEGIN DELETE FROM narcotics_pending_protocol_test.pending_products;
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'synthetic_full_validation_failed'THEN RAISE;END IF;blocked:=true;END;
 IF NOT blocked OR(SELECT count(*)FROM narcotics_pending_protocol_test.pending_products)<>1 THEN RAISE EXCEPTION 'pending_delete_bypass';END IF;
 checked:=checked+1;
 -- UPDATE and TRUNCATE cannot erase outstanding work.
 blocked:=false;BEGIN UPDATE narcotics_pending_protocol_test.pending_products SET transaction_id=transaction_id;
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'count_immutable_record'THEN RAISE;END IF;blocked:=true;END;
 IF NOT blocked THEN RAISE EXCEPTION 'pending_update_bypass';END IF;checked:=checked+1;
 blocked:=false;BEGIN TRUNCATE narcotics_pending_protocol_test.pending_products;
 EXCEPTION WHEN object_in_use THEN blocked:=true;END;
 IF NOT blocked THEN RAISE EXCEPTION 'pending_truncate_bypass';END IF;checked:=checked+1;
 UPDATE narcotics_pending_protocol_test.scope_input SET reject=false;
 DELETE FROM narcotics_pending_protocol_test.pending_products;
 -- Stale deferred events may consume new work only through another full check.
 INSERT INTO narcotics_pending_protocol_test.operations VALUES(7);
 SET CONSTRAINTS narcotics_pending_protocol_test.pending_product_consistency IMMEDIATE;
 IF(SELECT count(*)FROM narcotics_pending_protocol_test.calls)<>6 OR EXISTS(SELECT 1 FROM narcotics_pending_protocol_test.pending_products)THEN RAISE EXCEPTION 'pending_stale_event_failed';END IF;
 -- Once PostgreSQL's pending-event refusal no longer applies, the explicit
 -- BEFORE TRUNCATE source guard must independently refuse the operation.
 blocked:=false;BEGIN TRUNCATE narcotics_pending_protocol_test.pending_products;
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'count_immutable_record'THEN RAISE;END IF;blocked:=true;END;
 IF NOT blocked THEN RAISE EXCEPTION 'pending_empty_truncate_bypass';END IF;
 checked:=checked+1;
 -- Savepoint-style rollback removes facts, queued work, and their trigger event.
 SET CONSTRAINTS narcotics_pending_protocol_test.pending_product_consistency DEFERRED;
 before_calls:=(SELECT count(*)FROM narcotics_pending_protocol_test.calls);
 BEGIN INSERT INTO narcotics_pending_protocol_test.operations VALUES(8);RAISE EXCEPTION 'synthetic_savepoint_rollback';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'synthetic_savepoint_rollback'THEN RAISE;END IF;END;
 SET CONSTRAINTS narcotics_pending_protocol_test.pending_product_consistency IMMEDIATE;
 IF EXISTS(SELECT 1 FROM narcotics_pending_protocol_test.operations WHERE id=8)
 OR EXISTS(SELECT 1 FROM narcotics_pending_protocol_test.pending_products)
 OR(SELECT count(*)FROM narcotics_pending_protocol_test.calls)<>before_calls THEN RAISE EXCEPTION 'pending_savepoint_failed';END IF;
 checked:=checked+1;
 -- Wrong transaction and scope identities fail before recording work.
 blocked:=false;BEGIN INSERT INTO narcotics_pending_protocol_test.pending_products VALUES(txid_current()+1,'00000000-0000-0000-0000-000000000002');
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'count_context_invalid'THEN RAISE;END IF;blocked:=true;END;
 IF NOT blocked THEN RAISE EXCEPTION 'pending_transaction_bypass';END IF;checked:=checked+1;
 blocked:=false;BEGIN INSERT INTO narcotics_pending_protocol_test.pending_products VALUES(txid_current(),'00000000-0000-0000-0000-000000000003');
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'count_context_invalid'THEN RAISE;END IF;blocked:=true;END;
 IF NOT blocked THEN RAISE EXCEPTION 'pending_scope_bypass';END IF;checked:=checked+1;
 RETURN jsonb_build_object('kind','isolated-pending-protocol-controls-v1','cases',checked,
 'owner_data_only',true,'Auth_acceptance',false,'clinical_rows_changed',0,'whole_source_inverse',true);
END $controls$;
-- Actual private-schema DML refusals. These role tests are owner-run negative
-- controls, not a substitute for the separate genuine GoTrue success profiles.
DO $ordinary_roles$
DECLARE role_value text;command_value text;blocked boolean;
BEGIN
 FOREACH role_value IN ARRAY ARRAY['anon','authenticated','service_role']LOOP
  FOREACH command_value IN ARRAY ARRAY[
   'INSERT INTO controlled_count_v1.pending_products VALUES(txid_current(),''00000000-0000-0000-0000-000000000002'')',
   'UPDATE controlled_count_v1.pending_products SET transaction_id=transaction_id',
   'DELETE FROM controlled_count_v1.pending_products',
   'TRUNCATE controlled_count_v1.pending_products']LOOP
   blocked:=false;
   EXECUTE format('SET LOCAL ROLE %I',role_value);
   BEGIN EXECUTE command_value;EXCEPTION WHEN insufficient_privilege THEN blocked:=true;END;
   SET LOCAL ROLE postgres;
   IF NOT blocked THEN RAISE EXCEPTION 'pending_private_DML_exposed';END IF;
  END LOOP;
 END LOOP;
END $ordinary_roles$;
SELECT narcotics_pending_protocol_test.run_controls();
ROLLBACK;
"""
    return prefix + changed + checks
