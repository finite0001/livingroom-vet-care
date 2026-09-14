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

actor = 'db700000-0000-4000-8000-000000000001'
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
fixture=Path(__file__).with_name('ezyvet_attachment_originals.test.sql').read_text().split('-- FIXTURE_BEGIN')[1].split('-- FIXTURE_END')[0]
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
    targeted=['ezyvet_attachment_originals.test.sql','ezyvet_attachment_metadata.test.sql','ezyvet_import.test.sql','ezyvet_review_import.test.sql','reviewed_weight_import.test.sql','ezyvet_clinical_runs.test.sql','ezyvet_prescription_runs.test.sql','ezyvet_prescriptionitem_runs.test.sql','ezyvet_prescription_release_reference.test.sql']
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
    def prepare(rid):
        return f"select prepare_ezyvet_attachment_capture('{rid}','{fx['mapping']}','{fx['run']}',1,1,'{fx['attachment-snapshot']}',1,repeat('b',64));"
    def fresh():
        sql("update ezyvet_import_runs set retry_after=null,lease_until=null;")
        sql("update ezyvet_attachment_capture_requests set retry_after=null,lease_id=null,lease_until=null where status in('prepared','reserved');")
        rid=str(uuid.uuid4());sql('begin;'+staff+prepare(rid)+'commit;');return rid
    def claim_capture(rid):return f"select claim_ezyvet_attachment_capture('{rid}','{actor}');"
    def reserved(rid):
        claimed=json.loads(run(claim_capture(rid)))
        query=f"select reserve_ezyvet_attachment_original('{rid}','{actor}','{claimed['lease_id']}',repeat('e',64),'application/pdf',12,repeat('a',64),repeat('c',64));"
        return json.loads(run(query))
    def upload(ctx):return "insert into storage.objects(bucket_id,name,metadata) values('ezyvet-attachment-originals',"+quote(ctx['intent']['object_path'])+",'{\"size\":12,\"mimetype\":\"application/pdf\"}');"
    def discard(rid):return f"select begin_discard_ezyvet_attachment_capture('{rid}','{actor}');"
    def finish_discard(rid):return f"select complete_discard_ezyvet_attachment_capture('{rid}','{actor}');"
    def complete(ctx):return f"select complete_ezyvet_attachment_capture('{ctx['request']['id']}','{actor}','{ctx['lease_id']}','{ctx['intent']['id']}',repeat('e',64),'application/pdf',12);"
    def remove(ctx):return "set local storage.allow_delete_query='true';delete from storage.objects where bucket_id='ezyvet-attachment-originals' and name="+quote(ctx['intent']['object_path'])+";"
    def metadata_claim():return f"select claim_ezyvet_attachment_import('{uuid.uuid4()}','{actor}','attachment-test-site','https://api.trial.ezyvet.com','{fx['mapping']}');"
    # Preparation and scoped abandonment serialize on the same UUID in either order.
    for abandon_first in (True,False):
        rid=str(uuid.uuid4());prep=prepare(rid);abandon=prep.replace('prepare_ezyvet_attachment_capture','abandon_ezyvet_attachment_capture_preparation')
        contended(staff+(abandon if abandon_first else prep),staff+(prep if abandon_first else abandon),lambda code,out,err:code==0)
        check(scalar(f"select status from ezyvet_attachment_capture_requests where id='{rid}';")==('abandoned' if abandon_first else 'prepared'),'Preparation winner is immutable across late replay')
    rid=fresh()
    contended(service+claim_capture(rid),service+metadata_claim(),lambda code,out,err:code!=0 and 'busy or cooling down' in err)
    rid=fresh()
    contended(service+metadata_claim(),service+claim_capture(rid),lambda code,out,err:code!=0 and 'busy or cooling down' in err)
    check(scalar(f"select count(*) from ezyvet_attachment_capture_attempts where request_id='{rid}';")=='0','Metadata-first source gate creates no capture attempt')
    # Discard wins: pending upload waits and fails RLS after committed fence.
    rid=fresh();ctx=reserved(rid)
    contended(service+discard(rid),staff+upload(ctx),lambda code,out,err:code!=0 and 'row-level security' in err)
    check(scalar("select count(*) from storage.objects where name="+quote(ctx['intent']['object_path'])+';')=='0','Fenced late upload creates no object')
    run(finish_discard(rid))
    # Upload wins: its row-policy lock serializes fencing; removal must finish first.
    rid=fresh();ctx=reserved(rid)
    contended(staff+upload(ctx),service+discard(rid),lambda code,out,err:code==0)
    check(scalar("select count(*) from storage.objects where name="+quote(ctx['intent']['object_path'])+';')=='1','Upload-first object stays tracked for fenced deletion')
    failed=sql('begin;'+service+finish_discard(rid)+'commit;',fail=False)
    check(failed.returncode!=0 and 'removal unconfirmed' in failed.stderr,'Cannot abandon an extant pending object')
    sql('begin;'+remove(ctx)+'commit;');run(finish_discard(rid))
    failed=sql('begin;'+staff+upload(ctx)+'commit;',fail=False)
    check(failed.returncode!=0 and 'row-level security' in failed.stderr,'Abandoned request cannot receive delayed object')
    # Completion wins: immutable ready original cannot become discardable.
    rid=fresh();ctx=reserved(rid);sql('begin;'+staff+upload(ctx)+'commit;')
    contended(service+complete(ctx),service+discard(rid),lambda code,out,err:code!=0 and 'cannot be discarded' in err)
    check(scalar(f"select count(*) from ezyvet_attachment_original_captures where request_id='{rid}';")=='1','Exactly one ready capture remains')
    # Discard wins: completing worker observes invalid lease/state after waiting.
    rid=fresh();ctx=reserved(rid);sql('begin;'+staff+upload(ctx)+'commit;')
    contended(service+discard(rid),service+complete(ctx),lambda code,out,err:code!=0 and 'lease changed' in err)
    check(scalar(f"select count(*) from ezyvet_attachment_original_captures where request_id='{rid}';")=='0','Discard-first never creates a ready capture')
    sql('begin;'+remove(ctx)+'commit;');run(finish_discard(rid))
    # Duplicate completion recovers original immutable receipt despite old lease.
    rid=fresh();ctx=reserved(rid);sql('begin;'+staff+upload(ctx)+'commit;')
    contended(service+complete(ctx),service+complete(ctx),lambda code,out,err:code==0)
    check(scalar(f"select count(*) from ezyvet_attachment_original_captures where request_id='{rid}';")=='1','Lost completion reply has one immutable receipt')
    # Source lock waits cannot extend the worker lease.
    for resource,external_id in [('animal','77'),('attachment','701')]:
        rid=fresh();claimed=json.loads(run(claim_capture(rid)))
        sql(f"update ezyvet_attachment_capture_requests set lease_until=clock_timestamp()+interval '3 seconds' where id='{rid}';")
        reserve_query=f"select reserve_ezyvet_attachment_original('{rid}','{actor}','{claimed['lease_id']}',repeat('e',64),'application/pdf',12,repeat('a',64),repeat('c',64));"
        contended(f"select 1 from ezyvet_identity_heads where resource='{resource}' and external_id='{external_id}' for update;",service+reserve_query,lambda code,out,err:code!=0 and 'lease changed or expired' in err, hold_seconds=4)
        check(scalar(f"select count(*) from ezyvet_attachment_original_intents where request_id='{rid}';")=='0','Expired waiting lease cannot reserve an object')
    rid=fresh();ctx=reserved(rid);sql('begin;'+staff+upload(ctx)+'commit;')
    sql(f"update ezyvet_attachment_capture_requests set lease_until=clock_timestamp()+interval '3 seconds' where id='{rid}';")
    contended("select 1 from storage.objects where name="+quote(ctx['intent']['object_path'])+" for update;",service+complete(ctx),lambda code,out,err:code!=0 and 'lease changed or expired' in err, hold_seconds=4)
    check(scalar(f"select count(*) from ezyvet_attachment_original_captures where request_id='{rid}';")=='0','Lease expiry after Storage wait cannot complete')
    # Parent revision and final capture serialize in both orders.
    parent_change="update ezyvet_identity_heads set version=version+1 where resource='animal' and external_id='77';"
    rid=fresh();ctx=reserved(rid);sql('begin;'+staff+upload(ctx)+'commit;')
    contended(parent_change,service+complete(ctx),lambda code,out,err:code!=0 and 'SOURCE_ATTACHMENT_PARENT_STALE' in err)
    check(scalar(f"select count(*) from ezyvet_attachment_original_captures where request_id='{rid}';")=='0','Changed parent cannot finalize new original')
    sql("update ezyvet_identity_heads set version=version-1 where resource='animal' and external_id='77';")
    rid=fresh();ctx=reserved(rid);sql('begin;'+staff+upload(ctx)+'commit;')
    contended(service+complete(ctx),parent_change,lambda code,out,err:code==0)
    recovered=json.loads(run(f"select get_ezyvet_attachment_capture_context('{rid}','{actor}');"))
    check(recovered['request']['status']=='ready' and not recovered['request']['source_current'],'Capture-first preserves historical ready receipt')
    sql("update ezyvet_identity_heads set version=version-1 where resource='animal' and external_id='77';")
    # An old failure must not release a newer lease; cooldown blocks metadata traffic.
    rid=fresh();old=json.loads(run(claim_capture(rid)));sql(f"update ezyvet_attachment_capture_requests set lease_until=clock_timestamp()-interval '3 seconds' where id='{rid}';")
    new=json.loads(run(claim_capture(rid)))
    failure=f"select fail_ezyvet_attachment_capture('{rid}','{actor}','{old['lease_id']}','UPSTREAM_UNAVAILABLE',2,false);"
    failed=sql('begin;'+service+failure+'commit;',fail=False)
    check(failed.returncode!=0 and 'superseded' in failed.stderr,'Old worker cannot clear new lease')
    run(failure.replace(old['lease_id'],new['lease_id']))
    failed=sql('begin;'+service+metadata_claim()+'commit;',fail=False)
    check(failed.returncode!=0 and 'cooling down' in failed.stderr,'Published capture cooldown gates metadata claims')

finally:
    if created:
        cleanup_owned_database(FOUNDATION_COMMAND, database, marker, check=check)
print(f'Attachment original concurrency: {checks} checks passed; no provider or physical Storage operations.')
