"""Populated reconciliation ledger restore in a uniquely owned local database."""
import argparse
import json
from pathlib import Path
import subprocess
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--run-synthetic-local', action='store_true', required=True)
parser.add_argument('--project-config', type=Path, required=True)
args = parser.parse_args()
project = args.project_config.resolve().parent.parent
identity = args.project_config.read_text().splitlines()[0].split('"')[1]
assert identity.startswith(('lrv-reconcile-', 'lrv-catalog-'))
container = 'supabase_db_' + identity
labels = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]['Config']['Labels']
assert labels['com.supabase.cli.project'] == identity and Path(labels['com.supabase.cli.workdir']).resolve() == project

def sql(query, database='postgres'):
    command = ['docker','exec','-i',container,'psql','-X','-qAt','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1']
    result = subprocess.run(command,input=query,capture_output=True,text=True,timeout=60)
    assert result.returncode == 0, result.stderr[-1200:]
    return result.stdout.strip()

tables = ['operational_reconciliation_policy','operational_reconciliation_runs','operational_reconciliation_results','operational_reconciliation_cursor']
snapshot = 'select jsonb_build_object(' + ','.join("'%s',(select jsonb_build_object('count',count(*),'hash',md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')))from %s t)" % (table,table) for table in tables) + ');'
before = sql(snapshot)
assert all(value['count']>0 for value in json.loads(before).values()), 'All four ledger families must be populated'
run = json.loads(sql("select jsonb_build_object('id',run_id,'limit',requested_limit)from operational_reconciliation_runs order by started_at limit 1;"))
recover = "set role service_role;set request.jwt.claims='{\"role\":\"service_role\"}';select recover_operational_reconciliation_run('%s',%s);" % (run['id'],run['limit'])
expected = sql(recover)
database = 'owned_reconciliation_restore_' + uuid.uuid4().hex[:12]
marker = str(uuid.uuid4())
sql(f"create database {database};comment on database {database} is '{marker}';")
try:
    sql('drop schema public;create schema extensions;create extension pgcrypto with schema extensions;create extension "uuid-ossp" with schema extensions;',database)
    dump = subprocess.check_output(['docker','exec',container,'pg_dump','-U','postgres','--no-owner','--schema=public','--schema=auth','--schema=storage','--schema=extensions','postgres'],timeout=60)
    assert len(dump)<50*1024*1024
    restored = dump.decode().replace('CREATE SCHEMA extensions;','CREATE SCHEMA IF NOT EXISTS extensions;')
    restored = '\n'.join(line for line in restored.splitlines()if not line.startswith('ALTER DEFAULT PRIVILEGES'))
    sql(restored,database)
    assert sql(snapshot,database)==before
    assert sql(recover,database)==expected, 'Read-only recovered result must retain its exact request/cursor evidence'
    for table in tables:
        assert sql(f"select has_table_privilege('authenticated','{table}','SELECT')or has_table_privilege('service_role','{table}','INSERT');",database)=='f'
    assert sql("select has_function_privilege('service_role','operational_reconciliation_source(text,uuid)','EXECUTE');",database)=='f'
    assert sql("select has_function_privilege('authenticated','execute_operational_reconciliation_run(uuid,integer)','EXECUTE');",database)=='f'
finally:
    assert sql(f"select shobj_description(oid,'pg_database')from pg_database where datname='{database}';")==marker
    sql(f'drop database {database};')
proof = {'populated_relations':4,'exact_snapshot_restored':True,'exact_readonly_recovery':True,'private_table_and_helper_grants':True,'owned_restore_database_removed':True,'provider_requests':0}
(project/'reconciliation-restore-proof.json').write_text(json.dumps(proof,indent=2))
print(json.dumps(proof))
