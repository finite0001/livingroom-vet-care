"""Verify clinical dictation in a uniquely owned, disposable local stack."""
import argparse, hashlib, json, os, shutil, socket, subprocess, tempfile, uuid
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--run-synthetic-local',action='store_true',required=True)
p.add_argument('--include-sql-regression',action='store_true')
p.add_argument('--sql-only',action='store_true')
args=p.parse_args();os.umask(0o077)
root=Path(__file__).resolve().parents[2];identity='lrv-clinical-audio-'+uuid.uuid4().hex[:10]
work=Path(tempfile.mkdtemp(prefix=identity+'-'));project=work/'project';(project/'supabase/migrations').mkdir(parents=True)
evidence=Path(tempfile.mkdtemp(prefix=identity+'-evidence-'));log=(evidence/'commands.log').open('w');started=False;proof=None
inputs=set((root/'supabase/migrations').glob('*.sql'))|set((root/'supabase/tests').glob('clinical_audio*.test.sql'))
if not args.sql_only:inputs|=set((root/'src/hub/features/clinical/dictation').rglob('*'))|set((root/'tests/clinical-audio').glob('*'))|{root/'src/hub/features/clinical/ClinicalWorkspace.tsx',root/'src/hub/features/clinical/use-unsaved-changes.tsx',root/'package-lock.json'}
inputs|={root/'supabase/functions/_shared/clinical-veterinary-context.ts'}|set((root/'supabase/functions/_shared').glob('clinical-audio*.ts'))|set((root/'supabase/functions/clinical-audio-process').glob('*'))|{root/'public/audio/clinical-dictation-worklet.js'}
hashes={str(f.relative_to(root)):hashlib.sha256(f.read_bytes()).hexdigest()for f in sorted(inputs)if f.is_file()}
def run(argv,**kw):
 r=subprocess.run(argv,capture_output=True,text=True,cwd=root,timeout=kw.pop('timeout',300),**kw);log.write('COMMAND '+argv[0]+'\n'+r.stdout+r.stderr+'\n');log.flush()
 if r.returncode:
  print((r.stdout+r.stderr)[-5000:],flush=True)
  raise RuntimeError('Owned audio proof failed; private log '+str(evidence/'commands.log'))
 return r.stdout
try:
 for port in [64920,64921,64922,64924,64981]:
  with socket.socket()as s:s.bind(('127.0.0.1',port))
 files=sorted((root/'supabase/migrations').glob('*.sql'));assert len(files)==195
 for f in files:shutil.copy2(f,project/'supabase/migrations'/f.name)
 (project/'supabase/tests').mkdir()
 for f in(root/'supabase/tests').glob('*.sql'):
  if args.include_sql_regression or f.name.startswith('clinical_audio'):shutil.copy2(f,project/'supabase/tests'/f.name)
 (project/'supabase/config.toml').write_text(f'''project_id = "{identity}"
[api]
port = 64921
[db]
port = 64922
shadow_port = 64920
major_version = 17
[studio]
enabled = false
[analytics]
enabled = false
[inbucket]
port = 64924
[auth]
site_url = "http://127.0.0.1:64981"
enable_signup = false
[storage]
enabled = true
[edge_runtime]
enabled = false
''')
 print('Starting uniquely owned local audio runtime.',flush=True);started=True
 run(['supabase','start','--workdir',str(project),'--exclude','realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'],timeout=600)
 labels=json.loads(run(['docker','inspect','supabase_db_'+identity]))[0]['Config']['Labels']
 assert labels['com.supabase.cli.project']==identity and Path(labels['com.supabase.cli.workdir']).resolve()==project.resolve()
 run(['docker','exec','-i','supabase_db_'+identity,'psql','-X','-qAt','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],input='alter system set cron.launch_active_jobs=off;select pg_reload_conf();')
 result=run(['supabase','test','db','--workdir',str(project)],timeout=420);assert 'All tests successful.'in result
 summary=result[result.rfind('All tests successful.'):].strip();print(summary,flush=True)
 if not args.sql_only:
  result=run(['node','--experimental-strip-types',str(root/'tests/clinical-audio/local-roundtrip.ts')],env={**os.environ,'DICTATION_TEST_PROJECT':str(project),'DICTATION_RUN_SYNTHETIC_LOCAL':'true'},timeout=420);print(result.strip(),flush=True)
 assert all(hashlib.sha256((root/name).read_bytes()).hexdigest()==digest for name,digest in hashes.items()),'Proof input changed during run'
 proof={'identity':identity,'migrations':195,'sql_summary':summary,'sql_only':args.sql_only,'source_sha256':hashes,'provider_requests':0,'owned_runtime_removed':False}
 if not args.sql_only:proof['auth_browser_restore']=json.loads((root/'tmp/clinical-audio-roundtrip.json').read_text())
finally:
 if started:
  run(['supabase','stop','--workdir',str(project),'--no-backup'],timeout=180)
  assert not run(['docker','ps','-a','--filter','label=com.supabase.cli.project='+identity,'--format','{{.ID}}']).strip()
 log.close();shutil.rmtree(work)
 if proof:
  proof['owned_runtime_removed']=True;(root/'tmp').mkdir(exist_ok=True);(root/('tmp/clinical-audio-sql-proof.json'if args.sql_only else'tmp/clinical-audio-local-proof.json')).write_text(json.dumps(proof,indent=2)+'\n')
 print('Owned audio containers, volumes and private work removed.',flush=True)
