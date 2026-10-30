"""Owned, rollback-only context-guard controls; not Auth/projection acceptance."""
import hashlib
from pathlib import Path
import re

from parent_history_projection import SIGNATURE

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
COUNT = 'narcotics_parent_projection_count'
ENTRY = 'narcotics_parent_projection_entry'
ANCHOR = " p_product:=(scope_value->>'product_id')::uuid;\n"
SPY = " RAISE EXCEPTION 'synthetic_projection_guard_reached';\n"


def instrument(raw, expected):
    name = SIGNATURE.split('(', 1)[0]
    matches = list(re.finditer(r'CREATE(?: OR REPLACE)? FUNCTION ' + re.escape(name) + r'\(', raw))
    if len(matches) != 1:
        raise ValueError('One exact source parent projection required')
    start = matches[0].start()
    begin = raw.index(' AS $$', start) + len(' AS $$')
    end = raw.index('$$;', begin)
    text = raw[start:end + 3]
    source_body = raw[begin:end]
    if hashlib.sha256(source_body.encode()).hexdigest() != expected:
        raise ValueError('Original parent projection source hash differs')
    if source_body.count(ANCHOR) != 1 or SPY in source_body:
        raise ValueError('Exact completed-context guard anchor required')
    changed = text.replace(ANCHOR, ANCHOR + SPY, 1)
    replacements = [('controlled_count_v1', COUNT), ('controlled_count_entry_v1', ENTRY),
                    ('public.controlled_stock_execution_contexts', COUNT + '.contexts')]
    if any(new in text for _, new in replacements):
        raise ValueError('Fresh isolated projection namespaces required')
    for old, new in replacements:
        changed = changed.replace(old, new)
    inverse = changed
    for old, new in reversed(replacements):
        inverse = inverse.replace(new, old)
    inverse = inverse.replace(ANCHOR + SPY, ANCHOR, 1)
    if inverse != text:
        raise ValueError('Whole projection source/namespace inverse required')
    return changed


def program(expected):
    source = ROOT / 'supabase/migrations/20261027223544_narcotics_count_and_stock_workflows.sql'
    changed = instrument(source.read_text(), expected)
    prefix = """BEGIN;
SET LOCAL statement_timeout='8s';SET LOCAL lock_timeout='5s';SET LOCAL search_path=pg_catalog;
DO $owner_lock$BEGIN PERFORM pg_advisory_xact_lock(90271040,0);END$owner_lock$;
CREATE SCHEMA narcotics_parent_projection_count;
CREATE SCHEMA narcotics_parent_projection_entry;
REVOKE ALL ON SCHEMA narcotics_parent_projection_count,narcotics_parent_projection_entry FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE narcotics_parent_projection_count.contexts(backend_pid integer PRIMARY KEY,phase text,count_scope jsonb);
CREATE TABLE narcotics_parent_projection_count.operations(operation_id uuid PRIMARY KEY);
CREATE TABLE narcotics_parent_projection_count.operation_closures(operation_id uuid PRIMARY KEY);
-- Explicit owner-data spies. These supply no current Auth or frontier proof.
CREATE FUNCTION narcotics_parent_projection_entry.assert_read_frontier()RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END$$;
CREATE FUNCTION narcotics_parent_projection_entry.assert_scope_resource_frontier(jsonb)RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END$$;
CREATE FUNCTION narcotics_parent_projection_entry.current_count_context_header_required(p jsonb)RETURNS jsonb LANGUAGE sql AS $$SELECT p->'count_scope'$$;
"""
    checks = """
CREATE FUNCTION narcotics_parent_projection_count.run_controls()RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $controls$
DECLARE actual_scope jsonb:=jsonb_build_object('outer_action','reconciliation_execute',
 'product_id','00000000-0000-0000-0000-000000000001',
 'outer_operation_id','00000000-0000-0000-0000-000000000002');
 supplied jsonb;state_value text;message_value text;variant integer;wanted text;checked integer:=0;
BEGIN
 FOR variant IN 1..12 LOOP
  TRUNCATE narcotics_parent_projection_count.contexts,narcotics_parent_projection_count.operations,narcotics_parent_projection_count.operation_closures;
  INSERT INTO narcotics_parent_projection_count.contexts VALUES(pg_backend_pid(),'count_operating',actual_scope);
  supplied:=actual_scope;wanted:='count_context_invalid';
  IF variant=1 THEN wanted:='synthetic_projection_guard_reached';
  ELSIF variant=2 THEN
   UPDATE narcotics_parent_projection_count.contexts SET phase='executing';wanted:='synthetic_projection_guard_reached';
  ELSIF variant=3 THEN UPDATE narcotics_parent_projection_count.contexts SET phase='count_entering';
  ELSIF variant=4 THEN UPDATE narcotics_parent_projection_count.contexts SET phase='count_finishing';
  ELSIF variant=5 THEN UPDATE narcotics_parent_projection_count.contexts SET phase=NULL;
  ELSIF variant=6 THEN
   supplied:=jsonb_set(actual_scope,'{outer_action}','"reconciliation_prepare"');
   UPDATE narcotics_parent_projection_count.contexts SET count_scope=supplied;
  ELSIF variant=7 THEN supplied:=jsonb_set(actual_scope,'{product_id}','"00000000-0000-0000-0000-000000000003"');
  ELSIF variant=8 THEN supplied:=NULL;
  ELSIF variant=9 THEN INSERT INTO narcotics_parent_projection_count.operations VALUES((actual_scope->>'outer_operation_id')::uuid);
  ELSIF variant=10 THEN INSERT INTO narcotics_parent_projection_count.operation_closures VALUES((actual_scope->>'outer_operation_id')::uuid);
  ELSIF variant=11 THEN TRUNCATE narcotics_parent_projection_count.contexts;wanted:='query returned no rows';
  ELSIF variant=12 THEN supplied:='null'::jsonb;
  END IF;
  state_value:=NULL;message_value:=NULL;
  BEGIN
   PERFORM narcotics_parent_projection_count.reconciliation_live_causes(supplied);
  EXCEPTION WHEN query_canceled OR assert_failure THEN RAISE;
   WHEN OTHERS THEN GET STACKED DIAGNOSTICS state_value=RETURNED_SQLSTATE,message_value=MESSAGE_TEXT;END;
  IF state_value IS DISTINCT FROM(CASE WHEN variant=11 THEN'P0002'ELSE'P0001'END)
   OR message_value IS DISTINCT FROM wanted THEN
   RAISE EXCEPTION 'parent_projection_guard_control_failed'USING DETAIL=jsonb_build_object(
    'variant',variant,'code',state_value,'message',message_value)::text;END IF;
  checked:=checked+1;
 END LOOP;
 RETURN jsonb_build_object('kind','isolated-parent-projection-guard-controls-v1','cases',checked,
  'owner_data_only',true,'Auth_acceptance',false,'projection_body_not_executed',true,
  'whole_source_inverse',true,'domain_rows_changed',0,'ordinary_role_EXECUTE_refusals',3);
END$controls$;
-- Actual installed helper must remain unavailable to all three app roles.
DO $ordinary_roles$DECLARE role_value text;blocked boolean;
BEGIN
 FOREACH role_value IN ARRAY ARRAY['anon','authenticated','service_role']LOOP
  blocked:=false;EXECUTE format('SET LOCAL ROLE %I',role_value);
  BEGIN PERFORM controlled_count_v1.reconciliation_live_causes(NULL::jsonb);
  EXCEPTION WHEN insufficient_privilege THEN blocked:=true;END;
  SET LOCAL ROLE postgres;
  IF NOT blocked THEN RAISE EXCEPTION 'parent_projection_private_EXECUTE_exposed';END IF;
 END LOOP;
END$ordinary_roles$;
SELECT narcotics_parent_projection_count.run_controls();
ROLLBACK;
"""
    return prefix + changed + checks


def run(runtime):
    expected = runtime.install.expected_module['properties']['functions'][SIGNATURE]['body_sha256']
    value = runtime.selected_query('isolated-parent-projection-guard-controls', program(expected))
    wanted = dict(kind='isolated-parent-projection-guard-controls-v1', cases=12,
                  owner_data_only=True, Auth_acceptance=False, projection_body_not_executed=True,
                  whole_source_inverse=True, domain_rows_changed=0, ordinary_role_EXECUTE_refusals=3)
    if value != wanted:
        raise ValueError('Complete isolated parent projection guard controls required')
    return value
