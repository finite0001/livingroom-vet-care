"""Private A2 positive runtime draft. CLI compiles only; no launch option.

Requires a separate reviewed canonical relocation and source map before execution.
"""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import time
import traceback

import importlib.util
import sys

HERE=Path(__file__).resolve().parent

def load_exact_file(name,path):
    path=Path(path)
    assert path.is_file() and not path.is_symlink(),'Exact module file required'
    if name in sys.modules:
        module=sys.modules[name];origin=getattr(module,'__file__',None)
        assert isinstance(origin,(str,Path)) and Path(origin).resolve()==path.resolve(),'Module path collision: '+name
        return module
    spec=importlib.util.spec_from_file_location(name,path)
    assert spec is not None and spec.loader is not None
    module=importlib.util.module_from_spec(spec);sys.modules[name]=module
    try:spec.loader.exec_module(module)
    except BaseException:
        del sys.modules[name]
        raise
    return module

dep=load_exact_file('a2_positive_dependencies',HERE/'a2_positive_dependencies.py')
observations=dep.load('observations',HERE/'observations.py')
session=dep.load('session',HERE/'session.py')
ROOT=dep.ROOT
OWN_FILES=('a2_positive_dependencies.py','session.py','observations.py','runtime.py','test_runtime.py','test_session.py','source-declaration.json')
OUTER_PHASES=('builtin_prefix188','historical_capture188','suffix206','historical_preservation206','reference_a2','final_proof')
EXPECTED='997955a567db36449969e22859744ce0b28a0d8e37d0bdccecfb8b38ee441aa7'
INSTALL='40ccec2d13e5bfe46e0bfb1054f9c115410abe2e8b9d48b85c1dea367cce6efd'
DERIVATION='078b8a5c45befa7c8478da9c28a0134c34011f5d15dd89755a2e67206dc3a3d5'
sha=lambda raw:hashlib.sha256(raw).hexdigest()
canonical=dep.fixed_admission.canonical


def package_bundle(check):
    check();old=dep.fixed_admission.build();check();package=dep.assembly.build();check()
    assert package['expected_sha256']==EXPECTED and package['install_sha256']==INSTALL
    assert len(package['input_source_hashes'])==254 and sha(canonical(package['input_source_hashes']).encode())==DERIVATION
    for key in ('canonical206_binding','expected_ledger206'):
        assert package[key]==old['package'][key],key
    prior=old['package']['preservation_sql']
    assert prior.count('record_review_v3_gate_b_')==5
    assert package['preservation_sql']==prior.replace('record_review_v3_gate_b_','record_review_v3_gate_b_a2_')
    assert package['expected']['parents']==old['package']['expected']['parents']
    assert package['expected_ledger206'][:188]==old['expected188']
    # A new bundle, never replace retained module globals or mutate old package.
    return {**old,'package':package}


def input_map(check):
    check();values=dep.owned.source_inputs();check()
    declaration=json.loads((HERE/'source-declaration.json').read_text())
    baseline=declaration['canonical_baseline']
    own={str((HERE/name).relative_to(ROOT))for name in OWN_FILES}
    assert HERE==dep.CANDIDATE/'record_review_v3_a2_positive','Fixed canonical source location required'
    assert set(values)==set(baseline)|own and {k:values[k]for k in baseline}==baseline,'Canonical source transition requires separate explicit review'
    actual={p.name for p in HERE.iterdir()if p.is_file()and p.suffix in('.py','.json','.sql')}
    assert actual==set(OWN_FILES),'New runtime executable keyset differs'
    for name in OWN_FILES:
        check();path=HERE/name;assert path.is_file()and not path.is_symlink()
        assert values[str(path.relative_to(ROOT))]==sha(path.read_bytes()),'Own source collector digest differs'
        check()
    for path,digest in ((ROOT/'tmp/a2-opening-adapter-draft/positive-runtime-plan.md',declaration['plan_sha256']),
                        (dep.CANDIDATE/'record_review_v3_configuration_session.py',declaration['session_donor_sha256'])):
        check();assert sha(path.read_bytes())==digest
        key=str(path.relative_to(ROOT))
        if key in values:assert values[key]==digest
        values[key]=digest;check()
    for directory,names,key in ((dep.FIXED,dep.fixed_admission.OWN_FILES,'fixed188'),(dep.FIXTURE,dep.fixture.SOURCES,'fixture')):
        actual={p.name for p in directory.iterdir() if p.is_file()and p.suffix in('.py','.json','.sql')}
        assert actual==set(names),'Dependency directory executable keyset differs'
        assert set(declaration[key])==set(names)
        for name in names:
            check();path=directory/name;assert path.is_file()and not path.is_symlink()
            digest=sha(path.read_bytes());assert digest==declaration[key][name],name
            relative=str(path.relative_to(ROOT));assert relative not in values
            values[relative]=digest;check()
    for absolute,digest in dep.fixture.source_inputs().items():
        check();path=Path(absolute);relative=str(path.relative_to(ROOT))
        assert sha(path.read_bytes())==digest
        if relative in values:assert values[relative]==digest
        values[relative]=digest
    actual={p.name for p in HERE.iterdir()if p.is_file()and p.suffix in('.py','.json','.sql')}
    assert actual==set(OWN_FILES),'New runtime executable keyset differs'
    for name in OWN_FILES:
        check();path=HERE/name;assert not path.is_symlink()
        assert values[str(path.relative_to(ROOT))]==sha(path.read_bytes()),'Own source collector digest differs';check()
    return dict(sorted(values.items()))


def freeze(folder,values,check):
    for name,digest in values.items():
        check();source=ROOT/name;assert not source.is_symlink()and sha(source.read_bytes())==digest
        target=folder/'executed-inputs'/name;target.parent.mkdir(parents=True,exist_ok=True)
        with target.open('xb')as out:out.write(source.read_bytes())
        assert sha(target.read_bytes())==digest;check()
    (folder/'source-hashes.json').write_text(json.dumps(values,sort_keys=True,indent=2)+'\n')


def check_frozen(folder,values,check):
    assert input_map(check)==values
    actual={}
    for path in (folder/'executed-inputs').rglob('*'):
        check();assert not path.is_symlink()
        if path.is_file():actual[str(path.relative_to(folder/'executed-inputs'))]=sha(path.read_bytes())
    assert actual==values,'Complete saved source keyset/bytes changed';check()


def build_positive(ids):
    rows=(('post_setup',dep.fixture.post_setup(ids)),)+dep.fixture.opening_stages()+dep.fixture.action_stages()
    rows+=(('oracle_setup',dep.fixture.oracle_setup()+observations.measurement_setup()),
       ('verify_before',observations.measured(dep.fixture.verify_sql(False),False)),
       ('later_append',dep.fixture.later_stage()),
       ('verify_after',observations.measured(dep.fixture.verify_sql(True),True)))
    result=observations.wrap(rows);session._validate_phases(result,'positive206');return result


def build_seed():
    result=observations.wrap(dep.fixture.seed_stages());session._validate_phases(result,'seed188');return result


class Runtime(dep.fixed_driver.Runtime):
    @contextmanager
    def phase(self,name,final=False):
        assert name in OUTER_PHASES and self.fixed_phase_deadline is None and not self.in_cleanup
        assert final==(name=='final_proof')
        self.final_mode=final
        stop=min(self.outer_deadline if final else self.setup_deadline,time.monotonic()+120)
        if name=='builtin_prefix188':stop=min(stop,self.outer_deadline-600+120)
        self.fixed_phase_deadline=stop;start=time.monotonic();record={'name':name,'passed':False,'deadline':stop}
        try:
            assert start<stop
            yield
            assert time.monotonic()<stop
            record['passed']=True
        finally:
            record['elapsed_seconds']=time.monotonic()-start
            self.save_private('phase-'+name,record);self.fixed_phase_deadline=None

    def begin_failure_cleanup(self):
        if not self.in_cleanup:
            if self.cleanup_deadline is None:self.cleanup_deadline=time.monotonic()+180
            self.in_cleanup=True;self.fixed_phase_deadline=None
        assert self.cleanup_deadline is not None


def json_rows(output):
    return [json.loads(line,object_pairs_hook=dep.fixed_admission.unique)for line in output.splitlines()if line.startswith('{')]


def single(output,kind):
    rows=[v for v in json_rows(output)if type(v)is dict and v.get('kind')==kind]
    assert len(rows)==1;return rows[0]


def same_json(a,b):return dep.bridge.exact_json(a,b)


def admit_contexts(output,names):
    rows=json_rows(output)
    initial=[r for r in rows if 'a2_session_initial'in r]
    phases=[r for r in rows if 'a2_session_phase'in r]
    assert len(initial)==1 and set(initial[0])=={'a2_session_initial'}
    assert len(phases)==len(names)
    first=initial[0]['a2_session_initial'];stable=phases[0]['value']
    assert type(first)is dict and set(first)=={'settings','session_user','current_user','auth_uid','auth_role','auth_email','auth_jwt','advisory'}
    assert set(first['settings'])==set(observations.GUC)
    assert first['session_user']==first['current_user']=='postgres'and first['advisory']==[]
    assert all(first[k] is None for k in ('auth_uid','auth_role','auth_email'))
    assert first['settings']['role']=='none'and first['settings']['session_replication_role']=='origin'
    assert all(first['settings'][k] in(None,'')for k in observations.JWT)
    expected=json.loads(json.dumps(first))
    for k in observations.JWT:
        if first['settings'][k]is None and stable['settings'][k]=='':expected['settings'][k]=''
    assert same_json(expected,stable),'Undeclared initial context change'
    for name,row in zip(names,phases):
        assert set(row)=={'a2_session_phase','value'}and row['a2_session_phase']==name and same_json(row['value'],stable),'Phase context mismatch'
    return {'initial':first,'stable':stable,'phases':len(phases),'initial_missing_empty_only':True}


def admit_seed(output,receipt):
    seed=dep.fixture.parse_seed(output)
    assert receipt['passed'] is True and receipt['client_returncode']==0
    assert seed['backend_pid']==receipt['backend']['pid']
    # psql's timestamptz JSON lexical spelling differs from UTC marker. Compare
    # both exact instants without accepting dates/naive/malformed values.
    import datetime
    instant=datetime.datetime.fromisoformat(seed['backend_start'])
    assert instant.tzinfo is not None
    assert instant.astimezone(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%fZ')==receipt['backend']['backend_start']
    admit_contexts(output,session.SEED_NAMES)
    return seed


def admit_positive(output):
    rows=json_rows(output);proof=[v for v in rows if v.get('kind')=='a2-positive-core-values-v1']
    assert len(proof)==2
    keys={'kind','after_append','target_cases','cases','original_seven_stable','synthetic_only','remaining_negative_limit_restore_proven','clinical_activation'}
    for after,value in zip((False,True),proof):
        assert set(value)==keys
        assert value['after_append'] is after and value['original_seven_stable']is after
        assert value['synthetic_only']is True and value['remaining_negative_limit_restore_proven']is False and value['clinical_activation']is False
        count=8 if after else 7
        assert type(value['target_cases'])is int and value['target_cases']==count
        assert type(value['cases'])is list and len(value['cases'])==count
        assert [r['label']for r in value['cases']]==[r[0]for r in dep.fixture.TARGETS[:count]]
        for row in value['cases']:
            assert set(row)=={'label','collected','adapted','independent_expected','managed','available','prepared','return_held','new_movements','new_charges'}
            assert same_json(row['collected'],row['independent_expected'])and same_json(row['adapted'],row['independent_expected']['adapter'])
            assert row['available']==row['return_held']=='0.000'
            assert row['prepared']==('-2.000'if row['label']=='K_managed_pickup_of_188_package'else'0.000')
            assert type(row['new_movements'])is int and row['new_movements']==0 and type(row['new_charges'])is int and row['new_charges']==0
    assert same_json(proof[0]['cases'],proof[1]['cases'][:7])
    preserved=[v for v in rows if 'a2_measurement_preserved'in v]
    assert same_json(preserved,[{'a2_measurement_preserved':True,'after_append':False},{'a2_measurement_preserved':True,'after_append':True}])
    admit_contexts(output,session.POSITIVE_NAMES)
    return {'before':proof[0],'after':proof[1],'measurements':preserved}


def closed_seed_sql(seed):
    assert type(seed['backend_pid'])is int and seed['backend_pid']>0
    return "select not exists(select 1 from pg_stat_activity where pid="+str(seed['backend_pid'])+");"


def execute_reviewed():
    """Internal composition, not exposed by this private source-only CLI."""
    assert HERE==dep.CANDIDATE/'record_review_v3_a2_positive','Private draft cannot launch; canonical relocation and review required'
    started=time.monotonic();runtime=None;values=None;cleaned=False
    mask=os.umask(0o077);folder=Path(tempfile.mkdtemp(prefix='lrv-a2-positive-evidence-'));folder.chmod(0o700)
    result={'kind':'private-a2-positive-reference-v1','passed':False,'acceptance':False,'auth_acceptance':False,
      'protocol_behavior_claim':False,'clinical_activation':False,'unsupported_refusal_restore_proven':False,
      'whole_seconds':600,'phase_seconds':120,'setup_cutoff_before_outer':60,'emergency_cleanup_seconds':180}
    def admission_check():assert time.monotonic()<started+120,'Source admission first-phase deadline'
    try:
        admission_check();assert shutil.disk_usage(folder).free>=3*1024**3
        bundle=package_bundle(admission_check);values=input_map(admission_check);freeze(folder,values,admission_check)
        check_frozen(folder,values,admission_check);dep.bridge.bind_package_inputs(bundle['package'],values)
        runtime=Runtime(folder,bundle,started)
        with runtime.phase('builtin_prefix188'):runtime.start(bundle['files'])
        seed_started=time.monotonic();runtime.setup_remaining();seed_phases=build_seed();deadline_check(min(seed_started+120,runtime.setup_deadline))
        seed_output,seed_folder,seed_receipt=session.run(runtime,seed_phases,'seed188',started=seed_started)
        seeded=admit_seed(seed_output,seed_receipt);runtime.setup_remaining();runtime.save_private('seed',seeded)
        runtime.fixed_helper.transition('historical_seed_committed')
        with runtime.phase('historical_capture188'):
            assert runtime.query(closed_seed_sql(seeded)).strip()=='t'
            before=single(runtime.query(dep.fixture.history_sql(seeded)),'a2-history-source-oracle-v1')
            # Admit exact finite shape/membership immediately, not only after upgrade.
            dep.fixture.preserved(before,before,seeded);runtime.save_private('history188',before)
        with runtime.phase('suffix206'):
            check_frozen(folder,values,runtime.setup_remaining);runtime.fixed_helper.upgrade()
        with runtime.phase('historical_preservation206'):
            after=single(runtime.query(dep.fixture.history_sql(seeded)),'a2-history-source-oracle-v1')
            result['historical_preservation']=dep.fixture.preserved(before,after,seeded);runtime.save_private('history206',after)
        with runtime.phase('reference_a2'):
            before_install=dep.capture.snapshot(runtime.query);dep.capture.baseline(before_install,bundle['package'])
            runtime.save_private('before-install',before_install)
            installed=dep.bridge.install_proof(runtime,bundle['package'],before_install);result['metadata_reference']=True
        positive_started=time.monotonic();runtime.setup_remaining();positive_phases=build_positive(seeded['ids']);deadline_check(min(positive_started+120,runtime.setup_deadline))
        positive_output,positive_folder,positive_receipt=session.run(runtime,positive_phases,'positive206',started=positive_started)
        assert positive_receipt['backend']!=seed_receipt['backend'],'Second session must be fresh'
        result['positive_proof']=admit_positive(positive_output);runtime.setup_remaining()
        result['sessions']={'seed':str(seed_folder.relative_to(folder)),'positive':str(positive_folder.relative_to(folder))}
        result.update(expected_sha256=EXPECTED,install_sha256=INSTALL,derivation_sha256=DERIVATION,
            source_map_sha256=sha(canonical(values).encode()))
        with runtime.phase('final_proof',final=True):
            assert dep.capture.parse(runtime.query(bundle['package']['snapshot_sql']))==bundle['package']['expected']
            final=dep.capture.snapshot(runtime.query);runtime.save_private('final-snapshot',final)
            # baseline() is absent-namespace only; compare exact immutable parents
            # and ledger with source package without falsely excluding real writes.
            for key in ('ledger','parent','parent_literal','parent_literal_hash_valid','writers','private206','private206_literal'):
                assert final[key]==before_install[key],key
            assert final['catalog']==installed['catalog'] and final['types']==installed['types'],'Intentional fixture writes changed catalog/types/ACL'
            runtime.query('select controlled_review_v3.required();')
            runtime.query(dep.paused.SAFE_SQL);assert runtime.query(dep.paused.DRAIN_SQL).strip()=='t'
            runtime.fixed_helper.sources();runtime.fixed_helper.copies.full(runtime.fixed_helper.copies.active)
            runtime.fixed_helper.copies.observe();check_frozen(folder,values,lambda:runtime.remaining(120))
        runtime.cleanup(failed=False);cleaned=True
        check_frozen(folder,values,lambda:deadline_check(started+600))
        result['passed']=time.monotonic()<started+600
    except BaseException as error:
        result['primary_failure']={'type':type(error).__name__};(folder/'primary-traceback.txt').write_text(traceback.format_exc())
    finally:
        if runtime is not None and not cleaned and not runtime.cleanup_started:
            try:
                runtime.begin_failure_cleanup()
                if runtime.fixed_helper is not None and runtime.fixed_helper.copies.deferred:runtime.fixed_helper.recover_after_failure()
                runtime.cleanup(failed=True);cleaned=True
            except BaseException as error:
                result['cleanup_failure']={'type':type(error).__name__};(folder/'cleanup-traceback.txt').write_text(traceback.format_exc())
        result['cleanup_complete']=bool(cleaned and runtime is not None and runtime.record.get('removed'))
        result['passed']=bool(result['passed']and result['cleanup_complete'])
        result['elapsed_seconds']=time.monotonic()-started
        if values is not None:
            try:check_frozen(folder,values,lambda:deadline_check(runtime.cleanup_deadline if runtime and runtime.in_cleanup else started+600))
            except BaseException as error:result.update(passed=False,source_failure={'type':type(error).__name__})
        try:persist_result(folder,result,started+600,started)
        finally:os.umask(mask)
    return result,folder


def persist_result(folder,result,outer_deadline,started):
    """Only a completed, timely persistence can publish authoritative PASS."""
    target=folder/'result.json';attempted=folder/'result-attempted.json'
    revoked=folder/'result-revoked.json'
    assert not target.exists()and not attempted.exists()and not revoked.exists()
    def encode():
        result['elapsed_seconds']=time.monotonic()-started
        return json.dumps(result,sort_keys=True,indent=2)+'\n'
    def fail_receipt():
        result['passed']=False
        if target.exists():target.rename(revoked)
        target.write_text(encode())
    try:
        if time.monotonic()>=outer_deadline:
            result['passed']=False;result['terminal_deadline_failure']=True
        attempted.write_text(encode())
        if result['passed']and time.monotonic()>=outer_deadline:
            result['terminal_deadline_failure']=True;fail_receipt();return
        attempted.rename(target)
        if result['passed']and time.monotonic()>=outer_deadline:
            result['terminal_deadline_failure']=True;fail_receipt()
    except BaseException as primary:
        result['passed']=False
        result['terminal_persistence_failure']={'type':type(primary).__name__}
        try:fail_receipt()
        except BaseException:pass  # Never hide the first persistence failure.
        raise


def deadline_check(end):assert time.monotonic()<end,'Absolute source callback deadline exhausted'


def main():
    import sys
    assert len(sys.argv)==1,'Private source-only CLI accepts no launch or override arguments'
    start=time.monotonic();bundle=package_bundle(lambda:deadline_check(start+120))
    print(json.dumps({'source_only':True,'seed_phases':len(build_seed()),'positive_phases':len(session.POSITIVE_NAMES),
      'expected':bundle['package']['expected_sha256'],'acceptance':False}))

if __name__=='__main__':main()
