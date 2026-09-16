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

actor = 'ed900000-0000-4000-8000-000000000001'
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
    tag = 'lrv_resolution_' + uuid.uuid4().hex
    owned_sessions.extend([tag + '_holder', tag + '_waiter'])
    first = subprocess.Popen(COMMAND, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    first.stdin.write(f"set application_name='{tag}_holder';begin;{first_query}select pg_sleep(2);commit;")
    first.stdin.close()
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        if sql(f"select count(*) from pg_stat_activity where application_name='{tag}_holder' and wait_event='PgSleep';").stdout.strip() == '1':
            break
        if first.poll() is not None:
            raise AssertionError('Holder exited before acquiring locks: ' + first.stderr.read())
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

# Only a uniquely marked schema-only scratch database is mutated.
import re
inspection=subprocess.run(['docker','inspect',CONTAINER],capture_output=True,text=True,check=True)
check(json.loads(inspection.stdout)[0]['Config']['Labels']['com.supabase.cli.project']==CONTAINER.removeprefix('supabase_db_'),'Verified local project')
database='lrv_resolution_race_'+uuid.uuid4().hex
marker='owned-resolution-race-'+uuid.uuid4().hex
created=False
fixture=Path(__file__).with_name('ezyvet_migration_resolutions.test.sql').read_text().split('-- FIXTURE_BEGIN')[1].split('-- FIXTURE_END')[0]
def scalar(query):return sql(query).stdout.strip().splitlines()[-1]
def gate(key):return f"select pg_advisory_xact_lock(hashtextextended({quote(key)},0));"
try:
    dump=subprocess.run(['docker','exec',CONTAINER,'pg_dump','-U','postgres','--schema-only','--no-owner','--schema=public','--schema=auth','--schema=storage','--schema=extensions','postgres'],capture_output=True,check=True).stdout
    sql(f'create database "{database}";');created=True
    sql(f"comment on database \"{database}\" is {quote(marker)};")
    COMMAND=FOUNDATION_COMMAND.copy();COMMAND[COMMAND.index('-d')+1]=database
    sql('drop schema public;create schema extensions;create extension pgcrypto with schema extensions;create extension "uuid-ossp" with schema extensions;')
    dump=dump.replace(b'CREATE SCHEMA extensions;',b'CREATE SCHEMA IF NOT EXISTS extensions;')
    dump=b"\n".join(line for line in dump.splitlines() if not line.startswith(b'ALTER DEFAULT PRIVILEGES'))
    restored=subprocess.run(COMMAND,input=dump,capture_output=True)
    check(restored.returncode==0,restored.stderr.decode())
    if scalar("select to_regclass('public.ezyvet_migration_resolutions') is null;")=='t':
        sql(Path(__file__).resolve().parents[1].joinpath('migrations','20260916043949_ezyvet_migration_resolutions.sql').read_text())
    taps=sql(Path(__file__).with_name('ezyvet_migration_resolutions.test.sql').read_text())
    plans=re.findall(r'1\.\.([0-9]+)',taps.stdout)
    check('not ok' not in taps.stdout and bool(plans),taps.stdout)
    print(f'Operational resolution SQL: {plans[-1]} assertions passed.',flush=True)
    saved=json.loads(scalar('begin;set local search_path=public,extensions;'+fixture+"select jsonb_build_object('fx',(select jsonb_object_agg(k,id) from fx),'data',(select jsonb_object_agg(k,v) from data));commit;"))
    fx=saved['fx'];target=saved['data']['target'];context=saved['data']['context']
    def save(request_id,reason='Concurrent exclusion',previous=None,action='exclude',ctx=None):
        return staff+f"select save_ezyvet_migration_resolution('{request_id}','{fx['scope']}',{quote(json.dumps(target))}::jsonb,{quote(action)},{quote(reason)},{quote((ctx or context)['context_hash'])},{quote(previous)+'::uuid' if previous else 'null'});"
    def receipt(request_id):return json.loads(scalar('begin;'+staff+f"select read_ezyvet_migration_resolution('{request_id}');commit;"))
    first=str(uuid.uuid4())
    contended(save(first),save(first),lambda code,out,err:code==0)
    original=receipt(first)
    check(scalar('select count(*) from ezyvet_migration_resolutions;')=='1','Exact concurrent retry creates one receipt')
    contended(gate('ezyvet-migration-resolution:'+first),save(first,'Changed request'),lambda code,out,err:code!=0 and 'identity cannot change' in err)
    second,loser=str(uuid.uuid4()),str(uuid.uuid4())
    contended(save(second,'Reopen',first,'reopen'),save(loser,'Competing reopen',first,'reopen'),lambda code,out,err:code!=0 and 'Exact preceding resolution required' in err)
    check(receipt(loser) is None,'Competing predecessor appends nothing')
    # Source changes while decision waits: post-wait snapshot rejects old review.
    request=str(uuid.uuid4())
    change=gate('ezyvet-migration-scope-binding:'+fx['scope'])+"update ezyvet_identity_heads set version=version+1 where source_site_uid='resolution-site';"
    contended(change,save(request,'Stale review',second),lambda code,out,err:code!=0 and 'Operational evidence changed' in err)
    check(receipt(request) is None,'Stale decision writes no receipt')
    check(receipt(first)==original,'Exact recovery survives source drift')
    contended(gate('ezyvet-migration-resolution:'+first),save(first),lambda code,out,err:code==0)
    check(receipt(first)==original,'Exact retry after source drift returns identical receipt')
    # Revocation commits before lock release; save must recheck after actual wait.
    revoke=gate('ezyvet-migration-resolution:'+request)+f"update profiles set is_active=false where id='{actor}';"
    contended(revoke,save(request,'Revoked admin',second),lambda code,out,err:code!=0 and 'Active administrator required' in err)
    check(scalar(f"select count(*) from ezyvet_migration_resolutions where id='{request}';")=='0','Revoked administrator cannot append')
    sql(f"update profiles set is_active=true where id='{actor}';")
    check(scalar('select count(*) from ezyvet_migration_resolutions;')=='2','All failed contenders leave only intended chain')
finally:
    if created:
        COMMAND=FOUNDATION_COMMAND.copy()
        check(scalar(f"select shobj_description(oid,'pg_database') from pg_database where datname='{database}';")==marker,'Exact owned database marker checked')
        sql(f"select pg_terminate_backend(pid) from pg_stat_activity where datname='{database}' and pid<>pg_backend_pid();")
        sql(f'drop database "{database}";')
        check(scalar(f"select count(*) from pg_database where datname='{database}';")=='0','Disposable database removed')
print(f'Operational resolution concurrency: {checks} checks passed; no provider calls.')
