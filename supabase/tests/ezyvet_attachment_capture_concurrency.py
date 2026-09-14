"""Observe attachment lock races in an owned schema-only local database.

No provider requests, physical file writes, hosted changes or foundation mutations.
"""
import base64
import hashlib
import re
import argparse
import json
from pathlib import Path
import subprocess
import time
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--project-config', type=Path)
approval_scenarios = ['approval-request-role-loss', 'approval-source-role-loss', 'approval-object-role-loss', 'approval-chain-role-loss', 'approval-competing-corrections', 'approval-source-change-first', 'approval-before-source-change', 'cancel-before-approval', 'approval-before-cancel', 'cancel-role-loss']
release_scenarios = ['release-email-worker-source-first', 'release-email-worker-before-source', 'release-email-capture-source-first', 'release-email-capture-before-source', 'release-email-source-first', 'release-email-before-source', 'release-source-first', 'release-before-source', 'release-parent-first', 'release-before-parent', 'release-mapping-first', 'release-before-mapping', 'release-native-first', 'release-before-native', 'release-correction-first', 'release-before-correction', 'release-request-role-loss', 'release-chain-role-loss', 'release-replay-role-loss', 'release-read-role-loss']
parser.add_argument('--scenario', choices=approval_scenarios + release_scenarios + ['prepare-request-role-loss', 'prepare-source-role-loss', 'abandon-request-role-loss', 'abandon-tombstone-role-loss', 'scan-request-role-loss', 'scan-source-role-loss'])
parser.add_argument('--skip-authorization-fix', action='store_true', help='Reproduce the old authorization bug in the owned disposable clone only')
parser.add_argument('--skip-release-access-fix', action='store_true', help='Reproduce pre8000 access waits in an owned clone when the source lacks8000; never revert an existing fix')
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
    holder.stdin.write(f"\\o /dev/null\nset application_name='{tag}_holder';set statement_timeout='15s';begin;{holder_query}\n")
    holder.stdin.flush()
    wait_for(f"select exists(select 1 from pg_stat_activity where datname='{database}' and application_name='{tag}_holder' and state='idle in transaction');", 'Holder did not acquire locks')
    waiter = subprocess.Popen(base + [database], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    processes.append(waiter)
    waiter.stdin.write(f"\\o /dev/null\nset application_name='{tag}_waiter';set statement_timeout='15s';begin;{waiter_query}commit;\n")
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
        check(waiter.returncode != 0 and expected_error in error, 'Expected '+expected_error+', got '+(error.strip() or f'no database error (exit {waiter.returncode})'))

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
        ('20260913700000', "to_regprocedure('public.get_ezyvet_attachment_animal_parent(uuid)')"),
        ('20260913710000', "to_regprocedure('public.prepare_ezyvet_attachment_scan(uuid,uuid,text,uuid,text,integer)')"),
    ]
    if not args.skip_authorization_fix:
        pending.append(('20260913720000', "case when obj_description('public.prepare_ezyvet_attachment_download(uuid,uuid,uuid,integer,uuid,text,integer)'::regprocedure,'pg_proc')='Rechecks active administrator after request and source waits.' then true else null end"))
    pending.append(('20260913730000', "to_regclass('public.ezyvet_attachment_record_versions')"))
    pending.append(('20260913750000', "to_regclass('public.ezyvet_attachment_approval_cancellations')"))
    pending += [('20260913770000', "to_regprocedure('public.ezyvet_validate_release_attachments(uuid,jsonb)')"), ('20260913780000', "to_regprocedure('public.preview_record_release_v9(uuid,uuid,text,text,jsonb)')"), ('20260913790000', "to_regprocedure('public.list_record_release_sources_v9(uuid,integer)')")]

    if not args.skip_release_access_fix:
        pending.append(('20260913800000', "case when obj_description('public.read_record_release(uuid)'::regprocedure,'pg_proc')='Rechecks active staff after release/source waits.' and obj_description('public.confirm_record_release(uuid,uuid,uuid,text,text,jsonb,jsonb,text,boolean)'::regprocedure,'pg_proc')='Rechecks active staff after operation waits and before returning.' then true else null end"))
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
    for index, scenario in enumerate(['reserve-source-expiry', 'complete-source-expiry', 'complete-object-expiry', 'upload-role-loss', 'cleanup-role-loss', 'cleanup-expiry', 'prepare-request-role-loss', 'prepare-source-role-loss', 'abandon-request-role-loss', 'abandon-tombstone-role-loss', 'scan-request-role-loss', 'scan-source-role-loss'] + approval_scenarios + release_scenarios, 1):
        if args.scenario and scenario != args.scenario:
            continue
        prefix = f'db569{index:03d}'
        actor = prefix + '-0000-4000-8000-000000000001'
        current = fixture.replace('db560000', prefix).replace('prescriptionitem-test-site', scenario).replace('@example.test', '@' + scenario + '.example.test')
        current = current.replace("where s.resource='attachment' and s.external_id='701'", "where s.resource='attachment' and s.external_id='701' and s.source_site_uid='" + scenario + "'")
        original_bytes = b'%PDF-1.7\n' + b'x' * 22 + b'\n%%EOF'
        assert len(original_bytes) == 37
        original_digest = hashlib.sha256(original_bytes).hexdigest() if scenario.startswith('release-') else 'a' * 64
        if scenario.startswith('release-'):
            current = current.replace("sha text default repeat('a',64)", "sha text default '" + original_digest + "'")
        setup = current + "update ezyvet_import_runs set retry_after=null,lease_until=null where id=(select id from fx where k='run');insert into data select 'lease',pg_temp.claim();"
        if scenario != 'reserve-source-expiry':
            setup += "insert into data select 'intent',pg_temp.reserve();"
        if scenario.startswith(('complete-', 'cleanup-', 'approval-', 'cancel-', 'release-')):
            setup += "insert into storage.objects(bucket_id,name,owner,metadata) select 'ezyvet-attachments',v->>'object_path','"+actor+"',jsonb_build_object('size',37,'mimetype','application/pdf') from data where k='intent';"
        saved = json.loads(scalar("begin;set local search_path=public,extensions;" + setup + "select jsonb_build_object('fx',(select jsonb_object_agg(k,id) from fx),'data',(select jsonb_object_agg(k,v) from data));commit;"))
        fx, data = saved['fx'], saved['data']
        request, lease = fx['request'], data['lease']['lease_id']
        request_hash = data['saved']['request']['request_hash']
        metadata = quote(json.dumps(data['saved']['request']['source_context']['attachment_metadata'])) + '::jsonb'
        identity = ','.join(map(quote, [request, actor, lease, request_hash]))
        source_lock = f"select 1 from ezyvet_identity_heads where source_site_uid='{scenario}' and resource='attachment' for update;"
        if scenario.startswith('release-'):
            intent = data['intent']
            capture = json.loads(scalar(f"select to_jsonb(complete_ezyvet_attachment_capture({identity},'{intent['intent_hash']}','{original_digest}',37,'application/pdf',{metadata}));"))
            approval, correction, release_id = (str(uuid.uuid4()) for _ in range(3))
            staff = "set local role authenticated;select set_config('request.jwt.claims'," + quote(json.dumps({'sub': actor, 'role': 'authenticated'})) + ",true);"
            def release_approve(operation_id, previous=None):
                return f"select approve_ezyvet_attachment_record('{operation_id}','{request}','{fx['pet']}','{capture['capture_hash']}',{quote(previous) if previous else 'null'},'Synthetic API source','Synthetic original inspection',true);"
            sql('begin;' + staff + release_approve(approval) + 'commit;')
            sql(f"insert into record_release_policy(id,enabled,accepted_by,accepted_at,acceptance_reference,accepted_schema_version) values(true,true,'{actor}',now(),'Synthetic observed race only',9) on conflict(id) do update set enabled=true,accepted_schema_version=9;")
            selection = quote(json.dumps({'api_attachment_ids': [approval], 'patient_summary_ids': [fx['pet']]})) + '::jsonb'
            recipient = scalar(f"select primary_email from clients where id='{fx['client']}';")
            arguments = f"'{fx['pet']}','{fx['client']}','EMAIL',{quote(recipient)},{selection}"
            preview = json.loads(scalar('begin;' + staff + f"select preview_record_release_v9({arguments});commit;"))
            check(len(preview['snapshot']['api_attachments']) == 1 and len(preview['snapshot']['patient_summaries']) == 1, 'Race uses mixed selected API and native patient evidence')
            confirm = staff + f"select confirm_record_release('{release_id}',{arguments},{quote(json.dumps(preview['snapshot']))}::jsonb,'{preview['source_hash']}',true);"
            change = f"update ezyvet_identity_heads set version=version+1 where source_site_uid='{scenario}' and resource='attachment';"
            error = 'Current latest same-patient API approval required'
            if 'parent' in scenario:
                change = f"update ezyvet_identity_heads set version=version+1 where source_site_uid='{scenario}' and resource='animal';"
                error = 'SOURCE_ATTACHMENT_PARENT_STALE'
            elif 'mapping' in scenario:
                change = f"update ezyvet_record_links set external_id='99' where id='{fx['mapping']}';"
                error = 'Attachment animal parent mismatch'
            elif 'native' in scenario:
                change = f"update pets set name=name||' changed' where id='{fx['pet']}';"
                error = 'Release sources or recipient changed'
            elif 'correction' in scenario:
                change = staff + release_approve(correction, approval)
            if scenario.startswith('release-email-'):
                sql('begin;' + confirm + 'commit;')
                conversation, email_request = str(uuid.uuid4()), str(uuid.uuid4())
                existing = scalar(f"select coalesce(min(id::text),'none') from conversations where client_id='{fx['client']}' and status='ACTIVE';")
                existing = None if existing == 'none' else existing
                conversation = existing or conversation
                if not existing:
                    sql(f"insert into conversations(id,client_id) values('{conversation}','{fx['client']}');")
                prepare = staff + f"select prepare_release_email('{email_request}','{release_id}','{conversation}','Synthetic race','Synthetic reviewed API original','{preview['source_hash']}');"
                capture_operation = None
                if 'capture-' in scenario or 'worker-' in scenario:
                    sql('begin;' + prepare + 'commit;')
                    doc = preview['snapshot']['attachments'][0]
                    stem = re.sub(r'[^A-Za-z0-9 _.-]', '_', re.sub(r'\.[^.]*$', '', doc['file_name'])).strip(' .')[:100] or 'record'
                    payload = json.dumps({'from': 'care@example.test', 'reply_to': 'care@example.test', 'to': [recipient], 'subject': 'Synthetic race', 'text': 'Synthetic reviewed API original', 'attachments': [
                        {'filename': 'medical-records-' + release_id + '.html', 'content_type': 'text/html', 'content': base64.b64encode(b'<html>Synthetic concurrency report</html>').decode()},
                        {'filename': '1-' + stem + '.pdf', 'content_type': 'application/pdf', 'content': base64.b64encode(original_bytes).decode()}
                    ]})
                    service = "set local role service_role;select set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);"
                    capture_operation = service + f"select capture_release_email_payload('{email_request}','{actor}',{quote(payload)});"
                if 'worker-' in scenario:
                    sql('begin;' + capture_operation + 'commit;')
                    payload_hash = scalar(f"select payload_hash from release_email_payloads where request_id='{email_request}';")
                    queued = json.loads(scalar('begin;' + staff + f"select to_jsonb(enqueue_release_email('{email_request}','{payload_hash}',true));commit;"))
                    claimed = json.loads(scalar('begin;' + service + 'select to_jsonb(claim_communication());commit;'))
                    check(claimed['id'] == queued['id'], 'Worker claims exact synthetic reviewed email')
                    config = quote(json.dumps({'from': 'care@example.test', 'reply_to': 'care@example.test'}))
                    start = service + f"select start_communication_attempt('{queued['id']}','{claimed['lease_token']}',{config}::jsonb);"
                    if scenario.endswith('source-first'):
                        contend(change, start, None)
                        check(scalar(f"select state||':'||attempt_count::text from communication_outbox where id='{queued['id']}';") == 'failed:0', 'Source change wins lock race and prevents worker attempt')
                        check(scalar(f"select count(*) from communication_attempts where outbox_id='{queued['id']}';") == '0', 'Rejected worker start leaves no provider attempt receipt')
                    else:
                        contend(start, change, None)
                        check(scalar(f"select state||':'||attempt_count::text from communication_outbox where id='{queued['id']}';") == 'claimed:1', 'Earlier authorized start retains one recorded attempt')
                        check(scalar(f"select count(*) from communication_attempts where outbox_id='{queued['id']}';") == '1', 'Later source change does not erase the earlier attempt receipt')
                    check(scalar(f"select exists(select 1 from record_release_events where release_id='{release_id}' and kind='source_changed');") == 't', 'Source revision appends release invalidation evidence')
                elif capture_operation:
                    if scenario.endswith('source-first'):
                        contend(change, capture_operation, 'Release, household or recipient is no longer eligible')
                        check(scalar(f"select count(*) from release_email_payloads where request_id='{email_request}';") == '0', 'Earlier source revision prevents payload capture')
                    else:
                        contend(capture_operation, change, None)
                        check(scalar(f"select count(*) from release_email_payloads where request_id='{email_request}';") == '1', 'Earlier valid payload capture remains immutable after source change')
                        payload_hash = scalar(f"select payload_hash from release_email_payloads where request_id='{email_request}';")
                        queue = sql('begin;' + staff + f"select enqueue_release_email('{email_request}','{payload_hash}',true);commit;", fail=False)
                        check(queue.returncode != 0 and 'eligible' in queue.stderr, 'Changed source prevents queueing an earlier captured payload: ' + queue.stderr)
                elif scenario.endswith('source-first'):
                    contend(change, prepare, 'Release is not eligible for this household recipient')
                    check(scalar(f"select count(*) from release_email_requests where id='{email_request}';") == '0', 'Earlier source revision prevents email preparation')
                else:
                    contend(prepare, change, None)
                    check(scalar(f"select count(*) from release_email_requests where id='{email_request}';") == '1', 'Earlier preparation preserves its exact durable request')
                    rejected = sql(f"set role service_role;select set_config('request.jwt.claims','{{\"role\":\"service_role\"}}',false);select release_email_capture_context('{email_request}','{actor}');", fail=False)
                    check(rejected.returncode != 0 and ('not eligible' in rejected.stderr or 'no longer eligible' in rejected.stderr), 'Later source revision prevents capture of the prepared email: ' + rejected.stderr)
                check(scalar(f"select source_hash='{preview['source_hash']}' from record_releases where id='{release_id}';") == 't', 'Email ordering never rewrites the reviewed release')
            elif scenario.endswith('role-loss'):
                expected_rows = 0
                waiter = confirm
                holder = f"select pg_advisory_xact_lock(hashtextextended('{release_id}',13));"
                if scenario == 'release-chain-role-loss':
                    holder = f"select pg_advisory_xact_lock(hashtextextended('{fx['mapping']}:701',7301));"
                elif scenario in ['release-replay-role-loss', 'release-read-role-loss']:
                    sql('begin;' + confirm + 'commit;'); expected_rows = 1
                    if scenario == 'release-read-role-loss':
                        holder = f"select 1 from record_releases where id='{release_id}' for update;"
                        waiter = staff + f"select read_record_release('{release_id}');"
                contend(holder, waiter, 'Active staff access required', lambda: sql(f"delete from user_roles where user_id='{actor}';"))
                check(scalar(f"select count(*) from record_releases where id='{release_id}';") == str(expected_rows), 'Revoked staff cannot create another release or rewrite existing release')
            elif scenario.endswith('-first'):
                contend(change, confirm, error)
                check(scalar(f"select count(*) from record_releases where id='{release_id}';") == '0', 'Earlier source/review/native change rejects stale mixed confirmation')
            else:
                contend(confirm, change, None)
                check(scalar(f"select source_hash='{preview['source_hash']}' and snapshot#>>'{{api_attachments,0,record,id}}'='{approval}' from record_releases where id='{release_id}';") == 't', 'Earlier confirmation preserves exact reviewed snapshot and approval')
                check(scalar(f"select exists(select 1 from record_release_events where release_id='{release_id}' and kind='source_changed');") == 't', 'Later change appends a source invalidation event')
                eligible = json.loads(scalar('begin;' + staff + f"select read_record_release('{release_id}');commit;"))
                check(eligible['eligible'] is False, 'Changed mixed release is no longer eligible')
            check(scalar(f"select status='captured' from ezyvet_attachment_download_requests where id='{request}';") == 't', 'Release race never rewrites captured source request')
        elif scenario.startswith(('approval-', 'cancel-')):

            intent = data['intent']
            capture = json.loads(scalar(f"select to_jsonb(complete_ezyvet_attachment_capture({identity},'{intent['intent_hash']}',repeat('a',64),37,'application/pdf',{metadata}));"))
            approval = str(uuid.uuid4())
            staff = "set local role authenticated;select set_config('request.jwt.claims'," + quote(json.dumps({'sub': actor, 'role': 'authenticated'})) + ",true);"
            def approve(operation_id, previous=None):
                predecessor = quote(previous) if previous else 'null'
                return f"select approve_ezyvet_attachment_record('{operation_id}','{request}','{fx['pet']}','{capture['capture_hash']}',{predecessor},'Synthetic approved original','Synthetic original inspection',true);"
            operation = staff + approve(approval)
            cancel = staff + f"select cancel_ezyvet_attachment_approval('{approval}','{request}','{fx['pet']}','{capture['capture_hash']}',true);"
            if scenario == 'cancel-before-approval':
                contend(cancel, operation, 'Approval was canceled')
                check(scalar(f"select count(*) from ezyvet_attachment_record_versions where id='{approval}';") == '0', 'Earlier cancellation prevents late approval')
                check(scalar(f"select count(*) from ezyvet_attachment_approval_cancellations where id='{approval}';") == '1', 'Cancellation remains permanently recorded')
            elif scenario == 'approval-before-cancel':
                contend(operation, cancel, None)
                check(scalar(f"select count(*) from ezyvet_attachment_record_versions where id='{approval}';") == '1', 'Earlier approval survives later cancellation')
                check(scalar(f"select count(*) from ezyvet_attachment_approval_cancellations where id='{approval}';") == '0', 'Committed approval cannot also become canceled')
            elif scenario == 'cancel-role-loss':
                contend(f"select pg_advisory_xact_lock(hashtextextended('{approval}',7300));", cancel, 'Active administrator required', lambda: sql(f"delete from user_roles where user_id='{actor}' and role='ADMIN';"))
                check(scalar(f"select count(*) from ezyvet_attachment_approval_cancellations where id='{approval}';") == '0', 'Role loss during wait prevents cancellation')
            elif scenario.endswith('role-loss'):
                if scenario == 'approval-request-role-loss':
                    holder = f"select pg_advisory_xact_lock(hashtextextended('{approval}',7300));"
                elif scenario == 'approval-source-role-loss':
                    holder = source_lock
                elif scenario == 'approval-chain-role-loss':
                    holder = f"select pg_advisory_xact_lock(hashtextextended('{fx['mapping']}:701',7301));"
                else:
                    holder = f"select 1 from storage.objects where bucket_id='ezyvet-attachments' and name={quote(intent['object_path'])} for update;"
                contend(holder, operation, 'Active administrator required', lambda: sql(f"delete from user_roles where user_id='{actor}' and role='ADMIN';"))
                check(scalar(f"select count(*) from ezyvet_attachment_record_versions where id='{approval}';") == '0', 'Role loss prevents a saved clinical approval after observed lock wait')
            elif scenario == 'approval-competing-corrections':
                original, winner = str(uuid.uuid4()), str(uuid.uuid4())
                sql('begin;' + staff + approve(original) + 'commit;')
                contend(staff + approve(winner, original), staff + approve(approval, original), 'Review latest attachment version before correction')
                check(scalar(f"select count(*) from ezyvet_attachment_record_versions where animal_link_id='{fx['mapping']}';") == '2', 'Only one correction commits against the same predecessor')
                check(scalar(f"select previous_record_id='{original}' and version=2 from ezyvet_attachment_record_versions where id='{winner}';") == 't', 'Winning correction retains exact predecessor and version')
            else:
                change = f"update ezyvet_identity_heads set version=version+1 where source_site_uid='{scenario}' and resource='attachment';"
                if scenario == 'approval-source-change-first':
                    contend(change, operation, 'SOURCE_ATTACHMENT_STALE')
                    check(scalar(f"select count(*) from ezyvet_attachment_record_versions where id='{approval}';") == '0', 'Earlier source revision prevents approval of stale observation')
                else:
                    contend(operation, change, None)
                    check(scalar(f"select (v.source_context->>'attachment_observed_head_version')::integer < h.version from ezyvet_attachment_record_versions v join ezyvet_identity_heads h on h.source_origin=v.source_origin and h.source_site_uid=v.source_site_uid and h.resource='attachment' and h.external_id=v.attachment_external_id where v.id='{approval}';") == 't', 'Later source change preserves the earlier approved source version')
            check(scalar(f"select status='captured' from ezyvet_attachment_download_requests where id='{request}';") == 't', 'Approval race never rewrites the captured request')
        elif scenario.startswith(('prepare-', 'abandon-', 'scan-')):
            staff = "set local role authenticated;select set_config('request.jwt.claims'," + quote(json.dumps({'sub': actor, 'role': 'authenticated'})) + ",true);"
            selected = data['saved']['request']['request_payload']
            target = request if scenario in ('prepare-request-role-loss', 'abandon-request-role-loss') else str(uuid.uuid4())
            holder = f"select pg_advisory_xact_lock(hashtextextended('{target}',6600));"
            if scenario.startswith('prepare-'):
                operation = f"select prepare_ezyvet_attachment_download('{target}','{fx['pet']}','{selected['run_id']}',{selected['page']},'{selected['snapshot_id']}','{selected['payload_hash']}',{selected['observed_head_version']});"
                if scenario == 'prepare-source-role-loss': holder = source_lock
            elif scenario.startswith('abandon-'):
                if scenario == 'abandon-request-role-loss':
                    holder = f"select 1 from ezyvet_attachment_download_requests where id='{target}' for update;"
                # Resolve the active worker so the role check is the decisive guard.
                sql(f"select fail_ezyvet_attachment_download('{request}','{actor}','{lease}','{request_hash}','STORAGE_UNAVAILABLE',5);")
                operation = f"select abandon_ezyvet_attachment_download('{target}','{fx['pet']}',true);"
            else:
                parent = data['saved']['request']['source_context']['parent']
                holder = f"select pg_advisory_xact_lock(hashtextextended('attachment-run:{target}',0));"
                if scenario == 'scan-source-role-loss':
                    holder = f"select 1 from ezyvet_identity_heads where source_site_uid='{scenario}' and resource='animal' for update;"
                operation = f"select prepare_ezyvet_attachment_scan('{target}','{fx['mapping']}','Animal','{parent['parent_snapshot_id']}','{parent['parent_payload_hash']}',{parent['parent_observed_head_version']});"
            contend(holder, staff + operation, 'Active administrator required', lambda: sql(f"delete from user_roles where user_id='{actor}' and role='ADMIN';"))
            if target == request:
                check(scalar(f"select status from ezyvet_attachment_download_requests where id='{target}';") == 'pending', 'Role loss preserves existing pending request')
            elif scenario.startswith('scan-'):
                check(scalar(f"select count(*) from ezyvet_import_runs where id='{target}';") == '0', 'Role loss leaves no prepared scan')
            else:
                check(scalar(f"select count(*) from ezyvet_attachment_download_requests where id='{target}';") == '0', 'Role loss leaves no new request or tombstone')
        elif scenario.startswith('cleanup-'):
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
