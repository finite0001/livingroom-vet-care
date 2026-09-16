"""Owned disposable local PostgreSQL races for abandoned attachment cleanup; no provider calls."""
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
    tag = 'abandoned_cleanup_race_' + uuid.uuid4().hex
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
paths = []
service = "set local role service_role;select set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);"
staff = "set local role authenticated;select set_config('request.jwt.claims'," + quote(json.dumps({'sub': actor, 'role': 'authenticated'})) + ",true);"
def fixture(status='abandoned'):
    upload = str(uuid.uuid4()); fixture_ids.append(upload)
    path = f'{actor}/{conversation}/{upload}/original'; paths.append(path)
    sql(f"""insert into conversation_attachment_uploads(id,actor_id,conversation_id,file_name,mime_type,byte_length,storage_path,status,created_at)
      values('{upload}','{actor}','{conversation}','fixture.pdf','application/pdf',5,'{path}','{status}',now()-interval '8 days');
      insert into storage.objects(bucket_id,name,metadata,created_at) values('conversation-attachment-uploads','{path}','{{"size":5,"mimetype":"application/pdf"}}',now()-interval '8 days');""")
    return upload, path

def claim(upload):
    return f"select claim_abandoned_attachment_cleanup('{upload}',168);"
def prepare():
    upload, path = fixture()
    lease = json.loads(sql(f"begin;{service}{claim(upload)}commit;"))
    return upload, path, lease

def finalize(lease):
    return f"select finalize_abandoned_attachment_cleanup('{lease['id']}','{lease['token']}');"

def remove_fixture(path):
    sql(f"begin;set local storage.allow_delete_query='true';delete from storage.objects where bucket_id='conversation-attachment-uploads' and name='{path}';commit;")

try:
    sql(f"insert into auth.users(id,email,raw_user_meta_data) values('{actor}','cleanup-race-{actor}@example.test','{{}}');insert into user_roles(user_id,role) values('{actor}','ADMIN');")
    client = sql(f"begin;{staff}select (save_client(auth.uid(),null,null,'Cleanup','Race',null,null,'EMAIL',null,null)).id;commit;")
    fixture_ids.append(client)
    sql(f"insert into conversations(id,client_id) values('{conversation}','{client}');")
    upload, path = fixture()
    race(service + claim(upload), service + claim(upload), expected_state='40001')
    check(sql(f"select count(*) from abandoned_attachment_cleanup where upload_id='{upload}'") == '1', 'Concurrent claims persist one cleanup identity')

    upload, path = fixture('uploading')
    verify = f"select verify_conversation_attachment('{upload}','{actor}',5,'application/pdf',repeat('b',64));"
    race(service + verify, service + claim(upload), expected_state='42501')
    check(sql(f"select count(*) from abandoned_attachment_cleanup where upload_id='{upload}'") == '0', 'Verified upload never enters cleanup after lock wait')

    upload, path, lease = prepare()
    remove_fixture(path)
    race(service + finalize(lease), service + finalize(lease))
    check(sql(f"select state from abandoned_attachment_cleanup where id='{lease['id']}'") == 'complete', 'Duplicate completion recovers the same durable receipt')

    upload, path, lease = prepare()
    holder = f"select id from conversation_attachment_uploads where id='{upload}' for update;update abandoned_attachment_cleanup set expires_at=clock_timestamp()-interval '1 second' where id='{lease['id']}';{service}{claim(upload)}"
    race(holder, service + finalize(lease), expected_state='42501')
    check(sql(f"select state from abandoned_attachment_cleanup where id='{lease['id']}'") == 'claimed', 'Replaced worker cannot finalize cleanup')

    upload, path, lease = prepare()
    replacement = str(uuid.uuid4())
    holder = f"select id from conversation_attachment_uploads where id='{upload}' for update;set local storage.allow_delete_query='true';delete from storage.objects where bucket_id='conversation-attachment-uploads' and name='{path}';insert into storage.objects(id,bucket_id,name,metadata,created_at) values('{replacement}','conversation-attachment-uploads','{path}','{{\"size\":5,\"mimetype\":\"application/pdf\"}}',now());"
    race(holder, service + f"select revalidate_abandoned_attachment_cleanup('{lease['id']}','{lease['token']}');", expected_state='42501')
    check(sql(f"select id from storage.objects where bucket_id='conversation-attachment-uploads' and name='{path}'") == replacement, 'Changed object identity is retained for review')
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
      delete from storage.objects where bucket_id='conversation-attachment-uploads' and name=any(array[{','.join(quote(path) for path in paths)}]::text[]);
      delete from auth.users where id='{actor}';commit;""")
    check(sql(f"select count(*) from conversation_attachment_uploads where actor_id='{actor}'") == '0', 'Owned cleanup fixture reservations removed')
print(f'Abandoned attachment cleanup concurrency: {checks} checks passed. Synthetic SQL/Storage metadata only; no real file deletion.')
