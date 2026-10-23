"""Bounded actual CLI205 reference and empty/populated205→206 atomicity proof.

Synthetic owned local runtime only. Reference observations never become expected
metadata. Measurement is separate from acceptance and never installs hosted SQL.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
import uuid

from canonical_review_prefix import admit_canonical206
from canonical_post206 import snapshot,verify_reference205
from secondary_review_cli_body import check_cli_body
from secondary_review_release import parent_checks_sql
from secondary_review_cli_atomicity import rehearse
from secondary_review_gate_a import native_fixture

SOURCE=Path(__file__).resolve().parent
root=SOURCE.parents[3]
spec=importlib.util.spec_from_file_location('review_cli_base',SOURCE/'probe-secondary-review.py')
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
REFERENCE_WORKLOAD_SECONDS=600
MEASUREMENT_WORKLOAD_SECONDS=1200
ACCEPTANCE_WORKLOAD_SECONDS=1800
CLEANUP_RESERVE_SECONDS=180


def source_inputs():
    paths=set((root/'supabase/migrations').glob('*.sql'))
    paths.update(p for p in SOURCE.rglob('*')if p.is_file()and '__pycache__'not in p.parts and (p.suffix in ('.py','.sql','.json','.ts')or p.name=='LICENSE'))
    paths.update((SOURCE.parent/'release').glob('*.sql'))
    paths.update(root/'tests/controlled-drugs'/n for n in ('owned_scheduler.py',))
    paths.update((root/'supabase/tests').glob('*.py'))
    paths.update((root/'supabase/tests').glob('*.sql'))
    paths.update((SOURCE.parent/n)for n in ('source-reader.sql','source-effects.sql'))
    paths.add(root/'.github/workflows/ci.yml')
    return {**{str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest()for p in sorted(paths)},
            **base.source_inputs()}


def save(name,value):
    (folder/(name+'.json')).write_text(json.dumps(value,sort_keys=True,indent=2)+'\n')


def verify():
    actual=runtime.verify()
    assert actual['Id']==container_id,'Immutable owned server identity changed'
    assert (runtime.project/'supabase/config.toml').read_bytes()==config_bytes
    return actual


def command(argv,*,query=None,timeout=180,checked=True):
    verify()
    return runtime.command(argv,text=query,timeout=timeout,fail=checked)


def sql(query):
    verify()
    return runtime.query(query)


def observer_json(output):
    from secondary_review_ledger import unique
    lines=[line for line in output.splitlines()if line.strip()]
    assert len(lines)==1,'Exactly one observer JSON value required'
    value=json.loads(lines[0],object_pairs_hook=unique)
    assert isinstance(value,(dict,list)),'Observer must return an object or array'
    return value


def json_sql(query):
    return observer_json(sql(query))


def run_cli(case, body):
    assert case in ('late_body', 'ledgerfault', 'clean206', 'clean206_retry')
    verify()
    assert isinstance(body, str)
    if case != 'late_body':
        assert body.encode() == (root / binding['canonical_path']).read_bytes(), 'Actual canonical migration bytes required'
    migration = project / 'supabase/migrations' / migration_name
    migration.write_bytes(body.encode())
    digest = hashlib.sha256(migration.read_bytes()).hexdigest()
    if case != 'late_body':
        assert digest == binding['body_sha256'], 'Exact reviewed CLI body required'
    (folder / (case + '-migration.sql')).write_bytes(migration.read_bytes())
    argv = ['supabase', 'migration', 'up', '--local', '--workdir', str(project), '--yes', '--output-format', 'json']
    gate = None
    cli = None
    gate_backend = None
    observation = None
    observed = None
    gate_name = 'controlled_cli_gate_' + uuid.uuid4().hex
    cli_stdout=(folder/(case+'-stream-stdout.log')).open('x')
    cli_stderr=(folder/(case+'-stream-stderr.log')).open('x')
    try:
        if case in ('ledgerfault', 'clean206'):
            verify()
            gate = subprocess.Popen(
                ['docker', 'exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres',
                 '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
            gate.stdin.write("set application_name='" + gate_name + "';\n"
                             'select pg_advisory_lock(90271042,0);\n')
            gate.stdin.flush()
            deadline = time.monotonic() + runtime.remaining(20)
            while time.monotonic() < deadline:
                assert gate.poll() is None, 'Owned gate backend exited before observation'
                rows = json_sql("select coalesce(jsonb_agg(jsonb_build_object('pid',a.pid,"
                                "'backend_start',a.backend_start)),'[]')from pg_stat_activity a "
                                "where a.application_name='" + gate_name + "'and a.datname='postgres'"
                                "and exists(select 1 from pg_locks l where l.pid=a.pid "
                                "and l.locktype='advisory'and l.classid=90271042 and l.objid=0 "
                                "and l.objsubid=2 and l.mode='ExclusiveLock'and l.granted);")
                if len(rows) == 1:
                    gate_backend = rows[0]
                    break
                time.sleep(.05)
            assert gate_backend is not None, 'Owned gate lock was not observed'
            cli = subprocess.Popen(argv, stdout=cli_stdout, stderr=cli_stderr,
                                   text=True, cwd=root)
            deadline = time.monotonic() + runtime.remaining(120)
            observed = None
            while time.monotonic() < deadline:
                assert gate.poll() is None, 'Owned gate released prematurely'
                assert cli.poll() is None, 'CLI exited before ledger insertion was observed'
                rows = json_sql("select coalesce(jsonb_agg(jsonb_build_object('pid',a.pid,"
                                "'backend_start',a.backend_start,'query_start',a.query_start)),'[]')"
                                "from pg_stat_activity a where a.datname='postgres'"
                                "and a.wait_event_type='Lock'and a.wait_event='advisory'"
                                "and " + str(gate_backend['pid']) + "=any(pg_blocking_pids(a.pid))"
                                "and exists(select 1 from pg_locks l where l.pid=a.pid "
                                "and l.locktype='advisory'and l.classid=90271042 and l.objid=0 "
                                "and l.objsubid=2 and not l.granted)"
                                "and exists(select 1 from pg_locks l where l.pid=a.pid "
                                "and l.locktype='advisory'and l.classid=90271040 and l.objid=0 "
                                "and l.objsubid=2 and l.mode='ExclusiveLock'and l.granted);")
                if len(rows) == 1:
                    observed = rows[0]
                    break
                time.sleep(.05)
            assert observed is not None, 'Actual CLI ledger backend/barrier wait not observed'
            assert sql('select pg_try_advisory_xact_lock_shared(90271040,0);').strip() == 'f', \
                'Independent shared barrier acquisition unexpectedly succeeded'
            # Correlate the same live backend and blocker again before releasing
            # the gate; stale PID observations cannot authorize success.
            stable = json_sql("select coalesce(jsonb_agg(jsonb_build_object('pid',a.pid,"
                              "'backend_start',a.backend_start,'query_start',a.query_start)),'[]')"
                              "from pg_stat_activity a where a.pid=" + str(observed['pid']) +
                              ' and ' + str(gate_backend['pid']) + '=any(pg_blocking_pids(a.pid));')
            assert stable == [observed] and cli.poll() is None and gate.poll() is None
            locks = json_sql("select jsonb_build_object('locks',(select jsonb_agg(to_jsonb(l))from pg_locks l where l.pid=" + str(observed['pid']) + "),'blockers',pg_blocking_pids(" + str(observed['pid']) + "));")
            (folder / (case + '-private-observer.json')).write_text(
                json.dumps({'gate': gate_backend, 'cli': observed, 'actual_locks_and_blockers': locks}, indent=2) + '\n')
            verify()
            gate.stdin.write('select pg_advisory_unlock(90271042,0);\n\\q\n')
            gate.stdin.close()
            gate.wait(timeout=20)
            assert gate.returncode == 0, 'Owned gate session did not close cleanly'
            cli.wait(timeout=runtime.remaining(180))
            cli_stdout.flush();cli_stderr.flush()
            output=(folder/(case+'-stream-stdout.log')).read_text()
            errors=(folder/(case+'-stream-stderr.log')).read_text()
            assert sql("select count(*)from pg_stat_activity where application_name='" + gate_name + "';").strip() == '0', 'Owned gate backend remains'
            result = subprocess.CompletedProcess(argv, cli.returncode, output, errors)
            observation = dict(ledger_backend_wait_observed=True,
                               engine_exclusive_lock_observed=True,
                               independent_shared_lock_refused=True,
                               same_owned_database_verified=True,
                               gate_released=True, observer_closed=True)
        else:
            result = command(argv, checked=False)
        log.write('ACTUAL CLI CASE ' + case + '\n' + result.stdout + result.stderr + '\n')
        log.flush()
        (folder / (case + '-cli.log')).write_text(result.stdout + result.stderr)
        (folder / (case + '-binding.json')).write_text(json.dumps(
            {'case': case, 'migration_version': version, 'migration_filename': migration_name,
             'migration_sha256': digest, 'returncode': result.returncode,
             'barrier_observation': observation}, indent=2) + '\n')
        assert hashlib.sha256(migration.read_bytes()).hexdigest() == digest
        return {'result': result, 'barrier_observation': observation}
    finally:
        primary = sys.exc_info()[1]
        cleanup_errors = []

        def cleanup(action):
            try:
                action()
            except BaseException as error:
                cleanup_errors.append(error)

        if cli is not None and cli.poll() is None:
            if observed is not None:
                cleanup(lambda: sql("select pg_terminate_backend(pid)from pg_stat_activity where pid=" +
                                    str(observed['pid']) + " and datname='postgres'and backend_start='" +
                                    observed['backend_start'].replace("'", "''") + "'::timestamptz;"))
            if cli.poll() is None:
                cleanup(cli.terminate)
            try:
                cli.communicate(timeout=10)
            except subprocess.TimeoutExpired:
                cleanup(cli.kill)
                cleanup(lambda: cli.communicate(timeout=10))
            except BaseException as error:
                cleanup_errors.append(error)
        if gate is not None and gate.poll() is None:
            # Terminate only this marked backend in this label-verified server.
            if gate_backend is not None:
                cleanup(lambda: sql("select pg_terminate_backend(pid)from pg_stat_activity where pid=" +
                                    str(gate_backend['pid']) + " and application_name='" + gate_name +
                                    "'and backend_start='" + gate_backend['backend_start'].replace("'", "''") + "'::timestamptz;"))
            if gate.poll() is None:
                cleanup(gate.terminate)
            cleanup(lambda: gate.wait(timeout=10))
        if gate is not None and gate.stderr is not None:
            cleanup(gate.stderr.close)
        cleanup(cli_stdout.close)
        cleanup(cli_stderr.close)
        if cleanup_errors:
            if primary is None:
                raise cleanup_errors[0]
            for error in cleanup_errors:
                primary.add_note('Owned CLI child cleanup failed: ' + type(error).__name__)

def planned_cases(mode):
    assert mode in ('reference','measurement','acceptance')
    return {'reference':('reference',),'measurement':('empty205','populated205'),
            'acceptance':('reference','empty205','populated205')}[mode]


def completed_coverage(mode,outcomes):
    expected=planned_cases(mode)
    assert len(outcomes)==len(expected),'All mandatory phases must complete'
    for case,outcome in zip(expected,outcomes):
        if case=='reference':
            assert outcome['kind']=='controlled-review-cli205-reference-v1'and outcome['passed']is True
            assert outcome['ledger_rows']==205 and outcome['retained205_statement_count']==94
        else:
            assert outcome['case']==case
            proof=outcome['proof']
            assert proof['kind']=='controlled-review-cli206-atomicity-v1'and proof['passed']is True
            assert proof['exact_retry_noop']is True and proof['private_acl_and_empty_operations_verified_before_after_retry']is True
            assert proof['retained205_statement_count']==94 and proof['installed206_statement_count']==304
            assert proof['original205_rows_preserved']is True
            assert proof['failures']==[dict(case=n,sqlstate='P0001',armed_full_rollback=True,cleaned_baseline_exact=True)for n in ('late_body','ledgerfault')]
            assert all(f['armed_full_rollback']is True and f['cleaned_baseline_exact']is True for f in proof['failures'])
            if case=='empty205':
                clones=proof['attachment206_clones']
                assert [c['helper']for c in clones]==['ezyvet_attachment_metadata_concurrency.py','ezyvet_attachment_originals_concurrency.py']
                assert all(c['passed']is True and c['source_full_snapshot_unchanged']is True and c['private206_empty_schema_data_restored']is True for c in clones)
    return True


def acceptance_deadline_check(now,phase_deadline,combined_deadline):
    # Called AFTER normal cleanup: emergency teardown reserves never authorize
    # an acceptance success beyond either phase or combined wall-clock cap.
    assert now<phase_deadline and now<combined_deadline,'Acceptance phase/combined deadline exceeded including cleanup'


def main():
    global runtime,folder,project,container,container_id,config_bytes,binding,version,migration_name,log
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-synthetic-local',action='store_true',required=True)
    modes=parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--reference',action='store_true')
    modes.add_argument('--measurement',action='store_true')
    modes.add_argument('--acceptance',action='store_true')
    parser.add_argument('--reference-evidence',type=Path)
    args=parser.parse_args()
    assert args.measurement == (args.reference_evidence is not None),'Only measurement requires a separate reference evidence folder'
    mode='acceptance'if args.acceptance else('reference'if args.reference else'measurement')
    os.umask(0o077)
    admitted=admit_canonical206(SOURCE,sorted((root/'supabase/migrations').glob('*.sql')))
    package=check_cli_body(SOURCE)
    parent=json.loads((SOURCE/'release-expected-204.json').read_text())
    frozen=source_inputs()
    evidence=Path(tempfile.mkdtemp(prefix='lrv-review-cli206-evidence-'))
    (evidence/'executed-inputs').mkdir()
    for name,digest in frozen.items():
        target=evidence/'executed-inputs'/name;target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(root/name,target)
        assert hashlib.sha256(target.read_bytes()).hexdigest()==digest
    (evidence/'source-hashes.json').write_text(json.dumps(frozen,sort_keys=True,indent=2)+'\n')
    if args.measurement:
        reference=args.reference_evidence.resolve()
        receipt=json.loads((reference/'result.json').read_text())
        assert receipt['kind']=='controlled-review-cli205-reference-run-v1'and receipt['passed']is True and receipt['all_owned_cleanup_verified']is True
        assert json.loads((reference/'source-hashes.json').read_text())==frozen,'Reference must bind these exact proof/source bytes'
        actual=json.loads((reference/'reference'/'actual205.json').read_text())
        verify_reference205(actual,package,parent)
        for name,digest in frozen.items():
            assert hashlib.sha256((reference/'executed-inputs'/name).read_bytes()).hexdigest()==digest
        (evidence/'reference-binding.json').write_text(json.dumps({'path':str(reference),'result_sha256':hashlib.sha256((reference/'result.json').read_bytes()).hexdigest()},indent=2)+'\n')
    started=time.monotonic()
    budget=ACCEPTANCE_WORKLOAD_SECONDS if args.acceptance else(REFERENCE_WORKLOAD_SECONDS if args.reference else MEASUREMENT_WORKLOAD_SECONDS)
    deadline=started+budget
    outcomes=[];runtimes=[];error=None;complete=False;reference_handshake=False
    phase_deadline=started+REFERENCE_WORKLOAD_SECONDS if args.acceptance else deadline
    phase_elapsed={};phase_started=started
    print('Protected evidence: '+str(evidence),flush=True)
    try:
        for case in planned_cases(mode):
            if args.acceptance and case!='reference':
                assert reference_handshake,'Verified separate reference cleanup must precede206 execution'
            folder=evidence/case;folder.mkdir()
            remaining=min(deadline,phase_deadline)-time.monotonic();assert remaining>0
            runtime=base.OwnedRuntime(folder,workload_seconds=remaining)
            runtimes.append(runtime)
            try:
                runtime.start(admitted['prefix205'])
                actual=runtime.verify();container_id=actual['Id']
                runtime.container=container_id
                config_bytes=(runtime.project/'supabase/config.toml').read_bytes()
                project=runtime.project;container=container_id;log=runtime.log
                binding=admitted['binding206'];version=binding['version'];migration_name=binding['filename']
                sql(parent_checks_sql(parent))
                before=snapshot(sql);save('actual205',before)
                reference_result=verify_reference205(before,package,parent)
                if case=='reference':
                    outcomes.append(reference_result)
                else:
                    if case=='populated205':
                        smoke=(SOURCE/'smoke.sql').read_text();assert smoke.endswith('rollback;\n')
                        sql(smoke[:-len('rollback;\n')]+'commit;\n')
                        native_fixture(runtime,SOURCE)
                        populated=snapshot(sql);save('populated205',populated)
                        counts={name:len(rows)for name,rows in populated['rows'].items()if name.startswith('public.controlled_stock_')}
                        assert counts['public.controlled_stock_events']>=3 and counts['public.controlled_stock_preparations']>0
                        assert counts['public.controlled_stock_actions']>0
                        assert all(row['receipt'] for row in populated['rows']['public.controlled_stock_actions'])
                        save('populated-counts',counts)
                    case_proof=rehearse(sql,run_cli,SOURCE,binding,parent,save)
                    if case=='empty205':
                        clones=[]
                        for helper in ('ezyvet_attachment_metadata_concurrency.py','ezyvet_attachment_originals_concurrency.py'):
                            label=helper.removesuffix('.py')
                            clone_before=snapshot(sql);save(label+'-source-before',clone_before)
                            child=runtime.command([sys.executable,'-B',str(root/'supabase/tests'/helper),
                                '--run-synthetic-local','--project-config',str(project/'supabase/config.toml'),
                                '--canonical-baseline','206'],timeout=450)
                            (folder/(label+'-stdout.log')).write_text(child.stdout)
                            (folder/(label+'-stderr.log')).write_text(child.stderr)
                            clone_after=snapshot(sql);save(label+'-source-after',clone_after)
                            assert clone_after==clone_before,'206 attachment rehearsal changed original selected catalogs/rows'
                            clones.append(dict(helper=helper,passed=True,source_full_snapshot_unchanged=True,
                                               private206_empty_schema_data_restored=True))
                        case_proof['attachment206_clones']=clones
                    outcomes.append(dict(case=case,proof=case_proof))
                    print('Completed '+case+' CLI failure/clean/no-op matrix.',flush=True)
            finally:
                runtime.cleanup()
            if args.acceptance:
                acceptance_deadline_check(time.monotonic(),phase_deadline,deadline)
                if case=='reference':
                    assert runtime.record['removed']is True,'Reference cleanup must complete before matrix'
                    assert source_inputs()==frozen,'Reference source inventory changed before matrix'
                    for name,digest in frozen.items():
                        assert hashlib.sha256((evidence/'executed-inputs'/name).read_bytes()).hexdigest()==digest
                    retained=json.loads((folder/'actual205.json').read_text())
                    assert retained==before,'Retained reference observation changed'
                    verify_reference205(retained,package,parent)
                    acceptance_deadline_check(time.monotonic(),phase_deadline,deadline)
                    reference_handshake=True
                    phase_elapsed['reference_including_cleanup']=round(time.monotonic()-phase_started,3)
                    phase_started=time.monotonic()
                    phase_deadline=min(deadline,phase_started+MEASUREMENT_WORKLOAD_SECONDS)
                    save('acceptance-reference-handshake',dict(passed=True,cleanup_verified=True,
                         source_bytes_verified=True,actual_ledger_sha256=reference_result['actual_ledger_sha256']))
                elif case=='populated205':
                    phase_elapsed['matrix_including_cleanup']=round(time.monotonic()-phase_started,3)
            elif not args.reference:
                assert time.monotonic()<deadline,'Declared workload deadline exceeded'

        assert source_inputs()==frozen,'Exact source inventory changed during proof'
        assert all(r.record['removed']is True for r in runtimes)
        completed_coverage(mode,outcomes)
        if args.acceptance:
            acceptance_deadline_check(time.monotonic(),phase_deadline,deadline)
            assert reference_handshake
            phase_elapsed['matrix_including_cleanup']=round(time.monotonic()-phase_started,3)
        complete=True
    except BaseException as exc:
        error=type(exc).__name__+': '+str(exc)
        (evidence/'failure.txt').write_text(traceback.format_exc())
        raise
    finally:
        passed=error is None and complete
        result=dict(kind='controlled-review-cli206-acceptance-v1'if args.acceptance else('controlled-review-cli205-reference-run-v1'if args.reference else 'controlled-review-cli206-measurement-v1'),
                    passed=passed,acceptance=args.acceptance and passed,
                    workload_seconds=budget,cleanup_reserve_seconds=CLEANUP_RESERVE_SECONDS,
                    elapsed_seconds=round(time.monotonic()-started,3),outcomes=outcomes,
                    acceptance_phase_elapsed_seconds=phase_elapsed,
                    acceptance_phase_caps_seconds={'reference':600,'matrix':1200}if args.acceptance else None,
                    normal_cleanup_in_acceptance_phase_caps=args.acceptance,
                    separate_reference_cleanup_handshake=reference_handshake,
                    all_owned_cleanup_verified=all(r.record['removed']is True for r in runtimes),
                    populated_case_kind='genuine_committed205_managed_and_native_history',
                    pre_engine187_188_history_claim=False,populated_review206_dump_restore_claim=False,
                    empty_private206_attachment_clone_restore_proven=not args.reference and error is None,
                    hosted_writes=0,provider_requests=0,clinical_or_register_activation=False,error=error)
        (evidence/'result.json').write_text(json.dumps(result,sort_keys=True,indent=2)+'\n')
    assert result['passed']and result['all_owned_cleanup_verified']
    print('PASS: '+result['kind']+('; full acceptance. 'if args.acceptance else'; not an acceptance claim. ')+str(evidence/'result.json'),flush=True)


if __name__=='__main__':main()
