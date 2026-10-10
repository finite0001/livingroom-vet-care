"""Observe real PostgreSQL waits for service completion retries and corrections."""
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

actor, client, pet, encounter, product = [str(uuid.uuid4()) for _ in range(5)]
sql(f"""insert into auth.users(id,email,raw_user_meta_data) values('{actor}','service-race-{actor}@example.test','{{}}');
update profiles set is_active=true,full_name='Synthetic service clinician' where id='{actor}';insert into user_roles(user_id,role) values('{actor}','STAFF');
insert into clients(id,first_name,last_name,full_name,primary_phone,primary_email) values('{client}','Service','Race','Service Race','+13035559209','service-race@example.test');
insert into pets(id,client_id,name,species) values('{pet}','{client}','Synthetic service race','Dog');""")
def auth(role='authenticated'):
    claims = json.dumps({'role': role, **({'sub': actor} if role == 'authenticated' else {})})
    return f"set local role {role};select set_config('request.jwt.claims','{claims}',true);"
sql(f"begin;select set_config('request.jwt.claims','{json.dumps({"sub":actor,"role":"authenticated"})}',true);insert into clinical_encounters(id,pet_id,visit_at,visit_type,created_by,updated_by) values('{encounter}','{pet}',now()-interval '1 day','clinic','{actor}','{actor}');insert into catalog_products(id,name,kind,unit,unit_price_cents,created_by) values('{product}','Synthetic service','service','visit',100,'{actor}');commit;")
from datetime import datetime, timezone, timedelta
request=json.dumps({'pet_id':pet,'encounter_id':encounter,'product_id':product,'clinician_id':actor,'performed_at':(datetime.now(timezone.utc)-timedelta(hours=1)).isoformat(),'notes':'Synthetic completed service','invoice_id':None})
def record(identity, payload=request):
    return f"select record_patient_service('{identity}','{payload}'::jsonb)"
processes = []
def race(first_query, second_query, role='authenticated', expected_failure=None):
    first = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    processes.append(first)
    first.stdin.write(f"begin;set local statement_timeout='20s';{auth(role)}{first_query};\n\\echo SERVICE_FIRST_READY\n")
    first.stdin.flush()
    while True:
        line = first.stdout.readline()
        if 'SERVICE_FIRST_READY' in line:
            break
        if not line:
            raise RuntimeError(first.stderr.read())
    name = 'service-wait-' + uuid.uuid4().hex
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
    event=str(uuid.uuid4())
    race(record(event),record(event))
    assert sql(f"select count(*) from patient_service_events where id='{event}';")=='1'
    changed=json.loads(request);changed['notes']='Changed under same event';changed=json.dumps(changed)
    other=str(uuid.uuid4())
    race(record(other),record(other,changed),expected_failure='Service identity already used')
    assert sql(f"select count(*) from patient_service_events where id='{other}';")=='1'
    correction=str(uuid.uuid4())
    command1=f"select correct_patient_service('{correction}','{pet}','{event}','Synthetic error',null)"
    race(command1,command1)
    assert sql(f"select count(*) from patient_service_corrections where service_event_id='{event}';")=='1'
    race(f"select correct_patient_service('{uuid.uuid4()}','{pet}','{other}','First correction',null)",f"select correct_patient_service('{uuid.uuid4()}','{pet}','{other}','Second correction',null)",expected_failure='duplicate key value')
    assert sql(f"select count(*) from patient_service_corrections where service_event_id='{other}';")=='1'
    archive=f"select save_patient('{pet}','{client}',1,'Synthetic service race','Dog',null,null,'unknown',null,'unknown','unknown',null,clock_timestamp(),null)"
    race(archive,record(str(uuid.uuid4())),expected_failure='Active patient required')
    print('Observed PostgreSQL service races passed: exact replay, payload drift, correction replay, conflicting corrections and patient archival.')
finally:
    for process in processes:
        if process.poll() is None:
            process.kill();process.wait(timeout=10)
    # Immutable synthetic evidence remains only in the explicitly selected disposable stack.
