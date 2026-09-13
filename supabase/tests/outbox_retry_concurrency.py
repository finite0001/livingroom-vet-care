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
    tag = 'lrv_outbox_retry_' + uuid.uuid4().hex
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
conversation=str(uuid.uuid4());ids.append(conversation)
def scalar(query):return sql(query).stdout.strip().splitlines()[-1]
def prepare_failure():
    request=str(uuid.uuid4());ids.append(request)
    row=json.loads(scalar('begin;'+staff+f"select public.prepare_message_request(auth.uid(),'{request}','fixture:{request}','{conversation}','EMAIL','{actor}@example.test','Synthetic retry','Synthetic retry body','{{}}');select to_jsonb(public.enqueue_communication(auth.uid(),'{request}','{conversation}','EMAIL','{actor}@example.test','Synthetic retry','Synthetic retry body','{{}}'));commit;"))
    outbox=row['id'];ids.extend([outbox,row['message_id']])
    sql(f"update public.communication_outbox set state='failed',last_error='delivery_policy_or_configuration_blocked' where id='{outbox}';")
    preview=json.loads(scalar('begin;'+staff+f"select public.preview_outbox_retry('{outbox}');commit;"))
    return outbox,preview['expected_work_hash']
def retry(action,outbox,work_hash):
    ids.append(action)
    return f"select public.requeue_outbox_retry('{action}','{outbox}','{work_hash}','configuration_repaired',true);"
try:
    check(scalar("select count(*) from public.communication_outbox where state in ('pending','claimed');")=='0','No unrelated claimable work')
    sql(f"insert into auth.users(id,email,raw_user_meta_data) values('{actor}','outbox-retry-{actor}@example.test','{{}}');insert into public.user_roles(user_id,role) values('{actor}','ADMIN');")
    client=scalar('begin;'+staff+f"select (public.save_client(auth.uid(),null,null,'Synthetic','Retry',null,'{actor}@example.test','EMAIL',null,null)).id;commit;");ids.append(client)
    sql(f"insert into public.conversations(id,client_id) values('{conversation}','{client}');")
    outbox,work_hash=prepare_failure();action=str(uuid.uuid4())
    contended(staff+retry(action,outbox,work_hash),staff+retry(action,outbox,work_hash),lambda code,out,err:code==0)
    check(scalar(f"select count(*) from public.outbox_retry_actions where outbox_id='{outbox}';")=='1','Concurrent exact retry produces one immutable action')
    sql(f"update public.communication_outbox set state='failed' where id='{outbox}';")
    old_revision=int(scalar(f"select revision from public.communication_outbox where id='{outbox}';"))
    # Receipt recovery does not depend on state eligibility, including a new failure.
    scalar('begin;'+staff+retry(action,outbox,work_hash)+'commit;')
    check(scalar(f"select state||':'||revision from public.communication_outbox where id='{outbox}';")==f'failed:{old_revision}','Late reply leaves second failure untouched')
    outbox2,hash2=prepare_failure();action2,loser=[str(uuid.uuid4()) for _ in range(2)]
    contended(staff+retry(action2,outbox2,hash2),staff+retry(loser,outbox2,hash2),lambda code,out,err:code!=0 and 'Retry work changed' in err)
    check(scalar(f"select count(*) from public.outbox_retry_actions where outbox_id='{outbox2}';")=='1','Competing review commits one action')
    sql(f"update public.communication_outbox set state='failed' where id='{outbox2}';")
    outbox3,hash3=prepare_failure()
    contended(f"update public.clients set primary_email='changed@example.test' where id='{client}';",staff+retry(str(uuid.uuid4()),outbox3,hash3),lambda code,out,err:code!=0 and 'Retry work changed' in err)
    check(scalar(f"select state from public.communication_outbox where id='{outbox3}';")=='failed','Contact change prevents stale review requeue')
    sql(f"update public.clients set primary_email='{actor}@example.test' where id='{client}';")
    outbox4,hash4=prepare_failure()
    # Two transitions in the same transaction share now(), but revision still advances twice.
    contended(f"update public.communication_outbox set state='pending' where id='{outbox4}';update public.communication_outbox set state='failed' where id='{outbox4}';",staff+retry(str(uuid.uuid4()),outbox4,hash4),lambda code,out,err:code!=0 and 'Retry work changed' in err)
    check(scalar(f"select count(*) from public.outbox_retry_actions where outbox_id='{outbox4}';")=='0','Later same-clock failure cannot reuse old review')
    # Retry must serialize with an audited provider attempt even if a historical counter is absent.
    outbox5,hash5=prepare_failure()
    contended(f"select id from public.communication_outbox where id='{outbox5}' for update;insert into public.communication_attempts(outbox_id,lease_token,attempt_number) values('{outbox5}',gen_random_uuid(),1);",staff+retry(str(uuid.uuid4()),outbox5,hash5),lambda code,out,err:code!=0 and 'Retry work changed' in err)
    check(scalar(f"select state from public.communication_outbox where id='{outbox5}';")=='failed','New provider evidence remains failed and cannot be requeued')
    check(scalar(f"select count(*) from public.communication_attempts a join public.communication_outbox o on o.id=a.outbox_id where o.client_id='{client}';")=='1','Only explicit synthetic evidence exists; retry creates no provider attempts')
finally:
    if owned_sessions:
        names=','.join(quote(name) for name in owned_sessions)
        sql(f"select pg_terminate_backend(pid) from pg_stat_activity where application_name in ({names}) and pid<>pg_backend_pid();")
    for query in [f"select id from public.communication_outbox where client_id='{client}';",f"select id from public.conversations where client_id='{client}';",f"select message_id from public.communication_outbox where client_id='{client}';"]:
        ids.extend(sql(query).stdout.strip().splitlines())
    patterns=','.join(quote('%'+item+'%') for item in set(ids) if item)
    sql(f"""begin;set local session_replication_role=replica;
    do $cleanup$ declare t record;begin for t in select schemaname,tablename from pg_tables where schemaname='public' loop
    execute format('delete from %I.%I r where to_jsonb(r)::text like any ($1)',t.schemaname,t.tablename) using array[{patterns}];end loop;end $cleanup$;
    delete from auth.users where id='{actor}';commit;""")
    check(scalar(f"select count(*) from public.communication_outbox where client_id='{client}';")=='0','Owned fixture cleanup verified')
print(f'Local outbox retry concurrency: {checks} checks passed; no provider requests.')
