"""Owned disposable local PostgreSQL races for reviewed attachment emails; no provider calls."""
import argparse
import concurrent.futures
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
actor, client, conversation, upload = [str(uuid.uuid4()) for _ in range(4)]
staff = "set local role authenticated;select set_config('request.jwt.claims'," + quote(json.dumps({'sub': actor, 'role': 'authenticated'})) + ",true);"
service = "set local role service_role;select set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);"
fixture_ids = [actor, client, conversation, upload]
payload = json.dumps({'from': 'care@example.test', 'reply_to': 'care@example.test', 'to': ['race@example.test'], 'subject': 'Race', 'text': 'Review', 'attachments': [{'filename': 'race.pdf', 'content_type': 'application/pdf', 'content': 'JVBERi0='}]})
def capture(request):
    return f"select capture_conversation_email('{request}','{actor}',{quote(payload)});"
def resolve(request):
    return f"select resolve_message_request('{actor}','{request}','race:{request}',true);"
def queue(request):
    return f"select (enqueue_conversation_email('{request}',encode(sha256(convert_to({quote(payload)},'UTF8')),'hex'),true)).id;"
def prepare(captured=False):
    request = str(uuid.uuid4())
    fixture_ids.append(request)
    sql(f"begin;{staff}select prepare_conversation_email('{request}','race:{request}','{conversation}','race@example.test','Race','Review',array['{upload}'::uuid]);commit;")
    if captured:
        sql(f"begin;{service}{capture(request)}commit;")
    return request

def race(holder_query, waiter_query, rejected=False):
    """Keep the holder transaction open until the exact waiter is observed blocked by it."""
    tag = 'conversation_race_' + uuid.uuid4().hex
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
    check((waiter.returncode != 0 and '42501' in waiter_error) if rejected else waiter.returncode == 0, waiter_error or 'Unexpected waiter outcome')

try:
    sql(f"insert into auth.users(id,email,raw_user_meta_data) values('{actor}','race-{actor}@example.test','{{}}');insert into user_roles(user_id,role) values('{actor}','ADMIN');")
    client = sql(f"begin;{staff}select (save_client(auth.uid(),null,null,'Race','Fixture',null,'race@example.test','EMAIL',null,null)).id;commit;")
    fixture_ids.append(client)
    sql(f"insert into conversations(id,client_id) values('{conversation}','{client}');")
    sql(f"begin;{staff}select prepare_conversation_attachment('{upload}','{conversation}','race.pdf','application/pdf',5);commit;")
    sql(f"insert into storage.objects(bucket_id,name,metadata) select 'conversation-attachment-uploads',storage_path,'{{\"size\":5,\"mimetype\":\"application/pdf\"}}' from conversation_attachment_uploads where id='{upload}';")
    sql(f"begin;{service}select verify_conversation_attachment('{upload}','{actor}',5,'application/pdf',encode(sha256(convert_to('%PDF-','UTF8')),'hex'));commit;")
    request = prepare()
    race(staff + resolve(request), service + capture(request), rejected=True)
    check(sql(f"select payload_text is null from conversation_email_artifacts where request_id='{request}'") == 't', 'Abandonment prevents delayed capture')
    request = prepare()
    race(service + capture(request), staff + resolve(request))
    check(sql(f"select state from communication_prepared_requests where request_id='{request}'") == 'abandoned', 'Capture cannot bypass subsequent explicit abandonment')
    request = prepare(True)
    race(staff + queue(request), staff + resolve(request))
    check(sql(f"select state from communication_prepared_requests where request_id='{request}'") == 'acknowledged', 'Abandonment after queue acknowledges existing message')
    request = prepare(True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        ids = list(pool.map(lambda _: sql(f'begin;{staff}{queue(request)}commit;'), range(4)))
    check(len(set(ids)) == 1, 'Concurrent approved queue attempts return one outbox')
    check(sql(f"select count(*) from communication_outbox where request_id='{request}'") == '1', 'Exactly one concurrent message persisted')
    for operation in ['capture', 'queue']:
        request = prepare(operation == 'queue')
        holder = f"select pg_advisory_xact_lock(hashtextextended('{request}',914));update profiles set is_active=false where id='{actor}';"
        race(holder, (service + capture(request)) if operation == 'capture' else (staff + queue(request)), rejected=True)
        check(sql(f"select count(*) from communication_outbox where request_id='{request}'") == '0', 'Revoked actor cannot queue after waiting')
        if operation == 'capture':
            check(sql(f"select payload_text is null from conversation_email_artifacts where request_id='{request}'") == 't', 'Revoked actor cannot capture after waiting')
        sql(f"update profiles set is_active=true where id='{actor}';")

finally:
    for process in processes:
        if process.poll() is None:
            if process.stdin and not process.stdin.closed:
                process.stdin.close(); process.stdin = None
            process.terminate()
            process.wait(timeout=10)
    if tags:
        sql('select pg_terminate_backend(pid) from pg_stat_activity where application_name in (' + ','.join(quote(tag) for tag in tags) + ');')
    # Match only this run's random synthetic identities; retain unrelated local fixtures.
    patterns = ','.join(quote('%' + value + '%') for value in set(fixture_ids))
    sql(f"""begin;set local session_replication_role=replica;
      do $cleanup$ declare t record;begin
       for t in select schemaname,tablename from pg_tables where schemaname='public' loop
        execute format('delete from %I.%I r where to_jsonb(r)::text like any ($1)',t.schemaname,t.tablename) using array[{patterns}];
       end loop;
      end $cleanup$;
      delete from storage.objects where bucket_id='conversation-attachment-uploads' and name='{actor}/{conversation}/{upload}/original';
      delete from auth.users where id='{actor}';commit;""")
    check(sql(f"select count(*) from communication_outbox where created_by='{actor}'") == '0', 'Owned queue fixtures removed')
print(f'Conversation email concurrency: {checks} checks passed. Synthetic local SQL only; no provider requests.')
