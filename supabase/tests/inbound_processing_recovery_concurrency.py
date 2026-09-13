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
ids = [actor]
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

def exhausted():
    resource=str(uuid.uuid4());ids.append(resource)
    # Every allowance is consumed by a real claim/release, with only the fixture backoff accelerated.
    result=sql(f"""begin;select set_config('request.jwt.claims','{{"role":"service_role"}}',true);
    do $fixture$ declare e public.communication_provider_events;i integer;begin
      e:=public.receive_communication_event('resend','{resource}','{resource}','inbound',repeat('a',64),'{{"from":"synthetic@example.test","to":"care@example.test"}}');
      for i in 1..10 loop
        e:=public.claim_communication_event();
        if e.resource_id<>'{resource}' then raise exception 'Unexpected shared queue work';end if;
        perform public.release_communication_event_outcome(e.id,e.lease_token,'provider_fetch_or_persistence_retry',false);
        update public.communication_provider_events set available_at=clock_timestamp() where id=e.id;
      end loop;
    end $fixture$;
    select id from public.communication_provider_events where resource_id='{resource}';commit;""")
    event=result.stdout.strip().splitlines()[-1];ids.append(event)
    preview=json.loads(sql('begin;'+staff+f"select public.preview_communication_event_retry('{event}');commit;").stdout.strip().splitlines()[-1])
    check(preview['eligible'],'Ten real generic releases enable reviewed retry')
    return event,preview['expected_work_hash']

try:
    check(sql("select count(*) from public.communication_provider_events where state in ('pending','claimed');").stdout.strip()=='0','Shared queue has no unrelated active work')
    sql(f"insert into auth.users(id,email,raw_user_meta_data) values('{actor}','processing-{actor}@example.test','{{}}');insert into public.user_roles(user_id,role) values('{actor}','ADMIN');")
    event,work_hash=exhausted()
    first_id,second_id=[str(uuid.uuid4()) for _ in range(2)];ids.extend([first_id,second_id])
    def retry(request,event,work_hash):
        return staff+f"select public.requeue_communication_event('{request}','{event}','{work_hash}','provider_recovered',true);"
    contended(retry(first_id,event,work_hash),retry(second_id,event,work_hash),lambda code,out,err:code!=0 and 'Processing work changed' in err)
    check(sql(f"select cycle_no from public.communication_provider_events where id='{event}';").stdout.strip()=='1','Competing retries create only one cycle')
    # Mark this owned pending event unavailable while constructing the next case.
    sql(f"update public.communication_provider_events set available_at=clock_timestamp()+interval '1 day' where id='{event}';")
    event2,hash2=exhausted();request2=str(uuid.uuid4());ids.append(request2)
    oldtoken=str(uuid.uuid4())
    service="set local role service_role;select set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);"
    # Completion takes the event lock before testing lease identity, so the stale caller actually waits.
    stale=service+f"select public.complete_inbound_communication('{event2}','{oldtoken}','synthetic@example.test','care@example.test','','Synthetic',null,null,'{{}}','[]',now(),null);"
    contended(retry(request2,event2,hash2),stale,lambda code,out,err:code!=0 and 'Provider event lease unavailable' in err)
    check(sql(f"select count(*) from public.communication_inbound where event_id='{event2}';").stdout.strip()=='0','Old worker cannot insert content after reviewed requeue')
    # A worker claim holds the row while another claim must skip it, not double-claim.
    tag='lrv_claim_'+uuid.uuid4().hex;owned_sessions.append(tag)
    holder=subprocess.Popen(COMMAND,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    holder.stdin.write(f"set application_name='{tag}';begin;{service}select (public.claim_communication_event()).id;select pg_sleep(2);commit;");holder.stdin.close()
    deadline=time.monotonic()+8
    while time.monotonic()<deadline:
        if sql(f"select count(*) from pg_stat_activity where application_name='{tag}' and wait_event='PgSleep';").stdout.strip()=='1':break
        time.sleep(.03)
    else:raise AssertionError('Claim lock holder not observed')
    result=sql('begin;'+service+'select public.claim_communication_event() is null;commit;').stdout.strip().splitlines()[-1]
    check(result=='t','Concurrent claim skips locked event rather than duplicating lease')
    holder.wait(timeout=10);check(holder.returncode==0,holder.stderr.read())
    check(sql(f"select cycle_attempts from public.communication_provider_events where id='{event2}';").stdout.strip()=='1','Exactly one claim consumes allowance')
    check(sql(f"select count(*) from public.communication_processing_history where event_id='{event2}' and action='claimed';").stdout.strip()=='11','Lifetime attempt history remains complete')
finally:
    if owned_sessions:
        names=','.join(quote(name) for name in owned_sessions)
        sql(f"select pg_terminate_backend(pid) from pg_stat_activity where application_name in ({names}) and pid<>pg_backend_pid();")
    patterns=','.join(quote('%'+item+'%') for item in set(ids))
    sql(f"""begin;set local session_replication_role=replica;
    do $cleanup$ declare t record;begin for t in select schemaname,tablename from pg_tables where schemaname='public' loop
    execute format('delete from %I.%I r where to_jsonb(r)::text like any ($1)',t.schemaname,t.tablename) using array[{patterns}];end loop;end $cleanup$;
    delete from auth.users where id='{actor}';commit;""")
    check(sql(f"select count(*) from public.communication_event_retry_actions where actor_id='{actor}';").stdout.strip()=='0','Owned fixture cleanup verified')
print(f'Local inbound processing concurrency: {checks} checks passed; no provider requests.')
