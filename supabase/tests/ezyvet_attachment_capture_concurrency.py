"""Observe attachment lock races in an owned schema-only local database.

No provider requests, physical file writes, hosted changes or foundation mutations.
"""
import argparse
import json
from pathlib import Path
import subprocess
import time
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--project-config', type=Path)
args = parser.parse_args()
project = 'livingroom-vet-foundation'
if args.project_config:
    import tomllib
    with args.project_config.open('rb') as handle:
        project = tomllib.load(handle)['project_id']
container = 'supabase_db_' + project
labels = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]['Config']['Labels']
assert labels['com.supabase.cli.project'] == project
base = ['docker', 'exec', '-i', container, 'psql', '-U', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-d']
database = 'lrv_attachment_race_' + uuid.uuid4().hex
marker = 'owned-' + uuid.uuid4().hex
checks = 0
processes = []

def sql(query, db=None, fail=True):
    result = subprocess.run(base + [db or database], input=query, text=True, capture_output=True, timeout=30)
    if fail and result.returncode:
        raise AssertionError(result.stderr)
    return result

def scalar(query, db=None):
    return sql(query, db).stdout.strip().splitlines()[-1]

def check(value, message):
    global checks
    assert value, message
    checks += 1

def quote(value):
    return "'" + str(value).replace("'", "''") + "'"

def wait_for(query, description):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if scalar(query) == 't':
            return
        time.sleep(.03)
    raise AssertionError(description)

def contend(holder_query, waiter_query, expected_error, during_wait=None):
    tag = 'attachment_' + uuid.uuid4().hex
    holder = subprocess.Popen(base + [database], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    processes.append(holder)
    holder.stdin.write(f"set application_name='{tag}_holder';set statement_timeout='15s';begin;{holder_query}\n")
    holder.stdin.flush()
    wait_for(f"select exists(select 1 from pg_stat_activity where datname='{database}' and application_name='{tag}_holder' and state='idle in transaction');", 'Holder did not acquire locks')
    waiter = subprocess.Popen(base + [database], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    processes.append(waiter)
    waiter.stdin.write(f"set application_name='{tag}_waiter';set statement_timeout='15s';begin;{waiter_query}commit;\n")
    waiter.stdin.close()
    wait_for(f"select exists(select 1 from pg_stat_activity w join pg_stat_activity h on h.pid=any(pg_blocking_pids(w.pid)) where w.datname='{database}' and w.application_name='{tag}_waiter' and h.application_name='{tag}_holder' and w.wait_event_type='Lock');", 'Exact waiter was not blocked by exact holder')
    check(True, 'Observed exact holder via pg_blocking_pids')
    if during_wait:
        during_wait()
    holder.stdin.write('commit;\n')
    holder.stdin.close()
    holder.wait(timeout=20)
    waiter.wait(timeout=20)
    check(holder.returncode == 0, holder.stderr.read())
    error = waiter.stderr.read()
    if expected_error is None:
        check(waiter.returncode == 0, error)
    else:
        check(waiter.returncode != 0 and expected_error in error, 'Expected '+expected_error+', got '+error+' / '+waiter.stdout.read())

created = False
try:
    dump = subprocess.check_output(['docker', 'exec', container, 'pg_dump', '-U', 'postgres', '--schema-only', '--no-owner', '--schema=public', '--schema=auth', '--schema=storage', '--schema=extensions', 'postgres'])
    sql(f'create database {database};', 'postgres'); created = True
    sql(f"comment on database {database} is '{marker}';", 'postgres')
    sql('drop schema public;create schema extensions;create extension pgcrypto with schema extensions;create extension "uuid-ossp" with schema extensions;')
    dump = dump.replace(b'CREATE SCHEMA extensions;', b'CREATE SCHEMA IF NOT EXISTS extensions;')
    dump = b"\n".join(line for line in dump.splitlines() if not line.startswith(b'ALTER DEFAULT PRIVILEGES'))
    restored = subprocess.run(base + [database], input=dump, capture_output=True, timeout=60)
    check(restored.returncode == 0, restored.stderr.decode())
    migration_dir = Path(__file__).resolve().parents[1] / 'migrations'
    pending = [
      ('20260913520000',"to_regclass('public.ezyvet_vaccination_runs')"),
      ('20260913530000',"to_regclass('public.ezyvet_imported_vaccinations')"),
      ('20260913540000',"to_regprocedure('public.preview_record_release_v7(uuid,uuid,text,text,jsonb)')"),
      ('20260913550000',"to_regclass('public.ezyvet_prescription_runs')"),
      ('20260913560000',"to_regclass('public.ezyvet_prescriptionitem_runs')"),
      ('20260913570000',"to_regprocedure('public.ezyvet_reconcile_prescription_items(jsonb,jsonb,boolean)')"),
      ('20260913580000',"to_regprocedure('public.ezyvet_prescription_source_context(uuid,uuid)')"),
      ('20260913590000',"to_regclass('public.ezyvet_prescription_review_requests')"),
      ('20260913600000',"to_regprocedure('public.ezyvet_prescription_interpretation_context(jsonb,jsonb)')"),
      ('20260913610000',"to_regclass('public.ezyvet_imported_prescriptions')"),
      ('20260913620000',"to_regprocedure('public.get_ezyvet_prescription_review_candidate(uuid,uuid)')"),
      ('20260913630000',"to_regprocedure('public.ezyvet_validate_reviewed_prescriptions(uuid,jsonb)')"),
      ('20260913640000',"to_regprocedure('public.preview_record_release_v8(uuid,uuid,text,text,jsonb)')"),
    ]
    pending += [
        ('20260913650000', "to_regclass('public.ezyvet_attachment_runs')"),
        ('20260913660000', "to_regclass('public.ezyvet_attachment_download_requests')"),
        ('20260913670000', "to_regclass('public.ezyvet_attachment_download_attempts')"),
        ('20260913680000', "to_regclass('public.ezyvet_attachment_captures')"),
        ('20260913690000', "to_regclass('public.ezyvet_attachment_cleanup_attempts')"),
    ]
    for version, probe in pending:
        if scalar(f'select {probe} is null;') == 't':
            paths = list(migration_dir.glob(version + '_*'))
            assert len(paths) == 1, version
            sql(paths[0].read_text())
    # A fully migrated source clone has the tables but no bucket data. Pending
    # migration replay may already have inserted it; either starting state works.
    sql("insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('ezyvet-attachments','ezyvet-attachments',false,20971520,array['application/pdf','image/jpeg','image/png']) on conflict(id) do nothing;")
    check(scalar("select not public and file_size_limit=20971520 and allowed_mime_types=array['application/pdf','image/jpeg','image/png'] from storage.buckets where id='ezyvet-attachments';") == 't', 'Private fixture bucket matches capture contract')
    fixture = Path(__file__).with_name('ezyvet_attachment_capture.test.sql').read_text().split('-- FIXTURE_BEGIN:')[1].split('select throws_ok(')[0]
    fixture = '\n'.join(fixture.splitlines()[1:])
    for index, scenario in enumerate(['reserve-source-expiry', 'complete-source-expiry', 'complete-object-expiry', 'upload-role-loss', 'cleanup-role-loss', 'cleanup-expiry'], 1):
        prefix = f'db569{index:03d}'
        actor = prefix + '-0000-4000-8000-000000000001'
        current = fixture.replace('db560000', prefix).replace('prescriptionitem-test-site', scenario).replace('@example.test', '@' + scenario + '.example.test')
        current = current.replace("where s.resource='attachment' and s.external_id='701'", "where s.resource='attachment' and s.external_id='701' and s.source_site_uid='" + scenario + "'")
        setup = current + "update ezyvet_import_runs set retry_after=null,lease_until=null where id=(select id from fx where k='run');insert into data select 'lease',pg_temp.claim();"
        if scenario != 'reserve-source-expiry':
            setup += "insert into data select 'intent',pg_temp.reserve();"
        if scenario.startswith(('complete-', 'cleanup-')):
            setup += "insert into storage.objects(bucket_id,name,owner,metadata) select 'ezyvet-attachments',v->>'object_path','"+actor+"',jsonb_build_object('size',37,'mimetype','application/pdf') from data where k='intent';"
        saved = json.loads(scalar("begin;set local search_path=public,extensions;" + setup + "select jsonb_build_object('fx',(select jsonb_object_agg(k,id) from fx),'data',(select jsonb_object_agg(k,v) from data));commit;"))
        fx, data = saved['fx'], saved['data']
        request, lease = fx['request'], data['lease']['lease_id']
        request_hash = data['saved']['request']['request_hash']
        metadata = quote(json.dumps(data['saved']['request']['source_context']['attachment_metadata'])) + '::jsonb'
        identity = ','.join(map(quote, [request, actor, lease, request_hash]))
        source_lock = f"select 1 from ezyvet_identity_heads where source_site_uid='{scenario}' and resource='attachment' for update;"
        if scenario.startswith('cleanup-'):
            sql(f"alter table ezyvet_attachment_download_attempts disable trigger immutable_attachment_worker;update ezyvet_attachment_download_attempts set created_at=clock_timestamp()-interval '10 minutes',lease_until=clock_timestamp()-interval '5 minutes' where lease_id='{lease}';alter table ezyvet_attachment_download_attempts enable trigger immutable_attachment_worker;")
            staff = "set local role authenticated;select set_config('request.jwt.claims'," + quote(json.dumps({'sub': actor, 'role': 'authenticated'})) + ",true);"
            sql('begin;' + staff + f"select abandon_ezyvet_attachment_download('{request}','{fx['pet']}',true);commit;")
            sql(f"alter table ezyvet_attachment_download_requests disable trigger immutable_attachment_download;update ezyvet_attachment_download_requests set resolved_at=clock_timestamp()-interval '5 minutes' where id='{request}';alter table ezyvet_attachment_download_requests enable trigger immutable_attachment_download;")
            cleanup = str(uuid.uuid4())
            sql(f"select claim_ezyvet_attachment_cleanup('{cleanup}','{request}','{actor}','{fx['pet']}','{request_hash}');")
            path = quote(data['intent']['object_path'])
            holder = f"select pg_advisory_xact_lock(hashtextextended('{request}',6600));"
            # Metadata-only disposable transaction; mirror Storage's own delete flag.
            operation = f"set local storage.allow_delete_query='true';delete from storage.objects where bucket_id='ezyvet-attachments' and name={path};"
            if scenario == 'cleanup-expiry':
                sql(f"alter table ezyvet_attachment_cleanup_attempts disable trigger immutable_attachment_cleanup;update ezyvet_attachment_cleanup_attempts set created_at=clock_timestamp()-interval '1 minute',lease_until=clock_timestamp()+interval '3 seconds' where id='{cleanup}';alter table ezyvet_attachment_cleanup_attempts enable trigger immutable_attachment_cleanup;")
                during = lambda: wait_for(f"select lease_until<=clock_timestamp() from ezyvet_attachment_cleanup_attempts where id='{cleanup}';", 'Cleanup lease did not expire')
            else:
                during = lambda: sql(f"delete from user_roles where user_id='{actor}' and role='ADMIN';")
            contend(holder, staff + operation, None, during)
            check(scalar(f"select count(*) from storage.objects where bucket_id='ezyvet-attachments' and name={path};") == '1', 'Ineligible cleanup leaves reserved object intact')
            check(scalar(f"select count(*) from ezyvet_attachment_cleanup_receipts where cleanup_id='{cleanup}';") == '0', 'Ineligible cleanup has no success receipt')
        elif scenario.endswith('expiry'):
            # Owner-only disposable fixture clock, with a real elapsed deadline after an observed wait.
            sql(f"alter table ezyvet_attachment_download_attempts disable trigger immutable_attachment_worker;update ezyvet_attachment_download_attempts set created_at=clock_timestamp()-interval '1 minute',lease_until=clock_timestamp()+interval '3 seconds' where lease_id='{lease}';alter table ezyvet_attachment_download_attempts enable trigger immutable_attachment_worker;")
            if scenario == 'reserve-source-expiry':
                operation = f"select prepare_ezyvet_attachment_capture({identity},repeat('a',64),37,'application/pdf',{metadata},{metadata});"
                holder = source_lock
            else:
                intent = data['intent']
                operation = f"select complete_ezyvet_attachment_capture({identity},'{intent['intent_hash']}',repeat('a',64),37,'application/pdf',{metadata});"
                holder = source_lock if scenario == 'complete-source-expiry' else f"select 1 from storage.objects where bucket_id='ezyvet-attachments' and name={quote(intent['object_path'])} for update;"
            contend(holder, 'set local role service_role;' + operation, 'Capture worker lease changed', lambda: wait_for(f"select lease_until<=clock_timestamp() from ezyvet_attachment_download_attempts where lease_id='{lease}';", 'Fixture lease did not expire'))
            check(scalar(f"select count(*) from ezyvet_attachment_captures where request_id='{request}';") == '0', 'Expired worker cannot create capture')
            if scenario == 'reserve-source-expiry':
                check(scalar(f"select count(*) from ezyvet_attachment_capture_intents where request_id='{request}';") == '0', 'Expired worker cannot reserve path')
        else:
            path = quote(data['intent']['object_path'])
            holder = f"select pg_advisory_xact_lock(hashtextextended('{request}',6600));"
            staff = "set local role authenticated;select set_config('request.jwt.claims'," + quote(json.dumps({'sub': actor, 'role': 'authenticated'})) + ",true);"
            operation = f"insert into storage.objects(bucket_id,name,owner,metadata) values('ezyvet-attachments',{path},'{actor}',jsonb_build_object('size',37,'mimetype','application/pdf'));"
            contend(holder, staff + operation, 'row-level security policy', lambda: sql(f"delete from user_roles where user_id='{actor}' and role='ADMIN';"))
            check(scalar(f"select count(*) from storage.objects where bucket_id='ezyvet-attachments' and name={path};") == '0', 'Revoked owner cannot commit upload after waiting')
        print('Observed attachment race:', scenario, flush=True)
finally:
    if created:
        check(scalar(f"select shobj_description(oid,'pg_database') from pg_database where datname='{database}';", 'postgres') == marker, 'Owned database marker matches')
        for process in processes:
            if process.stdin and not process.stdin.closed:
                process.stdin.close()
        sql(f"select pg_terminate_backend(pid) from pg_stat_activity where datname='{database}' and pid<>pg_backend_pid();", 'postgres')
        for process in processes:
            process.wait(timeout=20)
            for stream in (process.stdin, process.stdout, process.stderr):
                if stream and not stream.closed:
                    stream.close()
        sql(f'drop database {database};', 'postgres')
        check(scalar(f"select count(*) from pg_database where datname='{database}';", 'postgres') == '0', 'Owned database removed')
        print('Owned attachment scratch database removed.', flush=True)
print(f'Attachment capture concurrency: {checks} checks passed.')
