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
    original_family=beta.source_family(runtime,'engineering-original-family')
    original_canonical=target.expected_module_canonical_text
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
    # Transform the independently source-created raw reference, not the
    # installed descriptor. JSONB stays in PostgreSQL so 1.00 never becomes 1.0.
    canonical_delta=runtime.selected_query('engineering-source-wrapper-expectation',
        "SELECT jsonb_build_object('canonical_text',jsonb_set("+clock_source.literal(original_canonical)+"::jsonb,"
        "ARRAY['properties','functions',"+clock_source.literal(SIGNATURE)+",'body_sha256'],"
        "to_jsonb("+clock_source.literal(digest)+"::text),false)::text);")
    if (set(canonical_delta)!={'canonical_text'} or not isinstance(canonical_delta['canonical_text'],str)
            or beta.installation.decode(canonical_delta['canonical_text'])!=changed):
        raise ValueError('Exact source-owned diagnostic wrapper delta required')
    changed_canonical=canonical_delta['canonical_text']
    family=beta.derive_source_family(runtime,'engineering-wrapper-family',changed_canonical)
    if family['template_body']!=original_family['template_body']:
        raise ValueError('One unchanged source-owned diagnostic guard template required')
    sql="""BEGIN;SET LOCAL statement_timeout='8s';SET LOCAL lock_timeout='5s';
"""+program+'\n'+family['definition']+"""
ALTER TABLE controlled_count_v1.descriptor DISABLE TRIGGER count_history_immutable;
ALTER TABLE beta_time_clock_v1.admission DISABLE TRIGGER immutable_admission;
DO $engineering_binding$DECLARE old_hash text;changed_rows integer;expected jsonb;
 beta_old_canonical text:="""+clock_source.literal(original_canonical)+""";
 beta_new_definition jsonb:="""+clock_source.literal(changed_canonical)+"""::jsonb;
 beta_new_expectation text:="""+clock_source.literal(family['canonical_text'])+""";
 beta_template text:="""+clock_source.literal(family['template_body'])+""";
BEGIN
"""+clock_source.normalization_sql("beta_old_canonical::jsonb->'properties'")+"""
 IF encode(sha256(convert_to(expected::text,'UTF8')),'hex') IS DISTINCT FROM """+clock_source.literal(original_family['expected_hash'])+""" THEN
 RAISE EXCEPTION 'engineering_original_family_source_invalid';END IF;
 SELECT definition_hash INTO STRICT old_hash FROM controlled_count_v1.descriptor WHERE revision=1
 AND definition::text=beta_old_canonical
 AND definition_hash="""+clock_source.literal(original_family['original_descriptor_hash'])+""";
 UPDATE controlled_count_v1.descriptor SET definition=beta_new_definition,definition_hash=encode(sha256(convert_to(jsonb_build_object(
 'domain','lrv.count.local_fixture.module.v1','definition',beta_new_definition)::text,'UTF8')),'hex') WHERE revision=1
 AND definition::text=beta_old_canonical AND definition_hash=old_hash;
 GET DIAGNOSTICS changed_rows=ROW_COUNT;
 IF changed_rows<>1 THEN RAISE EXCEPTION 'engineering_descriptor_binding_refused';END IF;
 UPDATE beta_time_clock_v1.admission SET original_descriptor_hash=(SELECT definition_hash FROM controlled_count_v1.descriptor WHERE revision=1),
 canonical_expectation=beta_new_expectation,
 guard_template=beta_template,
 require_bound_body_hash="""+clock_source.literal(family['body_sha256'])+"""
 WHERE revision=1 AND original_descriptor_hash=old_hash
 AND canonical_expectation=expected::text
 AND guard_template=beta_template
 AND require_bound_body_hash="""+clock_source.literal(original_family['body_sha256'])+""";
 GET DIAGNOSTICS changed_rows=ROW_COUNT;
 IF changed_rows<>1 THEN RAISE EXCEPTION 'engineering_admission_binding_refused';END IF;
END $engineering_binding$;
ALTER TABLE controlled_count_v1.descriptor ENABLE TRIGGER count_history_immutable;
ALTER TABLE beta_time_clock_v1.admission ENABLE TRIGGER immutable_admission;
COMMIT;
"""
    runtime.raw_query('engineering-only-current211-execute-trace',sql)
    target.expected_module=changed
    target.expected_module_canonical_text=changed_canonical
    target.beta_source_family=(changed_canonical,family)
    runtime.verify_module('engineering-current211-source-derived-trace-binding')
    target.result.update(engineering_only=True,current211_normal_acceptance=False,
        diagnostic_function=SIGNATURE,diagnostic_function_body_sha256=digest)
    beta.business.save(target.evidence,'beta-recovery-diagnostic-source',dict(
        engineering_only=True,normal_acceptance=False,signature=SIGNATURE,
        original_body_sha256=original_hash,whole_wrapper_source_inverse=True,
        diagnostic_body_sha256=digest,source_derived_descriptor_and_finite_admission=True,
        guard_family_body_sha256=family['body_sha256'],
        source_expected_canonical_text_preserved=True,
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
