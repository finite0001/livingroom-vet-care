"""Restore populated stock sources and rehearse exact pre-provenance writer upgrade."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--run-synthetic-local', action='store_true', required=True)
parser.add_argument('--project-config', type=Path, required=True)
args = parser.parse_args()
os.umask(0o077)
project = args.project_config.resolve().parent.parent
identity = args.project_config.read_text().splitlines()[0].split('"')[1]
assert identity.startswith('lrv-prescription-')
container = 'supabase_db_' + identity
labels = json.loads(subprocess.check_output(['docker', 'inspect', container], text=True))[0]['Config']['Labels']
assert labels['com.supabase.cli.project'] == identity
assert Path(labels['com.supabase.cli.workdir']).resolve() == project
root = Path(__file__).resolve().parents[2]
migration = root/'supabase/migrations/20261015020722_stock_writer_provenance.sql'
migration_hash = hashlib.sha256(migration.read_bytes()).hexdigest()
log = (project/'stock-source-restore.log').open('w')
source_tables = ['stock_writer_manifests', 'stock_writer_admissions', 'stock_movement_sources', 'stock_custody_sources', 'stock_discrepancy_sources']
clinical_tables = ['catalog_products', 'inventory_lots', 'inventory_movements', 'patient_treatments', 'anesthesia_drug_administrations', 'native_dispenses', 'native_dispense_allocations', 'native_return_events', 'native_return_operations', 'native_return_stock_links', 'native_return_compensation_links', 'native_return_discrepancy_events', 'native_return_discrepancy_operations', 'native_fulfillment_operations', 'billing_invoice_items', 'billing_invoices']
tables = source_tables + clinical_tables
helpers = ['stock_source_immutable()', 'stock_writer_current()', 'stock_writer_enter(text,uuid)', 'stock_source_guard()', 'stock_source_validate_movement(uuid)', 'stock_source_consistency()']


def sql(query, database='postgres', expected_error=None):
    result = subprocess.run(['docker', 'exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], input="set timezone='UTC';" + query, capture_output=True, text=True, timeout=90)
    log.write('Owned database: ' + database + '\n' + result.stderr + '\n')
    log.flush()
    if expected_error is not None:
        assert result.returncode != 0 and expected_error in result.stderr, 'Expected isolated restore rejection missing; protected log retained'
        return ''
    if result.returncode:
        raise RuntimeError('Owned stock-source restore failed; protected stock-source-restore.log retained')
    return result.stdout.strip()


def snapshot(names, database='postgres'):
    pieces = ["'%s',(select jsonb_build_object('count',count(*),'hash',md5(coalesce(string_agg(to_jsonb(t)::text,'|'order by to_jsonb(t)::text),'')))from public.%s t)" % (name, name) for name in names]
    return sql('select ' + '||'.join('jsonb_build_object(' + ','.join(pieces[index:index+15]) + ')' for index in range(0, len(pieces), 15)) + ';', database)


def staff(actor, query, rollback=True):
    session = str(uuid.uuid4())
    claims = json.dumps({'role': 'authenticated', 'sub': actor, 'session_id': session}, separators=(',', ':'))
    return f"begin;update profiles set is_active=true where id='{actor}';insert into auth.sessions(id,user_id,created_at,updated_at)values('{session}','{actor}',clock_timestamp(),clock_timestamp());set local role authenticated;set local request.jwt.claims='{claims}';" + query + (';rollback;' if rollback else ';commit;')


before = snapshot(tables)
assert len(tables) == 21 and all(row['count'] > 0 for row in json.loads(before).values()), 'All five source families and sixteen linked clinical/stock families must be populated'
writers = json.loads(sql("select jsonb_agg(writer order by writer)from(select writer from stock_movement_sources union select writer from stock_custody_sources union select 'record_native_return_discrepancy' where exists(select 1 from stock_discrepancy_sources))q;"))
assert set(writers) == {'receive_inventory','adjust_inventory','record_patient_treatment','record_anesthesia_drug_administration','record_native_dispense','record_native_dispense_return','record_native_dispense_return_v2','record_native_return_discrepancy'}
record = json.loads(sql("select jsonb_build_object('actor',actor_id,'query',format('select record_native_dispense(%L::uuid,%L::jsonb)',id,request::text))from native_fulfillment_operations where operation='dispense'order by created_at limit 1;"))
expected = json.loads(sql(staff(record['actor'], record['query'])).splitlines()[-1])
assert snapshot(tables) == before
dump = subprocess.check_output(['docker', 'exec', container, 'pg_dump', '-U', 'postgres', '--no-owner', '--schema=public', '--schema=auth', '--schema=storage', '--schema=extensions', 'postgres'], timeout=90)
assert len(dump) < 50 * 1024 * 1024
(project/'stock-source-populated.sql').write_bytes(dump)
restored_sql = dump.decode().replace('CREATE SCHEMA extensions;', 'CREATE SCHEMA IF NOT EXISTS extensions;')
restored_sql = '\n'.join(line for line in restored_sql.splitlines() if not line.startswith('ALTER DEFAULT PRIVILEGES'))
owned = {}


def clone(label):
    database = 'owned_stock_' + label + '_' + uuid.uuid4().hex[:12]
    marker = str(uuid.uuid4())
    sql(f"create database {database};comment on database {database} is '{marker}';")
    owned[database] = marker
    sql('drop schema public;create schema extensions;create extension pgcrypto with schema extensions;create extension "uuid-ossp"with schema extensions;', database)
    sql(restored_sql, database)
    return database


try:
    restored = clone('restore')
    assert snapshot(tables, restored) == before
    assert json.loads(sql(staff(record['actor'], record['query']), restored).splitlines()[-1]) == expected
    assert snapshot(tables, restored) == before
    sql('select stock_source_validate_movement(movement_id)from stock_movement_sources;', restored)
    assert sql("select bool_and(definition_sha256=encode(sha256(convert_to(pg_get_functiondef(signature::regprocedure),'UTF8')),'hex'))from stock_writer_manifests;", restored) == 't'
    for table in source_tables:
        assert sql(f"select has_table_privilege('authenticated','{table}','SELECT')or has_table_privilege('service_role','{table}','INSERT');", restored) == 'f'
    for helper in helpers:
        assert sql(f"select has_function_privilege('authenticated','{helper}','EXECUTE')or has_function_privilege('service_role','{helper}','EXECUTE');", restored) == 'f'
    # A restored historical admission must not authorize a new statement, even
    # when privileged fixture SQL supplies otherwise valid current staff claims.
    lot = sql('select lot_id from inventory_movements where not native_reconciliation_lot_held(lot_id)order by id limit 1;', restored)
    assert lot, 'A non-held source lot is required to isolate stale-admission enforcement'
    claims = json.dumps({'role': 'authenticated', 'sub': record['actor']}, separators=(',', ':'))
    sql(f"begin;update profiles set is_active=true where id='{record['actor']}';set local request.jwt.claims='{claims}';insert into inventory_movements(id,lot_id,quantity,kind,reason,created_by,created_at) values('{uuid.uuid4()}','{lot}',1,'adjust','Restored stale admission attempt','{record['actor']}',clock_timestamp());commit;", restored, 'Stock writer admission required')
    assert snapshot(tables, restored) == before

    upgrade = clone('upgrade')
    manifest = json.loads(sql("select jsonb_agg(jsonb_build_object('writer',writer,'signature',signature,'prior_hash',prior_definition_sha256,'definition',replace(pg_get_functiondef(signature::regprocedure),chr(10)||format(' perform public.stock_writer_enter(%L,p_id);',writer),''))order by writer)from stock_writer_manifests;", upgrade))
    assert len(manifest) == 8
    for entry in manifest:
        # This is the EXACT canonical pre-migration function text, not a mock
        # old writer. Only the inserted entry line is removed, hash-verified.
        assert hashlib.sha256(entry['definition'].encode()).hexdigest() == entry['prior_hash']
        sql(entry['definition'], upgrade)
    for helper in helpers:
        sql('drop function if exists public.' + helper + ' cascade;', upgrade)
    for table in source_tables:
        sql('drop table if exists public.' + table + ' cascade;', upgrade)
    assert sql("select count(*)from pg_trigger where not tgisinternal and tgname in('stock_source_admission','aaa_stock_source_capture','stock_source_required');", upgrade) == '0'
    for entry in manifest:
        assert sql(f"select encode(sha256(convert_to(pg_get_functiondef('{entry['signature']}'::regprocedure),'UTF8')),'hex');", upgrade) == entry['prior_hash']
    actor = record['actor']
    product = sql("select id from catalog_products where active and kind<>'service'order by id limit 1;", upgrade)
    legacy_id, legacy_lot = str(uuid.uuid4()), str(uuid.uuid4())
    legacy_request = f"select to_jsonb(receive_inventory('{legacy_id}','{legacy_lot}','{product}','SYNTHETIC-LEGACY-{legacy_id[:8]}','2099-12-31','Synthetic upgrade clinic',1.125,'Synthetic pre-provenance receipt'))"
    legacy_receipt = json.loads(sql(staff(actor, legacy_request, False), upgrade).splitlines()[-1])
    legacy_before = snapshot(clinical_tables, upgrade)
    assert hashlib.sha256(migration.read_bytes()).hexdigest() == migration_hash
    # Drift the LAST of the eight roots. Failure must roll back all five new
    # tables and the SEVEN entry hooks already patched earlier in the migration.
    last=next(entry for entry in manifest if entry['writer']=='record_native_return_discrepancy')
    drifted=last['definition'].replace('begin','begin /* synthetic unreviewed drift */',1)
    sql(drifted,upgrade)
    sql(migration.read_text(),upgrade,'Unexpected pre-migration stock writer definition')
    assert sql("select count(*)from pg_class where relnamespace='public'::regnamespace and relname in('stock_writer_manifests','stock_writer_admissions','stock_movement_sources','stock_custody_sources','stock_discrepancy_sources');",upgrade)=='0'
    for entry in manifest:
        if entry['writer']!=last['writer']:
            assert sql(f"select encode(sha256(convert_to(pg_get_functiondef('{entry['signature']}'::regprocedure),'UTF8')),'hex');",upgrade)==entry['prior_hash']
    assert snapshot(clinical_tables,upgrade)==legacy_before
    sql(last['definition'],upgrade)
    sql(migration.read_text(), upgrade)
    assert snapshot(clinical_tables, upgrade) == legacy_before
    assert sql('select count(*)from stock_movement_sources;', upgrade) == '0', 'Old stock history must not be silently backfilled'
    assert json.loads(sql(staff(actor, legacy_request), upgrade).splitlines()[-1]) == legacy_receipt
    assert snapshot(clinical_tables, upgrade) == legacy_before
    assert sql('select count(*)from stock_movement_sources;', upgrade) == '0', 'Old receipt recovery must not invent a new source/event'
    next_id, next_lot = str(uuid.uuid4()), str(uuid.uuid4())
    query = f"select to_jsonb(receive_inventory('{next_id}','{next_lot}','{product}','SYNTHETIC-NEW-{next_id[:8]}','2099-12-31','Synthetic upgrade clinic',0.125,'Synthetic post-upgrade receipt'))"
    saved = json.loads(sql(staff(actor, query, False), upgrade).splitlines()[-1])
    assert saved['id'] == next_id
    assert sql('select count(*)from stock_movement_sources;', upgrade) == '1'
    sql(f"select stock_source_validate_movement('{next_id}');", upgrade)
    assert json.loads(sql(staff(actor, legacy_request), upgrade).splitlines()[-1]) == legacy_receipt
    assert sql(f"select sum(quantity)::text from inventory_movements where lot_id='{next_lot}';", upgrade) == '0.125'
finally:
    for database, marker in owned.items():
        assert sql(f"select shobj_description(oid,'pg_database')from pg_database where datname='{database}';") == marker
        sql('drop database ' + database + ';')

assert snapshot(tables) == before
log.close()
proof = {'populated_source_families': 5, 'snapshot_relations': 21, 'all_eight_writer_sources_present': True, 'exact_snapshot_restored': True, 'exact_native_receipt_replayed': True, 'restored_stale_admission_denied': True, 'private_grants_and_manifest_restored': True, 'upgrade_exact_prior_definition_hashes': 8, 'populated_upgrade_preserved_legacy_history': True, 'unexpected_source_drift_denied_atomically': True, 'legacy_receipt_unchanged_without_backfill': True, 'new_post_upgrade_source_enforced': True, 'owned_clone_databases_removed': True, 'original_database_unchanged': True, 'migration_sha256': migration_hash, 'provider_requests': 0}
(project/'stock-writer-restore-proof.json').write_text(json.dumps(proof, indent=2))
print(json.dumps(proof))
