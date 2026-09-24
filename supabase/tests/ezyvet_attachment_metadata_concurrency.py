"""Actual local PostgreSQL contention; synthetic fixtures only, never provider calls."""
import argparse
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

# Cleanup runs as the container superuser. `postgres` is not a superuser in this
# image, so terminating a connection it does not own - any supabase_admin or
# background session attached to the scratch database - fails with "Only roles
# with the SUPERUSER attribute may terminate processes of roles with the
# SUPERUSER attribute", and then the scratch database is never dropped.
# The checks themselves still run through `sql()` as `postgres`.
CLEANUP_COMMAND = FOUNDATION_COMMAND.copy()
CLEANUP_COMMAND[CLEANUP_COMMAND.index('-U') + 1] = 'supabase_admin'

def cleanup_sql(query):
    result = subprocess.run(CLEANUP_COMMAND, input=query, capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(result.stderr)
    return result


def sql(query, fail=True):
    result = subprocess.run(COMMAND, input=query, capture_output=True, text=True)
    if fail and result.returncode:
        raise AssertionError(result.stderr + result.stdout[-10000:])
    return result

def quote(value):
    return "'" + str(value).replace("'", "''") + "'"

actor = 'db690000-0000-4000-8000-000000000001'
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
    tag = 'lrv_attachment_' + uuid.uuid4().hex
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

# Copy only schemas into a positively identified disposable database.
import re
inspection=subprocess.run(['docker','inspect',CONTAINER],capture_output=True,text=True,check=True)
check(json.loads(inspection.stdout)[0]['Config']['Labels']['com.supabase.cli.project']==CONTAINER.removeprefix('supabase_db_'),'Verified local project')
database='lrv_attachment_race_'+uuid.uuid4().hex
marker='owned-attachment-race-'+uuid.uuid4().hex
created=False
fixture=Path(__file__).with_name('ezyvet_attachment_metadata.test.sql').read_text().split('-- FIXTURE_BEGIN')[1].split('-- FIXTURE_END')[0]
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
    for migration in sorted(Path(__file__).resolve().parents[1].joinpath('migrations').glob('*.sql')):
        sql('begin;'+migration.read_text()+'commit;')
    regressions=0
    targeted=['ezyvet_attachment_metadata.test.sql','ezyvet_import.test.sql','ezyvet_review_import.test.sql','reviewed_weight_import.test.sql','ezyvet_clinical_runs.test.sql','ezyvet_prescription_runs.test.sql','ezyvet_prescriptionitem_runs.test.sql','ezyvet_prescription_release_reference.test.sql']
    test_files=sorted(Path(__file__).parent.glob('*.test.sql')) if args.full_regression else [Path(__file__).with_name(name) for name in targeted]
    for test_file in test_files:
        filename=test_file.name
        result=sql(Path(__file__).with_name(filename).read_text());plans=re.findall(r'1\.\.([0-9]+)',result.stdout)
        check('not ok' not in result.stdout and bool(plans),filename+'\n'+result.stdout)
        regressions+=int(plans[-1])
    print(f'Attachment and prior SQL: {regressions} assertions passed.',flush=True)
    # Broad verification is opt-in; CI already has independent canonical lanes.
    if args.full_regression:
        prior=['python3',str(Path(__file__).with_name('ezyvet_prescription_review_concurrency.py')),'--source-database',database]
        if args.project_config:prior.extend(['--project-config',str(args.project_config.resolve())])
        subprocess.run(prior,check=True)
    saved=json.loads(scalar('begin;set local search_path=public,extensions;'+fixture+"select jsonb_build_object('fx',(select jsonb_object_agg(k,id) from fx),'data',(select jsonb_object_agg(k,v) from data));commit;"))
    fx=saved['fx'];page=saved['data']['page']
    contended(service+claim(fx['run']),service+claim(fx['other-run']),lambda code,out,err:code!=0 and 'busy or cooling down' in err)
    lease=scalar(f"select lease_id from ezyvet_import_runs where id='{fx['run']}';")
    contended(service+stage(fx['run'],lease,page),service+stage(fx['run'],lease,page),lambda code,out,err:code==0)
    check(scalar("select count(*) from ezyvet_attachment_page_observations;")=='2','Concurrent replay retains two observations once')
    check(scalar("select version from ezyvet_identity_heads where resource='attachment';")=='1','Concurrent replay does not advance head')
    def fresh():
        sql("update ezyvet_import_runs set retry_after=null,lease_until=null;")
        rid=str(uuid.uuid4());return rid,json.loads(run(claim(rid)))['lease_id']
    rid,lease=fresh()
    # A parent revision that wins the lock forces the waiting stage to reject.
    parent_change="update ezyvet_identity_heads set version=version+1 where resource='animal' and external_id='77';"
    contended(parent_change,service+stage(rid,lease,page),lambda code,out,err:code!=0 and 'SOURCE_ATTACHMENT_PARENT_STALE' in err)
    check(scalar(f"select next_page from ezyvet_import_runs where id='{rid}';")=='1','Stale parent leaves cursor unchanged')
    rid,lease=fresh()
    contended(service+stage(rid,lease,page),parent_change,lambda code,out,err:code==0)
    check(scalar(f"select count(*) from ezyvet_attachment_pages where run_id='{rid}';")=='1','Stage-first commits pinned parent receipt')
    rid,lease=fresh()
    sql(f"update ezyvet_import_runs set lease_until=clock_timestamp()+interval '1 second' where id='{rid}';")
    contended("select 1 from ezyvet_identity_heads where resource='animal' and external_id='77' for update;",service+stage(rid,lease,page),lambda code,out,err:code!=0 and 'lease expired' in err)
    check(scalar(f"select next_page from ezyvet_import_runs where id='{rid}';")=='1','Lease expiring during parent wait cannot commit')
    rid,lease=fresh()
    sql(f"update ezyvet_import_runs set lease_until=clock_timestamp()+interval '1 second' where id='{rid}';")
    contended("select 1 from ezyvet_identity_heads where resource='attachment' and external_id='701' for update;",service+stage(rid,lease,page),lambda code,out,err:code!=0 and 'lease expired' in err)
    check(scalar(f"select next_page from ezyvet_import_runs where id='{rid}';")=='1','Lease expiring during attachment wait cannot commit')
    rid,lease=fresh()
    altered=json.loads(json.dumps(page));altered['observations'][0]['raw_record_sha256']='f'*64
    contended(service+stage(rid,lease,page),service+stage(rid,lease,altered),lambda code,out,err:code!=0 and 'Committed attachment page changed' in err)
    # URL-only renewal changes observation digest but not stable source version.
    rid,lease=fresh();run(stage(rid,lease,altered))
    check(scalar("select version from ezyvet_identity_heads where resource='attachment';")=='1','Renewed raw digest preserves stable head')
    check(scalar("select count(distinct raw_record_sha256) from ezyvet_attachment_page_observations;")=='3','All raw observation digests retained')
finally:
    if created:
        COMMAND=FOUNDATION_COMMAND.copy()
        check(scalar(f"select shobj_description(oid,'pg_database') from pg_database where datname='{database}';")==marker,'Exact owned database marker checked')
        cleanup_sql(f"select pg_terminate_backend(pid) from pg_stat_activity where datname='{database}' and pid<>pg_backend_pid();")
        cleanup_sql(f'drop database "{database}";')
        check(scalar(f"select count(*) from pg_database where datname='{database}';")=='0','Disposable database removed')
print(f'Attachment metadata concurrency: {checks} checks passed; no provider or Storage operations.')
