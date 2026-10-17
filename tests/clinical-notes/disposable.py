"""Verify clinical note templates in a uniquely owned, disposable local stack."""
import argparse, hashlib, json, os, shutil, socket, subprocess, tempfile, uuid
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--run-synthetic-local',action='store_true',required=True)
p.add_argument('--include-sql-regression',action='store_true')
p.add_argument('--sql-only',action='store_true')
args=p.parse_args();os.umask(0o077)
root=Path(__file__).resolve().parents[2];identity='lrv-clinical-notes-'+uuid.uuid4().hex[:10]
work=Path(tempfile.mkdtemp(prefix=identity+'-'));project=work/'project';(project/'supabase/migrations').mkdir(parents=True)
evidence=Path(tempfile.mkdtemp(prefix=identity+'-evidence-'));log=(evidence/'commands.log').open('w');started=False;proof=None
inputs=set((root/'supabase/migrations').glob('*.sql'))|set((root/'supabase/tests').glob('clinical_notes*.test.sql'))|{root/'tests/clinical-notes/disposable.py'}
if not args.sql_only:inputs|=set((root/'tests/clinical-notes').glob('*'))|set((root/'src/hub/features/clinical/templates').rglob('*'))|set((root/'supabase/functions/_shared').glob('clinical-note*.ts'))|set((root/'supabase/functions/clinical-note-process').glob('*'))|{root/'supabase/functions/_shared/clinical-veterinary-context.ts',root/'src/hub/features/clinical/ClinicalWorkspace.tsx',root/'src/hub/features/clinical/dictation/ClinicalDictationReview.tsx',root/'package-lock.json'}
hashes={str(f.relative_to(root)):hashlib.sha256(f.read_bytes()).hexdigest()for f in sorted(inputs)if f.is_file()}
def run(argv,**kw):
 r=subprocess.run(argv,capture_output=True,text=True,cwd=root,timeout=kw.pop('timeout',300),**kw);log.write('COMMAND '+argv[0]+'\n'+('[Owned Docker inspection withheld]\n' if argv[:2]==['docker','inspect'] else r.stdout+r.stderr)+'\n');log.flush()
 if r.returncode:
  print((r.stdout+r.stderr)[-5000:],flush=True)
  raise RuntimeError('Owned note proof failed; private log '+str(evidence/'commands.log'))
 return r.stdout
try:
 for port in [65120,65121,65122,65124,65181]:
  with socket.socket()as s:s.bind(('127.0.0.1',port))
 files=sorted((root/'supabase/migrations').glob('*.sql'));assert len(files)==201
 for f in files:shutil.copy2(f,project/'supabase/migrations'/f.name)
 (project/'supabase/tests').mkdir()
 for f in(root/'supabase/tests').glob('*.sql'):
  if args.include_sql_regression or f.name.startswith('clinical_notes'):shutil.copy2(f,project/'supabase/tests'/f.name)
 (project/'supabase/config.toml').write_text(f'''project_id = "{identity}"
[api]
port = 65121
[db]
port = 65122
shadow_port = 65120
major_version = 17
[studio]
enabled = false
[analytics]
enabled = false
[inbucket]
port = 65124
[auth]
site_url = "http://127.0.0.1:65181"
enable_signup = false
[storage]
enabled = true
[edge_runtime]
enabled = false
''')
 print('Starting uniquely owned local note runtime.',flush=True);started=True
 # Storage schema bootstrap is required by historical migrations. This note proof
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
  result=run(['node','--experimental-strip-types',str(root/'tests/clinical-notes/local-roundtrip.ts')],env={**os.environ,'NOTE_TEST_PROJECT':str(project),'NOTE_RUN_SYNTHETIC_LOCAL':'true'},timeout=600);print(result.strip(),flush=True)
 assert all(hashlib.sha256((root/name).read_bytes()).hexdigest()==digest for name,digest in hashes.items()),'Proof input changed during run'
 proof={'identity':identity,'migrations':201,'sql_summary':summary,'sql_only':args.sql_only,'source_sha256':hashes,'provider_requests':0,'owned_runtime_removed':False}
 if not args.sql_only:proof['auth_browser_restore']=json.loads((root/'tmp/clinical-notes-roundtrip.json').read_text())
finally:
 if started:
  run(['supabase','stop','--workdir',str(project),'--no-backup'],timeout=180)
  assert not run(['docker','ps','-a','--filter','label=com.supabase.cli.project='+identity,'--format','{{.ID}}']).strip()
 log.close();shutil.rmtree(work)
 if proof:
  proof['owned_runtime_removed']=True;(root/'tmp').mkdir(exist_ok=True);(root/('tmp/clinical-notes-sql-proof.json'if args.sql_only else'tmp/clinical-notes-local-proof.json')).write_text(json.dumps(proof,indent=2)+'\n')
 print('Owned note containers, volumes and private work removed.',flush=True)
