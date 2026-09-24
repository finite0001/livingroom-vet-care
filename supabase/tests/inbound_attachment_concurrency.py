"""Owned disposable local PostgreSQL races for incoming attachment capture; no provider calls."""
import argparse
import json
from pathlib import Path
import subprocess
import time
import tomllib
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--project-config', required=True, type=Path)
parser.add_argument('--run-synthetic-local', action='store_true')
args = parser.parse_args()
if not args.run_synthetic_local:
    parser.error('Explicit --run-synthetic-local required for disposable fixture writes')
with args.project_config.open('rb') as source:
    project = tomllib.load(source)['project_id']
assert project and all(c.isalnum() or c in '_-' for c in project)
inspection = subprocess.run(['docker', 'inspect', 'supabase_db_' + project], capture_output=True, text=True, check=True)
assert json.loads(inspection.stdout)[0]['Config']['Labels']['com.supabase.cli.project'] == project
command = ['docker', 'exec', '-i', 'supabase_db_' + project, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']
checks = 0
processes = []
tags = []
def sql(query):
    result = subprocess.run(command, input=query, text=True, capture_output=True, timeout=30)
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip().splitlines()[-1] if result.stdout.strip() else ''
def quote(value):
    return "'" + str(value).replace("'", "''") + "'"
def check(condition, message):
    global checks
    assert condition, message
    checks += 1
def race(holder_query, waiter_query, expected_state=None):
    """Keep the holder transaction open until the exact waiter is observed blocked by it."""
    tag = 'incoming_capture_race_' + uuid.uuid4().hex
    tags.extend([tag + '_holder', tag + '_waiter'])
    holder = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    processes.append(holder)
    holder.stdin.write(f"set application_name='{tag}_holder';begin;{holder_query}\n")
    holder.stdin.flush()
    deadline = time.monotonic() + 30
    while sql(f"select count(*) from pg_stat_activity where application_name='{tag}_holder' and state='idle in transaction';") != '1':
        if holder.poll() is not None or time.monotonic() > deadline:
            raise AssertionError('Holder did not establish its transaction')
        time.sleep(.05)
    waiter = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    processes.append(waiter)
    waiter.stdin.write(f"set application_name='{tag}_waiter';begin;{waiter_query}commit;\n")
    waiter.stdin.close(); waiter.stdin = None
    while sql(f"select count(*) from pg_stat_activity w join pg_stat_activity h on h.pid=any(pg_blocking_pids(w.pid)) where w.application_name='{tag}_waiter' and h.application_name='{tag}_holder';") != '1':
        if waiter.poll() is not None or time.monotonic() > deadline:
            raise AssertionError('Did not observe the intended lock waiter')
        time.sleep(.05)
    check(True, 'Exact holder/waiter lock dependency observed')
    holder.stdin.write('commit;'); holder.stdin.close(); holder.stdin = None
    _, holder_error = holder.communicate(timeout=30)
    _, waiter_error = waiter.communicate(timeout=30)
    check(holder.returncode == 0, holder_error)
    check((waiter.returncode != 0 and expected_state in waiter_error) if expected_state else waiter.returncode == 0, waiter_error or 'Unexpected waiter outcome')

actor, client, conversation = [str(uuid.uuid4()) for _ in range(3)]
fixture_ids = [actor, client, conversation]
storage_paths = []
service = "set local role service_role;select set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);"
staff = "set local role authenticated;select set_config('request.jwt.claims'," + quote(json.dumps({'sub': actor, 'role': 'authenticated'})) + ",true);"
def fixture():
    incoming, message, event, email, attachment = [str(uuid.uuid4()) for _ in range(5)]
    fixture_ids.extend([incoming, message, event, email, attachment])
    meta = json.dumps([{'id': attachment, 'filename': 'race.pdf', 'content_type': 'application/pdf', 'size': 5}])
    sql(f"""begin;
      insert into messages(id,conversation_id,type,sender_type,content,is_internal) values('{message}','{conversation}','EMAIL','CLIENT','Synthetic capture race',false);
      insert into communication_provider_events(id,provider,event_id,resource_id,event_type,payload_hash,metadata,state) values('{event}','resend','{event}','{email}','inbound',repeat('a',64),'{{}}','processed');
      insert into communication_inbound(id,provider,resource_id,event_id,channel,sender,recipient,body,attachment_metadata,occurred_at,client_id,conversation_id,message_id)
      values('{incoming}','resend','{email}','{event}','EMAIL','race@example.test','care@example.test','Synthetic capture race',{quote(meta)}::jsonb,now(),'{client}','{conversation}','{message}');commit;""")
    return incoming, attachment

def claim(incoming, attachment):
    return f"select claim_inbound_attachment('{incoming}','{attachment}',1,'{actor}');"
def prepare():
    incoming, attachment = fixture()
    lease = json.loads(sql(f"begin;{service}{claim(incoming,attachment)}commit;"))['lease']
    storage_paths.append(lease['storage_path'])
    sql(f"insert into storage.objects(bucket_id,name,metadata) values('inbound-attachment-originals',{quote(lease['storage_path'])},'{{\"size\":5,\"mimetype\":\"application/pdf\"}}');")
    return incoming, attachment, lease

def finalize(lease):
    return f"select finalize_inbound_attachment('{lease['id']}','{actor}','{lease['token']}',repeat('b',64),5,'application/pdf');"

try:
    sql(f"insert into auth.users(id,email,raw_user_meta_data) values('{actor}','incoming-race-{actor}@example.test','{{}}');update profiles set is_active=true where id='{actor}';insert into user_roles(user_id,role) values('{actor}','ADMIN');")
    client = sql(f"begin;{staff}select (save_client(auth.uid(),null,null,'Incoming','Race',null,'race@example.test','EMAIL',null,null)).id;commit;")
    fixture_ids.append(client)
    sql(f"insert into conversations(id,client_id) values('{conversation}','{client}');")
    incoming, attachment = fixture()
    race(service + claim(incoming, attachment), service + claim(incoming, attachment), expected_state='40001')
    check(sql(f"select count(*) from inbound_attachment_captures where inbound_id='{incoming}'") == '1', 'Concurrent claims persist one lease')

    incoming, attachment, lease = prepare()
    race(service + finalize(lease), service + finalize(lease))
    check(sql(f"select count(*) from inbound_attachment_captures where inbound_id='{incoming}' and status='ready'") == '1', 'Concurrent matching finalizations retain one ready original')

    for operation in ['claim', 'finalize']:
        incoming, attachment, lease = prepare() if operation == 'finalize' else (*fixture(), None)
        holder = f"select id from communication_inbound where id='{incoming}' for update;update profiles set is_active=false where id='{actor}';"
        waiter = finalize(lease) if lease else claim(incoming, attachment)
        race(holder, service + waiter, expected_state='42501')
        check(sql(f"select count(*) from inbound_attachment_captures where inbound_id='{incoming}' and status='ready'") == '0', 'Revoked waiting worker cannot publish')
        sql(f"update profiles set is_active=true where id='{actor}';")

    incoming, attachment, lease = prepare()
    race(f"update communication_inbound set version=version+1 where id='{incoming}';", service + finalize(lease), expected_state='42501')
    check(sql(f"select status from inbound_attachment_captures where inbound_id='{incoming}'") == 'capturing', 'Changed inbound version fences waiting finalizer')

    incoming, attachment, lease = prepare()
    holder = f"select id from communication_inbound where id='{incoming}' for update;update inbound_attachment_captures set lease_expires_at=clock_timestamp()-interval '1 second' where id='{lease['id']}';{service}{claim(incoming,attachment)}"
    race(holder, service + finalize(lease), expected_state='42501')
    check(sql(f"select lease_token <> '{lease['token']}'::uuid from inbound_attachment_captures where id='{lease['id']}'") == 't', 'Replacement lease fences the waiting old worker')
finally:
    for process in processes:
        if process.poll() is None:
            if process.stdin and not process.stdin.closed:
                process.stdin.close(); process.stdin = None
            process.terminate(); process.wait(timeout=10)
    if tags:
        sql('select pg_terminate_backend(pid) from pg_stat_activity where application_name in (' + ','.join(quote(tag) for tag in tags) + ');')
    patterns = ','.join(quote('%' + value + '%') for value in set(fixture_ids))
    sql(f"""begin;set local session_replication_role=replica;
      do $cleanup$ declare t record;begin
        for t in select schemaname,tablename from pg_tables where schemaname='public' loop
          execute format('delete from %I.%I r where to_jsonb(r)::text like any ($1)',t.schemaname,t.tablename) using array[{patterns}];
        end loop;
      end $cleanup$;
      delete from storage.objects where bucket_id='inbound-attachment-originals' and name=any(array[{','.join(quote(path) for path in storage_paths)}]::text[]);
      delete from auth.users where id='{actor}';commit;""")
    check(sql(f"select count(*) from inbound_attachment_captures where actor_id='{actor}'") == '0', 'Owned incoming capture fixtures removed')
print(f'Incoming attachment concurrency: {checks} checks passed. Synthetic SQL/object metadata only; no provider or Storage-byte requests.')
