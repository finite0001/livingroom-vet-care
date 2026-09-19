"""Isolated two-session regression using a schema-only clone of the local test DB.
Run: python3 tests/clinical/verify-alert-locks.py
No application database reset, fixture writes, provider requests, or extra dependencies.
"""
import argparse
import os
from pathlib import Path
import subprocess
import time
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--project-config', type=Path, help='Derive the CI database container from this Supabase TOML project_id')
args = parser.parse_args()
container = os.environ.get('TREATMENT_ALERT_TEST_CONTAINER')
if not container and args.project_config:
    import tomllib
    with args.project_config.open('rb') as config_file:
        container = 'supabase_db_' + tomllib.load(config_file)['project_id']
container = container or 'supabase_db_livingroom-vet-foundation'
database = 'treatment_alert_race_' + uuid.uuid4().hex[:16]
base = ['docker', 'exec', '-i', container, 'psql', '-U', 'supabase_admin', '-v', 'ON_ERROR_STOP=1', '-qAt']

def sql(query, db=database, check=True):
    return subprocess.run(base + ['-d', db], input=query, text=True, capture_output=True, check=check)

actor = "set local role authenticated; select set_config('request.jwt.claims','{\"sub\":\"34000000-0000-4000-8000-000000000001\",\"role\":\"authenticated\"}',true);"
reader = None
writer = None
created = False
try:
    schema = subprocess.run(['docker', 'exec', container, 'pg_dump', '-U', 'supabase_admin', '--schema-only', '--no-owner', 'postgres'], capture_output=True, text=True, check=True).stdout
    sql(f'create database {database};', 'postgres')
    created = True
    sql(schema)
    fixture = Path('supabase/tests/inventory_billing.test.sql').read_text().split('select lives_ok($$select public.record_patient_treatment')[0]
    sql(fixture + '\nreset role;create table race_ids as select * from fx;create table race_requests as select * from requests;grant select on race_ids,race_requests to authenticated;commit;')
    for label, mutation in [
        ('important problem', "select save_patient_problem(null,(select id from fx where k='pet'),null,'Concurrent reaction','Concurrent clinical update',(now() at time zone 'America/Denver')::date,'resolved','high');"),
        ('legacy allergy', "update pets set allergies='Concurrent legacy allergy' where id=(select id from fx where k='pet');"),
    ]:
        aliases = 'create temp table fx as select * from race_ids; create temp table requests as select * from race_requests; grant all on fx,requests to authenticated;'
        # Store a fresh reviewed request as the exact pre-race client payload.
        sql('begin;' + aliases + actor + "update requests set v=v||jsonb_build_object('alert_review',jsonb_build_object('source_hash',read_patient_treatment_alerts((v->>'pet_id')::uuid)->>'source_hash','acknowledged',true)) where k='live';reset role;update race_requests set v=(select v from requests where k='live') where k='live';commit;")
        reader = subprocess.Popen(base + ['-d', database], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        reader.stdin.write("set application_name='alert-lock-reader';begin;" + aliases + actor + "select read_patient_treatment_alerts((select id from fx where k='pet'));select pg_sleep(3);commit;")
        reader.stdin.close()
        deadline = time.monotonic() + 5
        while sql("select count(*) from pg_stat_activity where datname=current_database() and application_name='alert-lock-reader' and wait_event='PgSleep';").stdout.strip() != '1':
            if time.monotonic() > deadline: raise AssertionError('Reader did not acquire snapshot lock')
            time.sleep(.05)
        writer = subprocess.Popen(base + ['-d', database], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        writer.stdin.write("set application_name='alert-lock-writer';begin;" + aliases + (actor if label == 'important problem' else '') + mutation + 'commit;')
        writer.stdin.close()
        deadline = time.monotonic() + 2
        while sql("select count(*) from pg_stat_activity where datname=current_database() and application_name='alert-lock-writer' and wait_event_type='Lock';").stdout.strip() != '1':
            if time.monotonic() > deadline: raise AssertionError(label + ' did not wait for the reviewed snapshot lock')
            time.sleep(.05)
        assert reader.wait(timeout=6) == 0, reader.stderr.read()
        assert writer.wait(timeout=6) == 0, writer.stderr.read()
        attempted = sql('begin;' + aliases + actor + "select record_patient_treatment(gen_random_uuid(),(select v from requests where k='live'));commit;", check=False)
        assert attempted.returncode != 0 and 'Patient alerts changed' in attempted.stderr, attempted.stderr
        counts=sql('select count(*) from patient_treatments;select count(*) from billing_invoice_items;select sum(quantity) from inventory_movements;').stdout.strip().splitlines()
        assert list(map(float,counts)) == [0,0,10], counts
        print('PASS:', label, 'waited on snapshot lock; committed change rejected stale treatment before stock/billing writes')
except subprocess.CalledProcessError as error:
    print(error.stderr)
    raise
finally:
    if reader and reader.poll() is None: reader.kill()
    if writer and writer.poll() is None: writer.kill()
    if created:
        sql(f'drop database if exists {database} with (force);', 'postgres', check=False)
