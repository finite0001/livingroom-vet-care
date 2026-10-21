"""Verify private complete call sources in a uniquely owned, disposable local stack."""
import argparse, hashlib, json, os, re, shutil, socket, subprocess, tempfile, uuid
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--run-synthetic-local',action='store_true',required=True)
p.add_argument('--include-sql-regression',action='store_true')
p.add_argument('--sql-only',action='store_true')
p.add_argument('--evidence-prefix',default='clinical-calls')
args=p.parse_args();os.umask(0o077)
assert re.fullmatch(r'[a-z0-9][a-z0-9-]{0,79}',args.evidence_prefix),'Invalid evidence prefix'
root=Path(__file__).resolve().parents[2];identity='lrv-clinical-calls-'+uuid.uuid4().hex[:10]
work=Path(tempfile.mkdtemp(prefix=identity+'-'));project=work/'project';(project/'supabase/migrations').mkdir(parents=True)
evidence=Path(tempfile.mkdtemp(prefix=identity+'-evidence-'));log=(evidence/'commands.log').open('w');started=False;proof=None
inputs=set((root/'supabase/migrations').glob('*.sql'))|set((root/'supabase/tests').glob('clinical_call*.test.sql'))|{root/'tests/clinical-calls/disposable.py'}
if not args.sql_only:inputs|=set((root/'tests/clinical-calls').glob('*'))|set((root/'src/hub/features/clinical/call-drafts').rglob('*'))|set((root/'supabase/functions/_shared').glob('clinical-call*.ts'))|set((root/'supabase/functions/clinical-call-capture').glob('*'))|{root/'supabase/functions/_shared/clinical-veterinary-context.ts',root/'src/hub/features/patients/PatientPage.tsx',root/'src/hub/features/clinical/ClinicalWorkspace.tsx',root/'package-lock.json'}
hashes={str(f.relative_to(root)):hashlib.sha256(f.read_bytes()).hexdigest()for f in sorted(inputs)if f.is_file()}
def run(argv,**kw):
 r=subprocess.run(argv,capture_output=True,text=True,cwd=root,timeout=kw.pop('timeout',300),**kw);log.write('COMMAND '+argv[0]+'\n'+('[Owned Docker inspection withheld]\n' if argv[:2]==['docker','inspect'] else r.stdout+r.stderr)+'\n');log.flush()
 if r.returncode:
  print((r.stdout+r.stderr)[-5000:],flush=True)
  raise RuntimeError('Owned call-source proof failed; private log '+str(evidence/'commands.log'))
 return r.stdout
try:
 for port in [65320,65321,65322,65324,65381]:
  with socket.socket()as s:s.bind(('127.0.0.1',port))
 files=sorted((root/'supabase/migrations').glob('*.sql'));assert len(files)==205;assert files[-1].name=='20261020151157_controlled_stock_private_engine.sql'
 for f in files:shutil.copy2(f,project/'supabase/migrations'/f.name)
 (project/'supabase/tests').mkdir()
 for f in(root/'supabase/tests').glob('*.sql'):
  if args.include_sql_regression or f.name.startswith('clinical_call'):shutil.copy2(f,project/'supabase/tests'/f.name)
 (project/'supabase/config.toml').write_text(f'''project_id = "{identity}"
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
 print('Starting uniquely owned local call-source runtime.',flush=True);started=True
 # Storage schema bootstrap is required by historical migrations. This recap proof
 # uses SQL/Auth/REST, not the cold-starting Storage HTTP service; actual required
 # operations below remain fail-closed even when its CLI health grace period expires.
 excluded='realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'
 run(['supabase','start','--workdir',str(project),'--exclude',excluded,'--ignore-health-check'],timeout=600)
 labels=json.loads(run(['docker','inspect','supabase_db_'+identity]))[0]['Config']['Labels']
 assert labels['com.supabase.cli.project']==identity and Path(labels['com.supabase.cli.workdir']).resolve()==project.resolve()
 run(['docker','exec','-i','supabase_db_'+identity,'psql','-X','-qAt','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],input='alter system set cron.launch_active_jobs=off;select pg_reload_conf();')
 result=run(['supabase','test','db','--workdir',str(project)],timeout=420);assert 'All tests successful.'in result
 summary=result[result.rfind('All tests successful.'):].strip();print(summary,flush=True)
 if not args.sql_only:
  result=run(['node','--experimental-strip-types',str(root/'tests/clinical-calls/local-roundtrip.ts')],env={**os.environ,'CALL_TEST_PROJECT':str(project),'CALL_RUN_SYNTHETIC_LOCAL':'true','CALL_EVIDENCE_PREFIX':args.evidence_prefix},timeout=600);print(result.strip(),flush=True)
 assert all(hashlib.sha256((root/name).read_bytes()).hexdigest()==digest for name,digest in hashes.items()),'Proof input changed during run'
 proof={'identity':identity,'migrations':205,'sql_summary':summary,'sql_only':args.sql_only,'source_sha256':hashes,'provider_requests':0,'owned_runtime_removed':False}
 if not args.sql_only:proof['auth_browser_restore']=json.loads((root/f'tmp/{args.evidence_prefix}-roundtrip.json').read_text())
finally:
 if started:
  run(['supabase','stop','--workdir',str(project),'--no-backup'],timeout=180)
  assert not run(['docker','ps','-a','--filter','label=com.supabase.cli.project='+identity,'--format','{{.ID}}']).strip()
 log.close();shutil.rmtree(work)
 if proof:
  proof['owned_runtime_removed']=True;(root/'tmp').mkdir(exist_ok=True);(root/f'tmp/{args.evidence_prefix}-{"sql" if args.sql_only else "local"}-proof.json').write_text(json.dumps(proof,indent=2)+'\n')
 print('Owned call-source containers, volumes and private work removed.',flush=True)
