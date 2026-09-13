"""Run prescription intake and clinical review acceptance in an owned disposable local Auth/Storage stack."""
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

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--run-synthetic-local', action='store_true')
parser.add_argument('--additional-migration', action='append', type=Path, default=[], help='Local parallel-development dependency; reject duplicate migration versions')
args = parser.parse_args()
if not args.run_synthetic_local:
    parser.error('Explicit --run-synthetic-local required')
root = Path(__file__).resolve().parents[2]
fixture = ('prescription-local-roundtrip.ts', 'Prescription intake and review HTTP/Auth/PostgREST')
harness_path = root / 'tests/ezyvet' / fixture[0]
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

def command(argv, **kwargs):
    result = subprocess.run(argv, capture_output=True, text=True, **kwargs)
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
    for port in [60320, 60321, 60322, 60324]:
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
    assert {'20260913550000', '20260913560000', '20260913570000', '20260913580000', '20260913590000', '20260913600000', '20260913610000'} <= versions, 'Prescription intake and clinical review migrations required'
    (project / 'supabase/config.toml').write_text(f'''project_id = "{identity}"
[api]
port = 60321
[db]
port = 60322
shadow_port = 60320
major_version = 17
[studio]
enabled = false
[analytics]
enabled = false
[inbucket]
port = 60324
[auth]
site_url = "http://127.0.0.1:60321"
enable_signup = false
[storage]
enabled = true
[edge_runtime]
enabled = false
''')
    print('Starting owned disposable prescription project; no hosted or provider operations.', flush=True)
    started = True
    command(['supabase', 'start', '--workdir', str(project), '--exclude', 'realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'])
    verify_identity()
    harness_hash = hashlib.sha256(harness_path.read_bytes()).hexdigest()
    output = command(['node', '--experimental-strip-types', str(harness_path)], env={**os.environ, 'PAYMENT_TEST_PROJECT': str(project)}, cwd=root)
    assert hashlib.sha256(harness_path.read_bytes()).hexdigest() == harness_hash, 'Harness changed during execution; rerun exact source'
    # Only the harness's fixed aggregate evidence line reaches the terminal.
    matched = re.fullmatch(re.escape(fixture[1]) + r': ([0-9]+) checks passed\. Synthetic upstream only; no ezyVet requests\.', output.strip())
    assert matched, 'Refuse unexpected harness output'
    checks = int(matched[1])
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
    summary = {'synthetic_only': True, 'fixture': 'prescription', 'project_id': identity, 'checks_passed': checks, 'cleanup_verified': True,
               'git_revision': subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=root, capture_output=True, text=True, check=True).stdout.strip(),
               'runner_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
               'harness_sha256': harness_hash,
               'migration_sha256': migration_hashes, 'provider_requests': 0}
    summary_path = work.parent / (identity + '-result.json')
    summary_path.write_text(json.dumps(summary, indent=2) + '\n')
    shutil.rmtree(work)
    print('Sanitized result: ' + str(summary_path), flush=True)
    print('Disposable project containers, volumes and private temporary files removed; shared foundation untouched.', flush=True)
