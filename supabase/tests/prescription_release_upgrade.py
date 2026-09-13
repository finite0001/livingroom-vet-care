"""Owned local schema7-to8 populated upgrade; no hosted or provider writes."""
import hashlib
import json
from pathlib import Path
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[2]
CONTAINER = 'supabase_db_livingroom-vet-foundation'
DB = 'lrv_rx_upgrade_' + uuid.uuid4().hex
MARKER = 'owned-' + uuid.uuid4().hex
BASE = ['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-d']
checks = []


def sql(query, database=DB):
    result = subprocess.run(BASE + [database], input=query, text=True, capture_output=True)
    if result.returncode:
        raise AssertionError(result.stderr[-6000:])
    assert not any(line.startswith('not ok ') for line in result.stdout.splitlines()), result.stdout
    return result.stdout.strip()


def check(condition, message):
    assert condition, message
    checks.append(message)
    print('PASS: ' + message, flush=True)


def migration(version):
    matches = list((ROOT / 'supabase/migrations').glob(version + '_*'))
    assert len(matches) == 1, version
    return matches[0]


def fixture(name, boundary, legacy=False):
    source = (ROOT / 'supabase/tests' / name).read_text()
    if name == 'release_imported_vaccination.test.sql':
        source = source.replace('@example.test', '@vaccine-example.test')
    assert source.count(boundary) == 1
    source = source.split(boundary)[0]
    if legacy:
        source = source.replace('db560000', 'db559000').replace('prescriptionitem-test-site', 'legacy-preparation-test-site').replace('@example.test', '@legacy-example.test')
        source += "set local role authenticated;insert into data select 'prepared',prepare_ezyvet_prescription_review((select id from fx where k='approval'),(select id from fx where k='pet'),(select v from data where k='payload'));select is((select v#>>'{request,status}' from data where k='prepared'),'prepared','Legacy draft persisted before interpretation validation');"
    result = sql(source + "\nselect 'FIXTURE:'||jsonb_build_object('ids',(select jsonb_object_agg(k,id) from fx),'data',(select jsonb_object_agg(k,v) from data))::text;select * from finish();commit;")
    return json.loads(next(line.removeprefix('FIXTURE:') for line in result.splitlines() if line.startswith('FIXTURE:')))


def staff(actor, query):
    result = sql("begin;set local role authenticated;select set_config('request.jwt.claims','" + json.dumps({'sub': actor, 'role': 'authenticated'}) + "',true);select 'RESULT:'||(" + query + ")::text;commit;")
    return json.loads(next(line.removeprefix('RESULT:') for line in result.splitlines() if line.startswith('RESULT:')))


def snapshot():
    tables = json.loads(sql("select jsonb_agg(format('%I.%I',schemaname,tablename) order by schemaname,tablename) from pg_tables where schemaname in ('public','auth','storage');"))
    statements = [f"select jsonb_build_object('table','{table}','rows',coalesce(jsonb_agg(r order by r::text),'[]')) from (select to_jsonb(t) r from {table} t) rows;" for table in tables]
    rows = sql('begin isolation level repeatable read read only;' + '\n'.join(statements) + 'commit;')
    return {entry['table']: entry['rows'] for entry in map(json.loads, rows.splitlines())}


labels = json.loads(subprocess.check_output(['docker', 'inspect', CONTAINER]))[0]['Config']['Labels']
assert labels['com.supabase.cli.project'] == 'livingroom-vet-foundation'
sql(f'create database {DB};', 'postgres')
sql(f"comment on database {DB} is '{MARKER}';", 'postgres')
try:
    dump = subprocess.check_output(['docker', 'exec', CONTAINER, 'pg_dump', '-U', 'postgres', '--schema-only', '--no-owner', '--schema=public', '--schema=auth', '--schema=storage', '--schema=extensions', 'postgres']).decode()
    dump = dump.replace('CREATE SCHEMA extensions;', 'CREATE SCHEMA IF NOT EXISTS extensions;')
    dump = '\n'.join(line for line in dump.splitlines() if not line.startswith('ALTER DEFAULT PRIVILEGES'))
    sql('drop schema public;create schema extensions;create extension pgcrypto with schema extensions;create extension "uuid-ossp" with schema extensions;')
    sql(dump)
    check(sql("select to_regprocedure('public.preview_record_release_v8(uuid,uuid,text,text,jsonb)') is null;") == 't', 'Clone starts before schema8')
    for version in ['20260913520000', '20260913530000', '20260913540000', '20260913900000'] + [f'20260913{n}0000' for n in range(55, 60)]:
        sql(migration(version).read_text())
    legacy = fixture('ezyvet_prescription_review.test.sql', '-- FIXTURE_END', legacy=True)
    legacy_actor = 'db559000-0000-4000-8000-000000000001'
    legacy_id, legacy_pet = legacy['ids']['approval'], legacy['ids']['pet']
    legacy_before = snapshot()
    legacy_receipt = legacy['data']['prepared']
    check(legacy_receipt['clinical_approval_available'] is False, 'Legacy fixture saved before clinical approval existed')
    for n in range(60, 63):
        sql(migration(f'20260913{n}0000').read_text())
    legacy_after = snapshot()
    comparable = {table: rows for table, rows in legacy_after.items() if table in legacy_before}
    comparable['public.ezyvet_prescription_review_requests'] = [{key: value for key, value in row.items() if key != 'approved_record_id'} for row in comparable['public.ezyvet_prescription_review_requests']]
    check(comparable == legacy_before and all(not rows for table, rows in legacy_after.items() if table not in legacy_before), 'Interpretation/approval upgrade preserves every old field and leaves new tables empty')
    recovered = staff(legacy_actor, f"recover_ezyvet_prescription_review('{legacy_id}','{legacy_pet}')")
    check(recovered['request'] == legacy_receipt['request'] | {'approved_record_id': None} and recovered['receipt'] is None, 'Old draft and exact hash recover without fabricated approval')
    frozen_hash = legacy_receipt['request']['request_hash']
    sql("begin;set local search_path=public,extensions;select no_plan();set local role authenticated;select set_config('request.jwt.claims','" + json.dumps({'sub': legacy_actor, 'role': 'authenticated'}) + "',true);select throws_ok($$select approve_ezyvet_prescription_review('" + legacy_id + "','" + legacy_pet + "','" + frozen_hash + "',true)$$,'40001','Prepared prescription context changed','Legacy source-only draft cannot silently approve');select * from finish();rollback;")
    check(snapshot() == legacy_after, 'Rejected legacy approval leaves all persisted rows unchanged')
    payload = json.dumps(legacy['data']['payload']).replace("'", "''")
    replay = staff(legacy_actor, f"prepare_ezyvet_prescription_review('{legacy_id}','{legacy_pet}','{payload}'::jsonb)")
    check(replay == recovered, 'Exact preparation retry preserves old draft instead of rewriting its context')
    abandoned = staff(legacy_actor, f"abandon_ezyvet_prescription_review('{legacy_id}','{legacy_pet}',true)")
    check(abandoned['request']['status'] == 'abandoned', 'Veterinarian can explicitly abandon incompatible draft')
    fresh_id = str(uuid.uuid4())
    fresh = staff(legacy_actor, f"prepare_ezyvet_prescription_review('{fresh_id}','{legacy_pet}','{payload}'::jsonb)")
    approved = staff(legacy_actor, f"approve_ezyvet_prescription_review('{fresh_id}','{legacy_pet}','{fresh['request']['request_hash']}',true)")
    check(approved['request']['status'] == 'approved' and approved['receipt']['id'] == fresh_id, 'Fresh explicit review can approve the same preserved source after upgrade')
    rx = fixture('ezyvet_prescription_review.test.sql', "select throws_ok($$select approve_ezyvet_prescription_review((select id from fx where k='competing')")
    old = fixture('release_imported_vaccination.test.sql', '-- Correction invalidates both pending packages;')
    actor_rx = 'db560000-0000-4000-8000-000000000001'
    # Read the actor from the fixture's saved release rather than relying on another test's convention.
    actor_old = sql(f"select created_by from record_releases where id='{old['ids']['mixed-release']}';")
    def recovery():
        result = {}
        for key in ['approval', 'duplicate', 'correction', 'competing']:
            result[key] = staff(actor_rx, f"recover_ezyvet_prescription_review('{rx['ids'][key]}','{rx['ids']['pet']}')")
        for key in ['vaccine-release', 'mixed-release']:
            result[key] = staff(actor_old, f"read_record_release('{old['ids'][key]}')")
        return result
    before_recovery = recovery()
    check(before_recovery['competing']['request']['status'] == 'prepared', 'Pre-upgrade pending correction retained')
    check(all(before_recovery[k]['eligible'] for k in ['vaccine-release', 'mixed-release']), 'Pre-upgrade schema7 packages eligible')
    before = snapshot()
    check(len(before['public.ezyvet_imported_prescriptions']) == 3, 'Pre-upgrade approved correction chain and freshly reviewed legacy source populated')
    upgrade_paths = [migration('20260913630000'), migration('20260913640000')]
    for path in upgrade_paths:
        sql(path.read_text())
    check(snapshot() == before, 'Every public/Auth/Storage table row preserved exactly by upgrade')
    check(recovery() == before_recovery, 'Approved, pending and schema7 staff recovery responses unchanged')
    for key in ['vaccine-release', 'mixed-release']:
        saved = next(row for row in before['public.record_releases'] if row['id'] == old['ids'][key])
        def literal(value):
            return "'" + str(value).replace("'", "''") + "'"
        arguments = [saved['id'], saved['pet_id'], saved['client_id'], saved['channel'], saved['recipient'], json.dumps(saved['selection']), json.dumps(saved['snapshot']), saved['source_hash']]
        replay = staff(actor_old, 'to_jsonb(confirm_record_release(' + ','.join(map(literal, arguments)) + ',true))')
        check(replay == saved, key + ' exact confirmation retry returns original row after upgrade')
    selected = json.dumps({'imported_prescription_ids': [rx['ids']['correction']]})
    preview = staff(actor_rx, f"preview_record_release_v8('{rx['ids']['pet']}','{rx['ids']['client']}','EMAIL','clinical-import@example.test','{selected}'::jsonb)")
    check(preview['snapshot']['schema_version'] == 8 and len(preview['snapshot']['imported_prescriptions']) == 1, 'Existing approved correction renders in new schema8 preview')
    candidates = staff(actor_rx, f"list_record_release_sources_v8('{rx['ids']['pet']}')")
    check(candidates['policy_v8_accepted'] is False, 'Upgrade does not silently grant clinical acceptance for schema8')
    check(snapshot() == before, 'Recovery and new preview introduce no persisted side effects')
    upgrade_paths = [migration(f'20260913{n}0000') for n in range(60, 65)]
    receipt = {'scope': 'local populated pre6000 review and pre6300/6400 export upgrades', 'checks': checks, 'table_count': len(before), 'row_count': sum(map(len, before.values())), 'migrations': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in upgrade_paths}, 'hosted_changes': False, 'provider_requests': 0}
finally:
    assert sql(f"select shobj_description(oid,'pg_database') from pg_database where datname='{DB}';", 'postgres') == MARKER
    sql(f'drop database {DB};', 'postgres')
    print('Owned disposable database removed', flush=True)
receipt['cleanup_verified'] = sql(f"select count(*) from pg_database where datname='{DB}';", 'postgres') == '0'
assert receipt['cleanup_verified']
print('EVIDENCE:' + json.dumps(receipt, sort_keys=True))
