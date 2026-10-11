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

actor = 'b3110000-0000-4000-8000-000000000801'
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
    tag = 'lrv_diagnostics_' + uuid.uuid4().hex
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
check(Path(inspection['com.supabase.cli.workdir']).resolve()==args.project_config.resolve().parent.parent,'Verified local runtime ownership/path')
database='lrv_diagnostics_race_'+uuid.uuid4().hex
marker='owned-diagnostics-race-'+uuid.uuid4().hex
created=False
admin='b3110000-0000-4000-8000-000000000802'
def scalar(query):return sql(query).stdout.strip().splitlines()[-1]
def jsonsql(value):return quote(json.dumps(value))+'::jsonb'
def invoke(name,*values):return json.loads(scalar('begin;'+staff+'select to_jsonb('+name+'('+','.join(values)+'));commit;'))
def ident():return str(uuid.uuid4())
def call(action,panel,pet,version,kind,values,note='',reason=''):
 return 'select save_diagnostic_panel('+','.join([quote(action),quote(panel),quote(pet),str(version) if version is not None else 'null',quote(kind),jsonsql(values),quote(note),quote(reason)])+');'
try:
 dump=subprocess.run(['docker','exec',CONTAINER,'pg_dump','-U','postgres','--schema-only','--no-owner','--schema=public','--schema=auth','--schema=storage','--schema=extensions','postgres'],capture_output=True,check=True,timeout=120).stdout
 sql(f'create database "{database}";');created=True
 sql(f'comment on database "{database}" is {quote(marker)};')
 COMMAND=FOUNDATION_COMMAND.copy();COMMAND[COMMAND.index('-d')+1]=database
 sql('drop schema public;create schema extensions;create extension pgcrypto with schema extensions;create extension "uuid-ossp" with schema extensions;')
 dump=dump.replace(b'CREATE SCHEMA extensions;',b'CREATE SCHEMA IF NOT EXISTS extensions;')
 dump=b"\n".join(line for line in dump.splitlines() if not line.startswith(b'ALTER DEFAULT PRIVILEGES'))
 restored=subprocess.run(COMMAND,input=dump,capture_output=True,timeout=120);check(restored.returncode==0,restored.stderr.decode())
 sql(f"insert into auth.users(id,email,raw_user_meta_data) values('{actor}','synthetic-diagnostics-race@example.test','{{}}'),('{admin}','synthetic-diagnostics-race-admin@example.test','{{}}');update profiles set is_active=true,full_name='Synthetic diagnostic race reviewer' where id in ('{actor}','{admin}');insert into user_roles(user_id,role) values('{actor}','DVM'),('{admin}','ADMIN');")
 client=invoke('save_client',quote(actor),'null','null',quote('Synthetic'),quote('Diagnostic race'),quote('+13035550189'),quote('synthetic-diagnostic-race@example.test'),quote('EMAIL'),'null','null')['id']
 pet=invoke('save_patient','null',quote(client),'null',quote('Synthetic diagnostic race dog'),quote('Dog'),'null','null',quote('unknown'),'null',quote('unknown'),quote('unknown'),'null','null','null')['id']
 values=dict(panel_name='Synthetic panel',category='laboratory',collected_on='2026-10-01',reported_on='2026-10-02',specimen='Serum',method='Synthetic device',source='Manual in-house',interpretation='Synthetic documentary findings',lab_order_id=None,lab_order_version=None,encounter_id=None,encounter_version=None,document_id=None,document_version=None,observations=[dict(id=ident(),analyte_key='synthetic-value',label='Synthetic value',kind='numeric',value_number=0,value_text=None,unit='U/L',reference_low=None,reference_high=None,reference_text='',source_flag='')])
 panel=ident();sql('begin;'+staff+call(ident(),panel,pet,None,'draft',values)+'commit;')
 action=ident();args=call(action,panel,pet,1,'finalize',values,'Synthetic exact review')
 contended(staff+args,staff+args,lambda code,out,err:code==0 and '"number": 1' in out)
 check(scalar(f"select count(*) from diagnostic_panel_versions where panel_id='{panel}';")=='1','Concurrent exact finalization retry creates one immutable version')
 check(scalar(f"select count(*) from diagnostic_panel_actions where id='{action}';")=='1','Concurrent exact retry creates one operation receipt')
 values['observations'][0]['value_number']=2
 sql('begin;'+staff+call(ident(),panel,pet,2,'draft',values)+'commit;')
 contended(staff+call(ident(),panel,pet,3,'finalize',values,'Synthetic review','Synthetic correction'),staff+call(ident(),panel,pet,3,'finalize',values,'Synthetic competing review','Synthetic competing correction'),lambda code,out,err:code!=0 and 'PT409' in err)
 check(scalar(f"select current_finalized_number from diagnostic_panels where id='{panel}';")=='2','Competing correction cannot fork the finalized head')
 check(scalar(f"select snapshot#>>'{{observations,0,value_number}}' from diagnostic_panel_versions where panel_id='{panel}' and number=1;")=='0','Original zero survives correction races')
 values['observations'][0]['value_number']=3
 sql('begin;'+staff+call(ident(),panel,pet,4,'draft',values)+'commit;')
 holder=f"select 1 from diagnostic_panels where id='{panel}' for update;select set_config('request.jwt.claims',"+quote(json.dumps({'sub':admin,'role':'authenticated'}))+f",true);update profiles set is_active=false where id='{actor}';"
 contended(holder,staff+call(ident(),panel,pet,5,'finalize',values,'Synthetic stale review','Synthetic correction'),lambda code,out,err:code!=0 and '42501' in err)
 check(scalar(f"select current_finalized_number from diagnostic_panels where id='{panel}';")=='2','Offboarding during an observed wait prevents finalization')
 sql(f"begin;select set_config('request.jwt.claims',"+quote(json.dumps({'sub':admin,'role':'authenticated'}))+f",true);update profiles set is_active=true where id='{actor}';commit;")
 holder=f"select 1 from diagnostic_panels where id='{panel}' for update;select set_config('request.jwt.claims',"+quote(json.dumps({'sub':admin,'role':'authenticated'}))+f",true);delete from user_roles where user_id='{actor}' and role='DVM';"
 contended(holder,staff+call(ident(),panel,pet,5,'finalize',values,'Synthetic revoked DVM review','Synthetic correction'),lambda code,out,err:code!=0 and '42501' in err)
 check(scalar(f"select current_finalized_number from diagnostic_panels where id='{panel}';")=='2','DVM-role removal during a wait prevents clinical review')
 check(scalar('select count(*) from communication_outbox;')=='0','Race proof never creates a communication')
 print(f'Diagnostic observed-lock concurrency passed: {checks} checks; no provider requests.')
finally:
 for process in processes:
  if process.poll() is None:process.kill();process.wait(timeout=10)
 for tag in owned_sessions:
  sql('select pg_terminate_backend(pid) from pg_stat_activity where application_name='+quote(tag)+' and pid<>pg_backend_pid();',False)
 if created:
  COMMAND=FOUNDATION_COMMAND.copy()
  check(scalar(f"select shobj_description(oid,'pg_database') from pg_database where datname='{database}';")==marker,'Cleanup database ownership marker verified')
  sql(f'drop database "{database}";')
