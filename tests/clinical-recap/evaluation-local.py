"""Capture eight fictional records through an owned local Auth/native recap adapter; no provider calls."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--run-synthetic-local', action='store_true', required=True)
args = parser.parse_args()
os.umask(0o077)
root = Path(__file__).resolve().parents[2]
identity = 'lrv-recap-eval-' + uuid.uuid4().hex[:10]
work = Path(tempfile.mkdtemp(prefix=identity + '-'))
project = work / 'project'
(project / 'supabase/migrations').mkdir(parents=True)
evidence = Path(tempfile.mkdtemp(prefix=identity + '-evidence-'))
log = (evidence / 'commands.log').open('w')
started = False
proof = {
    'identity': identity, 'synthetic_only': True, 'provider_requests': 0,
    'owned_runtime_removed': False, 'capture_completed': False,
}
inputs = set((root / 'supabase/migrations').glob('*.sql')) | {
    root / 'tests/clinical-recap/evaluation-corpus.ts',
    root / 'tests/clinical-recap/evaluation-capture.ts',
    root / 'tests/clinical-recap/evaluation-local.py',
    root / 'supabase/functions/_shared/clinical-recap-model.ts',
    root / 'supabase/functions/_shared/clinical-recap-handler.ts',
    root / 'supabase/functions/_shared/clinical-veterinary-context.ts',
    root / 'package-lock.json',
}
hashes = {str(f.relative_to(root)): hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(inputs)}
proof['source_sha256'] = hashes

def run(argv, **kw):
    result = subprocess.run(argv, capture_output=True, text=True, cwd=root,
                            timeout=kw.pop('timeout', 300), **kw)
    private_output = '[Owned Docker inspection withheld]\n' if argv[:2] == ['docker', 'inspect'] else result.stdout + result.stderr
    log.write('COMMAND ' + argv[0] + '\n' + private_output + '\n')
    log.flush()
    if result.returncode:
        # CLI status/local keys are never printed. The detailed log remains private.
        raise RuntimeError('Owned synthetic capture command failed; private log: ' + str(evidence / 'commands.log'))
    return result.stdout

try:
    for port in [65320, 65321, 65322, 65324, 65381]:
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', port))
    files = sorted((root / 'supabase/migrations').glob('*.sql'))
    assert len(files) == 203
    for migration in files:
        shutil.copy2(migration, project / 'supabase/migrations' / migration.name)
    (project / 'supabase/config.toml').write_text(f'''project_id = "{identity}"
[api]
port = 65321
[db]
port = 65322
shadow_port = 65320
major_version = 17
[studio]
enabled = false
[analytics]
enabled = false
[inbucket]
port = 65324
[auth]
site_url = "http://127.0.0.1:65381"
enable_signup = false
[storage]
enabled = true
[edge_runtime]
enabled = false
''')
    print('Starting uniquely owned local eight-case synthetic capture.', flush=True)
    started = True
    excluded = 'realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'
    run(['supabase', 'start', '--workdir', str(project), '--exclude', excluded,
         '--ignore-health-check'], timeout=600)
    labels = json.loads(run(['docker', 'inspect', 'supabase_db_' + identity]))[0]['Config']['Labels']
    assert labels['com.supabase.cli.project'] == identity
    assert Path(labels['com.supabase.cli.workdir']).resolve() == project.resolve()
    run(['docker', 'exec', '-i', 'supabase_db_' + identity, 'psql', '-X', '-qAt',
         '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
        input='alter system set cron.launch_active_jobs=off;select pg_reload_conf();')
    # No hosted/provider secret is needed by capture. Do not pass one to its Node process.
    env = {key: value for key, value in os.environ.items()
           if not key.startswith(('OPENAI_', 'ANTHROPIC_', 'SUPABASE_', 'EZYVET_', 'STRIPE_', 'RECAP_'))}
    env.update({'RECAP_EVALUATION_PROJECT': str(project), 'RECAP_RUN_SYNTHETIC_LOCAL': 'true'})
    result = run(['node', '--experimental-strip-types', str(root / 'tests/clinical-recap/evaluation-capture.ts')],
                 env=env, timeout=300)
    summary = json.loads(result.strip().splitlines()[-1])
    assert summary['cases'] == 8 and summary['semantic_negative_controls'] == 3
    assert summary['canonical_unchanged'] and summary['adapter_hashes_valid']
    assert summary['provider_requests'] == 0
    assert all(hashlib.sha256((root / name).read_bytes()).hexdigest() == digest
               for name, digest in hashes.items()), 'Proof input changed during capture'
    proof.update({'capture_completed': True, 'summary': summary,
                  'corpus_sha256': hashlib.sha256((root / 'tmp/clinical-recap-evaluation-corpus.json').read_bytes()).hexdigest()})
    print(json.dumps(summary), flush=True)
finally:
    try:
        if started:
            run(['supabase', 'stop', '--workdir', str(project), '--no-backup'], timeout=180)
            assert not run(['docker', 'ps', '-a', '--filter', 'label=com.supabase.cli.project=' + identity,
                            '--format', '{{.ID}}']).strip()
            assert not run(['docker', 'volume', 'ls', '--filter', 'label=com.supabase.cli.project=' + identity,
                            '--format', '{{.Name}}']).strip()
            proof['owned_runtime_removed'] = True
            shutil.rmtree(work)
    finally:
        log.close()
        (root / 'tmp').mkdir(exist_ok=True)
        (root / 'tmp/clinical-recap-evaluation-local-proof.json').write_text(json.dumps(proof, indent=2) + '\n')
    if proof['owned_runtime_removed']:
        print('Owned synthetic capture containers, volumes and private work removed.', flush=True)
