"""Unadmitted configuration-input reference/diagnostic; canonical location only.

Private drafts cannot execute. Additive reviewed integration and exact source
freeze precede any owned Runtime. No live expectations, grants, or retries.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import time
import traceback

SOURCE=Path(__file__).resolve().parent
ROOT=SOURCE.parents[3]
REFERENCE_SECONDS=600
CORPUS_SHA='07834599621ce51d5b7e1ef1cc92282848fe4d477250671e1bbc250daa5eac05'
PUBLIC=('prepare_controlled_record_review_v3','read_controlled_record_review_v3','execute_controlled_record_review_v3','cancel_controlled_record_review_v3','get_controlled_record_review_event_v3','list_controlled_record_reviews_v3','publish_controlled_review_configuration_v3','read_controlled_review_publication_v3','get_controlled_review_configuration_v3','record_controlled_review_escalation_action_v3','get_controlled_review_backlog_v3')
STUBS=tuple('public.'+s for s in PUBLIC)+tuple('controlled_review_v3.'+s for s in ('publish_administration','materialize_one','record_scan'))
ROLES=('anon','authenticated','service_role')
PHASE_NAMES=('decode_cases','capture_baseline')+tuple('positive_%03d'%i for i in range(0,70,25))+tuple('negative_%03d'%i for i in range(0,417,25))+('null_wire_session_controls','stubs_guard_acl','final_inventory')
CONTROLS={'sql_null_argument':'23514_configuration_invalid','normalized_exponent_one':'decoded_unchanged','visible_fractional_scale':'corpus_case_reference','duplicate_key_loss':'jsonb_loss_observed_upstream_not_tested','nul_escape':'decoder_observation_only','unpaired_surrogate':'decoder_observation_only','transport_whitespace_bytes':'decoded_unchanged_http_not_tested','alternate_session_restored':'rollback_context_restored'}
OWNER_SQL="""do $configuration_owner$ begin
if current_user<>'postgres' or session_user<>'postgres' or current_setting('role')<>'none' then raise exception 'Configuration diagnostic requires direct ordinary postgres connection';end if;
end $configuration_owner$;
"""


def sha(data):return hashlib.sha256(data).hexdigest()

def unique(pairs):
    result={}
    for name,value in pairs:
        assert name not in result,'Duplicate JSON key'
        result[name]=value
    return result


def exact(actual,expected):
    assert json.dumps(actual,sort_keys=True,separators=(',',':'),ensure_ascii=False)==json.dumps(expected,sort_keys=True,separators=(',',':'),ensure_ascii=False),'Exact formal JSON value required'


def canonical_location():
    assert SOURCE==ROOT/'tests/controlled-drugs/engine/candidate','Private draft cannot launch; reviewed additive candidate integration required'
    assert Path(__file__).name=='record_review_v3_configuration_runtime.py'


def expected_outcomes(raw):
    assert sha(raw)==CORPUS_SHA,'Independent corpus changed'
    corpus=json.loads(raw,object_pairs_hook=unique)
    assert len(corpus['positives'])==70 and len(corpus['negatives'])==417
    wanted={}
    for group,outcome in [('positives','unchanged'),('negatives','23514_configuration_invalid')]:
        for case in corpus[group]:
            label=case['id'];assert isinstance(label,str)and label not in wanted
            expected=({'outcome':'return_unchanged','comparison':'jsonb_value_exact','publication_acceptance':False}if group=='positives'else{'outcome':'refuse','sqlstate':'23514','primary_message':'configuration_invalid'})
            exact(case['expected'],expected);wanted[label]=outcome
    wanted.update(CONTROLS)
    wanted.update({'stub:'+f:'0A000_stub'for f in STUBS})
    wanted['guard:operation_claims']='0A000_guard'
    wanted.update({'acl:'+r+':'+f:'42501_privilege_boundary'for r in ROLES for f in ('controlled_review_v3.validate_configuration',)+STUBS})
    wanted['catalog_acl']='private_owner_only'
    assert len(wanted)==556
    return wanted


def admit_fixture(stages,inventory,raw):
    assert isinstance(stages,dict)and tuple(stages)==PHASE_NAMES
    exact(inventory['phase_names'],list(PHASE_NAMES))
    assert inventory['phase_seconds']==120 and type(inventory['phase_seconds'])is int
    assert type(inventory['whole_seconds'])is int and inventory['whole_seconds']==600
    assert type(inventory['emergency_cleanup_seconds'])is int and inventory['emergency_cleanup_seconds']==180
    assert inventory['runtime_executed']is False and inventory['source_integration']is True
    assert set(inventory['stages'])==set(PHASE_NAMES)
    for name,sql in stages.items():
        assert isinstance(sql,str)and sql and '\x00'not in sql
        assert sha(sql.encode())==inventory['stages'][name]
    wanted=expected_outcomes(raw)
    exact(inventory['complete_expected_outcomes'],wanted)
    return wanted


def bind_inputs(inputs,frozen,root):
    assert isinstance(inputs,dict)and inputs
    for name,digest in inputs.items():
        path=Path(name)
        assert not path.is_absolute()and '..'not in path.parts
        assert name in frozen and frozen[name]==digest,'Derivation/execution input missing or changed'
        item=root/path
        assert item.is_file()and not item.is_symlink()
        assert sha(item.read_bytes())==digest


def regular_sources(inputs,root):
    for name,digest in inputs.items():
        path=root/name
        assert not Path(name).is_absolute()and '..'not in Path(name).parts
        assert path.is_file()and not path.is_symlink()
        assert not any(part.is_symlink()for part in path.parents if part!=root and part.is_relative_to(root))
        assert sha(path.read_bytes())==digest


def verify_saved(folder,frozen,root,current):
    exact(current,frozen)
    regular_sources(frozen,root)
    copied=folder/'executed-inputs'
    observed={}
    for path in copied.rglob('*'):
        assert not path.is_symlink(),'Saved source symlink'
        if path.is_file():observed[str(path.relative_to(copied))]=sha(path.read_bytes())
        else:assert path.is_dir(),'Unsupported saved source type'
    exact(observed,frozen)


def admit_summary(value,wanted):
    assert isinstance(value,dict)and set(value)=={'kind','acceptance','publication','auth_acceptance','clinical_activation','proof'}
    assert value['kind']=='private-configuration-input-observations-v1'
    for key in ('acceptance','publication','auth_acceptance','clinical_activation'):assert value[key]is False
    proof=value['proof'];assert isinstance(proof,dict)and set(proof)==set(wanted)
    for label,outcome in wanted.items():
        observed=proof[label]
        assert isinstance(observed,dict)and set(observed)=={'outcome','detail'}
        assert type(observed['outcome'])is str and observed['outcome']==outcome
        detail=observed['detail']
        if label not in ('nul_escape','unpaired_surrogate'):exact(detail,{})
        else:
            assert isinstance(detail,dict)and set(detail)=={'sqlstate','message','decoded','target_called'}
            assert detail['target_called']is False
            code=detail['sqlstate'];message=detail['message']
            if code is None:assert message is None
            else:
                assert type(code)is str and code in ('22P05','22P02')
                assert type(message)is str and 0<len(message)<=1024 and '\x00'not in message
                assert detail['decoded']is None
    return value


def parse_output(output,receipt,wanted,marker):
    assert receipt['passed']is True and type(receipt['client_returncode'])is int and receipt['client_returncode']==0
    assert len(receipt['phases'])==25 and [x['name']for x in receipt['phases']]==list(PHASE_NAMES)
    assert all(x['complete']is True for x in receipt['phases'])
    nonce=receipt['nonce'];backend=receipt['backend'];markers=[];summaries=[]
    for line in output.splitlines():
        if not line.strip():continue
        value=json.loads(line,object_pairs_hook=unique)
        if isinstance(value,dict)and set(value)=={marker}:
            markers.append(value[marker])
        else:summaries.append(value)
    assert len(markers)==26 and len(summaries)==1
    for index,item in enumerate(markers):
        exact(item,dict(nonce=nonce,index=index-1,name='identity'if index==0 else PHASE_NAMES[index-1],backend_pid=backend['pid'],backend_start=backend['backend_start']))
    return admit_summary(summaries[0],wanted)


def diagnostic(runtime,package,stages,inventory,wanted,phased,owned,capture):
    before=capture.snapshot(runtime.query)
    owned.save(runtime.folder,'configuration-before',before)
    assert capture.parse(runtime.query(package['snapshot_sql']))==package['expected']
    phases=list(stages.items())
    phases[0]=(phases[0][0],OWNER_SQL+phases[0][1])
    # Admission verifies the container through another counted command.
    folder=runtime.folder/f'{runtime.command_number+1:04d}-phased-session'
    output=phased.run(runtime,phases)
    receipt=json.loads((folder/'receipt.json').read_text(),object_pairs_hook=unique)
    summary=parse_output(output,receipt,wanted,phased.MARKER)
    after=capture.snapshot(runtime.query)
    owned.save(runtime.folder,'configuration-after',after)
    exact(after,before)
    assert capture.parse(runtime.query(package['snapshot_sql']))==package['expected']
    runtime.query('select controlled_review_v3.required();')
    owned.save(runtime.folder,'configuration-observations',summary)
    return dict(passed=True,acceptance=False,positives=70,corpus_negatives=417,sql_null_controls=1,
        wire_observations=6,alternate_session_controls=1,stub_refusals=14,guard_refusals=1,role_refusals=45,
        catalog_acl_checks=1,proof_ids=556,permanent_preservation=True,session_claim='finite_listed_GUCs_users_and_advisory_locks',
        connection_user='postgres',publication=False,auth_acceptance=False,clinical_activation=False)


def completion(complete,error,removed,now,deadline):
    return complete is True and error is None and removed is True and now<deadline


def main():
    canonical_location() # MUST precede imports capable of creating owned resources.
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-synthetic-local',action='store_true',required=True)
    parser.add_argument('--reference',action='store_true',required=True)
    parser.add_argument('--candidate-inputs',action='store_true')
    args=parser.parse_args()
    import record_review_v3_gate_b_runtime as retained
    import record_review_v3_gate_a_runtime as owned
    import record_review_v3_gate_b_snapshot as capture
    import record_review_v3_configuration_profile as assembly
    import record_review_v3_configuration_fixtures as fixtures
    import record_review_v3_configuration_session as phased
    from canonical_review_prefix import admit_canonical206
    exact(list(phased.PHASE_NAMES),list(PHASE_NAMES))
    assert phased.PHASE_SECONDS==120 and phased.CLEANUP_SECONDS==180 and phased.STREAM_LIMIT==128*1024**2
    os.umask(0o077)
    package=assembly.build(source=SOURCE,profile=SOURCE)
    stages,inventory=fixtures.compile_stages()
    wanted=admit_fixture(stages,inventory,(SOURCE/'record-review-v3-configuration-vectors.json').read_bytes())
    inputs=owned.source_inputs();regular_sources(inputs,ROOT)
    bind_inputs(package['input_source_hashes'],inputs,ROOT)
    bind_inputs(package['source_hashes'],inputs,ROOT)
    bind_inputs(inventory['source_hashes'],inputs,ROOT)
    for module in (retained,assembly,fixtures,phased):
        path=Path(module.__file__).resolve();assert path.parent==SOURCE
        assert str(path.relative_to(ROOT))in inputs
    required=3*1024**3+2*sum((ROOT/name).stat().st_size for name in inputs)
    free=shutil.disk_usage(tempfile.gettempdir()).free
    assert free>=required,'Insufficient evidence space; no cleanup or bypass authorized'
    folder=Path(tempfile.mkdtemp(prefix='lrv-configuration-input-reference-'))
    owned.save(folder,'disk-admission',dict(required_bytes=required,free_bytes=free))
    frozen=owned.freeze(folder);exact(frozen,inputs);verify_saved(folder,frozen,ROOT,owned.source_inputs())
    owned.save(folder,'independent-expected',package['expected'])
    owned.save(folder,'configuration-stage-inventory',inventory)
    start=time.monotonic();deadline=start+REFERENCE_SECONDS
    runtime=retained.Runtime(folder,REFERENCE_SECONDS,package);runtime.deadline=deadline
    complete=False;error=None;outcomes=dict(metadata_reference=False,configuration_inputs=None)
    print('Protected evidence: '+str(folder),flush=True)
    try:
        admitted=admit_canonical206(SOURCE,sorted((ROOT/'supabase/migrations').glob('*.sql')))
        files=admitted['prefix205']+[ROOT/'supabase/migrations'/admitted['binding206']['filename']]
        runtime.start(files)
        runtime.query(package['preflight_sql'])
        before=capture.snapshot(runtime.query);capture.baseline(before,package)
        owned.save(folder,'canonical206-before',before)
        retained.install_proof(runtime,package,before)
        outcomes['metadata_reference']=True
        owned.save(folder,'reference-phases',outcomes)
        if args.candidate_inputs:
            outcomes['configuration_inputs']=diagnostic(runtime,package,stages,inventory,wanted,phased,owned,capture)
            owned.save(folder,'reference-phases',outcomes)
        verify_saved(folder,frozen,ROOT,owned.source_inputs());complete=True
    except BaseException as exc:
        error=type(exc).__name__+': '+str(exc)
        (folder/'failure.txt').write_text(traceback.format_exc())
        raise
    finally:
        try:
            runtime.cleanup();verify_saved(folder,frozen,ROOT,owned.source_inputs())
        except BaseException as exc:
            error=(error or '')+' cleanup: '+str(exc);raise
        finally:
            passed=completion(complete,error,runtime.record['removed'],time.monotonic(),deadline)
            owned.save(folder,'result',dict(kind='private-configuration-input-reference-v1',passed=passed,acceptance=False,
                workload_seconds=600,emergency_cleanup_seconds=180,elapsed_seconds=round(time.monotonic()-start,3),
                all_owned_cleanup_verified=runtime.record['removed'],source_input_count=len(frozen),
                source_map_sha256=sha((folder/'source-hashes.json').read_bytes()),independent_expected_sha256=package['expected_sha256'],
                install_sha256=package['install_sha256'],outcomes=outcomes,admitted_artifact=False,publication=False,
                auth_acceptance=False,clinical_activation=False,hosted_writes=0,error=error))
    assert passed,'Workload/cleanup/source proof incomplete'
    print('PASS unadmitted reference/diagnostic: '+str(folder/'result.json'),flush=True)


if __name__=='__main__':main()
