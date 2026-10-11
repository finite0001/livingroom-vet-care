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
FOUNDATION_COMMAND = ['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']

COMMAND = FOUNDATION_COMMAND.copy()

def sql(query, fail=True):
    result = subprocess.run(COMMAND, input=query, capture_output=True, text=True, timeout=30)
    if fail and result.returncode:
        raise AssertionError(result.stderr)
    return result

def quote(value):
    return "'" + str(value).replace("'", "''") + "'"

actor = '8ca10000-0000-4000-8000-000000000001'
client = None
ids = [actor, client]
checks = 0
owned_sessions = []
processes = []

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
    processes.append(first)
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
    processes.append(second)
    second.stdin.write(f"set application_name='{tag}_waiter';begin;{second_query}commit;")
    second.stdin.close()
    waiting = False
    while time.monotonic() < deadline:
        if sql(f"select count(*) from pg_stat_activity where application_name='{tag}_waiter' and wait_event_type='Lock';").stdout.strip() == '1':
            waiting = True
            break
        if second.poll() is not None:
            raise AssertionError('Waiter exited before observed contention: ' + second.stderr.read())
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


inspection=json.loads(subprocess.check_output(['docker','inspect',CONTAINER]))[0]['Config']['Labels']
check(inspection['com.supabase.cli.project']==project_id,'Verified local project marker')
database='lrv_records_race_'+uuid.uuid4().hex
marker='owned-records-race-'+uuid.uuid4().hex
created=False
def scalar(query):return sql(query).stdout.strip().splitlines()[-1]
def jsonsql(value):return quote(json.dumps(value))+'::jsonb'
def invoke(name,*values):return json.loads(scalar('begin;'+staff+'select to_jsonb('+name+'('+','.join(values)+'));commit;'))
def ident():return str(uuid.uuid4())
try:
 dump=subprocess.run(['docker','exec',CONTAINER,'pg_dump','-U','postgres','--schema-only','--no-owner','--schema=public','--schema=auth','--schema=storage','--schema=extensions','postgres'],capture_output=True,check=True,timeout=120).stdout
 sql(f'create database "{database}";');created=True
 sql(f'comment on database "{database}" is {quote(marker)};')
 COMMAND=FOUNDATION_COMMAND.copy();COMMAND[COMMAND.index('-d')+1]=database
 sql('drop schema public;create schema extensions;create extension pgcrypto with schema extensions;create extension "uuid-ossp" with schema extensions;')
 dump=dump.replace(b'CREATE SCHEMA extensions;',b'CREATE SCHEMA IF NOT EXISTS extensions;')
 dump=b"\n".join(line for line in dump.splitlines() if not line.startswith(b'ALTER DEFAULT PRIVILEGES'))
 restored=subprocess.run(COMMAND,input=dump,capture_output=True,timeout=120);check(restored.returncode==0,restored.stderr.decode())
 sql(f"insert into auth.users(id,email,raw_user_meta_data) values('{actor}','synthetic-records-race@example.test','{{}}');update profiles set is_active=true where id='{actor}';insert into user_roles(user_id,role) values('{actor}','STAFF');")
 client=invoke('save_client',quote(actor),'null','null',quote('Synthetic'),quote('Records race'),quote('+13035550188'),quote('synthetic-records-race@example.test'),quote('EMAIL'),'null','null')['id']
 pet=invoke('save_patient','null',quote(client),'null',quote('Synthetic records race dog'),quote('Dog'),'null','null',quote('unknown'),'null',quote('unknown'),quote('unknown'),'null','null','null')['id']
 values=dict(pet_id=pet,client_id=client,direction='outgoing',subset='full',channel='EMAIL',requester_name='Synthetic race client',request_note='',requested_on='2026-10-10',due_on=None,assigned_to=None,ticket_id=None,conversation_id=None)
 def request():
  rid=ident();invoke('save_record_request',quote(ident()),quote(rid),'null',jsonsql(values));return rid
 # Pause between discovery pages using an observed advisory lock in this isolated clone.
 sql('begin;'+staff+f"select record_patient_weight('{pet}',10+i/100.0,'kg','2026-01-01'::date+i) from generate_series(1,101) i;commit;")
 original=sql("select pg_get_functiondef('list_record_release_sources_v13(uuid,integer)'::regprocedure);").stdout
 pause=13438791
 wrapped=original.replace('begin',f"begin if p_offset>=100 and current_setting('lrv.records_test_pause',true)='true' then perform pg_advisory_xact_lock({pause});end if;",1)
 check(wrapped!=original,'Injected local page-boundary pause');sql(wrapped)
 holder=subprocess.Popen(COMMAND,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);processes.append(holder)
 tag='records_capture_'+uuid.uuid4().hex
 holder.stdin.write(f"set application_name='{tag}_holder';begin;select pg_advisory_xact_lock({pause});\n");holder.stdin.flush()
 deadline=time.monotonic()+30
 while scalar(f"select count(*) from pg_stat_activity where application_name='{tag}_holder' and state='idle in transaction';")!='1':
  assert time.monotonic()<deadline;time.sleep(.03)
 waiter=subprocess.Popen(COMMAND,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);processes.append(waiter)
 # Owner invokes the private stable capture, with the same staff JWT it requires.
 waiter.stdin.write(f"set application_name='{tag}_waiter';begin;select set_config('request.jwt.claims','{{\"sub\":\"{actor}\",\"role\":\"authenticated\"}}',true);set local lrv.records_test_pause='true';select count(*) from jsonb_each(record_request_inventory('{pet}')->'nodes') n where n.value->>'family'='weight_ids';commit;");waiter.stdin.close()
 while scalar(f"select count(*) from pg_stat_activity where application_name='{tag}_waiter' and wait_event_type='Lock';")!='1':
  if waiter.poll() is not None:raise AssertionError(waiter.stderr.read())
  assert time.monotonic()<deadline;time.sleep(.03)
 check(True,'Observed capture waiting between pages')
 invoke('record_patient_weight',quote(pet),'12',quote('kg'),quote('2026-05-01'))
 holder.stdin.write('commit;');holder.stdin.close();holder.wait(timeout=10);waiter.wait(timeout=10)
 output=waiter.stdout.read();check(waiter.returncode==0,waiter.stderr.read());check(output.strip().splitlines()[-1]=='101','One captured SQL statement excludes insertion between its pages')
 sql(original)
 check(scalar('begin;'+staff.replace('set local role authenticated;','')+f"select count(*) from jsonb_each(record_request_inventory('{pet}')->'nodes') n where n.value->>'family'='weight_ids';commit;")=='102','Next capture sees newly inserted actual source')
 # Exact optimistic versions serialize staff transitions; only one mutation wins.
 rid=request()
 cancel=staff+f"select transition_record_request('{ident()}','{rid}',1,'{{\"status\":\"cancelled\",\"review_note\":\"Synthetic concurrent cancellation\"}}');"
 prepare=staff+f"select prepare_record_request_manifest('{ident()}','{rid}',1,"+jsonsql(dict(manifest_id=ident(),selection={},review_note='Synthetic concurrent capture'))+');'
 contended(cancel,prepare,lambda rc,out,err:rc!=0 and 'PT409' in err)
 check(invoke('read_record_request',quote(rid))['request']['status']=='cancelled','Cancellation wins and no partial manifest exists')
 # Bound disclosure rechecks the request row after waiting on cancellation.
 rid=request();captured=invoke('prepare_record_request_manifest',quote(ident()),quote(rid),'1',jsonsql(dict(manifest_id=ident(),selection={},review_note='Synthetic captured chart')))
 manifest=captured['manifest_id']
 gate=f"select record_request_authorization_current('{rid}','{manifest}');"
 cancel=staff+f"select transition_record_request('{ident()}','{rid}',2,'{{\"status\":\"cancelled\",\"review_note\":\"Synthetic final gate cancellation\"}}');"
 contended(cancel,gate,lambda rc,out,err:rc==0 and out.strip().splitlines()[-1]=='f')
 # A final authorization already holding SHARE commits before cancellation.
 rid=request();captured=invoke('prepare_record_request_manifest',quote(ident()),quote(rid),'1',jsonsql(dict(manifest_id=ident(),selection={},review_note='Synthetic second capture')))
 gate=f"select record_request_authorization_current('{rid}','{captured['manifest_id']}');"
 cancel=staff+f"select transition_record_request('{ident()}','{rid}',2,'{{\"status\":\"cancelled\",\"review_note\":\"Synthetic after gate\"}}');"
 contended(gate,cancel,lambda rc,out,err:rc==0)
 check(scalar(gate)=='f','Later final authorization observes cancellation')
 # Offboarding while waiting on the request row cannot make a staff decision.
 rid=request()
 offboard=f"select 1 from record_requests where id='{rid}' for update;update profiles set is_active=false where id='{actor}';"
 prepare=staff+f"select prepare_record_request_manifest('{ident()}','{rid}',1,"+jsonsql(dict(manifest_id=ident(),selection={},review_note='Synthetic offboarding race'))+');'
 contended(offboard,prepare,lambda rc,out,err:rc!=0 and '42501' in err)
finally:
 if created:
  COMMAND=FOUNDATION_COMMAND.copy()
  check(scalar(f"select shobj_description(oid,'pg_database') from pg_database where datname='{database}';")==marker,'Exact owned database marker checked')
  sql(f"select pg_terminate_backend(pid) from pg_stat_activity where datname='{database}' and pid<>pg_backend_pid() and usename=current_user and backend_type='client backend';")
  for proc in processes:
   if proc.stdin and not proc.stdin.closed:proc.stdin.close()
   proc.wait(timeout=10)
  sql(f'drop database "{database}";')
  check(scalar(f"select count(*) from pg_database where datname='{database}';")=='0','Owned race database removed')
print(f'Records request concurrency: {checks} checks passed; no provider requests.')
