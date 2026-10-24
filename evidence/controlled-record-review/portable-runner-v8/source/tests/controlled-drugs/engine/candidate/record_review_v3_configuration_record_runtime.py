"""Fixed stored-record reference proposal. Private CLI is source-report only.

A separately reviewed canonical integration and complete executed-source freeze
must precede execute_integrated(). No live expected metadata, retries or roles.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import time
import traceback

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3] if HERE.name == 'candidate' else HERE.parents[2]
SOURCE = ROOT / 'tests/controlled-drugs/engine/candidate'
FIXTURE = ROOT / 'tmp/secondary-review-20261021/configuration-record-fixture-draft'
INVENTORY_SHA = 'a8e613e74d72dca2f2638aa2e0139659d6850a7ab13ddc980f987159b3344e23'
FIXTURE_MANIFEST_SHA = 'a94da4ad1b989f61f17537a0815e86bb15299e031274e071c9e6527cfab2499b'
EXPECTED_SHA = 'fec2ff871f064a124ae3a0fb5ba60e36b8b58dda1932393cd656c43cd68abd7d'
INSTALL_SHA = '22021a314fc196efa822a16ca30d25c7f9f6e70811703fe60eb747d92280d542'
REFERENCE_SECONDS = 600
FINAL_SECONDS = 60
EMERGENCY_SECONDS = 180
STREAM_LIMIT = 128 * 1024**2
BASELINE = ROOT / 'tmp/secondary-review-20261021/configuration-record-profile-integration/full634-source-map.json'
BASELINE_SHA = '9138f6415099ebab1081ebfe8f169b0f13aca8d06cb4c375cf1fffa737044b54'
TEST_FILES = ('test_record_review_v3_configuration_record_runtime_harness.py',
              'test_record_review_v3_configuration_record_session_harness.py')
LOCAL_FILES = ('record_review_v3_configuration_record_runtime.py',
               'record_review_v3_configuration_record_session.py')
TARGETS = {'validate_stored_configuration':'stored_configuration_invalid',
           'validate_configuration_record':'configuration_record_invalid',
           'configuration_record':'configuration_record_invalid',
           'validate_configuration_pair':'configuration_pair_invalid'}
PUBLIC = ('prepare_controlled_record_review_v3','read_controlled_record_review_v3',
          'execute_controlled_record_review_v3','cancel_controlled_record_review_v3',
          'get_controlled_record_review_event_v3','list_controlled_record_reviews_v3',
          'publish_controlled_review_configuration_v3','read_controlled_review_publication_v3',
          'get_controlled_review_configuration_v3','get_controlled_review_backlog_v3',
          'record_controlled_review_escalation_action_v3')
STUBS = tuple('public.'+n for n in PUBLIC) + tuple('controlled_review_v3.'+n for n in ('publish_administration','materialize_one','record_scan'))
PURE = tuple('controlled_review_v3.'+n for n in TARGETS) + ('controlled_review_v3.validate_calendar_observation','controlled_review_v3.validate_configuration')
ROLES = ('anon','authenticated','service_role')
ZONES = ('UTC','America/Denver','Asia/Kathmandu')
PHASE_NAMES = ('setup',) + tuple('render_%04d'%i for i in range(0,1788,64)) + tuple('decode_%04d'%i for i in range(0,1594,100)) + ('renderer_and_case_gate','capture_baseline') + tuple('success_%04d'%i for i in range(0,204,25)) + tuple('refusal_%04d'%i for i in range(0,1390,50)) + ('zone_00','zone_01','zone_02','stubs_and_guards','all_metadata_acl','role_anon','role_authenticated','role_service_role','final_inventory')
ZONE_CASES = tuple('positive/'+b+'/'+s for b in ('policy-enabled-first','policy-at','calendar-fold1') for s in ('D','R','Q','pair')) + ('primitive/D/version/fractional','primitive/R/version/fractional','primitive/Q/version-visible-fraction','primitive/pair/receipt-version-visible-fraction','timestamp/stored-policy/extra-fraction','timestamp/published/offset')


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def unique(pairs):
    result = {}
    for key, value in pairs:
        assert key not in result, 'Duplicate JSON key'
        result[key] = value
    return result


def exact(actual, expected):
    assert json.dumps(actual, sort_keys=True, separators=(',',':'), ensure_ascii=False) == json.dumps(expected, sort_keys=True, separators=(',',':'), ensure_ascii=False), 'Exact formal JSON value required'


def check_deadline(deadline):
    assert time.monotonic() < deadline, 'Stored-record absolute deadline exhausted'


def canonical_location():
    assert HERE == SOURCE and Path(__file__).name == LOCAL_FILES[0], 'Private draft cannot launch; full reviewed canonical integration required'
    for name in LOCAL_FILES:
        assert (SOURCE/name).is_file() and not (SOURCE/name).is_symlink()


def read_pinned(path, digest, limit=STREAM_LIMIT):
    assert path.is_file() and not path.is_symlink() and path.stat().st_size < limit
    raw = path.read_bytes()
    assert len(raw) < limit and sha(raw) == digest, 'Fixed source pin changed'
    return raw


def merge_inputs(*maps):
    result = {}
    for inputs in maps:
        for name, digest in inputs.items():
            assert isinstance(name,str) and not Path(name).is_absolute() and '..' not in Path(name).parts
            assert isinstance(digest,str) and len(digest)==64 and all(c in '0123456789abcdef' for c in digest)
            assert name not in result or result[name] == digest, 'Source binding collision'
            result[name] = digest
    return result


def regular_sources(inputs, root=ROOT, deadline=None):
    for name, digest in inputs.items():
        if deadline is not None: check_deadline(deadline)
        path = root/name
        assert not Path(name).is_absolute() and '..' not in Path(name).parts
        assert path.is_file() and not path.is_symlink()
        assert not any(p.is_symlink() for p in path.parents if p!=root and p.is_relative_to(root))
        assert sha(path.read_bytes()) == digest
        if deadline is not None: check_deadline(deadline)


def expected_outcomes(inventory):
    cases = inventory['case_inventory']
    assert isinstance(cases,list) and len(cases)==1594
    wanted = {}; successes = nulls = 0
    for case in cases:
        assert set(case)=={'id','function','argument_kind','argument_sha256','expected'}
        label=case['id'];fn=case['function'];expected=case['expected']
        assert type(label)is str and label and label not in wanted and fn in TARGETS
        assert case['argument_kind'] in ('jsonb','sql_null')
        if case['argument_kind']=='sql_null':
            assert case['argument_sha256'] is None;nulls+=1
        else:
            assert type(case['argument_sha256'])is str and len(case['argument_sha256'])==64
        if expected['outcome']=='success':
            assert set(expected)=={'outcome','return_jsonb_text'} and type(expected['return_jsonb_text'])is str
            wanted[label]='literal_success';successes+=1
        else:
            exact(expected,dict(outcome='error',sqlstate='23514',message=TARGETS[fn]))
            wanted[label]='23514_'+TARGETS[fn]
    assert successes==204 and nulls==4 and len(wanted)==1594
    for zone in ZONES:
        for label in ZONE_CASES:wanted['zone:'+zone+':'+label]=wanted[label]
    for fn in STUBS:wanted['stub:'+fn]='0A000_stub'
    wanted.update({'internal-guard:immutable_guard':'23514_internal_guard',
                   'internal-guard:refuse_insert':'0A000_internal_guard',
                   'internal-guard:terminal_check':'0A000_internal_guard',
                   'permanent-guard:operation_claims':'0A000_refuse_insert',
                   'catalog:all-private-metadata-acl':'private_owner_only'})
    for role in ROLES:
        for fn in PURE+STUBS:wanted['acl:'+role+':'+fn]='42501_privilege_boundary'
    assert len(wanted)==1727
    exact(inventory['complete_expected_outcomes'],wanted)
    return wanted


def admit_inventory(inventory):
    assert type(inventory)is dict and inventory['kind']=='private-record-fixture-source-draft-v1'
    for key,wanted in [('source_only',True),('runtime_executed',False),('metadata_oracle_imported_from_target',False),('byte_guard_branch_proof',False),('exhaustive_section8_acceptance',False)]:assert inventory[key] is wanted
    for key,wanted in [('phase_seconds',120),('whole_seconds',600),('absolute_cutoff_seconds_before_outer_deadline',60),('single_emergency_cleanup_seconds',180),('stream_limit_bytes',STREAM_LIMIT),('reader_limit_bytes',STREAM_LIMIT),('target_cases',1594),('successes',204),('refusals',1390)]:assert type(inventory[key])is int and inventory[key]==wanted
    exact(inventory['phase_names'],list(PHASE_NAMES));assert set(inventory['phases'])==set(PHASE_NAMES)
    exact(inventory['zone_cases'],list(ZONE_CASES));exact(inventory['zones'],list(ZONES))
    assert type(inventory['total_sql_bytes'])is int and inventory['total_sql_bytes']==33427253
    assert len(inventory['render_inventory'])==1788
    return expected_outcomes(inventory)


def load_fixture(deadline=None):
    if deadline is not None:check_deadline(deadline)
    manifest=json.loads(read_pinned(FIXTURE/'source-ready-manifest.json',FIXTURE_MANIFEST_SHA),object_pairs_hook=unique)
    raw=read_pinned(FIXTURE/'sql-v1/inventory.json',INVENTORY_SHA)
    inventory=json.loads(raw,object_pairs_hook=unique);wanted=admit_inventory(inventory)
    stages={};inputs=dict(inventory['source_hashes'])
    for index,name in enumerate(PHASE_NAMES):
        if deadline is not None:check_deadline(deadline)
        path=FIXTURE/'sql-v1'/('%03d-'%index+name+'.sql');entry=inventory['phases'][name]
        assert set(entry)=={'sha256','bytes'} and type(entry['bytes'])is int and 0<entry['bytes']<STREAM_LIMIT
        raw=read_pinned(path,entry['sha256']);assert len(raw)==entry['bytes']
        assert manifest['files'][str(path.relative_to(FIXTURE))]==entry
        stages[name]=raw.decode('utf-8');assert '\x00' not in stages[name]
        inputs[str(path.relative_to(ROOT))]=entry['sha256']
    assert sum(len(s.encode()) for s in stages.values())==inventory['total_sql_bytes']
    inputs=merge_inputs(inputs,{str((FIXTURE/'sql-v1/inventory.json').relative_to(ROOT)):INVENTORY_SHA,
                               str((FIXTURE/'source-ready-manifest.json').relative_to(ROOT)):FIXTURE_MANIFEST_SHA})
    regular_sources(inputs,deadline=deadline)
    return stages,inventory,wanted,inputs


def load_session():
    spec=importlib.util.spec_from_file_location('stored_record_session',HERE/LOCAL_FILES[1])
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    assert module.PHASE_NAMES==PHASE_NAMES and module.PHASE_SECONDS==120 and module.CLEANUP_SECONDS==180 and module.STREAM_LIMIT==STREAM_LIMIT
    return module


def admit_package(package):
    assert package['expected_sha256']==EXPECTED_SHA and package['install_sha256']==INSTALL_SHA
    assert sha(package['install'].encode())==INSTALL_SHA
    assert sha(json.dumps(package['expected'],sort_keys=True,separators=(',',':'),ensure_ascii=False).encode())==EXPECTED_SHA
    assert len(package['input_source_hashes'])==267 and len(package['expected']['functions'])==37
    assert package['acceptance'] is False and package['admitted_artifact'] is False


def integration_gate(owned,deadline=None):
    if deadline is not None:check_deadline(deadline)
    canonical_location()
    baseline=json.loads(read_pinned(BASELINE,BASELINE_SHA),object_pairs_hook=unique)
    assert len(baseline)==634
    if deadline is not None:check_deadline(deadline)
    current=owned.source_inputs()
    if deadline is not None:check_deadline(deadline)
    additions={str((SOURCE/name).relative_to(ROOT)) for name in LOCAL_FILES}
    additions.update(str((ROOT/'supabase/tests'/name).relative_to(ROOT)) for name in TEST_FILES)
    assert set(current)==set(baseline)|additions, 'Exact reviewed634 plus four runtime/session files required'
    assert {name:current[name] for name in baseline}==baseline, 'Frozen634 changed'
    regular_sources(current,deadline=deadline)
    return current


def source_inputs(owned, fixture_inputs, package, deadline=None):
    inputs=integration_gate(owned,deadline)
    for name,digest in package['input_source_hashes'].items():assert inputs.get(name)==digest
    local={str((HERE/name).relative_to(ROOT)):sha((HERE/name).read_bytes()) for name in LOCAL_FILES}
    values=merge_inputs(inputs,fixture_inputs,local,{str(BASELINE.relative_to(ROOT)):BASELINE_SHA})
    regular_sources(values,deadline=deadline)
    return values


def freeze(folder, values, deadline):
    for name,digest in values.items():
        check_deadline(deadline)
        path=folder/'executed-inputs'/name;path.parent.mkdir(parents=True,exist_ok=True)
        with path.open('xb') as handle:handle.write((ROOT/name).read_bytes())
        assert sha(path.read_bytes())==digest
    (folder/'source-hashes.json').write_text(json.dumps(values,indent=2,sort_keys=True)+'\n')
    check_deadline(deadline)


def verify_saved(folder, frozen, root, current, deadline=None):
    exact(current,frozen);regular_sources(frozen,root,deadline)
    copied=folder/'executed-inputs';observed={}
    for path in copied.rglob('*'):
        if deadline is not None:check_deadline(deadline)
        assert not path.is_symlink()
        if path.is_file():observed[str(path.relative_to(copied))]=sha(path.read_bytes())
        else:assert path.is_dir()
    exact(observed,frozen)
    if deadline is not None:check_deadline(deadline)


def admit_summary(value,wanted):
    assert type(value)is dict and set(value)=={'kind','acceptance','publication','auth_acceptance','clinical_activation','proof'}
    assert value['kind']=='private-stored-configuration-value-observations-v1'
    for key in ('acceptance','publication','auth_acceptance','clinical_activation'):assert value[key] is False
    assert type(value['proof'])is dict and set(value['proof'])==set(wanted)
    for label,outcome in wanted.items():assert type(value['proof'][label])is str and value['proof'][label]==outcome
    return value


def parse_output(output,receipt,wanted,marker):
    assert receipt['passed'] is True and type(receipt['client_returncode'])is int and receipt['client_returncode']==0
    assert len(receipt['phases'])==93 and [x['name']for x in receipt['phases']]==list(PHASE_NAMES)
    assert all(x['complete'] is True for x in receipt['phases'])
    nonce=receipt['nonce'];backend=receipt['backend'];markers=[];summaries=[]
    for line in output.splitlines():
        if not line.strip():continue
        value=json.loads(line,object_pairs_hook=unique)
        if type(value)is dict and set(value)=={marker}:markers.append(value[marker])
        else:summaries.append(value)
    assert len(markers)==94 and len(summaries)==1
    for index,item in enumerate(markers):
        exact(item,dict(nonce=nonce,index=index-1,name='identity'if index==0 else PHASE_NAMES[index-1],backend_pid=backend['pid'],backend_start=backend['backend_start']))
    return admit_summary(summaries[0],wanted)


class DeadlineContract:
    """Mixin only. No resource imports, constructors, or global monkeypatching."""
    def initialize_deadlines(self,outer):
        assert type(outer)is float and outer>time.monotonic()
        self.original_outer_deadline=outer
        self.measurement_deadline=outer-FINAL_SECONDS
        self.deadline=self.measurement_deadline
        self.final_proof=False
        self.record_cleanup_kind=None
        check_deadline(self.measurement_deadline)

    def remaining(self,limit):
        cutoff=self.cleanup_deadline if self.record_cleanup_kind is not None else self.deadline
        remaining=min(cutoff,self.deadline)-time.monotonic()
        assert remaining>0,'Stored-record effective deadline exhausted'
        return min(limit,120,remaining)

    def enter_final_proof(self,receipt,summary,wanted,output,marker):
        check_deadline(self.measurement_deadline)
        assert self.final_proof is False and self.cleanup_deadline is None
        parsed=parse_output(output,receipt,wanted,marker);exact(parsed,summary)
        self.final_proof=True
        self.deadline=self.original_outer_deadline

    def prepare_cleanup(self,normal):
        assert self.record_cleanup_kind is None,'Cleanup cannot reset or retry'
        self.bootstrap_phase_deadline=None;self.candidate_phase_deadline=None
        if normal:
            assert self.final_proof is True and self.cleanup_deadline is None
            check_deadline(self.original_outer_deadline)
            self.record_cleanup_kind='normal_outer_deadline'
            self.cleanup_deadline=self.original_outer_deadline
        else:
            self.record_cleanup_kind='single_emergency_reserve'
            if self.cleanup_deadline is None:self.cleanup_deadline=time.monotonic()+EMERGENCY_SECONDS
        self.deadline=self.cleanup_deadline


def runtime_type(retained):
    class Runtime(DeadlineContract,retained.Runtime):
        def __init__(self,folder,package,outer):
            self.initialize_deadlines(outer)
            super().__init__(folder,REFERENCE_SECONDS,package)
            # Retained constructor sets its own deadline; restore fixed effective
            # deadline before any startup. Constructor elapsed time is not reset.
            self.deadline=self.measurement_deadline

        def cleanup(self,normal=False):
            self.prepare_cleanup(normal)
            try:
                return super().cleanup()
            finally:
                # Frozen ancestor may assign its old relative deadline; the
                # effective bound always remains this one shared fixed cutoff.
                self.deadline=self.cleanup_deadline
    return Runtime


def diagnostic(runtime,package,stages,wanted,phased,owned,capture):
    check_deadline(runtime.measurement_deadline)
    before=capture.snapshot(runtime.query);owned.save(runtime.folder,'stored-record-before',before)
    exact(capture.parse(runtime.query(package['snapshot_sql'])),package['expected'])
    # Verify() allocates another command. Capture this exact folder BEFORE run.
    folder=runtime.folder/f'{runtime.command_number+1:04d}-phased-session'
    output=phased.run(runtime,list(stages.items()))
    check_deadline(runtime.measurement_deadline)
    receipt=json.loads((folder/'receipt.json').read_text(),object_pairs_hook=unique)
    summary=parse_output(output,receipt,wanted,phased.MARKER)
    runtime.enter_final_proof(receipt,summary,wanted,output,phased.MARKER)
    after=capture.snapshot(runtime.query);owned.save(runtime.folder,'stored-record-after',after)
    exact(after,before)
    exact(capture.parse(runtime.query(package['snapshot_sql'])),package['expected'])
    runtime.query('select controlled_review_v3.required();')
    owned.save(runtime.folder,'stored-record-observations',summary)
    check_deadline(runtime.original_outer_deadline)
    return dict(passed=True,acceptance=False,targets=1594,successes=204,refusals=1390,
                outcomes=1727,phases=93,session_user='postgres',current_user='postgres',
                permanent_preservation=True,publication=False,auth_acceptance=False,
                clinical_activation=False,byte_guard_branch_proof=False,exhaustive_section8_acceptance=False)


def completion(complete,error,removed,now,deadline):
    return complete is True and error is None and removed is True and now<deadline


def prepare_reference(owned,assembly,deadline):
    """Fixed initial admission phase; no Runtime construction or DB authority."""
    check_deadline(deadline)
    package=assembly.build()
    check_deadline(deadline)
    admit_package(package)
    stages,inventory,wanted,fixture_inputs=load_fixture(deadline)
    frozen=source_inputs(owned,fixture_inputs,package,deadline)
    required=3*1024**3+2*sum((ROOT/n).stat().st_size for n in frozen)+4*inventory['total_sql_bytes']
    free=shutil.disk_usage(tempfile.gettempdir()).free
    assert free>=required,'Insufficient evidence space; no bypass or deletion'
    check_deadline(deadline)
    folder=Path(tempfile.mkdtemp(prefix='lrv-configuration-record-reference-'))
    try:
        owned.save(folder,'disk-admission',dict(required_bytes=required,free_bytes=free))
        freeze(folder,frozen,deadline)
        verify_saved(folder,frozen,ROOT,source_inputs(owned,fixture_inputs,package,deadline),deadline)
        owned.save(folder,'independent-expected',package['expected'])
        check_deadline(deadline)
        owned.save(folder,'stage-inventory',inventory)
        check_deadline(deadline)
    except BaseException:
        (folder/'admission-failure.txt').write_text(traceback.format_exc())
        raise
    return folder,package,stages,inventory,wanted,fixture_inputs,frozen


class TerminalResultFailure(RuntimeError):
    """Result publication failed; never an authorized successful terminal state."""


def publish_result(owned,folder,value,start,outer):
    """Post-write deadline verification and fail-closed result revocation.

    Failure evidence does not grant execution time or retry cleanup. A separate
    terminal-failure receipt always defeats an attempted success receipt; if
    persistence itself fails, the exception remains the terminal outcome.
    """
    write_error=None
    try:
        owned.save(folder,'result',value)
    except BaseException as exc:
        write_error=exc
    observed=time.monotonic()
    if write_error is None and observed<outer:
        return
    code='final_result_write_error' if write_error is not None else 'final_result_write_deadline'
    failure=dict(kind='stored-record-terminal-failure-v1',passed=False,code=code,
                 observed_after_result_write=observed,original_outer_deadline=outer,
                 elapsed_seconds=round(observed-start,3),
                 write_error_type=None if write_error is None else type(write_error).__name__,
                 result_authority_revoked=False,attempted_result=None,
                 revocation_error_type=None,corrective_write_errors=[])
    errors=[]
    result=folder/'result.json'
    try:
        if result.exists() or result.is_symlink():
            assert result.is_file() and not result.is_symlink(),'Unexpected result evidence type'
            # Unique fresh private directory prevents replacing older evidence.
            attempted=Path(tempfile.mkdtemp(prefix='non-authoritative-result-',dir=folder))
            result.rename(attempted/'attempted-result.json')
            failure['attempted_result']=str((attempted/'attempted-result.json').relative_to(folder))
        failure['result_authority_revoked']=True
    except BaseException as exc:
        failure['revocation_error_type']=type(exc).__name__;errors.append(exc)
    # Keep original primary/cleanup failures and distinguish this terminal one.
    failed=dict(value,passed=False,elapsed_seconds=failure['elapsed_seconds'],
                elapsed_observation='after_attempted_result_write',terminal_failure=failure)
    try:
        owned.save(folder,'terminal-failure',failure)
    except BaseException as exc:
        failure['corrective_write_errors'].append(dict(receipt='terminal-failure',type=type(exc).__name__))
        errors.append(exc)
    if failure['result_authority_revoked']:
        try:
            owned.save(folder,'result',failed)
        except BaseException as exc:
            failure['corrective_write_errors'].append(dict(receipt='result',type=type(exc).__name__))
            errors.append(exc)
    # Never return even if corrective evidence succeeded; no deadline extension.
    cause=write_error or (errors[0] if errors else None)
    raise TerminalResultFailure(code) from cause


def execute_integrated():
    canonical_location()  # Before imports/constructors capable of resources.
    start=time.monotonic();outer=start+REFERENCE_SECONDS;cutoff=outer-FINAL_SECONDS
    import record_review_v3_gate_b_runtime as retained
    import record_review_v3_gate_a_runtime as owned
    import record_review_v3_gate_b_snapshot as capture
    import record_review_v3_configuration_record_profile as assembly
    from canonical_review_prefix import admit_canonical206
    os.umask(0o077)
    admission_deadline=min(start+120,cutoff)
    phased=load_session();check_deadline(admission_deadline)
    folder,package,stages,inventory,wanted,fixture_inputs,frozen=prepare_reference(owned,assembly,admission_deadline)
    for module in (retained,owned,capture,assembly,phased):
        path=Path(module.__file__).resolve();assert path.parent==SOURCE and str(path.relative_to(ROOT))in frozen
    check_deadline(admission_deadline)
    runtime=None;complete=False;error=None;cleanup_error=None;outcomes={};passed=False
    try:
        Runtime=runtime_type(retained);runtime=Runtime(folder,package,outer)
        admitted=admit_canonical206(SOURCE,sorted((ROOT/'supabase/migrations').glob('*.sql')))
        files=admitted['prefix205']+[ROOT/'supabase/migrations'/admitted['binding206']['filename']]
        check_deadline(cutoff);runtime.start(files)
        runtime.query(package['preflight_sql'])
        before=capture.snapshot(runtime.query);capture.baseline(before,package)
        owned.save(folder,'canonical206-before',before)
        retained.install_proof(runtime,package,before);outcomes['metadata_reference']=True
        outcomes['stored_records']=diagnostic(runtime,package,stages,wanted,phased,owned,capture)
        verify_saved(folder,frozen,ROOT,source_inputs(owned,fixture_inputs,package,outer),outer)
        complete=True
    except BaseException as exc:
        error=dict(type=type(exc).__name__,code='reference_or_diagnostic_failed')
        (folder/'failure.txt').write_text(traceback.format_exc())
        raise
    finally:
        removed=False
        try:
            if runtime is not None:
                runtime.cleanup(normal=complete and error is None)
                removed=runtime.record['removed']
                verification_deadline=outer if complete and error is None else runtime.cleanup_deadline
                verify_saved(folder,frozen,ROOT,source_inputs(owned,fixture_inputs,package,verification_deadline),verification_deadline)
        except BaseException as exc:
            cleanup_error=dict(type=type(exc).__name__,code='cleanup_or_final_source_failed')
            (folder/'cleanup-failure.txt').write_text(traceback.format_exc())
            if error is None:raise
        finally:
            passed=completion(complete,error or cleanup_error,removed,time.monotonic(),outer)
            result_value=dict(kind='private-stored-configuration-reference-v1',passed=passed,
                acceptance=False,admitted_artifact=False,publication=False,auth_acceptance=False,clinical_activation=False,
                hosted_writes=0,workload_seconds=600,setup_measurement_cutoff_seconds=540,final_reserved_seconds=60,
                emergency_cleanup_seconds=180,phase_seconds=120,admission_phase_seconds=120,phase_count=93,
                original_outer_deadline=outer,measurement_deadline=cutoff,
                cleanup_mode=None if runtime is None else runtime.record_cleanup_kind,
                elapsed_seconds=round(time.monotonic()-start,3),elapsed_observation='before_result_write',source_inputs=len(frozen),
                source_map_sha256=sha((folder/'source-hashes.json').read_bytes()),expected_sha256=EXPECTED_SHA,
                install_sha256=INSTALL_SHA,outcomes=outcomes,all_owned_cleanup_verified=removed,
                primary_failure=error,cleanup_failure=cleanup_error)
            active_failure=sys.exception()
            try:
                publish_result(owned,folder,result_value,start,outer)
            except BaseException:
                # An evidence error must not replace an already-active workload
                # or cleanup failure. Its separate terminal receipt is retained.
                if active_failure is not None:raise active_failure
                raise
    assert passed,'Stored-record proof or normal cleanup incomplete'
    return folder/'result.json'


def source_state():
    stages,inventory,wanted,inputs=load_fixture()
    session=load_session()
    return dict(source_only=True,runtime_executed=False,private_launch_allowed=False,
                phases=len(stages),targets=1594,outcomes=len(wanted),sql_bytes=inventory['total_sql_bytes'],
                expected_sha256=EXPECTED_SHA,install_sha256=INSTALL_SHA,fixture_inputs=len(inputs),
                phase_seconds=session.PHASE_SECONDS,whole_seconds=600,setup_cutoff_seconds=540,
                final_reserved_seconds=60,emergency_cleanup_seconds=180)


def main():
    assert len(sys.argv)==1,'Source-only CLI: no runtime, source, role, SQL, batch or budget arguments'
    print(json.dumps(source_state(),sort_keys=True))


if __name__=='__main__':main()
