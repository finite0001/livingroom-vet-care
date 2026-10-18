"""Build and test the unpublished controlled-stock candidate in an owned local stack.

This is deliberately outside supabase/migrations. It cannot install a hosted
engine, commission a site or approve clinical rules. Every policy/count is an
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

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--run-synthetic-local',action='store_true',required=True)
parser.add_argument('--include-sql-regression',action='store_true')
args=parser.parse_args()
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
 return command(['docker','exec','-i','supabase_db_'+identity,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],input=query)

files=sorted((root/'supabase/migrations').glob('*.sql'))
assert len(files)==204,'Candidate targets the exact 204-migration release; review before rebasing'
inputs=files+sorted(source.glob('*.sql'))+sorted(source.glob('*.py'))+sorted((root/'supabase/tests').glob('*.sql'))+[source/'trusted-prior-189.json',
 root/'tests/controlled-drugs/engine/source-reader.sql',root/'tests/controlled-drugs/engine/source-effects.sql']
hashes={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest()for p in inputs}
proof={}
try:
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
 parts=[(source/(name+'.sql')).read_text()for name in ['schema','helpers','effects','review']]
 for name in ['source-reader.sql','source-effects.sql']:
  parts.append((source.parent/name).read_text().replace('pg_temp.controlled_stock_','public.controlled_stock_'))
 parts.extend((source/(name+'.sql')).read_text()for name in ['posting','opening','constraints','entry','protocol','guards','seal'])
 # The expected catalog is independently retained from the original canonical
 # 189 replay, never rebuilt from this candidate or a deployed catalog. Newer
 # migrations may coexist only if the scoped metadata still equals that pin.
 reference=(source/'trusted-prior-189.json').read_bytes()
 assert hashlib.sha256(reference).hexdigest()=='7c39d7d55b7aed8f11159555bbcd880c5910b1fa2891e495c28d2a1b6dbc5ac1','Original trusted reference changed; review its independent provenance'
 trusted=json.loads(reference)
 migration_sources={p.name:hashlib.sha256(p.read_bytes()).hexdigest()for p in files}
 trusted_sources={p.name:migration_sources[p.name]for p in files[:189]}
 assert trusted['migration_count']==189 and trusted['migration_source_set_sha256']==hashlib.sha256(json.dumps(trusted_sources,sort_keys=True).encode()).hexdigest(),'Trusted prior migration prefix changed; review the upgrade baseline'
 prior_sql=(source/'prior-snapshot.sql').read_text()
 assert trusted['snapshot_sql_sha256']==hashlib.sha256(prior_sql.encode()).hexdigest(),'Prior snapshot coverage changed; review the baseline'
 # Validate the untouched replay before deliberately injecting drift. Different
 # CLI/Postgres bootstrap defaults can change raw ACLs even with identical source
 # migrations; those differences must fail closed, not masquerade as rollback
 # damage or be normalized into the independent reference.
 untouched=json.loads(sql(prior_sql+'select pg_temp.controlled_stock_prior_snapshot();').splitlines()[-1])
 if untouched!=trusted['definition']:
  changed=[]
  for family in ['functions','relations']:
   expected_objects=trusted['definition'][family];actual_objects=untouched[family]
   for name in sorted(expected_objects.keys()|actual_objects.keys()):
    if name not in expected_objects or name not in actual_objects:
     changed.append(family+'/'+name)
    else:
     expected_object=expected_objects[name];actual_object=actual_objects[name]
     changed.extend(family+'/'+name+'/'+field for field in sorted(expected_object.keys()|actual_object.keys())
      if expected_object.get(field)!=actual_object.get(field))
  # Metadata paths only: never include relation rows, caller claims or secrets.
  (result_dir/'untouched-prior-drift.json').write_text(json.dumps({'changed_metadata_paths':changed},indent=2))
  raise AssertionError('Untouched replay differs from independently trusted prior metadata; review CLI/Postgres bootstrap environment: '+', '.join(changed))
 expected="'"+json.dumps(trusted['definition']).replace("'","''")+"'::jsonb"
 barrier='begin;\nselect pg_advisory_xact_lock(90271040,0);\n'
 preflight=prior_sql+"\ndo $$begin if pg_temp.controlled_stock_prior_snapshot()is distinct from "+expected+" then raise exception 'Controlled upgrade prior definitions or grants drifted; review required'using errcode='23514';end if;end $$;\n"
 install=barrier+preflight+'\n'.join(parts)
 install=install.replace('set search_path=public,pg_temp as $$',"set search_path=public,pg_temp set timezone='UTC' as $$")
 install+='''
do $$declare r record;d jsonb;begin
 for r in select p.oid::regprocedure signature from pg_proc p where p.pronamespace='public'::regnamespace
 and(left(p.proname,17)='controlled_stock_'or p.proname in('read_controlled_stock_action','prepare_controlled_stock_action','execute_controlled_stock_action','cancel_controlled_stock_action'))loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',r.signature);end loop;
 -- Local-only initial technical baseline; this is not a hosted drift acceptance mechanism.
 d:=controlled_stock_manifest_snapshot();
 insert into controlled_stock_engine_manifests(revision,definition,definition_hash)values(1,d,controlled_stock_hash(d));
end $$;
select controlled_stock_manifest_required();commit;
'''
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
  'definition_hash':trusted['definition_hash'],'trusted_reference_sha256':hashlib.sha256(reference).hexdigest(),
  'trusted_migration_prefix':189,'current_replayed_migrations':len(files),'trusted_reference_regenerated':False,
  'trusted_migration_source_set_sha256':trusted['migration_source_set_sha256'],
  'current_migration_source_set_sha256':hashlib.sha256(json.dumps(migration_sources,sort_keys=True).encode()).hexdigest(),
  'current_scoped_metadata_equals_original_reference':True,'drift_failures':list(drift_cases),'atomic_rollback_verified':True,'exclusive_barrier_before_preflight':True}
 print('Trusted prior metadata: four drift cases rejected before engine schema; exact rollback verified.',flush=True)
 sql(install)
 assert sql("select jsonb_object_agg(signature,definition_sha256)from stock_writer_manifests;").strip()==roots
 assert sql("select count(*)from stock_writer_manifests where definition_sha256=encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(signature)),'UTF8')),'hex');").strip()=='10'
 runtime['unpublished_engine_schema']=True;(result_dir/'runtime.json').write_text(json.dumps(runtime,indent=2))
 print('Candidate installed locally; all ten canonical root definitions unchanged; new RPCs revoked.',flush=True)
 if args.include_sql_regression:
  output=command(['supabase','test','db','--workdir',str(project)],timeout=420)
  assert 'All tests successful.'in output and 'Files=166, Tests=7338'in output
  proof['ordinary_sql_regression']={'files':166,'assertions':7338}
  print('Ordinary compatibility:166 canonical SQL suites /7338 assertions passed with the candidate installed.',flush=True)
 environment={**os.environ,'CONTROLLED_ENGINE_RESULT_DIR':str(result_dir)}
 for probe,name in [('probe-smoke.py','smoke'),('probe-native.py','managed_native'),('probe-opening.py','opening_boundary'),('probe-api.py','genuine_auth_api')]:
  p=subprocess.run(['python3','-B',str(source/probe)],env=environment,capture_output=True,text=True,cwd=root,timeout=360)
  log.write(probe+'\n'+p.stdout+p.stderr+'\n');log.flush()
  if p.returncode:raise RuntimeError(probe+' failed; protected result directory: '+str(result_dir))
  proof[name]=json.loads(next(line for line in reversed(p.stdout.splitlines())if line.startswith('{')))
  print(name+' passed.',flush=True)
 for path,digest in hashes.items():assert hashlib.sha256((root/path).read_bytes()).hexdigest()==digest,'Candidate source changed during proof: '+path
 proof.update(synthetic_only=True,canonical_migration=False,hosted_writes=0,provider_requests=0,actual_practice_rules=False,
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
  shutil.rmtree(work)
 finally:log.close()
if proof.get('genuine_auth_api'):
 (result_dir/'result.json').write_text(json.dumps(proof,indent=2))
 print('Sanitized candidate result: '+str(result_dir/'result.json'),flush=True)
