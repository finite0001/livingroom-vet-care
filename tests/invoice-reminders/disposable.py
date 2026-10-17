"""Run reminder proofs only in a uniquely owned disposable local stack."""
import argparse,hashlib,json,os,shutil,socket,subprocess,tempfile,uuid
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--run-synthetic-local',action='store_true',required=True);p.add_argument('--include-sql-regression',action='store_true');args=p.parse_args()
os.umask(0o077);root=Path(__file__).resolve().parents[2];identity='lrv-invoice-reminders-'+uuid.uuid4().hex[:10];work=Path(tempfile.mkdtemp(prefix=identity+'-'));project=work/'project';(project/'supabase/migrations').mkdir(parents=True);evidence=Path(tempfile.mkdtemp(prefix=identity+'-evidence-'));log=(evidence/'commands.log').open('w');started=False;proof=None
inputs=sorted(set((root/'supabase/migrations').glob('*.sql'))|set((root/'src/hub/features/billing/reminders').glob('*'))|set((root/'tests/invoice-reminders').glob('*'))|{root/'supabase/tests/invoice_reminders.test.sql',root/'supabase/functions/_shared/invoice-reminder-handler.ts',root/'src/hub/features/billing/HouseholdInvoices.tsx',root/'src/hub/pages/SettingsPage.tsx',root/'src/hub/features/prescriptions/NativeReturnPolicySettings.tsx',root/'src/hub/features/clinical/use-unsaved-changes.tsx',root/'package-lock.json',root/'scripts/invoice-reminders/rollback-probe.sql'})
hashes={str(f.relative_to(root)):hashlib.sha256(f.read_bytes()).hexdigest()for f in inputs if f.is_file()}
def run(argv,**kw):
 r=subprocess.run(argv,capture_output=True,text=True,cwd=root,timeout=kw.pop('timeout',300),**kw);log.write('COMMAND '+argv[0]+'\n'+r.stdout+r.stderr+'\n');log.flush()
 if r.returncode:
  if argv[:3]==['supabase','test','db']:print((r.stdout+r.stderr)[-6000:],flush=True)
  raise RuntimeError('Owned invoice reminder proof failed; private log '+str(evidence/'commands.log'))
 return r.stdout
try:
 for n in [64720,64721,64722,64724,64781]:
  with socket.socket()as s:s.bind(('127.0.0.1',n))
 files=sorted((root/'supabase/migrations').glob('*.sql'));assert len(files)==202
 for file in files:shutil.copy2(file,project/'supabase/migrations'/file.name)
 (project/'supabase/tests').mkdir()
 for file in (root/'supabase/tests').glob('*.sql'):
  if args.include_sql_regression or file.name=='invoice_reminders.test.sql':shutil.copy2(file,project/'supabase/tests'/file.name)
 (project/'supabase/config.toml').write_text(f'''project_id = "{identity}"
[api]
port = 64721
[db]
port = 64722
shadow_port = 64720
major_version = 17
[studio]
enabled = false
[analytics]
enabled = false
[inbucket]
port = 64724
[auth]
site_url = "http://127.0.0.1:64781"
enable_signup = false
[storage]
enabled = true
[edge_runtime]
enabled = false
''')
 print('Starting uniquely owned local invoice reminder runtime.',flush=True);started=True
 run(['supabase','start','--workdir',str(project),'--exclude','realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'],timeout=600)
 labels=json.loads(run(['docker','inspect','supabase_db_'+identity]))[0]['Config']['Labels'];assert labels['com.supabase.cli.project']==identity and Path(labels['com.supabase.cli.workdir']).resolve()==project.resolve()
 run(['docker','exec','-i','supabase_db_'+identity,'psql','-X','-qAt','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],input='alter system set cron.launch_active_jobs=off;select pg_reload_conf();')
 sql_result=run(['supabase','test','db','--workdir',str(project)],timeout=420)
 assert 'All tests successful.'in sql_result
 print(sql_result[sql_result.rfind('All tests successful.'):].strip(),flush=True)
 probe=root/'scripts/invoice-reminders/rollback-probe.sql'
 output=run(['docker','exec','-i','supabase_db_'+identity,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],input=probe.read_text())
 rollback=json.loads(next(line for line in reversed(output.splitlines())if line.startswith('{"checks"')))
 assert rollback['checks']==53 and rollback['provider_requests']==0 and rollback['rollback_only']is True
 print('Scoped hosted-style rollback probe:53 checks; no real queue claimed.',flush=True)
 harness=root/'tests/invoice-reminders/local-roundtrip.ts';assert harness.exists()
 native_result=run(['node','--experimental-strip-types',str(harness)],env={**os.environ,'INVOICE_REMINDER_TEST_PROJECT':str(project),'INVOICE_REMINDER_RUN_SYNTHETIC_LOCAL':'true'},timeout=420);print(native_result.strip(),flush=True)
 assert all(hashlib.sha256((root/name).read_bytes()).hexdigest()==digest for name,digest in hashes.items()),'Proof input changed during run'
 proof={'identity':identity,'migrations':202,'sql_summary':sql_result[sql_result.rfind('All tests successful.'):].strip(),'auth_browser':json.loads((root/'tmp/invoice-reminder-auth-proof.json').read_text()),'restore':json.loads((root/'tmp/invoice-reminder-restore-proof.json').read_text()),'rollback_probe':rollback,'source_sha256':hashes,'provider_requests':0,'owned_runtime_removed':False}
finally:
 if started:
  run(['supabase','stop','--workdir',str(project),'--no-backup'],timeout=180)
  assert run(['docker','ps','-a','--filter','label=com.supabase.cli.project='+identity,'--format','{{.ID}}']).strip()==''
 log.close();shutil.rmtree(work)
 if proof:
  proof['owned_runtime_removed']=True;(root/'tmp').mkdir(exist_ok=True);(root/'tmp/invoice-reminder-local-proof.json').write_text(json.dumps(proof,indent=2)+'\n')
 print('Owned invoice reminder containers, volumes and private work removed.',flush=True)
