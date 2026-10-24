"""Restore populated stock sources and rehearse exact pre-provenance writer upgrade."""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import subprocess
import uuid

from stock_writer_historical_upgrade import run_historical_upgrades

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
handoff_migration = root/'supabase/migrations/20261015055007_native_custody_provenance.sql'
handoff_migration_hash = hashlib.sha256(handoff_migration.read_bytes()).hexdigest()
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
        states = re.findall(r'^ERROR:\s+([0-9A-Z]{5}):', result.stderr, re.MULTILINE)
        state = states[-1] if states else 'unknown'
        raise RuntimeError('Owned stock-source restore failed; SQLSTATE ' + state + '; protected log retained')
    return result.stdout.strip()


def snapshot(names, database='postgres'):
    pieces = ["'%s',(select jsonb_build_object('count',count(*),'hash',md5(coalesce(string_agg(to_jsonb(t)::text,'|'order by to_jsonb(t)::text),'')))from public.%s t)" % (name, name) for name in names]
    return sql('select ' + '||'.join('jsonb_build_object(' + ','.join(pieces[index:index+15]) + ')' for index in range(0, len(pieces), 15)) + ';', database)


def staff(actor, query, rollback=True):
    session = str(uuid.uuid4())
    claims = json.dumps({'role': 'authenticated', 'sub': actor, 'session_id': session}, separators=(',', ':'))
    return f"begin;update profiles set is_active=true where id='{actor}';insert into auth.sessions(id,user_id,created_at,updated_at)values('{session}','{actor}',clock_timestamp(),clock_timestamp());set local role authenticated;set local request.jwt.claims='{claims}';" + query + (';rollback;' if rollback else ';commit;')


before = snapshot(tables)
handoff_clinical = clinical_tables + ['native_pickups','native_dispense_correction_events','native_dispense_correction_operations']
handoff_tables = tables + ['stock_pickup_sources','stock_correction_sources','native_pickups','native_dispense_correction_events','native_dispense_correction_operations']
handoff_before = snapshot(handoff_tables)
assert len(handoff_tables)==26 and all(row['count']>0 for row in json.loads(handoff_before).values()), 'Both additional source families and their linked native history must be populated'
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
    assert snapshot(handoff_tables, restored) == handoff_before
    assert json.loads(sql(staff(record['actor'], record['query']), restored).splitlines()[-1]) == expected
    assert snapshot(tables, restored) == before
    sql('select stock_source_validate_movement(movement_id)from stock_movement_sources;', restored)
    assert sql("select bool_and(definition_sha256=encode(sha256(convert_to(pg_get_functiondef(signature::regprocedure),'UTF8')),'hex'))from stock_writer_manifests;", restored) == 't'
    for table in source_tables:
        assert sql(f"select has_table_privilege('authenticated','{table}','SELECT')or has_table_privilege('service_role','{table}','INSERT');", restored) == 'f'
    for helper in helpers:
        assert sql(f"select has_function_privilege('authenticated','{helper}','EXECUTE')or has_function_privilege('service_role','{helper}','EXECUTE');", restored) == 'f'
    handoff_receipts=[]
    for query in [
        "select jsonb_build_object('actor',actor_id,'query',format('select record_native_pickup(%L::uuid,%L::jsonb)',id,request::text))from native_fulfillment_operations where operation='pickup'order by created_at limit 1;",
        "select jsonb_build_object('actor',actor_id,'query',format('select append_native_dispense_correction(%L::uuid,%L::jsonb)',id,request::text))from native_dispense_correction_operations where request->>'kind'='operational_annotation'order by created_at limit 1;",
    ]:
        item=json.loads(sql(query))
        item['receipt']=json.loads(sql(staff(item['actor'],item['query'])).splitlines()[-1])
        assert json.loads(sql(staff(item['actor'],item['query']),restored).splitlines()[-1])==item['receipt']
        handoff_receipts.append(item)
    assert snapshot(handoff_tables)==handoff_before and snapshot(handoff_tables,restored)==handoff_before
    for table in ['stock_pickup_sources','stock_correction_sources']:
        assert sql(f"select has_table_privilege('authenticated','{table}','SELECT')or has_table_privilege('service_role','{table}','INSERT');",restored)=='f'
    for helper in ['stock_handoff_guard()','stock_handoff_consistency()']:
        assert sql(f"select has_function_privilege('authenticated','{helper}','EXECUTE')or has_function_privilege('service_role','{helper}','EXECUTE');",restored)=='f'
    # A restored historical admission must not authorize a new statement, even
    # when privileged fixture SQL supplies otherwise valid current staff claims.
    lot = sql('select lot_id from inventory_movements where not native_reconciliation_lot_held(lot_id)order by id limit 1;', restored)
    assert lot, 'A non-held source lot is required to isolate stale-admission enforcement'
    claims = json.dumps({'role': 'authenticated', 'sub': record['actor']}, separators=(',', ':'))
    sql(f"begin;update profiles set is_active=true where id='{record['actor']}';set local request.jwt.claims='{claims}';insert into inventory_movements(id,lot_id,quantity,kind,reason,created_by,created_at) values('{uuid.uuid4()}','{lot}',1,'adjust','Restored stale admission attempt','{record['actor']}',clock_timestamp());commit;", restored, 'Stock writer admission required')
    assert snapshot(tables, restored) == before

    # Historical source upgrades run on genuine migration-prefix runtimes.
    # Removing provenance tables from this installed-205 clone would leave
    # compiled 205 trigger dependencies and would not reconstruct either era.
    expected_prior = json.loads(sql("select jsonb_agg(jsonb_build_object('writer',writer,'signature',signature,'prior_hash',prior_definition_sha256)order by writer)from stock_writer_manifests;"))
    assert len(expected_prior) == 10
    historical = run_historical_upgrades(root, project/'stock-historical-evidence', expected_prior)
    # Validate the returned, separately owned era receipts before publishing
    # compatibility fields below; no historical definitions are adopted here.
    assert historical['kind'] == 'controlled-stock-genuine-historical-upgrades-v1'
    assert historical['passed'] is True and historical['owned_runtimes_removed'] is True
    source_upgrade = historical['source_upgrade187']
    handoff_upgrade = historical['handoff_upgrade188']
    assert type(source_upgrade['exact_prior_definition_hashes']) is int and source_upgrade['exact_prior_definition_hashes'] == 8
    assert type(handoff_upgrade['exact_prior_definition_hashes']) is int and handoff_upgrade['exact_prior_definition_hashes'] == 2
    for flag in ('legacy_history_preserved', 'unexpected_drift_denied_atomically',
                 'legacy_receipt_unchanged_without_backfill', 'new_post_upgrade_source_enforced'):
        assert source_upgrade[flag] is True
    for flag in ('history_preserved', 'source_drift_rolls_back_all_ddl',
                 'legacy_replay_has_no_backfill', 'new_correction_has_one_source_and_no_stock_or_billing_effect'):
        assert handoff_upgrade[flag] is True
    assert isinstance(historical['source_hashes'], dict) and historical['source_hashes']
    for name, digest in historical['source_hashes'].items():
        source = (root/name).resolve()
        assert source.is_relative_to(root) and isinstance(digest, str) and re.fullmatch('[0-9a-f]{64}', digest)
        assert hashlib.sha256(source.read_bytes()).hexdigest() == digest

finally:
    for database, marker in owned.items():
        assert sql(f"select shobj_description(oid,'pg_database')from pg_database where datname='{database}';") == marker
        sql('drop database ' + database + ';')

assert snapshot(tables) == before
assert snapshot(handoff_tables)==handoff_before
log.close()
proof = {'populated_source_families': 5, 'snapshot_relations': 21, 'all_eight_writer_sources_present': True, 'exact_snapshot_restored': True, 'exact_native_receipt_replayed': True, 'restored_stale_admission_denied': True, 'private_grants_and_manifest_restored': True, 'upgrade_exact_prior_definition_hashes': source_upgrade['exact_prior_definition_hashes'], 'populated_upgrade_preserved_legacy_history': source_upgrade['legacy_history_preserved'], 'unexpected_source_drift_denied_atomically': source_upgrade['unexpected_drift_denied_atomically'], 'legacy_receipt_unchanged_without_backfill': source_upgrade['legacy_receipt_unchanged_without_backfill'], 'new_post_upgrade_source_enforced': source_upgrade['new_post_upgrade_source_enforced'], 'owned_clone_databases_removed': True, 'original_database_unchanged': True, 'migration_sha256': migration_hash, 'provider_requests': 0}
proof['handoff_extension']={'populated_snapshot_relations':26,'additional_source_families':2,'exact_snapshot_restored':True,'original_pickup_and_correction_receipts_restored':True,'upgrade_from_188_preserves_history':handoff_upgrade['history_preserved'],'source_drift_rolls_back_all_ddl':handoff_upgrade['source_drift_rolls_back_all_ddl'],'legacy_replay_has_no_backfill':handoff_upgrade['legacy_replay_has_no_backfill'],'new_correction_has_one_source_and_no_stock_or_billing_effect':handoff_upgrade['new_correction_has_one_source_and_no_stock_or_billing_effect'],'private_grants_restored':True,'migration_sha256':handoff_migration_hash}
proof['genuine_historical_upgrades'] = historical
(project/'stock-writer-restore-proof.json').write_text(json.dumps(proof, indent=2))
print(json.dumps(proof))
