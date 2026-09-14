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
fixture=Path(__file__).with_name('ezyvet_attachment_original_reviews.test.sql').read_text().split('-- FIXTURE_BEGIN')[1].split('-- FIXTURE_END')[0]
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
    targeted=['ezyvet_attachment_original_reviews.test.sql','ezyvet_attachment_originals.test.sql','ezyvet_attachment_metadata.test.sql','ezyvet_import.test.sql','ezyvet_review_import.test.sql','reviewed_weight_import.test.sql','ezyvet_clinical_runs.test.sql','ezyvet_prescription_runs.test.sql','ezyvet_prescriptionitem_runs.test.sql','ezyvet_prescription_release_reference.test.sql']
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
    fx=saved['fx'];data=saved['data']
    dvm="set local role authenticated;select set_config('request.jwt.claims',"+quote(json.dumps({'sub':'db710000-0000-4000-8000-000000000003','role':'authenticated'}))+",true);"
    def browser(query,role=staff):return json.loads(scalar('begin;'+role+query+'commit;'))
    def latest():
        return json.loads(scalar("select coalesce(to_jsonb(r),'null') from (select public.ezyvet_attachment_review_latest('https://api.trial.ezyvet.com','attachment-test-site','77','701') r) x;"))
    def fresh_capture():
        rid=str(uuid.uuid4())
        browser(f"select prepare_ezyvet_attachment_capture('{rid}','{fx['mapping']}','{fx['run']}',1,1,'{fx['attachment-snapshot']}',1,repeat('b',64));")
        ctx=json.loads(run(f"select claim_ezyvet_attachment_capture('{rid}','{actor}');"))
        ctx=json.loads(run(f"select reserve_ezyvet_attachment_original('{rid}','{actor}','{ctx['lease_id']}',repeat('e',64),'application/pdf',12,repeat('a',64),repeat('c',64));"))
        sql("insert into storage.objects(bucket_id,name,metadata) values('ezyvet-attachment-originals',"+quote(ctx['intent']['object_path'])+",'{\"size\":12,\"mimetype\":\"application/pdf\"}');")
        return json.loads(run(f"select complete_ezyvet_attachment_capture('{rid}','{actor}','{ctx['lease_id']}','{ctx['intent']['id']}',repeat('e',64),'application/pdf',12);"))['request']['capture']
    def approve(aid,c,prior=None,version=1):
        prev='null' if prior is None else quote(prior['id'])
        return f"select approve_ezyvet_attachment_original('{aid}','{fx['pet']}','{c['id']}','{c['capture_hash']}',{version},{prev},'Reviewed exact race fixture',true);"
    def fresh_record():
        c=fresh_capture();aid=str(uuid.uuid4());return browser(approve(aid,c,latest()))['record']
    def acknowledge(aid,r):return f"select acknowledge_ezyvet_attachment_original('{aid}','{fx['pet']}','{r['id']}','{r['record_hash']}','{r['capture_hash']}',true);"
    def withdraw(aid,r):return f"select withdraw_ezyvet_attachment_original('{aid}','{fx['pet']}','{r['id']}','{r['record_hash']}','Synthetic withdrawal preserves history');"
    def count_action(aid):return scalar(f"select count(*) from ezyvet_attachment_review_actions where id='{aid}';")
    success=lambda code,out,err:code==0
    stale=lambda code,out,err:code!=0 and 'ATTACHMENT_REVIEW_SERIES_STALE' in err
    # Same action races: the committed or abandoned first result is immutable.
    for abandon_first in (True,False):
        c=fresh_capture();aid=str(uuid.uuid4());q=approve(aid,c,latest());abandon=q.replace('approve_ezyvet_attachment_original','abandon_ezyvet_attachment_original_approval')
        contended(staff+(abandon if abandon_first else q),staff+(q if abandon_first else abandon),success)
        check(scalar(f"select status from ezyvet_attachment_review_actions where id='{aid}';")==('abandoned' if abandon_first else 'committed'),'Late approval cannot cross committed/tombstone winner')
    c=fresh_capture();aid=str(uuid.uuid4());q=approve(aid,c,latest())
    contended(staff+q,staff+q,success)
    check(scalar(f"select count(*) from ezyvet_attachment_review_records where action_id='{aid}';")=='1','Duplicate exact approval creates one record')
    # Two different actions competing on one capture or one prior series head.
    for same_capture in (True,False):
        c=fresh_capture();other=c if same_capture else fresh_capture();prior=latest();a,b=str(uuid.uuid4()),str(uuid.uuid4())
        contended(staff+approve(a,c,prior),staff+approve(b,other,prior),stale)
        check(count_action(b)=='0','Losing admission creates no action or record')
    # Acknowledgment and withdrawal serialize: only withdrawal may follow acknowledgment.
    for ack_first in (True,False):
        r=fresh_record();aid,wid=str(uuid.uuid4()),str(uuid.uuid4());ack=acknowledge(aid,r);wd=withdraw(wid,r)
        contended((dvm+ack) if ack_first else (staff+wd),(staff+wd) if ack_first else (dvm+ack),success if ack_first else stale)
        check(scalar(f"select count(*) from ezyvet_attachment_review_acknowledgments where record_id='{r['id']}';")==('1' if ack_first else '0'),'Withdrawal ordering preserves exactly valid acknowledgments')
        check(browser(f"select recover_ezyvet_attachment_review_action('{wid}','{fx['pet']}');")['status']=='committed','Withdrawal recovery independent of acknowledgment')
    # Replacement ordering: existing acknowledgments/withdrawals are kept; superseded head denies new actions.
    for action in ('acknowledge','withdraw'):
        for action_first in (True,False):
            r=fresh_record();c=fresh_capture();aid,pid=str(uuid.uuid4()),str(uuid.uuid4());q=acknowledge(aid,r) if action=='acknowledge' else withdraw(aid,r);role=dvm if action=='acknowledge' else staff;replacement=approve(pid,c,r)
            contended((role+q) if action_first else (staff+replacement),(staff+replacement) if action_first else (role+q),success if action_first else stale)
            check(latest()['capture_id']==c['id'],'Replacement is latest without rewriting previous evidence')
    # Tombstones fence unknown acknowledgments and withdrawals in both orders.
    for action in ('acknowledge','withdraw'):
        for abandon_first in (True,False):
            r=fresh_record();aid=str(uuid.uuid4());q=acknowledge(aid,r) if action=='acknowledge' else withdraw(aid,r);role=dvm if action=='acknowledge' else staff
            abandon=q.replace('acknowledge_ezyvet_attachment_original','abandon_ezyvet_attachment_original_acknowledgment').replace('withdraw_ezyvet_attachment_original','abandon_ezyvet_attachment_original_withdrawal')
            contended(role+(abandon if abandon_first else q),role+(q if abandon_first else abandon),success)
            check(scalar(f"select status from ezyvet_attachment_review_actions where id='{aid}';")==('abandoned' if abandon_first else 'committed'),'Exact record action resolves concurrent cancellation safely')
    # Patient version changes while approval waits reject admission, with no pending side effect.
    c=fresh_capture();aid=str(uuid.uuid4());q=approve(aid,c,latest());change=f"set local request.jwt.claims='{json.dumps({'sub':actor,'role':'authenticated'})}';update pets set name=name where id='{fx['pet']}';"
    contended(change,staff+q,lambda code,out,err:code!=0 and 'ATTACHMENT_REVIEW_PATIENT_STALE' in err)
    check(count_action(aid)=='0','Changed patient leaves no uncommitted action')
    sql(f"alter table pets disable trigger pets_version;update pets set version=1 where id='{fx['pet']}';alter table pets enable trigger pets_version;")
    # New source heads are historical evidence, not an automatic admission block.
    for head_first in (True,False):
        c=fresh_capture();aid=str(uuid.uuid4());q=approve(aid,c,latest());head="update ezyvet_identity_heads set version=version+1 where resource='attachment' and external_id='701';"
        contended(head if head_first else staff+q,staff+q if head_first else head,success)
        check(scalar(f"select source_current_at_review from ezyvet_attachment_review_records where action_id='{aid}';")==('f' if head_first else 't'),'Source-current observation freezes under source head locks')
        sql("update ezyvet_identity_heads set version=version-1 where resource='attachment' and external_id='701';")
    # Storage object identity/metadata are checked after waiting; no original byte mutation is simulated by approval.
    c=fresh_capture();aid=str(uuid.uuid4());q=approve(aid,c,latest());object_id=scalar(f"select storage_object_id from ezyvet_attachment_original_captures where id='{c['id']}';")
    contended(f"update storage.objects set metadata=jsonb_set(metadata,'{{size}}','13') where id='{object_id}';",staff+q,lambda code,out,err:code!=0 and 'ATTACHMENT_ORIGINAL_UNAVAILABLE' in err)
    check(count_action(aid)=='0','Changed object cannot acquire approved provenance')
    # Recovery stays immutable even after patient changes and newer chart actions.
    owned=scalar("select id from ezyvet_attachment_review_actions where action='approve' and status='committed' order by created_at limit 1;")
    before=browser(f"select recover_ezyvet_attachment_review_action('{owned}','{fx['pet']}');")
    sql(change)
    check(browser(f"select recover_ezyvet_attachment_review_action('{owned}','{fx['pet']}');")==before,'Committed recovery is independent of current patient version')
    check(scalar('select count(*) from patient_documents;')=='0','No patient-document promotion')
    check(scalar('select count(*) from external_record_versions;')=='0','No manual export provenance')
    check(scalar('select count(*) from record_release_sources;')=='0','No release inclusion')


finally:
    if created:
        cleanup_owned_database(FOUNDATION_COMMAND, database, marker, check=check)
print(f'Attachment original review concurrency: {checks} checks passed; no provider or physical Storage operations.')
