"""Canonical migration replay and genuine scheduling proof in a uniquely owned local runtime."""
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
parser.add_argument('--run-synthetic-local', action='store_true', required=True)
parser.add_argument('--include-sql-regression', action='store_true')
parser.add_argument('--staff-only', action='store_true', help='Focused local staff verification after parent checks have passed')
args = parser.parse_args()
assert not (os.environ.get("CI")=="true" and args.staff_only), "CI must include all scheduling layers"
root = Path(__file__).resolve().parents[2]
os.umask(0o077)
identity = 'lrv-catalog-' + uuid.uuid4().hex[:10]
work = Path(tempfile.mkdtemp(prefix=identity + '-'))
project = work / 'project'
(project / 'supabase/migrations').mkdir(parents=True)
log = (work / 'commands.log').open('w')
started = success = False

def command(argv, timeout=300, **kwargs):
    result = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, **kwargs)
    log.write(str(argv) + '\n' + result.stdout + result.stderr + '\n'); log.flush()
    if result.returncode:
        if os.environ.get('CI') == 'true' and argv[0] == 'node':
            diagnostic = re.sub(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '[REDACTED JWT]', result.stderr)
            diagnostic = re.sub(r'sb_(?:secret|publishable)_[A-Za-z0-9_-]+', '[REDACTED KEY]', diagnostic)
            print(diagnostic[-4000:], flush=True)
        raise RuntimeError('Owned scheduling proof failed; protected log: ' + str(work / 'commands.log'))
    return result.stdout

def verify():
    labels = json.loads(command(['docker','inspect','supabase_db_' + identity]))[0]['Config']['Labels']
    assert labels['com.supabase.cli.project'] == identity
    assert Path(labels['com.supabase.cli.workdir']).resolve() == project.resolve()
    assert (project/'supabase/config.toml').read_text().startswith('project_id = "' + identity + '"\n')

try:
    for port in [47220,47221,47222,47224,47281]:
        with socket.socket() as sock: sock.bind(('127.0.0.1', port))
    hashes = {}
    for migration in sorted((root/'supabase/migrations').glob('*.sql')):
        assert re.match(r'^\d{14}_', migration.name)
        hashes[migration.name] = hashlib.sha256(migration.read_bytes()).hexdigest()
        shutil.copy2(migration, project/'supabase/migrations'/migration.name)
    assert len(hashes) == 184 and '20261013181721_appointment_catalog_and_bindings.sql' in hashes and '20261013214300_catalog_patient_eligibility_lock.sql' in hashes and '20261013220500_next_visit_outcomes.sql' in hashes and '20261013233839_next_visit_staff_recovery.sql' in hashes and '20261014022511_operational_tasks.sql' in hashes
    if args.include_sql_regression: shutil.copytree(root/'supabase/tests', project/'supabase/tests')
    harness = root/'tests/scheduling/catalog-local.ts'
    harness_hash = hashlib.sha256(harness.read_bytes()).hexdigest()
    (project/'supabase/config.toml').write_text(f'''project_id = "{identity}"
[api]
port = 47221
[db]
port = 47222
shadow_port = 47220
major_version = 17
[studio]
enabled = false
[analytics]
enabled = false
[inbucket]
port = 47224
[auth]
site_url = "http://127.0.0.1:47281"
enable_signup = false
[storage]
enabled = true
[edge_runtime]
enabled = false
''')
    started = True
    print('Starting uniquely owned scheduling runtime; private status withheld.', flush=True)
    command(['supabase','start','--workdir',str(project),'--exclude','realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'], timeout=600)
    verify()
    if args.include_sql_regression:
        result = command(['supabase','test','db','--workdir',str(project)], cwd=root)
        assert 'All tests successful.' in result and 'Files=150, Tests=6168' in result
        print('Canonical SQL regression passed: 150 files /6168 assertions.', flush=True)
    env = {**os.environ, 'SCHEDULING_TEST_PROJECT': str(project), 'SCHEDULING_RUN_SYNTHETIC_LOCAL': 'true'}
    if not args.staff_only:
        result = command(['node','--experimental-strip-types',str(harness)], cwd=root, env=env, timeout=420)
        match = re.search(r'Genuine local appointment catalog passed: \d+ checks; 7 observed lock queues; 20 browser checks; 9 populated restore checks; no provider requests\.', result)
        assert match, result[-1000:]
        assert hashlib.sha256(harness.read_bytes()).hexdigest() == harness_hash
        assert all(hashlib.sha256((root/'supabase/migrations'/name).read_bytes()).hexdigest() == digest for name,digest in hashes.items())
        print(match.group(0), flush=True)
        next_harness = root/'tests/scheduling/next-visit-local.ts'
        next_hash = hashlib.sha256(next_harness.read_bytes()).hexdigest()
        result = command(['node','--experimental-strip-types',str(next_harness)], cwd=root, env=env, timeout=240)
        match = re.search(r'Genuine local next-visit foundation passed: \d+ checks; 6 observed lock queues; populated outcome restore; no provider requests\.', result)
        assert match, result[-1000:]
        assert hashlib.sha256(next_harness.read_bytes()).hexdigest() == next_hash
        assert all(hashlib.sha256((root/'supabase/migrations'/name).read_bytes()).hexdigest() == digest for name,digest in hashes.items())
        print(match.group(0), flush=True)
    staff_harness = root/'tests/scheduling/next-visit-staff-local.ts'
    staff_hash = hashlib.sha256(staff_harness.read_bytes()).hexdigest()
    result = command(['node','--experimental-strip-types',str(staff_harness)], cwd=root, env=env, timeout=420)
    match = re.search(r'Genuine local next-visit staff passed: \d+ checks; \d+ browser checks; no provider requests\.', result)
    assert match, result[-1000:]
    assert hashlib.sha256(staff_harness.read_bytes()).hexdigest() == staff_hash
    print(match.group(0), flush=True)
    task_harness = root/'tests/scheduling/operational-tasks-local.ts'
    task_hash = hashlib.sha256(task_harness.read_bytes()).hexdigest()
    result = command(['node','--experimental-strip-types',str(task_harness)], cwd=root, env=env, timeout=420)
    match = re.search(r'Genuine local operational tasks passed: \d+ checks; 2 observed lock queues; populated task restore; no provider requests\.', result)
    assert match, result[-1000:]
    assert hashlib.sha256(task_harness.read_bytes()).hexdigest() == task_hash
    assert all(hashlib.sha256((root/'supabase/migrations'/name).read_bytes()).hexdigest() == digest for name,digest in hashes.items())
    print(match.group(0), flush=True)
    success = True
finally:
    if started:
        found = subprocess.run(['docker','inspect','supabase_db_' + identity], capture_output=True)
        if found.returncode == 0:
            verify()
            command(['supabase','stop','--workdir',str(project),'--project-id',identity,'--no-backup'], timeout=120)
            assert not command(['docker','ps','-a','--filter','label=com.supabase.cli.project=' + identity,'--format','{{.Names}}']).strip()
            assert not any(v.endswith('_' + identity) for v in command(['docker','volume','ls','--format','{{.Name}}']).splitlines())
            print('Owned scheduling containers and volumes removed; other runtimes untouched.', flush=True)
    log.close()
    if success: shutil.rmtree(work)
