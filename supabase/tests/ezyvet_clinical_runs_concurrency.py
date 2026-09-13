"""Actual local PostgreSQL contention; synthetic fixtures only, never provider calls."""
import argparse
from pathlib import Path
import json
import subprocess
import time
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--project-config', type=Path, help='Derive the database container from a Supabase TOML project_id')
args = parser.parse_args()
CONTAINER = 'supabase_db_livingroom-vet-foundation'
if args.project_config:
    import tomllib
    with args.project_config.open('rb') as config_file:
        CONTAINER = 'supabase_db_' + tomllib.load(config_file)['project_id']
FOUNDATION_COMMAND = ['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1']

COMMAND = FOUNDATION_COMMAND.copy()

def sql(query, fail=True):
    result = subprocess.run(COMMAND, input=query, capture_output=True, text=True)
    if fail and result.returncode:
        raise AssertionError(result.stderr)
    return result

def quote(value):
    return "'" + str(value).replace("'", "''") + "'"

actor = 'db490000-0000-4000-8000-000000000001'
client = None
ids = [actor, client]
checks = 0
owned_sessions = []

def check(condition, message):
    global checks
    assert condition, message
    checks += 1

staff = "set local role authenticated;select set_config('request.jwt.claims'," + quote(json.dumps({'sub': actor, 'role': 'authenticated'})) + ",true);"

def contended(first_query, second_query, second_expected):
    """Wait for an observed lock holder and then an observed lock waiter."""
    tag = 'lrv_clinical_import_' + uuid.uuid4().hex
    owned_sessions.extend([tag + '_holder', tag + '_waiter'])
    first = subprocess.Popen(COMMAND, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    first.stdin.write(f"set application_name='{tag}_holder';begin;{first_query}select pg_sleep(2);commit;")
    first.stdin.close()
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        if sql(f"select count(*) from pg_stat_activity where application_name='{tag}_holder' and wait_event='PgSleep';").stdout.strip() == '1':
            break
        time.sleep(.03)
    else:
        raise AssertionError('Did not observe transaction holding locks')
    second = subprocess.Popen(COMMAND, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    second.stdin.write(f"set application_name='{tag}_waiter';begin;{second_query}commit;")
    second.stdin.close()
    waiting = False
    while time.monotonic() < deadline:
        if sql(f"select count(*) from pg_stat_activity where application_name='{tag}_waiter' and wait_event_type='Lock';").stdout.strip() == '1':
            waiting = True
            break
        time.sleep(.03)
    check(waiting, 'Second operation actually waits on the first transaction lock')
    first.wait(timeout=10)
    second.wait(timeout=10)
    first_error = first.stderr.read()
    second_output = second.stdout.read()
    second_error = second.stderr.read()
    check(first.returncode == 0, first_error)
    check(second_expected(second.returncode, second_output, second_error), second_error or second_output)

# Isolated schema-only database, no API workers or source access.
import re
inspection=subprocess.run(['docker','inspect',CONTAINER],capture_output=True,text=True,check=True)
check(json.loads(inspection.stdout)[0]['Config']['Labels']['com.supabase.cli.project']==CONTAINER.removeprefix('supabase_db_'),'Verified local project')
database='lrv_clinical_race_'+uuid.uuid4().hex
assert re.fullmatch(r'lrv_clinical_race_[a-f0-9]{32}',database)
marker='owned-clinical-race-'+uuid.uuid4().hex
created=False
fixture=(Path(__file__).with_name('ezyvet_clinical_runs.test.sql')).read_text().split('-- FIXTURE_BEGIN:')[1].split('-- FIXTURE_END')[0]
fixture='\n'.join(fixture.splitlines()[1:])
service="set local role service_role;"
def scalar(query):return sql(query).stdout.strip().splitlines()[-1]
def run(query):return scalar('begin;'+service+query+'commit;')
def claim(run_id,mapping):return f"select claim_ezyvet_clinical_import('{run_id}','{actor}','clinical-test-site','consult','https://api.trial.ezyvet.com','{mapping}');"
def stage(run_id,lease,items,complete=False):return f"select stage_ezyvet_import_page('{run_id}','{actor}','{lease}',1,{str(complete).lower()},{quote(json.dumps(items))}::jsonb);"
try:
    dump=subprocess.run(['docker','exec',CONTAINER,'pg_dump','-U','postgres','--schema-only','--no-owner','--schema=public','--schema=auth','--schema=storage','--schema=extensions','postgres'],capture_output=True,check=True).stdout
    sql(f'create database "{database}";');created=True
    sql(f'comment on database "{database}" is {quote(marker)};')
    COMMAND=FOUNDATION_COMMAND.copy();COMMAND[COMMAND.index('-d')+1]=database
    sql('drop schema public;create schema extensions;create extension pgcrypto with schema extensions;create extension "uuid-ossp" with schema extensions;')
    dump=dump.replace(b'CREATE SCHEMA extensions;',b'CREATE SCHEMA IF NOT EXISTS extensions;')
    dump=b"\n".join(line for line in dump.splitlines() if not line.startswith(b'ALTER DEFAULT PRIVILEGES'))
    restored=subprocess.run(COMMAND,input=dump,capture_output=True)
    check(restored.returncode==0,restored.stderr.decode())
    saved=json.loads(scalar('begin;set local search_path=public,extensions;'+fixture+"select jsonb_build_object('fx',(select jsonb_object_agg(k,id) from fx),'data',(select jsonb_object_agg(k,v) from data));commit;"))
    fx=saved['fx'];items=saved['data']['items']
    contended(service+claim(fx['run'],fx['mapping']),service+claim(fx['other-run'],fx['mapping2']),lambda code,out,err:code!=0 and 'busy or cooling down' in err)
    check(scalar(f"select count(*) from ezyvet_import_runs where id='{fx['other-run']}';")=='0','Rejected competing claim leaves no run')
    # Holding exact scoped run serialization gate demonstrates altered UUID cannot rebind.
    gate=f"select pg_advisory_xact_lock(hashtextextended('clinical-run:{fx['run']}',0));"
    contended(gate,service+claim(fx['run'],fx['mapping2']),lambda code,out,err:code!=0 and 'identity cannot change' in err)
    lease=scalar(f"select lease_id from ezyvet_import_runs where id='{fx['run']}';")
    contended(service+stage(fx['run'],lease,items),service+stage(fx['run'],lease,items),lambda code,out,err:code==0)
    check(scalar(f"select count(*) from ezyvet_clinical_pages where run_id='{fx['run']}';")=='1','Concurrent exact lost-ACK retry has one receipt')
    check(scalar("select version from ezyvet_identity_heads where resource='consult' and external_id='101';")=='1','Dedup concurrent replay does not advance head')
    contended(f"select 1 from ezyvet_import_runs where id='{fx['run']}' for update;",service+stage(fx['run'],lease,items,True),lambda code,out,err:code!=0 and 'request changed' in err)
    # A fresh run reobserves the same snapshot while retaining the head lock.
    sql("update ezyvet_import_runs set retry_after=null,lease_until=null;")
    fresh=str(uuid.uuid4());r=json.loads(run(claim(fresh,fx['mapping'])))
    head_update="update ezyvet_identity_heads set version=version+1 where resource='consult' and external_id='101';"
    contended(service+stage(fresh,r['lease_id'],items,True),head_update,lambda code,out,err:code==0)
    check(scalar(f"select head_version from ezyvet_clinical_page_observations where run_id='{fresh}';")=='1','Unchanged reobservation captures revision under retained head lock')
    check(scalar("select version from ezyvet_identity_heads where resource='consult' and external_id='101';")=='2','Later head change remains later evidence')
    sql("update ezyvet_import_runs set retry_after=null,lease_until=null;")
    fresh=str(uuid.uuid4());r=json.loads(run(claim(fresh,fx['mapping'])))
    contended(head_update,service+stage(fresh,r['lease_id'],items,True),lambda code,out,err:code==0)
    check(scalar(f"select head_version from ezyvet_clinical_page_observations where run_id='{fresh}';")=='3','Head change before stage captured at current revision')
    sql("update ezyvet_import_runs set retry_after=null,lease_until=null;")
    run_a,run_b=str(uuid.uuid4()),str(uuid.uuid4());a=json.loads(run(claim(run_a,fx['mapping'])))
    sql(f"update ezyvet_import_runs set lease_until=null where id='{run_a}';")
    b=json.loads(run(claim(run_b,fx['mapping'])))
    # Owner creates two valid leases solely to adversarially exercise overlapping ordered head acquisition.
    sql(f"update ezyvet_import_runs set lease_until=now()+interval '90 seconds' where id='{run_a}';")
    overlap=[{'external_id':'201','payload':{'id':201,'animal_id':77}},{'external_id':'202','payload':{'id':202,'animal_id':77}}]
    contended(service+stage(run_a,a['lease_id'],overlap,True),service+stage(run_b,b['lease_id'],list(reversed(overlap)),True),lambda code,out,err:code==0)
    check(scalar("select count(*) from ezyvet_identity_heads where resource='consult' and external_id in ('201','202') and version=1;")=='2','Reversed overlapping pages retain one revision each without deadlock')
    # Owner-only simulated future membership transfer in scratch DB; current native API forbids transfers.
    # This adversarial fixture tests import revalidation even against privileged changes.
    client2=json.loads(scalar('begin;'+staff+"select to_jsonb(save_client(auth.uid(),null,null,'Other','Household','+13035550198','other-household@example.test','EMAIL',null,null));commit;"))['id']
    sql("update ezyvet_import_runs set retry_after=null,lease_until=null;")
    fresh=str(uuid.uuid4());r=json.loads(run(claim(fresh,fx['mapping'])))
    move=f"set local session_replication_role=replica;update pets set client_id='{client2}' where id='{fx['pet']}';set local session_replication_role=origin;"
    contended(move,service+stage(fresh,r['lease_id'],items,True),lambda code,out,err:code!=0 and 'mapping changed' in err)
    check(scalar(f"select next_page from ezyvet_import_runs where id='{fresh}';")=='1','Membership race commits no page/cursor')
    sql(f"begin;set local session_replication_role=replica;update pets set client_id='{fx['client']}' where id='{fx['pet']}';commit;")
    contended(service+stage(fresh,r['lease_id'],items,True),move,lambda code,out,err:code==0)
    check(scalar(f"select count(*) from ezyvet_clinical_pages where run_id='{fresh}';")=='1','Stage-first membership race preserves original scoped receipt')
    check('review_ready' in run(stage(fresh,str(uuid.uuid4()),items,True)),'Exact committed page recovers after current membership changed')
finally:
    if created:
        COMMAND=FOUNDATION_COMMAND.copy()
        check(scalar(f"select shobj_description(oid,'pg_database') from pg_database where datname='{database}';")==marker,'Exact owned database marker checked')
        sql(f"select pg_terminate_backend(pid) from pg_stat_activity where datname='{database}' and pid<>pg_backend_pid();")
        sql(f'drop database "{database}";')
        check(scalar(f"select count(*) from pg_database where datname='{database}';")=='0','Disposable database removed')
print(f'Clinical import concurrency: {checks} checks passed; no source requests or native chart writes.')
