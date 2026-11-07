"""Disposable current211 native-error trace; never business/recovery acceptance.

Only the fixed execute wrapper's error fence and optional transaction-local
function profiling change. Its authored body and finite diagnostic
descriptor/admission expectations are independently derived;
original production SQL and historical evidence are never modified.
"""
from copy import deepcopy
import hashlib
import time

import beta_time_clock_source as clock_source
import diagnose_commissioning

SIGNATURE='public.execute_managed_stock_intent_v1(jsonb)'
API='execute_managed_stock_intent_v1'


class DiagnosticComplete(Exception):
    """A captured native failure, followed by normal unchanged owned cleanup."""


def bind(runtime, *, profile_functions=False):
    import beta_rehearsal as beta
    target=runtime.install
    if len(target.operational_ledger)!=211 or not target.result.get('complete_source_derived211_ledger'):
        raise ValueError('Trace requires the fully verified current211 source installation')
    raw=beta.installation.prefix.regular(beta.ROOT/'supabase/migrations'/beta.installation.prefix.FORWARD[1]).decode()
    changed=deepcopy(target.expected_module)
    original_hash=changed['properties']['functions'][SIGNATURE]['body_sha256']
    program,digest=diagnose_commissioning.instrument(raw,target.expected_module,SIGNATURE,'stock_entry_request_failed',False)
    old_fence="raise exception 'stock_entry_request_failed'using errcode='P0001',detail='',hint='';"
    new_fence="GET STACKED DIAGNOSTICS diagnostic_native_context = PG_EXCEPTION_CONTEXT;RAISE EXCEPTION USING ERRCODE=SQLSTATE,MESSAGE=SQLERRM,DETAIL=diagnostic_native_context,HINT='';"
    original_body=program.split(' AS $$',1)[1][:-3].replace('declare diagnostic_native_context text;q jsonb;','declare q jsonb;',1).replace(new_fence,old_fence,1)
    if hashlib.sha256(original_body.encode()).hexdigest()!=original_hash:
        raise ValueError('Whole original execute wrapper source inverse required')
    if profile_functions:
        original_program=program
        begin_anchor="begin\n perform controlled_stock_workflow_v1.managed_entry_frontier();"
        begin_profile="begin\n perform pg_catalog.set_config('track_functions','all',true);\n perform controlled_stock_workflow_v1.managed_entry_frontier();"
        finish_anchor="return controlled_stock_workflow_v1.finish_managed_entry((q->>'actor_id')::uuid,a,r);"
        finish_profile="r:=controlled_stock_workflow_v1.finish_managed_entry((q->>'actor_id')::uuid,a,r);perform pg_catalog.pg_stat_force_next_flush();return r;"
        failure_profile=new_fence.replace("RAISE EXCEPTION USING", "PERFORM pg_catalog.pg_stat_force_next_flush();RAISE EXCEPTION USING",1)
        pairs=((begin_anchor,begin_profile),(finish_anchor,finish_profile),(new_fence,failure_profile))
        for old,new in pairs:
            if program.count(old)!=1:raise ValueError('Exact fixed profiling source anchor required')
            program=program.replace(old,new,1)
        inverse=program
        for old,new in reversed(pairs):inverse=inverse.replace(new,old,1)
        if inverse!=original_program:raise ValueError('Whole profiling wrapper source inverse required')
        digest=hashlib.sha256(program.split(' AS $$',1)[1][:-3].encode()).hexdigest()
        target.boot.sql("GRANT SET ON PARAMETER track_functions TO postgres;"
            "GRANT EXECUTE ON FUNCTION pg_catalog.pg_stat_force_next_flush() TO postgres;",admin=True)
        permissions=runtime.selected_query('engineering-only-function-profiling-permission',
            "SELECT jsonb_build_object('track_functions',has_parameter_privilege('postgres','track_functions','SET'),"
            "'flush',has_function_privilege('postgres','pg_catalog.pg_stat_force_next_flush()','EXECUTE'));")
        if permissions!={'track_functions':True,'flush':True}:
            raise ValueError('Owned engineering profiling permission not established')
    changed['properties']['functions'][SIGNATURE]['body_sha256']=digest
    require_hash=beta.installation.decode(beta.installation.prefix.regular(beta.HERE/'beta-time-clock-source-proof.json'))['successor_require_bound_body_sha256']
    projected=clock_source.admission_properties(changed['properties'],require_hash)
    old=clock_source.literal(beta.installation.canonical(target.expected_module))+'::jsonb'
    new=clock_source.literal(beta.installation.canonical(changed))+'::jsonb'
    expected=clock_source.literal(beta.installation.canonical(projected))+'::jsonb'
    sql="""BEGIN;SET LOCAL statement_timeout='8s';SET LOCAL lock_timeout='5s';
"""+program+"""
ALTER TABLE controlled_count_v1.descriptor DISABLE TRIGGER count_history_immutable;
ALTER TABLE beta_time_clock_v1.admission DISABLE TRIGGER immutable_admission;
DO $engineering_binding$DECLARE old_hash text;changed_rows integer;BEGIN
 SELECT definition_hash INTO STRICT old_hash FROM controlled_count_v1.descriptor WHERE revision=1 AND definition="""+old+""";
 UPDATE controlled_count_v1.descriptor SET definition="""+new+""",definition_hash=encode(sha256(convert_to(jsonb_build_object(
 'domain','lrv.count.local_fixture.module.v1','definition',"""+new+""")::text,'UTF8')),'hex') WHERE revision=1 AND definition="""+old+""";
 GET DIAGNOSTICS changed_rows=ROW_COUNT;
 IF changed_rows<>1 THEN RAISE EXCEPTION 'engineering_descriptor_binding_refused';END IF;
 UPDATE beta_time_clock_v1.admission SET original_descriptor_hash=(SELECT definition_hash FROM controlled_count_v1.descriptor WHERE revision=1),
 expected_properties="""+expected+""",expected_properties_hash=encode(sha256(convert_to(("""+expected+""")::text,'UTF8')),'hex')
 WHERE revision=1 AND original_descriptor_hash=old_hash AND require_bound_body_hash="""+clock_source.literal(require_hash)+""";
 GET DIAGNOSTICS changed_rows=ROW_COUNT;
 IF changed_rows<>1 THEN RAISE EXCEPTION 'engineering_admission_binding_refused';END IF;
END $engineering_binding$;
ALTER TABLE controlled_count_v1.descriptor ENABLE TRIGGER count_history_immutable;
ALTER TABLE beta_time_clock_v1.admission ENABLE TRIGGER immutable_admission;
COMMIT;
"""
    runtime.raw_query('engineering-only-current211-execute-trace',sql)
    target.expected_module=changed
    runtime.verify_module('engineering-current211-source-derived-trace-binding')
    target.result.update(engineering_only=True,current211_normal_acceptance=False,
        diagnostic_function=SIGNATURE,diagnostic_function_body_sha256=digest)
    beta.business.save(target.evidence,'beta-recovery-diagnostic-source',dict(
        engineering_only=True,normal_acceptance=False,signature=SIGNATURE,
        original_body_sha256=original_hash,whole_wrapper_source_inverse=True,
        diagnostic_body_sha256=digest,source_derived_descriptor_and_finite_admission=True,
        production_SQL_changed=False,function_profiling_enabled=profile_functions,
        tracking_scope='transaction-local inside fixed RPC backend' if profile_functions else None))


class TimedHttp:
    """Observe the existing transport call without changing requests or deadlines."""
    def __init__(self,original,runtime):
        self.original=original;self.runtime=runtime

    def __getattr__(self,name):return getattr(self.original,name)

    def rpc(self,name,payload,user,expected=200):
        if name!=API:return self.original.rpc(name,payload,user,expected)
        started=time.monotonic()
        try:return self.original.rpc(name,payload,user,expected)
        finally:
            import beta_rehearsal as beta
            path=self.runtime.folder/'rpc-failure.json'
            if path.is_file():
                failure=beta.installation.decode(beta.installation.prefix.regular(path,2097152))
                if failure.get('rpc')==API:
                    beta.business.save(self.runtime.folder,'beta-recovery-native-trace',dict(
                        engineering_only=True,normal_acceptance=False,elapsed_seconds=time.monotonic()-started,
                        rpc=API,status=failure['status'],error=failure['error']))


def preserve_failure(target):
    import beta_rehearsal as beta
    path=target.evidence/'beta-recovery-native-trace.json'
    if not path.is_file():return False
    receipt=beta.installation.decode(beta.installation.prefix.regular(path,2097152))
    error=receipt.get('error',{})
    if (receipt.get('rpc')!=API or receipt.get('status')!=400
            or set(error)!={'code','details','hint','message'} or not error['details']):
        return False
    target.result.update(current211_native_error_captured=True,engineering_only=True,
        application_Auth_verified=False,business_profile_verified=False,count_business_verified=False,
        authenticated_browser_verified=False,populated_receiver_verified=False,current211_normal_acceptance=False)
    return True
