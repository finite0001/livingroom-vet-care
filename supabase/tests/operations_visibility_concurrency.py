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
COMMAND = ['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1']

def sql(query, fail=True):
    result = subprocess.run(COMMAND, input=query, capture_output=True, text=True)
    if fail and result.returncode:
        raise AssertionError(result.stderr)
    return result

def quote(value):
    return "'" + str(value).replace("'", "''") + "'"

actor = str(uuid.uuid4())
client = str(uuid.uuid4())
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
    tag = 'lrv_collection_' + uuid.uuid4().hex
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

service="set local role service_role;select set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);"
try:
    check(sql("select count(*) from public.reminder_automation_policies where enabled;").stdout.strip()=='0','No unrelated enabled reminder automation')
    sql(f"insert into auth.users(id,email,raw_user_meta_data) values('{actor}','operations-{actor}@example.test','{{}}');insert into public.user_roles(user_id,role) values('{actor}','ADMIN');")
    client=sql('begin;'+staff+f"select (public.save_client(auth.uid(),null,null,'Synthetic','Operations',null,'{actor}@example.test','EMAIL',null,null)).id;commit;").stdout.strip().splitlines()[-1];ids.append(client)
    pet=sql('begin;'+staff+f"select (public.save_patient(null,'{client}',null,'Synthetic','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null)).id;commit;").stdout.strip().splitlines()[-1];ids.append(pet)
    template,policy,order=[str(uuid.uuid4()) for _ in range(3)];ids.extend([template,policy,order])
    sql('begin;'+staff+f"""select public.save_care_message_template('{template}',null,'Synthetic reminder','email',0,'{{{{patient_name}}}}: {{{{care_name}}}} due {{{{due_date}}}}',true,'Synthetic reviewed wording');
    select public.save_reminder_automation_policy('{policy}',null,'lab','EMAIL','{template}',1,'Synthetic reminder',true,'Synthetic local fixture');
    select public.save_patient_lab_order('{order}','{pet}',null,jsonb_build_object('test_name','Synthetic lab','status','planned','due_date',(now() at time zone 'America/Denver')::date),'');commit;""")
    run=str(uuid.uuid4());ids.append(run)
    contended(service+f"select public.start_reminder_scheduler_run('{run}',25);",service+f"select public.start_reminder_scheduler_run('{run}',24);",lambda code,out,err:code!=0 and 'another limit' in err)
    check(sql(f"select count(*) from public.reminder_scheduler_runs where run_id='{run}';").stdout.strip()=='1','Concurrent start preserves one immutable request')
    execute=service+f"select public.execute_reminder_scheduler_run('{run}');"
    contended(execute,execute,lambda code,out,err:code==0 and json.loads(out.strip().splitlines()[-1])['counts']['queued']==1)
    check(sql(f"select count(*) from public.communication_outbox where client_id='{client}';").stdout.strip()=='1','Concurrent execution queues once and repeats original count')
    check(sql(f"select count(*) from public.reminder_scheduler_results where run_id='{run}';").stdout.strip()=='1','Only one terminal receipt recorded')
    # A read during uncommitted completion must remain unresolved, never invent zero or rerun.
    run2,order2=[str(uuid.uuid4()) for _ in range(2)];ids.extend([run2,order2])
    sql('begin;'+staff+f"select public.save_patient_lab_order('{order2}','{pet}',null,jsonb_build_object('test_name','Second synthetic','status','planned','due_date',(now() at time zone 'America/Denver')::date),'');commit;")
    sql('begin;'+service+f"select public.start_reminder_scheduler_run('{run2}',25);commit;")
    tag='lrv_operations_'+uuid.uuid4().hex;owned_sessions.append(tag)
    holder=subprocess.Popen(COMMAND,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    holder.stdin.write(f"set application_name='{tag}';begin;{service}select public.execute_reminder_scheduler_run('{run2}');select pg_sleep(2);commit;");holder.stdin.close()
    deadline=time.monotonic()+8
    while time.monotonic()<deadline:
        if sql(f"select count(*) from pg_stat_activity where application_name='{tag}' and wait_event='PgSleep';").stdout.strip()=='1':break
        time.sleep(.03)
    else:raise AssertionError('Execution lock holder not observed')
    result=json.loads(sql('begin;'+service+f"select public.recover_reminder_scheduler_run('{run2}');commit;").stdout.strip().splitlines()[-1])
    check(result['outcome']=='started' and result['counts'] is None,'Recovery during unknown completion reports unresolved with no invented counts')
    holder.wait(timeout=10);check(holder.returncode==0,holder.stderr.read())
    result=json.loads(sql('begin;'+service+f"select public.recover_reminder_scheduler_run('{run2}');commit;").stdout.strip().splitlines()[-1])
    check(result['outcome']=='completed' and result['counts']['queued']==1,'After commit recovery finds same run result without queueing')
    check(sql(f"select count(*) from public.communication_outbox where client_id='{client}';").stdout.strip()=='2','Recovery does not add extra reminder handoffs')
finally:
    if owned_sessions:
        names=','.join(quote(name) for name in owned_sessions)
        sql(f"select pg_terminate_backend(pid) from pg_stat_activity where application_name in ({names}) and pid<>pg_backend_pid();")
    # Collect generated child identities before cleanup, preserving all unrelated practice rows.
    for query in [f"select id from public.care_reminder_jobs where client_id='{client}';",f"select id from public.communication_outbox where client_id='{client}';",f"select id from public.conversations where client_id='{client}';",f"select message_id from public.communication_outbox where client_id='{client}';"]:
        ids.extend(sql(query).stdout.strip().splitlines())
    patterns=','.join(quote('%'+item+'%') for item in set(ids) if item)
    sql(f"""begin;set local session_replication_role=replica;
    do $cleanup$ declare t record;begin for t in select schemaname,tablename from pg_tables where schemaname='public' loop
    execute format('delete from %I.%I r where to_jsonb(r)::text like any ($1)',t.schemaname,t.tablename) using array[{patterns}];end loop;end $cleanup$;
    delete from auth.users where id='{actor}';commit;""")
    check(sql(f"select count(*) from public.communication_outbox where client_id='{client}';").stdout.strip()=='0','Owned fixture cleanup verified')
print(f'Local operations visibility concurrency: {checks} checks passed; no provider requests.')
