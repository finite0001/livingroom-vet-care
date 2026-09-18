"""Rehearse the observed hosted attachment upgrade in a fresh local project.

Uses metadata captured read-only from the hosted database. Never connects to it.
This is a populated upgrade regression rehearsal, not a backup restore.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import tempfile
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--baseline-directory', required=True, type=Path)
parser.add_argument('--run-synthetic-local-rehearsal', action='store_true')
parser.add_argument('--port', type=int, default=64321)
args = parser.parse_args()
if not args.run_synthetic_local_rehearsal:
    parser.error('Explicit synthetic local rehearsal opt-in required')
root = Path(__file__).resolve().parents[2]
baseline = args.baseline_directory.resolve()
routine_file = baseline / 'routine-inventory.json'
access_file = baseline / 'access-inventory.json'
expected = json.loads(routine_file.read_text())
versions = expected['versions']
assert len(versions) == len(set(versions)) == 113
assert versions == json.loads(access_file.read_text())['versions']
assert all(re.fullmatch(r'\d{14}', v) for v in versions)
legacy = baseline / '20260916020000_ezyvet_migration_weight_evidence.sql'
assert legacy.is_file()
canonical = sorted((root / 'supabase/migrations').glob('*.sql'))
assert len(canonical) == 118
by_version = {p.name.split('_')[0]: p for p in canonical}
assert len(by_version) == len(canonical)
assert set(versions) - set(by_version) == {'20260916020000'}
missing = sorted(set(by_version) - set(versions))
assert missing == ['20260916033310', '20260916043949', '20260916100000',
                   '20260916110000', '20260916120000', '20260916130000']
run = Path(tempfile.mkdtemp(prefix='lrv-hosted-upgrade-')).resolve()
os.chmod(run, 0o700)
project = 'lrv-restore-' + uuid.uuid4().hex[:10] + '-source'
container = 'supabase_db_' + project
config = run / 'supabase/config.toml'
migrations = config.parent / 'migrations'
migrations.mkdir(parents=True)
for port in [args.port - 1, args.port, args.port + 1, args.port + 3]:
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', port))
config.write_text(f'''project_id = "{project}"
[api]
port = {args.port}
[db]
port = {args.port + 1}
shadow_port = {args.port - 1}
major_version = 17
[studio]
enabled = false
[analytics]
enabled = false
[inbucket]
port = {args.port + 3}
[auth]
site_url = "http://127.0.0.1:{args.port}"
enable_signup = false
[edge_runtime]
enabled = false
''')
for version in versions:
    source = legacy if version == '20260916020000' else by_version[version]
    shutil.copy2(source, migrations / source.name)
log = (run / 'commands.log').open('w')
os.chmod(run / 'commands.log', 0o600)

def command(argv, input=None):
    result = subprocess.run(argv, input=input, text=True, capture_output=True)
    log.write(result.stdout + result.stderr)
    log.flush()
    if result.returncode:
        raise RuntimeError(f'Command failed ({result.returncode}); see {run / "commands.log"}')
    return result.stdout

def verify_identity():
    info = json.loads(command(['docker', 'inspect', container]))[0]
    labels = info['Config']['Labels']
    assert labels['com.supabase.cli.project'] == project
    assert Path(labels['com.supabase.cli.workdir']).resolve() == run

def sql(query):
    verify_identity()
    return command(['docker', 'exec', '-i', container, 'psql', '-U', 'postgres',
                    '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], query)

def inventory(kind):
    query = (root / f'scripts/restore-rehearsal/{kind}-inventory.sql').read_text()
    value = json.loads(sql(query))
    target = run / f'{kind}-inventory.json'
    target.write_text(json.dumps(value))
    return target

print(f'Owned local rehearsal artifacts: {run}', flush=True)
success = False
try:
    command(['supabase', 'start', '--workdir', str(run), '--exclude',
             'realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'])
    for kind, source in [('routine', routine_file), ('access', access_file)]:
        observed = inventory(kind)
        command(['python3', str(root / f'scripts/restore-rehearsal/compare-{kind}-inventories.py'),
                 str(source), str(observed)])
    print('Observed hosted baseline matches local routine and access inventories.', flush=True)
    status = json.loads(command(['supabase', 'status', '--workdir', str(run), '--output', 'json']))
    assert status['API_URL'] == f'http://127.0.0.1:{args.port}'
    status_path = run / 'status.json'
    status_path.write_text(json.dumps(status))
    os.chmod(status_path, 0o600)
    fixture = str(root / 'scripts/restore-rehearsal/fixture.mjs')
    command(['node', fixture, 'create', str(status_path), str(run)])
    print('Synthetic clinical, billing, inventory and private Storage fixture created.', flush=True)
    for version in missing:
        shutil.copy2(by_version[version], migrations / by_version[version].name)
    verify_identity()
    command(['supabase', 'db', 'push', '--local', '--skip-vault', '--workdir', str(run), '--yes'])
    observed_versions = json.loads(sql('select json_agg(version order by version) from supabase_migrations.schema_migrations;'))
    assert observed_versions == sorted(set(versions) | set(by_version))
    assert len(observed_versions) == 119, 'Legacy receipt must remain intact'
    command(['node', fixture, 'verify-upgrade', str(status_path), str(run)])
    print('Populated upgrade preserved fixture records and private original bytes.', flush=True)
    sql('create extension if not exists pgtap with schema extensions;')
    assertions = {}
    for name in ['conversation_attachment_uploads', 'conversation_email_preparation',
                 'inbound_attachment_capture', 'abandoned_attachment_cleanup']:
        output = sql((root / f'supabase/tests/{name}.test.sql').read_text())
        plans = re.findall(r'1\.\.([0-9]+)', output)
        assert plans and not re.search(r'(^|\n)\s*not ok', output), name
        assert 'Looks like you' not in output, name
        assertions[name] = int(plans[-1])
    for kind in ['routine', 'access']:
        shutil.copy2(inventory(kind), run / f'upgraded-{kind}-inventory.json')
    result = {'synthetic_only': True, 'hosted_writes': False, 'provider_calls': 0,
              'baseline_inventory_match': True, 'baseline_versions': versions,
              'applied_versions': missing, 'final_versions': observed_versions,
              'sql_assertions': assertions, 'legacy_sql_sha256': hashlib.sha256(legacy.read_bytes()).hexdigest(),
              'populated_upgrade': json.loads((run / 'upgrade-verification.json').read_text()),
              'limitations': ['Synthetic populated upgrade only; no backup restoration, hosted deployment, or provider acceptance.']}
    success = True
finally:
    probe = subprocess.run(['docker', 'inspect', container], capture_output=True)
    if probe.returncode == 0:
        verify_identity()
    command(['supabase', 'stop', '--no-backup', '--workdir', str(run)])
    remaining = command(['docker', 'ps', '-aq', '--filter', f'label=com.supabase.cli.project={project}']).strip()
    assert not remaining, 'Owned containers remain'
    volumes = command(['docker', 'volume', 'ls', '-q', '--filter', f'label=com.supabase.cli.project={project}']).strip()
    assert not volumes, 'Owned volumes remain'
    log.close()
if success:
    result['cleanup_verified'] = True
    (run / 'result.json').write_text(json.dumps(result, indent=2))
    print(f'PASS: {sum(assertions.values())} SQL assertions; legacy receipt preserved; cleanup verified.', flush=True)
