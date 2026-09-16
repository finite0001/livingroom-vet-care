"""Run attachment metadata intake acceptance in an owned disposable local Auth/Storage stack."""
import argparse
import json
import hashlib
import re
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import uuid
import time
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--run-synthetic-local', action='store_true')
parser.add_argument('--fixture', choices=['metadata','originals','maximum','migration','all'], default='metadata')
parser.add_argument('--additional-migration', action='append', type=Path, default=[], help='Local parallel-development dependency; reject duplicate migration versions')
parser.add_argument('--extra-sql-test', action='append', type=Path, default=[])
parser.add_argument('--api-port', type=int, default=62421, help='Disjoint local port group; alternate ports supported for migration fixture')
args = parser.parse_args()
if not 1025 <= args.api_port <= 65532 or (args.api_port != 62421 and args.fixture != 'migration'):
    parser.error('Alternate port must be 1025–65532 and use migration fixture')
if not args.run_synthetic_local:
    parser.error('Explicit --run-synthetic-local required')
root = Path(__file__).resolve().parents[2]
fixtures = {
    'migration': ('migration-local-roundtrip.ts', 'Migration manifest HTTP/Auth/PostgREST'),
    'metadata': ('attachment-metadata-local-roundtrip.ts', 'Attachment metadata HTTP/Auth/PostgREST'),
    'originals': ('attachment-original-local-roundtrip.ts', 'Attachment original HTTP/Auth/Storage'),
    'maximum': ('attachment-max-package-roundtrip.mjs', 'Attachment maximum physical packages'),
}
selected = ['metadata','originals','maximum','migration'] if args.fixture == 'all' else [args.fixture]
harness_paths = [root / 'tests/ezyvet' / fixtures[name][0] for name in selected]
identity = 'lrv-attachment-' + uuid.uuid4().hex[:12]
os.umask(0o077)
work = Path(tempfile.mkdtemp(prefix=identity + '-'))
project = work / 'project'
(project / 'supabase/migrations').mkdir(parents=True)
log = (work / 'commands.log').open('w')
started = False
success = False
checks = 0
checks_by_fixture = {}
harness_hashes = {}
migration_hashes = {}
source_paths = [root / 'supabase/tests/ezyvet_migration_resolutions.test.sql', root / 'supabase/tests/ezyvet_migration_resolutions_concurrency.py', root / 'src/hub/features/imports/migration-resolution-api.ts', root / 'src/hub/features/imports/migration-resolution-state.ts', root / 'supabase/tests/ezyvet_migration_identity_evidence.test.sql', root / 'src/hub/features/imports/migration-identity-api.ts', root / 'supabase/tests/ezyvet_migration_weight_evidence.test.sql', root / 'src/hub/features/imports/migration-weight-api.ts', *(p.resolve() for p in args.extra_sql_test), root / 'src/hub/features/imports/migration-prescription-item-api.ts', root / 'src/hub/features/imports/migration-prescription-api.ts', root / 'src/hub/features/imports/migration-vaccination-api.ts', root / 'src/hub/features/imports/migration-history-api.ts', root / 'src/hub/features/imports/migration-resume-api.ts', root / 'src/hub/features/imports/migration-selection-api.ts', root / 'src/hub/features/imports/migration-capture-api.ts', root / 'src/hub/features/imports/migration-items-api.ts', root / 'src/hub/features/imports/migration-run-api.ts', root / 'src/hub/features/imports/attachment-review-history.ts', *sorted((root / 'supabase/functions/_shared').glob('*.ts')), Path(__file__).resolve(), *harness_paths, *sorted((root / 'supabase/functions/ezyvet-import').glob('*.ts')), *sorted((root / 'supabase/functions/capture-ezyvet-attachment').glob('*.ts')), *sorted((root / 'supabase/functions/retrieve-reviewed-ezyvet-original').glob('*.ts')), root / 'src/hub/features/imports/attachment-capture-state.ts', root / 'src/hub/features/imports/attachment-decision-state.ts', root / 'src/hub/features/imports/attachment-review-history.ts']
source_hashes = {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest() for path in source_paths}

def command(argv, **kwargs):
    result = subprocess.run(argv, capture_output=True, text=True, **kwargs)
    log.write('COMMAND ' + ' '.join(map(str, argv)) + '\n' + result.stdout + result.stderr + '\n')
    log.flush()
    if result.returncode:
        diagnostic = re.search(r'^LRV_MIGRATION_FAILURE checks=[0-9]+ operation=[a-z_]+ sqlstate=(?:[A-Z0-9]{5}|none)$', result.stderr, re.MULTILINE)
        if diagnostic:
            print(diagnostic[0], flush=True)
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
    for port in [args.api_port - 1, args.api_port, args.api_port + 1, args.api_port + 3]:
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
    assert {'20260913470000', '20260913480000'} <= versions, 'Both source snapshot and byte-binding migrations required'
    assert {'20260913550000', '20260913560000', '20260913570000', '20260913580000', '20260913590000', '20260913600000', '20260913610000', '20260913620000', '20260913650000'} <= versions, 'Prescription intake and clinical review migrations required'
    assert '20260913690000' in versions, 'Canonical metadata workflow migration required'
    assert '20260913700000' in versions, 'Canonical original capture migration required'
    assert {'20260914010000','20260914020000','20260914030000','20260914040000','20260914050000','20260914060000','20260914070000','20260914080000','20260914090000','20260914100000','20260914110000','20260914120000','20260914130000','20260914140000','20260914150000','20260914160000','20260914170000','20260914180000','20260914190000','20260914200000','20260914210000','20260914220000','20260914230000','20260916000000','20260916010000','20260916033310','20260916083056','20260916090000','20260916093000','20260916094500','20260916100000'} <= versions, 'Canonical approval, history, chart and verified retrieval migrations required'
    assert {'20260916043949','20260916055043','20260916062136','20260916063857','20260916070108','20260916072509','20260916080105'} <= versions, 'Canonical resolution and native prescription migrations required'
    assert len(versions) == 127 and not ({'20260913640000','20260913660000','20260913670000','20260913680000'} & versions), 'Refuse incompatible alternate attachment stack'
    (project / 'supabase/config.toml').write_text(f'''project_id = "{identity}"
[api]
port = {args.api_port}
[db]
port = {args.api_port + 1}
shadow_port = {args.api_port - 1}
major_version = 17
[studio]
enabled = false
[analytics]
enabled = false
[inbucket]
port = {args.api_port + 3}
[auth]
site_url = "http://127.0.0.1:{args.api_port}"
enable_signup = false
[storage]
enabled = true
[edge_runtime]
enabled = false
''')
    print('Starting owned disposable attachment project; no hosted or provider operations.', flush=True)
    started = True
    command(['supabase', 'start', '--workdir', str(project), '--ignore-health-check', '--exclude', 'realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'])
    verify_identity()
    local = json.loads(command(['supabase', 'status', '--workdir', str(project), '--output', 'json']))
    assert local['API_URL'] == f'http://127.0.0.1:{args.api_port}'
    for attempt in range(120):
        try:
            for endpoint in ['/auth/v1/health', '/rest/v1/', '/storage/v1/status']:
                probe = urllib.request.Request(local['API_URL'] + endpoint, headers={'apikey': local['ANON_KEY'], 'Authorization': 'Bearer ' + local['SERVICE_ROLE_KEY']})
                urllib.request.urlopen(probe, timeout=2).close()
            break
        except Exception:
            if attempt == 119:
                raise RuntimeError('Owned Auth/PostgREST/Storage did not become ready')
            time.sleep(1)
    for test_path in args.extra_sql_test:
        output = command(['docker', 'exec', '-i', 'supabase_db_' + identity, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], input=test_path.read_text())
        plans = re.findall(r'^1\.\.([0-9]+)$', output, re.MULTILINE)
        assert plans and 'not ok' not in output, 'SQL assertions failed; inspect protected log'
        checks_by_fixture[test_path.name] = int(plans[-1])
        checks += int(plans[-1])
        print(f'{test_path.name}: {plans[-1]} SQL assertions passed.', flush=True)
    if 'migration' in selected:
        output = command(['python3', str(root / 'supabase/tests/ezyvet_migration_resolutions_concurrency.py'), '--project-config', str(project / 'supabase/config.toml')], cwd=root)
        matched = re.fullmatch(r'Operational resolution SQL: ([0-9]+) assertions passed\.\nOperational resolution concurrency: ([0-9]+) checks passed; no provider calls\.', output.strip())
        assert matched, 'Refuse unexpected operational resolution gate output'
        for key, count in [('resolution-sql', int(matched[1])), ('resolution-concurrency', int(matched[2]))]:
            checks_by_fixture[key] = count
            checks += count
        print(output.strip(), flush=True)
    for name in selected:
        harness_path = root / 'tests/ezyvet' / fixtures[name][0]
        harness_hashes[name] = hashlib.sha256(harness_path.read_bytes()).hexdigest()
        output = command(['node', '--experimental-strip-types', str(harness_path)], env={**os.environ, 'PAYMENT_TEST_PROJECT': str(project), 'PAYMENT_TEST_API_PORT': str(args.api_port)}, cwd=root)
        assert all(hashlib.sha256((root / path).read_bytes()).hexdigest() == digest for path, digest in source_hashes.items()), 'Source changed during execution; rerun exact source'
        # Only each harness's fixed aggregate evidence line reaches the terminal.
        matched = re.fullmatch(re.escape(fixtures[name][1]) + r': ([0-9]+) checks passed\. Synthetic upstream only; no ezyVet requests\.', output.strip())
        assert matched, 'Refuse unexpected harness output'
        checks_by_fixture[name] = int(matched[1])
        checks += int(matched[1])
        print(matched[0], flush=True)
    success = True
finally:
    try:
        if started:
            verify_identity()
            command(['supabase', 'stop', '--workdir', str(project), '--no-backup'])
            containers = command(['docker', 'ps', '-a', '--filter', 'name=' + identity, '--format', '{{.Names}}']).splitlines()
            volumes = command(['docker', 'volume', 'ls', '--format', '{{.Name}}']).splitlines()
            assert not containers and not any(v.endswith('_' + identity) for v in volumes), 'Owned disposable resources remain'
    finally:
        log.close()
if success:
    summary = {'synthetic_only': True, 'fixture': 'attachment-' + args.fixture, 'project_id': identity, 'checks_passed': checks, 'cleanup_verified': True,
               'git_revision': subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=root, capture_output=True, text=True, check=True).stdout.strip(),
               'runner_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
               'harness_sha256': harness_hashes, 'checks_by_fixture': checks_by_fixture,
               'migration_sha256': migration_hashes, 'source_sha256': source_hashes, 'provider_requests': 0}
    summary_path = work.parent / (identity + '-result.json')
    summary_path.write_text(json.dumps(summary, indent=2) + '\n')
    shutil.rmtree(work)
    print('Sanitized result: ' + str(summary_path), flush=True)
    print('Disposable project containers, volumes and private temporary files removed; shared foundation untouched.', flush=True)
