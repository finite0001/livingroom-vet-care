"""Test the controlled-stock candidate or canonical205 in an owned local stack.

This runner cannot install a hosted engine, commission a site or approve clinical rules. Every policy/count is an
explicit synthetic fixture; all containers and volumes are removed afterward.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import uuid
from local_install import build_install, assert_prior, PriorMetadataDrift
from scalar_contract import capture_originals, verify_installation
from probe_failure import summarize_probe_failure
from canonical_prefix import canonical_prefix, canonical_binding
from canonical_post205 import capture_pre204, verify_canonical_installed

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--run-synthetic-local',action='store_true',required=True)
parser.add_argument('--include-sql-regression',action='store_true')
parser.add_argument('--include-correction-capacity',action='store_true',help='Run the separately bounded genuine correction-chain feasibility probe')
parser.add_argument('--include-correction-restore',action='store_true',help='Also prove the populated 1,000-correction opening restore inside the same workload budget')
mode=parser.add_mutually_exclusive_group()
mode.add_argument('--use-canonical-migration',action='store_true',help='Apply the exact canonical205 with the real CLI after independent204 capture')
mode.add_argument('--use-release-assembly',action='store_true',help='Install the independently pinned private artifact in this owned local stack')
args=parser.parse_args()
if args.include_correction_restore:args.include_correction_capacity=True
os.umask(0o077)
source=Path(__file__).resolve().parent
root=source.parents[3]
identity='lrv-controlled-engine-'+uuid.uuid4().hex[:10]
work=Path(tempfile.mkdtemp(prefix=identity+'-'))
project=work/'project'
result_dir=Path(tempfile.mkdtemp(prefix=identity+'-evidence-'))
log=(result_dir/'runner.log').open('w')
started=False
runtime=dict(identity=identity,work=str(work),project=str(project),root=str(root),baseline_migrations=204,
 canonical_candidate=None,controlled_policy_or_opening=False,new_rpc_grants=False,removed=False)

def command(argv,input=None,timeout=120):
 p=subprocess.run(argv,input=input,capture_output=True,text=True,cwd=root,timeout=timeout)
 log.write('COMMAND '+argv[0]+'\n'+('[Owned Docker inspection withheld]\n'if argv[:2]==['docker','inspect']else p.stdout+p.stderr)+'\n');log.flush()
 if p.returncode:raise RuntimeError('Owned candidate command failed; private log: '+str(result_dir/'runner.log'))
 return p.stdout

def verify():
 labels=json.loads(command(['docker','inspect','supabase_db_'+identity]))[0]['Config']['Labels']
 assert labels['com.supabase.cli.project']==identity
 assert Path(labels['com.supabase.cli.workdir']).resolve()==project.resolve()

def sql(query):
 verify()
 return command(['docker','exec','-i','supabase_db_'+identity,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],input=query)

def release_raw_sql(query):
 verify()
 result=subprocess.run(['docker','exec','-i','supabase_db_'+identity,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],
  input=query,capture_output=True,text=True,cwd=root,timeout=120)
 log.write('OWNED RELEASE REHEARSAL\n'+result.stdout+result.stderr+'\n');log.flush()
 return result

all_files=sorted((root/'supabase/migrations').glob('*.sql'))
files=canonical_prefix(source,all_files)
binding=canonical_binding(source,all_files)if args.use_canonical_migration else None
inputs=all_files+sorted(source.glob('*.sql'))+sorted(source.glob('*.py'))+sorted((root/'supabase/tests').glob('*.sql'))+[source/'trusted-prior-189.json',
 root/'.github/workflows/ci.yml',root/'tests/controlled-drugs/owned_scheduler.py',root/'tests/controlled-drugs/engine/source-reader.sql',root/'tests/controlled-drugs/engine/source-effects.sql']
if args.use_release_assembly or args.use_canonical_migration:
 inputs.extend([source/'release-expected-204.json',source/'release-expected-204-v1.json',source.parent/'release/controlled-stock-private.sql',source.parent/'release/controlled-stock-cli-body.sql'])
hashes={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest()for p in inputs}
proof={}
(result_dir/'source-hashes.json').write_text(json.dumps(hashes,sort_keys=True,indent=2)+'\n')
try:
 cli=command(['supabase','--version']).strip()
 assert cli=='2.118.0','Use the independently reviewed CLI bootstrap'
 for port in [64620,64621,64622,64624]:
  with socket.socket()as sock:sock.bind(('127.0.0.1',port))
 (project/'supabase/migrations').mkdir(parents=True)
 for path in files:shutil.copy2(path,project/'supabase/migrations'/path.name)
 if args.include_sql_regression:shutil.copytree(root/'supabase/tests',project/'supabase/tests')
 (project/'supabase/config.toml').write_text(f'''project_id = "{identity}"
[api]
port = 64621
[db]
port = 64622
shadow_port = 64620
major_version = 17
[studio]
enabled = false
[analytics]
enabled = false
[inbucket]
port = 64624
[auth]
site_url = "http://127.0.0.1:64621"
enable_signup = false
[storage]
enabled = true
[edge_runtime]
enabled = false
''')
 (result_dir/'runtime.json').write_text(json.dumps(runtime,indent=2))
 print('Protected evidence: '+str(result_dir),flush=True)
 print('Starting an owned local candidate stack; no hosted or provider operations.',flush=True)
 started=True
 command(['supabase','start','--workdir',str(project),'--exclude','realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'],timeout=600)
 verify()
 # Pause automatic jobs only in this owned disposable server. Keep schedule
 # rows intact and fingerprint every source relation; do not ignore cron writes.
 command(['docker','exec','-i','supabase_db_'+identity,'psql','-X','-qAt','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],input='alter system set cron.launch_active_jobs=off;select pg_reload_conf();')
 deadline=time.monotonic()+10
 while time.monotonic()<deadline:
  if sql("select current_setting('cron.launch_active_jobs')='off'and not exists(select 1 from pg_stat_activity where application_name='pg_cron'and state='active');").strip()=='t':break
  time.sleep(.05)
 else:raise RuntimeError('Owned scheduler pause did not settle')
 proof['scheduler_paused_owned_server_only']=True
 assert sql('select count(*)from supabase_migrations.schema_migrations;').strip()=='204'
 assert sql('select count(*)from auth.users;').strip()=='0'
 assert sql("select count(*)from stock_writer_manifests where definition_sha256=encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(signature)),'UTF8')),'hex');").strip()=='10'
 assert sql("select count(*)from pg_class where relnamespace='public'::regnamespace and left(relname,17)='controlled_stock_';").strip()=='0'
 roots=sql("select jsonb_object_agg(signature,definition_sha256)from stock_writer_manifests;").strip()
 bundle=build_install(source,files)
 install=bundle['install'];prior_sql=bundle['prior_sql'];trusted=bundle['trusted']
 barrier=bundle['barrier'];migration_sources=bundle['migration_sources']
 release_bundle=None
 if args.use_release_assembly or args.use_canonical_migration:
  from release_assembly import build_release
  from release_rehearsal import capture_baseline, rehearse_failures, verify_installed
  release_bundle=build_release(source,files)
  install=release_bundle['install']
  assert install.encode()==(source.parent/'release/controlled-stock-private.sql').read_bytes(),'Frozen release artifact differs from reviewed assembly'
  release_expected=json.loads((source/'release-expected-204.json').read_text())
 # Validate the untouched replay before deliberately injecting drift. Different
 # CLI/Postgres bootstrap defaults can change raw ACLs even with identical source
 # migrations; those differences must fail closed, not masquerade as rollback
 # damage or be normalized into the independent reference.
 untouched=json.loads(sql(prior_sql+'select pg_temp.controlled_stock_prior_snapshot();').splitlines()[-1])
 try:
  assert_prior(untouched,trusted)
 except PriorMetadataDrift as drift:
  # Metadata paths only: never include relation rows, caller claims or secrets.
  (result_dir/'untouched-prior-drift.json').write_text(json.dumps({'changed_metadata_paths':list(drift.changed_metadata_paths)},indent=2))
  raise
 scalar_originals=capture_originals(sql,trusted)
 if release_bundle is not None:
  release_baseline=capture_baseline(sql,prior_sql,trusted)
  (result_dir/'release-assembly-baseline.json').write_text(json.dumps(release_baseline,indent=2)+'\n')
  proof['frozen_release_install']={
   'artifact_sha256':release_bundle['artifact_sha256'],'pin_sha256':release_bundle['pin_sha256'],
   'failure_rehearsal':rehearse_failures(sql,release_raw_sql,install,prior_sql,trusted,release_baseline),
   'canonical_migration':False,'hosted_installation':False,'clinical_or_register_activation':False}
  assert proof['frozen_release_install']['failure_rehearsal'].get('passed')is True,'Frozen release failure rehearsal incomplete'
 (result_dir/'assembled-local-only.sql').write_text(install)
 drift_cases={
  'helper_definition':"alter function public.stock_writer_current()set statement_timeout='200ms';",
  'private_helper_grant':'grant execute on function public.stock_writer_current()to authenticated;',
  'private_relation_rls':'alter table public.stock_writer_admissions disable row level security;',
  'immutable_trigger':'alter table public.stock_movement_sources disable trigger immutable;',
 }
 for kind,mutation in drift_cases.items():
  failed=subprocess.run(['docker','exec','-i','supabase_db_'+identity,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],
   input=install.replace(barrier,barrier+mutation+'\n',1),capture_output=True,text=True,cwd=root,timeout=90)
  log.write('OWNED PRIOR DRIFT '+kind+'\n'+failed.stdout+failed.stderr+'\n');log.flush()
  assert failed.returncode!=0 and 'Controlled upgrade prior definitions or grants drifted; review required'in failed.stderr,'Prior drift was not rejected: '+kind
  assert sql("select count(*)from pg_class where relnamespace='public'::regnamespace and left(relname,17)='controlled_stock_';").strip()=='0','Rejected upgrade left persistent engine schema'
  restored=json.loads(sql(prior_sql+'select pg_temp.controlled_stock_prior_snapshot();').splitlines()[-1])
  assert restored==trusted['definition'],'Rejected upgrade left prior metadata changes: '+kind
 proof['trusted_prior_upgrade']={'functions':len(trusted['definition']['functions']),'relations':len(trusted['definition']['relations']),
  'definition_hash':trusted['definition_hash'],'trusted_reference_sha256':bundle['reference_sha256'],
  'trusted_migration_prefix':189,'current_replayed_migrations':len(files),'trusted_reference_regenerated':False,
  'trusted_migration_source_set_sha256':trusted['migration_source_set_sha256'],
  'current_migration_source_set_scope':'independently_pinned_preinstallation_204_prefix',
  'current_migration_source_set_sha256':hashlib.sha256(json.dumps(migration_sources,sort_keys=True).encode()).hexdigest(),
  'current_scoped_metadata_equals_original_reference':True,'drift_failures':list(drift_cases),'atomic_rollback_verified':True,'exclusive_barrier_before_preflight':True}
 print('Trusted prior metadata: four drift cases rejected before engine schema; exact rollback verified.',flush=True)
 if binding is not None:
  canonical_baseline=capture_pre204(sql,prior_sql,trusted,phase='ordinary')
  (result_dir/'canonical-pre204-baseline.json').write_text(json.dumps(canonical_baseline,indent=2)+'\n')
  canonical_path=root/binding['canonical_path']
  shutil.copy2(canonical_path,project/'supabase/migrations'/binding['filename'])
  verify()
  command(['supabase','migration','up','--local','--workdir',str(project),'--yes','--output-format','json'],timeout=240)
  proof['canonical_205_install']=verify_canonical_installed(sql,release_expected,canonical_baseline,binding)
  assert proof['canonical_205_install']['passed']is True
  runtime['canonical_candidate']=binding['filename']
 else:
  sql(install)
 proof['scalar_helper_compatibility']=verify_installation(sql,scalar_originals,source/'scalar-compatibility.sql')
 assert sql("select jsonb_object_agg(signature,definition_sha256)from stock_writer_manifests;").strip()==roots
 assert sql("select count(*)from stock_writer_manifests where definition_sha256=encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(signature)),'UTF8')),'hex');").strip()=='10'
 if release_bundle is not None and binding is None:
  proof['frozen_release_install']['installed']=verify_installed(sql,release_expected,release_baseline)
  assert proof['frozen_release_install']['installed'].get('passed')is True,'Frozen release installation verification incomplete'
  proof['frozen_release_install']['passed']=True
 if release_bundle is not None:
  if binding is not None:proof['frozen_release_install']['preinstallation_failures_passed']=True
  from column_acl_seal import probe_column_acl_seal
  proof['ongoing_column_acl_seal']=probe_column_acl_seal(sql,release_raw_sql,prior_sql,phase='installed',**({'ledger_mode':'canonical205','canonical_ledger':{'original_rows':canonical_baseline['ledger'],'binding':binding}}if binding is not None else{}))
  assert proof['ongoing_column_acl_seal'].get('passed')is True,'Ongoing column ACL seal proof incomplete'
 runtime['engine_installed_owned_local_only']=True;(result_dir/'runtime.json').write_text(json.dumps(runtime,indent=2))
 print('Candidate installed locally; three scalar helper implementations verified; all ten canonical writer bodies unchanged; new RPCs revoked.',flush=True)
 if args.include_sql_regression:
  output=command(['supabase','test','db','--workdir',str(project)],timeout=420)
  assert 'All tests successful.'in output and 'Files=166, Tests=7338'in output
  proof['ordinary_sql_regression']={'files':166,'assertions':7338}
  print('Ordinary compatibility:166 canonical SQL suites /7338 assertions passed with the candidate installed.',flush=True)
 environment={**os.environ,'CONTROLLED_ENGINE_RESULT_DIR':str(result_dir),
  'CONTROLLED_ENGINE_CORRECTION_RESTORE':'1'if args.include_correction_restore else'0'}
 probes=[('probe-smoke.py','smoke'),('probe-native.py','managed_native'),('probe-opening.py','opening_boundary'),('probe-capacity.py','opening_capacity')]
 if args.include_correction_capacity:probes.append(('probe-correction-capacity.py','opening_correction_capacity'))
 probes.append(('probe-api.py','genuine_auth_api'))
 for probe,name in probes:
  # Each capacity probe has one 900-second workload deadline, including ownership
  # checks. The parent leaves separate time for mandatory owned-resource cleanup.
  probe_timeout=960 if name in('opening_capacity','opening_correction_capacity')else 360
  p=subprocess.run(['python3','-B',str(source/probe)],env=environment,capture_output=True,text=True,cwd=root,timeout=probe_timeout)
  log.write(probe+'\n'+p.stdout+p.stderr+'\n');log.flush()
  if p.returncode:
   try:print(json.dumps(summarize_probe_failure(probe,p.returncode,p.stdout,p.stderr,result_dir)),flush=True)
   except Exception:print('Controlled probe failed; sanitized diagnostic unavailable.',flush=True)
   raise RuntimeError(probe+' failed; protected result directory: '+str(result_dir))
  proof[name]=json.loads(next(line for line in reversed(p.stdout.splitlines())if line.startswith('{')))
  if name=='opening_correction_capacity'and args.include_correction_restore:
   assert proof[name].get('selected_schema_populated_restore_proven')is True,'Requested correction restore proof missing'
  print(name+' passed.',flush=True)
 for path,digest in hashes.items():assert hashlib.sha256((root/path).read_bytes()).hexdigest()==digest,'Candidate source changed during proof: '+path
 proof.update(synthetic_only=True,canonical_migration=binding is not None,repository_canonical_migration_count=len(all_files),canonical_migration_filename=binding['filename']if binding is not None else None,hosted_writes=0,provider_requests=0,actual_practice_rules=False,
  project_id=identity,source_hashes=hashes,all_ten_canonical_root_definitions_unchanged=True)
finally:
 try:
  if started:
   owned=command(['docker','ps','-a','--filter','label=com.supabase.cli.project='+identity,'--format','{{.Names}}']).splitlines()
   for name in owned:
    labels=json.loads(command(['docker','inspect',name]))[0]['Config']['Labels']
    assert labels['com.supabase.cli.project']==identity and Path(labels['com.supabase.cli.workdir']).resolve()==project.resolve()
   command(['supabase','stop','--workdir',str(project),'--no-backup'],timeout=180)
   containers=command(['docker','ps','-a','--filter','label=com.supabase.cli.project='+identity,'--format','{{.Names}}']).strip()
   volumes=command(['docker','volume','ls','--filter','label=com.supabase.cli.project='+identity,'--format','{{.Name}}']).strip()
   assert not containers and not volumes,'Owned candidate cleanup incomplete'
   runtime=json.loads((result_dir/'runtime.json').read_text());runtime['removed']=True
   (result_dir/'runtime.json').write_text(json.dumps(runtime,indent=2))
   proof['owned_containers_and_volumes_removed']=True
   print('Owned candidate containers and volumes removed.',flush=True)
  shutil.rmtree(work)
 finally:log.close()
if proof.get('genuine_auth_api'):
 (result_dir/'result.json').write_text(json.dumps(proof,indent=2))
 print('Sanitized candidate result: '+str(result_dir/'result.json'),flush=True)
