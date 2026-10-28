"""Prospective208 recovery admission, derived from independent209 source bodies.

This only returns source. It installs nothing and cannot grant acceptance.
"""
from pathlib import Path
import hashlib
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import build_operational_module as operational


CONTROL = (
    'narcotics_recovery_preflight_v1', 'narcotics_recovery_backup_prepare_v1', 'narcotics_recovery_read_evidence_v1',
    'narcotics_recovery_arm_v1', 'narcotics_recovery_source_resume_v1',
    'narcotics_recovery_begin_epoch_v1', 'narcotics_recovery_start_count_v1',
    'narcotics_recovery_preserve_evidence_v1', 'narcotics_recovery_acknowledge_evidence_v1',
    'narcotics_recovery_release_v1', 'narcotics_recovery_read_operation_v1',
    'narcotics_recovery_close_operation_v1', 'narcotics_recovery_status_v1',
    'narcotics_recovery_probe_state_v1',
    'narcotics_recovery_probe_gate_v1',
)
ARMED_POST = CONTROL + (
    'list_controlled_count_scopes_v1', 'discover_controlled_counts_v1',
    'read_controlled_count_policy_v1', 'read_controlled_count_v1',
    'save_controlled_count_statement_v1', 'finalize_controlled_count_v1',
    'recover_controlled_count_operation_v1', 'read_controlled_count_operation_closure_v1',
    'read_controlled_count_operation_closure_v2', 'close_controlled_count_operation_v1',
    'close_controlled_count_operation_v2', 'cancel_controlled_count_v1',
    'discover_controlled_count_causes_v1', 'list_controlled_count_investigations_v1',
    'list_controlled_count_reconciliations_v1', 'read_controlled_count_reconciliation_detail_v1',
    'read_controlled_count_reconciliation_v1', 'prepare_controlled_count_reconciliation_v1',
    'approve_controlled_count_reconciliation_v1', 'execute_controlled_count_reconciliation_v1',
    'confirm_controlled_count_reconciliation_v1', 'resolve_controlled_count_cause_v1',
    'list_controlled_record_reviews_v3', 'get_controlled_record_review_event_v3',
    'prepare_controlled_record_review_v3', 'read_controlled_record_review_v3', 'execute_controlled_record_review_v3',
    *tuple(operational.REGISTER_APIS),
)
EPOCH_POST = ('narcotics_recovery_start_count_v1', 'execute_controlled_count_reconciliation_v1')


def paths(names):
    if len(set(names)) != len(names):
        raise ValueError('Unique closed recovery route inventory required')
    return 'ARRAY[' + ','.join(operational.literal('/rpc/' + name) for name in names) + ']::text[]'


def seal(definitions, signatures):
    """Catalog-only prosrc/attribute/ACL validation before a private call."""
    rows = []
    for signature in signatures:
        definition = definitions[signature]
        result = 'jsonb' if signature.endswith('recovery_catalog_projection()') else 'void'
        rows.append('(' + ','.join(operational.literal(value) for value in
                    (signature, operational.sha(definition['body'].encode()), result)) + ')')
    return '''
 IF EXISTS(WITH expected(signature,body_hash,result_type)AS(VALUES
''' + ',\n'.join(rows) + ''')SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef
 OR p.prokind<>'f'OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u'OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargs<>0 OR p.proargnames IS NOT NULL OR p.proallargtypes IS NOT NULL OR p.proargmodes IS NOT NULL
 OR p.pronargdefaults<>0 OR p.proargdefaults IS NOT NULL OR p.prosqlbody IS NOT NULL OR p.probin IS NOT NULL
 OR p.procost<>100 OR p.prorows<>0 OR l.lanname<>'plpgsql'OR p.provolatile<>'v'
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(VALUES('anon'),('authenticated'),('service_role'))recovery_sealed_role(role_name)WHERE has_function_privilege(recovery_sealed_role.role_name,p.oid,'EXECUTE')))THEN
 RAISE EXCEPTION 'narcotics_recovery_source_invalid' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
'''


def create(name, body, result='void'):
    return 'CREATE FUNCTION controlled_count_entry_v1.' + name + '() RETURNS ' + result + '''
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
''' + body + '$$;\n'


def derive():
    program, source_proof = operational.build(register_only=True)
    # The source framer deliberately refuses client_min_messages in the
    # installation prefix. Reflection needs only the following source DDL.
    private = operational.functions(program[program.index('CREATE SCHEMA '):program.index('CREATE SCHEMA narcotics_register_reference_v1 ')])
    return derive_from_private(private, source_proof)


def derive_from_private(private, source_proof):
    """Pure source derivation; also used by209 assembly without calling build."""
    original = private['narcotics_recovery_v1.catalog_projection()']['body']
    anchor = '\nBEGIN\n'
    if original.count(anchor) != 1:
        raise ValueError('Exact catalog-only recovery projection source required')
    getter_body = original.replace(anchor, anchor + " IF NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='narcotics_recovery_v1')THEN RETURN NULL;END IF;\n", 1)
    if getter_body.replace(" IF NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='narcotics_recovery_v1')THEN RETURN NULL;END IF;\n", '', 1) != original:
        raise ValueError('Whole catalog projection inverse required')
    getter = create('recovery_catalog_projection', getter_body, 'jsonb')
    getter_definitions = operational.functions(getter)
    admission = create('admit_recovery_request', '''DECLARE projection jsonb;method_value text:=current_setting('request.method',true);path_value text:=current_setting('request.path',true);control_value boolean;
BEGIN
 IF session_user<>'authenticator'OR current_user<>'postgres'OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed'THEN RAISE EXCEPTION 'narcotics_recovery_origin_invalid' USING ERRCODE='42501';END IF;
''' + seal(getter_definitions, ['controlled_count_entry_v1.recovery_catalog_projection()']) + '''
 control_value:=coalesce(method_value='POST'AND path_value=ANY(''' + paths(CONTROL) + '''),false);
 IF control_value THEN
  IF EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=pg_backend_pid()AND l.locktype='advisory'AND l.granted
   AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database())AND l.classid=90271190::oid AND l.objid=0::oid AND l.objsubid=2 AND l.mode='ShareLock')
  AND NOT EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=pg_backend_pid()AND l.locktype='advisory'AND l.granted
   AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database())AND l.classid=90271190::oid AND l.objid=0::oid AND l.objsubid=2 AND l.mode='ExclusiveLock')THEN
   RAISE EXCEPTION 'narcotics_recovery_admission_upgrade' USING ERRCODE='42501';END IF;
  PERFORM pg_advisory_xact_lock(90271190,0);
 ELSE PERFORM pg_advisory_xact_lock_shared(90271190,0);END IF;
 -- A separate VOLATILE command after the wait observes the committed mode.
 projection:=controlled_count_entry_v1.recovery_catalog_projection();
 IF projection IS NULL THEN RETURN;END IF;
 IF projection->>'mode'='idle'THEN RETURN;END IF;
 IF method_value IN ('GET','HEAD')AND current_setting('transaction_read_only')='on'THEN RETURN;END IF;
 -- Source backup mode cannot execute a physical reconciliation. The genuine
 -- restored-server epoch must exist before those restricted stock writes.
 IF method_value='POST'AND path_value=ANY(''' + paths(EPOCH_POST) + ''')AND projection->'epoch_id'='null'::jsonb THEN
  RAISE EXCEPTION 'narcotics_recovery_epoch_required' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF method_value='POST'AND path_value=ANY(''' + paths(ARMED_POST) + ''')THEN RETURN;END IF;
 RAISE EXCEPTION 'narcotics_recovery_write_held' USING ERRCODE='42501',DETAIL='',HINT='';
END''')
    cold = operational.cold_admission(private)
    call = 'PERFORM narcotics_register_v1.enter_register();'
    if cold.count(call) != 1:
        raise ValueError('Exact cold metadata boundary required')
    post = create('recovery_post_frontier_required', '''BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='narcotics_recovery_v1')THEN RETURN;END IF;
 -- Complete parent source validation precedes the first own descriptor/audit read.
 PERFORM controlled_count_entry_v1.require_bound_module();
''' + cold.replace(call, 'PERFORM narcotics_recovery_v1.require_head();') + '\nEND')
    definitions = operational.functions(getter + admission + post)
    enter = seal(definitions, ['controlled_count_entry_v1.admit_recovery_request()', 'controlled_count_entry_v1.recovery_post_frontier_required()'])
    enter += '\n PERFORM controlled_count_entry_v1.admit_recovery_request();\n'
    return dict(sql=getter + admission + post, entry_check=enter,
                post_check='PERFORM controlled_count_entry_v1.recovery_post_frontier_required();',
                proof=dict(engineering_only=True, register_source_sha256=source_proof['sql']['sha256'],
                           catalog_projection_original_sha256=hashlib.sha256(original.encode()).hexdigest(),
                           whole_catalog_projection_inverse=True,
                           pre_frontier_reads='catalogs and pg_locks only',
                           current_audit_validation='after complete original121 frontier',
                           armed_post_routes=list(ARMED_POST), exclusive_routes=list(CONTROL), epoch_required_post_routes=list(EPOCH_POST)))
