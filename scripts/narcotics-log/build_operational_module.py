"""Source-only operational-module assembly; reference DDL supplies expectations."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
from sql_framing import split_reviewed_statements

REGISTER = 'narcotics_register_v1'
RECOVERY = 'narcotics_recovery_v1'
REFERENCE_REGISTER = 'narcotics_register_reference_v1'
REFERENCE_RECOVERY = 'narcotics_recovery_reference_v1'
MIGRATION = '20261028044922_narcotics_register_exports_and_recovery.sql'
SOURCE = HERE / 'operational-module'
REGISTER_APIS = {
    'list_narcotics_registers_v1': "narcotics_register_v1.list_reports(p_request)",
    'create_narcotics_register_v1': "narcotics_register_v1.create_report(p_request)",
    'read_narcotics_register_v1': "narcotics_register_v1.read_operation(p_request,'report')",
    'close_narcotics_register_operation_v1': "narcotics_register_v1.close_operation(p_request)",
    'preserve_narcotics_form_v1': "narcotics_register_v1.preserve_form(p_request)",
    'read_narcotics_form_operation_v1': "narcotics_register_v1.read_operation(p_request,'form')",
    'download_narcotics_form_v1': "narcotics_register_v1.download_form(p_request)",
}
RECOVERY_APIS = {
    'narcotics_recovery_preflight_v1': 'narcotics_recovery_v1.preflight(p_request)',
    'narcotics_recovery_arm_v1': 'narcotics_recovery_v1.arm(p_request)',
    'narcotics_recovery_backup_prepare_v1': 'narcotics_recovery_v1.backup_prepare(p_request)',
    'narcotics_recovery_source_resume_v1': 'narcotics_recovery_v1.source_resume(p_request)',
    'narcotics_recovery_begin_epoch_v1': 'narcotics_recovery_v1.begin_epoch(p_request)',
    'narcotics_recovery_start_count_v1': 'narcotics_recovery_v1.start_count(p_request)',
    'narcotics_recovery_preserve_evidence_v1': 'narcotics_recovery_v1.preserve_evidence(p_request)',
    'narcotics_recovery_acknowledge_evidence_v1': 'narcotics_recovery_v1.acknowledge_evidence(p_request)',
    'narcotics_recovery_read_evidence_v1': 'narcotics_recovery_v1.read_evidence(p_request)',
    'narcotics_recovery_release_v1': 'narcotics_recovery_v1.release(p_request)',
    'narcotics_recovery_read_operation_v1': 'narcotics_recovery_v1.operation_pointer(p_request)',
    'narcotics_recovery_close_operation_v1': 'narcotics_recovery_v1.close_operation(p_request)',
    'narcotics_recovery_status_v1': 'narcotics_recovery_v1.status(p_request)',
}
ENGINEERING_APIS = {
    'narcotics_recovery_probe_permissions_v1': 'narcotics_register_v1.probe_recovery_permission(p_request)',
    'narcotics_recovery_probe_boundary_v1': 'narcotics_recovery_v1.probe_boundary(p_request)',
    'narcotics_recovery_probe_state_v1': 'narcotics_recovery_v1.probe_state(p_request)',
    'narcotics_recovery_probe_gate_v1': 'narcotics_recovery_v1.probe_gate(p_request)',
}
ENGINEERING_PRIVATE = {'narcotics_register_v1.probe_recovery_permission', 'narcotics_recovery_v1.probe_boundary',
                       'narcotics_recovery_v1.probe_state', 'narcotics_recovery_v1.probe_gate'}
HOOK = 'narcotics_recovery_admission_v1'
LEAVES = {
    'narcotics_register_v1.enter_register()': ('plpgsql', 'v', 'void'),
    'narcotics_register_v1.require_module()': ('plpgsql', 'v', 'void'),
    'narcotics_register_v1.module_properties(text,text,text,text)': ('plpgsql', 's', 'jsonb'),
    'narcotics_register_v1.hash(text,jsonb)': ('sql', 'i', 'text'),
    'narcotics_recovery_v1.enter_recovery()': ('plpgsql', 'v', 'void'),
    'narcotics_recovery_v1.require_head()': ('plpgsql', 'v', 'jsonb'),
}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def functions(sql):
    result = {}
    for statement in split_reviewed_statements(sql):
        header = re.match(r'^CREATE(?: OR REPLACE)? FUNCTION ([a-z0-9_]+)\.([a-z0-9_]+)\(([^)]*)\)', statement, re.I)
        if not header:
            continue
        types = []
        for parameter in header[3].split(',') if header[3].strip() else []:
            parsed = re.fullmatch(r'\s*[a-z0-9_]+\s+([a-z0-9_.]+(?:\[\])?)\s*', parameter, re.I)
            if not parsed:
                raise ValueError('Closed source parameter grammar required')
            types.append(parsed[1])
        signature = header[1] + '.' + header[2] + '(' + ','.join(types) + ')'
        body = re.search(r'\bAS\s+(\$[a-zA-Z0-9_]*\$)(.*?)\1\s*;?$', statement, re.I | re.S)
        if not body or signature in result:
            raise ValueError('Exactly one bounded source body per signature required')
        result[signature] = {'statement': statement, 'body': body[2], 'schema': header[1], 'name': header[2]}
    return result


def terminal_count_copy():
    sql = (ROOT / 'supabase/migrations/20261027223544_narcotics_count_and_stock_workflows.sql').read_text()
    selected = [statement for statement in split_reviewed_statements(sql)
        if re.match(r'^CREATE(?: OR REPLACE)? FUNCTION public\.read_controlled_count_v1\(', statement, re.I)]
    if len(selected) != 1:
        raise ValueError('Exactly one original public count READ required')
    original = functions(selected[0] + ';')['public.read_controlled_count_v1(jsonb)']
    wanted = json.loads((HERE / 'module-expected.json').read_text())['properties']['functions']['public.read_controlled_count_v1(jsonb)']['body_sha256']
    if sha(original['body'].encode()) != wanted:
        raise ValueError('Independently source-bound count READ body required')
    check = ' perform controlled_count_entry_v1.require_bound_module();'
    if original['body'].count(check) != 1:
        raise ValueError('Exactly one redundant outer module check required')
    body = original['body'].replace(check, '', 1)
    # The exact original full metadata check lives in this facade's admission.
    position = original['body'].index(check)
    if body[:position] + check + body[position:] != original['body']:
        raise ValueError('Whole original count READ body inverse failed')
    program = '''CREATE FUNCTION narcotics_register_v1.read_terminal_count(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public,controlled_count_v1,controlled_count_entry_v1,pg_temp
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3 AS $$''' + body + '$$;\n'
    return program, {'original_body_sha256': wanted, 'copy_body_sha256': sha(body.encode()),
        'whole_body_inverse': True, 'only_removed_statement': check, 'current_authorization_and_projector_unchanged': True}


def recovery_boundary_copy():
    sql = (ROOT / 'supabase/migrations/20261027223544_narcotics_count_and_stock_workflows.sql').read_text()
    selected = [statement for statement in split_reviewed_statements(sql)
                if re.match(r'^CREATE(?: OR REPLACE)? FUNCTION controlled_count_v1\.capture_full_boundary\(', statement, re.I)]
    if len(selected) != 1:
        raise ValueError('Exactly one original complete physical collector required')
    signature = 'controlled_count_v1.capture_full_boundary(uuid,uuid)'
    original = functions(selected[0] + ';')[signature]['body']
    wanted = json.loads((HERE / 'module-expected.json').read_text())['properties']['functions'][signature]['body_sha256']
    if sha(original.encode()) != wanted:
        raise ValueError('Independent current physical collector source binding required')
    before = 'perform controlled_count_entry_v1.assert_capture_frontier(p_product,p_site);'
    after = 'perform narcotics_recovery_v1.capture_guard(p_product,p_site);'
    if original.count(before) != 2 or after in original:
        raise ValueError('Both exact original collector guards required')
    body = original.replace(before, after)
    if body.replace(after, before) != original or body.count("boundary_value:=boundary_value||jsonb_build_object(") != 50:
        raise ValueError('Whole PB50 source inverse and all fifty classes required')
    program = '''CREATE FUNCTION narcotics_recovery_v1.capture_full_boundary(p_product uuid,p_site uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,controlled_count_v1,pg_temp
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3 AS $$''' + body + '$$;\n'
    return program, dict(original_body_sha256=wanted, copy_body_sha256=sha(body.encode()),
                         whole_body_inverse=True, replaced_guards=2, physical_classes=50,
                         all_original_columns_caps_and_historical_validation_retained=True)


def cold_admission(all_functions):
    rows = []
    for signature, (language, volatility, result) in LEAVES.items():
        value = all_functions[signature]
        rows.append('(' + ','.join(map(literal, (signature, sha(value['body'].encode()), language, volatility, result))) + ')')
    return '''
 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_v1','narcotics_recovery_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_v1','narcotics_recovery_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
''' + ',\n'.join(rows) + ''') SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
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
'''


def facade(name, call, admission, engineering=False):
    declaration = 'DECLARE diagnostic_context text;\n' if engineering else ''
    handler = """EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';"""
    if engineering:
        handler = """EXCEPTION WHEN OTHERS OR query_canceled OR assert_failure THEN
 GET STACKED DIAGNOSTICS diagnostic_context=PG_EXCEPTION_CONTEXT;
 RAISE EXCEPTION USING ERRCODE=SQLSTATE,MESSAGE=SQLERRM,DETAIL=diagnostic_context,HINT='';"""
    return 'CREATE FUNCTION public.' + name + """(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
""" + declaration + 'BEGIN\n' + admission + '\n RETURN ' + call + ';\n' + handler + '\nEND $$;\n'


def table_controls(program):
    result = []
    for statement in split_reviewed_statements(program):
        match = re.match(r'^CREATE TABLE (narcotics_(?:register|recovery)_v1)\.([a-z0-9_]+)\s*\(', statement, re.I)
        if not match:
            continue
        table = match[1] + '.' + match[2]
        result += ['ALTER TABLE ' + table + ' OWNER TO postgres;', 'ALTER TABLE ' + table + ' ENABLE ROW LEVEL SECURITY;',
            'REVOKE ALL ON TABLE ' + table + ' FROM PUBLIC,anon,authenticated,service_role;',
            'CREATE TRIGGER history_immutable BEFORE UPDATE OR DELETE ON ' + table + ' FOR EACH ROW EXECUTE FUNCTION narcotics_register_v1.reject_history_change();',
            'CREATE TRIGGER no_truncate BEFORE TRUNCATE ON ' + table + ' FOR EACH STATEMENT EXECUTE FUNCTION narcotics_register_v1.reject_history_change();']
    return '\n'.join(result) + '\n'


def build(register_only=False):
    apis = {**REGISTER_APIS, **RECOVERY_APIS}
    if register_only:
        apis.update(ENGINEERING_APIS)
    names = ('common.sql', 'register.sql', 'register-operations.sql', 'recovery-state.sql',
             'recovery-operations.sql', 'recovery-inventory.sql', 'recovery-coordinator.sql',
             'recovery-evidence.sql', 'recovery-release.sql', 'recovery-status.sql', 'metadata.sql')
    sources = {name: (SOURCE / name).read_bytes() for name in names}
    # Keep the reflective leaf byte-identical across source modes. Its closed
    # name set also detects any forbidden engineering facade added to a release.
    public_names = 'ARRAY[' + ','.join(literal(name) for name in sorted((*REGISTER_APIS, *RECOVERY_APIS, *ENGINEERING_APIS, HOOK))) + ']::text[]'
    private = '\n'.join(raw.decode().replace('__PUBLIC_FACADE_NAMES__', public_names) for raw in sources.values())
    copied, copy_proof = terminal_count_copy()
    private += '\n' + copied
    boundary_sql, boundary_proof = recovery_boundary_copy()
    private += '\n' + boundary_sql + '''
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
CREATE FUNCTION narcotics_recovery_v1.probe_boundary(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actor_value uuid;product_value uuid;site_value uuid;boundary_value jsonb;boundary_text text;authority_value jsonb;
BEGIN
 PERFORM narcotics_register_v1.keys(p_request,ARRAY['schema_version','actor_id','product_id','site_id']);
 IF(p_request->'schema_version')::text IS DISTINCT FROM'1' THEN RAISE EXCEPTION 'narcotics_request_invalid';END IF;
 actor_value:=narcotics_register_v1.uuid_value(p_request->'actor_id');
 product_value:=narcotics_register_v1.uuid_value(p_request->'product_id');site_value:=narcotics_register_v1.uuid_value(p_request->'site_id');
 authority_value:=narcotics_register_v1.authority(actor_value,product_value,site_value);
 PERFORM public.controlled_stock_product_gate(actor_value,product_value);
 boundary_value:=narcotics_recovery_v1.capture_full_boundary(product_value,site_value);boundary_text:=boundary_value::text;
 IF(SELECT count(*)FROM jsonb_object_keys(boundary_value))<>50 OR
  narcotics_register_v1.authority(actor_value,product_value,site_value)IS DISTINCT FROM authority_value THEN
 RAISE EXCEPTION 'narcotics_recovery_boundary_invalid';END IF;
 RETURN jsonb_build_object('engineering_only',true,'physical_classes',50,'boundary_sha256',encode(sha256(convert_to(boundary_text,'UTF8')),'hex'),'utf8_bytes',octet_length(boundary_text));
END $$;
'''
    private += '''
CREATE FUNCTION narcotics_recovery_v1.probe_gate(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actor_value uuid;head_value jsonb;action_value text;id_value uuid;hash_value text;
BEGIN
 PERFORM narcotics_register_v1.keys(p_request,ARRAY['schema_version','actor_id','action','expected_head_id','expected_head_hash']);
 IF(p_request->'schema_version')::text IS DISTINCT FROM'1'OR jsonb_typeof(p_request->'action')IS DISTINCT FROM'string'THEN RAISE EXCEPTION 'narcotics_request_invalid';END IF;
 actor_value:=narcotics_register_v1.uuid_value(p_request->'actor_id');PERFORM narcotics_register_v1.identity(actor_value,true);
 action_value:=p_request->>'action';head_value:=narcotics_recovery_v1.require_head();
 IF action_value='status'THEN
  IF p_request->'expected_head_id'IS DISTINCT FROM'null'::jsonb OR p_request->'expected_head_hash'IS DISTINCT FROM'null'::jsonb THEN RAISE EXCEPTION 'narcotics_request_invalid';END IF;
 ELSE
  id_value:=narcotics_register_v1.uuid_value(p_request->'expected_head_id');
  hash_value:=p_request->>'expected_head_hash';
  IF jsonb_typeof(p_request->'expected_head_hash')IS DISTINCT FROM'string'OR hash_value!~'^[0-9a-f]{64}$'THEN RAISE EXCEPTION 'narcotics_request_invalid';END IF;
  IF action_value NOT IN ('arm','resume')THEN RAISE EXCEPTION 'narcotics_request_invalid';END IF;
  head_value:=narcotics_recovery_v1.append_head(CASE action_value WHEN'arm'THEN'armed'ELSE'source_resumed'END,gen_random_uuid(),actor_value,
   jsonb_build_object('engineering_only',true,'basis','owned_no_hook_gate_probe'),id_value,hash_value);
 END IF;
 RETURN jsonb_build_object('engineering_only',true,'head_id',head_value->'head_id','head_hash',head_value->'record_hash','mode',head_value->'mode',
  'request_method',current_setting('request.method',true),'request_path',current_setting('request.path',true));
END $$;
'''
    private += '''
CREATE FUNCTION narcotics_recovery_v1.probe_state(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actor_value uuid;before_value jsonb;armed_value jsonb;epoch_value jsonb;released_value jsonb;after_value jsonb;stale_refused boolean:=false;
BEGIN
 PERFORM narcotics_register_v1.keys(p_request,ARRAY['schema_version','actor_id']);
 IF(p_request->'schema_version')::text IS DISTINCT FROM'1' THEN RAISE EXCEPTION 'narcotics_request_invalid';END IF;
 actor_value:=narcotics_register_v1.uuid_value(p_request->'actor_id');PERFORM narcotics_register_v1.identity(actor_value,true);
 before_value:=narcotics_recovery_v1.require_head();
 BEGIN
  armed_value:=narcotics_recovery_v1.append_head('armed',gen_random_uuid(),actor_value,'{"engineering_only":true}'::jsonb,(before_value->>'head_id')::uuid,before_value->>'record_hash');
  BEGIN
   PERFORM narcotics_recovery_v1.append_head('source_resumed',gen_random_uuid(),actor_value,'{}'::jsonb,(before_value->>'head_id')::uuid,before_value->>'record_hash');
  EXCEPTION WHEN SQLSTATE'PT409'THEN stale_refused:=true;END;
  epoch_value:=narcotics_recovery_v1.append_head('epoch_started',gen_random_uuid(),actor_value,'{"engineering_only":true}'::jsonb,(armed_value->>'head_id')::uuid,armed_value->>'record_hash');
  released_value:=narcotics_recovery_v1.append_head('released',gen_random_uuid(),actor_value,'{"engineering_only":true}'::jsonb,(epoch_value->>'head_id')::uuid,epoch_value->>'record_hash');
  IF stale_refused IS NOT TRUE OR armed_value->>'mode'<>'armed'OR epoch_value->'arm_id'IS DISTINCT FROM armed_value->'arm_id'
   OR epoch_value->'epoch_id'IS DISTINCT FROM epoch_value->'head_id'OR released_value->>'mode'<>'idle'THEN
   RAISE EXCEPTION 'owned_recovery_state_probe_failed';END IF;
  RAISE EXCEPTION 'owned_state_probe_rollback' USING ERRCODE='PZ001';
 EXCEPTION WHEN SQLSTATE'PZ001'THEN NULL;END;
 after_value:=narcotics_recovery_v1.require_head();
 IF before_value IS DISTINCT FROM after_value THEN RAISE EXCEPTION 'owned_recovery_state_probe_did_not_rollback';END IF;
 RETURN jsonb_build_object('engineering_only',true,'actual_Auth_head_transitions',true,'stale_head_refused',stale_refused,'audit_and_catalog_rolled_back',true);
END $$;
'''
    # Engineering-only: real Auth exercises owned-schema comment permissions;
    # an exception subtransaction rolls back the exact harmless probe comment.
    # This cannot change the durable recovery mode or grant release acceptance.
    private += '''
CREATE FUNCTION narcotics_register_v1.probe_recovery_permission(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actor_value uuid;before_value jsonb;after_value jsonb;observed boolean:=false;attributes jsonb;
BEGIN
 PERFORM narcotics_register_v1.keys(p_request,ARRAY['schema_version','actor_id']);
 IF(p_request->'schema_version')::text IS DISTINCT FROM'1' THEN RAISE EXCEPTION 'narcotics_request_invalid';END IF;
 actor_value:=narcotics_register_v1.uuid_value(p_request->'actor_id');
 PERFORM narcotics_register_v1.identity(actor_value,true);
 SELECT to_jsonb(d.description)INTO before_value FROM pg_namespace n LEFT JOIN pg_description d ON d.objoid=n.oid AND d.classoid='pg_namespace'::regclass AND d.objsubid=0 WHERE n.nspname='narcotics_recovery_v1';
 SELECT jsonb_build_object('superuser',r.rolsuper,'createrole',r.rolcreaterole,'can_login',r.rolcanlogin)INTO STRICT attributes FROM pg_roles r WHERE r.rolname='postgres';
 BEGIN
  COMMENT ON SCHEMA narcotics_recovery_v1 IS 'owned_engineering_probe';
  observed:=EXISTS(SELECT 1 FROM pg_namespace n JOIN pg_description d ON d.objoid=n.oid AND d.classoid='pg_namespace'::regclass AND d.objsubid=0 WHERE n.nspname='narcotics_recovery_v1'AND n.nspowner='postgres'::regrole AND d.description='owned_engineering_probe');
  RAISE EXCEPTION 'owned_probe_rollback' USING ERRCODE='PZ001';
 EXCEPTION WHEN SQLSTATE'PZ001' THEN NULL;END;
 SELECT to_jsonb(d.description)INTO after_value FROM pg_namespace n LEFT JOIN pg_description d ON d.objoid=n.oid AND d.classoid='pg_namespace'::regclass AND d.objsubid=0 WHERE n.nspname='narcotics_recovery_v1';
 IF observed IS NOT TRUE OR before_value IS DISTINCT FROM after_value THEN RAISE EXCEPTION 'owned_probe_did_not_rollback';END IF;
 RETURN jsonb_build_object('engineering_only',true,'actual_authenticated_owned_schema_comment',true,'catalog_unchanged_after_rollback',true,'postgres_attributes',attributes);
END $$;
'''
    if not register_only:
        retained=[];removed=set()
        for statement in split_reviewed_statements(private):
            match=re.match(r'^CREATE FUNCTION ([a-z0-9_]+\.[a-z0-9_]+)\(',statement,re.I)
            if match and match[1] in ENGINEERING_PRIVATE:
                if match[1] in removed:raise ValueError('Unique engineering helper required')
                removed.add(match[1])
            else:retained.append(statement+';')
        if removed!=ENGINEERING_PRIVATE:raise ValueError('All four engineering helpers must be omitted from release source')
        private='\n'.join(retained)+'\n'
    admission = cold_admission(functions(private))
    actual = private + '\n' + '\n'.join(facade(name, call,
        admission.replace('PERFORM narcotics_register_v1.enter_register();', 'PERFORM narcotics_recovery_v1.enter_recovery();')
        if name in RECOVERY_APIS or name in ('narcotics_recovery_probe_state_v1','narcotics_recovery_probe_gate_v1') else admission, engineering=register_only) for name, call in apis.items())
    # Acyclic source derivation: the pure compiler needs only final LEAF bodies
    # (including the fixed public-name inventory), never the assembled hook.
    import recovery_admission_source
    guard = recovery_admission_source.derive_from_private(functions(private), {'sql': {'sha256': sha(private.encode())}})
    hook_seal = recovery_admission_source.seal(functions(guard['sql']), ['controlled_count_entry_v1.admit_recovery_request()'])
    actual += 'CREATE FUNCTION public.' + HOOK + '''() RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
BEGIN
 IF session_user<>'authenticator'OR current_setting('role')NOT IN ('anon','authenticated','service_role')THEN
 RAISE EXCEPTION 'narcotics_access_denied' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
''' + hook_seal + '''
 PERFORM controlled_count_entry_v1.admit_recovery_request();
END $$;
'''
    actual += table_controls(actual)
    definitions = functions(actual)
    for signature in definitions:
        actual += 'ALTER FUNCTION ' + signature + ' OWNER TO postgres;\nREVOKE ALL ON FUNCTION ' + signature + ' FROM PUBLIC,anon,authenticated,service_role;\n'
    for name in apis:
        actual += 'GRANT EXECUTE ON FUNCTION public.' + name + '(jsonb) TO authenticated;\n'
    actual += 'GRANT EXECUTE ON FUNCTION public.' + HOOK + '() TO anon,authenticated,service_role;\n'
    reference = actual.replace(REGISTER + '.', REFERENCE_REGISTER + '.').replace(RECOVERY + '.', REFERENCE_RECOVERY + '.')
    # Schema literals in reflective helper bodies are normalized by its explicit
    # canonical parameters. Source namespace identifiers are changed everywhere.
    reference = reference.replace("'" + REGISTER + "'", "'" + REFERENCE_REGISTER + "'").replace("'" + RECOVERY + "'", "'" + REFERENCE_RECOVERY + "'")
    reference = reference.replace('SCHEMA ' + REGISTER + ' ', 'SCHEMA ' + REFERENCE_REGISTER + ' ').replace('SCHEMA ' + RECOVERY + ' ', 'SCHEMA ' + REFERENCE_RECOVERY + ' ')
    reference = reference.replace('SCHEMA ' + REGISTER + ',' + RECOVERY, 'SCHEMA ' + REFERENCE_REGISTER + ',' + REFERENCE_RECOVERY)
    # Only statement headers and grants target the private copies of facades.
    # Literal public callback names inside function bodies remain unchanged.
    chunks = []
    for statement in split_reviewed_statements(reference):
        for name in (*apis, HOOK):
            statement = re.sub(r'^(CREATE FUNCTION|ALTER FUNCTION|REVOKE ALL ON FUNCTION|GRANT EXECUTE ON FUNCTION) public\.' + re.escape(name) + r'\(', r'\1 ' + REFERENCE_REGISTER + '.' + name + '(', statement)
        chunks.append(statement + ';')
    reference = '\n'.join(chunks) + '\n'
    tail = '''DO $operational_source$DECLARE expected jsonb;actual jsonb;differences jsonb;BEGIN
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
'''
    prefix = "SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';SET LOCAL client_min_messages='warning';SET LOCAL quote_all_identifiers=false;SET LOCAL TimeZone='UTC';SET LOCAL DateStyle='ISO,YMD';SET LOCAL IntervalStyle='postgres';SET LOCAL extra_float_digits=3;\nSELECT pg_advisory_xact_lock(90271190,0);\nSELECT pg_advisory_xact_lock(90271040,0);\nDO $operational_parent$BEGIN PERFORM controlled_count_entry_v1.require_bound_module();END $operational_parent$;\n"
    sql = prefix + actual + reference + tail
    proof = {'kind': 'narcotics-operational-source-v1', 'engineering_only': register_only, 'ready_for_deployment': False,
        'expected_metadata_origin': 'independent empty source reference DDL; no observed actual target expectations',
        'native_errors_engineering_only': register_only,
        'source_files': {name: {'bytes': len(raw), 'sha256': sha(raw)} for name, raw in sources.items()},
        'builder_sha256': sha(Path(__file__).read_bytes()), 'terminal_count_copy': copy_proof, 'recovery_boundary_copy': boundary_proof,
        'public_apis': sorted(apis), 'function_signatures': sorted(definitions),
        'sql': {'bytes': len(sql.encode()), 'sha256': sha(sql.encode())}}
    return sql, proof


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    mode=parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--register-only-engineering', action='store_true')
    mode.add_argument('--release-source', action='store_true')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not args.output.is_absolute() or args.output.exists():
        parser.error('Explicit source mode and fresh absolute output directory required')
    sql, proof = build(register_only=args.register_only_engineering)
    args.output.mkdir(mode=0o700)
    (args.output / 'install.sql').write_text(sql)
    (args.output / 'source-proof.json').write_text(json.dumps(proof, sort_keys=True, indent=2) + '\n')
    print(json.dumps({'engineering_only': args.register_only_engineering, 'database_operations': 0, 'sql': proof['sql'], 'public_apis': proof['public_apis']}))
