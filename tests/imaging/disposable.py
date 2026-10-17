"""Owned synthetic imaging Auth, Storage, browser, concurrency and restore proof."""
import argparse,hashlib,json,os,shutil,socket,subprocess,tempfile,uuid
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--run-synthetic-local',action='store_true',required=True)
p.add_argument('--include-sql-regression',action='store_true')
args=p.parse_args();os.umask(0o077)
root=Path(__file__).resolve().parents[2];identity='lrv-imaging-'+uuid.uuid4().hex[:10]
work=Path(tempfile.mkdtemp(prefix=identity+'-'));project=work/'project';(project/'supabase/migrations').mkdir(parents=True)
evidence=Path(tempfile.mkdtemp(prefix=identity+'-evidence-'));log=(evidence/'commands.log').open('w');started=False;proof=None
inputs=set((root/'supabase/migrations').glob('*.sql'))|set((root/'src/hub/features/imaging').glob('*'))|set((root/'tests/imaging').glob('*'))|{root/'supabase/tests/imaging_studies.test.sql',root/'src/hub/features/patients/PatientPage.tsx',root/'package-lock.json'}
hashes={str(f.relative_to(root)):hashlib.sha256(f.read_bytes()).hexdigest()for f in sorted(inputs)if f.is_file()}
def run(argv,**kw):
 r=subprocess.run(argv,capture_output=True,text=True,cwd=root,timeout=kw.pop('timeout',300),**kw);log.write('COMMAND '+argv[0]+'\n'+r.stdout+r.stderr+'\n');log.flush()
 if r.returncode:raise RuntimeError('Owned imaging proof failed; private log '+str(evidence/'commands.log'))
 return r.stdout
try:
 for port in [65020,65021,65022,65024,65081]:
  with socket.socket()as s:s.bind(('127.0.0.1',port))
 files=sorted((root/'supabase/migrations').glob('*.sql'));assert len(files)==199
 for f in files:shutil.copy2(f,project/'supabase/migrations'/f.name)
 (project/'supabase/tests').mkdir()
 for f in(root/'supabase/tests').glob('*.sql'):
  if args.include_sql_regression or f.name=='imaging_studies.test.sql':shutil.copy2(f,project/'supabase/tests'/f.name)
 (project/'supabase/config.toml').write_text(f'''project_id = "{identity}"
[api]
port = 65021
[db]
port = 65022
shadow_port = 65020
major_version = 17
[studio]
enabled = false
[analytics]
enabled = false
[inbucket]
port = 65024
[auth]
site_url = "http://127.0.0.1:65081"
enable_signup = false
[storage]
enabled = true
[edge_runtime]
enabled = false
''')
 print('Starting owned synthetic imaging runtime.',flush=True);started=True
 run(['supabase','start','--workdir',str(project),'--exclude','realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'],timeout=600)
 labels=json.loads(run(['docker','inspect','supabase_db_'+identity]))[0]['Config']['Labels']
 assert labels['com.supabase.cli.project']==identity and Path(labels['com.supabase.cli.workdir']).resolve()==project.resolve()
 run(['docker','exec','-i','supabase_db_'+identity,'psql','-X','-qAt','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],input='alter system set cron.launch_active_jobs=off;select pg_reload_conf();')
 result=run(['supabase','test','db','--workdir',str(project)],timeout=420);assert 'All tests successful.'in result
 summary=result[result.rfind('All tests successful.'):].strip();print(summary,flush=True)
 result=run(['node','--experimental-strip-types',str(root/'tests/imaging/local-roundtrip.ts')],env={**os.environ,'IMAGING_TEST_PROJECT':str(project),'IMAGING_RUN_SYNTHETIC_LOCAL':'true'},timeout=420);print(result.strip(),flush=True)
 assert all(hashlib.sha256((root/name).read_bytes()).hexdigest()==digest for name,digest in hashes.items()),'Proof input changed during run'
 proof={'identity':identity,'migrations':199,'sql_summary':summary,'source_sha256':hashes,'provider_requests':0,'auth_browser_restore':json.loads((root/'tmp/imaging-roundtrip.json').read_text()),'owned_runtime_removed':False}
finally:
 if started:
  run(['supabase','stop','--workdir',str(project),'--no-backup'],timeout=180)
  assert not run(['docker','ps','-a','--filter','label=com.supabase.cli.project='+identity,'--format','{{.ID}}']).strip()
 log.close();shutil.rmtree(work)
 if proof:
  proof['owned_runtime_removed']=True;(root/'tmp').mkdir(exist_ok=True);(root/'tmp/imaging-local-proof.json').write_text(json.dumps(proof,indent=2)+'\n')
 print('Owned imaging containers, volumes and private work removed.',flush=True)
