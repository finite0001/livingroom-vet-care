"""Restore populated private controlled draft/history and recover original receipts exactly."""
import argparse,json,subprocess,uuid
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--run-synthetic-local',action='store_true',required=True);parser.add_argument('--project-config',type=Path,required=True);args=parser.parse_args()
project=args.project_config.resolve().parent.parent;identity=args.project_config.read_text().splitlines()[0].split('"')[1];assert identity.startswith(('lrv-controlled-','lrv-catalog-'));container='supabase_db_'+identity
labels=json.loads(subprocess.check_output(['docker','inspect',container],text=True))[0]['Config']['Labels'];assert labels['com.supabase.cli.project']==identity and Path(labels['com.supabase.cli.workdir']).resolve()==project

def sql(query,database='postgres'):
 r=subprocess.run(['docker','exec','-i',container,'psql','-X','-qAt','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1'],input=query,capture_output=True,text=True,timeout=60);assert r.returncode==0,r.stderr[-1600:];return r.stdout.strip()
tables=['controlled_draft_entries','controlled_draft_versions','controlled_draft_reviews','controlled_draft_actions','controlled_draft_cancellations','catalog_products']
snapshot='select jsonb_build_object('+','.join("'%s',(select jsonb_build_object('count',count(*),'hash',md5(coalesce(string_agg(to_jsonb(t)::text,'|'order by to_jsonb(t)::text),'')))from %s t)"%(table,table)for table in tables)+');'
before=sql(snapshot);assert all(row['count']>0 for row in json.loads(before).values()),'All five draft families and linked products must be populated'
record=json.loads(sql("select jsonb_build_object('id',a.id,'actor',a.actor_id,'session',a.session_id,'entry',v.entry_id)from controlled_draft_actions a join controlled_draft_versions v on v.id=a.version_id order by a.created_at limit 1;"))
recovery_session=str(uuid.uuid4())
claims=json.dumps({'role':'authenticated','sub':record['actor'],'session_id':recovery_session},separators=(',',':'))
recover=f"begin;update profiles set is_active=true where id='{record['actor']}';insert into auth.sessions(id,user_id,created_at,updated_at)values('{recovery_session}','{record['actor']}',clock_timestamp(),clock_timestamp());set local role authenticated;set local request.jwt.claims='{claims}';set local timezone='America/Denver';select read_controlled_draft_review('{record['actor']}','{record['id']}');rollback;"
expected=json.loads(sql(recover).splitlines()[-1]);assert expected['state']=='saved'and expected['receipt']is not None
assert sql(snapshot)==before,'Read-only recovery helper must roll back temporary staff/session activation'
database='owned_controlled_restore_'+uuid.uuid4().hex[:12];marker=str(uuid.uuid4());sql(f"create database {database};comment on database {database} is '{marker}';")
try:
 sql('drop schema public;create schema extensions;create extension pgcrypto with schema extensions;create extension "uuid-ossp"with schema extensions;',database)
 dump=subprocess.check_output(['docker','exec',container,'pg_dump','-U','postgres','--no-owner','--schema=public','--schema=auth','--schema=storage','--schema=extensions','postgres'],timeout=60);assert len(dump)<50*1024*1024
 restored=dump.decode().replace('CREATE SCHEMA extensions;','CREATE SCHEMA IF NOT EXISTS extensions;');restored='\n'.join(line for line in restored.splitlines()if not line.startswith('ALTER DEFAULT PRIVILEGES'))
 sql(restored,database);assert sql(snapshot,database)==before
 assert json.loads(sql(recover,database).splitlines()[-1])==expected,'Original request/receipt must survive restore and caller timezone'
 assert sql(snapshot,database)==before
 for table in tables[:5]:assert sql(f"select has_table_privilege('authenticated','{table}','SELECT')or has_table_privilege('service_role','{table}','INSERT');",database)=='f'
 assert sql("select has_function_privilege('authenticated','controlled_draft_validate(text,jsonb,boolean)','EXECUTE')or has_function_privilege('service_role','execute_controlled_draft_review(uuid,uuid)','EXECUTE');",database)=='f'
 assert sql(f"select controlled_draft_view('{record['entry']}')->>'created_at';",database).endswith('Z')
finally:
 assert sql(f"select shobj_description(oid,'pg_database')from pg_database where datname='{database}';")==marker;sql(f'drop database {database};')
assert sql(snapshot)==before
proof={'populated_relations':6,'private_draft_families':5,'exact_snapshot_restored':True,'exact_original_review_recovered':True,'caller_timezone_invariant':True,'private_grants_restored':True,'owned_restore_database_removed':True,'provider_requests':0}
(project/'controlled-restore-proof.json').write_text(json.dumps(proof,indent=2));print(json.dumps(proof))
