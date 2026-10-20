"""Owned baseline-upgrade/Auth/restore proof. No hosted access or provider calls."""
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
parser.add_argument('--evidence-prefix', default='clinical-calls-notes')
args = parser.parse_args()
assert re.fullmatch(r'clinical-calls-[a-z0-9-]{1,65}', args.evidence_prefix)
os.umask(0o077)
root = Path(__file__).resolve().parents[2]
private = root / 'tmp'
private.mkdir(mode=0o700, exist_ok=True)
assert not list(private.glob(args.evidence_prefix + '-*')), 'Evidence prefix already exists; preserve earlier attempts'
log = (private / (args.evidence_prefix + '-commands.log')).open('x')
identity = 'lrv-call-notes-' + uuid.uuid4().hex[:10]
work = Path(tempfile.mkdtemp(prefix=identity + '-'))
project = work / 'project'
(project / 'supabase/migrations').mkdir(parents=True)
(project / 'supabase/tests').mkdir()
new_migration = root / 'supabase/migrations/20261017135245_clinical_call_note_sources.sql'
test = root / 'supabase/tests/clinical_call_note_sources.test.sql'
inputs = set((root / 'supabase/migrations').glob('*.sql')) | set((root / 'tests/clinical-call-notes').glob('*')) | {test}
inputs |= {root / name for name in [
    'src/hub/features/clinical/templates/model.ts', 'src/hub/features/clinical/dictation/model.ts',
    'supabase/functions/_shared/clinical-note-model.ts', 'supabase/functions/_shared/clinical-audio-model.ts',
    'supabase/functions/_shared/clinical-veterinary-context.ts', 'package-lock.json']}
if args.sql_only:
    inputs = set((root / 'supabase/migrations').glob('*.sql')) | {test, Path(__file__).resolve()}
hashes = {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
          for p in sorted(inputs) if p.is_file()}
fixtures = test.read_text().split('-- BEGIN OWNED CALL NOTE FIXTURES\n', 1)[1].split('-- END OWNED CALL NOTE FIXTURES', 1)[0]
baseline_fixtures = fixtures.split('create function pg_temp.ccn_bad_binding', 1)[0]
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
            'email': email, 'password': password}


def legacy(a, fixture, label):
    wire = {}
    def capture(key, name, values):
        value = rpc(a, name, values)
        wire[key] = dict(last_wire)
        return value
    common = {'p_actor_id': a['id'], 'p_pet_id': fixture['pet'], 'p_encounter_id': fixture['encounter']}
    result = {'notes': capture('notes', 'read_clinical_notes', common), 'dictation': capture('dictation', 'read_clinical_dictation', common)}
    for key, prefix in [('typed', 'typed'), ('audio_note', 'audio')]:
        note = fixture[key]
        result[key] = capture(key, 'read_clinical_note_job', {'p_actor_id': a['id'], 'p_id': note['job']})
        result[prefix + '_provenance'] = capture(prefix + '_provenance', 'read_clinical_note_provenance', {'p_actor_id': a['id'], 'p_proposal_id': note['proposal']})
        result[prefix + '_receipt'] = capture(prefix + '_receipt', 'recover_clinical_dictation_action', {'p_actor_id': a['id'], 'p_id': note['action'], 'p_kind': 'review', 'p_request': note['review_request']})
    result['direct_audio_provenance'] = capture('direct_audio_provenance', 'read_clinical_audio_provenance', {'p_actor_id': a['id'], 'p_proposal_id': fixture['direct_audio']['proposal']})
    result['fixture'] = {'actor': a['id'], 'typed': fixture['typed'], 'audio_note': fixture['audio_note'], 'direct_audio': fixture['direct_audio']}
    legacy_wire[label] = wire
    return result


def advisors(label):
    result = run(['supabase', 'db', 'advisors', '--local', '--workdir', str(project), '--type', 'security', '--level', 'warn', '--fail-on', 'error', '--output', 'json'], check=False)
    artifact = private / (args.evidence_prefix + '-advisors-' + label + '.json')
    artifact.write_text(result.stdout + result.stderr)
    return {'exit_code': result.returncode, 'artifact': str(artifact.relative_to(root)),
            'sha256': hashlib.sha256(artifact.read_bytes()).hexdigest()}


def read_race(reader, fixture, mutation, expected):
    global waits
    tag = 'call_note_hold_' + uuid.uuid4().hex
    first = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        first.stdin.write("begin;set application_name=" + quote(tag) + ";set local statement_timeout='25s';select 1 from pets where id=" + quote(fixture['pet']) + "for update;\n\\echo CALL_NOTE_HOLD_READY\n")
        first.stdin.flush()
        while True:
            line = first.stdout.readline()
            if 'CALL_NOTE_HOLD_READY' in line:
                break
            assert line, 'Owned holder failed before lock barrier'
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(request, '/rest/v1/rpc/read_clinical_call_note_job_v1', status['ANON_KEY'], reader['token'], {'p_actor_id': reader['id'], 'p_id': fixture['call']['job']})
            deadline = time.monotonic() + 12
            while time.monotonic() < deadline:
                count = sql("select count(*)from pg_stat_activity a where a.query like '%read_clinical_call_note_job_v1%'and a.wait_event_type='Lock'and exists(select 1 from pg_stat_activity h where h.application_name=" + quote(tag) + 'and h.pid=any(pg_blocking_pids(a.pid)));')
                if count == '1':
                    waits += 1
                    break
                assert not future.done(), 'Read returned before observing the actual lock wait'
                time.sleep(.05)
            else:
                raise AssertionError('Did not observe call-note retained-source read wait')
            sql(mutation)
            first.stdin.write('commit;\n')
            first.stdin.close()
            check(first.wait(timeout=10), 0)
            code, data = future.result(timeout=25)
            log.write(json.dumps({'rpc': 'read_clinical_call_note_job_v1', 'observed_wait': True,
                                  'http_status': code, 'error_code': data.get('code'),
                                  'expected_error_code': expected}) + '\n')
            log.flush()
            check(code >= 400, True)
            check(data['code'], expected)
    finally:
        if first.poll() is None:
            first.kill()
            first.wait(timeout=10)


try:
    for port in [65420, 65421, 65422, 65424]:
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', port))
    migrations = sorted((root / 'supabase/migrations').glob('*.sql'))
    assert len(migrations) == 205 and new_migration in migrations and migrations[-1].name == '20261020151157_controlled_stock_private_engine.sql'
    selected = migrations if args.sql_only else [m for m in migrations if m < new_migration]
    for migration in selected:
        shutil.copy2(migration, project / 'supabase/migrations' / migration.name)
    shutil.copy2(test, project / 'supabase/tests' / test.name)
    (project / 'supabase/config.toml').write_text(f'''project_id = "{identity}"
[api]
port = 65421
[db]
port = 65422
shadow_port = 65420
major_version = 17
[studio]
enabled = false
[analytics]
enabled = false
[inbucket]
port = 65424
[auth]
site_url = "http://127.0.0.1:65481"
enable_signup = false
[storage]
enabled = true
[edge_runtime]
enabled = false
''')
    print('Starting uniquely owned call-note boundary runtime.', flush=True)
    started = True
    run(['supabase', 'start', '--workdir', str(project), '--exclude', 'realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor', '--ignore-health-check'], timeout=600)
    labels = json.loads(run(['docker', 'inspect', container], sensitive=True).stdout)[0]['Config']['Labels']
    assert labels['com.supabase.cli.project'] == identity and Path(labels['com.supabase.cli.workdir']).resolve() == project.resolve()
    run(['docker', 'exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], input='alter system set cron.launch_active_jobs=off;select pg_reload_conf();')
    baseline_advisors = None
    if not args.sql_only:
        status = json.loads(run(['supabase', 'status', '--workdir', str(project), '--output', 'json'], sensitive=True).stdout)
        check(status['API_URL'], 'http://127.0.0.1:65421')
        check(sql('select count(*)from supabase_migrations.schema_migrations;'), '201')
        owner, reader, staff, raced = actor('ADMIN'), actor('ADMIN'), actor('STAFF'), actor('ADMIN')
        # Demotion keeps general staff access so the after-wait ADMIN boundary,
        # rather than loss of every role, is what the first race proves.
        sql('insert into user_roles(user_id,role)values(' + quote(raced['id']) + ",'STAFF')on conflict do nothing;")
        check(sql("select count(*)from pg_constraint where conrelid='public.clinical_note_jobs'::regclass and conname in('clinical_note_jobs_check','clinical_note_jobs_source_kind_check');"), '2')
        seed = baseline_fixtures + "\nwith f as materialized(select pg_temp.ccn_base(" + quote(owner['id']) + ',' + quote(owner['session']) + ") f)select f||jsonb_build_object('typed',pg_temp.ccn_note(f,'typed'),'audio_note',pg_temp.ccn_note(f,'audio_transcript'))from f;"
        fixture = json.loads(sql(seed).splitlines()[-1])
        fixture['direct_audio'] = json.loads(sql((root / 'tests/clinical-call-notes/direct-audio-fixture.inc').read_text() + '\nselect pg_temp.ccn_direct_audio(' + quote(json.dumps(fixture)) + '::jsonb);').splitlines()[-1])
        before = legacy(owner, fixture, 'before')
        chart_before = sql('select to_jsonb(e)from clinical_encounters e where id=' + quote(fixture['encounter']) + ';')
        baseline_advisors = advisors('baseline201')
        for migration in migrations:
            if migration >= new_migration:
                shutil.copy2(migration, project / 'supabase/migrations' / migration.name)
        run(['supabase', 'migration', 'up', '--local', '--workdir', str(project)], timeout=180)
        check(sql('select count(*)from supabase_migrations.schema_migrations;'), '205')
        sql("notify pgrst,'reload schema';")
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            code, data = request('/rest/v1/rpc/read_clinical_call_note_job_v1', status['ANON_KEY'], reader['token'], {'p_actor_id': reader['id'], 'p_id': str(uuid.uuid4())})
            if isinstance(data, dict) and data.get('code') == 'PT404':
                break
            time.sleep(.1)
        else:
            raise AssertionError('New reader did not appear in owned REST schema cache')
    result = run(['supabase', 'test', 'db', '--workdir', str(project)], timeout=420).stdout
    assert 'All tests successful.' in result
    summary = result[result.rfind('All tests successful.'):].strip()
    print(summary, flush=True)
    if not args.sql_only:
        fsql = quote(json.dumps(fixture)) + '::jsonb'
        source = json.loads(sql(fixtures + '\nselect to_jsonb(pg_temp.ccn_source(' + fsql + '));').splitlines()[-1])
        more = fixtures + '\nselect jsonb_build_object(\'call\',pg_temp.ccn_note(' + fsql + ",'call_transcript'," + quote(source) + "::uuid),'job_only',pg_temp.ccn_note(" + fsql + ",'call_transcript'," + quote(source) + "::uuid,'job'),'generation_only',pg_temp.ccn_note(" + fsql + ",'call_transcript'," + quote(source) + "::uuid,'generation'));"
        fixture.update(json.loads(sql(more).splitlines()[-1]))
        sql(fixtures + '\ndo $$begin for n in 1..22 loop perform pg_temp.ccn_note(' + fsql + ",'call_transcript'," + quote(source) + '::uuid);end loop;end $$;')
        after = legacy(owner, fixture, 'after')
        check(after, before)
        check(legacy_wire['after'], legacy_wire['before'])
        wire_artifact = private / (args.evidence_prefix + '-legacy-wire.json')
        with wire_artifact.open('x') as handle:
            handle.write(json.dumps(legacy_wire, indent=2) + '\n')
        snapshots = private / (args.evidence_prefix + '-legacy-snapshots.json')
        with snapshots.open('x') as handle:
            handle.write(json.dumps([before, after], indent=2) + '\n')
        parsed = json.loads(run(['node', '--experimental-strip-types', str(root / 'tests/clinical-call-notes/parse-legacy.ts'), str(snapshots)]).stdout.splitlines()[-1])
        check(parsed['actualFrontendParses'], 18)
        check(parsed['actualFrontendReviewChecks'], 6)
        check(sql('select to_jsonb(e)from clinical_encounters e where id=' + quote(fixture['encounter']) + ';'), chart_before)
        read_args = {'p_actor_id': reader['id'], 'p_id': fixture['call']['job']}
        retained = rpc(reader, 'read_clinical_call_note_job_v1', read_args)
        check(sorted(retained), ['binding', 'contract_version', 'job', 'source_context'])
        check(retained['contract_version'], 'clinical-call-note-source-v1')
        check(any(k in retained['job'] for k in ['session_id', 'intent', 'attempts']), False)
        check(retained['binding']['call_source_id'], source)
        for current in [owner, staff]:
            call = fixture['call']
            matrix = [
                ('read_clinical_note_job', {'p_id': call['job']}),
                ('read_clinical_note_provenance', {'p_proposal_id': call['proposal']}),
                ('read_clinical_audio_provenance', {'p_proposal_id': call['proposal']}),
                ('reserve_clinical_note', {'p_id': call['job'], 'p_request': call['intent']}),
                ('claim_clinical_note', {'p_id': call['attempt'], 'p_job_id': call['job']}),
                ('cancel_clinical_note_reservation', {'p_id': call['job']}),
                ('cancel_clinical_note_attempt', {'p_id': call['attempt'], 'p_job_id': call['job']}),
                ('recover_clinical_dictation_action', {'p_id': call['action'], 'p_kind': 'review', 'p_request': call['review_request']}),
                ('save_clinical_dictation_action', {'p_id': call['action'], 'p_kind': 'review', 'p_request': call['review_request']}),
            ]
            for name, values in matrix:
                expected = '42501' if current is staff and name in ('claim_clinical_note', 'cancel_clinical_note_attempt') else 'PT403'
                denied(current, name, {'p_actor_id': current['id'], **values}, expected)
        denied(staff, 'read_clinical_call_note_job_v1', {'p_actor_id': staff['id'], 'p_id': fixture['call']['job']})
        denied({'token': status['ANON_KEY']}, 'read_clinical_call_note_job_v1', read_args, '42501')
        denied(reader, 'read_clinical_call_note_job_v1', {'p_actor_id': reader['id'], 'p_id': fixture['typed']['job']}, 'PT404')
        denied(reader, 'read_clinical_call_note_job_v1', {'p_actor_id': owner['id'], 'p_id': fixture['call']['job']}, '42501')
        for link in ['job_only', 'generation_only']:
            denied(reader, 'read_clinical_note_provenance', {'p_actor_id': reader['id'], 'p_proposal_id': fixture[link]['proposal']})
        worker = {'id': owner['id'], 'token': status['SERVICE_ROLE_KEY']}
        for name, values in [
            ('dispatch_clinical_note', {'p_id': fixture['call']['attempt']}),
            ('finish_clinical_note', {'p_id': fixture['call']['attempt'], 'p_result': fixture['call']['result']}),
            ('fail_clinical_note', {'p_id': fixture['call']['attempt'], 'p_uncertain': False, 'p_code': 'synthetic'})]:
            denied(worker, name, values)
        for current in [staff, reader, worker]:
            for table in ['clinical_call_note_bindings', 'clinical_call_note_policies']:
                code, data = request('/rest/v1/' + table + '?select=*', status['ANON_KEY'], current['token'])
                check(code >= 400, True)
        sql('update auth.users set banned_until=clock_timestamp()+interval\'1 day\'where id=' + quote(reader['id']) + ';')
        denied(reader, 'read_clinical_call_note_job_v1', read_args, '42501')
        sql('update auth.users set banned_until=null where id=' + quote(reader['id']) + ';')
        sql('update profiles set is_active=false where id=' + quote(reader['id']) + ';')
        denied(reader, 'read_clinical_call_note_job_v1', read_args, '42501')
        sql('update profiles set is_active=true where id=' + quote(reader['id']) + ';')
        sql('update cloudtalk_calls set trusted_number=false where call_uuid=' + quote(retained['source_context']['call_uuid']) + ';')
        denied(reader, 'read_clinical_call_note_job_v1', read_args)
        sql('update cloudtalk_calls set trusted_number=true where call_uuid=' + quote(retained['source_context']['call_uuid']) + ';')
        other_client = str(uuid.uuid4())
        sql('insert into clients(id,first_name,last_name,full_name,primary_phone,primary_email)values(' + quote(other_client) + ",'Synthetic','Other call household','Synthetic other call household','+13035558882','synthetic-other-call@example.test');update communication_inbound set client_id=" + quote(other_client) + "where provider='cloudtalk'and resource_id=" + quote('call:' + retained['source_context']['call_uuid']) + ';')
        denied(reader, 'read_clinical_call_note_job_v1', read_args)
        sql('update communication_inbound set client_id=' + quote(fixture['client']) + "where provider='cloudtalk'and resource_id=" + quote('call:' + retained['source_context']['call_uuid']) + ';')
        sql("update cloudtalk_calls set call_id='700100'where call_uuid=" + quote(retained['source_context']['call_uuid']) + ';')
        denied(reader, 'read_clinical_call_note_job_v1', read_args)
        sql("update cloudtalk_calls set call_id='700099'where call_uuid=" + quote(retained['source_context']['call_uuid']) + ';')
        # Deliberate owner-only positive approvals prove hard denials independently of draft defaults.
        sql("insert into clinical_call_policies(version,status,consent_text,retention_text,reviewed_by,reviewed_at)values(2,'approved','Synthetic only','Synthetic only'," + quote(owner['id']) + ",now());insert into clinical_call_note_policies(version,status,consent_text,retention_text,reviewed_by,reviewed_at)values(2,'approved','Synthetic only','Synthetic only'," + quote(owner['id']) + ",now());insert into clinical_note_policies(version,status,consent_text,soap_model,reviewed_by,reviewed_at)values(2,'approved','Synthetic only','gpt-6-luna'," + quote(owner['id']) + ',now());')
        approved_source = json.loads(sql(fixtures + '\nselect to_jsonb(pg_temp.ccn_source(' + fsql + ',2));').splitlines()[-1])
        approved_call = json.loads(sql(fixtures + '\nselect pg_temp.ccn_note(' + fsql + ",'call_transcript'," + quote(approved_source) + "::uuid,'generation',2,2);").splitlines()[-1])
        sql("update clinical_note_attempts set state='sending'where id=" + quote(approved_call['attempt']) + ';')
        denied(worker, 'finish_clinical_note', {'p_id': approved_call['attempt'], 'p_result': approved_call['result']})
        accepted = {**approved_call['review_request'], 'decision': 'accepted', 'accepted_sections': {'subjective': 'Synthetic reviewed call wording.'}}
        denied(owner, 'save_clinical_dictation_action', {'p_actor_id': owner['id'], 'p_id': str(uuid.uuid4()), 'p_kind': 'review', 'p_request': accepted})
        check(sql('select to_jsonb(e)from clinical_encounters e where id=' + quote(fixture['encounter']) + ';'), chart_before)
        # History is readable after old eligibility changes; this cannot dispatch work.
        sql('delete from auth.sessions where user_id=' + quote(owner['id']) + ";insert into clinical_call_note_policies(version,status,consent_text,retention_text)values(3,'draft','Synthetic later draft','Synthetic later draft');update clinical_note_templates set retired=true,revision=revision+1 where id='e7000000-0000-4000-8000-000000000001';begin;select set_config('request.jwt.claims'," + quote(json.dumps(reader['claims'])) + ',true);select sign_clinical_encounter(' + quote(fixture['encounter']) + ',1);commit;')
        check(rpc(reader, 'read_clinical_call_note_job_v1', read_args), retained)
        check(sql('select count(*)from auth.sessions where id=' + quote(owner['session']) + ';'), '0')
        sql('update profiles set is_active=false where id=' + quote(owner['id']) + ';')
        check(rpc(reader, 'read_clinical_call_note_job_v1', read_args), retained)
        sql('update profiles set is_active=true where id=' + quote(owner['id']) + ';')
        code, relogged = request('/auth/v1/token?grant_type=password', status['ANON_KEY'], status['ANON_KEY'], {'email': owner['email'], 'password': owner['password']})
        check(code, 200)
        owner['token'] = relogged['access_token']
        owner['claims'] = json.loads(base64.urlsafe_b64decode(owner['token'].split('.')[1] + '=='))
        check(owner['claims']['session_id'] != owner['session'], True)
        read_race(raced, fixture, 'delete from user_roles where user_id=' + quote(raced['id']) + "and role='ADMIN';", 'PT403')
        sql('insert into user_roles(user_id,role)values(' + quote(raced['id']) + ",'ADMIN');")
        read_race(raced, fixture, 'delete from auth.sessions where user_id=' + quote(raced['id']) + ';', '42501')
        # Compare populated private rows, function definitions and effective ACLs.
        names = ['clinical_call_note_policies', 'clinical_call_note_bindings', 'clinical_call_sources', 'clinical_call_policies', 'clinical_note_jobs', 'clinical_note_attempts', 'clinical_note_generations', 'clinical_note_events', 'clinical_note_policies', 'clinical_note_templates', 'clinical_note_template_versions', 'clinical_dictation_proposals', 'clinical_dictation_actions', 'clinical_dictation_reviews', 'clinical_audio_jobs', 'clinical_audio_attempts', 'clinical_audio_generations', 'clinical_audio_events', 'clinical_audio_policies', 'clinical_encounters']
        snapshot_sql = 'select jsonb_build_object(' + ','.join(quote(n) + ",(select coalesce(jsonb_agg(to_jsonb(t)order by to_jsonb(t)::text),'[]')from " + n + ' t)' for n in names) + ');'
        snapshot = json.loads(sql(snapshot_sql))
        catalog_sql = "select jsonb_build_object('tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'triggers',(select jsonb_agg(pg_get_triggerdef(t.oid)order by t.tgname)from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),'constraints',(select jsonb_agg(jsonb_build_object('name',con.conname,'definition',pg_get_constraintdef(con.oid,true),'deferrable',con.condeferrable,'deferred',con.condeferred)order by con.conname)from pg_constraint con where con.conrelid=c.oid),'owner',pg_get_userbyid(c.relowner),'acl',(select jsonb_agg(jsonb_build_object('grantor',a.grantor,'grantee',a.grantee,'privilege',a.privilege_type,'grantable',a.is_grantable)order by a.grantor,a.grantee,a.privilege_type,a.is_grantable)from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a))order by c.relname)from pg_class c where c.relnamespace='public'::regnamespace and c.relname in('clinical_call_note_policies','clinical_call_note_bindings')),'routines',(select jsonb_agg(jsonb_build_object('name',p.oid::regprocedure::text,'body',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',(select jsonb_agg(jsonb_build_object('grantor',a.grantor,'grantee',a.grantee,'privilege',a.privilege_type,'grantable',a.is_grantable)order by a.grantor,a.grantee,a.privilege_type,a.is_grantable)from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a))order by p.oid::regprocedure::text)from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind<>'a'));"
        catalog = json.loads(sql(catalog_sql))
        dump = run(['docker', 'exec', container, 'pg_dump', '-U', 'postgres', '--no-owner', '--schema=public', '--schema=auth', '--schema=storage', '--schema=extensions', 'postgres'], timeout=120).stdout
        dump = '\n'.join(line for line in dump.splitlines() if not line.startswith('ALTER DEFAULT PRIVILEGES')).replace('CREATE SCHEMA extensions;', 'CREATE SCHEMA IF NOT EXISTS extensions;')
        clone = 'owned_call_note_restore_' + uuid.uuid4().hex[:10]
        marker = uuid.uuid4().hex
        sql('create database ' + clone + ';comment on database ' + clone + ' is ' + quote(marker) + ';')
        restore_checks = 0
        try:
            sql('drop schema public;create schema extensions;create extension pgcrypto with schema extensions;create extension "uuid-ossp"with schema extensions;', clone)
            sql(dump, clone, timeout=300)
            check(json.loads(sql(snapshot_sql, clone)), snapshot); restore_checks += 1
            check(json.loads(sql(catalog_sql, clone)), catalog); restore_checks += 1
            restored = json.loads(sql('begin;set local role authenticated;select set_config(\'request.jwt.claims\',' + quote(json.dumps(reader['claims'])) + ',true);select read_clinical_call_note_job_v1(' + quote(reader['id']) + ',' + quote(fixture['call']['job']) + ');rollback;', clone).splitlines()[-1])
            check(restored, retained); restore_checks += 1
            common = {'p_actor_id': owner['id'], 'p_pet_id': fixture['pet'], 'p_encounter_id': fixture['encounter']}
            expressions = {'notes': 'read_clinical_notes(' + ','.join(quote(common[k]) for k in ['p_actor_id','p_pet_id','p_encounter_id']) + ')',
                           'dictation': 'read_clinical_dictation(' + ','.join(quote(common[k]) for k in ['p_actor_id','p_pet_id','p_encounter_id']) + ')',
                           'direct_audio_provenance': 'read_clinical_audio_provenance(' + quote(owner['id']) + ',' + quote(fixture['direct_audio']['proposal']) + ')'}
            for key, prefix in [('typed','typed'),('audio_note','audio')]:
                note = fixture[key]
                expressions[key] = 'read_clinical_note_job(' + quote(owner['id']) + ',' + quote(note['job']) + ')'
                expressions[prefix + '_provenance'] = 'read_clinical_note_provenance(' + quote(owner['id']) + ',' + quote(note['proposal']) + ')'
                expressions[prefix + '_receipt'] = 'recover_clinical_dictation_action(' + quote(owner['id']) + ',' + quote(note['action']) + ",'review'," + quote(json.dumps(note['review_request'])) + '::jsonb)'
            restored_legacy = json.loads(sql('begin;set local role authenticated;select set_config(\'request.jwt.claims\',' + quote(json.dumps(owner['claims'])) + ',true);select jsonb_build_object(' + ','.join(quote(k) + ',' + value for k,value in expressions.items()) + ');rollback;', clone).splitlines()[-1])
            restored_legacy['fixture'] = after['fixture']
            # The destination/template/current policy intentionally changed for history tests;
            # validate current restored values through the real frontend models, not old-state equality.
            restored_snapshots = private / (args.evidence_prefix + '-legacy-restored-snapshots.json')
            with restored_snapshots.open('x') as handle:
                handle.write(json.dumps([before, after, restored_legacy], indent=2) + '\n')
            parsed = json.loads(run(['node','--experimental-strip-types',str(root/'tests/clinical-call-notes/parse-legacy.ts'),str(restored_snapshots)]).stdout.splitlines()[-1])
            check(parsed['actualFrontendParses'], 27)
            check(parsed['actualFrontendReviewChecks'], 9); restore_checks += 1
            sql('do $$declare j record;begin for j in select id from clinical_note_jobs where source_kind=\'call_transcript\'loop perform clinical_call_note_check_binding(j.id);end loop;end $$;', clone)
            restore_checks += 1
            check(json.loads(sql(snapshot_sql)), snapshot); restore_checks += 1
        finally:
            assert sql("select shobj_description(oid,'pg_database')from pg_database where datname=" + quote(clone) + ';') == marker
            check(sql('select current_database();'), 'postgres')
            sql('drop database ' + clone + ' with(force);')
            restore_checks += 1
        after_advisors = advisors('current203')
    assert all(hashlib.sha256((root / name).read_bytes()).hexdigest() == digest for name, digest in hashes.items()), 'Proof input changed during run'
    proof = {'identity': identity, 'sql_summary': summary, 'sql_only': args.sql_only,
             'baseline_migrations': 201, 'current_migrations': 205, 'initial_migrations': len(selected), 'migration_upgrade_executed': not args.sql_only, 'source_sha256': hashes,
             'actual_auth_api_assertions': checks, 'observed_source_read_waits': waits,
             'provider_requests': 0, 'hosted_writes': 0, 'owned_runtime_removed': False}
    if not args.sql_only:
        proof.update(actual_frontend_parses=parsed['actualFrontendParses'], exact_legacy_json_preserved=True,
                     actual_frontend_review_checks=parsed['actualFrontendReviewChecks'],
                     exact_legacy_wire_bytes_preserved=True, legacy_wire_sha256={k:{n:{f:m[f]for f in ['sha256','bytes']}for n,m in values.items()}for k,values in legacy_wire.items()},
                     populated_restore_assertions=restore_checks, restored_relation_families=len(names), restored_public_routines=len(catalog['routines']), baseline_advisors=baseline_advisors,
                     current_advisors=after_advisors, source_manifest_sha256=retained['binding']['call_source_sha256'])
finally:
    try:
        if started:
            names = run(['docker', 'ps', '-a', '--filter', 'label=com.supabase.cli.project=' + identity, '--format', '{{.Names}}']).stdout.splitlines()
            for name in names:
                labels = json.loads(run(['docker', 'inspect', name], sensitive=True).stdout)[0]['Config']['Labels']
                assert labels['com.supabase.cli.project'] == identity and Path(labels['com.supabase.cli.workdir']).resolve() == project.resolve()
            run(['supabase', 'stop', '--workdir', str(project), '--no-backup'], timeout=180)
            assert not run(['docker', 'ps', '-a', '--filter', 'label=com.supabase.cli.project=' + identity, '--format', '{{.Names}}']).stdout.strip()
            assert not run(['docker', 'volume', 'ls', '--filter', 'label=com.supabase.cli.project=' + identity, '--format', '{{.Name}}']).stdout.strip()
        shutil.rmtree(work)
        if proof:
            proof['owned_runtime_removed'] = True
            with (private / (args.evidence_prefix + '-proof.json')).open('x') as handle:
                handle.write(json.dumps(proof, indent=2) + '\n')
            print(json.dumps({k: v for k, v in proof.items() if k not in ['source_sha256', 'identity']}), flush=True)
            print('Owned call-note runtime removed.', flush=True)
    finally:
        log.close()
