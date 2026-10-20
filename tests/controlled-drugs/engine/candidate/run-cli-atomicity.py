"""Actual CLI transaction proof in an owned 204 replay; no hosted operations."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import uuid

from cli_migration_body import build_cli_body
from cli_atomicity import capture_baseline, rehearse
from local_install import build_install


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--run-synthetic-local', action='store_true', required=True)
parser.parse_args()
os.umask(0o077)
source = Path(__file__).resolve().parent
root = source.parents[3]
identity = 'lrv-controlled-cli-' + uuid.uuid4().hex[:10]
work = Path(tempfile.mkdtemp(prefix=identity + '-'))
project = work / 'project'
folder = Path(tempfile.mkdtemp(prefix=identity + '-evidence-'))
container = 'supabase_db_' + identity
version = '20261020090000'
migration_name = version + '_controlled_stock_cli_atomicity.sql'
log = (folder / 'runner.log').open('w')
started = False
proof = None
runtime = {'identity': identity, 'project': str(project), 'root': str(root),
           'canonical_migration_count': 204, 'temporary_migration_version': version,
           'repository_canonical_migration_added': False, 'removed': False}


def command(argv, *, query=None, timeout=180, checked=True):
    result = subprocess.run(argv, input=query, capture_output=True, text=True,
                            cwd=root, timeout=timeout)
    log.write('COMMAND ' + argv[0] + '\n' +
              ('[Owned container inspection withheld]\n' if argv[:2] == ['docker', 'inspect']
               else result.stdout + result.stderr) + '\n')
    log.flush()
    if checked and result.returncode:
        raise RuntimeError('Owned CLI atomicity command failed; protected logs retained')
    return result


def verify():
    labels = json.loads(command(['docker', 'inspect', container]).stdout)[0]['Config']['Labels']
    assert labels['com.supabase.cli.project'] == identity
    assert Path(labels['com.supabase.cli.workdir']).resolve() == project.resolve()


def sql(query):
    verify()
    return command(['docker', 'exec', '-i', container, 'psql', '-X', '-qAt',
                    '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1',
                    '-v', 'VERBOSITY=verbose'], query=query).stdout


def json_sql(query):
    lines = [line for line in sql(query).splitlines() if line.strip()]
    assert len(lines) == 1, 'Exactly one owned observer result required'
    return json.loads(lines[0])


def run_cli(case, body):
    assert case in ('late_body', 'ledgerfault', 'clean205', 'clean205_retry')
    verify()
    assert isinstance(body, str)
    migration = project / 'supabase/migrations' / migration_name
    migration.write_bytes(body.encode())
    digest = hashlib.sha256(migration.read_bytes()).hexdigest()
    if case != 'late_body':
        assert digest == '9977696d3d6271cbbfe1dee3767dd71b8512d55bcec0c0d65d108745726252b3', 'Exact reviewed CLI body required'
    (folder / (case + '-migration.sql')).write_bytes(migration.read_bytes())
    argv = ['supabase', 'migration', 'up', '--local', '--workdir', str(project), '--yes', '--output-format', 'json']
    gate = None
    cli = None
    gate_backend = None
    observation = None
    observed = None
    gate_name = 'controlled_cli_gate_' + uuid.uuid4().hex
    try:
        if case in ('ledgerfault', 'clean205'):
            verify()
            gate = subprocess.Popen(
                ['docker', 'exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres',
                 '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
            gate.stdin.write("set application_name='" + gate_name + "';\n"
                             'select pg_advisory_lock(90271041,0);\n')
            gate.stdin.flush()
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                assert gate.poll() is None, 'Owned gate backend exited before observation'
                rows = json_sql("select coalesce(jsonb_agg(jsonb_build_object('pid',a.pid,"
                                "'backend_start',a.backend_start)),'[]')from pg_stat_activity a "
                                "where a.application_name='" + gate_name + "'and a.datname='postgres'"
                                "and exists(select 1 from pg_locks l where l.pid=a.pid "
                                "and l.locktype='advisory'and l.classid=90271041 and l.objid=0 "
                                "and l.objsubid=2 and l.mode='ExclusiveLock'and l.granted);")
                if len(rows) == 1:
                    gate_backend = rows[0]
                    break
                time.sleep(.05)
            assert gate_backend is not None, 'Owned gate lock was not observed'
            cli = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   text=True, cwd=root)
            deadline = time.monotonic() + 120
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
                                "and l.locktype='advisory'and l.classid=90271041 and l.objid=0 "
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
            (folder / (case + '-private-observer.json')).write_text(
                json.dumps({'gate': gate_backend, 'cli': observed}, indent=2) + '\n')
            verify()
            gate.stdin.write('select pg_advisory_unlock(90271041,0);\n\\q\n')
            gate.stdin.close()
            gate.wait(timeout=20)
            assert gate.returncode == 0, 'Owned gate session did not close cleanly'
            output, errors = cli.communicate(timeout=180)
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
        if cleanup_errors:
            if primary is None:
                raise cleanup_errors[0]
            for error in cleanup_errors:
                primary.add_note('Owned CLI child cleanup failed: ' + type(error).__name__)


files = sorted((root / 'supabase/migrations').glob('*.sql'))
assert len(files) == 204
inputs = [*files, *sorted(source.glob('*.sql')), *sorted(source.glob('*.py')),
          source / 'trusted-prior-189.json', source / 'release-expected-204.json',
          source / 'release-expected-204-v1.json', source.parent / 'source-reader.sql',
          source.parent / 'source-effects.sql', source.parent / 'release/controlled-stock-private.sql',
          source.parent / 'release/controlled-stock-cli-body.sql',
          root / 'tests/controlled-drugs/owned_scheduler.py', root / '.github/workflows/ci.yml']
hashes = {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs}
(folder / 'source-hashes.json').write_text(json.dumps(hashes, indent=2) + '\n')
(folder / 'executable-snapshots').mkdir()
for name in ('run-cli-atomicity.py', 'cli_atomicity.py', 'cli_migration_body.py'):
    shutil.copy2(source / name, folder / 'executable-snapshots' / name)
try:
    body = build_cli_body(source, files)
    assert (source.parent / 'release/controlled-stock-cli-body.sql').read_bytes() == body['body'].encode()
    assert command(['supabase', '--version']).stdout.strip() == '2.118.0'
    for port in (65020, 65021, 65022, 65024):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', port))
    (project / 'supabase/migrations').mkdir(parents=True)
    for path in files:
        shutil.copy2(path, project / 'supabase/migrations' / path.name)
    (project / 'supabase/config.toml').write_text(f'''project_id = "{identity}"
[api]
port = 65021
[db]
port = 65022
shadow_port = 65020
major_version = 17
[studio]
enabled = false
[analytics]
enabled = false
[inbucket]
port = 65024
[auth]
site_url = "http://127.0.0.1:65021"
enable_signup = false
[storage]
enabled = true
[edge_runtime]
enabled = false
''')
    (folder / 'runtime.json').write_text(json.dumps(runtime, indent=2) + '\n')
    print('Protected evidence: ' + str(folder), flush=True)
    print('Starting owned CLI atomicity stack; repository migrations remain 204.', flush=True)
    started = True
    command(['supabase', 'start', '--workdir', str(project), '--exclude',
             'realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'], timeout=600)
    verify()
    actual_container = json.loads(command(['docker', 'inspect', container]).stdout)[0]
    runtime['postgres_image_ref'] = actual_container['Config']['Image']
    runtime['postgres_image_id'] = actual_container['Image']
    runtime['postgres_image_repo_digests'] = json.loads(command(
        ['docker', 'image', 'inspect', '--format', '{{json .RepoDigests}}',
         actual_container['Image']]).stdout)
    runtime['postgres_version'] = sql('select version();').strip()
    (folder / 'runtime.json').write_text(json.dumps(runtime, indent=2) + '\n')
    command(['docker', 'exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'supabase_admin',
             '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], query=
            'alter system set cron.launch_active_jobs=off;select pg_reload_conf();')
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if sql("select current_setting('cron.launch_active_jobs')='off'and not exists("
               "select 1 from pg_stat_activity where application_name='pg_cron'and state='active');").strip() == 't':
            break
        time.sleep(.05)
    else:
        raise RuntimeError('Owned scheduler pause did not settle')
    assert sql('select count(*)from auth.users;').strip() == '0'
    bundle = build_install(source, files)
    baseline = capture_baseline(sql, bundle['prior_sql'], bundle['trusted'])
    (folder / 'private-baseline.json').write_text(json.dumps(baseline, indent=2) + '\n')
    expected = json.loads((source / 'release-expected-204.json').read_text())
    proof = rehearse(sql, run_cli, body['body'], expected, baseline, migration_version=version,
                     migration_name='controlled_stock_cli_atomicity',
                     expected_statements=body['expected_statements'])
    assert proof.get('passed') is True, 'Actual CLI atomicity proof incomplete'
    for name, digest in hashes.items():
        assert hashlib.sha256((root / name).read_bytes()).hexdigest() == digest, 'CLI proof source changed'
    proof.update(source_hashes=hashes, supabase_cli='2.118.0', body_sha256=body['body_sha256'],
                 artifact_sha256=body['artifact_sha256'], pin_sha256=body['pin_sha256'],
                 repository_canonical_migration_count=204, canonical_migration=False,
                 hosted_writes=0, provider_requests=0, clinical_or_register_activation=False)
finally:
    try:
        if started:
            names = command(['docker', 'ps', '-a', '--filter',
                             'label=com.supabase.cli.project=' + identity, '--format', '{{.Names}}']).stdout.splitlines()
            for name in names:
                labels = json.loads(command(['docker', 'inspect', name]).stdout)[0]['Config']['Labels']
                assert labels['com.supabase.cli.project'] == identity
                assert Path(labels['com.supabase.cli.workdir']).resolve() == project.resolve()
            command(['supabase', 'stop', '--workdir', str(project), '--no-backup'])
            for argv in (['docker', 'ps', '-a', '--filter', 'label=com.supabase.cli.project=' + identity,
                          '--format', '{{.Names}}'], ['docker', 'volume', 'ls', '--filter',
                                                    'label=com.supabase.cli.project=' + identity, '--format', '{{.Name}}']):
                assert not command(argv).stdout.strip(), 'Owned CLI runtime cleanup incomplete'
            runtime['removed'] = True
            (folder / 'runtime.json').write_text(json.dumps(runtime, indent=2) + '\n')
        shutil.rmtree(work)
    finally:
        log.close()
assert runtime['removed'] is True and proof and proof.get('passed') is True
proof['owned_containers_and_volumes_removed'] = True
(folder / 'result.json').write_text(json.dumps(proof, indent=2) + '\n')
print('PASS: actual CLI late-body/ledger rollback, clean205 and no-op retry; owned cleanup verified.', flush=True)
print('Sanitized result: ' + str(folder / 'result.json'), flush=True)
