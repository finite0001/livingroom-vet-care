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

try:
    sql(f"insert into auth.users(id,email,raw_user_meta_data) values('{actor}','external-{actor}@example.test','{{}}');update profiles set is_active=true where id='{actor}';insert into public.user_roles(user_id,role) values('{actor}','ADMIN');")
    client=sql(f"begin;{staff}select (public.save_client(auth.uid(),null,null,'Synthetic','External',null,null,'EMAIL',null,null)).id;commit;").stdout.strip().splitlines()[-1];ids.append(client)
    for scenario in ['competing_original','patient_edit_first','void_first','approval_first','competing_replacement']:
        pet=sql(f"begin;{staff}select (public.save_patient(null,'{client}',null,'Synthetic','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null)).id;commit;").stdout.strip().splitlines()[-1];ids.append(pet)
        snapshot,mapping=[str(uuid.uuid4()) for _ in range(2)];ids.extend([snapshot,mapping])
        sql(f"""insert into public.ezyvet_import_snapshots(id,source_origin,source_site_uid,resource,external_id,payload,payload_hash,first_seen_by) values('{snapshot}','https://api.trial.ezyvet.com','{mapping}','animal','77','{{"id":77}}','synthetic','{actor}');
        insert into public.ezyvet_record_links(id,request_id,request_hash,source_origin,source_site_uid,resource,external_id,snapshot_id,head_version,client_id,pet_id,local_version,action,reason,approved_by) values('{mapping}',gen_random_uuid(),'synthetic','https://api.trial.ezyvet.com','{mapping}','animal','77','{snapshot}',1,'{client}','{pet}',1,'link','Synthetic reviewed mapping','{actor}');""")
        reports=[]
        prior='null'
        for index in range(3 if scenario=='competing_replacement' else 2):
            doc,receipt,record=[str(uuid.uuid4()) for _ in range(3)];ids.extend([doc,receipt,record])
            sql(f"""begin;{staff}
            select public.prepare_patient_document('{doc}','{pet}',null,'synthetic.pdf','application/pdf',12,'medical_record','Synthetic metadata-only fixture',null,'internal');
            reset role;
            insert into storage.objects(bucket_id,name,metadata) select 'patient-documents',file_path,'{{"size":12,"mimetype":"application/pdf"}}' from public.patient_documents where id='{doc}';
            select public.finalize_patient_document('{doc}');
            select public.stage_external_record_receipt('{receipt}','{mapping}',1,'{doc}',2,'export-1',now(),{prior},'Reviewed manual export');
            select public.capture_external_record_bytes('{receipt}','{actor}',(select receipt_hash from public.external_record_receipts where id='{receipt}'),2,repeat('a',64),12,'application/pdf');commit;""")
            hashes=json.loads(sql(f"select jsonb_build_object('receipt',receipt_hash,'capture',capture_hash) from public.external_record_byte_captures where receipt_id='{receipt}';").stdout)
            approve=staff+f"select public.approve_external_record_import('{record}','{receipt}','{hashes['receipt']}','{hashes['capture']}',true);"
            if scenario=='competing_replacement' and index==0:
                sql('begin;'+approve+'commit;')
                prior=quote(record)
            else:
                reports.append((doc,approve))
        if scenario in ['competing_original','competing_replacement']:
            contended(reports[0][1],reports[1][1],lambda code,out,err:code!=0 and 'history changed' in err)
            expected='2' if scenario=='competing_replacement' else '1'
            check(sql(f"select count(*) from public.external_record_versions where animal_link_id='{mapping}';").stdout.strip()==expected,'One winner preserves exact original/replacement head')
        elif scenario=='patient_edit_first':
            edit=staff+f"select public.save_patient('{pet}','{client}',1,'Updated name','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null);"
            contended(edit,reports[0][1],lambda code,out,err:code!=0 and 'Patient changed' in err)
            check(sql(f"select count(*) from public.external_record_versions where animal_link_id='{mapping}';").stdout.strip()=='0','Patient edit prevents stale approval')
        elif scenario=='void_first':
            void=staff+f"select public.void_patient_document('{reports[0][0]}',2,'Synthetic wrong record');"
            contended(void,reports[0][1],lambda code,out,err:code!=0 and 'Document changed' in err)
            check(sql(f"select count(*) from public.external_record_versions where animal_link_id='{mapping}';").stdout.strip()=='0','Voided document cannot be approved')
        else:
            void=staff+f"select public.void_patient_document('{reports[0][0]}',2,'Synthetic subsequent void');"
            contended(reports[0][1],void,lambda code,out,err:code==0)
            check(sql(f"select count(*) from public.external_record_versions where animal_link_id='{mapping}';").stdout.strip()=='1','Approval remains attributable history after later void')
            check(sql(f"select status from public.patient_documents where id='{reports[0][0]}';").stdout.strip()=='void','Subsequent void remains visible')
finally:
    if owned_sessions:
        names=','.join(quote(name) for name in owned_sessions)
        sql(f"select pg_terminate_backend(pid) from pg_stat_activity where application_name in ({names}) and pid<>pg_backend_pid();")
    patterns=','.join(quote('%'+item+'%') for item in set(ids))
    sql(f"""begin;set local session_replication_role=replica;
    do $cleanup$ declare t record;begin for t in select schemaname,tablename from pg_tables where schemaname='public' loop
    execute format('delete from %I.%I r where to_jsonb(r)::text like any ($1)',t.schemaname,t.tablename) using array[{patterns}];end loop;end $cleanup$;
    delete from storage.objects where bucket_id='patient-documents' and name like any(array[{patterns}]);
    delete from auth.users where id='{actor}';commit;""")
    check(sql(f"select count(*) from public.external_record_versions where actor_id='{actor}';").stdout.strip()=='0','Owned fixture cleanup verified')
print(f'Local external record provenance concurrency: {checks} checks passed; no provider requests.')
