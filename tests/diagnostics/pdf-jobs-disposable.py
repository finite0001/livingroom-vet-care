"""Prove diagnostics in a uniquely owned local runtime; never hosted/provider operations."""
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

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--run-synthetic-local',action='store_true',required=True)
parser.add_argument('--include-sql-regression',action='store_true')
args=parser.parse_args()
root=Path(__file__).resolve().parents[2]
identity='lrv-pdfjobs-'+uuid.uuid4().hex[:10]
os.umask(0o077)
work=Path(tempfile.mkdtemp(prefix=identity+'-'))
project=work/'project';(project/'supabase/migrations').mkdir(parents=True)
log=(work/'commands.log').open('w');started=False;success=False

def command(argv,timeout=240,**kwargs):
    result=subprocess.run(argv,capture_output=True,text=True,timeout=timeout,**kwargs)
    log.write('COMMAND '+str(argv)+'\n'+result.stdout+result.stderr+'\n');log.flush()
    if result.returncode:
        raise RuntimeError('Owned diagnostic command failed; protected log: '+str(work/'commands.log'))
    return result.stdout

def verify():
    data=json.loads(command(['docker','inspect','supabase_db_'+identity]))[0]['Config']['Labels']
    assert data['com.supabase.cli.project']==identity
    assert Path(data['com.supabase.cli.workdir']).resolve()==project.resolve()
    assert (project/'supabase/config.toml').read_text().startswith('project_id = "'+identity+'"\n')

try:
    for port in [64320,64321,64322,64324,64381]:
        with socket.socket() as sock:sock.bind(('127.0.0.1',port))
    hashes={}
    for migration in sorted((root/'supabase/migrations').glob('*.sql')):
        assert re.match(r'^\d{14}_',migration.name)
        hashes[migration.name]=hashlib.sha256(migration.read_bytes()).hexdigest()
        shutil.copy2(migration,project/'supabase/migrations'/migration.name)
    assert len(hashes)==183 and '20261011181722_manual_diagnostic_panels.sql' in hashes and '20261011203250_diagnostic_pdf_jobs.sql' in hashes and '20261012035948_diagnostic_pdf_artifact_processing.sql' in hashes and '20261012153518_diagnostic_pdf_staff_review.sql' in hashes and '20261012210016_diagnostic_pdf_release_scope.sql' in hashes and '20261013003556_diagnostic_pdf_record_packages.sql' in hashes and '20261013181721_appointment_catalog_and_bindings.sql' in hashes and '20261013214300_catalog_patient_eligibility_lock.sql' in hashes and '20261013220500_next_visit_outcomes.sql' in hashes and '20261013233839_next_visit_staff_recovery.sql' in hashes
    if args.include_sql_regression:shutil.copytree(root/'supabase/tests',project/'supabase/tests')
    harness=root/'tests/diagnostics/pdf-jobs-local.ts'
    harness_hash=hashlib.sha256(harness.read_bytes()).hexdigest()
    (project/'supabase/config.toml').write_text(f'''project_id = "{identity}"
[api]
port = 64321
[db]
port = 64322
shadow_port = 64320
major_version = 17
[studio]
enabled = false
[analytics]
enabled = false
[inbucket]
port = 64324
[auth]
site_url = "http://127.0.0.1:64321"
enable_signup = false
[storage]
enabled = true
[edge_runtime]
enabled = false
''')
    started=True
    print('Starting uniquely owned synthetic diagnostic runtime; private status output withheld.',flush=True)
    command(['supabase','start','--workdir',str(project),'--exclude','realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'],timeout=600)
    verify()
    if args.include_sql_regression:
        sql_result=command(['supabase','test','db','--workdir',str(project)],cwd=root,timeout=180)
        assert 'All tests successful.' in sql_result and 'Files=149, Tests=6106' in sql_result
        print('Canonical SQL regression passed: 149 files /6106 assertions.',flush=True)
    env={**os.environ,'DIAGNOSTICS_TEST_PROJECT':str(project),'DIAGNOSTICS_RUN_SYNTHETIC_LOCAL':'true'}
    result=command(['node','--experimental-strip-types',str(harness)],cwd=root,env=env,timeout=180)
    match=re.search(r'Genuine local PDF jobs.*54 assertions; no provider requests\.',result)
    assert match,result[-500:]
    assert hashlib.sha256(harness.read_bytes()).hexdigest()==harness_hash
    assert all(hashlib.sha256((root/'supabase/migrations'/name).read_bytes()).hexdigest()==digest for name,digest in hashes.items())
    print(match.group(0),flush=True);success=True
finally:
    if started:
        inspected=subprocess.run(['docker','inspect','supabase_db_'+identity],capture_output=True,text=True)
        if inspected.returncode==0:
            verify()
            command(['supabase','stop','--workdir',str(project),'--project-id',identity,'--no-backup'],timeout=120)
            assert not command(['docker','ps','-a','--filter','label=com.supabase.cli.project='+identity,'--format','{{.Names}}']).strip()
            assert not any(v.endswith('_'+identity) for v in command(['docker','volume','ls','--format','{{.Name}}']).splitlines())
            print('Owned diagnostic containers/volumes removed; other runtimes untouched.',flush=True)
    log.close()
    if success:shutil.rmtree(work)
