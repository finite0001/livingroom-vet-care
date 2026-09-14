"""Actual local PostgreSQL contention; synthetic fixtures only, never provider calls."""
import argparse
from owned_database_cleanup import cleanup_owned_database
from pathlib import Path
import json
import subprocess
import time
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--full-regression',action='store_true',help='Also run all SQL files and canonical prescription/release contention')
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
        raise AssertionError(result.stderr + result.stdout[-10000:])
    return result

def quote(value):
    return "'" + str(value).replace("'", "''") + "'"

actor = 'db710000-0000-4000-8000-000000000001'
client = None
ids = [actor, client]
checks = 0
owned_sessions = []

def check(condition, message):
    global checks
    assert condition, message
    checks += 1

staff = "set local role authenticated;select set_config('request.jwt.claims'," + quote(json.dumps({'sub': actor, 'role': 'authenticated'})) + ",true);"

def contended(first_query, second_query, second_expected, hold_seconds=2):
    """Wait for an observed lock holder and then an observed lock waiter."""
    tag = 'lrv_attachment_' + uuid.uuid4().hex
    owned_sessions.extend([tag + '_holder', tag + '_waiter'])
    first = subprocess.Popen(COMMAND, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    first.stdin.write(f"set application_name='{tag}_holder';begin;{first_query}\n")
    first.stdin.flush()
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        if sql(f"select count(*) from pg_stat_activity where application_name='{tag}_holder' and state='idle in transaction';").stdout.strip() == '1':
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
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        if sql(f"select count(*) from pg_stat_activity where application_name='{tag}_waiter' and wait_event_type='Lock';").stdout.strip() == '1':
            waiting = True
            break
        time.sleep(.03)
    if waiting and hold_seconds>2:time.sleep(hold_seconds)
    first.stdin.write('commit;\n');first.stdin.close()
    check(waiting, 'Second operation actually waits on the first transaction lock')
    first.wait(timeout=10)
    second.wait(timeout=10)
    first_error = first.stderr.read()
    second_output = second.stdout.read()
    second_error = second.stderr.read()
    check(first.returncode == 0, first_error)
    check(second_expected(second.returncode, second_output, second_error), second_error or second_output)

# Copy only schemas into a positively identified disposable database.
import re
inspection=subprocess.run(['docker','inspect',CONTAINER],capture_output=True,text=True,check=True)
check(json.loads(inspection.stdout)[0]['Config']['Labels']['com.supabase.cli.project']==CONTAINER.removeprefix('supabase_db_'),'Verified local project')
database='lrv_attachment_race_'+uuid.uuid4().hex
marker='owned-attachment-race-'+uuid.uuid4().hex
created=False
fixture=Path(__file__).with_name('ezyvet_api_original_release.test.sql').read_text().split('-- FIXTURE_BEGIN')[1].split('-- FIXTURE_END')[0]
service="set local role service_role;"
def scalar(query):return sql(query).stdout.strip().splitlines()[-1]
def run(query):return scalar('begin;'+service+query+'commit;')
def claim(run_id):return f"select claim_ezyvet_attachment_import('{run_id}','{actor}','attachment-test-site','https://api.trial.ezyvet.com','{fx['mapping']}');"
def stage(run_id,lease,page):return f"select stage_ezyvet_attachment_page('{run_id}','{actor}','{lease}',{quote(json.dumps(page))}::jsonb);"
try:
    versions=set(sql('select version from supabase_migrations.schema_migrations;').stdout.splitlines())
    dump=subprocess.run(['docker','exec',CONTAINER,'pg_dump','-U','postgres','--schema-only','--no-owner','--schema=public','--schema=auth','--schema=storage','--schema=extensions','postgres'],capture_output=True,check=True).stdout
    sql(f'create database "{database}";');created=True
    sql(f"comment on database {database} is {quote(marker)};")
    COMMAND=FOUNDATION_COMMAND.copy();COMMAND[COMMAND.index('-d')+1]=database
    sql('drop schema public;create schema extensions;create extension pgcrypto with schema extensions;create extension "uuid-ossp" with schema extensions;')
    dump=dump.replace(b'CREATE SCHEMA extensions;',b'CREATE SCHEMA IF NOT EXISTS extensions;')
    dump=b"\n".join(line for line in dump.splitlines() if not line.startswith(b'ALTER DEFAULT PRIVILEGES'))
    restored=subprocess.run(COMMAND,input=b"BEGIN;\n"+dump+b"\nCOMMIT;",capture_output=True)
    check(restored.returncode==0,restored.stderr.decode())
    # Foundation ledger can lag its schema. Rebuild public only in this owned empty copy.
    sql('drop schema public cascade;create schema public;grant usage on schema public to anon,authenticated,service_role;create publication supabase_realtime;')
    migrations=sorted(Path(__file__).resolve().parents[1].joinpath('migrations').glob('*.sql'))
    # Preserve transactions and fresh-session state while avoiding89 Docker startups.
    sql('\n'.join('begin;\n'+migration.read_text()+'\ncommit;\nDISCARD ALL;' for migration in migrations))
    print(f'Replayed {len(migrations)} canonical migrations in owned database.',flush=True)
    regressions=0
    targeted=['ezyvet_api_original_release.test.sql','ezyvet_attachment_original_reviews.test.sql','ezyvet_prescription_release_reference.test.sql','release_source_byte_binding.test.sql']
    test_files=sorted(Path(__file__).parent.glob('*.test.sql')) if args.full_regression else [Path(__file__).with_name(name) for name in targeted]
    for test_file in test_files:
        result=sql(test_file.read_text());plans=re.findall(r'1\.\.([0-9]+)',result.stdout)
        check('not ok' not in result.stdout and bool(plans),test_file.name+'\n'+result.stdout)
        regressions+=int(plans[-1])
    print(f'API original release SQL: {regressions} assertions in {len(test_files)} files passed.',flush=True)
    sql("insert into record_release_policy(id,enabled,accepted_schema_version,accepted_at,accepted_by,acceptance_reference) values(true,true,9,now(),'Synthetic DVM','Local contention only');")
    def as_actor(who):return "set local role authenticated;select set_config('request.jwt.claims',"+quote(json.dumps({'sub':who,'role':'authenticated'}))+",true);"
    def scenario():
        local=fixture
        actors=[str(uuid.uuid4()) for _ in range(4)]
        for i,who in enumerate(actors,1):local=local.replace(f'db710000-0000-4000-8000-{i:012d}',who)
        local=local.replace('attachment-test-site','release-race-'+uuid.uuid4().hex)
        local=local.replace('attachment-admin@example.test',actors[0]+'@example.test').replace('attachment-other@example.test',actors[1]+'@example.test').replace('original-dvm@example.test',actors[2]+'@example.test').replace('original-staff@example.test',actors[3]+'@example.test')
        saved=json.loads(scalar('begin;set local search_path=public,extensions;'+local+"select jsonb_build_object('fx',(select jsonb_object_agg(k,id) from fx),'data',(select jsonb_object_agg(k,v) from data));commit;"))
        f=saved['fx'];d=saved['data'];v=d['approved']['record'];rid=str(uuid.uuid4())
        ack=f"select acknowledge_ezyvet_attachment_original('{uuid.uuid4()}','{f['pet']}','{v['id']}','{v['record_hash']}','{v['capture_hash']}',true);"
        sql('begin;'+as_actor(actors[2])+ack+'commit;')
        preview=f"select preview_record_release_v9('{f['pet']}','{f['client']}','EMAIL','attachment@example.test',{quote(json.dumps(d['selection']))}::jsonb);"
        reviewed=json.loads(scalar('begin;'+as_actor(actors[0])+preview+'commit;'))
        confirm=f"select confirm_record_release('{rid}','{f['pet']}','{f['client']}','EMAIL','attachment@example.test',{quote(json.dumps(d['selection']))}::jsonb,{quote(json.dumps(reviewed['snapshot']))}::jsonb,'{reviewed['source_hash']}',true);"
        withdraw=f"select withdraw_ezyvet_attachment_original('{uuid.uuid4()}','{f['pet']}','{v['id']}','{v['record_hash']}','Synthetic withdrawal');"
        c=d['ready2']['request']['capture']
        replace=f"select approve_ezyvet_attachment_original('{uuid.uuid4()}','{f['pet']}','{c['id']}','{c['capture_hash']}',1,'{v['id']}','Synthetic replacement',true);"
        return actors,f,d,v,rid,confirm,withdraw,replace
    ok=lambda c,o,e:c==0
    stale=lambda c,o,e:c!=0 and ('acknowledged same-patient' in e or 'sources or recipient changed' in e or 'ATTACHMENT_ORIGINAL_UNAVAILABLE' in e)
    for kind in ['withdraw','replace']:
        for writer_first in [True,False]:
            actors,f,d,v,rid,confirm,withdraw,replace=scenario();who=as_actor(actors[0]);mutation=withdraw if kind=='withdraw' else replace
            if writer_first:
                contended(who+mutation,who+confirm,stale)
                check(scalar(f"select count(*) from record_releases where id='{rid}';")=='0',kind+' wins: stale confirmation creates no release')
            else:
                contended(who+confirm,who+mutation,ok)
                check(scalar(f"select release_read_internal('{rid}')->>'eligible';")=='false',kind+' after confirmation invalidates package')
    for ack_first in [True,False]:
        actors,f,d,v,rid,confirm,withdraw,replace=scenario()
        sql(f"insert into user_roles(user_id,role) values('{actors[1]}','DVM');")
        ack=as_actor(actors[1])+f"select acknowledge_ezyvet_attachment_original('{uuid.uuid4()}','{f['pet']}','{v['id']}','{v['record_hash']}','{v['capture_hash']}',true);"
        contended(ack if ack_first else as_actor(actors[0])+confirm,as_actor(actors[0])+confirm if ack_first else ack,ok)
        check(scalar(f"select release_read_internal('{rid}')->>'eligible';")=='true','Additional acknowledgment never invalidates frozen earliest evidence')
    for delete_first in [True,False]:
        actors,f,d,v,rid,confirm,withdraw,replace=scenario()
        deletion=f"set local storage.allow_delete_query='true';delete from storage.objects where id=(select storage_object_id from ezyvet_attachment_original_captures where id='{v['capture_id']}');"
        contended(deletion if delete_first else as_actor(actors[0])+confirm,as_actor(actors[0])+confirm if delete_first else deletion,stale if delete_first else ok)
        if not delete_first:check(scalar(f"select release_read_internal('{rid}')->>'eligible';")=='false','Storage loss after confirmation returns ineligible historical package')
    # No patient-transfer product workflow is introduced. Disable only the local
    # fixture version guard, retaining audit/release triggers and actual row locks.
    sql('alter table pets disable trigger pets_version;')
    try:
        for change_kind in ['household','mapping']:
            for mutation_first in [True,False]:
                actors,f,d,v,rid,confirm,withdraw,replace=scenario()
                if change_kind=='household':
                    other=json.loads(scalar('begin;'+as_actor(actors[0])+"select to_jsonb(save_client(auth.uid(),null,null,'Other','Household','+13035550998','other@example.test','EMAIL',null,null));commit;"))['id']
                    mutation=f"select set_config('request.jwt.claims',{quote(json.dumps({'sub':actors[0],'role':'authenticated'}))},true);update pets set client_id='{other}' where id='{f['pet']}';"
                else:mutation=f"update ezyvet_record_links set source_site_uid=source_site_uid||'-changed' where id='{f['mapping']}';"
                expected=lambda c,o,e:c!=0 and ('acknowledged same-patient' in e or 'does not belong to this household' in e)
                contended(mutation if mutation_first else as_actor(actors[0])+confirm,as_actor(actors[0])+confirm if mutation_first else mutation,expected if mutation_first else ok)
                if mutation_first:check(scalar(f"select count(*) from record_releases where id='{rid}';")=='0',change_kind+' wins: no stale release')
                else:check(scalar(f"select release_read_internal('{rid}')->>'eligible';")=='false',change_kind+' after confirmation invalidates release')
    finally:sql('alter table pets enable trigger pets_version;')
    # All waits were observed in pg_stat_activity, not inferred from elapsed time.
    print(f'API original release concurrency: {checks} checks passed before cleanup.',flush=True)
finally:
    if created:cleanup_owned_database(FOUNDATION_COMMAND,database,marker,check=check)
print(f'API original release concurrency: {checks} checks passed; owned database removed.')
