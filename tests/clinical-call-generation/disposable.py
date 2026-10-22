"""Guarded call drafts in an owned local Auth/REST runtime. Synthetic fixtures only."""
import sys
import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import tempfile
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--run-synthetic-local', action='store_true', required=True)
parser.add_argument('--sql-only', action='store_true')
parser.add_argument('--evidence-prefix', default='clinical-calls-generation')
args = parser.parse_args()
assert re.fullmatch(r'clinical-calls-[a-z0-9-]{1,65}', args.evidence_prefix)
os.umask(0o077)
root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / 'scripts'))
from owned_canonical_bootstrap import bootstrap_inputs
bootstrap_hashes = bootstrap_inputs(root)
private = root / 'tmp'
private.mkdir(mode=0o700, exist_ok=True)
assert not list(private.glob(args.evidence_prefix + '-*')), 'Evidence prefix already exists; preserve earlier attempts'
log = (private / (args.evidence_prefix + '-commands.log')).open('x')
identity = 'lrv-call-generation-' + uuid.uuid4().hex[:10]
work = Path(tempfile.mkdtemp(prefix=identity + '-'))
project = work / 'project'
(project / 'supabase/migrations').mkdir(parents=True)
(project / 'supabase/tests').mkdir()
new_migration = root / 'supabase/migrations/20261018150000_clinical_call_quote_anchors.sql'
test = root / 'supabase/tests/clinical_call_note_generation.test.sql'
inputs = set((root / 'supabase/migrations').glob('*.sql')) | set((root / 'tests/clinical-call-generation').glob('*')) | {test}
if not args.sql_only:
    inputs |= set((root / 'supabase/functions/_shared').glob('clinical-call*.ts'))
    inputs |= set((root / 'src/hub/features/clinical/call-drafts').rglob('*'))
    inputs |= {root / name for name in ['src/hub/features/clinical/ClinicalWorkspace.tsx', 'src/hub/features/patients/PatientPage.tsx', 'supabase/functions/_shared/clinical-veterinary-context.ts', 'supabase/functions/_shared/clinical-note-model.ts', 'supabase/functions/_shared/clinical-audio-model.ts', 'package-lock.json']}
else:
    inputs = set((root / 'supabase/migrations').glob('*.sql')) | {test, Path(__file__).resolve()}
hashes = {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(inputs) if p.is_file()}
fixtures = test.read_text().split('-- BEGIN GUARDED CALL GENERATION FIXTURES\n', 1)[1].split('-- END GUARDED CALL GENERATION FIXTURES', 1)[0]
started = False
proof = None
checks = 0
waits = 0
last_wire = None
legacy_wire = {}


def run(argv, check=True, sensitive=False, **kwargs):
    result = subprocess.run(argv, cwd=root, text=True, capture_output=True,
                            timeout=kwargs.pop('timeout', 120), **kwargs)
    log.write('COMMAND ' + argv[0] + '\n' + ('[Owned inspection/status withheld]\n' if sensitive else result.stdout + result.stderr) + '\n')
    log.flush()
    if check and result.returncode:
        raise RuntimeError('Owned call-note proof failed; see private ' + str(log.name))
    return result


container = 'supabase_db_' + identity
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']


def sql(query, database='postgres', timeout=120):
    cmd = command.copy()
    cmd[cmd.index('-d') + 1] = database
    return run(cmd, input=query, timeout=timeout).stdout.strip()


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def check(actual, expected):
    global checks
    assert actual == expected, 'Owned source-boundary assertion failed; private fixture data withheld'
    checks += 1


def request(path, key, token, body=None):
    global last_wire
    headers = {'apikey': key, 'Authorization': 'Bearer ' + token}
    data = None if body is None else json.dumps(body).encode()
    if data is not None:
        headers['Content-Type'] = 'application/json'
    req = Request(status['API_URL'] + path, data=data, headers=headers)
    try:
        with urlopen(req, timeout=25) as response:
            raw = response.read()
            last_wire = {'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw), 'raw_body': raw.decode()}
            return response.status, json.loads(raw) if raw else None
    except HTTPError as error:
        raw = error.read()
        return error.code, json.loads(raw) if raw else None


def rpc(actor, name, values):
    code, data = request('/rest/v1/rpc/' + name, status['ANON_KEY'], actor['token'], values)
    if code != 200:
        raise RuntimeError(name + ' refused: ' + str(data.get('code') if isinstance(data, dict) else code))
    return data


def denied(actor, name, values, expected='PT403'):
    code, data = request('/rest/v1/rpc/' + name, status['ANON_KEY'], actor['token'], values)
    log.write(json.dumps({'rpc': name, 'http_status': code, 'error_code': data.get('code'), 'expected_error_code': expected}) + '\n')
    log.flush()
    check(code >= 400, True)
    check(data.get('code'), expected)
    check('Owner reports historical vomiting' in json.dumps(data), False)


def actor(role):
    email = 'synthetic-call-note-' + uuid.uuid4().hex + '@example.test'
    password = uuid.uuid4().hex + uuid.uuid4().hex
    code, created = request('/auth/v1/admin/users', status['SERVICE_ROLE_KEY'], status['SERVICE_ROLE_KEY'],
                            {'email': email, 'password': password, 'email_confirm': True})
    assert code in (200, 201), 'Owned Auth user creation failed'
    uid = created['id']
    sql("update profiles set is_active=true,full_name='Synthetic call-note operator'where id=" + quote(uid) +
        ";insert into user_roles(user_id,role)values(" + quote(uid) + ',' + quote(role) + ')on conflict do nothing;')
    code, signed = request('/auth/v1/token?grant_type=password', status['ANON_KEY'], status['ANON_KEY'], {'email': email, 'password': password})
    assert code == 200, 'Owned Auth login failed'
    token = signed['access_token']
    claims = json.loads(base64.urlsafe_b64decode(token.split('.')[1] + '=='))
    check(sql('select count(*)from auth.sessions where id=' + quote(claims['session_id']) + 'and user_id=' + quote(uid) + ';'), '1')
    return {'id': uid, 'token': token, 'session': claims['session_id'], 'claims': claims,
            'email': email, 'password': password, 'auth_session': signed}


def blocked_rpc(reader, name, values, lock_sql, mutation, expected, mutation_in_holder=False):
    global waits
    tag = 'call_generation_hold_' + uuid.uuid4().hex
    first = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        first.stdin.write('begin;set application_name=' + quote(tag) + ";set local statement_timeout='35s';" + lock_sql + '\n\\echo CALL_GENERATION_HOLD_READY\n')
        first.stdin.flush()
        while True:
            line = first.stdout.readline()
            if 'CALL_GENERATION_HOLD_READY' in line:
                break
            assert line, 'Owned holder failed before lock barrier'
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(request, '/rest/v1/rpc/' + name, status['ANON_KEY'], reader['token'], values)
            deadline = time.monotonic() + 12
            while time.monotonic() < deadline:
                count = sql("select count(*)from pg_stat_activity a where a.query like '%" + name + "%'and a.wait_event_type='Lock'and exists(select 1 from pg_stat_activity h where h.application_name=" + quote(tag) + 'and h.pid=any(pg_blocking_pids(a.pid)));')
                if count == '1':
                    waits += 1
                    break
                assert not future.done(), 'RPC returned before observing actual lock wait'
                time.sleep(.05)
            else:
                raise AssertionError('No actual call-generation lock wait observed')
            if mutation_in_holder:
                first.stdin.write(mutation + '\n')
            else:
                sql(mutation)
            first.stdin.write('commit;\n')
            first.stdin.close()
            check(first.wait(timeout=10), 0)
            code, data = future.result(timeout=25)
            log.write(json.dumps({'rpc': name, 'observed_wait': True, 'http_status': code,
                                  'error_code': data.get('code'), 'expected_error_code': expected}) + '\n')
            log.flush()
            check(code >= 400, True)
            check(data['code'], expected)
    finally:
        if first.poll() is None:
            first.kill()
            first.wait(timeout=10)


def actor_sql(a, expression, database='postgres'):
    output = sql('begin;set local role authenticated;select set_config(\'request.jwt.claims\',' + quote(json.dumps(a['claims'])) + ',true);select ' + expression + ';rollback;', database)
    return json.loads(output.splitlines()[-1])


try:
    for port in [65520, 65521, 65522, 65524, 65531]:
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', port))
    migrations = sorted((root / 'supabase/migrations').glob('*.sql'))
    assert len(migrations) == 206 and new_migration in migrations and migrations[-1].name == '20261022010000_controlled_secondary_review_private.sql'
    for migration in migrations:
        shutil.copy2(migration, project / 'supabase/migrations' / migration.name)
    for candidate in (root / 'supabase/tests').glob('clinical_call*.test.sql'):
        shutil.copy2(candidate, project / 'supabase/tests' / candidate.name)
    (project / 'supabase/config.toml').write_text(f'''project_id = "{identity}"
[api]
port = 65521
[db]
port = 65522
shadow_port = 65520
major_version = 17
[studio]
enabled = false
[analytics]
enabled = false
[inbucket]
port = 65524
[auth]
site_url = "http://127.0.0.1:65531"
enable_signup = false
[storage]
enabled = true
[edge_runtime]
enabled = false
''')
    print('Starting uniquely owned guarded call-generation runtime.', flush=True)
    run([sys.executable, '-B', str(root / 'scripts/owned_canonical_bootstrap.py'), '--run-synthetic-local', '--workdir', str(project), '--exclude', 'realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor', '--ignore-health-check'], timeout=600)
    started = True
    labels = json.loads(run(['docker', 'inspect', container], sensitive=True).stdout)[0]['Config']['Labels']
    assert labels['com.supabase.cli.project'] == identity and Path(labels['com.supabase.cli.workdir']).resolve() == project.resolve()
    run(['docker', 'exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], input='alter system set cron.launch_active_jobs=off;select pg_reload_conf();')
    result = run(['supabase', 'test', 'db', '--workdir', str(project)], timeout=420).stdout
    assert 'All tests successful.' in result
    summary = result[result.rfind('All tests successful.'):].strip()
    print(summary, flush=True)
    if not args.sql_only:
        status = json.loads(run(['supabase', 'status', '--workdir', str(project), '--output', 'json'], sensitive=True).stdout)
        check(status['API_URL'], 'http://127.0.0.1:65521')
        owner, reader, staff, raced = actor('ADMIN'), actor('ADMIN'), actor('STAFF'), actor('ADMIN')
        sql('insert into user_roles(user_id,role)values(' + quote(raced['id']) + ",'STAFF')on conflict do nothing;")
        sql("insert into clinical_call_policies(version,status,consent_text,retention_text,reviewed_by,reviewed_at)values(2,'approved','Synthetic only','Synthetic only'," + quote(owner['id']) + ",now());insert into clinical_call_note_policies(version,status,consent_text,retention_text,reviewed_by,reviewed_at)values(2,'approved','Synthetic only','Synthetic only'," + quote(owner['id']) + ",now());insert into clinical_note_policies(version,status,consent_text,soap_model,reviewed_by,reviewed_at)values(2,'approved','Synthetic only','gpt-6-luna'," + quote(owner['id']) + ',now());')
        fixture = json.loads(sql(fixtures + '\nselect pg_temp.cgn_base(' + quote(owner['id']) + ',' + quote(owner['session']) + ');').splitlines()[-1])
        fsql = quote(json.dumps(fixture)) + '::jsonb'
        source = json.loads(sql(fixtures + '\nselect to_jsonb(pg_temp.cgn_source(' + fsql + '));').splitlines()[-1])
        reserve_request = json.loads(sql(fixtures + '\nselect pg_temp.cgn_request(' + quote(source) + ');').splitlines()[-1])
        job, attempt, review_id = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
        read_args = {'p_actor_id': owner['id'], 'p_id': job}
        chart_before = json.loads(sql('select to_jsonb(e)from clinical_encounters e where id=' + quote(fixture['encounter']) + ';'))
        reserved = rpc(owner, 'reserve_clinical_call_note_v1', {**read_args, 'p_request': reserve_request})
        check(reserved['contract_version'], 'clinical-call-note-processing-v1')
        check(rpc(owner, 'reserve_clinical_call_note_v1', {**read_args, 'p_request': reserve_request}), reserved)
        attempt_request = {'job_id': job, 'retry_of': None, 'reason': '', 'ack_cost': False}
        claim_args = {'p_actor_id': owner['id'], 'p_id': attempt, 'p_request': attempt_request}
        claimed = rpc(owner, 'claim_clinical_call_note_v1', claim_args)
        check(claimed['state'], 'claimed')
        check(rpc(owner, 'claim_clinical_call_note_v1', claim_args), claimed)
        check(json.loads(sql('select to_jsonb(e)from clinical_encounters e where id=' + quote(fixture['encounter']) + ';')), chart_before)
        worker = {'token': status['SERVICE_ROLE_KEY']}
        work_args = {'p_job_id': job, 'p_attempt_id': attempt}
        check(rpc(worker, 'dispatch_clinical_call_note_v1', work_args), True)
        check(rpc(worker, 'dispatch_clinical_call_note_v1', work_args), False)
        result = json.loads(sql(fixtures + '\nselect pg_temp.cgn_result(' + quote(job) + ');').splitlines()[-1])
        complete = rpc(worker, 'finish_clinical_call_note_v1', {**work_args, 'p_result': result})
        check(rpc(worker, 'finish_clinical_call_note_v1', {**work_args, 'p_result': result}), complete)
        check(complete['proposal']['sections']['objective']['text'], '')
        check(complete['generation']['payload'], result['payload'])
        check(complete['generation']['manifest']['contract_version'], 'clinical-call-note-result-v2')
        check(complete['generation']['manifest']['provider_evidence'], result['provider_evidence'])
        legacy = json.loads(sql(fixtures + '\nselect pg_temp.cgn_seed_legacy(' + quote(job) + ');').splitlines()[-1])
        legacy_read_args = {'p_actor_id': owner['id'], 'p_id': legacy['job_id']}
        legacy_view = rpc(owner, 'read_clinical_call_note_processing_v1', legacy_read_args)
        check(legacy_view['generation']['manifest']['contract_version'], 'clinical-call-note-result-v1')
        check('provider_evidence' in legacy_view['generation']['manifest'], False)
        check(rpc(worker, 'finish_clinical_call_note_v1', {'p_job_id': legacy['job_id'], 'p_attempt_id': legacy['attempt_id'], 'p_result': legacy['result']}), legacy_view)
        denied(worker, 'finish_clinical_call_note_v1', {'p_job_id': legacy['job_id'], 'p_attempt_id': legacy['attempt_id'], 'p_result': {**legacy['result'], 'request_id': 'tampered-legacy-replay'}}, 'PT409')
        check(json.loads(sql('select to_jsonb(e)from clinical_encounters e where id=' + quote(fixture['encounter']) + ';')), chart_before)
        for current in [owner, staff]:
            denied(current, 'read_clinical_note_job', {'p_actor_id': current['id'], 'p_id': job})
            denied(current, 'read_clinical_note_provenance', {'p_actor_id': current['id'], 'p_proposal_id': attempt})
        denied(staff, 'read_clinical_call_note_processing_v1', {'p_actor_id': staff['id'], 'p_id': job})
        denied({'token': status['ANON_KEY']}, 'read_clinical_call_note_processing_v1', read_args, '42501')
        for current in [owner, staff, worker]:
            code, data = request('/rest/v1/clinical_call_note_actions?select=*', status['ANON_KEY'], current['token'])
            check(code >= 400, True)
        sql('update auth.users set banned_until=clock_timestamp()+interval\'1 day\'where id=' + quote(reader['id']) + ';')
        denied(reader, 'read_clinical_call_note_processing_v1', {'p_actor_id': reader['id'], 'p_id': job}, '42501')
        sql('update auth.users set banned_until=null where id=' + quote(reader['id']) + ';')
        blocked_rpc(raced, 'read_clinical_call_note_processing_v1', {'p_actor_id': raced['id'], 'p_id': job},
                    'select 1 from pets where id=' + quote(fixture['pet']) + 'for update;',
                    'delete from user_roles where user_id=' + quote(raced['id']) + "and role='ADMIN';", 'PT403')
        sql('insert into user_roles(user_id,role)values(' + quote(raced['id']) + ",'ADMIN');")
        review_request = {'proposal_id': attempt, 'expected_version': 1, 'decision': 'accepted',
                          'accepted_sections': {'subjective': 'Clinician reviewed owner-reported historical vomiting.'},
                          'review_note': 'Synthetic explicit review', 'attest_reviewed': True}
        # Ban the actual accepting reader only after observing the destination lock wait.
        blocked_rpc(owner, 'save_clinical_call_note_review_v1', {'p_actor_id': owner['id'], 'p_id': review_id, 'p_job_id': job, 'p_request': review_request},
                    'select 1 from clinical_encounters where id=' + quote(fixture['encounter']) + 'for update;',
                    'update auth.users set banned_until=clock_timestamp()+interval\'1 day\'where id=' + quote(owner['id']) + ';', '42501')
        sql('update auth.users set banned_until=null where id=' + quote(owner['id']) + ';')
        check(json.loads(sql('select to_jsonb(e)from clinical_encounters e where id=' + quote(fixture['encounter']) + ';')), chart_before)
        acceptance = rpc(owner, 'save_clinical_call_note_review_v1', {'p_actor_id': owner['id'], 'p_id': review_id, 'p_job_id': job, 'p_request': review_request})
        recover_args = {'p_actor_id': owner['id'], 'p_id': review_id, 'p_job_id': job}
        check(rpc(owner, 'recover_clinical_call_note_review_v1', recover_args), acceptance)
        check(rpc(owner, 'save_clinical_call_note_review_v1', {**recover_args, 'p_request': review_request}), acceptance)
        chart_after = json.loads(sql('select to_jsonb(e)from clinical_encounters e where id=' + quote(fixture['encounter']) + ';'))
        check(chart_after['version'], 2)
        check(chart_after['status'], 'draft')
        check(chart_after['subjective'], review_request['accepted_sections']['subjective'])
        for key in ['objective', 'assessment', 'plan']:
            check(chart_after[key], chart_before[key])
        code, ordinary_chart = request('/rest/v1/clinical_encounters?id=eq.' + fixture['encounter'] + '&select=*', status['ANON_KEY'], staff['token'])
        check(code, 200)
        check(ordinary_chart[0]['subjective'], review_request['accepted_sections']['subjective'])
        check('clinical_call' in json.dumps(ordinary_chart), False)
        denied(staff, 'recover_clinical_call_note_review_v1', {**recover_args, 'p_actor_id': staff['id']})
        denied(staff, 'read_clinical_call_note_processing_v1', {'p_actor_id': staff['id'], 'p_id': job})
        retained = rpc(reader, 'read_clinical_call_note_processing_v1', {'p_actor_id': reader['id'], 'p_id': job})
        # Use the actual provider handler over local HTTP with a stub transport, never OpenAI.
        worker_job, worker_attempt = str(uuid.uuid4()), str(uuid.uuid4())
        worker_request = {**reserve_request, 'expected_version': 2}
        rpc(owner, 'reserve_clinical_call_note_v1', {'p_actor_id': owner['id'], 'p_id': worker_job, 'p_request': worker_request})
        browser_fixture = json.loads(sql(fixtures + '\nselect pg_temp.cgn_base(' + quote(owner['id']) + ',' + quote(owner['session']) + ');').splitlines()[-1])
        browser_source = json.loads(sql(fixtures + '\nselect to_jsonb(pg_temp.cgn_source(' + quote(json.dumps(browser_fixture)) + '::jsonb));').splitlines()[-1])
        bridge_seed = private / (args.evidence_prefix + '-worker-seed.json')
        try:
            with bridge_seed.open('x') as handle:
                handle.write(json.dumps({'actor_id': owner['id'], 'token': owner['token'], 'job_id': worker_job, 'attempt_id': worker_attempt,
                                         'owner_session': owner['auth_session'], 'staff_session': staff['auth_session'],
                                         'browser_fixture': browser_fixture, 'browser_source': browser_source, 'legacy': legacy,
                                         'evidence_base': 'tmp/' + args.evidence_prefix}))
            worker_bridge = json.loads(run(['node','--experimental-strip-types',str(root / 'tests/clinical-call-generation/worker-roundtrip.ts'),str(bridge_seed)], env={**os.environ,'CALL_GENERATION_TEST_PROJECT':str(project),'CALL_GENERATION_RUN_SYNTHETIC_LOCAL':'true'}, timeout=600).stdout.splitlines()[-1])
        finally:
            bridge_seed.unlink(missing_ok=True)
        check(worker_bridge['real_provider_requests'], 0)
        check(worker_bridge['stub_provider_requests'], 1)
        check(json.loads(sql('select to_jsonb(e)from clinical_encounters e where id=' + quote(fixture['encounter']) + ';')), chart_after)
        def scenario(current=owner, dispatch=False, finish=False):
            base = json.loads(sql(fixtures + '\nselect pg_temp.cgn_base(' + quote(current['id']) + ',' + quote(current['session']) + ');').splitlines()[-1])
            retained_source = json.loads(sql(fixtures + '\nselect to_jsonb(pg_temp.cgn_source(' + quote(json.dumps(base)) + '::jsonb));').splitlines()[-1])
            intent = json.loads(sql(fixtures + '\nselect pg_temp.cgn_request(' + quote(retained_source) + ');').splitlines()[-1])
            jid, aid = str(uuid.uuid4()), str(uuid.uuid4())
            view = rpc(current, 'reserve_clinical_call_note_v1', {'p_actor_id': current['id'], 'p_id': jid, 'p_request': intent})
            rpc(current, 'claim_clinical_call_note_v1', {'p_actor_id': current['id'], 'p_id': aid, 'p_request': {'job_id': jid,'retry_of':None,'reason':'','ack_cost':False}})
            args_work = {'p_job_id': jid, 'p_attempt_id': aid}
            if dispatch or finish:
                check(rpc(worker, 'dispatch_clinical_call_note_v1', args_work), True)
            result_work = json.loads(sql(fixtures + '\nselect pg_temp.cgn_result(' + quote(jid) + ');').splitlines()[-1])
            if finish:
                rpc(worker, 'finish_clinical_call_note_v1', {**args_work, 'p_result': result_work})
            return {'fixture':base,'source':view['source'],'job':jid,'attempt':aid,'work':args_work,'result':result_work}

        def retain_uncertain_outcome(refused):
            code, value = request('/rest/v1/rpc/fail_clinical_call_note_v1', status['SERVICE_ROLE_KEY'], status['SERVICE_ROLE_KEY'],
                                  {**refused['work'], 'p_uncertain': True, 'p_code': 'result_save_unconfirmed', 'p_details': {}})
            check(code in (200, 204), True)
            check(value, None)
            check(sql('select state from clinical_note_attempts where id=' + quote(refused['attempt']) + ';'), 'uncertain')
            check(json.loads(sql('select failure_details from clinical_note_attempts where id=' + quote(refused['attempt']) + ';')), {})

        # Safe complete-byte digest evidence can be retained without any raw response.
        failed_with_evidence = scenario(dispatch=True)
        failure_details = {'http_status': 200, 'provider_response_sha256': 'd' * 64}
        failure_code, failure_value = request('/rest/v1/rpc/fail_clinical_call_note_v1', status['SERVICE_ROLE_KEY'], status['SERVICE_ROLE_KEY'],
            {**failed_with_evidence['work'], 'p_uncertain': True, 'p_code': 'provider_response_contract_failed', 'p_details': failure_details})
        check(failure_code in (200, 204), True)
        check(failure_value, None)
        failed_view = rpc(owner, 'read_clinical_call_note_processing_v1', {'p_actor_id': owner['id'], 'p_id': failed_with_evidence['job']})
        check(failed_view['attempts'][0]['failure_details'], failure_details)
        check(failed_view['attempts'][0]['state'], 'uncertain')
        check(failed_view['proposal'], None)

        # Every transition below is observed at its real lock, rather than inferred from a sleep.
        r = scenario()
        blocked_rpc(worker, 'dispatch_clinical_call_note_v1', r['work'],
                    'select 1 from cloudtalk_calls where call_uuid=' + quote(r['source']['call_uuid']) + 'for update;',
                    'update cloudtalk_calls set last_event_at=last_event_at+interval\'1 second\'where call_uuid=' + quote(r['source']['call_uuid']) + ';', 'PT409', True)
        check(sql('select state from clinical_note_attempts where id=' + quote(r['attempt']) + ';'), 'claimed')
        check(rpc(owner, 'cancel_clinical_call_note_attempt_v1', {'p_actor_id':owner['id'],'p_id':r['attempt'],'p_job_id':r['job']})['cancelled'], True)
        check(sql('select state from clinical_note_attempts where id=' + quote(r['attempt']) + ';'), 'failed')
        r = scenario()
        inbound_where = "provider='cloudtalk'and resource_id=" + quote('call:' + r['source']['call_uuid'])
        blocked_rpc(worker, 'dispatch_clinical_call_note_v1', r['work'],
                    'select 1 from communication_inbound where ' + inbound_where + 'for update;',
                    'update communication_inbound set version=version+1 where ' + inbound_where + ';', 'PT409', True)
        check(sql('select state from clinical_note_attempts where id=' + quote(r['attempt']) + ';'), 'claimed')
        check(rpc(owner, 'cancel_clinical_call_note_attempt_v1', {'p_actor_id':owner['id'],'p_id':r['attempt'],'p_job_id':r['job']})['cancelled'], True)
        check(sql('select state from clinical_note_attempts where id=' + quote(r['attempt']) + ';'), 'failed')
        session_owner = actor('ADMIN')
        r = scenario(session_owner, dispatch=True)
        blocked_rpc(worker, 'finish_clinical_call_note_v1', {**r['work'], 'p_result': r['result']},
                    "select pg_advisory_xact_lock(hashtextextended('clinical-note-policy',0));",
                    'delete from auth.sessions where id=' + quote(session_owner['session']) + ';', '42501')
        check(sql('select count(*)from clinical_note_generations where job_id=' + quote(r['job']) + ';'), '0')
        retain_uncertain_outcome(r)
        r = scenario(dispatch=True)
        template = 'e7000000-0000-4000-8000-000000000001'
        blocked_rpc(worker, 'finish_clinical_call_note_v1', {**r['work'], 'p_result': r['result']},
                    'select 1 from clinical_note_templates where id=' + quote(template) + 'for update;',
                    'update clinical_note_templates set retired=true,revision=revision+1 where id=' + quote(template) + ';', 'PT409', True)
        sql('update clinical_note_templates set retired=false,revision=revision+1 where id=' + quote(template) + ';')
        check(sql('select count(*)from clinical_note_generations where job_id=' + quote(r['job']) + ';'), '0')
        retain_uncertain_outcome(r)
        r = scenario(finish=True)
        raced_review = {'proposal_id':r['attempt'],'expected_version':1,'decision':'accepted','accepted_sections':{'subjective':'Must not overwrite a competing edit.'},'review_note':'Synthetic competing edit','attest_reviewed':True}
        blocked_rpc(owner, 'save_clinical_call_note_review_v1', {'p_actor_id':owner['id'],'p_id':str(uuid.uuid4()),'p_job_id':r['job'],'p_request':raced_review},
                    'select 1 from clinical_encounters where id=' + quote(r['fixture']['encounter']) + 'for update;',
                    "select set_config('request.jwt.claims'," + quote(json.dumps(owner['claims'])) + ",true);update clinical_encounters set plan='Competing synthetic plan'where id=" + quote(r['fixture']['encounter']) + ';', 'PT409', True)
        check(sql('select count(*)from clinical_dictation_reviews where proposal_id=' + quote(r['attempt']) + ';'), '0')
        check(sql('select subjective from clinical_encounters where id=' + quote(r['fixture']['encounter']) + ';'), 'Original fictional S')
        former_generator = actor('ADMIN')
        completed_elsewhere = scenario(former_generator, finish=True)
        sql('delete from auth.sessions where id=' + quote(former_generator['session']) + ';')
        handed_off_review = {'proposal_id': completed_elsewhere['attempt'], 'expected_version': 1, 'decision': 'accepted',
                             'accepted_sections': {'subjective': 'Current administrator reviewed the retained owner report.'},
                             'review_note': 'Synthetic handoff after generator sign-out', 'attest_reviewed': True}
        handed_off = rpc(reader, 'save_clinical_call_note_review_v1', {'p_actor_id': reader['id'], 'p_id': str(uuid.uuid4()),
                         'p_job_id': completed_elsewhere['job'], 'p_request': handed_off_review})
        check(handed_off['review']['actor_id'], reader['id'])
        check(sql('select version from clinical_encounters where id=' + quote(completed_elsewhere['fixture']['encounter']) + ';'), '2')
        r = scenario(dispatch=True)
        blocked_rpc(worker, 'finish_clinical_call_note_v1', {**r['work'], 'p_result': r['result']},
                    "select pg_advisory_xact_lock(hashtextextended('clinical-note-policy',0));",
                    "insert into clinical_note_policies(version,status,consent_text,soap_model)values(3,'draft','Synthetic later policy','gpt-6-luna');", 'PT403', True)
        check(sql('select count(*)from clinical_note_generations where job_id=' + quote(r['job']) + ';'), '0')
        retain_uncertain_outcome(r)
        # Actual policy journals retain cancellation and lost-ACK identities without activating processing.
        cancelled_policy, policy_id = str(uuid.uuid4()), str(uuid.uuid4())
        cancel_policy_args = {'p_actor_id': owner['id'], 'p_id': cancelled_policy}
        check(rpc(owner, 'cancel_clinical_call_note_policy_v1', cancel_policy_args)['cancelled'], True)
        policy_request = {'expected_version':2,'status':'draft','consent_text':'Synthetic later draft call-generation scope','retention_text':'Synthetic retention only','attest_reviewed':False}
        denied(owner, 'save_clinical_call_note_policy_v1', {**cancel_policy_args, 'p_request':policy_request}, 'PT409')
        policy_args = {'p_actor_id':owner['id'],'p_id':policy_id}
        policy_receipt = rpc(owner, 'save_clinical_call_note_policy_v1', {**policy_args,'p_request':policy_request})
        check(policy_receipt['version'], 3)
        check(policy_receipt['status'], 'draft')
        check(rpc(owner, 'save_clinical_call_note_policy_v1', {**policy_args,'p_request':policy_request}), policy_receipt)
        check(rpc(owner, 'recover_clinical_call_note_policy_v1', policy_args), policy_receipt)
        check(rpc(owner, 'cancel_clinical_call_note_policy_v1', policy_args)['cancelled'], False)
        denied(staff, 'recover_clinical_call_note_policy_v1', {**policy_args,'p_actor_id':staff['id']})
        # Historical reads reflect the current policy while preserving the same saved source/result.
        retained = rpc(reader, 'read_clinical_call_note_processing_v1', {'p_actor_id': reader['id'], 'p_id': job})
        # Restore every relevant populated relation and all public routine definitions/effective ACLs.
        names = ['clinical_call_note_actions','clinical_call_note_policies','clinical_call_note_bindings','clinical_call_sources','clinical_call_capture_actions','clinical_call_policies','clinical_note_jobs','clinical_note_attempts','clinical_note_generations','clinical_note_events','clinical_note_policies','clinical_note_templates','clinical_note_template_versions','clinical_dictation_proposals','clinical_dictation_actions','clinical_dictation_reviews','clinical_encounters']
        snapshot_sql = 'select jsonb_build_object(' + ','.join(quote(n) + ",(select coalesce(jsonb_agg(to_jsonb(t)order by to_jsonb(t)::text),'[]')from " + n + ' t)' for n in names) + ');'
        snapshot = json.loads(sql(snapshot_sql))
        catalog_sql = "select coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'body',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',(select jsonb_agg(jsonb_build_object('role',a.grantee,'privilege',a.privilege_type,'grantable',a.is_grantable)order by a.grantee,a.privilege_type,a.is_grantable)from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a))order by p.oid::regprocedure::text),'[]')from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind<>'a';"
        catalog = json.loads(sql(catalog_sql))
        table_security_sql = "select jsonb_agg(jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'effective_privileges',(select jsonb_object_agg(r,jsonb_build_object('select',has_table_privilege(r,c.oid,'SELECT'),'insert',has_table_privilege(r,c.oid,'INSERT'),'update',has_table_privilege(r,c.oid,'UPDATE'),'delete',has_table_privilege(r,c.oid,'DELETE'),'truncate',has_table_privilege(r,c.oid,'TRUNCATE')))from unnest(array['anon','authenticated','service_role'])r),'policies',(select jsonb_agg(to_jsonb(p)order by p.policyname)from pg_policies p where p.schemaname='public'and p.tablename=c.relname),'triggers',(select jsonb_agg(pg_get_triggerdef(t.oid)order by t.tgname)from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),'constraints',(select jsonb_agg(jsonb_build_object('name',n.conname,'definition',pg_get_constraintdef(n.oid,true),'deferrable',n.condeferrable,'deferred',n.condeferred)order by n.conname)from pg_constraint n where n.conrelid=c.oid))order by c.relname)from pg_class c where c.relnamespace='public'::regnamespace and c.relname in(" + ','.join(quote(n)for n in names) + ');'
        table_security = json.loads(sql(table_security_sql))
        dump = run(['docker','exec',container,'pg_dump','-U','postgres','--no-owner','--schema=public','--schema=auth','--schema=storage','--schema=extensions','postgres'], timeout=300).stdout
        dump = '\n'.join(line for line in dump.splitlines() if not line.startswith('ALTER DEFAULT PRIVILEGES')).replace('CREATE SCHEMA extensions;', 'CREATE SCHEMA IF NOT EXISTS extensions;')
        clone = 'owned_call_generation_restore_' + uuid.uuid4().hex[:10]
        marker = uuid.uuid4().hex
        sql('create database ' + clone + ';comment on database ' + clone + ' is ' + quote(marker) + ';')
        restore_checks = 0
        try:
            sql('drop schema public;create schema extensions;create extension pgcrypto with schema extensions;create extension "uuid-ossp"with schema extensions;', clone)
            sql(dump, clone, timeout=300)
            check(json.loads(sql(snapshot_sql, clone)), snapshot); restore_checks += 1
            check(json.loads(sql(catalog_sql, clone)), catalog); restore_checks += 1
            check(json.loads(sql(table_security_sql, clone)), table_security); restore_checks += 1
            check(actor_sql(reader, 'read_clinical_call_note_processing_v1(' + quote(reader['id']) + ',' + quote(job) + ')', clone), retained); restore_checks += 1
            restored_legacy = actor_sql(reader, 'read_clinical_call_note_processing_v1(' + quote(reader['id']) + ',' + quote(legacy['job_id']) + ')', clone)
            check(restored_legacy['generation'], legacy_view['generation']); restore_checks += 1
            restored_failure = actor_sql(reader, 'read_clinical_call_note_processing_v1(' + quote(reader['id']) + ',' + quote(failed_with_evidence['job']) + ')', clone)
            check(restored_failure['attempts'][0]['failure_details'], failure_details); restore_checks += 1
            check(actor_sql(owner, 'recover_clinical_call_note_review_v1(' + quote(owner['id']) + ',' + quote(review_id) + ',' + quote(job) + ')', clone), acceptance); restore_checks += 1
            sql('do $$declare j record;begin for j in select id from clinical_note_jobs where source_kind=\'call_transcript\'loop perform clinical_call_note_check_binding(j.id);end loop;end $$;', clone); restore_checks += 1
            check(json.loads(sql(snapshot_sql)), snapshot); restore_checks += 1
        finally:
            assert sql("select shobj_description(oid,'pg_database')from pg_database where datname=" + quote(clone) + ';') == marker
            assert re.fullmatch(r'owned_call_generation_restore_[a-f0-9]{10}', clone)
            check(sql('select current_database();'), 'postgres')
            sql('drop database ' + clone + ' with(force);'); restore_checks += 1
    assert all(hashlib.sha256((root / name).read_bytes()).hexdigest() == digest for name, digest in hashes.items()), 'Proof input changed during run'
    assert bootstrap_inputs(root) == bootstrap_hashes, 'Bootstrap source changed during proof'
    proof = {'bootstrap_source_sha256': bootstrap_hashes, 'identity': identity, 'sql_summary': summary, 'sql_only': args.sql_only, 'migrations': 206,
             'source_sha256': hashes, 'actual_auth_api_assertions': checks, 'observed_lock_waits': waits,
             'provider_requests': 0, 'hosted_writes': 0, 'owned_runtime_removed': False}
    if not args.sql_only:
        proof.update(legacy_v1_owner_seeded_adaptation=True, legacy_v1_completed_replay=True, v2_manifest_and_failure_evidence=True, actual_worker=worker_bridge, populated_restore_assertions=restore_checks, restored_relation_families=len(names), restored_table_security_catalogs=len(table_security), restored_public_routines=len(catalog))
finally:
    try:
        if started:
            containers = run(['docker','ps','-a','--filter','label=com.supabase.cli.project=' + identity,'--format','{{.Names}}']).stdout.splitlines()
            for name in containers:
                labels = json.loads(run(['docker','inspect',name], sensitive=True).stdout)[0]['Config']['Labels']
                assert labels['com.supabase.cli.project'] == identity and Path(labels['com.supabase.cli.workdir']).resolve() == project.resolve()
            run(['supabase','stop','--workdir',str(project),'--no-backup'], timeout=180)
            assert not run(['docker','ps','-a','--filter','label=com.supabase.cli.project=' + identity,'--format','{{.Names}}']).stdout.strip()
            assert not run(['docker','volume','ls','--filter','label=com.supabase.cli.project=' + identity,'--format','{{.Name}}']).stdout.strip()
            shutil.rmtree(work)
            if proof:
                proof['owned_runtime_removed'] = True
                with (private / (args.evidence_prefix + '-proof.json')).open('x') as handle:
                    handle.write(json.dumps(proof, indent=2) + '\n')
                print(json.dumps({k:v for k,v in proof.items()if k not in ['identity','source_sha256']}), flush=True)
                print('Owned call-generation runtime removed.', flush=True)
        else:
            print('Bootstrap did not complete; private work/config retained: ' + str(work), flush=True)
    finally:
        log.close()
