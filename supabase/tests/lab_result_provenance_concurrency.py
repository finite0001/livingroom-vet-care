"""Actual local PostgreSQL contention; synthetic fixtures only, never provider calls."""
import argparse
from pathlib import Path
import concurrent.futures
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
product = str(uuid.uuid4())
ids = [actor, client, product]
origin = 'https://thelivingroom.vet'
created_profile = False
account = ''
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

try:
    source,pet=[str(uuid.uuid4()) for _ in range(2)];ids.extend([source,pet])
    sql(f"insert into auth.users(id,email,raw_user_meta_data) values('{actor}','lab-{actor}@example.test','{{}}');insert into public.user_roles(user_id,role) values('{actor}','ADMIN');")
    client=sql(f"begin;{staff}select (public.save_client(auth.uid(),null,null,'Synthetic','Lab',null,null,'EMAIL',null,null)).id;commit;").stdout.strip().splitlines()[-1];ids.append(client)
    pet=sql(f"begin;{staff}select (public.save_patient(null,'{client}',null,'Synthetic','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null)).id;commit;").stdout.strip().splitlines()[-1];ids.append(pet)
    sql(f"begin;{staff}select public.review_lab_source_account('{source}','Synthetic source','Manual account','Training','No provider connection');commit;")
    for scenario in ['competing_report','native_edit','void_first']:
        order,mapping=[str(uuid.uuid4()) for _ in range(2)];ids.extend([order,mapping])
        sql(f"""begin;{staff}
        select public.save_patient_lab_order('{order}','{pet}',null,'{{"test_name":"Synthetic lab","status":"planned","notes":"Keep native notes"}}','');
        select public.review_lab_order_source('{mapping}','{order}','{pet}',1,'{source}','patient-ref','order-ref',null,'Reviewed identity',true);commit;""")
        reports=[]
        for _ in range(2):
            doc,receipt,report=[str(uuid.uuid4()) for _ in range(3)];ids.extend([doc,receipt,report])
            sql(f"""begin;{staff}
            select public.prepare_patient_document('{doc}','{pet}',null,'synthetic.pdf','application/pdf',12,'lab_result','Synthetic metadata-only fixture',null,'internal');
            reset role;
            insert into storage.objects(bucket_id,name,metadata) select 'patient-documents',file_path,'{{"size":12,"mimetype":"application/pdf"}}' from public.patient_documents where id='{doc}';
            select public.finalize_patient_document('{doc}');
            select public.stage_lab_report_receipt('{receipt}','{source}','{doc}',2,'patient-ref','order-ref','report-ref',now());
            select public.capture_lab_report_bytes('{receipt}','{actor}',(select receipt_hash from public.lab_report_receipts where id='{receipt}'),2,repeat('a',64),12,'application/pdf');commit;""")
            hashes=json.loads(sql(f"select jsonb_build_object('receipt',receipt_hash,'capture',capture_hash) from public.lab_report_byte_captures where receipt_id='{receipt}';").stdout)
            link=staff+f"select public.link_lab_report_version('{report}','{receipt}','{hashes['receipt']}','{hashes['capture']}','{order}','{pet}',1,'{mapping}',null,'original','Reviewed original',true);"
            reports.append((doc,link))
        if scenario=='competing_report':
            contended(reports[0][1],reports[1][1],lambda code,out,err:code!=0 and 'Report history changed' in err)
            check(sql(f"select count(*) from public.lab_report_versions where order_id='{order}';").stdout.strip()=='1','Concurrent promotion preserves one original report head')
        elif scenario=='native_edit':
            edit=staff+f"select public.save_patient_lab_order('{order}','{pet}',1,'{{\"test_name\":\"Synthetic lab\",\"status\":\"planned\",\"notes\":\"New clinician notes\"}}','');"
            contended(edit,reports[0][1],lambda code,out,err:code!=0 and 'Lab order changed' in err)
            check(sql(f"select count(*) from public.lab_report_versions where order_id='{order}';").stdout.strip()=='0','Native edit winner prevents stale report promotion')
        else:
            void=staff+f"select public.void_patient_document('{reports[0][0]}',2,'Synthetic wrong report');"
            contended(void,reports[0][1],lambda code,out,err:code!=0 and 'no longer ready' in err)
            check(sql(f"select count(*) from public.lab_report_versions where order_id='{order}';").stdout.strip()=='0','Voided private document cannot be promoted by waiting review')

finally:
    if owned_sessions:
        names = ','.join(quote(name) for name in owned_sessions)
        sql(f"select pg_terminate_backend(pid) from pg_stat_activity where application_name in ({names}) and pid<>pg_backend_pid();")
    # Only rows referencing this run's random fixture identifiers are removed.
    patterns = ','.join(quote('%' + item + '%') for item in set(ids))
    sql(f"""begin;set local session_replication_role=replica;
      do $cleanup$ declare t record;begin
      for t in select schemaname,tablename from pg_tables where schemaname='public' loop
      execute format('delete from %I.%I r where to_jsonb(r)::text like any ($1)',t.schemaname,t.tablename) using array[{patterns}];
      end loop;end $cleanup$;
      delete from storage.objects where bucket_id='patient-documents' and name like any(array[{patterns}]);
      delete from auth.users where id='{actor}';
      {f"delete from public.payment_provider_profiles where account_id='{account}';" if created_profile else ''}
      commit;""")
    check(sql(f"select count(*) from public.lab_report_versions where actor_id='{actor}';").stdout.strip() == '0', 'Owned grant fixture cleanup verified')
print(f'Local lab provenance concurrency: {checks} checks passed; no provider requests.')
