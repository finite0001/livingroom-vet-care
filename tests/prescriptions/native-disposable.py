"""Run native prescribing, refill and dispensing acceptance in an owned disposable local Auth/Storage stack."""
import argparse
import json
import hashlib
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--run-synthetic-local', action='store_true')
parser.add_argument('--decision-sql-only', action='store_true', help='Run the new decision SQL gate, then clean the owned runtime without claiming full acceptance')
parser.add_argument('--additional-migration', action='append', type=Path, default=[], help='Local parallel-development dependency; reject duplicate migration versions')
args = parser.parse_args()
if not args.run_synthetic_local:
    parser.error('Explicit --run-synthetic-local required')
root = Path(__file__).resolve().parents[2]
harnesses = [root / 'tests/prescriptions' / name for name in ['local-lifecycle.ts', 'local-fulfillment.ts', 'local-workspace.ts', 'local-releases.ts', 'local-corrections.ts', 'local-returns.ts', 'local-reconciliation.ts', 'local-finance.ts']]
harnesses.append(root / 'tests/estimates/local-drafts.ts')
harnesses.append(root / 'tests/estimates/local-publications.ts')
harnesses.append(root / 'tests/estimates/local-decisions.ts')
harness_hashes = {}
results = []
identity = 'lrv-prescription-' + uuid.uuid4().hex[:12]
os.umask(0o077)
work = Path(tempfile.mkdtemp(prefix=identity + '-'))
project = work / 'project'
(project / 'supabase/migrations').mkdir(parents=True)
log = (work / 'commands.log').open('w')
started = False
success = False
checks = 0
migration_hashes = {}

def command(argv, timeout=240, **kwargs):
    result = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, **kwargs)
    log.write('COMMAND ' + ' '.join(map(str, argv)) + '\n' + result.stdout + result.stderr + '\n')
    log.flush()
    if result.returncode:
        raise RuntimeError('Disposable local command failed; inspect protected log: ' + str(work / 'commands.log'))
    return result.stdout

def verify_identity():
    assert (project / 'supabase/config.toml').read_text().startswith('project_id = "' + identity + '"\n')
    probe = subprocess.run(['docker', 'inspect', 'supabase_db_' + identity], capture_output=True, text=True)
    if not probe.returncode:
        labels = json.loads(probe.stdout)[0]['Config']['Labels']
        assert labels['com.supabase.cli.project'] == identity
        assert Path(labels['com.supabase.cli.workdir']).resolve() == project.resolve()

try:
    for port in [63520, 63521, 63522, 63524]:
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', port))
    assert not command(['docker', 'ps', '-a', '--filter', 'name=' + identity, '--format', '{{.Names}}']).splitlines(), 'Refuse existing matching containers'
    assert not any(v.endswith('_' + identity) for v in command(['docker', 'volume', 'ls', '--format', '{{.Name}}']).splitlines()), 'Refuse existing matching volumes'
    versions = set()
    for migration in sorted((root / 'supabase/migrations').glob('*.sql')) + args.additional_migration:
        version = migration.name.split('_')[0]
        assert version.isdigit() and len(version) == 14 and version not in versions, 'Duplicate or malformed migration overlay'
        versions.add(version)
        migration_hashes[migration.name] = hashlib.sha256(migration.read_bytes()).hexdigest()
        shutil.copy2(migration, project / 'supabase/migrations' / migration.name)
    assert {'20260916100001','20260916110001','20260916120000','20260916130000','20260916123017'} <= versions, 'Combined communication attachment migrations required'
    # 151 through 20260926031324_restore_verified_contact_intake_boundary.sql. This count is a tripwire:
    # review it deliberately whenever the migration inventory changes.
    assert len(versions) == 151 and {'20260916055043','20260916062136','20260916063857','20260916070108','20260916072509','20260916080105','20260916083056','20260916090000','20260916093000','20260916094500','20260916100000','20260916110000','20260916120716','20260916123017','20260916144117','20260924120000','20260924130000','20260926031324'} <= versions, 'Canonical native prescription migration inventory required'
    (project / 'supabase/config.toml').write_text(f'''project_id = "{identity}"
[api]
port = 63521
[db]
port = 63522
shadow_port = 63520
major_version = 17
[studio]
enabled = false
[analytics]
enabled = false
[inbucket]
port = 63524
[auth]
site_url = "http://127.0.0.1:63521"
enable_signup = false
[storage]
enabled = true
[edge_runtime]
enabled = false
''')
    print('Starting owned disposable prescription project; no hosted or provider operations.', flush=True)
    started = True
    command(['supabase', 'start', '--workdir', str(project), '--exclude', 'realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'], timeout=600)
    verify_identity()
    runtime_status_path = root / 'tests/estimates/owned-runtime-status.ts'
    runtime_status_hash = hashlib.sha256(runtime_status_path.read_bytes()).hexdigest()
    command(['node', '--experimental-strip-types', '--input-type=module', '-e',
             "import { readOwnedRuntimeStatus } from './tests/estimates/owned-runtime-status.ts'; readOwnedRuntimeStatus(process.argv[1]); console.log('Owned runtime status validated; credentials withheld.');",
             str(project)], cwd=root)
    print('Owned runtime status preflight passed.', flush=True)
    decision_sql = root / 'supabase/tests/native_estimate_decisions.test.sql'
    decision_sql_hash = hashlib.sha256(decision_sql.read_bytes()).hexdigest()
    command(['supabase', 'test', 'db', str(decision_sql), '--workdir', str(project)], cwd=root)
    assert hashlib.sha256(decision_sql.read_bytes()).hexdigest() == decision_sql_hash
    print('Estimate decision SQL invariants passed.', flush=True)
    if args.decision_sql_only:
        raise SystemExit(0)
    decision_races = root / 'tests/estimates/decision-concurrency.py'
    decision_races_hash = hashlib.sha256(decision_races.read_bytes()).hexdigest()
    decision_race_output = command(['python3', '-B', str(decision_races), '--run-synthetic-local', '--project-config', str(project / 'supabase/config.toml')], cwd=root)
    assert hashlib.sha256(decision_races.read_bytes()).hexdigest() == decision_races_hash
    print(decision_race_output.strip(), flush=True)
    publication_sql = root / 'supabase/tests/native_estimate_publications.test.sql'
    publication_sql_hash = hashlib.sha256(publication_sql.read_bytes()).hexdigest()
    command(['supabase', 'test', 'db', str(publication_sql), '--workdir', str(project)], cwd=root)
    assert hashlib.sha256(publication_sql.read_bytes()).hexdigest() == publication_sql_hash
    print('Estimate publication SQL invariants passed.', flush=True)
    publication_races = root / 'tests/estimates/publication-concurrency.py'
    publication_races_hash = hashlib.sha256(publication_races.read_bytes()).hexdigest()
    race_output = command(['python3', '-B', str(publication_races), '--run-synthetic-local', '--project-config', str(project / 'supabase/config.toml')], cwd=root)
    assert hashlib.sha256(publication_races.read_bytes()).hexdigest() == publication_races_hash
    print(race_output.strip(), flush=True)
    parity_path = root / 'tests/prescriptions/return-replay-parity.py'
    parity_hash = hashlib.sha256(parity_path.read_bytes()).hexdigest()
    replay_parity = json.loads(command(['python3', '-B', str(parity_path), '--run-synthetic-local', '--project-config', str(project / 'supabase/config.toml')], cwd=root))
    assert replay_parity['synthetic_only'] and replay_parity['provider_requests'] == 0 and not replay_parity['persistent_writes'] and replay_parity['project_id'] == identity
    assert hashlib.sha256(parity_path.read_bytes()).hexdigest() == parity_hash
    print('SQL/TypeScript quantity replay: ' + str(replay_parity['cases']) + ' matching cases.', flush=True)
    for harness_path in harnesses:
        assert hashlib.sha256(runtime_status_path.read_bytes()).hexdigest() == runtime_status_hash, 'Runtime status helper changed during execution'
        harness_hash = hashlib.sha256(harness_path.read_bytes()).hexdigest()
        output = command(['node', '--experimental-strip-types', str(harness_path)], env={**os.environ, 'NATIVE_PRESCRIPTION_TEST_PROJECT': str(project)}, cwd=root)
        assert hashlib.sha256(harness_path.read_bytes()).hexdigest() == harness_hash, 'Harness changed during execution'
        result = json.loads(output.strip())
        assert result['synthetic_only'] is True and result['provider_requests'] == 0 and result['project_id'] == identity, 'Unexpected runtime result'
        assert isinstance(result['checks_passed'], int) and result['checks_passed'] > 0
        harness_hashes[harness_path.name] = harness_hash
        results.append({'suite':result['suite'],'checks_passed':result['checks_passed']})
        checks += result['checks_passed']
        print(result['suite'] + ': ' + str(result['checks_passed']) + ' checks passed; no provider requests.', flush=True)
    restore_path = root / 'tests/prescriptions/restore-native.py'
    restore_hash = hashlib.sha256(restore_path.read_bytes()).hexdigest()
    restore = json.loads(command(['python3', '-B', str(restore_path), '--run-synthetic-local', '--project-config', str(project / 'supabase/config.toml')], cwd=root))
    assert restore['project_id'] == identity and restore['cleanup_verified'] and not restore['source_mutated']
    assert restore['verified_dispenses'] > 0 and restore['provider_requests'] == 0
    assert hashlib.sha256(restore_path.read_bytes()).hexdigest() == restore_hash, 'Restore harness changed during execution'
    print('Native populated restore: ' + str(restore['checks_passed']) + ' checks passed; owned clone removed.', flush=True)
    success = True
finally:
    try:
        if started:
            verify_identity()
            command(['supabase', 'stop', '--workdir', str(project), '--no-backup'])
            containers = command(['docker', 'ps', '-a', '--filter', 'name=' + identity, '--format', '{{.Names}}']).splitlines()
            volumes = command(['docker', 'volume', 'ls', '--format', '{{.Name}}']).splitlines()
            assert not containers and not any(v.endswith('_' + identity) for v in volumes), 'Owned disposable resources remain'
            if args.decision_sql_only:
                print('SQL-only owned runtime cleanup verified; full decision acceptance remains pending.', flush=True)
    finally:
        log.close()
if success:
    summary = {'synthetic_only': True, 'fixture': 'native-prescribing-and-fulfillment', 'suites': results, 'project_id': identity, 'checks_passed': checks, 'cleanup_verified': True,
               'git_revision': subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=root, capture_output=True, text=True, check=True).stdout.strip(),
               'runner_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
               'harness_sha256': harness_hashes, 'restore_runner_sha256': restore_hash, 'restore': restore,
               'migration_sha256': migration_hashes, 'provider_requests': 0, 'replay_parity': replay_parity, 'replay_parity_runner_sha256': parity_hash,
               'decision_sql_sha256': decision_sql_hash, 'decision_races_sha256': decision_races_hash, 'publication_sql_sha256': publication_sql_hash, 'publication_races_sha256': publication_races_hash,
               'runtime_status_sha256': runtime_status_hash}
    summary_path = work.parent / (identity + '-result.json')
    summary_path.write_text(json.dumps(summary, indent=2) + '\n')
    shutil.rmtree(work)
    print('Sanitized result: ' + str(summary_path), flush=True)
    print('Disposable project containers, volumes and private temporary files removed; shared foundation untouched.', flush=True)
