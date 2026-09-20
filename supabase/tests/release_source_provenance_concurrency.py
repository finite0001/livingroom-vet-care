"""Actual local PostgreSQL contention; synthetic fixtures only, never provider calls."""
import argparse
from pathlib import Path
import json
import subprocess
import time
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--project-config', type=Path, help='Derive the database container from a Supabase TOML project_id')
parser.add_argument('--reverse', action='store_true', help=argparse.SUPPRESS)
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
        raise AssertionError(result.stderr)
    return result

def quote(value):
    return "'" + str(value).replace("'", "''") + "'"

actor = 'db470000-0000-4000-8000-000000000001'
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
    tag = 'lrv_release_source_' + uuid.uuid4().hex
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

# A fresh schema-only database keeps all synthetic clinical acceptance away from
# foundation and exposes no Auth/Storage/Edge API or provider worker.
import re
inspection = subprocess.run(['docker','inspect',CONTAINER],capture_output=True,text=True,check=True)
check(json.loads(inspection.stdout)[0]['Config']['Labels']['com.supabase.cli.project']==CONTAINER.removeprefix('supabase_db_'),'Verified local foundation project identity')
database='lrv_release_race_'+uuid.uuid4().hex
assert re.fullmatch(r'lrv_release_race_[a-f0-9]{32}',database)
marker='owned-release-race-'+uuid.uuid4().hex
policy_before=sql("select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from public.record_release_policy p;").stdout.strip()
created=False
service="set local role service_role;select set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);"
fixture_text=(Path(__file__).with_name('release_source_provenance.test.sql')).read_text().split('-- FIXTURE_BEGIN:')[1].split('-- FIXTURE_END')[0]
fixture_text='\n'.join(fixture_text.splitlines()[1:])

def scalar(query):return sql(query).stdout.strip().splitlines()[-1]
def operation(statement):return scalar('begin;'+staff+statement+'commit;')
def new_review():return json.loads(operation(f"select preview_record_release_v5('{fx['pet']}','{fx['client']}','EMAIL','release-source@example.test',{quote(json.dumps(selection))}::jsonb);"))
def confirm(review,release_id):return f"select confirm_record_release('{release_id}','{fx['pet']}','{fx['client']}','EMAIL','release-source@example.test',{quote(json.dumps(selection))}::jsonb,{quote(json.dumps(review['snapshot']))}::jsonb,'{review['source_hash']}',true);"
def pending_release():
    review=new_review();release_id=str(uuid.uuid4());operation(confirm(review,release_id));return release_id

def context_tables():
    return "create temp table fx(k text primary key,id uuid);create temp table data(k text primary key,v jsonb);grant all on fx,data to authenticated,service_role;"+''.join(f"insert into fx values({quote(k)},{quote(v)});" for k,v in fx.items())+''.join(f"insert into data values({quote(k)},{quote(json.dumps(v))}::jsonb);" for k,v in data.items())
try:
    dump=subprocess.run(['docker','exec',CONTAINER,'pg_dump','-U','postgres','--schema-only','--no-owner','--schema=public','--schema=auth','--schema=storage','--schema=extensions','postgres'],capture_output=True,check=True).stdout
    sql(f'create database "{database}";');created=True
    sql(f'comment on database "{database}" is {quote(marker)};')
    COMMAND=FOUNDATION_COMMAND.copy();COMMAND[COMMAND.index('-d')+1]=database
    sql('drop schema public;create schema extensions;create extension pgcrypto with schema extensions;create extension "uuid-ossp" with schema extensions;')
    dump=dump.replace(b"CREATE SCHEMA extensions;",b"CREATE SCHEMA IF NOT EXISTS extensions;")
    # Default ACLs owned by platform roles cannot be changed by postgres; existing object ACLs remain exact.
    dump=b"\n".join(line for line in dump.splitlines() if not line.startswith(b"ALTER DEFAULT PRIVILEGES"))
    restored=subprocess.run(COMMAND,input=dump,capture_output=True)
    check(restored.returncode==0,restored.stderr.decode())
    sql("insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('patient-documents','patient-documents',false,20971520,array['application/pdf','image/jpeg','image/png']);")
    output=scalar('begin;set local search_path=public,extensions;'+fixture_text+"reset role;update record_release_policy set accepted_schema_version=5;select jsonb_build_object('fx',(select jsonb_object_agg(k,id) from fx),'data',(select jsonb_object_agg(k,v) from data));commit;")
    saved=json.loads(output);fx=saved['fx'];data=saved['data'];selection=data['selection'];client=fx['client']
    dvm="set local role authenticated;select set_config('request.jwt.claims','{\"sub\":\"db470000-0000-4000-8000-000000000002\",\"role\":\"authenticated\"}',true);"
    ack=f"select acknowledge_lab_report('{fx['ack']}','{fx['report']}','{fx['pet']}','{data['capture']['capture_hash']}',2,true);"
    review=new_review();release_id=str(uuid.uuid4())
    if args.reverse:
        contended(dvm+ack,staff+confirm(review,release_id),lambda code,out,err:code!=0 and 'preview and review again' in err)
    else:
        contended(staff+confirm(review,release_id),dvm+ack,lambda code,out,err:code==0)
        check(operation(f"select read_record_release('{release_id}')->>'eligible';")=='false','Acknowledgment after confirmation invalidates new release')
    # Independent external acknowledgment can win before a stale confirmation.
    review=new_review();external_ack=f"select acknowledge_external_record('{fx['external-ack']}','{fx['record']}','{fx['pet']}','{data['external-capture']['capture_hash']}',2,true);"
    if args.reverse:
        release_id=str(uuid.uuid4())
        contended(staff+confirm(review,release_id),dvm+external_ack,lambda code,out,err:code==0)
        check(operation(f"select read_record_release('{release_id}')->>'eligible';")=='false','External acknowledgment invalidates confirmed release')
    else:
        contended(dvm+external_ack,staff+confirm(review,str(uuid.uuid4())),lambda code,out,err:code!=0 and 'preview and review again' in err)
    # Confirm first, corrected lab report second.
    correction=f"select link_lab_report_version('{fx['corrected-report']}','{fx['corrected-receipt']}','{data['corrected-receipt']['receipt_hash']}','{data['corrected-capture']['capture_hash']}','{fx['order']}','{fx['pet']}',1,'{fx['order-review']}','{fx['report']}','corrected','Synthetic correction',true);"
    review=new_review();release_id=str(uuid.uuid4())
    if args.reverse:
        contended(staff+correction,staff+confirm(review,release_id),lambda code,out,err:code!=0 and 'preview and review again' in err)
    else:
        contended(staff+confirm(review,release_id),staff+correction,lambda code,out,err:code==0)
        check(operation(f"select read_record_release('{release_id}')->>'eligible';")=='false','Correction after confirmation invalidates prior source')
    # A replacement wins against a preview containing the previously current original.
    receipt_id,capture_id,record_id=[str(uuid.uuid4()) for _ in range(3)]
    receipt=json.loads(operation(f"select to_jsonb(stage_external_record_receipt('{receipt_id}','{fx['mapping']}',1,'{fx['replacement-doc']}',2,'export-77',now(),'{fx['record']}','Synthetic replacement'));"))
    capture=json.loads(scalar('begin;'+service+f"select to_jsonb(capture_external_record_bytes('{receipt_id}','{actor}','{receipt['receipt_hash']}',2,repeat('d',64),12,'application/pdf'));commit;"))
    replacement=f"select approve_external_record_import('{record_id}','{receipt_id}','{receipt['receipt_hash']}','{capture['capture_hash']}',true);"
    review=new_review()
    if args.reverse:
        release_id=str(uuid.uuid4())
        contended(staff+confirm(review,release_id),staff+replacement,lambda code,out,err:code==0)
        check(operation(f"select read_record_release('{release_id}')->>'eligible';")=='false','Replacement invalidates confirmed release')
    else:
        contended(staff+replacement,staff+confirm(review,str(uuid.uuid4())),lambda code,out,err:code!=0 and 'preview and review again' in err)
    # Mixed old/new previews share a patient gate before chart/order locks.
    chart_id=str(uuid.uuid4())
    scalar('begin;'+dvm+f"select save_dental_chart('{chart_id}','{fx['pet']}',null,'adult',now(),'Synthetic contention chart','{{}}');select sign_dental_chart('{chart_id}','{fx['pet']}',1);commit;")
    lab_payload={'test_name':'Synthetic lab','status':'resulted','result_document_id':fx['doc'],'collected_date':'2026-09-13','result_date':'2026-09-13'}
    operation(f"select save_patient_lab_order('{fx['order']}','{fx['pet']}',1,{quote(json.dumps(lab_payload))}::jsonb,'Synthetic result state');")
    selection={**selection,'dental_ids':[chart_id],'lab_order_ids':[fx['order']]}
    v4selection={'document_ids':[fx['doc']],'dental_ids':[chart_id],'lab_order_ids':[fx['order']]}
    old_preview=f"select preview_record_release_v4('{fx['pet']}','{fx['client']}','EMAIL','release-source@example.test',{quote(json.dumps(v4selection))}::jsonb);"
    new_preview=f"select preview_record_release_v5('{fx['pet']}','{fx['client']}','EMAIL','release-source@example.test',{quote(json.dumps(selection))}::jsonb);"
    contended(staff+old_preview,staff+new_preview,lambda code,out,err:code==0)
    contended(staff+new_preview,staff+old_preview,lambda code,out,err:code==0)
    contended(staff+new_preview,staff+new_preview,lambda code,out,err:code==0)
    # Document void wins while preview waits on its exact original lock.
    review=new_review()
    void=staff+f"select void_patient_document('{fx['external-doc']}',2,'Synthetic contention');"
    if args.reverse:
        release_id=str(uuid.uuid4())
        contended(staff+confirm(review,release_id),void,lambda code,out,err:code==0)
        check(operation(f"select read_record_release('{release_id}')->>'eligible';")=='false','Voiding exact original invalidates confirmed release')
    else:
        contended(void,staff+confirm(review,str(uuid.uuid4())),lambda code,out,err:code!=0 and ('shareable' in err or 'original' in err or 'available' in err))
finally:
    if created:
        COMMAND=FOUNDATION_COMMAND.copy()
        check(scalar(f"select shobj_description(oid,'pg_database') from pg_database where datname='{database}';")==marker,'Owned disposable database marker verified before cleanup')
        cleanup_sql(f"select pg_terminate_backend(pid) from pg_stat_activity where datname='{database}' and pid<>pg_backend_pid();")
        cleanup_sql(f'drop database "{database}";')
        check(scalar(f"select count(*) from pg_database where datname='{database}';")=='0','Disposable database removed')
    COMMAND=FOUNDATION_COMMAND.copy()
    check(sql("select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from public.record_release_policy p;").stdout.strip()==policy_before,'Foundation clinical acceptance unchanged')
print(f'Local release provenance concurrency: {checks} checks passed in disposable database; no provider requests.')

if not args.reverse:
    import sys
    command=[sys.executable,str(Path(__file__).resolve()),'--reverse']
    if args.project_config:command+=['--project-config',str(args.project_config)]
    subprocess.run(command,check=True)
