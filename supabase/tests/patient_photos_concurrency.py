"""Observe real PostgreSQL waits for photo selection, replay and verified-byte deletion."""
import argparse
import json
from pathlib import Path
import subprocess
import time
import tomllib
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--run-synthetic-local', action='store_true')
parser.add_argument('--project-config', required=True, type=Path)
args = parser.parse_args()
if not args.run_synthetic_local:
    parser.error('Explicit --run-synthetic-local required')
config = args.project_config.resolve()
project = tomllib.loads(config.read_text())['project_id']
container = 'supabase_db_' + project
labels = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]['Config']['Labels']
assert labels['com.supabase.cli.project'] == project
assert Path(labels['com.supabase.cli.workdir']).resolve() == config.parent.parent
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']

def sql(query):
    result = subprocess.run(command, input=query, text=True, capture_output=True, timeout=25)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()

actor, client = str(uuid.uuid4()), str(uuid.uuid4())
sql(f"""insert into auth.users(id,email,raw_user_meta_data) values('{actor}','photo-race-{actor}@example.test','{{}}');
update profiles set is_active=true where id='{actor}';insert into user_roles(user_id,role) values('{actor}','STAFF');
insert into clients(id,first_name,last_name,full_name,primary_phone,primary_email) values('{client}','Photo','Race','Photo Race','+13035559201','photo-race@example.test');""")

def auth(role='authenticated'):
    claims = json.dumps({'role': role, **({'sub': actor} if role == 'authenticated' else {})})
    return f"set local role {role};select set_config('request.jwt.claims','{claims}',true);"

def patient():
    pet = str(uuid.uuid4())
    sql(f"insert into pets(id,client_id,name,species) values('{pet}','{client}','Synthetic photo race','Dog');")
    return pet

processes = []
def race(first_query, second_query, role='authenticated', expected_failure=None):
    first = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    processes.append(first)
    first.stdin.write(f"begin;set local statement_timeout='20s';{auth(role)}{first_query};\n\\echo PHOTO_FIRST_READY\n")
    first.stdin.flush()
    while True:
        line = first.stdout.readline()
        if 'PHOTO_FIRST_READY' in line:
            break
        if not line:
            raise RuntimeError(first.stderr.read())
    name = 'photo-wait-' + uuid.uuid4().hex
    second = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    processes.append(second)
    second.stdin.write(f"begin;set application_name='{name}';set local statement_timeout='20s';{auth()}{second_query};commit;\n")
    second.stdin.close()
    deadline = time.monotonic() + 10
    observed = False
    while time.monotonic() < deadline:
        if sql(f"select count(*) from pg_stat_activity where application_name='{name}' and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0;") == '1':
            observed = True
            break
        if second.poll() is not None:
            break
        time.sleep(0.05)
    assert observed, 'Second operation must demonstrably wait on first transaction'
    first.stdin.write('commit;\n');first.stdin.close()
    assert first.wait(timeout=25) == 0, first.stderr.read()
    code = second.wait(timeout=25)
    if expected_failure:
        assert code != 0
        assert expected_failure in second.stderr.read()
    else:
        assert code == 0, second.stderr.read()

try:
    pet = patient()
    first_action, second_action = str(uuid.uuid4()), str(uuid.uuid4())
    race(f"select set_patient_photo('{first_action}','{pet}',null,0)", f"select set_patient_photo('{second_action}','{pet}',null,0)", expected_failure='Photo changed')
    assert sql(f"select version from patient_photo_state where pet_id='{pet}';") == '1'
    assert sql(f"select count(*) from patient_photo_actions where pet_id='{pet}';") == '1'
    pet = patient(); action = str(uuid.uuid4())
    race(f"select set_patient_photo('{action}','{pet}',null,0)", f"select set_patient_photo('{action}','{pet}',null,0)")
    assert sql(f"select version from patient_photo_state where pet_id='{pet}';") == '1'
    assert sql(f"select count(*) from patient_photo_actions where id='{action}';") == '1'
    pet = patient(); doc, obj = str(uuid.uuid4()), str(uuid.uuid4())
    sql(f"begin;{auth()}select prepare_patient_photo('{doc}','{pet}',0,repeat('a',64),100,'image/png');insert into storage.objects(id,bucket_id,name,metadata) select '{obj}','patient-documents',file_path,'{{\"size\":100,\"mimetype\":\"image/png\"}}'::jsonb from patient_documents where id='{doc}';commit;")
    race(f"select verify_patient_photo_bytes('{doc}','{actor}','{obj}',repeat('a',64),1,1)", f"set local storage.allow_delete_query='true';delete from storage.objects where id='{obj}'", role='service_role')
    assert sql(f"select count(*) from storage.objects where id='{obj}';") == '1'
    assert sql(f"select count(*) from patient_photo_uploads where document_id='{doc}' and verified_at is not null;") == '1'
    print('Observed PostgreSQL photo races passed: one stale-choice winner, one idempotent action, verified pending bytes retained.')
finally:
    for process in processes:
        if process.poll() is None:
            process.kill();process.wait(timeout=10)
    # Immutable synthetic action/document evidence remains only in the disposable stack.
