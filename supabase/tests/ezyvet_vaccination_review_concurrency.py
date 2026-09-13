"""Actual local PostgreSQL contention; synthetic fixtures only, never provider calls."""
import argparse
from pathlib import Path
import json
import subprocess
import time
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--project-config', type=Path, help='Derive the database container from a Supabase TOML project_id')
parser.add_argument('--overlay-migration',type=Path,action='append',default=[])
parser.add_argument('--extra-sql-test',type=Path,action='append',default=[])
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

actor = 'db520000-0000-4000-8000-000000000001'
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
    tag = 'lrv_vaccination_review_' + uuid.uuid4().hex
    owned_sessions.extend([tag + '_holder', tag + '_waiter'])
    first = subprocess.Popen(COMMAND, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    first.stdin.write(f"set application_name='{tag}_holder';begin;{first_query}\n")
    first.stdin.flush()
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        if sql(f"select count(*) from pg_stat_activity where application_name='{tag}_holder' and state='idle in transaction';").stdout.strip() == '1':
            break
        time.sleep(.03)
    else:
        first.stdin.close()
        first.wait(timeout=10)
        raise AssertionError('Did not observe transaction holding locks: '+first.stderr.read())
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
    first.stdin.write('commit;\n')
    first.stdin.close()
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
database='lrv_vaccination_review_'+uuid.uuid4().hex
assert re.fullmatch(r'lrv_vaccination_review_[a-f0-9]{32}',database)
marker='owned-vaccination-review-'+uuid.uuid4().hex
created=False
fixture=Path(__file__).with_name('ezyvet_vaccination_review.test.sql').read_text().split('-- FIXTURE_BEGIN:')[1].split('-- FIXTURE_END')[0]
fixture='\n'.join(fixture.splitlines()[1:])
def scalar(query):return sql(query).stdout.strip().splitlines()[-1]
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
    if scalar("select to_regclass('public.ezyvet_vaccination_runs') is null;") == 't':
        sql(Path(__file__).resolve().parents[1].joinpath('migrations/20260913520000_consult_scoped_vaccination_import.sql').read_text())
    if scalar("select to_regclass('public.ezyvet_imported_vaccinations') is null;")=='t':
        sql(Path(__file__).resolve().parents[1].joinpath('migrations/20260913530000_reviewed_imported_vaccinations.sql').read_text())
    taps=sql(Path(__file__).with_name('ezyvet_vaccination_review.test.sql').read_text())
    check('not ok' not in taps.stdout and re.search(r'1\.\.[0-9]+',taps.stdout) is not None,taps.stdout)
    print('Vaccination review SQL: '+re.findall(r'1\.\.([0-9]+)',taps.stdout)[-1]+' assertions passed.',flush=True)
    regression_count=0
    for filename in ['ezyvet_vaccination_runs.test.sql','ezyvet_reviewed_history.test.sql','release_imported_history.test.sql']:
        result=sql(Path(__file__).with_name(filename).read_text())
        plans=re.findall(r'1\.\.([0-9]+)',result.stdout)
        check('not ok' not in result.stdout and bool(plans),filename+'\n'+result.stdout)
        regression_count+=int(plans[-1])
    print(f'Prior intake/review/release SQL: {regression_count} assertions passed.',flush=True)
    for migration in args.overlay_migration:
        sql(migration.read_text())
    for test in args.extra_sql_test:
        extra=sql(test.read_text())
        plans=re.findall(r'1\.\.([0-9]+)',extra.stdout)
        check('not ok' not in extra.stdout and bool(plans),test.name+'\n'+extra.stdout)
        print(f'{test.name}: {plans[-1]} assertions passed.',flush=True)
    saved=json.loads(scalar('begin;set local search_path=public,extensions;'+fixture+"select jsonb_build_object('fx',(select jsonb_object_agg(k,id) from fx),'data',(select jsonb_object_agg(k,v) from data));commit;"))
    fx=saved['fx'];payload=saved['data']['payload'];pet=fx['pet']
    def prepare(id,p=payload):return f"select prepare_ezyvet_vaccination_review('{id}','{pet}',{quote(json.dumps(p))}::jsonb);"
    def approve(id):
        h=scalar(f"select request_hash from ezyvet_vaccination_review_requests where id='{id}';")
        return f"select approve_ezyvet_vaccination_review('{id}','{pet}','{h}',true);"
    def fresh():
        id=str(uuid.uuid4());sql('begin;'+staff+prepare(id)+'commit;');return id
    # Two UUIDs for identical source must serialize into one immutable chart version.
    a,b=fresh(),fresh()
    contended(staff+approve(a),staff+approve(b),lambda c,o,e:c==0)
    check(scalar('select count(*) from ezyvet_imported_vaccinations;')=='1','Identical concurrent reviews deduplicated')
    original=json.loads(scalar(f"select to_jsonb(v) from ezyvet_imported_vaccinations v where id='{a}';"))
    correction=payload|{'status':'administered','replaces_id':a,'expected_predecessor_hash':original['version_hash'],'reason':'Reviewed explicit correction'}
    c,d=str(uuid.uuid4()),str(uuid.uuid4())
    sql('begin;'+staff+prepare(c,correction)+prepare(d,correction|{'status':'not_administered'})+'commit;')
    contended(staff+approve(c),staff+approve(d),lambda c,o,e:c!=0 and 'predecessor' in e)
    check(scalar('select count(*) from ezyvet_imported_vaccinations;')=='2','Competing corrections create one successor')
    latest=json.loads(scalar(f"select to_jsonb(v) from ezyvet_imported_vaccinations v where id='{c}';"))
    current=correction|{'replaces_id':c,'expected_predecessor_hash':latest['version_hash']}
    # Real observed source-head updates race both prepare and approval.
    for resource,external in [('vaccination','501'),('consult','101')]:
        change=f"update ezyvet_identity_heads set version=version+2 where resource='{resource}' and external_id='{external}';"
        restore=f"update ezyvet_identity_heads set version=version-2 where resource='{resource}' and external_id='{external}';"
        pending=str(uuid.uuid4());sql('begin;'+staff+prepare(pending,current)+'commit;')
        contended(change,staff+approve(pending),lambda c,o,e:c!=0 and ('scoped' in e or 'STALE' in e))
        sql(restore)
        pending2=str(uuid.uuid4());sql('begin;'+staff+prepare(pending2,current)+'commit;')
        contended(staff+approve(pending2),change,lambda c,o,e:c==0)
        check(scalar(f"select status from ezyvet_vaccination_review_requests where id='{pending2}';")=='approved','Review-first source race commits reviewed evidence')
        sql(restore)
        denied=str(uuid.uuid4())
        contended(change,staff+prepare(denied,current),lambda c,o,e:c!=0 and ('scoped' in e or 'STALE' in e))
        check(scalar(f"select count(*) from ezyvet_vaccination_review_requests where id='{denied}';")=='0','Source-first prepare leaves no intent')
        sql(restore)
        contended(staff+prepare(str(uuid.uuid4()),current),change,lambda c,o,e:c==0)
        sql(restore)
    # Patient membership mutations conflict with compatible review SHARE locks in either order.
    move=f"set local session_replication_role=replica;update pets set client_id=gen_random_uuid() where id='{pet}';set local session_replication_role=origin;"
    restore_member=f"begin;set local session_replication_role=replica;update pets set client_id='{fx['client']}' where id='{pet}';commit;"
    member_id=str(uuid.uuid4());sql('begin;'+staff+prepare(member_id,current)+'commit;')
    contended(move,staff+approve(member_id),lambda c,o,e:c!=0 and 'Patient changed' in e)
    sql(restore_member)
    contended(staff+approve(member_id),move,lambda c,o,e:c==0)
    check(scalar(f"select status from ezyvet_vaccination_review_requests where id='{member_id}';")=='approved','Review-first membership change preserves frozen household')
    sql(restore_member)
    # A product revision update cannot pass between reviewed capture and approval.
    product_payload=current|{'product_id':fx['product'],'product_version':1}
    product_id=str(uuid.uuid4());sql('begin;'+staff+prepare(product_id,product_payload)+'commit;')
    product_change=staff+f"select save_catalog_product('{fx['product']}',1,'Test vaccine','vaccine','','dose',1000,true);"
    contended(product_change,staff+approve(product_id),lambda c,o,e:c!=0 and 'Catalog product changed' in e)
    sql(f"begin;set local session_replication_role=replica;update catalog_products set version=1 where id='{fx['product']}';commit;")
    contended(staff+approve(product_id),product_change,lambda c,o,e:c==0)
    check(scalar(f"select product->>'version' from ezyvet_imported_vaccinations where id='{product_id}';")=='1','Review-first catalog change preserves reviewed product version')
    # Revoked actor checked before terminal recovery.
    sql(f"delete from user_roles where user_id='{actor}' and role='DVM';")
    denied=sql('begin;'+staff+f"select recover_ezyvet_vaccination_review('{a}','{pet}');commit;",False)
    check(denied.returncode!=0 and 'veterinarian' in denied.stderr,'Current role required for terminal recovery')
finally:
    if created:
        COMMAND=FOUNDATION_COMMAND.copy()
        check(scalar(f"select shobj_description(oid,'pg_database') from pg_database where datname='{database}';")==marker,'Exact owned database marker checked')
        sql(f"select pg_terminate_backend(pid) from pg_stat_activity where datname='{database}' and pid<>pg_backend_pid();")
        sql(f'drop database "{database}";')
        check(scalar(f"select count(*) from pg_database where datname='{database}';")=='0','Disposable database removed')
print(f'Vaccination review concurrency: {checks} checks passed; owned scratch database removed.')
