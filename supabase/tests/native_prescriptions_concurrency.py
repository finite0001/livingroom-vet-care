"""Actual local PostgreSQL contention; synthetic fixtures only, never provider calls."""
import argparse
from pathlib import Path
import json
import subprocess
import time
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--project-config', type=Path, required=True, help='Derive the database container from a Supabase TOML project_id')
parser.add_argument('--run-synthetic-local',action='store_true',required=True,help='Authorize only owned schema-clone synthetic testing')
args = parser.parse_args()
CONTAINER = None
if args.project_config:
    import tomllib
    with args.project_config.open('rb') as config_file:
        project_id = tomllib.load(config_file)['project_id']
    CONTAINER = 'supabase_db_' + project_id
FOUNDATION_COMMAND = ['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1']

COMMAND = FOUNDATION_COMMAND.copy()

def sql(query, fail=True):
    result = subprocess.run(COMMAND, input=query, capture_output=True, text=True, timeout=30)
    if fail and result.returncode:
        raise AssertionError(result.stderr)
    return result

def quote(value):
    return "'" + str(value).replace("'", "''") + "'"

actor = 'a5510000-0000-4000-8000-000000000001'
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
    tag = 'lrv_prescribing_' + uuid.uuid4().hex
    owned_sessions.extend([tag + '_holder', tag + '_waiter'])
    first = subprocess.Popen(COMMAND, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    first.stdin.write(f"set application_name='{tag}_holder';begin;{first_query}\n")
    first.stdin.flush()
    deadline = time.monotonic() + 30
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


import tomllib
inspection=subprocess.run(['docker','inspect',CONTAINER],capture_output=True,text=True,check=True,timeout=30)
check(json.loads(inspection.stdout)[0]['Config']['Labels']['com.supabase.cli.project']==project_id,'Verified owned local project')
database='lrv_native_rx_race_'+uuid.uuid4().hex
marker='owned-native-rx-race-'+uuid.uuid4().hex
created=False
fixture=Path(__file__).with_name('native_prescriptions_lifecycle.test.sql').read_text().split('-- FIXTURE_BEGIN')[1].split('-- FIXTURE_END')[0]
def scalar(query):return sql(query).stdout.strip().splitlines()[-1]
def jsonsql(value):return quote(json.dumps(value))+'::jsonb'
def call(name,*args):return 'select '+name+'('+','.join(args)+');'
def transaction(query):return 'begin;'+staff+query+'commit;'
other_actor='a5510000-0000-4000-8000-000000000003'
other_staff=staff.replace(actor,other_actor)
def invoke(name,*args,other=False):return json.loads(scalar('begin;'+(other_staff if other else staff)+call(name,*args)+'commit;'))
def operation(name,request_id,request,other=False):return (other_staff if other else staff)+call(name,quote(request_id),jsonsql(request))
def receipt(request_id,other=False):return json.loads(scalar('begin;'+(other_staff if other else staff)+'select coalesce(recover_native_prescription_operation('+quote(request_id)+"),'null'::jsonb);commit;"))
try:
    dump=subprocess.run(['docker','exec',CONTAINER,'pg_dump','-U','postgres','--schema-only','--no-owner','--schema=public','--schema=auth','--schema=storage','--schema=extensions','postgres'],capture_output=True,check=True,timeout=120).stdout
    sql(f'create database "{database}";');created=True
    sql(f"comment on database \"{database}\" is {quote(marker)};")
    COMMAND=FOUNDATION_COMMAND.copy();COMMAND[COMMAND.index('-d')+1]=database
    sql('drop schema public;create schema extensions;create extension pgcrypto with schema extensions;create extension "uuid-ossp" with schema extensions;')
    dump=dump.replace(b'CREATE SCHEMA extensions;',b'CREATE SCHEMA IF NOT EXISTS extensions;')
    dump=b"\n".join(line for line in dump.splitlines() if not line.startswith(b'ALTER DEFAULT PRIVILEGES'))
    restored=subprocess.run(COMMAND,input=dump,capture_output=True,timeout=120)
    check(restored.returncode==0,restored.stderr.decode())
    saved=json.loads(scalar('begin;set local search_path=public,extensions;'+fixture+"select configure_native_prescriber((select id from fx where k='config'),(select v from data where k='config-request'));select jsonb_build_object('fx',(select jsonb_object_agg(k,id) from fx),'data',(select jsonb_object_agg(k,v) from data));commit;"))
    fx=saved['fx'];base=saved['data']['save-request']
    sql("update profiles set full_name='Synthetic prescriber' where id="+quote(other_actor)+";")
    invoke('configure_native_prescriber',quote(str(uuid.uuid4())),jsonsql({**saved['data']['config-request'],'user_id':other_actor}))
    def draft():
        request={**base,'draft_id':str(uuid.uuid4())}
        invoke('save_native_prescription_draft',quote(str(uuid.uuid4())),jsonsql(request))
        return request['draft_id']
    def sign_request(d,other=False):
        preview=invoke('preview_native_prescription_sign',quote(d),'1',other=other)
        return dict(draft_id=d,pet_id=fx['pet'],expected_version=1,expected_context_hash=preview['context_hash'],signature_name='Synthetic prescriber',attest_review=True)
    def signed():
        d=draft();i=str(uuid.uuid4());invoke('sign_native_prescription',quote(i),jsonsql(sign_request(d)));return i
    def cancel_request(a,other=False):
        p=invoke('preview_native_prescription_cancel',quote(a),quote(fx['pet']),other=other)
        return dict(authorization_id=a,pet_id=fx['pet'],expected_event_id=p['context']['head']['id'],expected_context_hash=p['context_hash'],reason='Synthetic concurrent cancellation',attest_review=True)
    def replacement(a,d,other=False):
        p=invoke('preview_native_prescription_replacement',quote(a),quote(fx['pet']),quote(d),'1',other=other)
        return dict(authorization_id=a,pet_id=fx['pet'],expected_event_id=None,expected_context_hash=p['context_hash'],reason='Synthetic concurrent replacement',attest_review=True,draft_id=d,expected_version=1,signature_name='Synthetic prescriber',reconciliation=dict(native_use_note='Manually reviewed; native accounting unavailable',external_use_status='unknown',external_use_note='Unknown external use explicitly recorded',remaining_allowance_note='Reviewed remaining allowance manually',attest_review=True))
    # Committed replacement wins; cancellation must observe its new head after a real lock wait.
    a=signed();d=draft();rep_id=str(uuid.uuid4());cancel_id=str(uuid.uuid4());rep=replacement(a,d);cancel=cancel_request(a,other=True)
    contended(operation('replace_native_prescription',rep_id,rep),operation('cancel_native_prescription',cancel_id,cancel,other=True),lambda code,out,err:code!=0 and 'Authorization change context changed' in err)
    check(receipt(cancel_id,other=True) is None,'Losing cancellation writes no receipt')
    check(invoke('read_native_prescription_status',quote(a),quote(fx['pet']))['status']['state']=='replaced','Winning replacement terminal head retained')
    # Cancellation wins the reverse race; replacement cannot sign its prepared draft.
    a=signed();d=draft();rep_id=str(uuid.uuid4());cancel_id=str(uuid.uuid4());rep=replacement(a,d,other=True);cancel=cancel_request(a)
    contended(operation('cancel_native_prescription',cancel_id,cancel),operation('replace_native_prescription',rep_id,rep,other=True),lambda code,out,err:code!=0 and 'Authorization change context changed' in err)
    check(receipt(rep_id,other=True) is None,'Losing replacement writes no receipt')
    check(invoke('read_native_prescription_draft',quote(d),quote(fx['pet']))['status']=='draft','Losing replacement leaves unsigned draft')
    # Initial sign and replacement compete for precisely the same draft.
    a=signed();d=draft();rep_id=str(uuid.uuid4());sign_id=str(uuid.uuid4());rep=replacement(a,d,other=True);sig=sign_request(d)
    contended(operation('sign_native_prescription',sign_id,sig),operation('replace_native_prescription',rep_id,rep,other=True),lambda code,out,err:code!=0 and 'Prescription draft changed' in err)
    check(receipt(rep_id,other=True) is None,'Replacement cannot adopt independently signed draft')
    check(invoke('read_native_prescription_status',quote(a),quote(fx['pet']))['status']['state']=='active','Failed adoption leaves old authorization active')
    a=signed();d=draft();rep_id=str(uuid.uuid4());sign_id=str(uuid.uuid4());rep=replacement(a,d);sig=sign_request(d,other=True)
    contended(operation('replace_native_prescription',rep_id,rep),operation('sign_native_prescription',sign_id,sig,other=True),lambda code,out,err:code!=0 and 'Prescription draft changed' in err)
    check(receipt(sign_id,other=True) is None,'Losing initial signature creates no child authorization')
    check(receipt(rep_id)['operation']=='replace','Replacement retains single outer receipt')
finally:
    if created:
        COMMAND=FOUNDATION_COMMAND.copy()
        check(scalar(f"select shobj_description(oid,'pg_database') from pg_database where datname='{database}';")==marker,'Exact owned database marker checked')
        sql(f"select pg_terminate_backend(pid) from pg_stat_activity where datname='{database}' and pid<>pg_backend_pid();")
        sql(f'drop database "{database}";')
        check(scalar(f"select count(*) from pg_database where datname='{database}';")=='0','Disposable database removed')
print(f'Native prescription concurrency: {checks} checks passed; no provider calls.')
